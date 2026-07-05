from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path

import pytest

from probe.claude_code_adapter.parser import (
    _parse_file,
    _tool_result_metadata,
    parse_claude_code,
)
from probe.claude_code_adapter.reader import is_claude_code_file
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


def _write_jsonl(path: Path, rows: list[dict]) -> list[str]:
    lines = [json.dumps(row, ensure_ascii=False) for row in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return lines


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


def _expected_claude_fixture_counts() -> tuple[int, int, int]:
    """Return (total_files, root_session_count, subagent_count) for the bundled samples."""
    all_files = list(CLAUDE_SAMPLES_DIR.rglob("*.jsonl"))
    subagent_files = [
        p for p in all_files if p.parent.name == "subagents" and p.name.startswith("agent-")
    ]
    total = len(all_files)
    subagents = len(subagent_files)
    # Each bundled subagent has a matching parent fixture file, so roots = total - subagents.
    return total, total - subagents, subagents


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_scan_sessions_detects_claude_directory_and_skips_after_import(db, tmp_path) -> None:
    claude_root = tmp_path / ".claude"
    projects_dir = claude_root / "projects"
    _copy_tree(CLAUDE_SAMPLES_DIR, projects_dir)

    first = scan_handler.handle_scan_sessions({"path": str(claude_root)})
    assert first["platform"] == "claude_code"
    expected_total, _, _ = _expected_claude_fixture_counts()
    assert first["total"] == expected_total
    assert first["pending_count"] == expected_total
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
    expected_total, expected_roots, _ = _expected_claude_fixture_counts()
    assert result["total_files"] == expected_total
    assert result["imported_session_count"] == expected_total
    assert result["root_session_count"] == expected_roots
    assert result["errors"] == []

    rows, total = session_dao.list_sessions(db, platform="claude_code", limit=1000)
    assert total == expected_total
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


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_every_claude_fixture_is_recognized_and_parses_without_error() -> None:
    """Baseline lock: every bundled fixture loads via reader and parses end-to-end.

    Dimension-specific field extraction is asserted in later batches; this test only
    guards against regressions in fixture shape / parser robustness so each new fixture
    added by the parity task remains parseable.
    """
    fixtures = sorted(CLAUDE_SAMPLES_DIR.rglob("*.jsonl"))
    assert fixtures, "no claude-code fixtures found"

    for fixture in fixtures:
        assert is_claude_code_file(fixture), f"fixture not recognized as claude_code: {fixture}"
        result = parse_claude_code(str(fixture))
        assert result["parse_errors"] == 0, f"parse errors in {fixture}: {result['parse_errors']}"
        assert result["imported_session_count"] == 1, (
            f"expected 1 session from {fixture}, got {result['imported_session_count']}"
        )
        assert result["sessions"][0]["events"], f"no events emitted from {fixture}"


# Parity fixtures (Batch 0): each must load + parse without raising. Map fixture
# relative path -> the set of parity dimensions it covers, so the coverage set is
# documented alongside the assertion and missing fixtures surface loudly.
_PARITY_FIXTURE_DIMENSIONS = {
    "tooling-parity/session-tooling-parity.jsonl": {
        "assistant_model_usage",
        "tool_use_edit",
        "tool_use_write",
        "tool_use_bash",
        "tool_use_read",
        "tool_use_grep",
        "tool_use_agent",
        "tool_use_mcp",
        "tool_result_ok",
        "tool_result_err",
        "tool_result_with_toolUseResult",
        "stop_reason",
    },
    "claude-tooling-parity-session/subagents/agent-sidechain-tooling.jsonl": {
        "subagent_link_child",
    },
    "system-events-parity/session-system-events-parity.jsonl": {
        "system_api_error",
        "attachment_hook_success",
        "queue_operation",
        "type_ai_title",
        "type_agent_name",
    },
    "image-parity/session-image-parity.jsonl": {
        "user_image_block",
    },
    "threading-parity/session-threading-parity.jsonl": {
        "compact_boundary_with_metadata",
        "uuid_parent_threading",
        "logical_parent_uuid_fork",
    },
}


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_parity_fixtures_present_and_parse_without_error() -> None:
    """Every parity fixture from Batch 0 must be present, recognized, and parse cleanly."""
    for relative_path, dimensions in _PARITY_FIXTURE_DIMENSIONS.items():
        fixture = CLAUDE_SAMPLES_DIR / relative_path
        assert fixture.is_file(), f"missing parity fixture: {relative_path} (covers: {sorted(dimensions)})"
        assert is_claude_code_file(fixture), f"fixture not recognized: {relative_path}"
        result = parse_claude_code(str(fixture))
        assert result["parse_errors"] == 0, (
            f"parse errors in {relative_path}: {result['parse_errors']}"
        )


# ── Batch 1: tool_call / tool_output pairing + key naming + claude_event_type ─
# Asserts against the `tooling-parity` fixture, which exercises every tool kind
# (Bash/Edit/Write/Read/Grep/Agent/mcp) plus both is_error=true (Grep) and
# is_error=false results.

# tool_use.name -> expected claude_event_type on the tool_call event. The
# native identity for a tool_call is the tool name verbatim (including the
# ``mcp__server__tool`` prefix) — no codex ``*_begin`` mapping is emitted.
_MCP_TOOL_NAME = "mcp__fast-context-mcp__fast_context_search"


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_tool_call_event_uses_codex_key_names_and_claude_event_type() -> None:
    """tool_call metadata must use `args`/`call_id`/`name` (codex contract) and
    carry ``claude_event_type`` set to the tool name verbatim. The legacy
    ``tool_input`` key and the codex ``event_type`` mapping must both be gone.
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(fixture))
    events = result["sessions"][0]["events"]
    tool_calls = {event["name"]: event for event in events if event["kind"] == "tool_call"}

    # Fixture covers every tool kind.
    assert set(tool_calls) >= {
        "Edit", "Write", "Bash", "Read", "Grep", _MCP_TOOL_NAME, "Agent"
    }

    for name, event in tool_calls.items():
        # codex-compatible key names.
        assert event["call_id"], f"missing call_id for {name}"
        assert event["name"] == name, f"missing/incorrect name for {name}"
        assert event["tool_name"] == name, (
            f"tool_name alias dropped (frontend fallback + existing tests rely on it): {name}"
        )
        # args is a JSON string (codex serializes arguments as a string).
        assert isinstance(event["args"], str), f"args must be a JSON string for {name}"
        parsed = json.loads(event["args"])
        assert isinstance(parsed, dict), f"args must decode to a dict for {name}"
        # Legacy key fully replaced.
        assert "tool_input" not in event, f"legacy tool_input still present for {name}"
        # file_path surfaces in args for file-editing tools.
        if name in {"Edit", "Write", "Read"}:
            assert "file_path" in parsed, f"expected file_path in args for {name}"
        # Native identity = tool name verbatim (claude_code-native field).
        assert event["claude_event_type"] == name, (
            f"claude_event_type must equal tool name for {name}: "
            f"{event.get('claude_event_type')!r}"
        )
        # No codex event_type mapping remains.
        assert "event_type" not in event, (
            f"codex event_type should be removed from tool_call {name}: "
            f"{event.get('event_type')!r}"
        )


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_tool_output_carries_call_id_and_is_error() -> None:
    """tool_output metadata keeps `call_id` (matching its producing tool_call) and
    `is_error`. The Grep result in the fixture is an error; the rest are not.
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(fixture))
    events = result["sessions"][0]["events"]
    tool_calls_by_id = {
        event["call_id"]: event for event in events if event["kind"] == "tool_call"
    }
    tool_outputs = [event for event in events if event["kind"] == "tool_output"]
    assert tool_outputs, "expected tool_output events in tooling-parity fixture"

    outputs_by_id = {event["call_id"]: event for event in tool_outputs}
    # Every tool_output's call_id refers back to a known tool_call.
    for call_id, output in outputs_by_id.items():
        assert call_id in tool_calls_by_id, (
            f"tool_output call_id {call_id!r} has no producing tool_call"
        )
        producing = tool_calls_by_id[call_id]
        # is_error reflects the raw tool_result flag.
        if producing["name"] == "Grep":
            assert output["is_error"] is True, "Grep result should be an error in fixture"
        else:
            assert output["is_error"] is False, (
                f"non-Grep result for {producing['name']} should not be an error"
            )


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_tool_call_cache_links_tool_result_to_producing_tool_call() -> None:
    """The call_id pairing cache (built during the session build) must map each
    tool_use.id to its producing tool_call's {name, input} so Batch 3 can pair
    tool_results back. Verified via the internal _parse_file entry point.
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    build, _ = _parse_file(fixture)
    cache = build.tool_call_cache

    # Edit's producing call_id is `call_edit_1`, which the Edit tool_result references.
    assert "call_edit_1" in cache
    entry = cache["call_edit_1"]
    assert entry["name"] == "Edit"
    assert isinstance(entry["input"], dict)
    assert entry["input"]["file_path"].endswith("claude_code_adapter/parser.py")
    assert "old_string" in entry["input"] and "new_string" in entry["input"]

    # Every tool_output's call_id is present in the cache (pairing is total over the fixture).
    result = parse_claude_code(str(fixture))
    tool_output_call_ids = {
        event["call_id"] for event in result["sessions"][0]["events"] if event["kind"] == "tool_output"
    }
    assert tool_output_call_ids.issubset(cache.keys()), (
        f"unpaired tool_output call_ids: {tool_output_call_ids - set(cache.keys())}"
    )


# ── Batch 2: per-turn model + token usage ─────────────────────────────────
# Asserts against the `tooling-parity` fixture, whose assistant rows carry
# `message.model`, full `message.usage` (input/output/cache_creation/cache_read),
# and `message.stop_reason`. Confirms claude_code mirrors codex's usage shape so
# the frontend token badge (`EventDetailContent.readEventUsage`) renders as-is.


def _assistant_events(result: dict) -> list[dict]:
    return [event for event in result["sessions"][0]["events"] if event["kind"] in {"assistant_output", "assistant_update"}]


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_assistant_event_carries_model_matching_fixture() -> None:
    """Every assistant_output/assistant_update event carries `model` from the
    row's `message.model`, so the frontend can display the per-turn model.
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(fixture))
    assistant_events = _assistant_events(result)
    assert assistant_events, "expected assistant events in tooling-parity fixture"

    for event in assistant_events:
        assert event["model"] == "claude-opus-4-8", (
            f"model mismatch on {event['kind']}/{event['event_id']}: {event.get('model')!r}"
        )
        # model also preserved in source_record.
        assert event["source_record"]["message"]["model"] == event["model"]


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_assistant_event_carries_normalized_usage_in_codex_shape() -> None:
    """`metadata.usage` mirrors codex's shape: flat token fields plus nested
    `last_token_usage` and `total_token_usage`, each with the 5 keys the
    frontend token badge reads. Values are derived from `message.usage`.
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(fixture))
    assistant_events = _assistant_events(result)
    assert assistant_events

    expected_keys = {
        "input_tokens",
        "output_tokens",
        "reasoning_output_tokens",
        "cached_input_tokens",
        "total_tokens",
    }

    # Pick the final assistant_output (line 17 in the fixture): cache_read=37460,
    # input=35560, output=19 -> exercises the cache-hit mapping + total derivation.
    final_output = next(
        event for event in reversed(assistant_events) if event["kind"] == "assistant_output"
    )
    usage = final_output["usage"]
    assert set(usage.keys()) >= expected_keys | {"last_token_usage", "total_token_usage"}
    assert set(usage["last_token_usage"].keys()) >= expected_keys
    assert set(usage["total_token_usage"].keys()) >= expected_keys

    # Derived from fixture line 17: input=35560, output=19, cache_read=37460.
    assert usage["input_tokens"] == 35560
    assert usage["output_tokens"] == 19
    assert usage["cached_input_tokens"] == 37460  # cache_read_input_tokens
    assert usage["reasoning_output_tokens"] == 0  # claude_code raw has no reasoning tokens
    assert usage["total_tokens"] == 35560 + 19  # frontend fallback convention: input + output
    # Per-event attachment: both nested objects carry this turn's values.
    assert usage["last_token_usage"]["input_tokens"] == 35560
    assert usage["total_token_usage"]["input_tokens"] == 35560


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_assistant_event_with_zero_cache_read_maps_cached_to_zero() -> None:
    """A turn with no cache activity (cache_read_input_tokens=0) must surface
    `cached_input_tokens=0` rather than dropping the field, so the badge still
    renders. Fixture line 3 is the first assistant turn with cc=0, cr=0.
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(fixture))
    first_output = next(
        event for event in _assistant_events(result) if event["kind"] == "assistant_output"
    )
    usage = first_output["usage"]
    assert usage["cached_input_tokens"] == 0
    # cache_creation_input_tokens is preserved via source_record (not dropped).
    assert usage["input_tokens"] == 34304
    assert usage["output_tokens"] == 227


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_assistant_event_carries_stop_reason_when_present() -> None:
    """`stop_reason` from `message.stop_reason` is attached to every assistant
    event. Fixture rows have tool_use (intermediate) and end_turn (final).
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(fixture))
    assistant_events = _assistant_events(result)
    stop_reasons = {event["stop_reason"] for event in assistant_events}
    assert "tool_use" in stop_reasons
    assert "end_turn" in stop_reasons


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_usage_attached_per_event_across_multi_block_row() -> None:
    """A single assistant row with multiple content blocks (fixture line 3:
    thinking + text + tool_use) produces multiple events; the row-level
    model/usage/stop_reason must be attached to each. tool_call events also
    carry them (harmless; frontend only renders the badge on assistant_*).
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(fixture))
    events = result["sessions"][0]["events"]
    # Line 3 yields an assistant_update (thinking) + assistant_output (text) +
    # tool_call, all sharing the same source_line_no and the same usage.
    line3_events = [
        event for event in events
        if event.get("source_line_no") == 3 and event["kind"] in {"assistant_update", "assistant_output", "tool_call"}
    ]
    assert {event["kind"] for event in line3_events} == {
        "assistant_update", "assistant_output", "tool_call"
    }
    for event in line3_events:
        assert event["model"] == "claude-opus-4-8"
        assert event["stop_reason"] == "tool_use"
        assert event["usage"]["input_tokens"] == 34304


