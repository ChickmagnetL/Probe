from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import ExtractionBuffers, REQUIRED_JSONL_TABLES
from .token_estimator import estimate_text_tokens

EVENT_ORDER = {
    "agents_md": 10,
    "user_input": 10,
    "instruction": 20,
    "assistant_update": 40,
    "tool_call": 50,
    "tool_output": 60,
    "assistant_output": 70,
    "subagent_session": 80,
}

USER_SIDE_KINDS = {"user_input", "agents_md", "instruction"}
ASSISTANT_MESSAGE_KINDS = {"assistant_output", "assistant_update"}
ASSISTANT_SIDE_KINDS = {
    "assistant_update",
    "assistant_output",
    "tool_call",
    "tool_output",
    "subagent_session",
}
INPUT_DETAIL_TITLE = {
    "input_prompt": "附加输入 · Prompt/指令",
    "input_image": "附加输入 · 图片",
    "input_hook": "附加输入 · Hook",
    "input_attachment": "附加输入 · 附件",
    "input_context": "附加输入 · 上下文",
}
INPUT_DETAIL_CONTENT_LABEL = {
    "input_prompt": "Prompt 内容",
    "input_image": "图片路径",
    "input_hook": "Hook 信息",
    "input_attachment": "附加内容",
    "input_context": "上下文内容",
}
AUX_INPUT_PREFIXES = (
    "# AGENTS.md instructions",
    "<environment_context>",
    "<session-context>",
    "<current-state>",
    "<workflow>",
    "<guidelines>",
    "<instructions>",
    "<skill>",
    "<turn_aborted>",
    "The following is the Codex agent history",
    "Follow exactly the worker role file",
    "You are performing a risk assessment of a coding-agent tool call",
)
IMAGE_PATH_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg")
GUARDIAN_REVIEWED_SESSION_RE = re.compile(
    r"Reviewed Codex session id:\s*([0-9a-fA-F-]+)"
)


@dataclass
class SessionBuild:
    session_id: str
    source_path: str | None = None
    file_name: str | None = None
    source_raw_record_id: str | None = None
    source_line_no: int | None = None
    source_record: dict[str, Any] | None = None
    source_raw_text: str | None = None
    base_instructions_text: str | None = None
    parent_session_id: str | None = None
    is_subagent: bool = False
    is_synthetic: bool = False
    agent_nickname: str | None = None
    agent_role: str | None = None
    start_time: str | None = None
    events: list[dict[str, Any]] = field(default_factory=list)
    telemetry: list[dict[str, Any]] = field(default_factory=list)
    lifecycle: list[dict[str, Any]] = field(default_factory=list)
    child_ids: set[str] = field(default_factory=set)
    branch_meta: dict[str, dict[str, Any]] = field(default_factory=dict)


def build_summary(buffers: ExtractionBuffers) -> dict[str, Any]:
    sessions: dict[str, SessionBuild] = {}
    raw_record_lookup = _build_raw_record_lookup(buffers)
    source_to_session_id = _seed_sessions(buffers, sessions)
    _collect_collaboration_metadata(buffers, sessions)
    _collect_events(buffers, sessions, source_to_session_id)
    _attach_source_records(sessions, raw_record_lookup)
    _link_guardian_sessions_to_review_targets(sessions)
    _ensure_synthetic_roots(sessions)

    flat_sessions = [
        _serialize_imported_session(sessions[session_id])
        for session_id in _sorted_imported_session_ids(sessions)
    ]
    root_sessions = [
        _serialize_tree(session_id, sessions)
        for session_id in _sorted_root_session_ids(sessions)
    ]

    return {
        "total_files": len(buffers.file_manifest),
        "parsed_records": len(buffers.raw_records),
        "parse_errors": len(buffers.parse_errors),
        "imported_session_count": len(flat_sessions),
        "root_session_count": len(root_sessions),
        "sessions": flat_sessions,
        "root_sessions": root_sessions,
        "table_counts": {k: len(getattr(buffers, k)) for k in REQUIRED_JSONL_TABLES},
    }


def _seed_sessions(
    buffers: ExtractionBuffers,
    sessions: dict[str, SessionBuild],
) -> dict[str, str]:
    source_to_session_id: dict[str, str] = {}

    for row in buffers.conversation_meta_raw:
        session_id = _session_id_from_row(row)
        session = _ensure_session(sessions, session_id)
        source_path = _string(row.get("source_path"))
        if source_path:
            session.source_path = source_path
            session.file_name = Path(source_path).name
            source_to_session_id[source_path] = session_id
        if not session.source_raw_record_id:
            session.source_raw_record_id = _string(row.get("raw_record_id"))
        if session.source_line_no is None and isinstance(row.get("source_line_no"), int):
            session.source_line_no = row.get("source_line_no")
        if not session.base_instructions_text:
            session.base_instructions_text = _string(row.get("base_instructions_text"))
        thread_spawn = row.get("thread_spawn")
        thread_spawn = thread_spawn if isinstance(thread_spawn, dict) else {}
        parent_session_id = _string(thread_spawn.get("parent_thread_id"))
        if parent_session_id:
            session.parent_session_id = parent_session_id
            session.is_subagent = True

        # Handle source.subagent field (e.g., Guardian subagent)
        source = row.get("source")
        if isinstance(source, dict):
            subagent_info = source.get("subagent")
            if isinstance(subagent_info, dict):
                session.is_subagent = True
                # Extract agent role from subagent.other or other fields
                subagent_type = _string(subagent_info.get("other")) or _string(
                    subagent_info.get("type")
                )
                if subagent_type and not session.agent_role:
                    session.agent_role = subagent_type

        session.agent_nickname = _string(row.get("agent_nickname")) or _string(
            thread_spawn.get("agent_nickname")
        )
        session.agent_role = session.agent_role or _string(row.get("agent_role")) or _string(
            thread_spawn.get("agent_role")
        )
        session.start_time = _string(row.get("conversation_started_at")) or _string(
            row.get("timestamp")
        )

    for file_row in buffers.file_manifest:
        source_path = _string(file_row.get("source_path"))
        if not source_path:
            continue
        session_id = _string(file_row.get("conversation_id")) or source_path
        session = _ensure_session(sessions, session_id)
        session.source_path = source_path
        session.file_name = Path(source_path).name
        source_to_session_id[source_path] = session_id

    return source_to_session_id


