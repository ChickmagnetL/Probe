"""Handle list_sessions, get_session_detail, and delete_sessions methods."""

from __future__ import annotations

import os
import sqlite3
from typing import Any

from probe.storage import get_connection
from probe.storage import event_dao, imported_files_dao, rule_result_dao, session_dao


def handle_list(params: dict[str, Any]) -> dict[str, Any]:
    conn = get_connection()
    sessions, total = session_dao.list_sessions(
        conn,
        filter_text=params.get("filter"),
        sort_by=params.get("sort", "imported_at"),
        sort_order=params.get("sort_order", "desc"),
        limit=params.get("limit", 5000),
        offset=params.get("offset", 0),
    )
    return {"sessions": sessions, "total": total}


def handle_detail(params: dict[str, Any]) -> dict[str, Any]:
    session_id = params.get("session_id")
    if not session_id:
        raise ValueError("session_id is required")

    conn = get_connection()
    session = session_dao.get_by_id(conn, session_id)
    if not session:
        raise KeyError(f"session not found: {session_id}")

    events = event_dao.get_by_session_id(conn, session_id)
    children_with_events = _children_with_events(conn, session_id)

    return {"session": session, "events": events, "children": children_with_events}


def _children_with_events(conn: sqlite3.Connection, parent_id: str) -> list[dict[str, Any]]:
    children = session_dao.get_children(conn, parent_id)
    result = []
    for child in children:
        child_events = event_dao.get_by_session_id(conn, child["id"])
        child_children = _children_with_events(conn, child["id"])
        result.append({**child, "events": child_events, "children": child_children})
    return result


def handle_delete(params: dict[str, Any]) -> dict[str, Any]:
    session_ids = params.get("session_ids")
    if not session_ids or not isinstance(session_ids, list):
        raise ValueError("session_ids is required and must be a list")

    delete_files = bool(params.get("delete_files", False))

    conn = get_connection()

    # Collect source paths before deletion if needed
    files_to_delete: list[str] = []
    if delete_files:
        for sid in session_ids:
            session = session_dao.get_by_id(conn, sid)
            if session and session.get("source_path"):
                files_to_delete.append(session["source_path"])

    # Cascade delete: rule_results → events → imported_files → sessions
    for sid in session_ids:
        rule_result_dao.delete_by_session_id(conn, sid)
        event_dao.delete_by_session_id(conn, sid)
    imported_files_dao.delete_by_session_ids(conn, session_ids)

    deleted_count = session_dao.delete_many(conn, session_ids)
    conn.commit()

    # Delete original files if requested
    deleted_files = 0
    if delete_files and files_to_delete:
        for fpath in files_to_delete:
            try:
                if os.path.isfile(fpath):
                    os.remove(fpath)
                    deleted_files += 1
                elif os.path.isdir(fpath):
                    import shutil
                    shutil.rmtree(fpath)
                    deleted_files += 1
            except OSError:
                pass  # File already gone or permission denied

    return {"deleted_sessions": deleted_count, "deleted_files": deleted_files}