# ── Batch 3: Bash/Edit/Write/mcp tool_result identity + info fields ────────
# Consumes Batch 1's tool_call_cache to lift the paired tool's rich fields onto
# the tool_output (paired tool_result) event. The native identity is always
# ``claude_event_type=tool_result``; tool-specific info (command/exit_code/
# file_path/changes/server/query) is preserved from the first round. Asserts
# against the `tooling-parity` fixture.


def _tool_outputs(result: dict) -> list[dict]:
    return [event for event in result["sessions"][0]["events"] if event["kind"] == "tool_output"]


def _find_tool_output(result: dict, tool_name: str) -> dict:
    matches = [
        event for event in _tool_outputs(result)
        if event.get("tool_name") == tool_name
    ]
    assert matches, f"no tool_output paired with a {tool_name} tool_call"
    assert len(matches) == 1, f"expected exactly one {tool_name} tool_output, got {len(matches)}"
    return matches[0]


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_bash_tool_result_emits_tool_result_with_command_exit_stdout() -> None:
    """A Bash tool_result pairs with its tool_call (via call_id) and emits
    ``claude_event_type=tool_result`` carrying command/exit_code/status/stdout
    (info fields preserved from the first round). No codex ``exec_command_end``
    event_type is emitted.
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(fixture))
    events = result["sessions"][0]["events"]
    bash_output = _find_tool_output(result, "Bash")

    assert bash_output["claude_event_type"] == "tool_result"
    assert "event_type" not in bash_output
    # command lifted from the paired tool_call's input.
    assert bash_output["command"] == (
        "python -m pytest engine/tests/handlers/test_tooling_parity.py -q"
    )
    # Fixture's Bash succeeded -> exit_code 0, status success.
    assert bash_output["is_error"] is False
    assert bash_output["exit_code"] == 0
    assert bash_output["status"] == "success"
    # stdout lifted from the row-level toolUseResult.
    assert bash_output["stdout"] == "1 passed in 0.42s"
    # call_id matches the producing Bash tool_call.
    producing = next(
        event for event in events
        if event["kind"] == "tool_call" and event["call_id"] == bash_output["call_id"]
    )
    assert producing["name"] == "Bash"


def test_bash_tool_result_error_infers_nonzero_exit_code() -> None:
    """claude_code toolUseResult carries no exit_code, so it is inferred from
    is_error: error -> non-zero (1), success -> 0. The tooling-parity fixture
    only has a successful Bash, so this is exercised via the helper directly.
    """
    error_meta = _tool_result_metadata(
        item={"tool_use_id": "call_bash_err", "content": "boom", "is_error": True},
        row={"toolUseResult": {"stdout": "boom", "stderr": ""}},
        tool_call_cache={"call_bash_err": {"name": "Bash", "input": {"command": "false"}}},
    )
    assert error_meta["claude_event_type"] == "tool_result"
    assert "event_type" not in error_meta
    assert error_meta["exit_code"] == 1
    assert error_meta["status"] == "error"
    assert error_meta["is_error"] is True
    assert error_meta["command"] == "false"
    # command_text alias is preserved (frontend summary.ts reads it for `$ `).
    assert error_meta["command_text"] == "false"
    assert error_meta["stdout"] == "boom"
    # Empty stderr is dropped (matches frontend stringOrNull treating "" as null).
    assert "stderr" not in error_meta


def test_bash_tool_result_recovers_real_exit_code_from_content() -> None:
    """Real claude_code Bash failures embed ``Exit code N\\n<stderr>`` in the
    tool_result content and omit toolUseResult entirely. The parser must
    recover the actual code (e.g. 127, not a generic 1) and route the
    stripped output to stderr so the timeline summary still shows the failure.
    Verified against real ~/.claude samples.
    """
    error_meta = _tool_result_metadata(
        item={
            "tool_use_id": "call_bash_missing",
            "content": "Exit code 127\n/bin/foo: command not found",
            "is_error": True,
        },
        row={},  # no toolUseResult (matches real error samples)
        tool_call_cache={
            "call_bash_missing": {"name": "Bash", "input": {"command": "foo --bar"}}
        },
    )
    assert error_meta["claude_event_type"] == "tool_result"
    # Real code recovered, not the inferred 1.
    assert error_meta["exit_code"] == 127
    assert error_meta["status"] == "error"
    assert error_meta["command"] == "foo --bar"
    assert error_meta["command_text"] == "foo --bar"
    # No toolUseResult -> content used as fallback; "Exit code 127" prefix
    # stripped and routed to stderr (is_error=True).
    assert error_meta["stderr"] == "/bin/foo: command not found"
    assert "stdout" not in error_meta


def test_bash_tool_result_falls_back_to_content_stdout_when_no_tool_use_result() -> None:
    """A successful Bash with no toolUseResult falls back to the content text
    as stdout so the timeline summary still surfaces the output.
    """
    ok_meta = _tool_result_metadata(
        item={"tool_use_id": "call_bash_ok", "content": "total 32\ndrwxr-xr-x ...", "is_error": False},
        row={},
        tool_call_cache={"call_bash_ok": {"name": "Bash", "input": {"command": "ls -la"}}},
    )
    assert ok_meta["claude_event_type"] == "tool_result"
    assert ok_meta["exit_code"] == 0
    assert ok_meta["stdout"] == "total 32\ndrwxr-xr-x ..."
    assert "stderr" not in ok_meta


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_edit_tool_result_emits_tool_result_with_old_new() -> None:
    """An Edit tool_result emits ``claude_event_type=tool_result`` with
    file_path, old_string/new_string, and a single-element ``changes`` list
    (info fields preserved from the first round).
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(fixture))
    edit_output = _find_tool_output(result, "Edit")

    assert edit_output["claude_event_type"] == "tool_result"
    assert "event_type" not in edit_output
    assert edit_output["file_path"].endswith("claude_code_adapter/parser.py")
    assert edit_output["old_string"] == '    "tool_input": item.get("input"),'
    assert edit_output["new_string"] == (
        '    "args": json.dumps(item.get("input"), ensure_ascii=False),'
    )
    assert edit_output["status"] == "success"
    assert isinstance(edit_output["changes"], list)
    assert len(edit_output["changes"]) == 1
    assert edit_output["changes"][0]["file_path"] == edit_output["file_path"]
    assert edit_output["changes"][0]["old_string"] == edit_output["old_string"]


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_write_tool_result_emits_tool_result_with_content_preview() -> None:
    """A Write tool_result emits ``claude_event_type=tool_result`` with
    file_path and a truncated content preview inside ``changes``.
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(fixture))
    write_output = _find_tool_output(result, "Write")

    assert write_output["claude_event_type"] == "tool_result"
    assert "event_type" not in write_output
    assert write_output["file_path"].endswith("test_tooling_parity.py")
    assert write_output["status"] == "success"
    assert "parse_claude_code" in write_output["content"]
    assert len(write_output["changes"]) == 1
    assert write_output["changes"][0]["content"] == write_output["content"]


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_mcp_tool_result_emits_tool_result_with_server_and_tool() -> None:
    """An mcp tool_result emits ``claude_event_type=tool_result`` with server
    and the bare tool_name parsed from the ``mcp__<server>__<tool>`` call name
    (info fields preserved from the first round).
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(fixture))
    mcp_output = next(
        event for event in _tool_outputs(result)
        if event.get("server") == "fast-context-mcp"
    )

    assert mcp_output["claude_event_type"] == "tool_result"
    assert "event_type" not in mcp_output
    assert mcp_output["server"] == "fast-context-mcp"
    # Raw mcp__ name is replaced with the bare tool for display.
    assert mcp_output["tool_name"] == "fast_context_search"
    assert mcp_output["status"] == "success"


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_tool_output_call_id_matches_producing_tool_call() -> None:
    """Every tool_output's call_id resolves to a producing tool_call with the
    same id (the pairing consumed from Batch 1's tool_call_cache).
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(fixture))
    events = result["sessions"][0]["events"]
    tool_calls_by_id = {
        event["call_id"]: event for event in events if event["kind"] == "tool_call"
    }
    tool_outputs = _tool_outputs(result)
    assert tool_outputs

    for output in tool_outputs:
        assert output["call_id"] in tool_calls_by_id, (
            f"tool_output call_id {output['call_id']!r} has no producing tool_call"
        )


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_generic_tool_results_carry_tool_result_identity() -> None:
    """Tools with no rich info fields (Read/Grep) still carry the unified
    ``claude_event_type=tool_result`` identity and the is_error/status fields.
    No codex ``event_type`` is emitted. Grep is an error in the fixture.
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(fixture))

    read_output = _find_tool_output(result, "Read")
    assert read_output["claude_event_type"] == "tool_result"
    assert "event_type" not in read_output
    assert read_output["is_error"] is False
    assert read_output["status"] == "success"

    grep_output = _find_tool_output(result, "Grep")
    assert grep_output["claude_event_type"] == "tool_result"
    assert "event_type" not in grep_output
    assert grep_output["is_error"] is True
    assert grep_output["status"] == "error"