def _collect_collaboration_metadata(
    buffers: ExtractionBuffers,
    sessions: dict[str, SessionBuild],
) -> None:
    for row in buffers.collaboration_events:
        sender_session_id = _string(row.get("sender_thread_id"))
        if not sender_session_id:
            continue

        child_session_id = _string(row.get("new_thread_id")) or _string(
            row.get("receiver_thread_id")
        )
        if child_session_id:
            _register_child_link(sessions, sender_session_id, child_session_id, row)

        agent_statuses = row.get("agent_statuses")
        if isinstance(agent_statuses, list):
            for status_row in agent_statuses:
                if not isinstance(status_row, dict):
                    continue
                thread_id = _string(status_row.get("thread_id"))
                if not thread_id:
                    continue
                _register_child_link(
                    sessions,
                    sender_session_id,
                    thread_id,
                    {
                        "timestamp": row.get("timestamp"),
                        "status": status_row.get("status"),
                        "receiver_agent_nickname": status_row.get("agent_nickname"),
                        "receiver_agent_role": status_row.get("agent_role"),
                    },
                )

        statuses = row.get("statuses")
        if isinstance(statuses, dict):
            for thread_id, status in statuses.items():
                if not isinstance(thread_id, str) or not thread_id:
                    continue
                _register_child_link(
                    sessions,
                    sender_session_id,
                    thread_id,
                    {
                        "timestamp": row.get("timestamp"),
                        "status": status,
                    },
                )


def _register_child_link(
    sessions: dict[str, SessionBuild],
    parent_session_id: str,
    child_session_id: str,
    row: dict[str, Any],
) -> None:
    parent = _ensure_session(sessions, parent_session_id)
    child = _ensure_session(sessions, child_session_id)
    parent.child_ids.add(child_session_id)
    if not child.parent_session_id:
        child.parent_session_id = parent_session_id
    child.is_subagent = True

    child.agent_nickname = child.agent_nickname or _string(
        row.get("new_agent_nickname")
    ) or _string(row.get("receiver_agent_nickname"))
    child.agent_role = child.agent_role or _string(row.get("new_agent_role")) or _string(
        row.get("receiver_agent_role")
    )

    branch_meta = parent.branch_meta.setdefault(child_session_id, {})
    timestamp = _string(row.get("timestamp"))
    if timestamp and (
        not branch_meta.get("timestamp")
        or _sort_key_from_timestamp(timestamp)
        < _sort_key_from_timestamp(branch_meta.get("timestamp"))
    ):
        branch_meta["timestamp"] = timestamp

    prompt = _string(row.get("prompt"))
    if prompt:
        branch_meta["prompt_preview"] = _truncate(prompt, 180)

    status_preview = _flatten_status(row.get("status"))
    if status_preview:
        branch_meta["status_preview"] = status_preview


def _collect_events(
    buffers: ExtractionBuffers,
    sessions: dict[str, SessionBuild],
    source_to_session_id: dict[str, str],
) -> None:
    for row in buffers.message_items_raw:
        session = _session_for_row(row, sessions, source_to_session_id)
        session.events.append(_build_message_event(row, session.session_id))

    for row in buffers.tool_calls_raw:
        session = _session_for_row(row, sessions, source_to_session_id)
        session.events.append(_build_tool_call_event(row, session.session_id))

    for row in buffers.tool_call_outputs_raw:
        session = _session_for_row(row, sessions, source_to_session_id)
        session.events.append(_build_tool_output_event(row, session.session_id))

    for row in buffers.telemetry_events:
        session = _session_for_row(row, sessions, source_to_session_id)
        session.telemetry.append(_build_telemetry_snapshot(row))

    for row in buffers.lifecycle_events:
        session = _session_for_row(row, sessions, source_to_session_id)
        session.lifecycle.append(dict(row))


def _ensure_synthetic_roots(sessions: dict[str, SessionBuild]) -> None:
    parent_ids = {
        session.parent_session_id
        for session in sessions.values()
        if session.parent_session_id
    }
    for parent_session_id in sorted(parent_ids):
        if parent_session_id in sessions:
            continue
        sessions[parent_session_id] = SessionBuild(
            session_id=parent_session_id,
            is_synthetic=True,
        )

    for session in list(sessions.values()):
        if session.parent_session_id and session.parent_session_id in sessions:
            sessions[session.parent_session_id].child_ids.add(session.session_id)


def _link_guardian_sessions_to_review_targets(
    sessions: dict[str, SessionBuild],
) -> None:
    for session in sessions.values():
        if session.agent_role != "guardian":
            continue
        if session.parent_session_id:
            continue

        reviewed_session_id = _extract_reviewed_session_id_from_events(session.events)
        if not reviewed_session_id or reviewed_session_id == session.session_id:
            continue
        if reviewed_session_id not in sessions:
            continue

        session.parent_session_id = reviewed_session_id
        session.is_subagent = True
        sessions[reviewed_session_id].child_ids.add(session.session_id)


def _extract_reviewed_session_id_from_events(events: list[dict[str, Any]]) -> str | None:
    for event in events:
        for text in (
            _string(event.get("content")),
            _string(event.get("summary")),
        ):
            if not text:
                continue
            match = GUARDIAN_REVIEWED_SESSION_RE.search(text)
            if match:
                return match.group(1)
    return None


def _serialize_imported_session(session: SessionBuild) -> dict[str, Any]:
    own_metrics = _calculate_own_metrics(session)
    own_events = _build_session_events(session, own_metrics)
    graph_turns = _build_graph_turns(own_events)
    _attach_session_input_preamble(session, graph_turns)
    return _session_payload(
        session=session,
        own_events=own_events,
        timeline=own_events,
        graph_turns=graph_turns,
        own_metrics=own_metrics,
        aggregate_metrics=own_metrics,
        child_sessions=[],
    )


