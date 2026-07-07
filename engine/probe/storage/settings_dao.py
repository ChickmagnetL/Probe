"""Settings KV store operations."""

from __future__ import annotations

import sqlite3
from typing import Any


def get_all(conn: sqlite3.Connection) -> dict[str, str]:
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    return {row[0]: row[1] for row in rows}


def get(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute(
        "SELECT value FROM settings WHERE key = ?", (key,)
    ).fetchone()
    return row[0] if row else None


def upsert(conn: sqlite3.Connection, key: str, value: Any) -> None:
    if isinstance(value, bool):
        value = "true" if value else "false"
    conn.execute(
        """INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value""",
        (key, value),
    )


def delete(conn: sqlite3.Connection, key: str) -> None:
    conn.execute("DELETE FROM settings WHERE key = ?", (key,))
