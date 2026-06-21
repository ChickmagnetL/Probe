"""imported_files table — incremental import tracking by source_path + mtime + size."""

from __future__ import annotations

import sqlite3
from typing import Any


def get(conn: sqlite3.Connection, source_path: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM imported_files WHERE source_path = ?",
        (source_path,),
    ).fetchone()
    return dict(row) if row else None


def get_all(conn: sqlite3.Connection) -> dict[str, dict[str, Any]]:
    rows = conn.execute("SELECT * FROM imported_files").fetchall()
    return {dict(r)["source_path"]: dict(r) for r in rows}


def upsert(
    conn: sqlite3.Connection,
    source_path: str,
    mtime: float,
    size: int,
    session_id: str,
) -> None:
    conn.execute(
        """INSERT INTO imported_files (source_path, mtime, size, session_id)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(source_path) DO UPDATE SET
               mtime=excluded.mtime,
               size=excluded.size,
               session_id=excluded.session_id,
               imported_at=CURRENT_TIMESTAMP""",
        (source_path, mtime, size, session_id),
    )


def delete(conn: sqlite3.Connection, source_path: str) -> None:
    conn.execute("DELETE FROM imported_files WHERE source_path = ?", (source_path,))


def delete_orphaned(conn: sqlite3.Connection) -> int:
    """Delete imported_files rows whose session_id no longer exists in sessions."""
    cursor = conn.execute(
        "DELETE FROM imported_files WHERE session_id NOT IN (SELECT id FROM sessions)"
    )
    return cursor.rowcount


def delete_by_session_ids(conn: sqlite3.Connection, session_ids: list[str]) -> None:
    """Delete imported_files rows for the given session ids."""
    if not session_ids:
        return
    placeholders = ",".join("?" for _ in session_ids)
    conn.execute(
        f"DELETE FROM imported_files WHERE session_id IN ({placeholders})",
        session_ids,
    )
