"""Handle list_sessions, get_session_detail, get_event_detail, and delete_sessions methods."""

from __future__ import annotations

import os
from typing import Any

from probe.storage import get_connection
from probe.storage import event_dao, imported_files_dao, rule_result_dao, session_dao


# Heavy metadata fields that are stripped from session_detail responses.
# These contain raw JSONL source data (up to 50KB each) only needed by the
# event detail inspector and are re-fetched lazily via get_event_detail.
_HEAVY_META_FIELDS = frozenset({"raw_text", "source_raw_text", "source_record"})


def _strip_heavy_fields(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Strip content and heavy metadata fields from events, keeping previews."""
    result: list[dict[str, Any]] = []
    for ev in events:
        ev = dict(ev)
        content = ev.pop("content", None)
        if content and isinstance(content, str):
            ev["content_preview"] = content[:200]
        meta = ev.get("metadata")
        if isinstance(meta, dict):
            for key in _HEAVY_META_FIELDS:
                meta.pop(key, None)
        result.append(ev)
    return result


def _build_children_tree_in_memory(
    parent_id: str,
    events_by_session: dict[str, list[dict[str, Any]]],
    children_by_parent: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    children = children_by_parent.get(parent_id, [])
    children.sort(key=lambda c: c.get("start_time") or "")
    result: list[dict[str, Any]] = []
    for child in children:
        child_events = events_by_session.get(child["id"], [])
        child_children = _build_children_tree_in_memory(child["id"], events_by_session, children_by_parent)
        result.append({**child, "events": child_events, "children": child_children})
    return result


def handle_list(params: dict[str, Any]) -> dict[str, Any]:
    conn = get_connection()
    sessions, total = session_dao.list_sessions(
        conn,
        platform=params.get("platform"),
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

    # Collect all descendant session IDs (including root) in one recursive CTE
    descendant_rows = conn.execute(
        """WITH RECURSIVE descendants AS (
               SELECT id FROM sessions WHERE id = ?
               UNION ALL
               SELECT s.id FROM sessions s
               JOIN descendants d ON s.parent_session_id = d.id
           )
           SELECT id FROM descendants""",
        (session_id,),
    ).fetchall()
    descendant_ids = [row["id"] for row in descendant_rows]

    # Fetch events for the root session only. Child session events are loaded
    # lazily when the user drills into a sub-agent (focus mode triggers a
    # separate fetchDetail call). The graph only needs child session metadata
    # (id, start_time) for sub-agent spindle marker positioning.
    root_events = event_dao.get_by_session_id(conn, session_id)
    root_events = _strip_heavy_fields(root_events)

    # Bulk-fetch all descendant session rows and build parent-to-children map
    all_descendant_sessions = session_dao.get_by_ids(conn, descendant_ids)
    children_by_parent: dict[str, list[dict[str, Any]]] = {}
    for s in all_descendant_sessions:
        parent_id = s.get("parent_session_id")
        if parent_id:
            children_by_parent.setdefault(parent_id, []).append(s)

    children_with_events = _build_children_tree_in_memory(session_id, {}, children_by_parent)

    return {"session": session, "events": root_events, "children": children_with_events}


def handle_event_detail(params: dict[str, Any]) -> dict[str, Any]:
    event_id = params.get("event_id")
    if not event_id:
        raise ValueError("event_id is required")
    conn = get_connection()
    event = event_dao.get_by_id(conn, event_id)
    if not event:
        raise KeyError(f"event not found: {event_id}")
    return event


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
