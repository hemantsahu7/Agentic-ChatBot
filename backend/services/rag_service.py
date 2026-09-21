"""PDF ingestion for the RAG tool. Wraps the existing `ingest_rag_document()`."""

import threading

from pypdf.errors import PyPdfError

from agentic_chatbot_backend import ingest_rag_document

# The FAISS index is one shared folder that every ingestion overwrites, so two
# uploads must not write it at the same time.
_ingest_lock = threading.Lock()


class InvalidPdfError(Exception):
    """The file is not a readable PDF, or has no extractable text."""


class IngestionError(Exception):
    """Reading was fine but building the vector index failed."""


def ingest_pdf(file_path: str) -> None:
    with _ingest_lock:
        try:
            ingest_rag_document(file_path)
        except PyPdfError as exc:
            raise InvalidPdfError(f"The file could not be read as a PDF ({exc}).") from exc
        except ValueError as exc:  # raised when the PDF contains no text
            raise InvalidPdfError(str(exc)) from exc
        except Exception as exc:
            raise IngestionError(f"{type(exc).__name__}: {exc}") from exc
