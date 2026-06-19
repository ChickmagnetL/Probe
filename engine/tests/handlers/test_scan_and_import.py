from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from probe.handlers import import_handler, scan_handler
from probe.storage import imported_files_dao, session_dao
from probe.storage.connection import open_connection
from probe.storage.schema import initialize_schema

SAMPLES_DIR = Path(__file__).resolve().parents[3] / "samples" / "codex-cli"


def _has_samples() -> bool:
    return SAMPLES_DIR.is_dir() and any(SAMPLES_DIR.rglob("rollout-*.jsonl"))


@pytest.fixture
def db(monkeypatch: pytest.MonkeyPatch, tmp_path):
    conn = open_connection(tmp_path / "probe.sqlite")
    initialize_schema(conn)
    # transaction() in connection.py calls the module-local get_connection(),
    # so patch probe.storage.connection.get_connection (not just the re-export).
    monkeypatch.setattr("probe.storage.connection.get_connection", lambda: conn)
    monkeypatch.setattr(scan_handler, "get_connection", lambda: conn)
    yield conn


def test_scan_requires_path(db) -> None:
    with pytest.raises(ValueError, match="path is required"):
        scan_handler.handle_scan_codex_sessions({})


def test_scan_missing_dir_raises_not_found(db, tmp_path) -> None:
    missing = tmp_path / "nope"
    with pytest.raises(FileNotFoundError):
        scan_handler.handle_scan_codex_sessions({"path": str(missing)})


def test_scan_resolves_sessions_subdir(db, tmp_path) -> None:
    sessions = tmp_path / ".codex" / "sessions"
    sessions.mkdir(parents=True)
    result = scan_handler.handle_scan_codex_sessions({"path": str(tmp_path / ".codex")})
    assert result["total"] == 0
    assert result["pending_count"] == 0
    assert result["skipped"] == 0


@pytest.mark.skipif(not _has_samples(), reason="samples/codex-cli not available")
def test_scan_all_pending_then_skipped_after_import(db, tmp_path) -> None:
    sample_files = sorted(SAMPLES_DIR.rglob("rollout-*.jsonl"))
    assert sample_files, "no rollout samples found"

    # Build a sessions-shaped directory under tmp_path with symlinks to a
    # subset of samples so the scan handler resolves `<root>/sessions`.
    codex_root = tmp_path / ".codex"
    sessions_dir = codex_root / "sessions"
    sessions_dir.mkdir(parents=True)
    chosen = sample_files[:2]
    for src in chosen:
        (sessions_dir / src.name).symlink_to(src.resolve())

    first = scan_handler.handle_scan_codex_sessions({"path": str(codex_root)})
    assert first["total"] == len(chosen)
    assert first["pending_count"] == len(chosen)
    assert first["skipped"] == 0
    assert len(first["pending"]) == first["pending_count"]
    # Pending entries carry path/mtime/size.
    entry = first["pending"][0]
    assert "path" in entry and "mtime" in entry and "size" in entry

    # Import one pending file via the batch path.
    one_path = first["pending"][0]["path"]
    batch = import_handler.handle_batch({"file_paths": [one_path]})
    assert batch["parsed_files"] == 1
    assert batch["errors"] == []
    # imported_files row recorded.
    record = imported_files_dao.get(db, one_path)
    assert record is not None
    assert record["session_id"]  # non-empty for a real rollout

    # Re-scan: that file should now be skipped.
    second = scan_handler.handle_scan_codex_sessions({"path": str(codex_root)})
    assert second["skipped"] >= 1
    remaining_pending_paths = {p["path"] for p in second["pending"]}
    assert one_path not in remaining_pending_paths


@pytest.mark.skipif(not _has_samples(), reason="samples/codex-cli not available")
def test_scan_detects_mtime_change(db, tmp_path) -> None:
    sample_files = sorted(SAMPLES_DIR.rglob("rollout-*.jsonl"))
    assert sample_files
    codex_root = tmp_path / ".codex"
    sessions_dir = codex_root / "sessions"
    sessions_dir.mkdir(parents=True)
    # Copy (not symlink) so we can safely mutate mtime.
    one_src = sample_files[0]
    one = sessions_dir / one_src.name
    one.write_bytes(one_src.read_bytes())

    # Import to mark as known.
    import_handler.handle_batch({"file_paths": [str(one)]})
    before = scan_handler.handle_scan_codex_sessions({"path": str(codex_root)})
    assert str(one) not in {p["path"] for p in before["pending"]}

    # Bump mtime forward and re-scan.
    future = time.time() + 60
    os.utime(one, (future, future))
    after = scan_handler.handle_scan_codex_sessions({"path": str(codex_root)})
    assert str(one) in {p["path"] for p in after["pending"]}


def test_batch_requires_file_paths(db) -> None:
    with pytest.raises(ValueError, match="file_paths is required"):
        import_handler.handle_batch({})


def test_batch_rejects_non_list(db) -> None:
    with pytest.raises(ValueError, match="file_paths is required"):
        import_handler.handle_batch({"file_paths": "not-a-list"})


def test_batch_rejects_missing_file(db, tmp_path) -> None:
    with pytest.raises(FileNotFoundError):
        import_handler.handle_batch({"file_paths": [str(tmp_path / "nope.jsonl")]})


@pytest.mark.skipif(not _has_samples(), reason="samples/codex-cli not available")
def test_batch_persists_sessions_and_imported_files(db, tmp_path) -> None:
    sample_files = sorted(SAMPLES_DIR.rglob("rollout-*.jsonl"))
    one_src = sample_files[0]
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    one = sessions_dir / one_src.name
    one.write_bytes(one_src.read_bytes())
    result = import_handler.handle_batch({"file_paths": [str(one)]})
    assert result["parsed_files"] == 1
    assert result["sessions_count"] >= 1
    # Sessions actually landed in the DB.
    rows, _ = session_dao.list_sessions(db, limit=1000)
    assert len(rows) >= 1
    # imported_files row.
    assert imported_files_dao.get(db, str(one)) is not None