def _serialize_tree(
    session_id: str,
    sessions: dict[str, SessionBuild],
) -> dict[str, Any]:
    session = sessions[session_id]
    child_sessions = [
        _serialize_tree(child_id, sessions)
        for child_id in _sorted_child_ids(session, sessions)
    ]
    own_metrics = _calculate_own_metrics(session)
    own_events = _build_session_events(session, own_metrics)
    aggregate_metrics = _combine_metrics(
        own_metrics,
        [child_session["metrics"] for child_session in child_sessions],
    )
    timeline = _build_timeline(session, own_events, child_sessions)
    graph_turns = _build_graph_turns(timeline)
    _attach_session_input_preamble(session, graph_turns)
    return _session_payload(
        session=session,
        own_events=own_events,
        timeline=timeline,
        graph_turns=graph_turns,
        own_metrics=own_metrics,
        aggregate_metrics=aggregate_metrics,
        child_sessions=child_sessions,
    )


def _session_payload(
    *,
    session: SessionBuild,
    own_events: list[dict[str, Any]],
    timeline: list[dict[str, Any]],
    graph_turns: list[dict[str, Any]],
    own_metrics: dict[str, Any],
    aggregate_metrics: dict[str, Any],
    child_sessions: list[dict[str, Any]],
) -> dict[str, Any]:
    start_time = aggregate_metrics.get("start_time") or own_metrics.get("start_time")
    end_time = aggregate_metrics.get("end_time") or own_metrics.get("end_time")
    return {
        "session_id": session.session_id,
        "short_id": _short_id(session.session_id),
        "display_name": _display_name(session),
        "source_path": session.source_path,
        "file_name": session.file_name,
        "source_record": session.source_record,
        "source_raw_text": session.source_raw_text,
        "source_label": session.file_name or "主线程占位视图",
        "parent_session_id": session.parent_session_id,
        "is_subagent": session.is_subagent,
        "is_synthetic": session.is_synthetic,
        "agent_nickname": session.agent_nickname,
        "agent_role": session.agent_role,
        "start_time": start_time,
        "end_time": end_time,
        "own_metrics": own_metrics,
        "metrics": aggregate_metrics,
        "events": own_events,
        "timeline": timeline,
        "graph_turns": graph_turns,
        "child_sessions": child_sessions,
    }


def _build_session_events(
    session: SessionBuild,
    own_metrics: dict[str, Any],
) -> list[dict[str, Any]]:
    events = [dict(event) for event in session.events]
    events.sort(key=_event_sort_key)
    _attach_usage_badge(events, own_metrics)
    return events


