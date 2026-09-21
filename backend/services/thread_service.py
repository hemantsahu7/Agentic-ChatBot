"""Thread (conversation) queries, backed by the LangGraph SQLite checkpointer.

The checkpointer stays the single source of truth; nothing is stored separately.
"""

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage

from agentic_chatbot_backend import chatbot, checkpoint
from schemas import ChatMessage, PendingInterrupt, ThreadDetail, ThreadSummary, ToolCallInfo
from services.chat_service import get_pending_interrupts
from utils import text_from_content

TITLE_MAX_LENGTH = 60


class ThreadNotFoundError(Exception):
    pass


def _title(messages: list[BaseMessage]) -> str:
    """Use the first user message as the conversation title."""
    for message in messages:
        if isinstance(message, HumanMessage):
            text = " ".join(text_from_content(message.content).split())
            if text:
                return text if len(text) <= TITLE_MAX_LENGTH else text[: TITLE_MAX_LENGTH - 1] + "…"
    return "New chat"


def list_threads() -> list[ThreadSummary]:
    """All threads that have at least one checkpoint, most recently active first."""
    threads: dict[str, ThreadSummary] = {}

    # `list` yields checkpoints newest-first, so the first one seen per thread
    # is that thread's latest state.
    for checkpoint_tuple in checkpoint.list(None):
        thread_id = checkpoint_tuple.config["configurable"]["thread_id"]
        if thread_id in threads:
            continue
        messages = checkpoint_tuple.checkpoint.get("channel_values", {}).get("messages", [])
        threads[thread_id] = ThreadSummary(
            thread_id=thread_id,
            title=_title(messages),
            updated_at=checkpoint_tuple.checkpoint.get("ts"),
        )

    return list(threads.values())


def to_chat_messages(messages: list[BaseMessage]) -> list[ChatMessage]:
    """Convert LangChain messages into what the UI shows.

    Like the Streamlit app, only human and AI text is shown. Tool calls are
    attached to the assistant reply they belong to instead of appearing as
    messages of their own.
    """
    result: list[ChatMessage] = []
    tools: list[ToolCallInfo] = []
    tool_by_call_id: dict[str, ToolCallInfo] = {}

    for message in messages:
        if isinstance(message, HumanMessage):
            result.append(ChatMessage(role="user", content=text_from_content(message.content)))
            tools, tool_by_call_id = [], {}

        elif isinstance(message, AIMessage):
            for call in message.tool_calls:
                call_id = call.get("id") or ""
                info = ToolCallInfo(id=call_id, name=call["name"], status="pending")
                tools.append(info)
                if call_id:
                    tool_by_call_id[call_id] = info
            text = text_from_content(message.content)
            if text:
                result.append(ChatMessage(role="assistant", content=text, tools=tools))
                tools, tool_by_call_id = [], {}

        elif isinstance(message, ToolMessage):
            info = tool_by_call_id.get(message.tool_call_id)
            if info:
                info.status = "error" if message.status == "error" else "done"

    # Tool calls with no reply text after them (e.g. paused for approval).
    if tools:
        result.append(ChatMessage(role="assistant", content="", tools=tools))

    return result


def get_thread(thread_id: str) -> ThreadDetail:
    state = chatbot.get_state(config={"configurable": {"thread_id": thread_id}})
    messages = state.values.get("messages") if state.values else None
    if not messages:
        raise ThreadNotFoundError(thread_id)

    pending = get_pending_interrupts(thread_id)
    return ThreadDetail(
        thread_id=thread_id,
        messages=to_chat_messages(messages),
        pending_interrupt=PendingInterrupt(message=pending[0]) if pending else None,
    )
