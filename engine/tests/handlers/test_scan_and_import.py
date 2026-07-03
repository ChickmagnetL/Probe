from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

import pytest

from probe.handlers import import_handler, scan_handler
from probe.storage import event_dao, imported_files_dao, session_dao
from probe.storage.connection import open_connection
from probe.storage.schema import initialize_schema

CODEX_SAMPLES_DIR = Path(__file__).resolve().parents[3] / "samples" / "codex-cli"
CLAUDE_SAMPLES_DIR = Path(__file__).resolve().parents[3] / "samples" / "claude-code"


def _has_codex_samples() -> bool:
    return CODEX_SAMPLES_DIR.is_dir() and any(CODEX_SAMPLES_DIR.rglob("rollout-*.jsonl"))


def _has_claude_samples() -> bool:
    return CLAUDE_SAMPLES_DIR.is_dir() and any(CLAUDE_SAMPLES_DIR.rglob("*.jsonl"))


def _copy_tree(src: Path, dest: Path) -> None:
    for source_path in src.rglob("*"):
        target_path = dest / source_path.relative_to(src)
        if source_path.is_dir():
            target_path.mkdir(parents=True, exist_ok=True)
            continue
        target_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, target_path)


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


def test_scan_accepts_file_uri_path(db, tmp_path) -> None:
    sessions = tmp_path / ".codex" / "sessions"
    sessions.mkdir(parents=True)
    result = scan_handler.handle_scan_codex_sessions(
        {"path": (tmp_path / ".codex").resolve().as_uri()}
    )
    assert result["total"] == 0
    assert result["pending_count"] == 0
    assert result["skipped"] == 0


def test_import_directory_accepts_file_uri_path(db, tmp_path) -> None:
    sessions = tmp_path / ".codex" / "sessions"
    sessions.mkdir(parents=True)
    result = import_handler.handle(
        {"input_path": (tmp_path / ".codex").resolve().as_uri()}
    )
    assert result["total_files"] == 0
    assert result["imported_session_count"] == 0
    assert result["skipped"] == 0


@pytest.mark.skipif(not _has_codex_samples(), reason="samples/codex-cli not available")
def test_scan_all_pending_then_skipped_after_import(db, tmp_path) -> None:
    sample_files = sorted(CODEX_SAMPLES_DIR.rglob("rollout-*.jsonl"))
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


@pytest.mark.skipif(not _has_codex_samples(), reason="samples/codex-cli not available")
def test_scan_detects_mtime_change(db, tmp_path) -> None:
    sample_files = sorted(CODEX_SAMPLES_DIR.rglob("rollout-*.jsonl"))
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


@pytest.mark.skipif(not _has_codex_samples(), reason="samples/codex-cli not available")
def test_batch_persists_sessions_and_imported_files(db, tmp_path) -> None:
    sample_files = sorted(CODEX_SAMPLES_DIR.rglob("rollout-*.jsonl"))
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


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_scan_sessions_detects_claude_directory_and_skips_after_import(db, tmp_path) -> None:
    claude_root = tmp_path / ".claude"
    projects_dir = claude_root / "projects"
    _copy_tree(CLAUDE_SAMPLES_DIR, projects_dir)

    first = scan_handler.handle_scan_sessions({"path": str(claude_root)})
    assert first["platform"] == "claude_code"
    assert first["total"] == 4
    assert first["pending_count"] == 4
    assert first["skipped"] == 0
    assert any("subagents" in item["path"] for item in first["pending"])

    one_path = first["pending"][0]["path"]
    batch = import_handler.handle_batch({"file_paths": [one_path]})
    assert batch["platform"] == "claude_code"
    assert batch["parsed_files"] == 1
    assert batch["errors"] == []

    record = imported_files_dao.get(db, one_path, platform="claude_code")
    assert record is not None
    assert record["platform"] == "claude_code"

    second = scan_handler.handle_scan_sessions({"path": str(claude_root)})
    assert second["platform"] == "claude_code"
    assert second["skipped"] >= 1
    assert one_path not in {item["path"] for item in second["pending"]}


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_import_claude_directory_persists_sessions_events_and_parent_links(db, tmp_path) -> None:
    claude_root = tmp_path / ".claude"
    projects_dir = claude_root / "projects"
    _copy_tree(CLAUDE_SAMPLES_DIR, projects_dir)

    result = import_handler.handle({"input_path": str(claude_root)})
    assert result["platform"] == "claude_code"
    assert result["total_files"] == 4
    assert result["imported_session_count"] == 4
    assert result["root_session_count"] == 3
    assert result["errors"] == []

    rows, total = session_dao.list_sessions(db, platform="claude_code", limit=1000)
    assert total == 4
    assert {row["platform"] for row in rows} == {"claude_code"}

    row_by_id = {row["id"]: row for row in rows}
    sidechain_id = "claude-root-tooling-session:agent:agent-sidechain-review"
    assert sidechain_id in row_by_id
    assert row_by_id[sidechain_id]["parent_session_id"] == "claude-root-tooling-session"
    assert row_by_id[sidechain_id]["is_subagent"] == 1

    tool_events = event_dao.get_by_session_id(db, "claude-root-tooling-session")
    tool_call = next(event for event in tool_events if event["kind"] == "tool_call")
    assert tool_call["metadata"]["tool_name"] == "Read"
    assert tool_call["metadata"]["source_record"]["message"]["content"][0]["cacheHint"] == "preserve-this-extra-field"
