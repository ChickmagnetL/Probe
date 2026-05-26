"""Import history CRUD operations."""

from __future__ import annotations

import sqlite3
from typing import Any


def insert(conn: sqlite3.Connection, record: dict[str, Any]) -> None:
    conn.execute(
        """INSERT OR IGNORE INTO imports (id, input_path, file_count, session_count, status)
           VALUES (?, ?, ?, ?, ?)""",
        (
            record["id"],
            record.get("input_path"),
            record.get("file_count", 0),
            record.get("session_count", 0),
            record.get("status", "completed"),
        ),
    )


def list_imports(
    conn: sqlite3.Connection,
    *,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM imports ORDER BY imported_at DESC LIMIT ? OFFSET ?",
        (limit, offset),
    ).fetchall()
    return [dict(r) for r in rows]


def get_by_id(conn: sqlite3.Connection, import_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM imports WHERE id = ?", (import_id,)
    ).fetchone()
    return dict(row) if row else None
