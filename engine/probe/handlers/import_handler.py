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
    }


def _to_event_rows(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for event in events:
        row = dict(event)
        # `content` is the engine-built display content; do not fall back to the
        # parser-built `summary` (removed). Empty content is preserved as-is —
        # the detail panel shows the JSONL raw line via Show Detail.
        row["content"] = event.get("content")
        row["source_line_no"] = event.get("source_line_no")
        rows.append(row)
    return rows