# ── Batch 4: session-level fields (title / cli_version / agent_nickname) ────
# + uuid topological sort. Asserts against the `system-events-parity` fixture
# (carries ai-title + agent-name + version on every row) and the `threading-parity`
# fixture (uuid/parentUuid chain + compact_boundary fork via logicalParentUuid).
# The `root-basic` fixture has no ai-title so the title fallback to first user
# input is exercised there.


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_session_title_prefers_ai_title_when_present() -> None:
    """`sessions.title` is the AI-generated `aiTitle` from a `type=ai-title`
    row when present (replaces the legacy "first user input" heuristic)."""
    fixture = CLAUDE_SAMPLES_DIR / "system-events-parity" / "session-system-events-parity.jsonl"
    result = parse_claude_code(str(fixture))
    assert result["sessions"][0]["title"] == "Claude Code parser parity batch 0"


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_session_title_falls_back_to_first_user_input_when_no_ai_title() -> None:
    """Without an ai-title row, title falls back to the first user_input
    content (truncated). root-basic has no ai-title.
    """
    fixture = CLAUDE_SAMPLES_DIR / "root-basic" / "session-root-basic.jsonl"
    result = parse_claude_code(str(fixture))
    assert result["sessions"][0]["title"] == "Summarize the parser change request."


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_session_cli_version_surfaced_from_top_level_version_field() -> None:
    """`cli_version` mirrors codex's summary-only field: surfaced on the
    serialized session dict (NOT persisted — sessions table has no column, same
    as codex). Derived from the top-level `version` field present on every row.
    """
    fixture = CLAUDE_SAMPLES_DIR / "system-events-parity" / "session-system-events-parity.jsonl"
    result = parse_claude_code(str(fixture))
    assert result["sessions"][0]["cli_version"] == "2.1.177"

    # Different fixture carries a different version -> not hard-coded.
    root_basic = CLAUDE_SAMPLES_DIR / "root-basic" / "session-root-basic.jsonl"
    root_result = parse_claude_code(str(root_basic))
    assert root_result["sessions"][0]["cli_version"] == "2.2.0"


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_session_agent_nickname_from_agent_name_record() -> None:
    """When a `type=agent-name` row exists, its `agentName` is promoted to
    `sessions.agent_nickname` (the column exists; previously only populated from
    the rare top-level `agentId` field on sidechain rows). The agentId-based
    fallback still applies when agent-name is absent.
    """
    fixture = CLAUDE_SAMPLES_DIR / "system-events-parity" / "session-system-events-parity.jsonl"
    result = parse_claude_code(str(fixture))
    assert result["sessions"][0]["agent_nickname"] == "parity-fixture-builder"


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_agent_name_and_queue_operation_no_longer_counted_as_unknown() -> None:
    """agent-name produces a clean graph_hidden system_event (promoted to
    session.agent_nickname in Batch 4). queue-operation is handled in Batch 5
    (emits a user_input). Neither counts as unknown anymore — the
    system-events-parity fixture now parses with zero unknown records.
    """
    fixture = CLAUDE_SAMPLES_DIR / "system-events-parity" / "session-system-events-parity.jsonl"
    result = parse_claude_code(str(fixture))
    assert result["unknown_record_count"] == 0
    assert result["unknown_route_keys"] == []


