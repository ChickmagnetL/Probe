"""Handle list_sessions, get_session_detail, and delete_sessions methods."""

from __future__ import annotations

import logging
import os
import sqlite3
from typing import Any

from probe.codex_adapter import parse_codex_rollout
from probe.storage import get_connection
from probe.storage import event_dao, rule_result_dao, session_dao

logger = logging.getLogger(__name__)


def handle_list(params: dict[str, Any]) -> dict[str, Any]:
    conn = get_connection()
    sessions, total = session_dao.list_sessions(
        conn,
        filter_text=params.get("filter"),
        sort_by=params.get("sort", "imported_at"),
        sort_order=params.get("sort_order", "desc"),
        limit=params.get("limit", 100),
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
    _ensure_debug_basket(conn, session)

    events = event_dao.get_by_session_id(conn, session_id)
    children = session_dao.get_children(conn, session_id)
    children_with_events = []
    for child in children:
        child_events = event_dao.get_by_session_id(conn, child["id"])
        children_with_events.append({**child, "events": child_events})

    return {"session": session, "events": events, "children": children_with_events}


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

    # Cascade delete: rule_results → events → sessions
    for sid in session_ids:
        rule_result_dao.delete_by_session_id(conn, sid)
        event_dao.delete_by_session_id(conn, sid)

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


def _ensure_debug_basket(conn: sqlite3.Connection, session: dict[str, Any]) -> None:
    if session.get("debug_basket"):
        return

    source_path = session.get("source_path")
    if not isinstance(source_path, str) or not source_path:
        return
    if not os.path.exists(source_path):
        return

    try:
        summary = parse_codex_rollout(source_path)
    except (FileNotFoundError, OSError, ValueError) as exc:
        # Best-effort diagnostics rebuild: old imports should still open.
        logger.warning("could not rebuild debug basket for %s: %s", source_path, exc)
        return
    debug_basket = summary.get("debug_basket")
    if not isinstance(debug_basket, dict):
        return

    parsed_session_ids = {
        parsed_session.get("session_id")
        for parsed_session in summary.get("sessions", [])
        if isinstance(parsed_session, dict)
        and isinstance(parsed_session.get("session_id"), str)
    }
    session_id = session.get("id")
    if session_id not in parsed_session_ids:
        logger.warning(
            "rebuilt debug basket skipped for %s: session %s not found in %s",
            source_path,
            session_id,
            sorted(parsed_session_ids),
        )
        return

    session["debug_basket"] = debug_basket
    session_dao.update_debug_basket(conn, session_id, debug_basket)
    conn.commit()
