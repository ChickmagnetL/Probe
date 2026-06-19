"""Handle import_files / import_files_batch methods — parse Codex CLI JSONL, persist to SQLite."""

from __future__ import annotations

import logging
import tempfile
import uuid
from pathlib import Path
from typing import Any

from probe.codex_adapter import run_codex_rollout_demo
from probe.storage import transaction
from probe.storage import event_dao, import_dao, imported_files_dao, session_dao

logger = logging.getLogger(__name__)


def handle(params: dict[str, Any]) -> dict[str, Any]:
    """Import a single file or a directory.

    For directories, this performs incremental import: only files not already
    tracked (or whose mtime/size changed) in `imported_files` are parsed.
    For a single file, the file is parsed and its `imported_files` record is
    upserted so subsequent scans skip it.
    """
    input_path = params.get("input_path")
    if not input_path:
        raise ValueError("input_path is required")

    path = Path(input_path).expanduser()
    if not path.exists():
        raise FileNotFoundError(f"input path does not exist: {path}")

    if path.is_dir():
        return _import_directory_incremental(path)
    return _import_files([path])


def handle_batch(params: dict[str, Any]) -> dict[str, Any]:
    """Import an explicit batch of file paths.

    Used by the frontend batch driver: it calls `scan_codex_sessions` once,
    then slices the pending list into batches and calls this method per batch.
    Each successfully parsed file gets an `imported_files` row so the next
    scan skips it. Parse failures do not abort the batch.
    """
    file_paths = params.get("file_paths")
    if not isinstance(file_paths, list) or not file_paths:
        raise ValueError("file_paths is required and must be a non-empty list")

    paths: list[Path] = []
    for entry in file_paths:
        if not isinstance(entry, str) or not entry:
            raise ValueError("each entry in file_paths must be a non-empty string")
        p = Path(entry).expanduser()
        if not p.is_file():
            raise FileNotFoundError(f"file not found: {p}")
        paths.append(p)

    return _import_files(paths)


def _import_directory_incremental(directory: Path) -> dict[str, Any]:
    # Defer to scan_handler to classify pending vs skipped. Parse the pending
    # files via the batch path so `imported_files` rows are written.
    from probe.handlers import scan_handler

    scan_result = scan_handler.handle_scan_codex_sessions({"path": str(directory)})
    pending_paths = [Path(item["path"]) for item in scan_result["pending"]]

    if not pending_paths:
        return {
            "total_files": scan_result["total"],
            "parsed_records": 0,
            "parse_errors": 0,
            "unknown_record_count": 0,
            "unknown_route_keys": [],
            "imported_session_count": 0,
            "root_session_count": 0,
            "sessions": [],
            "root_sessions": [],
            "table_counts": {},
            "skipped": scan_result["skipped"],
            "pending_count": 0,
            "errors": [],
        }

    batch_result = _import_files(pending_paths)
    return {
        "total_files": scan_result["total"],
        "parsed_records": batch_result["parsed_records"],
        "parse_errors": batch_result["parse_errors"],
        "unknown_record_count": batch_result["unknown_record_count"],
        "unknown_route_keys": batch_result["unknown_route_keys"],
        "imported_session_count": batch_result["imported_session_count"],
        "root_session_count": batch_result["root_session_count"],
        "sessions": batch_result["sessions"],
        "root_sessions": batch_result["root_sessions"],
        "table_counts": batch_result["table_counts"],
        "skipped": scan_result["skipped"],
        "pending_count": batch_result["parsed_files"],
        "errors": batch_result["errors"],
    }


def _import_files(paths: list[Path]) -> dict[str, Any]:
    """Parse `paths` together and persist results, tracking each file in imported_files."""
    # Pre-compute file stats before parsing so the recorded mtime/size reflects
    # the file as it was at import time (a parse error must still record stats
    # so a later scan can re-evaluate).
    stat_by_path: dict[str, tuple[float, int]] = {}
    for p in paths:
        stat = p.stat()
        stat_by_path[str(p.resolve())] = (float(stat.st_mtime), int(stat.st_size))

    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            summary = run_codex_rollout_demo([str(p) for p in paths], tmp_dir)
    except Exception as exc:
        # Whole-batch parse failure: surface as errors, do not crash the engine.
        logger.error("batch import parse failed: %s", exc, exc_info=True)
        return {
            "total_files": len(paths),
            "parsed_files": 0,
            "imported_session_count": 0,
            "root_session_count": 0,
            "sessions_count": 0,
            "sessions": [],
            "root_sessions": [],
            "parsed_records": 0,
            "parse_errors": len(paths),
            "unknown_record_count": 0,
            "unknown_route_keys": [],
            "table_counts": {},
            "errors": [
                {"path": str(p.resolve()), "message": str(exc)} for p in paths
            ],
        }

    _persist_import(summary, stat_by_path)

    sessions = summary.get("sessions", [])
    parsed_files = len(paths)
    return {
        "total_files": parsed_files,
        "parsed_files": parsed_files,
        "imported_session_count": summary.get("imported_session_count", 0),
        "root_session_count": summary.get("root_session_count", 0),
        "sessions_count": len([s for s in sessions if not s.get("is_synthetic")]),
        "sessions": sessions,
        "root_sessions": summary.get("root_sessions", []),
        "parsed_records": summary.get("parsed_records", 0),
        "parse_errors": summary.get("parse_errors", 0),
        "unknown_record_count": summary.get("unknown_record_count", 0),
        "unknown_route_keys": summary.get("unknown_route_keys", []),
        "table_counts": summary.get("table_counts", {}),
        "errors": [],
    }


def _persist_import(
    summary: dict[str, Any],
    stat_by_path: dict[str, tuple[float, int]],
) -> None:
    """Persist sessions/events and record each source file in imported_files.

    `stat_by_path` maps resolved source_path -> (mtime, size). Files whose
    sessions never materialize (e.g. a rollout with no conversation rows) are
    still recorded in imported_files with an empty session_id so a later scan
    can skip them.
    """
    import_id = str(uuid.uuid4())
    sessions = summary.get("sessions", [])

    # Map source_path -> first non-synthetic session_id for imported_files row.
    session_id_by_source: dict[str, str] = {}
    for s in sessions:
        if s.get("is_synthetic"):
            continue
        source_path = s.get("source_path")
        if not source_path:
            continue
        if source_path not in session_id_by_source:
            session_id_by_source[source_path] = s["session_id"]

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

        for source_path, (mtime, size) in stat_by_path.items():
            session_id = session_id_by_source.get(source_path, "")
            imported_files_dao.upsert(conn, source_path, mtime, size, session_id)

        persisted_count = sum(1 for s in sessions if not s.get("is_synthetic"))
        import_dao.insert(conn, {
            "id": import_id,
            "input_path": ",".join(sorted(stat_by_path.keys())),
            "file_count": len(stat_by_path),
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
        "title": s.get("title"),
        "cwd": s.get("cwd"),
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
