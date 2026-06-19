"""Handle get_settings / set_settings methods — engine-side KV store."""

from __future__ import annotations

import os
from typing import Any

from probe.storage import get_connection
from probe.storage import settings_dao

# Key under which the configured Codex CLI sessions root is stored.
CODEX_PATH_KEY = "codex_path"


def default_codex_path() -> str | None:
    """Return the OS-default Codex CLI directory, or None if it cannot be inferred.

    macOS / Linux: ~/.codex
    Windows: %USERPROFILE%\\.codex
    """
    home = os.path.expanduser("~")
    if not home or home == "~":
        return None
    return os.path.join(home, ".codex")


def handle_get(params: dict[str, Any]) -> dict[str, Any]:
    # Currently no params; keep the signature uniform with other handlers.
    _ = params
    conn = get_connection()
    settings = settings_dao.get_all(conn)
    result: dict[str, Any] = dict(settings)
    default = default_codex_path()
    if default:
        result["default_codex_path"] = default
    return result


def handle_set(params: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(params, dict):
        raise ValueError("params must be an object")
    key = params.get("key")
    value = params.get("value")
    if not isinstance(key, str) or not key:
        raise ValueError("key is required and must be a non-empty string")
    if value is None:
        raise ValueError("value is required")
    if not isinstance(value, (str, int, float, bool)):
        raise ValueError("value must be a string, number, or boolean")

    conn = get_connection()
    settings_dao.upsert(conn, key, value)
    conn.commit()

    return {"key": key, "value": value}
