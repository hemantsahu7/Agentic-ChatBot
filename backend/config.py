"""Application settings, read from environment variables (and `.env`).

API keys (Gemini, Tavily, OpenWeather, Alpha Vantage) are read directly by the
LangGraph agent module and never leave the backend. Only API-layer settings
live here.
"""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _parse_origins(raw: str) -> list[str]:
    """Split a comma-separated list of origins and drop trailing slashes."""
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


@dataclass(frozen=True)
class Settings:
    # Origins allowed by CORS (the React app). Comma-separated for several.
    frontend_origins: list[str]
    # Largest PDF accepted by POST /api/upload.
    max_upload_bytes: int


def load_settings() -> Settings:
    return Settings(
        frontend_origins=_parse_origins(os.getenv("FRONTEND_URL", "http://localhost:5173")),
        max_upload_bytes=int(os.getenv("MAX_UPLOAD_MB", "20")) * 1024 * 1024,
    )


settings = load_settings()
