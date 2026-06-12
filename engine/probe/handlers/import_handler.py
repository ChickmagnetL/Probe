"""Handle import_files method — parse Codex CLI JSONL, persist to SQLite."""

from __future__ import annotations

import tempfile
import uuid
from pathlib import Path
from typing import Any

from probe.codex_adapter import run_codex_rollout_demo
from probe.storage import get_connection, transaction
from probe.storage import event_dao, import_dao, session_dao


def handle(params: dict[str, Any]) -> dict[str, Any]:
    input_path = params.get("input_path")
    if not input_path:
        raise ValueError("input_path is required")

    path = Path(input_path).expanduser()
    if not path.exists():
        raise FileNotFoundError(f"input path does not exist: {path}")

    with tempfile.TemporaryDirectory() as tmp_dir:
        summary = run_codex_rollout_demo(str(path), tmp_dir)

    _persist_import(summary, str(path))

    return summary


def _persist_import(summary: dict[str, Any], input_path: str) -> None:
    import_id = str(uuid.uuid4())
    sessions = summary.get("sessions", [])

    with transaction() as conn:
        for s in sessions:
            if s.get("is_synthetic"):
                continue
            session_dao.upsert(conn, _to_session_row(s))
            events = s.get("events", [])
            if events:
                # Delete existing events for this session before re-inserting
                # to prevent duplicates when the same session is imported from
                # multiple source paths (e.g. both samples/ and frontend/dist/).
                event_dao.delete_by_session_id(conn, s["session_id"])
                event_dao.insert_many(conn, _to_event_rows(events))

            # Persist synthetic preamble events (e.g. base_instructions) that
            # live only inside graph_turns[*].input_details, not in s["events"].
            for turn in s.get("graph_turns", []):
                preamble_events = [
                    d for d in turn.get("input_details", [])
                    if d.get("event_id", "").startswith("session-input:")
                ]
                if preamble_events:
                    event_dao.insert_many(conn, _to_event_rows(preamble_events))

        persisted_count = sum(1 for s in sessions if not s.get("is_synthetic"))
        import_dao.insert(conn, {
            "id": import_id,
            "input_path": input_path,
            "file_count": summary.get("total_files", 0),
            "session_count": persisted_count,
            "status": "completed",
        })


def _to_session_row(s: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": s["session_id"],
        "source_path": s.get("source_path"),
        "file_name": s.get("file_name"),
        "parent_session_id": s.get("parent_session_id"),
        "is_subagent": int(s.get("is_subagent", 0)),
        "agent_nickname": s.get("agent_nickname"),
        "agent_role": s.get("agent_role"),
        "start_time": s.get("start_time"),
        "end_time": s.get("end_time"),
        "debug_basket": s.get("debug_basket"),
    }


def _to_event_rows(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for e in events:
        rows.append({
            "event_id": e.get("event_id"),
            "session_id": e.get("session_id"),
            "kind": e.get("kind"),
            "timestamp": e.get("timestamp"),
            "role": e.get("role"),
            "phase": e.get("phase"),
            "content": e.get("content") or e.get("summary"),
            "source_line_no": e.get("source_line_no"),
            "content_parts": e.get("content_parts"),
            "title": e.get("title"),
            "summary": e.get("summary"),
            "args": e.get("args"),
            "raw_text": e.get("raw_text"),
            "event_type": e.get("event_type"),
            "detail_note": e.get("detail_note"),
            "extracted_fields": e.get("extracted_fields"),
            "extra_fields": e.get("extra_fields"),
            "child_session_id": e.get("child_session_id"),
            "prompt_preview": e.get("prompt_preview"),
        })
    return rows
