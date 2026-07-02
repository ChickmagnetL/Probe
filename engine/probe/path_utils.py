"""Utilities for normalizing user-provided filesystem paths."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import url2pathname


def path_from_user_input(path_value: str) -> Path:
    """Normalize a local path or file:// URI into a Path."""
    raw = path_value.strip()
    if raw.lower().startswith("file:"):
        return _path_from_file_uri(raw)
    return Path(raw).expanduser()


def _path_from_file_uri(uri: str) -> Path:
    parsed = urlsplit(uri)
    if parsed.scheme.lower() != "file":
        raise ValueError(f"unsupported path URI: {uri}")

    raw_path = parsed.path or ""
    if parsed.netloc and parsed.netloc.lower() != "localhost":
        raw_path = f"//{parsed.netloc}{raw_path}"

    return Path(url2pathname(raw_path)).expanduser()