# ── Batch 4: uuid topological sort ─────────────────────────────────────────
# The threading-parity fixture has a pre-compaction chain, a compact_boundary
# fork (parentUuid=null, logicalParentUuid=thr_a2), and a post-compaction chain.
# Sort must follow the uuid DAG with the compact_boundary placed AFTER its
# logicalParentUuid anchor (not as a session root at the front).


def _threaded_uuids(result: dict) -> list[str]:
    """Unique uuid order of threaded events (those whose source row carries a
    uuid), in the order they first appear in the sorted events list. Multiple
    events from the same row share a uuid; only the first is kept so this
    reflects the row/thread ordering rather than per-block emission.
    """
    seen: list[str] = []
    for event in result["sessions"][0]["events"]:
        source_record = event.get("source_record")
        if not isinstance(source_record, dict):
            continue
        uuid = source_record.get("uuid")
        if isinstance(uuid, str) and uuid and uuid not in seen:
            seen.append(uuid)
    return seen


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_threading_fixture_events_ordered_by_uuid_chain() -> None:
    """Events follow the parentUuid/uuid DAG: pre-compaction chain, then the
    compact_boundary (forked from thr_a2 via logicalParentUuid), then the
    post-compaction chain. The compaction fork must not jump to the front even
    though its parentUuid is null.
    """
    fixture = CLAUDE_SAMPLES_DIR / "threading-parity" / "session-threading-parity.jsonl"
    result = parse_claude_code(str(fixture))
    uuids = _threaded_uuids(result)

    expected = ["thr_u1", "thr_a1", "thr_u2", "thr_a2", "thr_cb", "thr_u3", "thr_a3"]
    assert uuids == expected, f"uuid chain order mismatch: got {uuids}"


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_threading_fixture_metadata_without_uuid_sorts_to_front() -> None:
    """Metadata rows without a uuid (ai-title, mode, last-prompt) have no
    timestamp either, so they sort to the front (rank -1) by (timestamp,
    source_line_no). They must not be interleaved into the threaded chain.
    """
    fixture = CLAUDE_SAMPLES_DIR / "threading-parity" / "session-threading-parity.jsonl"
    result = parse_claude_code(str(fixture))
    events = result["sessions"][0]["events"]

    # First three events are the metadata rows (ai-title line 1, mode line 2,
    # last-prompt line 10) — all source_record.uuid is absent.
    first_three = events[:3]
    for event in first_three:
        assert not isinstance(event.get("source_record"), dict) or not event["source_record"].get("uuid")
    # Their record types match the metadata-only rows in fixture order.
    assert [event["source_record"]["type"] for event in first_three] == [
        "ai-title",
        "mode",
        "last-prompt",
    ]
    # First threaded event follows metadata.
    assert events[3]["source_record"]["uuid"] == "thr_u1"


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_threading_fixture_compact_boundary_carries_logical_parent_link() -> None:
    """Sanity: the compact_boundary event is in the output and its source row
    carries the logicalParentUuid=thr_a2 link that the sort consumes.
    """
    fixture = CLAUDE_SAMPLES_DIR / "threading-parity" / "session-threading-parity.jsonl"
    result = parse_claude_code(str(fixture))
    compact_events = [
        event for event in result["sessions"][0]["events"]
        if event.get("kind") == "compaction_event"
    ]
    assert len(compact_events) == 1
    compact = compact_events[0]
    assert compact["source_record"]["parentUuid"] is None
    assert compact["source_record"]["logicalParentUuid"] == "thr_a2"
    assert compact["source_record"]["uuid"] == "thr_cb"


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_threading_fixture_compact_boundary_emits_compact_boundary_metadata() -> None:
    """compact_boundary -> claude_event_type=compact_boundary + token counts.

    Carries ``summary``/``original_token_count``/``compacted_token_count`` (info
    fields preserved from the first round) so the frontend compaction card
    renders. ``trigger``/``preserved_uuids`` are surfaced from
    ``compactMetadata`` for parity. Token counts map from preTokens/postTokens.
    No codex ``context_compacted`` event_type is emitted.
    """
    fixture = CLAUDE_SAMPLES_DIR / "threading-parity" / "session-threading-parity.jsonl"
    result = parse_claude_code(str(fixture))
    compact_events = [
        event for event in result["sessions"][0]["events"]
        if event.get("kind") == "compaction_event"
    ]
    assert len(compact_events) == 1
    compact = compact_events[0]

    # Native identity + preserved info fields.
    assert compact["claude_event_type"] == "compact_boundary"
    assert "event_type" not in compact
    assert compact["original_token_count"] == 290256  # compactMetadata.preTokens
    assert compact["compacted_token_count"] == 15567  # compactMetadata.postTokens
    assert compact["summary"] == "Conversation compacted"  # frontend reads meta.summary

    # claude_code-specific fields surfaced from compactMetadata.
    assert compact["trigger"] == "manual"
    assert compact["preserved_uuids"] == ["thr_u1", "thr_a1", "thr_u2", "thr_a2"]

    # source_record is preserved (raw blob untouched for re-parse / audit).
    assert compact["source_record"]["subtype"] == "compact_boundary"


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_tooling_fixture_linear_chain_order_preserved() -> None:
    """Regression guard: the tooling-parity fixture has a linear chain
    u1 -> a1 -> u2 -> a2 -> ... -> u8 -> a8 (user/assistant interleaved).
    Topological sort must preserve that exact order (Kahn's with timestamp
    tiebreak == DFS on a linear chain).
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(fixture))
    uuids = _threaded_uuids(result)
    expected = [uuid for i in range(1, 9) for uuid in (f"u{i}", f"a{i}")]
    assert uuids == expected


# ── Batch 4 (out-of-scope fix): session metrics block ──────────────────────
# claude_code sessions previously carried no `metrics`, which crashed the
# frontend ImportModal reduce (it reads `s.metrics.total_input_tokens` for
# every session). The metrics block is derived by aggregating per-event usage,
# mirroring codex's shape.


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_session_metrics_block_aggregates_per_event_usage() -> None:
    """`metrics` sums each assistant ROW's normalized usage. tooling-parity has
    8 assistant rows whose usage is attached per-event (Batch 2) — including
    rows that emit ONLY a tool_call event (no text/thinking block). A row with
    multiple blocks attaches the same usage to each emitted event, so totals
    dedupe by source_line_no to avoid multi-counting.
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(fixture))
    metrics = result["sessions"][0]["metrics"]

    # Sum one usage per source line across ALL usage-bearing events (mirrors
    # _calculate_session_metrics' dedupe).
    seen_lines: set[int] = set()
    expected_input = 0
    expected_output = 0
    last_input = 0
    last_output = 0
    for event in result["sessions"][0]["events"]:
        line_no = event.get("source_line_no")
        if not isinstance(line_no, int) or line_no in seen_lines:
            continue
        usage = event.get("usage")
        if not isinstance(usage, dict):
            continue
        seen_lines.add(line_no)
        expected_input += usage["input_tokens"]
        expected_output += usage["output_tokens"]
        last_input = usage["input_tokens"]
        last_output = usage["output_tokens"]

    assert metrics["total_input_tokens"] == expected_input
    assert metrics["total_output_tokens"] == expected_output
    assert metrics["total_tokens"] == expected_input + expected_output
    assert metrics["last_input_tokens"] == last_input
    assert metrics["last_output_tokens"] == last_output
    # node_count mirrors codex.
    assert metrics["node_count"] == len(result["sessions"][0]["events"])


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_session_metrics_shape_matches_codex_contract() -> None:
    """The metrics block must carry exactly the keys codex emits so the frontend
    ``SessionMetrics`` type (which declares every field as required) is
    satisfied. Missing any field would surface as ``undefined`` downstream;
    extra keys are tolerated but kept off to stay 1:1 with codex.
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    metrics = parse_claude_code(str(fixture))["sessions"][0]["metrics"]

    expected_keys = {
        "total_input_tokens",
        "total_output_tokens",
        "total_reasoning_output_tokens",
        "total_cached_input_tokens",
        "total_tokens",
        "last_input_tokens",
        "last_output_tokens",
        "last_reasoning_output_tokens",
        "last_cached_input_tokens",
        "last_total_tokens",
        "node_count",
        "display_node_count",
        "session_count",
        "imported_file_count",
        "elapsed_sec",
        "task_elapsed_sec",
        "start_time",
        "end_time",
    }
    assert set(metrics.keys()) == expected_keys, (
        f"metrics shape drift: extra={set(metrics) - expected_keys}, "
        f"missing={expected_keys - set(metrics)}"
    )
    # claude_code has no task_complete lifecycle event -> null (matches codex's
    # null when no task_complete row exists).
    assert metrics["task_elapsed_sec"] is None
    # elapsed_sec is a non-negative float (wall-clock span start->end).
    assert isinstance(metrics["elapsed_sec"], (int, float))
    assert metrics["elapsed_sec"] >= 0


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_session_metrics_no_double_count_for_multi_block_assistant_row() -> None:
    """Worked example proving dedupe: tooling-parity line 3 emits thinking +
    text + tool_use events, all sharing source_line_no=3 and the same usage
    (input=34304, output=227). The session metrics must count that row exactly
    ONCE — summing per-event would triple-count its input.
    """
    fixture = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(fixture))
    events = result["sessions"][0]["events"]
    metrics = result["sessions"][0]["metrics"]

    line3_usage_events = [
        event for event in events
        if event.get("source_line_no") == 3 and isinstance(event.get("usage"), dict)
    ]
    assert len(line3_usage_events) == 3, (
        f"expected 3 events from line 3 (thinking+text+tool_use), got {len(line3_usage_events)}"
    )
    line3_input = line3_usage_events[0]["usage"]["input_tokens"]
    assert line3_input == 34304

    # Per-row sum: line 3 counted once. Compute the arithmetic sum of distinct
    # assistant rows' input and compare to metrics total.
    seen: set[int] = set()
    expected_total_input = 0
    for event in events:
        line_no = event.get("source_line_no")
        if (
            isinstance(line_no, int)
            and line_no not in seen
            and isinstance(event.get("usage"), dict)
        ):
            seen.add(line_no)
            expected_total_input += event["usage"]["input_tokens"]
    # Triple-counting line 3 would inflate by 2 * 34304 = 68608.
    assert metrics["total_input_tokens"] == expected_total_input
    assert metrics["total_input_tokens"] < expected_total_input + 68608


# ── Batch 5: remaining event types (api_error / hook / queue / image / subagent)
# Asserts against the `system-events-parity` fixture (api_error, hook_success,
# queue-operation, ai-title, agent-name), the `image-parity` fixture (user
# image block), and the `tooling-parity` + `agent-sidechain-tooling` pair
# (subagent_session synthesis). Each previously-unhandled record kind now
# carries a claude_code-native ``claude_event_type`` identity plus the info
# fields extracted in the first round, and must no longer surface in
# ``unknown_route_keys``.


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_api_error_routes_to_api_error_identity_with_retry_fields() -> None:
    """``system subtype=api_error`` emits ``claude_event_type=api_error`` with
    message + error_type + retry fields (info preserved from the first round).
    No codex ``event_type=error`` is emitted. Fixture line 9 carries a 429 with
    retryAttempt=1, maxRetries=10, retryInMs=603.77.
    """
    fixture = CLAUDE_SAMPLES_DIR / "system-events-parity" / "session-system-events-parity.jsonl"
    result = parse_claude_code(str(fixture))
    events = result["sessions"][0]["events"]
    api_errors = [e for e in events if e.get("claude_event_type") == "api_error"]
    assert len(api_errors) == 1
    event = api_errors[0]
    assert event["kind"] == "system_event"
    assert "event_type" not in event
    # message + error_type preserved.
    assert event["message"] == "429 Request limit reached: max 15 requests per minute"
    assert event["error_type"] == "api_error"  # no error.kind in fixture -> default
    # Retry context lifted from row-level retryAttempt/maxRetries/retryInMs.
    assert event["retry_attempt"] == 1
    assert event["max_retries"] == 10
    assert event["retry_in_ms"] == 603.77
    # system_subtype preserved for any detail renderer that keys on it.
    assert event["system_subtype"] == "api_error"


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_hook_success_attachment_promotes_to_hook_identity() -> None:
    """An ``attachment.hook_success`` row (previously hidden metadata) promotes
    to a visible ``system_event`` with ``claude_event_type=hook`` carrying
    hook_name/command/exit_code/duration_ms/stdout (info preserved from the
    first round). No codex ``hook_completed`` event_type is emitted. Fixture
    line 6 is a SessionStart hook with exitCode=0, durationMs=710.
    """
    fixture = CLAUDE_SAMPLES_DIR / "system-events-parity" / "session-system-events-parity.jsonl"
    result = parse_claude_code(str(fixture))
    events = result["sessions"][0]["events"]
    hooks = [e for e in events if e.get("claude_event_type") == "hook"]
    assert len(hooks) == 1
    event = hooks[0]
    assert event["kind"] == "system_event"
    assert "event_type" not in event
    assert event.get("graph_hidden") is not True
    assert event["attachment_type"] == "hook_success"
    assert event["hook_name"] == "SessionStart:clear"
    # hookEvent -> hook_type (frontend "Type" field).
    assert event["hook_type"] == "SessionStart"
    assert event["command"] == "python3 .claude/hooks/session-start.py"
    assert event["exit_code"] == 0
    assert event["duration_ms"] == 710
    assert "Loaded trellis context." in event["stdout"]


def test_session_context_hooks_stay_visible_with_native_details(tmp_path) -> None:
    """SessionStart context hooks stay visible like other hook attachments.

    Real latest Claude rows emit both a ``hook_success`` whose stdout JSON
    carries ``hookSpecificOutput`` context and a paired
    ``hook_additional_context`` row. They should not be hidden; graph layout
    connects their no-anchor startup turn into the following user anchor.
    """
    fixture = tmp_path / "session-context-hook.jsonl"
    context_text = (
        "<session-context>\n"
        "Trellis compact SessionStart context.\n"
        "Known metadata for the model."
    )
    stdout_payload = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context_text,
        },
        "additional_context": context_text,
    }
    rows: list[dict] = [
        {
            "type": "attachment",
            "attachment": {
                "type": "hook_success",
                "hookName": "SessionStart:startup",
                "hookEvent": "SessionStart",
                "command": "python3 .claude/hooks/session-start.py",
                "content": "",
                "stdout": json.dumps(stdout_payload),
                "stderr": "",
                "exitCode": 0,
                "durationMs": 710,
            },
            "timestamp": "2026-07-05T10:04:00.000Z",
            "sessionId": "session-context-hook-session",
        },
        {
            "type": "attachment",
            "attachment": {
                "type": "hook_additional_context",
                "hookName": "SessionStart",
                "hookEvent": "SessionStart",
                "content": [context_text],
            },
            "timestamp": "2026-07-05T10:04:01.000Z",
            "sessionId": "session-context-hook-session",
        },
        {
            "parentUuid": None,
            "isSidechain": False,
            "type": "user",
            "message": {"role": "user", "content": "Start the task."},
            "uuid": "u1",
            "timestamp": "2026-07-05T10:04:02.000Z",
            "sessionId": "session-context-hook-session",
        },
    ]
    lines = _write_jsonl(fixture, rows)

    result = parse_claude_code(str(fixture))

    assert result["unknown_record_count"] == 0
    assert result["unknown_route_keys"] == []
    events = result["sessions"][0]["events"]
    success_events = [
        event for event in events
        if event.get("attachment_type") == "hook_success"
    ]
    assert len(success_events) == 1
    success_event = success_events[0]
    assert success_event["kind"] == "system_event"
    assert success_event["phase"] == "system"
    assert success_event.get("graph_hidden") is not True
    assert success_event["claude_event_type"] == "hook"
    assert success_event["raw_content_type"] == "attachment"
    assert success_event["hook_name"] == "SessionStart:startup"
    assert success_event["hook_type"] == "SessionStart"
    assert success_event["command"] == "python3 .claude/hooks/session-start.py"
    assert success_event["exit_code"] == 0
    assert success_event["duration_ms"] == 710
    assert success_event["content"] == "SessionStart:startup"
    assert "Trellis compact SessionStart context" in success_event["stdout"]
    assert success_event["source_record"] == rows[0]
    assert success_event["source_raw_text"] == lines[0]

    context_events = [
        event for event in events
        if event.get("attachment_type") == "hook_additional_context"
    ]
    assert len(context_events) == 1
    context_event = context_events[0]
    assert context_event["kind"] == "system_event"
    assert context_event["phase"] == "system"
    assert context_event.get("graph_hidden") is not True
    assert context_event["claude_event_type"] == "hook"
    assert context_event["raw_content_type"] == "attachment"
    assert context_event["hook_type"] == "SessionStart"
    assert context_event["content"] == "SessionStart"
    assert "Trellis compact SessionStart context" in context_event["message"]
    assert context_event["source_record"] == rows[1]
    assert context_event["source_raw_text"] == lines[1]

    visible_hooks = [
        event for event in events
        if event.get("claude_event_type") == "hook" and event.get("graph_hidden") is not True
    ]
    assert len(visible_hooks) == 2


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_queue_operation_emits_user_input_with_queued_content() -> None:
    """``type=queue-operation`` emits a ``user_input`` event whose content is
    the queued prompt (was "Unhandled Claude record"). Fixture line 8 enqueues
    a follow-up message.
    """
    fixture = CLAUDE_SAMPLES_DIR / "system-events-parity" / "session-system-events-parity.jsonl"
    result = parse_claude_code(str(fixture))
    events = result["sessions"][0]["events"]
    queued = [
        e for e in events
        if e.get("kind") == "user_input"
        and e.get("raw_content_type") == "queue-operation"
    ]
    assert len(queued) == 1
    event = queued[0]
    assert event["content"] == "Also confirm hook_completed shows stdout/exit_code."
    assert event["queue_operation"] == "enqueue"
    assert "queue-operation" not in result["unknown_route_keys"]


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_non_hook_attachment_stays_hidden_with_native_identity() -> None:
    """Attachment kinds other than hook_success/hook_additional_context remain
    hidden metadata (e.g. skill_listing) but carry their attachment.type as the
    ``claude_event_type`` native identity. They must NOT promote to the visible
    ``hook`` identity. The sidechain fixture has a skill_listing attachment.
    """
    fixture = (
        CLAUDE_SAMPLES_DIR
        / "claude-tooling-parity-session"
        / "subagents"
        / "agent-sidechain-tooling.jsonl"
    )
    result = parse_claude_code(str(fixture))
    events = result["sessions"][0]["events"]
    hook_events = [e for e in events if e.get("claude_event_type") == "hook"]
    assert hook_events == [], "skill_listing attachment must not promote to hook"

    # The skill_listing attachment carries its native identity verbatim.
    skill_listings = [
        e for e in events
        if e.get("raw_record_type") == "attachment"
        and e.get("attachment_type") == "skill_listing"
    ]
    assert skill_listings, "expected a skill_listing attachment in sidechain fixture"
    skill = skill_listings[0]
    assert skill["claude_event_type"] == "skill_listing"
    assert skill["graph_hidden"] is True


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_user_image_block_emits_image_event() -> None:
    """A user content ``image`` block emits kind=``input_image`` with
    ``claude_event_type=image`` and ``media_type`` (base64 data NOT stored, info
    field preserved from the first round). No codex ``input_image`` event_type
    is emitted. Fixture line 3 pastes an image/jpeg.
    """
    fixture = CLAUDE_SAMPLES_DIR / "image-parity" / "session-image-parity.jsonl"
    result = parse_claude_code(str(fixture))
    events = result["sessions"][0]["events"]
    image_events = [e for e in events if e.get("kind") == "input_image"]
    assert len(image_events) == 1
    event = image_events[0]
    assert event["claude_event_type"] == "image"
    assert "event_type" not in event
    assert event["media_type"] == "image/jpeg"
    assert event["detail_note"] == "image/jpeg"
    # Content is a placeholder label, NOT the base64 data.
    assert "pasted image" in event["content"]
    assert "PLACEHOLDER" not in event["content"]
    # The extracted metadata fields must NOT carry the base64 payload (it would
    # bloat the events row). source_record/source_raw_text still preserve the
    # raw row per the parity contract — that's expected and separate.
    extracted_keys = {
        k: v for k, v in event.items()
        if k not in {"source_record", "source_raw_text"}
    }
    assert "data" not in extracted_keys
    assert "UExBQ0VIT0xERVItSU1BR0UtREFUQS" not in json.dumps(extracted_keys)
    # No longer counted as an unknown user content block.
    assert "user:image" not in result["unknown_route_keys"]


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_system_events_fixture_has_no_unknown_records() -> None:
    """After Batch 5, every record kind in the system-events-parity fixture
    routes cleanly: api_error -> api_error, hook_success -> hook,
    queue-operation -> user_input, ai-title/agent-name/mode/permission-mode ->
    hidden metadata. unknown_route_keys must be empty.
    """
    fixture = CLAUDE_SAMPLES_DIR / "system-events-parity" / "session-system-events-parity.jsonl"
    result = parse_claude_code(str(fixture))
    assert result["unknown_record_count"] == 0
    assert result["unknown_route_keys"] == []


def test_claude_file_beginning_with_summary_is_recognized_and_parses(tmp_path) -> None:
    """A `type=summary` first row is a Claude Code metadata row, not unknown
    and not a user prompt. Its raw JSONL line is preserved for Show Detail.
    """
    fixture = tmp_path / "summary-first.jsonl"
    lines = _write_jsonl(
        fixture,
        [
            {
                "type": "summary",
                "leafUuid": "leaf-123",
                "summary": "Previous compacted conversation",
                "sessionId": "summary-first-session",
            },
            {
                "parentUuid": None,
                "isSidechain": False,
                "type": "user",
                "message": {"role": "user", "content": "Continue the work."},
                "uuid": "u1",
                "timestamp": "2026-07-05T10:00:00.000Z",
                "sessionId": "summary-first-session",
            },
        ],
    )

    assert is_claude_code_file(fixture)
    result = parse_claude_code(str(fixture))

    assert result["parse_errors"] == 0
    assert result["unknown_record_count"] == 0
    assert result["unknown_route_keys"] == []
    events = result["sessions"][0]["events"]
    summary = next(event for event in events if event["raw_record_type"] == "summary")
    assert summary["kind"] == "system_event"
    assert summary["graph_hidden"] is True
    assert summary["claude_event_type"] == "summary"
    assert summary["leaf_uuid"] == "leaf-123"
    assert summary["summary"] == "Previous compacted conversation"
    assert summary["source_raw_text"] == lines[0]
    assert not [
        event for event in events
        if event["kind"] == "user_input" and event["content"] == "Previous compacted conversation"
    ]


def test_is_compact_summary_user_row_is_not_user_prompt(tmp_path) -> None:
    """`user` rows with isCompactSummary=true carry compaction context and
    must not render as ordinary user_input events or unknown routes.
    """
    fixture = tmp_path / "compact-summary-user.jsonl"
    _write_jsonl(
        fixture,
        [
            {
                "parentUuid": "a1",
                "isSidechain": False,
                "type": "user",
                "isCompactSummary": True,
                "message": {"role": "user", "content": "Condensed prior context."},
                "uuid": "u-compact",
                "timestamp": "2026-07-05T10:01:00.000Z",
                "sessionId": "compact-summary-session",
            }
        ],
    )

    result = parse_claude_code(str(fixture))

    assert result["parse_errors"] == 0
    assert result["unknown_record_count"] == 0
    events = result["sessions"][0]["events"]
    assert not [event for event in events if event["kind"] == "user_input"]
    compact_summary = events[0]
    assert compact_summary["kind"] == "compaction_event"
    assert compact_summary["graph_hidden"] is True
    assert compact_summary["claude_event_type"] == "compact_summary"
    assert compact_summary["summary"] == "Condensed prior context."


def test_microcompact_boundary_routes_as_compaction_event(tmp_path) -> None:
    fixture = tmp_path / "microcompact.jsonl"
    _write_jsonl(
        fixture,
        [
            {
                "parentUuid": "a1",
                "logicalParentUuid": "a1",
                "uuid": "mc1",
                "type": "system",
                "subtype": "microcompact_boundary",
                "content": "Microcompact completed",
                "compactMetadata": {
                    "preTokens": 12000,
                    "postTokens": 8000,
                    "trigger": "automatic",
                },
                "timestamp": "2026-07-05T10:02:00.000Z",
                "sessionId": "microcompact-session",
            }
        ],
    )

    result = parse_claude_code(str(fixture))

    assert result["unknown_record_count"] == 0
    event = result["sessions"][0]["events"][0]
    assert event["kind"] == "compaction_event"
    assert event["claude_event_type"] == "compact_boundary"
    assert event["system_subtype"] == "microcompact_boundary"
    assert event["original_token_count"] == 12000
    assert event["compacted_token_count"] == 8000
    assert event["trigger"] == "automatic"


def test_stop_hook_summary_and_hook_callback_are_known_system_subtypes(tmp_path) -> None:
    fixture = tmp_path / "stop-hook-summary.jsonl"
    _write_jsonl(
        fixture,
        [
            {
                "type": "system",
                "subtype": "stop_hook_summary",
                "hookCount": 2,
                "hookInfos": [{"command": "python hook.py", "durationMs": 44}],
                "hookErrors": ["blocked"],
                "preventedContinuation": True,
                "stopReason": "hook_blocking_error",
                "hasOutput": True,
                "toolUseID": "tool-1",
                "durationMs": 55,
                "messageCount": 1,
                "timestamp": "2026-07-05T10:03:00.000Z",
                "sessionId": "stop-hook-session",
            },
            {
                "type": "system",
                "subtype": "hook_callback",
                "content": "internal callback",
                "timestamp": "2026-07-05T10:03:01.000Z",
                "sessionId": "stop-hook-session",
            },
        ],
    )

    result = parse_claude_code(str(fixture))

    assert result["unknown_record_count"] == 0
    assert result["unknown_route_keys"] == []
    events = result["sessions"][0]["events"]
    summary = next(event for event in events if event["system_subtype"] == "stop_hook_summary")
    assert summary["kind"] == "system_event"
    assert summary["graph_hidden"] is False
    assert summary["claude_event_type"] == "stop_hook_summary"
    assert summary["hook_count"] == 2
    assert summary["prevented_continuation"] is True
    assert summary["stop_reason"] == "hook_blocking_error"
    assert summary["duration_ms"] == 55
    callback = next(event for event in events if event["system_subtype"] == "hook_callback")
    assert callback["graph_hidden"] is True
    assert callback["claude_event_type"] == "hook_callback"


def test_all_taxonomy_hook_attachment_types_route_without_unknowns(tmp_path) -> None:
    fixture = tmp_path / "hook-attachments.jsonl"
    hook_rows = [
        {
            "type": "attachment",
            "attachment": {
                "type": "hook_success",
                "hookName": "success-hook",
                "hookEvent": "PostToolUse",
                "toolUseID": "tool-1",
                "command": "echo ok",
                "stdout": "ok",
                "exitCode": 0,
                "durationMs": 10,
            },
            "timestamp": "2026-07-05T10:04:00.000Z",
            "sessionId": "hook-attachment-session",
        },
        {
            "type": "attachment",
            "attachment": {
                "type": "hook_non_blocking_error",
                "hookName": "warn-hook",
                "hookEvent": "PostToolUse",
                "stderr": "warning",
                "exitCode": 1,
                "durationMs": 11,
            },
            "timestamp": "2026-07-05T10:04:01.000Z",
            "sessionId": "hook-attachment-session",
        },
        {
            "type": "attachment",
            "attachment": {
                "type": "hook_blocking_error",
                "hookName": "block-hook",
                "hookEvent": "PostToolUse",
                "blockingError": "blocked by policy",
                "exitCode": 2,
            },
            "timestamp": "2026-07-05T10:04:02.000Z",
            "sessionId": "hook-attachment-session",
        },
        {
            "type": "attachment",
            "attachment": {
                "type": "hook_cancelled",
                "hookName": "cancel-hook",
                "hookEvent": "Stop",
                "content": "cancelled",
            },
            "timestamp": "2026-07-05T10:04:03.000Z",
            "sessionId": "hook-attachment-session",
        },
        {
            "type": "attachment",
            "attachment": {
                "type": "hook_additional_context",
                "hookName": "context-hook",
                "hookEvent": "SessionStart",
                "content": [{"type": "text", "text": "extra context"}],
            },
            "timestamp": "2026-07-05T10:04:04.000Z",
            "sessionId": "hook-attachment-session",
        },
        {
            "type": "attachment",
            "attachment": {
                "type": "hook_permission_decision",
                "hookName": "permission-hook",
                "hookEvent": "PreToolUse",
                "decision": "allow",
            },
            "timestamp": "2026-07-05T10:04:05.000Z",
            "sessionId": "hook-attachment-session",
        },
        {
            "type": "attachment",
            "attachment": {
                "type": "hook_stopped_continuation",
                "hookName": "stop-hook",
                "hookEvent": "Stop",
                "message": "Stopped continuation",
            },
            "timestamp": "2026-07-05T10:04:06.000Z",
            "sessionId": "hook-attachment-session",
        },
        {
            "type": "attachment",
            "attachment": {
                "type": "hook_system_message",
                "hookName": "system-hook",
                "hookEvent": "Notification",
                "content": "System message",
            },
            "timestamp": "2026-07-05T10:04:07.000Z",
            "sessionId": "hook-attachment-session",
        },
    ]
    _write_jsonl(fixture, hook_rows)

    result = parse_claude_code(str(fixture))

    assert result["unknown_record_count"] == 0
    assert result["unknown_route_keys"] == []
    events = result["sessions"][0]["events"]
    hooks = [event for event in events if event.get("claude_event_type") == "hook"]
    assert len(hooks) == len(hook_rows)
    statuses = {event["attachment_type"]: event["status"] for event in hooks}
    assert statuses == {
        "hook_success": "success",
        "hook_non_blocking_error": "non_blocking_error",
        "hook_blocking_error": "blocking_error",
        "hook_cancelled": "cancelled",
        "hook_additional_context": "additional_context",
        "hook_permission_decision": "permission_decision",
        "hook_stopped_continuation": "stopped_continuation",
        "hook_system_message": "system_message",
    }
    permission = next(event for event in hooks if event["attachment_type"] == "hook_permission_decision")
    assert permission["decision"] == "allow"
    additional_context = next(event for event in hooks if event["attachment_type"] == "hook_additional_context")
    assert additional_context.get("graph_hidden") is not True
    assert additional_context["message"] == "extra context"
    stopped = next(event for event in hooks if event["attachment_type"] == "hook_stopped_continuation")
    assert stopped["message"] == "Stopped continuation"
    blocking = next(event for event in hooks if event["attachment_type"] == "hook_blocking_error")
    assert blocking["message"] == "blocked by policy"


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_subagent_session_marker_emitted_in_parent_when_child_matches() -> None:
    """When a parent session contains an Agent/Task tool_call AND a child
    session file exists, a ``subagent_session`` marker is injected into the
    PARENT's event stream near the dispatch tool_call. Pairs the
    ``tooling-parity`` parent (Agent tool_call on line 15) with the
    ``agent-sidechain-tooling`` child (whose first user_input matches the
    tool_call prompt). Both files must be parsed together (synthesis is
    cross-file).
    """
    parent = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    child = (
        CLAUDE_SAMPLES_DIR
        / "claude-tooling-parity-session"
        / "subagents"
        / "agent-sidechain-tooling.jsonl"
    )
    result = parse_claude_code([str(parent), str(child)])
    parent_session = next(
        s for s in result["sessions"] if s["session_id"] == "claude-tooling-parity-session"
    )
    markers = [e for e in parent_session["events"] if e.get("kind") == "subagent_session"]
    assert len(markers) == 1
    marker = markers[0]
    # Native identity + frontend subagent_session branch keys.
    assert marker["claude_event_type"] == "subagent_session"
    assert "event_type" not in marker
    assert marker["child_session_id"] == "claude-tooling-parity-session:agent:agent-sidechain-tooling"
    assert "Load each fixture" in marker["prompt_preview"]
    # agent_nickname from child agentId; agent_role from child attributionAgent.
    assert marker["agent_nickname"] == "agent-sidechain-tooling"
    assert marker["agent_role"] == "trellis-implement"
    # Marker is anchored right after the Agent tool_call (line 15).
    agent_call = next(
        e for e in parent_session["events"]
        if e.get("kind") == "tool_call" and e.get("name") == "Agent"
    )
    marker_index = parent_session["events"].index(marker)
    agent_index = parent_session["events"].index(agent_call)
    assert marker_index > agent_index, "subagent_session marker must follow the Agent tool_call"


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_subagent_session_marker_absent_when_parent_parsed_alone() -> None:
    """Synthesis is cross-file: parsing the parent alone (no child file passed)
    must NOT emit a subagent_session marker. Guards against false positives when
    the child session file isn't part of the input set.
    """
    parent = CLAUDE_SAMPLES_DIR / "tooling-parity" / "session-tooling-parity.jsonl"
    result = parse_claude_code(str(parent))
    parent_session = result["sessions"][0]
    markers = [e for e in parent_session["events"] if e.get("kind") == "subagent_session"]
    assert markers == []


@pytest.mark.skipif(not _has_claude_samples(), reason="samples/claude-code not available")
def test_subagent_session_marker_absent_when_parent_has_no_agent_tool_call() -> None:
    """A child exists but the parent has no Agent/Task tool_call -> no marker.
    The ``root-tooling`` parent has only a Read tool_call; its child
    ``agent-sidechain-review`` is linked via the path heuristic (DB linkage
    unaffected) but no in-stream marker is synthesized without a dispatch.
    """
    parent = CLAUDE_SAMPLES_DIR / "root-tooling" / "session-root-tooling.jsonl"
    child = (
        CLAUDE_SAMPLES_DIR
        / "claude-root-tooling-session"
        / "subagents"
        / "agent-sidechain-review.jsonl"
    )
    result = parse_claude_code([str(parent), str(child)])
    parent_session = next(
        s for s in result["sessions"] if s["session_id"] == "claude-root-tooling-session"
    )
    markers = [e for e in parent_session["events"] if e.get("kind") == "subagent_session"]
    assert markers == []
    # Parent/child DB linkage via path heuristic is intact (not broken by synthesis).
    child_session = next(
        s for s in result["sessions"] if s["session_id"].endswith("agent-sidechain-review")
    )
    assert child_session["parent_session_id"] == "claude-root-tooling-session"
    assert child_session["is_subagent"] is True
