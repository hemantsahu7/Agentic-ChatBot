"""Runs the existing LangGraph chatbot and turns its output into SSE events.

The graph is synchronous, so it runs in a worker thread while the async
generator below relays its events to the client without blocking the event
loop.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Iterator
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.types import Command

from agentic_chatbot_backend import chatbot
from utils import sse_event, text_from_content

logger = logging.getLogger(__name__)

_DONE = object()  # queue sentinel: the worker thread has finished


def build_config(thread_id: str) -> dict[str, Any]:
    """Same LangGraph config the Streamlit app used: one thread id = one conversation."""
    return {
        "configurable": {"thread_id": thread_id},
        "metadata": {"thread_id": thread_id},
        "run_name": "chat_trace",
    }


def get_pending_interrupts(thread_id: str) -> list[str]:
    """Messages of any `interrupt()` the thread is currently paused on."""
    state = chatbot.get_state(config={"configurable": {"thread_id": thread_id}})
    return [
        str(interrupt.value)
        for task in state.tasks
        for interrupt in task.interrupts
    ]


def user_input(message: str) -> dict[str, Any]:
    return {"messages": [HumanMessage(content=message)]}


def resume_input(decision: str) -> Command:
    return Command(resume=decision)


def iter_agent_events(graph_input: Any, thread_id: str) -> Iterator[tuple[str, dict[str, Any]]]:
    """Stream the graph and yield `(event_name, payload)` pairs.

    Mirrors the Streamlit logic: only AIMessage text is shown as assistant
    text, while ToolMessage (and the AI's tool calls) drive the tool status.
    """
    tool_names: dict[str, str] = {}  # tool_call_id -> tool name

    for message_chunk, _metadata in chatbot.stream(
        graph_input,
        config=build_config(thread_id),
        stream_mode="messages",
    ):
        if isinstance(message_chunk, ToolMessage):
            call_id = message_chunk.tool_call_id
            name = message_chunk.name or tool_names.get(call_id, "tool")
            if call_id not in tool_names:
                tool_names[call_id] = name
                yield "tool_start", {"id": call_id, "name": name}
            yield "tool_end", {
                "id": call_id,
                "name": name,
                "status": getattr(message_chunk, "status", "success") or "success",
            }

        elif isinstance(message_chunk, AIMessage):
            # The model announces a tool call before the tool runs.
            for call in getattr(message_chunk, "tool_call_chunks", None) or []:
                call_id, name = call.get("id"), call.get("name")
                if call_id and name and call_id not in tool_names:
                    tool_names[call_id] = name
                    yield "tool_start", {"id": call_id, "name": name}

            text = text_from_content(message_chunk.content)
            if text:
                yield "token", {"text": text}

    # A finished stream can also mean "paused for human approval".
    pending = get_pending_interrupts(thread_id)
    if pending:
        yield "interrupt", {"message": pending[0]}


def _describe_error(exc: Exception) -> str:
    """One readable line for the client; the full error is logged server-side."""
    text = f"{type(exc).__name__}: {exc}".split(" {", 1)[0]  # drop raw JSON payloads
    return text if len(text) <= 300 else text[:297] + "..."


async def stream_agent(graph_input: Any, thread_id: str) -> AsyncIterator[str]:
    """Async generator of SSE frames for one graph run.

    The graph runs in a worker thread that always runs to completion, even if
    the client disconnects mid-stream. Abandoning a run halfway could leave the
    checkpoint with a tool call that never got a result, which the model then
    rejects on every later message in that thread.
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def publish(item: Any) -> None:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, item)
        except RuntimeError:  # event loop already closed (server shutting down)
            pass

    def run_graph() -> None:
        try:
            for event, payload in iter_agent_events(graph_input, thread_id):
                publish((event, payload))
            publish(("done", {}))
        except Exception as exc:  # surfaced to the client as an `error` event
            logger.exception("Agent run failed for thread %s", thread_id)
            publish(("error", {"message": _describe_error(exc)}))
        finally:
            publish(_DONE)

    loop.run_in_executor(None, run_graph)

    while (item := await queue.get()) is not _DONE:
        event, payload = item
        yield sse_event(event, payload)
