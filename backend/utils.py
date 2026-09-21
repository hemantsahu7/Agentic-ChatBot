"""Small helpers shared by the API layer."""

import json
from typing import Any


def text_from_content(content: Any) -> str:
    """Extract text from LangChain's plain-text or structured content blocks."""
    if isinstance(content, str):
        return content

    if isinstance(content, dict) and content.get("type") == "text":
        return content.get("text", "")

    if isinstance(content, list):
        return "".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )

    return ""


def sse_event(event: str, data: dict[str, Any]) -> str:
    """Format one Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
