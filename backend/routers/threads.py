"""Conversation (thread) endpoints."""

import uuid

from fastapi import APIRouter, HTTPException, Path
from fastapi.concurrency import run_in_threadpool

from schemas import THREAD_ID_PATTERN, ErrorResponse, ThreadCreated, ThreadDetail, ThreadList
from services import thread_service

router = APIRouter(prefix="/api/threads", tags=["threads"])


@router.get("", response_model=ThreadList, summary="List conversations, newest first")
async def list_threads() -> ThreadList:
    threads = await run_in_threadpool(thread_service.list_threads)
    return ThreadList(threads=threads)


@router.post("", response_model=ThreadCreated, status_code=201, summary="Create a new conversation id")
async def create_thread() -> ThreadCreated:
    # Same as reset_chat() in the old Streamlit app: just a fresh UUID. The
    # thread appears in the checkpoint DB once its first message is sent.
    return ThreadCreated(thread_id=str(uuid.uuid4()))


@router.get(
    "/{thread_id}",
    response_model=ThreadDetail,
    summary="Get a conversation's messages",
    responses={404: {"model": ErrorResponse}},
)
async def get_thread(thread_id: str = Path(pattern=THREAD_ID_PATTERN)) -> ThreadDetail:
    try:
        return await run_in_threadpool(thread_service.get_thread, thread_id)
    except thread_service.ThreadNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found.") from None
