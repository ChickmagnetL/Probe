from __future__ import annotations

import math
from functools import lru_cache
from typing import Any

try:
    import tiktoken  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    tiktoken = None


MODEL_ENCODING_FALLBACKS = {
    "gpt-5": "o200k_base",
    "gpt-5.1": "o200k_base",
    "gpt-5.2": "o200k_base",
    "gpt-5.3": "o200k_base",
    "gpt-5.4": "o200k_base",
    "gpt-4o": "o200k_base",
    "gpt-4.1": "o200k_base",
}


def estimate_text_tokens(text: Any, model: str | None = None) -> int:
    if not isinstance(text, str):
        return 0
    normalized = text.strip()
    if not normalized:
        return 0

    exact = _estimate_with_tiktoken(normalized, model)
    if exact is not None:
        return exact
    return _estimate_with_heuristic(normalized)


@lru_cache(maxsize=16)
def _encoding_for_model(model: str | None):
    if tiktoken is None:
        return None
    candidates: list[str] = []
    if model:
        candidates.append(model)
        model_prefix = model.split("-", 2)
        if len(model_prefix) >= 2:
            candidates.append("-".join(model_prefix[:2]))
    candidates.extend(["gpt-5", "gpt-4o"])

    for candidate in candidates:
        try:
            return tiktoken.encoding_for_model(candidate)
        except Exception:
            pass
        fallback_name = MODEL_ENCODING_FALLBACKS.get(candidate)
        if fallback_name:
            try:
                return tiktoken.get_encoding(fallback_name)
            except Exception:
                pass
    try:
        return tiktoken.get_encoding("o200k_base")
    except Exception:
        return None


def _estimate_with_tiktoken(text: str, model: str | None) -> int | None:
    encoding = _encoding_for_model(model)
    if encoding is None:
        return None
    try:
        return len(encoding.encode(text, disallowed_special=()))
    except Exception:
        return None


def _estimate_with_heuristic(text: str) -> int:
    total = 0
    buffer: list[str] = []

    def flush_buffer() -> None:
        nonlocal total
        if not buffer:
            return
        chunk = "".join(buffer)
        byte_len = len(chunk.encode("utf-8"))
        total += max(1, math.ceil(byte_len / 4))
        buffer.clear()

    for char in text:
        if _is_cjk_char(char):
            flush_buffer()
            total += 1
            continue
        if char.isspace():
            flush_buffer()
            continue
        buffer.append(char)

    flush_buffer()
    return total


def _is_cjk_char(char: str) -> bool:
    if not char:
        return False
    code = ord(char)
    return (
        0x3400 <= code <= 0x4DBF
        or 0x4E00 <= code <= 0x9FFF
        or 0xF900 <= code <= 0xFAFF
        or 0x3040 <= code <= 0x309F
        or 0x30A0 <= code <= 0x30FF
        or 0xAC00 <= code <= 0xD7AF
    )
