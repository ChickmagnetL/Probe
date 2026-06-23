"""Event CRUD operations."""

from __future__ import annotations

import json
import sqlite3
from typing import Any


def insert(conn: sqlite3.Connection, event: dict[str, Any]) -> None:
    metadata = _extract_metadata(event)
    conn.execute(
        """INSERT OR IGNORE INTO events
               (id, session_id, kind, timestamp, role, phase, content, metadata, source_line_no)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            event["event_id"],
            event["session_id"],
            event.get("kind"),
            event.get("timestamp"),
            event.get("role"),
            event.get("phase"),
            event.get("content"),
            json.dumps(metadata, ensure_ascii=False) if metadata else None,
            event.get("source_line_no"),
        ),
    )


def insert_many(conn: sqlite3.Connection, events: list[dict[str, Any]]) -> None:
    for event in events:
        insert(conn, event)


def get_by_session_id(
    conn: sqlite3.Connection,
    session_id: str,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM events WHERE session_id = ? ORDER BY timestamp, source_line_no",
        (session_id,),
    ).fetchall()
    return [_row_to_event(r) for r in rows]


def get_by_session_ids(
    conn: sqlite3.Connection,
    session_ids: list[str],
) -> list[dict[str, Any]]:
    """Bulk-fetch events for multiple sessions, ordered by timestamp then source_line_no."""
    if not session_ids:
        return []
    placeholders = ",".join("?" for _ in session_ids)
    rows = conn.execute(
        f"SELECT * FROM events WHERE session_id IN ({placeholders}) ORDER BY timestamp, source_line_no",
        session_ids,
    ).fetchall()
    return [_row_to_event(r) for r in rows]


def get_by_id(conn: sqlite3.Connection, event_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM events WHERE id = ?", (event_id,)
    ).fetchone()
    return _row_to_event(row) if row else None


def delete_by_session_id(conn: sqlite3.Connection, session_id: str) -> None:
    conn.execute("DELETE FROM events WHERE session_id = ?", (session_id,))


def _extract_metadata(event: dict[str, Any]) -> dict[str, Any] | None:
    skip_keys = {
        "event_id", "session_id", "kind", "timestamp", "role", "phase",
        "content", "source_line_no",
    }
    meta = {k: v for k, v in event.items() if k not in skip_keys and v is not None}
    return meta if meta else None


def _row_to_event(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    raw_meta = d.get("metadata")
    if raw_meta:
        try:
            d["metadata"] = json.loads(raw_meta)
        except (json.JSONDecodeError, TypeError):
            pass
    return d
