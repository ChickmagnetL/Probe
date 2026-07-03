"""Handle scan methods — discover pending session files incrementally.

Scan only: collect file stats, compare against imported_files table, classify
each file as pending (new/changed) or skipped (unchanged). Does not parse or
write to the DB.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from probe import platform_registry
from probe.path_utils import path_from_user_input
from probe.storage import get_connection
from probe.storage import imported_files_dao


def handle_scan_sessions(params: dict[str, Any]) -> dict[str, Any]:
    path_value = params.get("path")
    if not path_value or not isinstance(path_value, str):
        raise ValueError("path is required")

    input_path = path_from_user_input(path_value)
    platform_value = params.get("platform")
    if platform_value is not None and not isinstance(platform_value, str):
        raise ValueError("platform must be a string")
    platform = (
        platform_registry.normalize_platform(platform_value)
        or platform_registry.detect_input_platform(input_path)
    )
    scan_root = platform_registry.resolve_scan_root(platform, path_value)
    if not scan_root.is_dir():
        raise FileNotFoundError(f"scan directory does not exist: {scan_root}")

    files = platform_registry.discover_scan_files(platform, scan_root)

    conn = get_connection()
    imported_files_dao.delete_orphaned(conn, platform=platform)
    conn.commit()
    known = imported_files_dao.get_all(conn, platform=platform)

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
        "platform": platform,
        "total": len(files),
        "pending": pending,
        "pending_count": len(pending),
        "skipped": skipped,
    }


def handle_scan_codex_sessions(params: dict[str, Any]) -> dict[str, Any]:
    result = handle_scan_sessions({**params, "platform": "codex_cli"})
    result.pop("platform", None)
    return result
