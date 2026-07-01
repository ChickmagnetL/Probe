"""Handle scan_codex_sessions method — discover pending rollout files incrementally.

Scan only: collect file stats, compare against imported_files table, classify
each file as pending (new/changed) or skipped (unchanged). Does not parse or
write to the DB.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from probe.codex_adapter.reader import is_rollout_file
from probe.path_utils import path_from_user_input
from probe.storage import get_connection
from probe.storage import imported_files_dao


def handle_scan_codex_sessions(params: dict[str, Any]) -> dict[str, Any]:
    path_value = params.get("path")
    if not path_value or not isinstance(path_value, str):
        raise ValueError("path is required")

    sessions_dir = _resolve_sessions_dir(path_value)
    if not sessions_dir.is_dir():
        raise FileNotFoundError(f"sessions directory does not exist: {sessions_dir}")

    # Use rglob directly (instead of discover_rollout_files) so an empty
    # sessions directory scans cleanly to total=0 rather than raising.
    files = sorted(
        candidate.resolve()
        for candidate in sessions_dir.rglob("rollout-*.jsonl")
        if is_rollout_file(candidate)
    )

    conn = get_connection()
    imported_files_dao.delete_orphaned(conn)
    conn.commit()
    known = imported_files_dao.get_all(conn)

    pending: list[dict[str, Any]] = []
    skipped = 0
    for file_path in files:
        stat = file_path.stat()
        mtime = float(stat.st_mtime)
        size = int(stat.st_size)
        record = known.get(str(file_path))
        stored_mtime = float(record.get("mtime") or 0.0) if record else None
        stored_size = int(record.get("size") or 0) if record else None
        if stored_mtime is None or abs(stored_mtime - mtime) > 1e-6 or stored_size != size:
            pending.append({"path": str(file_path), "mtime": mtime, "size": size})
            continue
        skipped += 1

    # Sort pending by path for stable batch ordering across calls.
    pending.sort(key=lambda item: item["path"])

    return {
        "total": len(files),
        "pending": pending,
        "pending_count": len(pending),
        "skipped": skipped,
    }


def _resolve_sessions_dir(path_value: str) -> Path:
    """Resolve a Codex root path to the directory holding rollout files.

    Accepts any of:
      - the Codex root (e.g. `~/.codex`) — appends `/sessions`
      - the sessions directory itself (path ending in `sessions`)
      - any directory that directly contains rollout-*.jsonl files (used when
        the caller points at a date subdirectory like `.../2026/04/04`)

    Existence is not checked here; the caller validates.
    """
    expanded = path_from_user_input(path_value)
    if expanded.name == "sessions":
        return expanded
    sessions_subdir = expanded / "sessions"
    if sessions_subdir.is_dir():
        return sessions_subdir
    return expanded
