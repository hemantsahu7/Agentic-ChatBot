"""POST /api/chat and POST /api/chat/resume, streamed as Server-Sent Events."""

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from schemas import ChatRequest, ErrorResponse, ResumeRequest
from services import chat_service

router = APIRouter(prefix="/api/chat", tags=["chat"])

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",  # stop reverse proxies (nginx) from buffering the stream
}


def _sse_response(graph_input, thread_id: str) -> StreamingResponse:
    return StreamingResponse(
        chat_service.stream_agent(graph_input, thread_id),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@router.post(
    "",
    summary="Send a message and stream the assistant's reply",
    response_class=StreamingResponse,
    responses={409: {"model": ErrorResponse}},
)
async def chat(request: ChatRequest) -> StreamingResponse:
    # A thread paused for approval must be resumed, not sent a new message:
    # the model would reject a tool call that has no result yet.
    if await run_in_threadpool(chat_service.get_pending_interrupts, request.thread_id):
        raise HTTPException(
            status_code=409,
            detail="This conversation is waiting for your approval. "
            "Approve or reject the pending action first.",
        )
    return _sse_response(chat_service.user_input(request.message), request.thread_id)


@router.post(
    "/resume",
    summary="Give the human decision for a paused run and stream the rest of the reply",
    response_class=StreamingResponse,
    responses={409: {"model": ErrorResponse}},
)
async def resume(request: ResumeRequest) -> StreamingResponse:
    if not await run_in_threadpool(chat_service.get_pending_interrupts, request.thread_id):
        raise HTTPException(
            status_code=409,
            detail="There is no pending approval for this conversation.",
        )
    return _sse_response(chat_service.resume_input(request.decision), request.thread_id)
