"""POST /api/upload: receive a PDF and index it for the RAG tool."""

import logging
import os
import shutil
import tempfile

from fastapi import APIRouter, File, HTTPException, UploadFile

from config import settings
from schemas import ErrorResponse, UploadResponse
from services import rag_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["upload"])

PDF_MAGIC = b"%PDF-"
COPY_CHUNK_SIZE = 1024 * 1024


def _save_upload(upload: UploadFile, destination: str) -> None:
    """Copy the upload to `destination`, validating type and size on the way."""
    if upload.file.read(len(PDF_MAGIC)) != PDF_MAGIC:
        raise HTTPException(status_code=422, detail="The file is not a valid PDF.")
    upload.file.seek(0)

    written = 0
    with open(destination, "wb") as out:
        while chunk := upload.file.read(COPY_CHUNK_SIZE):
            written += len(chunk)
            if written > settings.max_upload_bytes:
                limit_mb = settings.max_upload_bytes // (1024 * 1024)
                raise HTTPException(status_code=413, detail=f"The PDF is larger than {limit_mb} MB.")
            out.write(chunk)


# A plain `def` endpoint: FastAPI runs it in a worker thread, so the slow
# embedding + indexing work never blocks the event loop.
@router.post(
    "/upload",
    response_model=UploadResponse,
    summary="Upload a PDF and add it to the RAG index",
    responses={413: {"model": ErrorResponse}, 422: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
def upload_pdf(file: UploadFile = File(...)) -> UploadResponse:
    filename = file.filename or "document.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="Only PDF files are supported.")

    fd, temp_path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    try:
        _save_upload(file, temp_path)
        rag_service.ingest_pdf(temp_path)
    except rag_service.InvalidPdfError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except rag_service.IngestionError as exc:
        logger.exception("PDF ingestion failed for %s", filename)
        raise HTTPException(status_code=500, detail=f"PDF processing failed: {exc}") from exc
    finally:
        file.file.close()
        if os.path.exists(temp_path):
            os.remove(temp_path)

    return UploadResponse(filename=filename, message=f"{filename} was processed and is ready to query.")
