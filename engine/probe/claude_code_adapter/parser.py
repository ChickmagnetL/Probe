from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from probe.codex_adapter.reader import build_parse_error

from .reader import discover_claude_code_files

_VISIBLE_SYSTEM_SUBTYPES = {
    "api_error": ("system_event", False),
    "compact_boundary": ("compaction_event", False),
    "local_command": ("tool_event", False),
}
_HIDDEN_SYSTEM_SUBTYPES = frozenset(
    {"away_summary", "informational", "turn_duration"}
)
_HIDDEN_METADATA_TYPES = frozenset(
    {"ai-title", "attachment", "file-history-snapshot", "last-prompt", "mode", "permission-mode"}
)


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
    start_time: str | None = None
    end_time: str | None = None
    cwd: str | None = None
    title: str | None = None
    events: list[dict[str, Any]] = field(default_factory=list)


def parse_claude_code(input_path: str | Path | list[str | Path]) -> dict[str, Any]:
    files = discover_claude_code_files(input_path)
    sessions: list[dict[str, Any]] = []
    parsed_records = 0
    parse_errors = 0
    unknown_record_count = 0
    unknown_route_keys: set[str] = set()

    for path in files:
        build, counts = _parse_file(path)
        sessions.append(_serialize_session(build))
        parsed_records += counts["parsed_records"]
        parse_errors += counts["parse_errors"]
        unknown_record_count += counts["unknown_record_count"]
        unknown_route_keys.update(counts["unknown_route_keys"])

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
        )
        build.events.extend(events)
        unknown_record_count += event_unknown_count
        unknown_route_keys.update(event_unknown_keys)

    build.events.sort(
        key=lambda event: (
            event.get("timestamp") or "",
            event.get("source_line_no") or 0,
            event["event_id"],
        )
    )
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
) -> tuple[list[dict[str, Any]], int, set[str]]:
    row = row_info["data"]
    record_type = row["type"]

    if record_type == "user":
        return _events_for_user_row(session_id=session_id, row_info=row_info)
    if record_type == "assistant":
        return _events_for_assistant_row(session_id=session_id, row_info=row_info)
    if record_type == "system":
        return _events_for_system_row(session_id=session_id, row_info=row_info)
    if record_type in _HIDDEN_METADATA_TYPES:
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
                    extra_meta={"graph_hidden": True},
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
                        extra_meta={"graph_hidden": True, "meta_role": "user"},
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
                    extra_meta={"raw_content_type": block_type},
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
                    extra_meta={
                        "call_id": item.get("tool_use_id"),
                        "is_error": bool(item.get("is_error", False)),
                        "raw_content_type": block_type,
                    },
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
                    extra_meta={"raw_content_type": block_type},
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
                    extra_meta={"raw_content_type": block_type},
                )
            )
            continue
        if block_type == "tool_use":
            events.append(
                _build_event(
                    session_id=session_id,
                    row_info=row_info,
                    block_index=index,
                    kind="tool_call",
                    role="assistant",
                    phase="tool",
                    content=_coerce_text(item.get("name")),
                    extra_meta={
                        "call_id": item.get("id"),
                        "tool_input": item.get("input"),
                        "tool_name": item.get("name"),
                        "raw_content_type": block_type,
                    },
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
                extra_meta={"graph_hidden": True, "raw_content_type": block_type},
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
                    extra_meta={"graph_hidden": hidden, "system_subtype": subtype},
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
                },
            )
        ],
        0 if subtype in _HIDDEN_SYSTEM_SUBTYPES else 1,
        set() if subtype in _HIDDEN_SYSTEM_SUBTYPES else {f"system:{subtype or 'unknown'}"},
    )


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
        "start_time": build.start_time,
        "end_time": build.end_time,
        "cwd": build.cwd,
        "title": build.title,
        "platform": "claude_code",
        "events": build.events,
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

    if not build.agent_nickname:
        agent_id = row.get("agentId")
        if isinstance(agent_id, str) and agent_id:
            build.agent_nickname = agent_id

    if not build.agent_role:
        for key in ("attributionAgent", "attributionSkill", "attributionPlugin"):
            value = row.get(key)
            if isinstance(value, str) and value:
                build.agent_role = value
                break


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
    if record_type == "file-history-snapshot":
        return "File history snapshot"
    if record_type == "last-prompt":
        return _coerce_text(row.get("lastPrompt")) or "Last prompt"
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