def _build_timeline(
    session: SessionBuild,
    own_events: list[dict[str, Any]],
    child_sessions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    timeline = [dict(event) for event in own_events]

    for child_session in child_sessions:
        branch_meta = session.branch_meta.get(child_session["session_id"], {})
        title = f"子代理分支 · {child_session['display_name']}"
        prompt_preview = _string(branch_meta.get("prompt_preview"))
        if prompt_preview:
            title = f"{title}"
        timeline.append(
            {
                "event_id": f"subagent:{child_session['session_id']}",
                "kind": "subagent_session",
                "session_id": session.session_id,
                "timestamp": branch_meta.get("timestamp")
                or child_session.get("start_time")
                or child_session["metrics"].get("start_time"),
                "title": title,
                "summary": _subagent_summary(child_session, branch_meta),
                "detail_note": "从左侧栏聚焦这个子会话时，会突出当前子链，其余分支会被弱化显示。",
                "prompt_preview": prompt_preview,
                "child_session_id": child_session["session_id"],
            }
        )

    timeline.sort(key=_event_sort_key)
    return timeline


def _build_graph_turns(timeline: list[dict[str, Any]]) -> list[dict[str, Any]]:
    turns: list[dict[str, Any]] = []
    pending_user_events: list[dict[str, Any]] = []
    pending_assistant_events: list[dict[str, Any]] = []

    def flush_turn() -> None:
        nonlocal pending_user_events, pending_assistant_events
        if not pending_user_events and not pending_assistant_events:
            return

        input_anchor, input_details = _resolve_input_turn(pending_user_events)
        output_anchor, output_details = _resolve_output_turn(pending_assistant_events)
        turn_id = (
            _string(input_anchor.get("event_id")) if input_anchor else None
        ) or (
            _string(output_anchor.get("event_id")) if output_anchor else None
        ) or f"turn:{len(turns) + 1}"

        turns.append(
            {
                "turn_id": f"graph-turn:{turn_id}",
                "input": input_anchor,
                "input_details": input_details,
                "output": output_anchor,
                "output_details": output_details,
            }
        )
        pending_user_events = []
        pending_assistant_events = []

    for item in timeline:
        event = dict(item)
        kind = _string(event.get("kind")) or ""
        if kind in USER_SIDE_KINDS:
            if pending_assistant_events:
                flush_turn()
            pending_user_events.append(event)
            continue
        pending_assistant_events.append(event)

    flush_turn()
    return turns


def _resolve_input_turn(
    events: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    if not events:
        return None, []

    user_events = [
        dict(event) for event in events if _string(event.get("kind")) in ("user_input", "agents_md")
    ]
    input_anchor = _pick_primary_input_anchor(user_events)
    input_details: list[dict[str, Any]] = []

    for event in events:
        if input_anchor and event.get("event_id") == input_anchor.get("event_id"):
            continue
        input_details.append(_build_input_detail_event(event))

    if input_anchor:
        input_details.extend(_build_input_part_details(input_anchor))

    input_details.sort(key=_detail_sort_key)
    return input_anchor, input_details


def _resolve_output_turn(
    events: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    if not events:
        return None, []

    # Only assistant_output can be the main anchor
    assistant_outputs = [
        dict(event)
        for event in events
        if _string(event.get("kind")) == "assistant_output"
    ]

    output_anchor = assistant_outputs[-1] if assistant_outputs else None

    # All other events become output_details
    output_details = [
        dict(event)
        for event in events
        if output_anchor is None
        or event.get("event_id") != output_anchor.get("event_id")
    ]
    output_details.sort(key=_detail_sort_key)
    return output_anchor, output_details


def _pick_primary_input_anchor(
    user_events: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not user_events:
        return None

    primary_candidates = [
        event for event in user_events if not _looks_like_aux_input(event)
    ]
    if primary_candidates:
        return primary_candidates[-1]
    return user_events[-1]


def _looks_like_aux_input(event: dict[str, Any]) -> bool:
    text = _string(event.get("content")) or _string(event.get("summary")) or ""
    normalized = text.lstrip()
    if not normalized:
        return False
    if any(normalized.startswith(prefix) for prefix in AUX_INPUT_PREFIXES):
        return True
    if "request action you are assessing" in normalized:
        return True
    if "Write only inside this write set" in normalized:
        return True
    if normalized.count("<") >= 4 and normalized.count(">") >= 4:
        return True
    return False


def _is_guardian_assessment_message(event: dict[str, Any]) -> bool:
    """Check if this is a Guardian subagent assessment message.

    Guardian messages contain nested Codex conversation history and should not
    have their content_parts expanded to avoid creating too many input details.
    """
    text = _string(event.get("content")) or _string(event.get("summary")) or ""
    normalized = text.lstrip()
    if not normalized:
        return False
    # Guardian messages typically start with this phrase
    if "request action you are assessing" in normalized:
        return True
    # Also check for the standard Guardian opening
    if normalized.startswith("The following is the Codex agent history"):
        return True
    return False


def _build_input_detail_event(event: dict[str, Any]) -> dict[str, Any]:
    detail_kind = _classify_input_detail_kind(event)
    detail_content = _string(event.get("content")) or _jsonish_text(
        event.get("content_parts")
    )
    descriptor = _describe_input_detail(
        detail_kind=detail_kind,
        content=detail_content,
        source_title=_string(event.get("title")),
    )
    return {
        "event_id": f"input-detail:{event.get('event_id')}",
        "session_id": event.get("session_id"),
        "timestamp": event.get("timestamp"),
        "kind": detail_kind,
        "title": descriptor["title"],
        "summary": descriptor["summary"]
        or _string(event.get("summary"))
        or _truncate(detail_content or "没有可见内容", 120),
        "content": detail_content,
        "content_label": descriptor["content_label"],
        "intro": descriptor["intro"],
        "estimated_input_tokens": estimate_text_tokens(detail_content),
        "detail_note": event.get("title"),
        "raw_record_id": event.get("raw_record_id"),
        "source_path": event.get("source_path"),
        "source_line_no": event.get("source_line_no"),
        "source_record": event.get("source_record"),
        "source_raw_text": event.get("source_raw_text"),
    }


def _build_input_part_details(anchor: dict[str, Any]) -> list[dict[str, Any]]:
    parts = anchor.get("content_parts")
    if not isinstance(parts, list) or not parts:
        return []
    if not _should_expand_input_parts(parts):
        return []

    # Skip expanding content_parts for Guardian subagent messages
    # These contain nested Codex conversation history and create too many details
    if _is_guardian_assessment_message(anchor):
        return []

    details: list[dict[str, Any]] = []
    for index, part in enumerate(parts):
        if not isinstance(part, dict):
            continue
        detail_kind = _classify_input_part_kind(part)
        content = _extract_input_part_content(part)
        if not content:
            continue
        descriptor = _describe_input_detail(
            detail_kind=detail_kind,
            content=content,
            part_type=_string(part.get("type")),
        )
        details.append(
            {
                "event_id": f"{anchor.get('event_id')}:part:{index}",
                "session_id": anchor.get("session_id"),
                "timestamp": anchor.get("timestamp"),
                "kind": detail_kind,
                "title": descriptor["title"],
                "summary": descriptor["summary"] or _truncate(content, 120),
                "content": content,
                "content_label": descriptor["content_label"],
                "intro": descriptor["intro"],
                "estimated_input_tokens": estimate_text_tokens(content),
                "detail_note": _string(part.get("type")),
                "raw_record_id": anchor.get("raw_record_id"),
                "source_path": anchor.get("source_path"),
                "source_line_no": anchor.get("source_line_no"),
                "source_record": anchor.get("source_record"),
                "source_raw_text": anchor.get("source_raw_text"),
            }
        )
    return details


def _should_expand_input_parts(parts: list[Any]) -> bool:
    if len(parts) > 1:
        return True
    for part in parts:
        if isinstance(part, dict) and _part_needs_detail(part):
            return True
    return False


def _part_needs_detail(part: dict[str, Any]) -> bool:
    part_type = (_string(part.get("type")) or "").lower()
    if part_type and part_type not in {"input_text", "text"}:
        return True
    content = _extract_input_part_content(part)
    if not content:
        return False
    normalized = content.lower()
    return "hook" in normalized or normalized.endswith(IMAGE_PATH_SUFFIXES)


def _classify_input_detail_kind(event: dict[str, Any]) -> str:
    if _string(event.get("kind")) == "instruction":
        return "input_prompt"

    parts = event.get("content_parts")
    if isinstance(parts, list):
        for part in parts:
            if not isinstance(part, dict):
                continue
            detail_kind = _classify_input_part_kind(part)
            if detail_kind != "input_context":
                return detail_kind

    text = (_string(event.get("content")) or "").lower()
    if "hook" in text:
        return "input_hook"
    if text.endswith(IMAGE_PATH_SUFFIXES):
        return "input_image"
    if _looks_like_aux_input(event):
        return "input_prompt"
    return "input_context"


def _classify_input_part_kind(part: dict[str, Any]) -> str:
    part_type = (_string(part.get("type")) or "").lower()
    content = (_extract_input_part_content(part) or "").lower()
    if "image" in part_type or content.endswith(IMAGE_PATH_SUFFIXES):
        return "input_image"
    if "hook" in part_type or "hook" in content:
        return "input_hook"
    if "prompt" in part_type or "prompt" in part:
        return "input_prompt"
    if part_type and part_type not in {"input_text", "text"}:
        return "input_attachment"
    if _looks_like_prompt_text(content):
        return "input_prompt"
    return "input_context"


def _extract_input_part_content(part: dict[str, Any]) -> str | None:
    for key in (
        "text",
        "content",
        "prompt",
        "image_path",
        "path",
        "file_path",
        "local_path",
        "url",
        "uri",
        "hook",
        "value",
    ):
        value = part.get(key)
        text = _string(value)
        if text:
            return text
    return _jsonish_text(part)


def _looks_like_prompt_text(content: str) -> bool:
    normalized = content.lstrip()
    if not normalized:
        return False
    if any(normalized.startswith(prefix.lower()) for prefix in AUX_INPUT_PREFIXES):
        return True
    if "prompt" in normalized and len(normalized) > 40:
        return True
    return False


def _describe_input_detail(
    *,
    detail_kind: str,
    content: str | None,
    source_title: str | None = None,
    part_type: str | None = None,
) -> dict[str, str]:
    normalized = (content or "").lstrip()
    normalized_lower = normalized.lower()
    part_type_lower = (part_type or "").lower()

    if normalized.startswith("You are Codex"):
        return {
            "title": "系统内置规则",
            "summary": "Codex 默认系统规则（base_instructions）",
            "content_label": "规则内容",
            "intro": "Codex 启动时自动附带给模型的默认规则，不是用户手动输入。",
        }

    if normalized.startswith("# AGENTS.md instructions"):
        return {
            "title": "项目规则（AGENTS.md）",
            "summary": "项目规则（AGENTS.md）",
            "content_label": "规则内容",
            "intro": "仓库里的 AGENTS.md 规则，会和本轮输入一起提供给模型。",
        }

    if normalized.startswith("<environment_context>"):
        return {
            "title": "运行环境信息",
            "summary": "运行环境信息",
            "content_label": "环境内容",
            "intro": "当前工作目录、日期、时区等运行环境信息，会随本轮输入一起提供给模型。",
        }

    if source_title == "开发者指令":
        return {
            "title": "开发者附加规则",
            "summary": "开发者附加规则",
            "content_label": "规则内容",
            "intro": "这是开发者在本轮额外附带给模型的执行规则，不是用户直接输入的文本。",
        }

    if detail_kind == "input_hook" or "hook" in normalized_lower or "hook" in part_type_lower:
        return {
            "title": "Hook 输入",
            "summary": "Hook 输入",
            "content_label": "Hook 内容",
            "intro": "这是本轮额外附带的 Hook 参数或 Hook 名称，会一起传给模型。",
        }

    if detail_kind == "input_image":
        return {
            "title": "图片输入",
            "summary": "图片输入",
            "content_label": "图片路径",
            "intro": "这是和本轮提问一起传给模型的图片输入。",
        }

    if detail_kind == "input_attachment":
        return {
            "title": "附带附件",
            "summary": "附带附件",
            "content_label": "附件内容",
            "intro": "这是和本轮输入一起附带的额外附件或结构化内容。",
        }

    if detail_kind == "input_prompt":
        return {
            "title": "附带规则/指令",
            "summary": "附带规则/指令",
            "content_label": "规则内容",
            "intro": "这段内容不是用户自然语言提问，而是本轮一起传给模型的附加规则或提示。",
        }

    return {
        "title": INPUT_DETAIL_TITLE[detail_kind],
        "summary": _truncate(content or "", 120),
        "content_label": INPUT_DETAIL_CONTENT_LABEL[detail_kind],
        "intro": "这是和用户输入一起提供给模型的补充上下文。",
    }


def _build_synthetic_output_anchor(events: list[dict[str, Any]]) -> dict[str, Any]:
    tail_event = dict(events[-1])
    return {
        "event_id": f"synthetic-output:{tail_event.get('event_id')}",
        "session_id": tail_event.get("session_id"),
        "timestamp": tail_event.get("timestamp"),
        "kind": "assistant_output",
        "title": "AI 输出",
        "summary": _truncate(
            _string(tail_event.get("summary")) or "这轮只记录了中间产物，没有单独的最终回复。",
            120,
        ),
        "content": None,
        "content_label": "消息内容",
        "detail_note": "这轮没有单独的 assistant message，因此用中间产物生成了一个主锚点。",
        "raw_record_id": tail_event.get("raw_record_id"),
        "source_path": tail_event.get("source_path"),
        "source_line_no": tail_event.get("source_line_no"),
        "source_record": tail_event.get("source_record"),
        "source_raw_text": tail_event.get("source_raw_text"),
    }


def _attach_session_input_preamble(
    session: SessionBuild,
    graph_turns: list[dict[str, Any]],
) -> None:
    if not graph_turns:
        return

    first_turn = next((turn for turn in graph_turns if turn.get("input")), None)
    if first_turn is None:
        return

    preamble_details = _build_session_preamble_details(session)
    if not preamble_details:
        return

    existing_ids = {
        _string(detail.get("event_id")) or ""
        for detail in first_turn.get("input_details", [])
    }
    input_details = list(first_turn.get("input_details", []))
    for detail in preamble_details:
        event_id = _string(detail.get("event_id")) or ""
        if event_id and event_id not in existing_ids:
            input_details.append(detail)
            existing_ids.add(event_id)

    input_details.sort(key=_detail_sort_key)
    first_turn["input_details"] = input_details


def _build_session_preamble_details(session: SessionBuild) -> list[dict[str, Any]]:
    details: list[dict[str, Any]] = []
    content = _string(session.base_instructions_text)
    if not content:
        return details

    details.append(
        {
            "event_id": f"session-input:{session.session_id}:base-instructions",
            "session_id": session.session_id,
            "timestamp": session.start_time,
            "kind": "system_prompt",
            "title": "系统内置规则",
            "summary": "Codex 默认系统规则（base_instructions）",
            "content": content,
            "content_label": "规则内容",
            "intro": "Codex 启动时自动附带给模型的默认规则，不是用户手动输入。",
            "estimated_input_tokens": estimate_text_tokens(content),
            "detail_note": "base_instructions",
            "raw_record_id": session.source_raw_record_id,
            "source_path": session.source_path,
            "source_line_no": session.source_line_no,
            "source_record": session.source_record,
            "raw_text": session.source_raw_text,
        }
    )
    return details


def _calculate_own_metrics(session: SessionBuild) -> dict[str, Any]:
    latest_telemetry = None
    if session.telemetry:
        telemetry = sorted(session.telemetry, key=_sort_key_from_snapshot)
        latest_telemetry = telemetry[-1]

    latest_task_complete = _latest_task_complete(session.lifecycle)

    start_time = _first_timestamp(
        [session.start_time]
        + [event.get("timestamp") for event in session.events]
        + [snapshot.get("timestamp") for snapshot in session.telemetry]
    )
    end_time = _last_timestamp(
        [event.get("timestamp") for event in session.events]
        + [snapshot.get("timestamp") for snapshot in session.telemetry]
        + [session.start_time]
    )

    metrics = {
        "total_input_tokens": 0,
        "total_output_tokens": 0,
        "total_reasoning_output_tokens": 0,
        "total_cached_input_tokens": 0,
        "total_tokens": 0,
        "node_count": len(session.events),
        "display_node_count": len(session.events),
        "session_count": 0 if session.is_synthetic else 1,
        "imported_file_count": 1 if session.source_path else 0,
        "elapsed_sec": _elapsed_seconds(start_time, end_time),
        "task_elapsed_sec": _task_elapsed_seconds(latest_task_complete),
        "start_time": start_time,
        "end_time": end_time,
    }

    if latest_telemetry is None:
        return metrics

    metrics["total_input_tokens"] = _as_int(latest_telemetry.get("total_input_tokens"))
    metrics["total_output_tokens"] = _as_int(latest_telemetry.get("total_output_tokens"))
    metrics["total_reasoning_output_tokens"] = _as_int(
        latest_telemetry.get("total_reasoning_output_tokens")
    )
    metrics["total_cached_input_tokens"] = _as_int(
        latest_telemetry.get("total_cached_input_tokens")
    )
    metrics["total_tokens"] = _as_int(latest_telemetry.get("total_tokens"))
    if not metrics["total_tokens"]:
        metrics["total_tokens"] = (
            metrics["total_input_tokens"] + metrics["total_output_tokens"]
        )
    return metrics


def _combine_metrics(
    own_metrics: dict[str, Any],
    child_metrics: list[dict[str, Any]],
) -> dict[str, Any]:
    metrics = dict(own_metrics)
    start_time = own_metrics.get("start_time")
    end_time = own_metrics.get("end_time")

    for child_metric in child_metrics:
        metrics["total_input_tokens"] += _as_int(child_metric.get("total_input_tokens"))
        metrics["total_output_tokens"] += _as_int(
            child_metric.get("total_output_tokens")
        )
        metrics["total_reasoning_output_tokens"] += _as_int(
            child_metric.get("total_reasoning_output_tokens")
        )
        metrics["total_cached_input_tokens"] += _as_int(
            child_metric.get("total_cached_input_tokens")
        )
        metrics["total_tokens"] += _as_int(child_metric.get("total_tokens"))
        metrics["node_count"] += _as_int(child_metric.get("node_count"))
        metrics["display_node_count"] += _as_int(
            child_metric.get("display_node_count")
        ) + 1
        metrics["session_count"] += _as_int(child_metric.get("session_count"))
        metrics["imported_file_count"] += _as_int(
            child_metric.get("imported_file_count")
        )
        start_time = _min_timestamp(start_time, child_metric.get("start_time"))
        end_time = _max_timestamp(end_time, child_metric.get("end_time"))

    metrics["start_time"] = start_time
    metrics["end_time"] = end_time
    metrics["elapsed_sec"] = _elapsed_seconds(start_time, end_time)
    return metrics


def _build_message_event(row: dict[str, Any], session_id: str) -> dict[str, Any]:
    role = _string(row.get("role"))
    phase = _string(row.get("phase"))
    content = _string(row.get("content_text")) or _jsonish_text(row.get("content_parts"))
    content_parts = row.get("content_parts")
    if not isinstance(content_parts, list):
        content_parts = []
    kind = _message_kind(role, phase)
    if kind == "user_input" and (content or "").lstrip().startswith("# AGENTS.md instructions"):
        kind = "agents_md"
    title = {
        "agents_md": "项目规则（AGENTS.md）",
        "user_input": "用户输入",
        "assistant_output": "最终回复",
        "assistant_update": "处理中回复",
        "instruction": "开发者指令",
    }.get(kind, _role_label(role))
    return {
        "event_id": row.get("message_id") or row.get("raw_record_id"),
        "session_id": session_id,
        "timestamp": row.get("timestamp"),
        "kind": kind,
        "role": role,
        "phase": phase,
        "title": title,
        "summary": _truncate(content or "没有可见文本", 120),
        "content": content,
        "content_parts": content_parts,
        "content_label": "消息内容",
        "estimated_input_tokens": (
            estimate_text_tokens(content)
            if kind in USER_SIDE_KINDS
            else None
        ),
        "raw_record_id": row.get("raw_record_id"),
        "source_path": row.get("source_path"),
        "source_line_no": row.get("source_line_no"),
        "raw_text": row.get("raw_text"),
    }


def _build_tool_call_event(row: dict[str, Any], session_id: str) -> dict[str, Any]:
    tool_name = _string(row.get("tool_name")) or "unknown_tool"
    args = _string(row.get("arguments_raw")) or _string(row.get("input_raw"))
    return {
        "event_id": row.get("tool_call_id") or row.get("raw_record_id"),
        "session_id": session_id,
        "timestamp": row.get("timestamp"),
        "kind": "tool_call",
        "title": f"工具调用 · {tool_name}",
        "summary": _truncate(args or "已记录调用参数", 96),
        "args": args,
        "content_label": "调用参数",
        "raw_record_id": row.get("raw_record_id"),
        "source_path": row.get("source_path"),
        "source_line_no": row.get("source_line_no"),
        "raw_text": row.get("raw_text"),
    }


def _build_tool_output_event(row: dict[str, Any], session_id: str) -> dict[str, Any]:
    output = _string(row.get("output_raw")) or _jsonish_text(row.get("output_raw"))
    status = _string(row.get("status"))
    return {
        "event_id": row.get("tool_output_id") or row.get("raw_record_id"),
        "session_id": session_id,
        "timestamp": row.get("timestamp"),
        "kind": "tool_output",
        "title": "工具输出",
        "summary": _truncate(output or status or "工具已返回输出", 96),
        "content": output,
        "content_label": "输出内容",
        "detail_note": status,
        "raw_record_id": row.get("raw_record_id"),
        "source_path": row.get("source_path"),
        "source_line_no": row.get("source_line_no"),
        "raw_text": row.get("raw_text"),
    }


def _build_telemetry_snapshot(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "timestamp": row.get("timestamp"),
        "total_input_tokens": _as_int(row.get("total_input_tokens")),
        "total_output_tokens": _as_int(row.get("total_output_tokens")),
        "total_reasoning_output_tokens": _as_int(
            row.get("total_reasoning_output_tokens") or row.get("total_reasoning_tokens")
        ),
        "total_cached_input_tokens": _as_int(row.get("total_cached_input_tokens")),
        "total_tokens": _as_int(row.get("total_tokens")),
    }


def _attach_usage_badge(
    events: list[dict[str, Any]],
    own_metrics: dict[str, Any],
) -> None:
    usage = {
        "input_tokens": _as_int(own_metrics.get("total_input_tokens")),
        "output_tokens": _as_int(own_metrics.get("total_output_tokens")),
        "reasoning_output_tokens": _as_int(
            own_metrics.get("total_reasoning_output_tokens")
        ),
        "cached_input_tokens": _as_int(own_metrics.get("total_cached_input_tokens")),
        "total_tokens": _as_int(own_metrics.get("total_tokens")),
    }
    if not usage["input_tokens"] and not usage["output_tokens"]:
        return

    assistant_candidates = [
        event
        for event in events
        if event.get("kind") in {"assistant_output", "assistant_update"}
    ]
    if not assistant_candidates:
        return

    target_event = next(
        (
            event
            for event in reversed(assistant_candidates)
            if event.get("kind") == "assistant_output"
        ),
        assistant_candidates[-1],
    )
    target_event["usage"] = {
        **usage,
        "label": (
            f"{usage['input_tokens']} 输入 / {usage['output_tokens']} 输出"
            if usage["input_tokens"] or usage["output_tokens"]
            else f"{usage['total_tokens']} 总计"
        ),
        "note": (
            "这组 usage 来自 `event_msg.token_count`。它现在只作为整段会话的消耗统计，"
            "不再作为独立工作节点串进链路里。"
        ),
    }
    task_elapsed_sec = own_metrics.get("task_elapsed_sec")
    if isinstance(task_elapsed_sec, (int, float)) and not isinstance(
        task_elapsed_sec, bool
    ):
        target_event["task_elapsed_sec"] = round(float(task_elapsed_sec), 3)


def _session_for_row(
    row: dict[str, Any],
    sessions: dict[str, SessionBuild],
    source_to_session_id: dict[str, str],
) -> SessionBuild:
    session_id = _session_id_from_row(row)
    if not session_id:
        source_path = _string(row.get("source_path"))
        if source_path and source_path in source_to_session_id:
            session_id = source_to_session_id[source_path]
        else:
            session_id = source_path or "unknown-session"
    session = _ensure_session(sessions, session_id)
    source_path = _string(row.get("source_path"))
    if source_path:
        session.source_path = session.source_path or source_path
        session.file_name = session.file_name or Path(source_path).name
    return session


def _ensure_session(
    sessions: dict[str, SessionBuild],
    session_id: str,
) -> SessionBuild:
    if session_id not in sessions:
        sessions[session_id] = SessionBuild(session_id=session_id)
    return sessions[session_id]


def _session_id_from_row(row: dict[str, Any]) -> str | None:
    return (
        _string(row.get("conversation_id"))
        or _string(row.get("thread_id"))
        or _string(row.get("id"))
    )


def _sorted_imported_session_ids(sessions: dict[str, SessionBuild]) -> list[str]:
    imported_ids = [
        session.session_id
        for session in sessions.values()
        if session.source_path
    ]
    return sorted(imported_ids, key=lambda session_id: _session_sort_key(sessions[session_id]))


def _sorted_root_session_ids(sessions: dict[str, SessionBuild]) -> list[str]:
    root_ids = [
        session.session_id
        for session in sessions.values()
        if not session.parent_session_id
    ]
    return sorted(root_ids, key=lambda session_id: _session_sort_key(sessions[session_id]))


def _sorted_child_ids(
    session: SessionBuild,
    sessions: dict[str, SessionBuild],
) -> list[str]:
    return sorted(session.child_ids, key=lambda child_id: _session_sort_key(sessions[child_id]))


def _session_sort_key(session: SessionBuild) -> tuple[datetime, str]:
    return (_sort_key_from_timestamp(session.start_time), session.session_id)


def _event_sort_key(event: dict[str, Any]) -> tuple[datetime, int, int, str]:
    timestamp = _sort_key_from_timestamp(_string(event.get("timestamp")))
    source_line_no = _sort_line_no(event.get("source_line_no"))
    event_id = _string(event.get("event_id")) or ""
    return (
        timestamp,
        source_line_no,
        EVENT_ORDER.get(_string(event.get("kind")) or "", 999),
        event_id,
    )


def _detail_sort_key(event: dict[str, Any]) -> tuple[int, datetime, str]:
    return (
        _sort_line_no(event.get("source_line_no")),
        _sort_key_from_timestamp(_string(event.get("timestamp"))),
        _string(event.get("event_id")) or "",
    )


def _sort_key_from_snapshot(snapshot: dict[str, Any]) -> tuple[datetime, int]:
    return (_sort_key_from_timestamp(_string(snapshot.get("timestamp"))), 0)


def _sort_key_from_timestamp(timestamp: str | None) -> datetime:
    parsed = _parse_ts(timestamp)
    if parsed is None:
        return datetime.max
    return parsed


def _sort_line_no(value: Any) -> int:
    return value if isinstance(value, int) else 10**9


def _display_name(session: SessionBuild) -> str:
    if session.is_synthetic:
        return f"主代理 {_short_id(session.session_id)}"
    if session.agent_role == "guardian":
        return "Guardian"
    if session.agent_nickname and session.agent_role:
        return f"{session.agent_nickname} · {session.agent_role}"
    if session.agent_nickname:
        return session.agent_nickname
    if session.is_subagent:
        return f"子代理 {_short_id(session.session_id)}"
    return f"会话 {_short_id(session.session_id)}"


def _subagent_summary(
    child_session: dict[str, Any],
    branch_meta: dict[str, Any],
) -> str:
    bits = [
        child_session.get("agent_role") or "子代理",
        f"{child_session['metrics']['display_node_count']} 个节点",
    ]
    if child_session["metrics"].get("total_tokens"):
        bits.append(f"{child_session['metrics']['total_tokens']} tokens")
    status_preview = _string(branch_meta.get("status_preview"))
    if status_preview:
        bits.append(status_preview)
    return " · ".join(bit for bit in bits if bit)


def _message_kind(role: str | None, phase: str | None) -> str:
    if role == "user":
        return "user_input"
    if role == "assistant" and phase == "final_answer":
        return "assistant_output"
    if role == "assistant":
        return "assistant_update"
    if role == "developer":
        return "instruction"
    return "instruction"


def _role_label(role: str | None) -> str:
    mapping = {
        "user": "用户",
        "assistant": "助手",
        "developer": "开发者",
    }
    return mapping.get(role, role or "消息")


def _flatten_status(value: Any) -> str | None:
    if isinstance(value, str):
        return _truncate(value, 96)
    if isinstance(value, dict):
        for key in ("completed", "status", "message"):
            text = _string(value.get(key))
            if text:
                return _truncate(text, 96)
        try:
            return _truncate(json.dumps(value, ensure_ascii=False, sort_keys=True), 96)
        except TypeError:
            return None
    return None


def _jsonish_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    except TypeError:
        return str(value)


def _short_id(value: str | None) -> str:
    if not value:
        return "unknown"
    return value.split("-")[0]


def _truncate(text: str, limit: int) -> str:
    normalized = " ".join(str(text).split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 1] + "…"


def _string(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _as_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return 0


def _build_raw_record_lookup(
    buffers: ExtractionBuffers,
) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for row in buffers.raw_records:
        raw_record_id = _string(row.get("raw_record_id"))
        if not raw_record_id:
            continue
        lookup[raw_record_id] = dict(row)
    return lookup


def _attach_source_records(
    sessions: dict[str, SessionBuild],
    raw_record_lookup: dict[str, dict[str, Any]],
) -> None:
    for session in sessions.values():
        if session.source_raw_record_id:
            source_row = raw_record_lookup.get(session.source_raw_record_id)
            if source_row:
                session.source_record = source_row.get("record")
                session.source_raw_text = _string(source_row.get("raw_text"))
        for event in session.events:
            raw_record_id = _string(event.get("raw_record_id"))
            if not raw_record_id:
                continue
            source_row = raw_record_lookup.get(raw_record_id)
            if not source_row:
                continue
            event["source_record"] = source_row.get("record")
            event["source_raw_text"] = _string(source_row.get("raw_text"))


def _latest_task_complete(lifecycle_rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    task_complete_rows = [
        row
        for row in lifecycle_rows
        if _string(row.get("event_type")) == "task_complete"
    ]
    if not task_complete_rows:
        return None
    task_complete_rows.sort(
        key=lambda row: (
            _sort_key_from_timestamp(_string(row.get("timestamp"))),
            _sort_line_no(row.get("source_line_no")),
        )
    )
    return task_complete_rows[-1]


def _task_elapsed_seconds(task_complete_row: dict[str, Any] | None) -> float | None:
    if not task_complete_row:
        return None
    duration_ms = task_complete_row.get("duration_ms")
    if isinstance(duration_ms, (int, float)) and not isinstance(duration_ms, bool):
        return round(float(duration_ms) / 1000.0, 3)
    return None


def _parse_ts(timestamp: str | None) -> datetime | None:
    if not timestamp:
        return None
    try:
        # Normalize Z to +00:00 for broader compatibility, though Python 3.11+ handles Z.
        # Ensure we get an aware datetime then convert to naive UTC for safe comparison.
        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except ValueError:
        return None


def _elapsed_seconds(start_time: str | None, end_time: str | None) -> float:
    start_dt = _parse_ts(start_time)
    end_dt = _parse_ts(end_time)
    if start_dt is None or end_dt is None:
        return 0.0
    return round(max((end_dt - start_dt).total_seconds(), 0.0), 1)


def _first_timestamp(values: list[Any]) -> str | None:
    timestamps = [value for value in values if _parse_ts(_string(value)) is not None]
    if not timestamps:
        return None
    return min(timestamps, key=lambda value: _sort_key_from_timestamp(_string(value)))


def _last_timestamp(values: list[Any]) -> str | None:
    timestamps = [value for value in values if _parse_ts(_string(value)) is not None]
    if not timestamps:
        return None
    return max(timestamps, key=lambda value: _sort_key_from_timestamp(_string(value)))


def _min_timestamp(left: str | None, right: str | None) -> str | None:
    if not left:
        return right
    if not right:
        return left
    return left if _sort_key_from_timestamp(left) <= _sort_key_from_timestamp(right) else right


def _max_timestamp(left: str | None, right: str | None) -> str | None:
    if not left:
        return right
    if not right:
        return left
    return left if _sort_key_from_timestamp(left) >= _sort_key_from_timestamp(right) else right


def format_terminal_summary(summary: dict[str, Any]) -> str:
    return (
        f"Files: {summary['total_files']}\n"
        f"Imported sessions: {summary.get('imported_session_count', len(summary['sessions']))}\n"
        f"Root views: {summary.get('root_session_count', len(summary.get('root_sessions', [])))}\n"
        f"Parsed records: {summary['parsed_records']}\n"
        f"Parse errors: {summary['parse_errors']}"
    )
