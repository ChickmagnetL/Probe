from __future__ import annotations

import heapq
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .reader import discover_claude_code_files

_VISIBLE_SYSTEM_SUBTYPES = {
    "local_command": ("tool_event", False),
}
# api_error and compact_boundary are handled explicitly by ``_events_for_api_error``
# / ``_events_for_compact_boundary`` (promote to ``claude_event_type=api_error`` /
# ``claude_event_type=compact_boundary`` with their rich fields) rather than via
# this table.
_HIDDEN_SYSTEM_SUBTYPES = frozenset(
    {"away_summary", "hook_callback", "informational", "turn_duration"}
)
_HIDDEN_METADATA_TYPES = frozenset(
    {
        "agent-color",
        "agent-name",
        "agent-setting",
        "ai-title",
        "attachment",
        "attribution-snapshot",
        "content-replacement",
        "custom-title",
        "file-history-snapshot",
        "last-prompt",
        "marble-origami-commit",
        "marble-origami-snapshot",
        "mode",
        "permission-mode",
        "pr-link",
        "progress",
        "speculation-accept",
        "summary",
        "tag",
        "task-summary",
        "worktree-state",
    }
)
# Attachment subtypes promoted to a visible ``hook`` system_event. Other
# attachment kinds stay hidden metadata but still carry a ``claude_event_type``
# set to their attachment.type (e.g. ``skill_listing``).
_HOOK_ATTACHMENT_TYPES = frozenset(
    {
        "hook_success",
        "hook_non_blocking_error",
        "hook_blocking_error",
        "hook_cancelled",
        "hook_additional_context",
        "hook_permission_decision",
        "hook_stopped_continuation",
        "hook_system_message",
    }
)
_HOOK_ATTACHMENT_STATUSES = {
    "hook_success": "success",
    "hook_non_blocking_error": "non_blocking_error",
    "hook_blocking_error": "blocking_error",
    "hook_cancelled": "cancelled",
    "hook_additional_context": "additional_context",
    "hook_permission_decision": "permission_decision",
    "hook_stopped_continuation": "stopped_continuation",
    "hook_system_message": "system_message",
}

@dataclass
class SessionBuild:
    session_id: str
    raw_session_id: str | None
    source_path: str
    file_name: str
    parent_session_id: str | None
    is_subagent: bool
    agent_nickname: str | None = None
    agent_role: str | None = None
    team_name: str | None = None
    cli_version: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    cwd: str | None = None
    title: str | None = None
    events: list[dict[str, Any]] = field(default_factory=list)
    # call_id -> {"name": tool_name, "input": tool_use.input}; populated as
    # tool_call events are emitted so later batches can pair a tool_result
    # (tool_result.tool_use_id) back to its producing tool_call.
    tool_call_cache: dict[str, dict[str, Any]] = field(default_factory=dict)


def _as_int_or_zero(value: Any) -> int:
    """Coerce JSON token counts to int. Bools (subclass of int) are rejected."""
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    return 0


def _normalize_assistant_usage(raw_usage: Any) -> dict[str, Any] | None:
    """Normalize a Claude Code ``message.usage`` block to the codex usage shape.

    The frontend token badge (``EventDetailContent.readEventUsage``) only
    renders on assistant events and reads ``metadata.usage.total_token_usage``
    (falling back to the flat ``usage``) plus ``metadata.usage.last_token_usage``.
    Each card reads ``input_tokens`` / ``output_tokens`` /
    ``reasoning_output_tokens`` / ``cached_input_tokens`` / ``total_tokens``.

    claude_code raw usage carries ``input_tokens`` /
    ``cache_creation_input_tokens`` / ``cache_read_input_tokens`` /
    ``output_tokens`` but no ``total_tokens`` and no reasoning tokens, so they
    are derived. Cache is split in claude_code (creation = write, read = hit);
    the frontend "Cached" column maps to the API's ``cached_input_tokens``
    (cache hits), so ``cache_read_input_tokens`` is the source. Cache-creation
    tokens remain available via ``source_record.message.usage``.
    """
    if not isinstance(raw_usage, dict):
        return None
    input_tokens = _as_int_or_zero(raw_usage.get("input_tokens"))
    output_tokens = _as_int_or_zero(raw_usage.get("output_tokens"))
    cached_input_tokens = _as_int_or_zero(raw_usage.get("cache_read_input_tokens"))
    cache_creation_input_tokens = _as_int_or_zero(raw_usage.get("cache_creation_input_tokens"))
    total_tokens = input_tokens + output_tokens
    server_tool_use = raw_usage.get("server_tool_use")
    service_tier = raw_usage.get("service_tier")
    speed = raw_usage.get("speed")
    cache_creation = raw_usage.get("cache_creation")
    per_turn = {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "reasoning_output_tokens": 0,
        "cached_input_tokens": cached_input_tokens,
        "cache_creation_input_tokens": cache_creation_input_tokens,
        "total_tokens": total_tokens,
    }
    if isinstance(server_tool_use, dict):
        per_turn["server_tool_use"] = server_tool_use
    if isinstance(service_tier, str) and service_tier:
        per_turn["service_tier"] = service_tier
    if isinstance(speed, str) and speed:
        per_turn["speed"] = speed
    if isinstance(cache_creation, dict):
        per_turn["cache_creation"] = cache_creation
    # claude_code raw data has no session-cumulative usage, so on each assistant
    # event both nested objects carry this turn's values. Per-event attachment
    # is safe: the frontend never sums per-event usage into session totals.
    return {
        **per_turn,
        "last_token_usage": per_turn,
        "total_token_usage": per_turn,
    }


# Cap on stdout/stderr/file-content previews embedded in event metadata so a
# huge tool output doesn't bloat the events row; the full text remains in
# ``source_record``.
_TOOL_OUTPUT_PREVIEW_LIMIT = 2000


def _string_or_none(value: Any) -> str | None:
    if isinstance(value, str) and value:
        return value
    return None


def _truncate_preview(value: str, limit: int = _TOOL_OUTPUT_PREVIEW_LIMIT) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + "…"


# Claude Code writes Bash failures as ``Exit code N\n<stderr>`` inside the
# tool_result content (no structured exit_code field exists anywhere).
_BASH_EXIT_CODE_PATTERN = re.compile(r"(?:^|\n)\s*Exit code (\d+)\b", re.IGNORECASE)


def _extract_bash_exit_code(content: str | None) -> int | None:
    """Recover the real exit code from a Bash tool_result content string.

    Returns the integer N from ``Exit code N`` when present, else None (caller
    falls back to the is_error-derived 1/0 inference).
    """
    if not content:
        return None
    match = _BASH_EXIT_CODE_PATTERN.search(content)
    if not match:
        return None
    try:
        return int(match.group(1))
    except (TypeError, ValueError):
        return None


def _strip_exit_code_prefix(content: str | None) -> str | None:
    """Drop a leading ``Exit code N\n`` marker so the output doesn't duplicate
    the ``exit_code`` field when content is used as the stdout/stderr source.
    """
    if not content:
        return None
    match = _BASH_EXIT_CODE_PATTERN.search(content)
    if not match:
        return content
    return content[match.end():].lstrip("\n") or None


def _parse_mcp_tool_name(tool_name: str) -> tuple[str | None, str | None]:
    """Split an ``mcp__<server>__<tool>`` name into ``(server, tool)``."""
    parts = tool_name.split("__")
    if len(parts) >= 3 and parts[0] == "mcp":
        server = parts[1] or None
        tool = "__".join(parts[2:]) or None
        return server, tool
    return None, None


