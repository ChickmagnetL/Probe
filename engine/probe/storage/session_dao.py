"""Session CRUD operations."""

from __future__ import annotations

import sqlite3
from typing import Any


def upsert(conn: sqlite3.Connection, session: dict[str, Any]) -> None:
    conn.execute(
        """INSERT INTO sessions (id, source_path, file_name, parent_session_id,
               is_subagent, agent_nickname, agent_role, start_time, end_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
               source_path=excluded.source_path,
               file_name=excluded.file_name,
               parent_session_id=excluded.parent_session_id,
               is_subagent=excluded.is_subagent,
               agent_nickname=excluded.agent_nickname,
               agent_role=excluded.agent_role,
               start_time=excluded.start_time,
               end_time=excluded.end_time""",
        (
            session["id"],
            session.get("source_path"),
            session.get("file_name"),
            session.get("parent_session_id"),
            int(session.get("is_subagent", 0)),
            session.get("agent_nickname"),
            session.get("agent_role"),
            session.get("start_time"),
            session.get("end_time"),
        ),
    )


def upsert_many(conn: sqlite3.Connection, sessions: list[dict[str, Any]]) -> None:
    for session in sessions:
        upsert(conn, session)


def get_by_id(conn: sqlite3.Connection, session_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM sessions WHERE id = ?", (session_id,)
    ).fetchone()
    return _row_to_session(row) if row else None


def list_sessions(
    conn: sqlite3.Connection,
    *,
    filter_text: str | None = None,
    sort_by: str = "imported_at",
    sort_order: str = "desc",
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    where_clauses: list[str] = []
    params: list[Any] = []

    if filter_text:
        where_clauses.append(
            "(file_name LIKE ? OR source_path LIKE ? OR agent_nickname LIKE ?)"
        )
        pattern = f"%{filter_text}%"
        params.extend([pattern, pattern, pattern])

    where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    count_row = conn.execute(
        f"SELECT COUNT(*) FROM sessions{where_sql}", params
    ).fetchone()
    total = count_row[0] if count_row else 0

    allowed_sort = {"imported_at", "start_time", "file_name", "agent_nickname"}
    if sort_by not in allowed_sort:
        sort_by = "imported_at"
    order = "ASC" if sort_order.lower() == "asc" else "DESC"

    rows = conn.execute(
        f"SELECT * FROM sessions{where_sql} ORDER BY {sort_by} {order} LIMIT ? OFFSET ?",
        params + [limit, offset],
    ).fetchall()

    return [_row_to_session(r) for r in rows], total


def get_children(conn: sqlite3.Connection, parent_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM sessions WHERE parent_session_id = ? ORDER BY start_time",
        (parent_id,),
    ).fetchall()
    return [_row_to_session(r) for r in rows]


def delete_by_id(conn: sqlite3.Connection, session_id: str) -> None:
    conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))


def delete_many(conn: sqlite3.Connection, session_ids: list[str]) -> int:
    """Delete sessions and return count of deleted rows."""
    placeholders = ",".join("?" for _ in session_ids)
    cursor = conn.execute(
        f"DELETE FROM sessions WHERE id IN ({placeholders})", session_ids
    )
    return cursor.rowcount


def _row_to_session(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)
