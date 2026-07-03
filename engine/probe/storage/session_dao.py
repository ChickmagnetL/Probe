"""Session CRUD operations."""

from __future__ import annotations

import sqlite3
from typing import Any

from .connection import probe_fts_capabilities
from .schema import INDEXABLE_KINDS

# Placeholders + params for the event-kind filter shared by the FTS and LIKE
# body-match paths. Derived from INDEXABLE_KINDS (a codebase constant, not user
# input) so both paths search the same indexable row set (message / reasoning /
# tool-call text — tool_output is excluded).
_KIND_PLACEHOLDERS = ",".join("?" for _ in INDEXABLE_KINDS)
_KIND_PARAMS: tuple[str, ...] = tuple(sorted(INDEXABLE_KINDS))


def upsert(conn: sqlite3.Connection, session: dict[str, Any]) -> None:
    conn.execute(
        """INSERT INTO sessions (id, platform, source_path, file_name, parent_session_id,
               is_subagent, agent_nickname, agent_role, start_time, end_time,
               title, cwd)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
               platform=excluded.platform,
               source_path=excluded.source_path,
               file_name=excluded.file_name,
               parent_session_id=excluded.parent_session_id,
               is_subagent=excluded.is_subagent,
               agent_nickname=excluded.agent_nickname,
               agent_role=excluded.agent_role,
               start_time=excluded.start_time,
               end_time=excluded.end_time,
               title=excluded.title,
               cwd=excluded.cwd""",
        (
            session["id"],
            session.get("platform", "codex_cli"),
            session.get("source_path"),
            session.get("file_name"),
            session.get("parent_session_id"),
            int(session.get("is_subagent", 0)),
            session.get("agent_nickname"),
            session.get("agent_role"),
            session.get("start_time"),
            session.get("end_time"),
            session.get("title"),
            session.get("cwd"),
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
    platform: str | None = None,
    filter_text: str | None = None,
    sort_by: str = "imported_at",
    sort_order: str = "desc",
    limit: int = 5000,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    where_clauses: list[str] = []
    params: list[Any] = []

    if platform:
        where_clauses.append("platform = ?")
        params.append(platform)

    if filter_text:
        # Metadata match (file_name / source_path / agent_nickname) OR body
        # match against events.content. Body match uses FTS5 when available and
        # the query has enough non-space chars for the trigram tokenizer;
        # otherwise it falls back to a LIKE EXISTS subquery over the same
        # indexable event kinds.
        metadata_clause = (
            "(file_name LIKE ? OR source_path LIKE ? OR agent_nickname LIKE ?)"
        )
        pattern = f"%{filter_text}%"
        body_clause, body_params = _build_body_match_clause(conn, filter_text)
        where_clauses.append(f"({metadata_clause} OR {body_clause})")
        params.extend([pattern, pattern, pattern])
        params.extend(body_params)

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


def _build_body_match_clause(
    conn: sqlite3.Connection,
    filter_text: str,
) -> tuple[str, list[Any]]:
    """Build the events.content match clause for list_sessions.

    Returns ``(sql_fragment, params)``. The fragment is OR-combined with the
    metadata LIKE clause and references the outer ``sessions`` table.

    Path selection:
      - FTS5 + trigram available AND ≥3 non-space chars in the sanitized query
        → ``sessions.id IN (… events_fts MATCH ?)``.
      - Otherwise (short query, FTS unavailable, or sanitization left the query
        empty) → ``EXISTS (… content LIKE ? AND kind IN (…))``.

    The MATCH argument is wrapped as a double-quoted phrase; the sanitizer
    strips double-quotes first so the phrase is always well-formed and all
    other FTS5 operators become literal text. This never raises
    ``fts5: syntax error``.
    """
    sanitized = filter_text.replace('"', "")
    compact = "".join(sanitized.split())

    fts5_ok, trigram_ok = probe_fts_capabilities(conn)
    use_fts = (
        fts5_ok
        and trigram_ok
        and len(compact) >= 3
        and sanitized.strip() != ""
    )

    if use_fts:
        clause = (
            "sessions.id IN ("
            " SELECT e.session_id FROM events e"
            " JOIN events_fts ON e.rowid = events_fts.rowid"
            " WHERE events_fts MATCH ?)"
        )
        return clause, [f'"{sanitized}"']

    clause = (
        "EXISTS (SELECT 1 FROM events e"
        " WHERE e.session_id = sessions.id"
        " AND e.content LIKE ?"
        f" AND e.kind IN ({_KIND_PLACEHOLDERS}))"
    )
    return clause, [f"%{filter_text}%", *_KIND_PARAMS]


def get_children(conn: sqlite3.Connection, parent_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM sessions WHERE parent_session_id = ? ORDER BY start_time",
        (parent_id,),
    ).fetchall()
    return [_row_to_session(r) for r in rows]


def get_by_ids(conn: sqlite3.Connection, session_ids: list[str]) -> list[dict[str, Any]]:
    """Bulk-fetch sessions by ID list."""
    if not session_ids:
        return []
    placeholders = ",".join("?" for _ in session_ids)
    rows = conn.execute(
        f"SELECT * FROM sessions WHERE id IN ({placeholders})",
        session_ids,
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