def _tool_result_metadata(
    *,
    item: dict[str, Any],
    row: dict[str, Any],
    tool_call_cache: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Build metadata for a ``tool_result`` content block.

    Pairs the result with its producing tool_call via ``tool_use_id`` ==
    ``call_id`` (looked up in ``tool_call_cache``) so the rich fields for the
    paired tool can be lifted onto the tool_output event:

    - Bash -> command/exit_code/stdout/stderr
    - Edit/Write/MultiEdit -> file_path/old/new/content/changes
    - mcp__* -> server/tool_name
    - WebSearch -> query

    The native identity is always ``claude_event_type=tool_result`` (a single
    claude_code-native label); the paired tool's name is preserved on
    ``tool_name`` so the frontend can render tool-specific fields without
    needing a codex ``*_end`` event_type. A result whose producing call is
    unknown (or a tool with no rich fields, e.g. Read/Grep) still carries
    ``call_id`` / ``is_error`` / ``status`` / ``claude_event_type``.
    """
    tool_use_id = item.get("tool_use_id")
    is_error = bool(item.get("is_error", False))
    status = "error" if is_error else "success"

    meta: dict[str, Any] = {
        "call_id": tool_use_id,
        "is_error": is_error,
        "status": status,
        "raw_content_type": "tool_result",
        "claude_event_type": "tool_result",
    }

    paired = tool_call_cache.get(tool_use_id) if isinstance(tool_use_id, str) else None
    tool_name = _string_or_none(paired.get("name")) if paired else None
    if tool_name:
        meta["tool_name"] = tool_name
    tool_input = paired.get("input") if paired else None
    if not isinstance(tool_input, dict):
        tool_input = {}

    tool_use_result = row.get("toolUseResult")
    if not isinstance(tool_use_result, dict):
        tool_use_result = {}

    # Extract toolUseResult metadata fields (interrupted / isImage / noOutputExpected).
    interrupted = tool_use_result.get("interrupted")
    if isinstance(interrupted, bool):
        meta["interrupted"] = interrupted
    is_image = tool_use_result.get("isImage")
    if isinstance(is_image, bool):
        meta["is_image"] = is_image
    no_output_expected = tool_use_result.get("noOutputExpected")
    if isinstance(no_output_expected, bool):
        meta["no_output_expected"] = no_output_expected

    if tool_name == "Bash":
        command = _string_or_none(tool_input.get("command"))
        if command:
            meta["command"] = command
            # ``command_text`` is an alias of ``command``; some frontend
            # branches read it for the ``$ <cmd>`` prefix line. claude_code's
            # command is already a plain string, so alias it.
            meta["command_text"] = command

        # claude_code has no structured exit_code field. On error the real
        # code is embedded in the tool_result content as ``Exit code N``;
        # recover it so the badge shows the actual code (e.g. 127) instead of
        # a generic 1. Fall back to is_error-derived 1/0 when absent.
        content_text = _string_or_none(item.get("content"))
        exit_code = _extract_bash_exit_code(content_text)
        meta["exit_code"] = exit_code if exit_code is not None else (1 if is_error else 0)

        stdout = _string_or_none(tool_use_result.get("stdout"))
        stderr = _string_or_none(tool_use_result.get("stderr"))
        # On errors ``toolUseResult`` is typically absent; fall back to the
        # tool_result content (with the ``Exit code N`` prefix stripped) so
        # the timeline summary still surfaces the output. Route error output
        # to stderr and success output to stdout, matching Bash semantics.
        if stdout is None and stderr is None:
            body = _strip_exit_code_prefix(content_text)
            if body:
                if is_error:
                    stderr = body
                else:
                    stdout = body
        if stdout is not None:
            meta["stdout"] = _truncate_preview(stdout)
        if stderr is not None:
            meta["stderr"] = _truncate_preview(stderr)
    elif tool_name in {"Edit", "Write", "MultiEdit"}:
        file_path = _string_or_none(tool_input.get("file_path"))
        if file_path:
            meta["file_path"] = file_path
        # Surface a `changes` list (single-element mirroring codex's patch
        # shape) whose entry also carries the old/new or content for any
        # detail renderer.
        change: dict[str, Any] = {"file_path": file_path, "status": status}
        if tool_name == "Edit":
            old_string = tool_input.get("old_string")
            new_string = tool_input.get("new_string")
            if isinstance(old_string, str):
                meta["old_string"] = old_string
                change["old_string"] = old_string
            if isinstance(new_string, str):
                meta["new_string"] = new_string
                change["new_string"] = new_string
            if tool_input.get("replace_all"):
                meta["replace_all"] = True
        elif tool_name == "Write":
            content = tool_input.get("content")
            if isinstance(content, str):
                preview = _truncate_preview(content)
                meta["content"] = preview
                change["content"] = preview
        meta["changes"] = [change]
    elif tool_name and tool_name.startswith("mcp__"):
        server, tool = _parse_mcp_tool_name(tool_name)
        if server:
            meta["server"] = server
        # Replace the raw `mcp__server__tool` name with the bare tool name for
        # the ``tool_name`` display field.
        if tool:
            meta["tool_name"] = tool
    elif tool_name == "WebSearch":
        query = _string_or_none(tool_input.get("query"))
        if query:
            meta["query"] = query

    source_tool_assistant_uuid = _string_or_none(row.get("sourceToolAssistantUUID"))
    if source_tool_assistant_uuid:
        meta["source_tool_assistant_uuid"] = source_tool_assistant_uuid

    return meta


def parse_claude_code(input_path: str | Path | list[str | Path]) -> dict[str, Any]:
    files = discover_claude_code_files(input_path)
    builds: list[SessionBuild] = []
    parsed_records = 0
    parse_errors = 0
    unknown_record_count = 0
    unknown_route_keys: set[str] = set()

    for path in files:
        build, counts = _parse_file(path)
        builds.append(build)
        parsed_records += counts["parsed_records"]
        parse_errors += counts["parse_errors"]
        unknown_record_count += counts["unknown_record_count"]
        unknown_route_keys.update(counts["unknown_route_keys"])

    # Cross-file synthesis: emit a ``subagent_session`` in-stream marker in each
    # parent session that dispatched an Agent/Task tool_call with a matching
    # child session file. Requires all builds to be collected first (children
    # live in separate files). Best-effort; parent/child DB linkage via path
    # heuristic is unaffected.
    _inject_subagent_session_markers(builds)

    sessions = [_serialize_session(build) for build in builds]

    sessions.sort(key=lambda session: (session.get("start_time") or "", session["session_id"]))
    root_sessions = _build_root_sessions(sessions)
    return {
        "total_files": len(files),
        "parsed_records": parsed_records,
        "parse_errors": parse_errors,
        "unknown_record_count": unknown_record_count,
        "unknown_route_keys": sorted(unknown_route_keys),
        "imported_session_count": len(sessions),
        "root_session_count": len(root_sessions),
        "sessions": sessions,
        "root_sessions": root_sessions,
        "table_counts": {
            "events": sum(len(session.get("events", [])) for session in sessions),
            "sessions": len(sessions),
        },
    }


def _parse_file(path: Path) -> tuple[SessionBuild, dict[str, Any]]:
    row_infos: list[dict[str, Any]] = []
    parse_errors = 0
    parsed_records = 0
    unknown_record_count = 0
    unknown_route_keys: set[str] = set()
    source = path.resolve()

    with source.open("r", encoding="utf-8") as handle:
        for line_no, raw_text in enumerate(handle, start=1):
            text = raw_text.rstrip("\n")
            if not text.strip():
                parse_errors += 1
                continue

            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                parse_errors += 1
                continue

            if not isinstance(data, dict):
                parse_errors += 1
                continue

            record_type = data.get("type")
            if not isinstance(record_type, str) or not record_type:
                parse_errors += 1
                continue

            parsed_records += 1
            row_infos.append(
                {
                    "data": data,
                    "raw_text": text,
                    "source_line_no": line_no,
                }
            )

    raw_session_id = _first_string(row["data"].get("sessionId") for row in row_infos)
    is_sidechain = source.parent.name == "subagents" or any(
        bool(row["data"].get("isSidechain")) for row in row_infos
    )
    agent_id = _first_string(row["data"].get("agentId") for row in row_infos)
    session_id = _derive_session_id(
        raw_session_id=raw_session_id,
        is_sidechain=is_sidechain,
        agent_id=agent_id,
        path=source,
    )
    build = SessionBuild(
        session_id=session_id,
        raw_session_id=raw_session_id,
        source_path=str(source),
        file_name=source.name,
        parent_session_id=_derive_parent_session_id(source, raw_session_id, is_sidechain),
        is_subagent=is_sidechain,
        agent_nickname=agent_id,
    )

    for row_info in row_infos:
        _update_session_metadata(build, row_info)
        events, event_unknown_count, event_unknown_keys = _events_for_row(
            session_id=session_id,
            row_info=row_info,
            tool_call_cache=build.tool_call_cache,
        )
        build.events.extend(events)
        unknown_record_count += event_unknown_count
        unknown_route_keys.update(event_unknown_keys)

    _sort_events_topologically(build.events)
    build.title = build.title or _derive_title(build.events) or source.stem
    build.cwd = build.cwd or _fallback_cwd(source, is_sidechain)

    return build, {
        "parsed_records": parsed_records,
        "parse_errors": parse_errors,
        "unknown_record_count": unknown_record_count,
        "unknown_route_keys": unknown_route_keys,
    }


def _events_for_row(
    *,
    session_id: str,
    row_info: dict[str, Any],
    tool_call_cache: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], int, set[str]]:
    row = row_info["data"]
    record_type = row["type"]

    if record_type == "user":
        return _events_for_user_row(
            session_id=session_id,
            row_info=row_info,
            tool_call_cache=tool_call_cache,
        )
    if record_type == "assistant":
        return _events_for_assistant_row(
            session_id=session_id,
            row_info=row_info,
            tool_call_cache=tool_call_cache,
        )
    if record_type == "system":
        return _events_for_system_row(session_id=session_id, row_info=row_info)
    if record_type == "queue-operation":
        # A queued user message (enqueued while the agent was busy). Surface as
        # a regular user_input so it appears in the timeline instead of falling
        # through to "Unhandled Claude record".
        return _events_for_queue_operation(session_id=session_id, row_info=row_info)
    if record_type == "attachment":
        # Hook attachments are promoted to a visible hook system_event; all
        # other attachment kinds fall through to hidden metadata below.
        events, count, keys = _events_for_attachment_row(
            session_id=session_id, row_info=row_info
        )
        if events is not None:
            return events, count, keys
    if record_type in _HIDDEN_METADATA_TYPES:
        extra_meta: dict[str, Any] = {
            "graph_hidden": True,
            "claude_event_type": record_type,
        }
        if record_type == "summary":
            leaf_uuid = _string_or_none(row.get("leafUuid"))
            summary = _string_or_none(row.get("summary"))
            if leaf_uuid:
                extra_meta["leaf_uuid"] = leaf_uuid
            if summary:
                extra_meta["summary"] = summary
        return (
            [
                _build_event(
                    session_id=session_id,
                    row_info=row_info,
                    block_index=0,
                    kind="system_event",
                    role="system",
                    phase="metadata",
                    content=_metadata_content_preview(row),
                    # graph_hidden but still carry a native identity (= record
                    # type verbatim, e.g. ``mode``/``permission-mode``) so every
                    # emitted event has a ``claude_event_type`` if surfaced.
                    extra_meta=extra_meta,
                )
            ],
            0,
            set(),
        )

    return (
        [
            _build_event(
                session_id=session_id,
                row_info=row_info,
                block_index=0,
                kind="system_event",
                role="system",
                phase="metadata",
                content=f"Unhandled Claude record: {record_type}",
                extra_meta={"graph_hidden": True, "unhandled_type": record_type},
            )
        ],
        1,
        {record_type},
    )


def _events_for_user_row(
    *,
    session_id: str,
    row_info: dict[str, Any],
    tool_call_cache: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], int, set[str]]:
    row = row_info["data"]
    message = row.get("message")
    if not isinstance(message, dict):
        return (
            [
                _build_event(
                    session_id=session_id,
                    row_info=row_info,
                    block_index=0,
                    kind="system_event",
                    role="system",
                    phase="metadata",
                    content="Claude user row without message payload",
                    extra_meta={"graph_hidden": True},
                )
            ],
            1,
            {"user:missing_message"},
        )

    content = message.get("content")
    if row.get("isCompactSummary") is True:
        summary = _coerce_text(content) or "Compact summary"
        return (
            [
                _build_event(
                    session_id=session_id,
                    row_info=row_info,
                    block_index=0,
                    kind="compaction_event",
                    role="system",
                    phase="metadata",
                    content=summary,
                    extra_meta={
                        "graph_hidden": True,
                        "raw_content_type": "compact_summary",
                        "claude_event_type": "compact_summary",
                        "summary": summary,
                        "is_compact_summary": True,
                    },
                )
            ],
            0,
            set(),
        )

    if isinstance(content, str):
        if row.get("isMeta"):
            return (
                [
                    _build_event(
                        session_id=session_id,
                        row_info=row_info,
                        block_index=0,
                        kind="system_event",
                        role="system",
                        phase="metadata",
                        content=content,
                        extra_meta={
                            "graph_hidden": True,
                            "meta_role": "user",
                            # ``isMeta`` user rows (e.g. image-meta-only messages
                            # whose content is "[Image: ...]") still surface in
                            # the events stream, so they need a native identity
                            # to satisfy the "every event carries claude_event_type"
                            # contract.
                            "claude_event_type": "user_message",
                        },
                    )
                ],
                0,
                set(),
            )
        return (
            [
                _build_event(
                    session_id=session_id,
                    row_info=row_info,
                    block_index=0,
                    kind="user_input",
                    role="user",
                    phase="input",
                    content=content,
                    extra_meta={"claude_event_type": "user_message"},
                )
            ],
            0,
            set(),
        )

    if not isinstance(content, list):
        return (
            [
                _build_event(
                    session_id=session_id,
                    row_info=row_info,
                    block_index=0,
                    kind="system_event",
                    role="system",
                    phase="metadata",
                    content="Claude user row with unsupported content payload",
                    extra_meta={"graph_hidden": True},
                )
            ],
            1,
            {"user:unsupported_content"},
        )

    events: list[dict[str, Any]] = []
    unknown_record_count = 0
    unknown_route_keys: set[str] = set()
    for index, item in enumerate(content):
        if not isinstance(item, dict):
            unknown_record_count += 1
            unknown_route_keys.add("user:non_object_block")
            continue
        block_type = item.get("type")
        if block_type == "text":
            text = _coerce_text(item.get("text"))
            events.append(
                _build_event(
                    session_id=session_id,
                    row_info=row_info,
                    block_index=index,
                    kind="user_input",
                    role="user",
                    phase="input",
                    content=text,
                    extra_meta={
                        "raw_content_type": block_type,
                        "claude_event_type": "user_message",
                    },
                )
            )
            continue
        if block_type == "tool_result":
            events.append(
                _build_event(
                    session_id=session_id,
                    row_info=row_info,
                    block_index=index,
                    kind="tool_output",
                    role="tool",
                    phase="tool",
                    content=_coerce_text(item.get("content")),
                    extra_meta=_tool_result_metadata(
                        item=item,
                        row=row,
                        tool_call_cache=tool_call_cache,
                    ),
                )
            )
            continue
        if block_type == "image":
            # Pasted image block. The base64 data is intentionally NOT stored
            # in metadata (too large for the events row); only media_type and a
            # placeholder are surfaced. Routes to the frontend ``input_image``
            # branch so the block is no longer "Unhandled".
            events.append(
                _build_image_input_event(
                    session_id=session_id,
                    row_info=row_info,
                    block_index=index,
                    item=item,
                )
            )
            continue

        unknown_record_count += 1
        unknown_route_keys.add(f"user:{block_type or 'unknown'}")
        events.append(
            _build_event(
                session_id=session_id,
                row_info=row_info,
                block_index=index,
                kind="system_event",
                role="system",
                phase="metadata",
                content=f"Unhandled Claude user content block: {block_type or 'unknown'}",
                extra_meta={"graph_hidden": True, "raw_content_type": block_type},
            )
        )

    return events, unknown_record_count, unknown_route_keys


def _events_for_assistant_row(
    *,
    session_id: str,
    row_info: dict[str, Any],
    tool_call_cache: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], int, set[str]]:
    row = row_info["data"]
    message = row.get("message")
    if not isinstance(message, dict):
        return (
            [
                _build_event(
                    session_id=session_id,
                    row_info=row_info,
                    block_index=0,
                    kind="system_event",
                    role="system",
                    phase="metadata",
                    content="Claude assistant row without message payload",
                    extra_meta={"graph_hidden": True},
                )
            ],
            1,
            {"assistant:missing_message"},
        )

    content = message.get("content")
    if not isinstance(content, list):
        return (
            [
                _build_event(
                    session_id=session_id,
                    row_info=row_info,
                    block_index=0,
                    kind="system_event",
                    role="system",
                    phase="metadata",
                    content="Claude assistant row with unsupported content payload",
                    extra_meta={"graph_hidden": True},
                )
            ],
            1,
            {"assistant:unsupported_content"},
        )

    # model + per-turn usage + stop_reason are properties of the assistant API
    # response (the row), not of individual content blocks. Attached to every
    # event produced from this row so the frontend token badge / model display
    # work on any assistant_output / assistant_update event.
    assistant_row_meta: dict[str, Any] = {}
    model = message.get("model")
    if isinstance(model, str) and model:
        assistant_row_meta["model"] = model
    stop_reason = message.get("stop_reason")
    if isinstance(stop_reason, str) and stop_reason:
        assistant_row_meta["stop_reason"] = stop_reason
    usage = _normalize_assistant_usage(message.get("usage"))
    if usage is not None:
        assistant_row_meta["usage"] = usage
    msg_id = message.get("id")
    if isinstance(msg_id, str) and msg_id:
        assistant_row_meta["message_id"] = msg_id
    stop_details = message.get("stop_details")
    if isinstance(stop_details, str) and stop_details:
        assistant_row_meta["stop_details"] = stop_details

    events: list[dict[str, Any]] = []
    unknown_record_count = 0
    unknown_route_keys: set[str] = set()
    for index, item in enumerate(content):
        if not isinstance(item, dict):
            unknown_record_count += 1
            unknown_route_keys.add("assistant:non_object_block")
            continue
        block_type = item.get("type")
        if block_type == "thinking":
            events.append(
                _build_event(
                    session_id=session_id,
                    row_info=row_info,
                    block_index=index,
                    kind="assistant_update",
                    role="assistant",
                    phase="thinking",
                    content=_coerce_text(item.get("thinking")),
                    extra_meta={
                        **assistant_row_meta,
                        "raw_content_type": block_type,
                        "claude_event_type": "thinking",
                    },
                )
            )
            continue
        if block_type == "text":
            events.append(
                _build_event(
                    session_id=session_id,
                    row_info=row_info,
                    block_index=index,
                    kind="assistant_output",
                    role="assistant",
                    phase="output",
                    content=_coerce_text(item.get("text")),
                    extra_meta={
                        **assistant_row_meta,
                        "raw_content_type": block_type,
                        "claude_event_type": "text",
                    },
                )
            )
            continue
        if block_type == "tool_use":
            tool_name = item.get("name")
            tool_input = item.get("input")
            call_id = item.get("id")
            # claude_event_type is the tool name verbatim (the native identity).
            # Unknown tool names fall through unchanged — the frontend default
            # branch prints the tool name and never crashes.
            claude_event_type = (
                tool_name if isinstance(tool_name, str) and tool_name else "tool_use"
            )
            extra_meta: dict[str, Any] = {
                **assistant_row_meta,
                "name": tool_name,
                "call_id": call_id,
                "args": json.dumps(tool_input, ensure_ascii=False) if tool_input is not None else None,
                "tool_name": tool_name,
                "raw_content_type": block_type,
                "claude_event_type": claude_event_type,
            }
            if isinstance(call_id, str) and call_id:
                tool_call_cache[call_id] = {
                    "name": tool_name if isinstance(tool_name, str) else None,
                    "input": tool_input if isinstance(tool_input, dict) else None,
                }
            events.append(
                _build_event(
                    session_id=session_id,
                    row_info=row_info,
                    block_index=index,
                    kind="tool_call",
                    role="assistant",
                    phase="tool",
                    content=_coerce_text(tool_name),
                    extra_meta=extra_meta,
                )
            )
            continue

        unknown_record_count += 1
        unknown_route_keys.add(f"assistant:{block_type or 'unknown'}")
        events.append(
            _build_event(
                session_id=session_id,
                row_info=row_info,
                block_index=index,
                kind="system_event",
                role="system",
                phase="metadata",
                content=f"Unhandled Claude assistant content block: {block_type or 'unknown'}",
                extra_meta={**assistant_row_meta, "graph_hidden": True, "raw_content_type": block_type},
            )
        )

    return events, unknown_record_count, unknown_route_keys


def _events_for_system_row(
    *,
    session_id: str,
    row_info: dict[str, Any],
) -> tuple[list[dict[str, Any]], int, set[str]]:
    row = row_info["data"]
    subtype = row.get("subtype")
    if subtype == "api_error":
        # Promote with retry fields + ``claude_event_type=api_error`` so the
        # frontend renders the rich error card (was hitting the default branch).
        return _events_for_api_error(session_id=session_id, row_info=row_info)
    if subtype in {"compact_boundary", "microcompact_boundary"}:
        # Promote with token counts + ``claude_event_type=compact_boundary`` so
        # the frontend renders the compaction card (was hitting the default
        # branch).
        return _events_for_compact_boundary(session_id=session_id, row_info=row_info)
    if subtype == "stop_hook_summary":
        return _events_for_stop_hook_summary(session_id=session_id, row_info=row_info)
    if subtype in _VISIBLE_SYSTEM_SUBTYPES:
        kind, hidden = _VISIBLE_SYSTEM_SUBTYPES[subtype]
        return (
            [
                _build_event(
                    session_id=session_id,
                    row_info=row_info,
                    block_index=0,
                    kind=kind,
                    role="system",
                    phase="system",
                    content=_coerce_text(row.get("content")) or subtype,
                    extra_meta={
                        "graph_hidden": hidden,
                        "system_subtype": subtype,
                        # Native identity is the subtype verbatim (currently
                        # only ``local_command``).
                        "claude_event_type": subtype,
                    },
                )
            ],
            0,
            set(),
        )

    return (
        [
            _build_event(
                session_id=session_id,
                row_info=row_info,
                block_index=0,
                kind="system_event",
                role="system",
                phase="metadata" if subtype in _HIDDEN_SYSTEM_SUBTYPES else "system",
                content=_coerce_text(row.get("content")) or _coerce_text(subtype),
                extra_meta={
                    "graph_hidden": subtype in _HIDDEN_SYSTEM_SUBTYPES or subtype not in _VISIBLE_SYSTEM_SUBTYPES,
                    "system_subtype": subtype,
                    # Native identity is the subtype verbatim (e.g.
                    # ``turn_duration``/``away_summary``) so even hidden system
                    # rows carry a ``claude_event_type`` if surfaced. Falls
                    # back to ``system`` when subtype is null/empty.
                    "claude_event_type": subtype if isinstance(subtype, str) and subtype else "system",
                },
            )
        ],
        0 if subtype in _HIDDEN_SYSTEM_SUBTYPES else 1,
        set() if subtype in _HIDDEN_SYSTEM_SUBTYPES else {f"system:{subtype or 'unknown'}"},
    )


def _events_for_stop_hook_summary(
    *,
    session_id: str,
    row_info: dict[str, Any],
) -> tuple[list[dict[str, Any]], int, set[str]]:
    row = row_info["data"]
    stop_reason = _string_or_none(row.get("stopReason"))
    hook_errors = row.get("hookErrors")
    message = (
        _string_or_none(row.get("content"))
        or stop_reason
        or _coerce_text(hook_errors)
        or "Stop hook summary"
    )
    meta: dict[str, Any] = {
        "graph_hidden": False,
        "claude_event_type": "stop_hook_summary",
        "system_subtype": "stop_hook_summary",
        "message": message,
    }

    hook_count = row.get("hookCount")
    if isinstance(hook_count, int) and not isinstance(hook_count, bool):
        meta["hook_count"] = hook_count
    hook_infos = row.get("hookInfos")
    if isinstance(hook_infos, list):
        meta["hook_infos"] = hook_infos
    if isinstance(hook_errors, list):
        meta["hook_errors"] = hook_errors
    elif isinstance(hook_errors, str) and hook_errors:
        meta["hook_errors"] = [hook_errors]

    prevented = row.get("preventedContinuation")
    if isinstance(prevented, bool):
        meta["prevented_continuation"] = prevented
    if stop_reason:
        meta["stop_reason"] = stop_reason
    has_output = row.get("hasOutput")
    if isinstance(has_output, bool):
        meta["has_output"] = has_output
    tool_use_id = _string_or_none(row.get("toolUseID"))
    if tool_use_id:
        meta["tool_use_id"] = tool_use_id
        meta["call_id"] = tool_use_id
    duration_ms = row.get("durationMs")
    if isinstance(duration_ms, (int, float)) and not isinstance(duration_ms, bool):
        meta["duration_ms"] = duration_ms
    message_count = row.get("messageCount")
    if isinstance(message_count, int) and not isinstance(message_count, bool):
        meta["message_count"] = message_count

    return (
        [
            _build_event(
                session_id=session_id,
                row_info=row_info,
                block_index=0,
                kind="system_event",
                role="system",
                phase="system",
                content=message,
                extra_meta=meta,
            )
        ],
        0,
        set(),
    )


def _events_for_api_error(
    *,
    session_id: str,
    row_info: dict[str, Any],
) -> tuple[list[dict[str, Any]], int, set[str]]:
    """Route ``system subtype=api_error`` to ``claude_event_type=api_error``.

    claude_code rows carry the message at top-level ``content`` (mirrored from
    ``error.formatted``/``error.message``) and the retry context at
    ``retryAttempt``/``maxRetries``/``retryInMs``.
    """
    row = row_info["data"]
    error_payload = row.get("error")
    if not isinstance(error_payload, dict):
        error_payload = {}
    error_type = (
        _string_or_none(error_payload.get("kind"))
        or _string_or_none(error_payload.get("error_type"))
        or "api_error"
    )
    message = (
        _string_or_none(row.get("content"))
        or _string_or_none(error_payload.get("formatted"))
        or _string_or_none(error_payload.get("message"))
    )
    meta: dict[str, Any] = {
        "claude_event_type": "api_error",
        "system_subtype": "api_error",
        "error_type": error_type,
    }
    if message:
        meta["message"] = message
    # Retry context is optional; only attach when present and numeric. Bools
    # (an int subclass) are rejected so ``true`` doesn't masquerade as ``1``.
    for source_key, dest_key in (
        ("retryAttempt", "retry_attempt"),
        ("maxRetries", "max_retries"),
    ):
        value = row.get(source_key)
        if isinstance(value, int) and not isinstance(value, bool):
            meta[dest_key] = value
    retry_in_ms = row.get("retryInMs")
    if isinstance(retry_in_ms, (int, float)) and not isinstance(retry_in_ms, bool):
        meta["retry_in_ms"] = retry_in_ms
    return (
        [
            _build_event(
                session_id=session_id,
                row_info=row_info,
                block_index=0,
                kind="system_event",
                role="system",
                phase="system",
                content=message or "API error",
                extra_meta=meta,
            )
        ],
        0,
        set(),
    )


def _events_for_compact_boundary(
    *,
    session_id: str,
    row_info: dict[str, Any],
) -> tuple[list[dict[str, Any]], int, set[str]]:
    """Route compact/microcompact system rows to ``claude_event_type=compact_boundary``.

    Carries ``summary`` + ``original_token_count`` + ``compacted_token_count``
    derived from ``compactMetadata`` plus the claude_code-specific ``trigger``
    and ``preserved_uuids`` when present.

    Degrades gracefully when ``compactMetadata`` is absent (real compact_boundary
    rows may carry a sparse payload): still emits a compaction_event, just with
    the token counts dropped — never crashes.
    """
    row = row_info["data"]
    subtype = _string_or_none(row.get("subtype")) or "compact_boundary"
    content = _coerce_text(row.get("content")) or subtype
    compact_metadata = row.get("compactMetadata")
    if not isinstance(compact_metadata, dict):
        compact_metadata = {}

    meta: dict[str, Any] = {
        # microcompact_boundary uses the same UI treatment as compact_boundary;
        # keep the exact raw subtype separately for detail cards and debugging.
        "claude_event_type": "compact_boundary",
        "system_subtype": subtype,
        # The frontend compaction card reads ``meta.summary`` for the message.
        "summary": content,
    }
    pre_tokens = compact_metadata.get("preTokens")
    if isinstance(pre_tokens, int) and not isinstance(pre_tokens, bool):
        meta["original_token_count"] = pre_tokens
    post_tokens = compact_metadata.get("postTokens")
    if isinstance(post_tokens, int) and not isinstance(post_tokens, bool):
        meta["compacted_token_count"] = post_tokens
    trigger = _string_or_none(compact_metadata.get("trigger"))
    if trigger:
        meta["trigger"] = trigger
    preserved_messages = compact_metadata.get("preservedMessages")
    if isinstance(preserved_messages, dict):
        uuids = preserved_messages.get("uuids")
        if isinstance(uuids, list):
            filtered = [u for u in uuids if isinstance(u, str) and u]
            if filtered:
                meta["preserved_uuids"] = filtered

    return (
        [
            _build_event(
                session_id=session_id,
                row_info=row_info,
                block_index=0,
                kind="compaction_event",
                role="system",
                phase="system",
                content=content,
                extra_meta=meta,
            )
        ],
        0,
        set(),
    )


def _events_for_queue_operation(
    *,
    session_id: str,
    row_info: dict[str, Any],
) -> tuple[list[dict[str, Any]], int, set[str]]:
    """Surface a ``queue-operation`` row as a ``user_input`` event.

    Claude Code records a queued user message (enqueued while the agent was
    busy) as a top-level ``type=queue-operation`` row with ``content`` holding
    the pending prompt. Emit it as user_input so it appears in the timeline
    instead of the prior "Unhandled Claude record" marker.
    """
    row = row_info["data"]
    content = _string_or_none(row.get("content")) or ""
    operation = _string_or_none(row.get("operation"))
    meta: dict[str, Any] = {
        "raw_content_type": "queue-operation",
        "claude_event_type": "queue_operation",
    }
    if operation:
        meta["queue_operation"] = operation
    return (
        [
            _build_event(
                session_id=session_id,
                row_info=row_info,
                block_index=0,
                kind="user_input",
                role="user",
                phase="input",
                content=content,
                extra_meta=meta,
            )
        ],
        0,
        set(),
    )


def _events_for_attachment_row(
    *,
    session_id: str,
    row_info: dict[str, Any],
) -> tuple[list[dict[str, Any]] | None, int, set[str]]:
    """Route attachment rows by attachment.type.

    Hook attachments promote to a visible ``system_event`` with
    ``claude_event_type=hook`` carrying hook_name/hook_type/status plus
    command/exit_code/duration_ms/decision/output fields when present.

    All other attachment kinds (``skill_listing``, ``command_permissions``,
    ``edited_text_file``, ``task_reminder``, ...) stay hidden metadata but get
    ``claude_event_type`` set to the attachment.type verbatim so they carry a
    native identity if ever surfaced.

    Returns ``(None, 0, set())`` only when the row's ``attachment`` field is
    absent/non-dict — the caller then falls through to the hidden-metadata
    safety-net branch.
    """
    row = row_info["data"]
    attachment = row.get("attachment")
    if not isinstance(attachment, dict):
        return None, 0, set()
    attachment_type = _string_or_none(attachment.get("type"))
    if attachment_type not in _HOOK_ATTACHMENT_TYPES:
        # Non-hook attachment: hidden metadata with claude_event_type set to
        # the attachment.type verbatim (e.g. ``skill_listing``,
        # ``command_permissions``). Falls in alongside other hidden metadata
        # rows but carries its native identity.
        claude_event_type = (
            attachment_type if isinstance(attachment_type, str) and attachment_type else "attachment"
        )
        return (
            [
                _build_event(
                    session_id=session_id,
                    row_info=row_info,
                    block_index=0,
                    kind="system_event",
                    role="system",
                    phase="metadata",
                    content=_metadata_content_preview(row),
                    extra_meta={
                        "graph_hidden": True,
                        "claude_event_type": claude_event_type,
                        "attachment_type": attachment_type,
                    },
                )
            ],
            0,
            set(),
        )

    hook_name = _string_or_none(attachment.get("hookName"))
    tool_use_id = _string_or_none(attachment.get("toolUseID"))
    command = _string_or_none(attachment.get("command"))
    stdout = _string_or_none(attachment.get("stdout"))
    stderr = _string_or_none(attachment.get("stderr"))
    exit_code = attachment.get("exitCode")
    duration_ms = attachment.get("durationMs")
    hook_event = _string_or_none(attachment.get("hookEvent"))
    decision = _string_or_none(attachment.get("decision"))
    message = (
        _string_or_none(attachment.get("message"))
        or _string_or_none(attachment.get("blockingError"))
        or _coerce_text(attachment.get("content"))
    )

    meta: dict[str, Any] = {
        "claude_event_type": "hook",
        "raw_content_type": "attachment",
        "attachment_type": attachment_type,
        "status": _HOOK_ATTACHMENT_STATUSES[attachment_type],
    }
    if hook_name:
        meta["hook_name"] = hook_name
    if tool_use_id:
        meta["tool_use_id"] = tool_use_id
        meta["call_id"] = tool_use_id
    # hook_type is the frontend-facing alias of the raw hookEvent field.
    if hook_event:
        meta["hook_type"] = hook_event
    if decision:
        meta["decision"] = decision
    if command:
        meta["command"] = command
    if stdout:
        meta["stdout"] = _truncate_preview(stdout)
    if stderr:
        meta["stderr"] = _truncate_preview(stderr)
    if message:
        meta["message"] = _truncate_preview(message)
    if isinstance(exit_code, int) and not isinstance(exit_code, bool):
        meta["exit_code"] = exit_code
    if isinstance(duration_ms, int) and not isinstance(duration_ms, bool):
        meta["duration_ms"] = duration_ms

    content = hook_name or message or _HOOK_ATTACHMENT_STATUSES[attachment_type]
    return (
        [
            _build_event(
                session_id=session_id,
                row_info=row_info,
                block_index=0,
                kind="system_event",
                role="system",
                phase="system",
                content=content,
                extra_meta=meta,
            )
        ],
        0,
        set(),
    )


def _build_image_input_event(
    *,
    session_id: str,
    row_info: dict[str, Any],
    block_index: int,
    item: dict[str, Any],
) -> dict[str, Any]:
    """Build an ``input_image`` event from a user content ``image`` block.

    The base64 data is intentionally NOT copied into metadata (would bloat the
    events row); only ``media_type`` and a placeholder content are surfaced.
    """
    source = item.get("source")
    media_type = None
    if isinstance(source, dict):
        media_type = _string_or_none(source.get("media_type"))
    detail_note = media_type or "image"
    meta: dict[str, Any] = {
        "raw_content_type": "image",
        "claude_event_type": "image",
        "detail_note": detail_note,
    }
    if media_type:
        meta["media_type"] = media_type
    return _build_event(
        session_id=session_id,
        row_info=row_info,
        block_index=block_index,
        kind="input_image",
        role="user",
        phase="input",
        content=f"[pasted image ({detail_note})]",
        extra_meta=meta,
    )


def _inject_subagent_session_markers(builds: list[SessionBuild]) -> None:
    """Emit a ``subagent_session`` marker into each parent session that
    dispatched an Agent/Task tool_call with a matching child session file.

    Minimal cross-file synthesis (Batch 5): children live in separate
    ``<sessionId>/subagents/agent-*.jsonl`` files, so a parent's event stream
    has no in-band marker until this pass runs after every file is parsed.

    Pairing: for each parent's Agent/Task tool_call (in stream order), match a
    child of that parent whose first user_input content equals the tool_call's
    ``input.prompt``; fall back to the next unmatched child if no prompt match.
    Emits a synthetic ``subagent_session`` event with
    ``claude_event_type=subagent_session`` plus ``child_session_id``,
    ``prompt_preview``, ``agent_nickname``, ``agent_role``.

    The marker has no source row (synthetic); it slots into the topological
    sort by timestamp (interpolation_rank), anchored to the dispatch
    tool_call's timestamp so it lands right after it.

    Parent/child DB linkage (path heuristic, Batch 0) is untouched — this is
    the in-stream marker only.
    """
    children_by_parent: dict[str, list[SessionBuild]] = {}
    for build in builds:
        if build.is_subagent and build.parent_session_id:
            children_by_parent.setdefault(build.parent_session_id, []).append(build)
    for kids in children_by_parent.values():
        kids.sort(key=lambda child: (child.start_time or "", child.session_id))

    for parent in builds:
        if parent.is_subagent:
            continue
        children = children_by_parent.get(parent.session_id)
        if not children:
            continue
        unmatched: list[SessionBuild] = list(children)
        markers: list[dict[str, Any]] = []
        for event in parent.events:
            if event.get("kind") != "tool_call":
                continue
            if event.get("name") not in {"Agent", "Task"}:
                continue
            prompt = _extract_tool_call_prompt(event)
            child = _match_child(unmatched, prompt)
            if child is None:
                continue
            unmatched.remove(child)
            markers.append(
                _build_subagent_session_marker(
                    parent_session_id=parent.session_id,
                    child=child,
                    prompt=prompt,
                    anchor_event=event,
                )
            )
        if markers:
            parent.events.extend(markers)
            _sort_events_topologically(parent.events)


def _extract_tool_call_prompt(event: dict[str, Any]) -> str | None:
    """Read the ``prompt`` field from a tool_call's serialized ``args``."""
    args = event.get("args")
    if not isinstance(args, str):
        return None
    try:
        parsed = json.loads(args)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(parsed, dict):
        return None
    prompt = parsed.get("prompt")
    return prompt if isinstance(prompt, str) and prompt else None


def _first_user_input_text(build: SessionBuild) -> str | None:
    for event in build.events:
        if event.get("kind") != "user_input":
            continue
        content = event.get("content")
        if isinstance(content, str) and content:
            return content
    return None


def _match_child(
    candidates: list[SessionBuild], prompt: str | None
) -> SessionBuild | None:
    """Pick the child whose first user_input equals ``prompt``; else the first
    unmatched child (best-effort pairing when prompts are truncated/absent)."""
    if not candidates:
        return None
    if prompt:
        for child in candidates:
            if _first_user_input_text(child) == prompt:
                return child
    return candidates[0]


def _build_subagent_session_marker(
    *,
    parent_session_id: str,
    child: SessionBuild,
    prompt: str | None,
    anchor_event: dict[str, Any],
) -> dict[str, Any]:
    """Build the synthetic ``subagent_session`` event dict.

    Carries ``claude_event_type=subagent_session`` plus the metadata the
    frontend reads (``child_session_id``/``prompt_preview``/
    ``agent_nickname``/``agent_role``).
    """
    meta: dict[str, Any] = {
        "claude_event_type": "subagent_session",
        "child_session_id": child.session_id,
    }
    if prompt:
        meta["prompt_preview"] = prompt[:200]
    if child.agent_nickname:
        meta["agent_nickname"] = child.agent_nickname
    if child.agent_role:
        meta["agent_role"] = child.agent_role

    bits = ["subagent branch"]
    if child.agent_nickname:
        bits.append(child.agent_nickname)
    summary = " · ".join(bits)

    # Anchor the marker to the dispatch tool_call's timestamp (and line) so the
    # topological sort slots it right after the tool_call. Synthetic markers
    # carry no source_record/uuid; they interpolate by timestamp.
    timestamp = anchor_event.get("timestamp") or child.start_time
    source_line_no = anchor_event.get("source_line_no") or 0

    return {
        "event_id": f"subagent:{child.session_id}",
        "session_id": parent_session_id,
        "kind": "subagent_session",
        "timestamp": timestamp,
        "role": "system",
        "phase": "system",
        "content": summary,
        "source_line_no": source_line_no,
        "raw_record_type": "synthetic",
        **meta,
    }


def _build_event(
    *,
    session_id: str,
    row_info: dict[str, Any],
    block_index: int,
    kind: str,
    role: str,
    phase: str,
    content: str | None,
    extra_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    row = row_info["data"]
    metadata: dict[str, Any] = {
        "raw_record_type": row.get("type"),
        "source_record": row,
        "source_raw_text": row_info["raw_text"],
    }
    if extra_meta:
        metadata.update(extra_meta)
    return {
        "event_id": f"{session_id}:{row_info['source_line_no']}:{block_index}:{kind}",
        "session_id": session_id,
        "kind": kind,
        "timestamp": _row_timestamp(row),
        "role": role,
        "phase": phase,
        "content": content,
        "source_line_no": row_info["source_line_no"],
        **metadata,
    }


def _serialize_session(build: SessionBuild) -> dict[str, Any]:
    return {
        "session_id": build.session_id,
        "raw_session_id": build.raw_session_id,
        "source_path": build.source_path,
        "file_name": build.file_name,
        "parent_session_id": build.parent_session_id,
        "is_subagent": build.is_subagent,
        "agent_nickname": build.agent_nickname,
        "agent_role": build.agent_role,
        "team_name": build.team_name,
        "cli_version": build.cli_version,
        "start_time": build.start_time,
        "end_time": build.end_time,
        "cwd": build.cwd,
        "title": build.title,
        "platform": "claude_code",
        "events": build.events,
        "metrics": _calculate_session_metrics(build),
        "graph_turns": [],
    }


def _build_root_sessions(sessions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    nodes = {
        session["session_id"]: {**session, "children": []}
        for session in sessions
    }
    roots: list[dict[str, Any]] = []
    for session in nodes.values():
        parent_id = session.get("parent_session_id")
        if parent_id and parent_id in nodes:
            nodes[parent_id]["children"].append(session)
            continue
        roots.append(session)

    def sort_children(node: dict[str, Any]) -> None:
        node["children"].sort(
            key=lambda child: (child.get("start_time") or "", child["session_id"])
        )
        for child in node["children"]:
            sort_children(child)

    roots.sort(key=lambda root: (root.get("start_time") or "", root["session_id"]))
    for root in roots:
        sort_children(root)
    return roots


def _derive_session_id(
    *,
    raw_session_id: str | None,
    is_sidechain: bool,
    agent_id: str | None,
    path: Path,
) -> str:
    base_id = raw_session_id or path.stem
    if is_sidechain:
        suffix = agent_id or path.stem
        return f"{base_id}:agent:{suffix}"
    return base_id


def _derive_parent_session_id(
    path: Path,
    raw_session_id: str | None,
    is_sidechain: bool,
) -> str | None:
    if not is_sidechain or not raw_session_id:
        return None
    if path.parent.name == "subagents" and path.parent.parent.name == raw_session_id:
        return raw_session_id
    return None


def _update_session_metadata(build: SessionBuild, row_info: dict[str, Any]) -> None:
    row = row_info["data"]
    timestamp = _row_timestamp(row)
    if timestamp:
        if not build.start_time or timestamp < build.start_time:
            build.start_time = timestamp
        if not build.end_time or timestamp > build.end_time:
            build.end_time = timestamp

    cwd = row.get("cwd")
    if not build.cwd and isinstance(cwd, str) and cwd:
        build.cwd = cwd

    record_type = row.get("type")

    # cli_version is on a top-level `version` field of nearly every row (it's
    # the Claude Code CLI version that emitted the record). Mirrors codex's
    # summary-only `cli_version` (no DB column); first non-empty wins.
    if not build.cli_version:
        version = row.get("version")
        if isinstance(version, str) and version:
            build.cli_version = version

    # Session title prefers the AI-generated `aiTitle` from a `type=ai-title`
    # row (replaces the legacy "first user input" fallback when present).
    if not build.title and record_type == "ai-title":
        ai_title = row.get("aiTitle")
        if isinstance(ai_title, str) and ai_title:
            build.title = ai_title

    # agent_nickname: prefer the explicit `type=agent-name` record's agentName;
    # fall back to the top-level agentId field present on sidechain rows.
    if not build.agent_nickname:
        if record_type == "agent-name":
            agent_name = row.get("agentName")
            if isinstance(agent_name, str) and agent_name:
                build.agent_nickname = agent_name
        agent_id = row.get("agentId")
        if isinstance(agent_id, str) and agent_id:
            build.agent_nickname = agent_id

    if not build.agent_role:
        for key in ("attributionAgent", "attributionSkill", "attributionPlugin"):
            value = row.get(key)
            if isinstance(value, str) and value:
                build.agent_role = value
                break

    if not build.team_name:
        team_name = row.get("teamName")
        if isinstance(team_name, str) and team_name:
            build.team_name = team_name


def _event_uuid(event: dict[str, Any]) -> str | None:
    """Read the source row's ``uuid`` (threading id) from an event."""
    source_record = event.get("source_record")
    if not isinstance(source_record, dict):
        return None
    uuid = source_record.get("uuid")
    return uuid if isinstance(uuid, str) and uuid else None


def _event_parent_uuid(event: dict[str, Any]) -> str | None:
    """Resolve the topological parent uuid for an event.

    Uses ``parentUuid`` when present and non-null. Falls back to
    ``logicalParentUuid`` — set on ``compact_boundary`` rows whose parentUuid
    is null but which fork from a real predecessor via the logical link — so a
    compaction fork lands after its anchor rather than as a session root.
    """
    source_record = event.get("source_record")
    if not isinstance(source_record, dict):
        return None
    parent = source_record.get("parentUuid")
    if isinstance(parent, str) and parent:
        return parent
    logical = source_record.get("logicalParentUuid")
    if isinstance(logical, str) and logical:
        return logical
    return None


def _sort_events_topologically(events: list[dict[str, Any]]) -> None:
    """Order events by the ``parentUuid``/``uuid`` DAG, timestamp as tiebreak.

    Replaces the previous ``(timestamp, source_line_no)`` ordering so events
    follow conversation threading — compaction forks (linked via
    ``logicalParentUuid``) and post-compaction continuation land in the right
    place instead of by raw timestamp/line.

    Robustness:
      - Events without a uuid (metadata rows: ai-title, mode, last-prompt, ...)
        keep the legacy ``(timestamp, source_line_no)`` ordering, slotted by
        timestamp relative to the threaded chain (no-timestamp metadata sorts
        to the front, matching prior behavior).
      - Missing parents, cycles, or duplicate uuids never crash; unvisited
        nodes append at the end in ``(timestamp, line_no)`` order.
      - Multiple events sharing a uuid (multi-block assistant row) keep block
        order via the ``event_id`` tiebreak (it encodes block_index).
    """
    rank_by_uuid, timestamps_by_uuid = _topological_rank_map(events)

    # Pre-sort (timestamp, rank) pairs so metadata events (no uuid) can be
    # slotted by timestamp via a linear scan — sessions are small, N is fine.
    ts_rank_pairs = sorted(
        (timestamps_by_uuid[u], rank_by_uuid[u]) for u in rank_by_uuid
    )

    def interpolation_rank(timestamp: str | None) -> int:
        if not timestamp:
            return -1
        best = -1
        for ts, r in ts_rank_pairs:
            if ts and ts <= timestamp:
                best = r
            else:
                break
        return best

    def sort_key(event: dict[str, Any]) -> tuple:
        uuid = _event_uuid(event)
        if uuid and uuid in rank_by_uuid:
            primary = rank_by_uuid[uuid]
        else:
            primary = interpolation_rank(event.get("timestamp"))
        return (
            primary,
            event.get("timestamp") or "",
            event.get("source_line_no") or 0,
            event.get("event_id") or "",
        )

    events.sort(key=sort_key)


def _topological_rank_map(
    events: list[dict[str, Any]],
) -> tuple[dict[str, int], dict[str, str]]:
    """Compute a Kahn-style topological rank for each uuid in ``events``.

    Returns ``(rank_by_uuid, timestamp_by_uuid)``. Events without a uuid are
    absent from both maps (caller falls back to timestamp interpolation).

    Kahn's algorithm with a heap keyed on ``(timestamp, line_no, uuid)`` so
    among ready nodes the earliest chronologically is emitted first — this
    interleaves branches by wall-clock while still respecting parent->child
    ordering (e.g. an orphan hook attachment lands next to its true neighbors,
    not after an unrelated subtree).
    """
    uuid_to_first_idx: dict[str, int] = {}
    parent_by_uuid: dict[str, str] = {}
    timestamp_by_uuid: dict[str, str] = {}

    for index, event in enumerate(events):
        uuid = _event_uuid(event)
        if not uuid:
            continue
        if uuid not in uuid_to_first_idx:
            uuid_to_first_idx[uuid] = index
            timestamp_by_uuid[uuid] = event.get("timestamp") or ""
        parent = _event_parent_uuid(event)
        if isinstance(parent, str) and parent:
            parent_by_uuid[uuid] = parent

    children: dict[str, list[str]] = {}
    in_degree: dict[str, int] = {uuid: 0 for uuid in uuid_to_first_idx}
    for uuid in uuid_to_first_idx:
        parent = parent_by_uuid.get(uuid)
        if parent and parent in uuid_to_first_idx:
            children.setdefault(parent, []).append(uuid)
            in_degree[uuid] = 1

    def chain_key(uuid: str) -> tuple[str, int, str]:
        first_idx = uuid_to_first_idx[uuid]
        return (
            timestamp_by_uuid.get(uuid, ""),
            events[first_idx].get("source_line_no") or 0,
            uuid,
        )

    heap: list[tuple[str, int, str]] = []
    for uuid in uuid_to_first_idx:
        if in_degree[uuid] == 0:
            heapq.heappush(heap, chain_key(uuid))

    rank_by_uuid: dict[str, int] = {}
    while heap:
        _, _, uuid = heapq.heappop(heap)
        rank_by_uuid[uuid] = len(rank_by_uuid)
        for child in children.get(uuid, []):
            in_degree[child] -= 1
            if in_degree[child] == 0:
                heapq.heappush(heap, chain_key(child))

    # Cycle / orphan safety: any uuid still unvisited appends at the end.
    leftover = [u for u in uuid_to_first_idx if u not in rank_by_uuid]
    leftover.sort(key=chain_key)
    for uuid in leftover:
        rank_by_uuid[uuid] = len(rank_by_uuid)

    return rank_by_uuid, timestamp_by_uuid


def _calculate_session_metrics(build: SessionBuild) -> dict[str, Any]:
    """Aggregate per-row usage into a session-level metrics summary.

    Mirrors the codex metrics shape. claude_code has no session-cumulative
    telemetry block, so totals are derived by summing each assistant row's
    normalized usage. Required because the frontend ImportModal reduce reads
    ``s.metrics.total_input_tokens`` for every session unconditionally — a
    claude_code session without a metrics block would crash that reduce.

    Per Batch 2, the row-level usage is attached to EVERY event produced from
    that assistant row (thinking + text + tool_use blocks). Summing per-event
    would multi-count rows with several blocks, so dedupe by source_line_no:
    exactly one event per source row contributes.
    """
    totals = {"input": 0, "output": 0, "cached": 0, "reasoning": 0}
    last = {"input": 0, "output": 0, "cached": 0, "reasoning": 0}
    counted_lines: set[int] = set()
    for event in build.events:
        line_no = event.get("source_line_no")
        if not isinstance(line_no, int) or line_no in counted_lines:
            continue
        usage = event.get("usage")
        if not isinstance(usage, dict):
            continue
        counted_lines.add(line_no)
        # NB: the loop variable is ``usage_field`` (not ``field``) so the
        # dataclasses ``field`` import isn't shadowed in this scope.
        for key, usage_field in (
            ("input", "input_tokens"),
            ("output", "output_tokens"),
            ("cached", "cached_input_tokens"),
            ("reasoning", "reasoning_output_tokens"),
        ):
            value = _as_int_or_zero(usage.get(usage_field))
            totals[key] += value
            last[key] = value

    total_tokens = totals["input"] + totals["output"]
    last_total = last["input"] + last["output"]
    return {
        "total_input_tokens": totals["input"],
        "total_output_tokens": totals["output"],
        "total_reasoning_output_tokens": totals["reasoning"],
        "total_cached_input_tokens": totals["cached"],
        "total_tokens": total_tokens,
        "last_input_tokens": last["input"],
        "last_output_tokens": last["output"],
        "last_reasoning_output_tokens": last["reasoning"],
        "last_cached_input_tokens": last["cached"],
        "last_total_tokens": last_total,
        "node_count": len(build.events),
        "display_node_count": len(build.events),
        "session_count": 1,
        "imported_file_count": 1,
        # codex always emits these two; claude_code has no task_complete
        # lifecycle event so task_elapsed_sec stays null. Required for shape
        # parity with the frontend ``SessionMetrics`` type.
        "elapsed_sec": _elapsed_seconds(build.start_time, build.end_time),
        "task_elapsed_sec": None,
        "start_time": build.start_time,
        "end_time": build.end_time,
    }


def _elapsed_seconds(start_time: str | None, end_time: str | None) -> float:
    """Wall-clock span in seconds (rounded to 1 decimal), 0.0 if unparseable.

    Mirrors codex's ``_elapsed_seconds`` so the metrics block shape matches
    across platforms. Kept local to avoid a cross-adapter import.
    """
    start_dt = _parse_timestamp(start_time)
    end_dt = _parse_timestamp(end_time)
    if start_dt is None or end_dt is None:
        return 0.0
    return round(max((end_dt - start_dt).total_seconds(), 0.0), 1)


def _parse_timestamp(timestamp: str | None) -> datetime | None:
    if not timestamp:
        return None
    try:
        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _derive_title(events: list[dict[str, Any]]) -> str | None:
    for event in events:
        if event.get("kind") != "user_input":
            continue
        content = _coerce_text(event.get("content"))
        if not content:
            continue
        compact = " ".join(content.split())
        if compact:
            return compact[:120]
    return None


def _row_timestamp(row: dict[str, Any]) -> str | None:
    timestamp = row.get("timestamp")
    if isinstance(timestamp, str) and timestamp:
        return timestamp
    snapshot = row.get("snapshot")
    if isinstance(snapshot, dict):
        snapshot_timestamp = snapshot.get("timestamp")
        if isinstance(snapshot_timestamp, str) and snapshot_timestamp:
            return snapshot_timestamp
    return None


def _fallback_cwd(path: Path, is_sidechain: bool) -> str:
    if is_sidechain and path.parent.name == "subagents":
        return str(path.parent.parent)
    return str(path.parent)


def _metadata_content_preview(row: dict[str, Any]) -> str:
    record_type = row.get("type")
    if record_type == "mode":
        return f"Mode: {_coerce_text(row.get('mode')) or 'unknown'}"
    if record_type == "permission-mode":
        return f"Permission mode: {_coerce_text(row.get('permissionMode')) or 'unknown'}"
    if record_type == "ai-title":
        return f"AI title: {_coerce_text(row.get('aiTitle')) or ''}".strip()
    if record_type == "agent-name":
        return f"Agent name: {_coerce_text(row.get('agentName')) or ''}".strip()
    if record_type == "file-history-snapshot":
        return "File history snapshot"
    if record_type == "last-prompt":
        return _coerce_text(row.get("lastPrompt")) or "Last prompt"
    if record_type == "summary":
        return _coerce_text(row.get("summary")) or "Summary"
    if record_type == "attachment":
        attachment = row.get("attachment")
        if isinstance(attachment, dict):
            attachment_type = _coerce_text(attachment.get("type")) or "attachment"
            return f"Attachment: {attachment_type}"
        return "Attachment"
    return _coerce_text(record_type) or "Claude metadata"


def _coerce_text(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
                continue
            if not isinstance(item, dict):
                parts.append(json.dumps(item, ensure_ascii=False))
                continue
            for key in ("text", "content", "thinking"):
                candidate = item.get(key)
                if isinstance(candidate, str):
                    parts.append(candidate)
                    break
            else:
                parts.append(json.dumps(item, ensure_ascii=False))
        compact = "\n".join(part for part in parts if part)
        return compact or None
    if isinstance(value, dict):
        for key in ("text", "content", "thinking"):
            candidate = value.get(key)
            if isinstance(candidate, str):
                return candidate
        return json.dumps(value, ensure_ascii=False)
    if value is None:
        return None
    return str(value)


def _first_string(values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value:
            return value
    return None
