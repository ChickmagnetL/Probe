from __future__ import annotations

import json
from typing import Any

from .classifier import Classification, classify_record
from .models import ExtractionBuffers, FileContext, JSONDict, PRE_TURN_ID, ParsedLine


def process_line(
    line: ParsedLine,
    file_context: FileContext,
    buffers: ExtractionBuffers,
) -> None:
    file_context.parsed_record_count += 1
    buffers.record_type_counts[line.record_type] += 1
    route_key = f"{line.record_type}.{line.payload_type}" if line.payload_type else line.record_type
    buffers.payload_type_counts[route_key] += 1

    conversation_id = _resolve_conversation_id(line, file_context)
    turn_id = _resolve_turn_id(line, file_context)
    classification = classify_record(line.record_type, line.payload_type)

    raw_record = {
        "raw_record_id": line.raw_record_id,
        "source_path": line.source_path,
        "source_line_no": line.source_line_no,
        "timestamp": line.timestamp,
        "record_type": line.record_type,
        "payload_type": line.payload_type,
        "route_key": classification.route_key,
        "route_table": classification.table_name,
        "conversation_id": conversation_id,
        "turn_id": turn_id,
        "call_id": _string_or_none(line.payload.get("call_id")),
        "raw_text": line.raw_text,
        "record": line.data,
    }
    _append_row(buffers, file_context, "raw_records", raw_record)

    if classification.table_name is None:
        file_context.unknown_route_counts[classification.route_key] += 1
        buffers.unknown_route_counts[classification.route_key] += 1
        return

    if classification.reserved:
        file_context.reserved_route_counts[classification.route_key] += 1
        buffers.reserved_route_counts[classification.route_key] += 1

    row = _extract_row(
        classification=classification,
        line=line,
        conversation_id=conversation_id,
        turn_id=turn_id,
    )
    _append_row(buffers, file_context, classification.table_name, row)

    if classification.table_name == "tool_calls_raw":
        call_id = row.get("call_id")
        if isinstance(call_id, str) and call_id:
            file_context.call_records[call_id].append(line.raw_record_id)
    elif classification.table_name == "tool_call_outputs_raw":
        call_id = row.get("call_id")
        if isinstance(call_id, str) and call_id:
            file_context.call_outputs[call_id].append(line.raw_record_id)


def build_tool_call_pairs(file_context: FileContext) -> list[JSONDict]:
    rows: list[JSONDict] = []
    call_ids = sorted(set(file_context.call_records) | set(file_context.call_outputs))
    for call_id in call_ids:
        call_refs = list(file_context.call_records.get(call_id, []))
        output_refs = list(file_context.call_outputs.get(call_id, []))
        if call_refs and output_refs:
            pair_status = "paired"
        elif call_refs:
            pair_status = "missing_output"
        else:
            pair_status = "orphan_output"

        rows.append(
            {
                "call_id": call_id,
                "source_path": file_context.source_path,
                "call_record_ref": call_refs[0] if call_refs else None,
                "output_record_ref": output_refs[0] if output_refs else None,
                "call_record_refs": call_refs,
                "output_record_refs": output_refs,
                "call_count": len(call_refs),
                "output_count": len(output_refs),
                "pair_status": pair_status,
            }
        )
    return rows


def _append_row(
    buffers: ExtractionBuffers,
    file_context: FileContext,
    table_name: str,
    row: JSONDict,
) -> None:
    getattr(buffers, table_name).append(row)
    file_context.table_counts[table_name] += 1


def _resolve_conversation_id(
    line: ParsedLine,
    file_context: FileContext,
) -> str | None:
    if line.record_type == "session_meta":
        conversation_id = _string_or_none(line.payload.get("id"))
        if conversation_id:
            file_context.conversation_id = conversation_id
            return conversation_id

    if file_context.conversation_id:
        return file_context.conversation_id

    return _string_or_none(line.payload.get("conversation_id"))


def _resolve_turn_id(line: ParsedLine, file_context: FileContext) -> str | None:
    if line.record_type == "session_meta":
        return None

    explicit_turn_id = _string_or_none(line.payload.get("turn_id"))
    if explicit_turn_id:
        file_context.active_turn_id = explicit_turn_id
        file_context.turn_ids.add(explicit_turn_id)
        return explicit_turn_id

    if file_context.active_turn_id:
        return file_context.active_turn_id

    return PRE_TURN_ID


def _extract_row(
    *,
    classification: Classification,
    line: ParsedLine,
    conversation_id: str | None,
    turn_id: str | None,
) -> JSONDict:
    common = {
        "raw_record_id": line.raw_record_id,
        "source_path": line.source_path,
        "source_line_no": line.source_line_no,
        "timestamp": line.timestamp,
        "record_type": line.record_type,
        "payload_type": line.payload_type,
        "raw_text": line.raw_text,
        "conversation_id": conversation_id,
        "turn_id": turn_id,
    }
    payload = line.payload

    if classification.table_name == "conversation_meta_raw":
        return {
            **common,
            "conversation_started_at": _string_or_none(payload.get("timestamp")),
            "cwd": _string_or_none(payload.get("cwd")),
            "cli_version": _string_or_none(payload.get("cli_version")),
            "originator": _string_or_none(payload.get("originator")),
            "model_provider": _string_or_none(payload.get("model_provider")),
            "agent_nickname": _string_or_none(payload.get("agent_nickname")),
            "agent_role": _string_or_none(payload.get("agent_role")),
            "git": payload.get("git"),
            "source": payload.get("source"),
            "thread_spawn": _nested_get(payload, "source", "subagent", "thread_spawn"),
            "base_instructions_text": _nested_get(
                payload,
                "base_instructions",
                "text",
            ),
            "payload": payload,
        }

    if classification.table_name == "turn_manifest":
        return {
            **common,
            "cwd": _string_or_none(payload.get("cwd")),
            "current_date": _string_or_none(payload.get("current_date")),
            "timezone": _string_or_none(payload.get("timezone")),
            "approval_policy": _string_or_none(payload.get("approval_policy")),
            "sandbox_policy_type": _nested_get(payload, "sandbox_policy", "type"),
            "sandbox_writable_roots": _nested_get(
                payload,
                "sandbox_policy",
                "writable_roots",
            ),
            "sandbox_network_access": _nested_get(
                payload,
                "sandbox_policy",
                "network_access",
            ),
            "model": _string_or_none(payload.get("model")),
            "personality": _string_or_none(payload.get("personality")),
            "collaboration_mode": _nested_get(payload, "collaboration_mode", "mode"),
            "reasoning_effort": _nested_get(
                payload,
                "collaboration_mode",
                "settings",
                "reasoning_effort",
            ),
            "truncation_mode": _nested_get(payload, "truncation_policy", "mode"),
            "truncation_limit": _nested_get(payload, "truncation_policy", "limit"),
            "payload": payload,
        }

    if classification.table_name == "message_items_raw":
        content_parts = payload.get("content")
        if not isinstance(content_parts, list):
            content_parts = []
        return {
            **common,
            "message_id": f"message:{line.raw_record_id}",
            "role": _string_or_none(payload.get("role")),
            "phase": _string_or_none(payload.get("phase")),
            "summary": payload.get("summary"),
            "status": _string_or_none(payload.get("status")),
            "content_parts": content_parts,
            "content_text": _extract_content_text(content_parts),
            "payload": payload,
        }

    if classification.table_name == "reasoning_items_raw":
        return {
            **common,
            "reasoning_id": f"reasoning:{line.raw_record_id}",
            "reasoning_kind": (
                "agent_reasoning"
                if classification.route_key == "event_msg.agent_reasoning"
                else "reasoning"
            ),
            "summary": payload.get("summary"),
            "content": payload.get("content"),
            "encrypted_content": payload.get("encrypted_content"),
            "text": _string_or_none(payload.get("text")),
            "payload": payload,
        }

    if classification.table_name == "tool_calls_raw":
        raw_input = (
            payload.get("arguments")
            if line.payload_type == "function_call"
            else payload.get("input")
        )
        parsed_input = _parse_jsonish(raw_input)
        return {
            **common,
            "tool_call_id": f"tool-call:{line.raw_record_id}",
            "call_id": _string_or_none(payload.get("call_id")),
            "tool_name": _string_or_none(payload.get("name")),
            "tool_kind": line.payload_type,
            "status": _string_or_none(payload.get("status")),
            "arguments_raw": payload.get("arguments"),
            "input_raw": payload.get("input"),
            "session_id": _extract_session_id(
                parsed_input if parsed_input is not None else raw_input
            ),
            "payload": payload,
        }

    if classification.table_name == "tool_call_outputs_raw":
        return {
            **common,
            "tool_output_id": f"tool-output:{line.raw_record_id}",
            "call_id": _string_or_none(payload.get("call_id")),
            "tool_kind": line.payload_type,
            "status": _string_or_none(payload.get("status")),
            "output_raw": payload.get("output"),
            "payload": payload,
        }

    if classification.table_name == "telemetry_events":
        info = payload.get("info")
        info = info if isinstance(info, dict) else {}
        total_usage = info.get("total_token_usage")
        total_usage = total_usage if isinstance(total_usage, dict) else {}
        last_usage = info.get("last_token_usage")
        last_usage = last_usage if isinstance(last_usage, dict) else {}
        rate_limits = payload.get("rate_limits")
        rate_limits = rate_limits if isinstance(rate_limits, dict) else {}
        total_reasoning_output_tokens = (
            total_usage.get("reasoning_output_tokens")
            if total_usage.get("reasoning_output_tokens") is not None
            else total_usage.get("reasoning_tokens")
        )
        last_reasoning_output_tokens = (
            last_usage.get("reasoning_output_tokens")
            if last_usage.get("reasoning_output_tokens") is not None
            else last_usage.get("reasoning_tokens")
        )
        return {
            **common,
            "event_type": line.payload_type,
            "model_context_window": info.get("model_context_window"),
            "total_input_tokens": total_usage.get("input_tokens"),
            "total_output_tokens": total_usage.get("output_tokens"),
            "total_reasoning_tokens": total_reasoning_output_tokens,
            "total_reasoning_output_tokens": total_reasoning_output_tokens,
            "total_cached_input_tokens": total_usage.get("cached_input_tokens"),
            "total_tokens": total_usage.get("total_tokens"),
            "last_input_tokens": last_usage.get("input_tokens"),
            "last_output_tokens": last_usage.get("output_tokens"),
            "last_reasoning_tokens": last_reasoning_output_tokens,
            "last_reasoning_output_tokens": last_reasoning_output_tokens,
            "last_cached_input_tokens": last_usage.get("cached_input_tokens"),
            "last_total_tokens": last_usage.get("total_tokens"),
            "rate_limit_id": _string_or_none(rate_limits.get("limit_id")),
            "rate_limit_name": _string_or_none(rate_limits.get("limit_name")),
            "primary_rate_limit": rate_limits.get("primary"),
            "secondary_rate_limit": rate_limits.get("secondary"),
            "credits": rate_limits.get("credits"),
            "plan_type": _string_or_none(rate_limits.get("plan_type")),
            "info": info,
            "rate_limits": rate_limits,
            "payload": payload,
        }

    if classification.table_name == "collaboration_events":
        return {
            **common,
            "collab_event_id": f"collab:{line.raw_record_id}",
            "event_type": line.payload_type,
            "call_id": _string_or_none(payload.get("call_id")),
            "sender_thread_id": _string_or_none(payload.get("sender_thread_id")),
            "receiver_thread_id": _string_or_none(payload.get("receiver_thread_id")),
            "new_thread_id": _string_or_none(payload.get("new_thread_id")),
            "receiver_agent_nickname": _string_or_none(
                payload.get("receiver_agent_nickname")
            ),
            "receiver_agent_role": _string_or_none(payload.get("receiver_agent_role")),
            "new_agent_nickname": _string_or_none(payload.get("new_agent_nickname")),
            "new_agent_role": _string_or_none(payload.get("new_agent_role")),
            "model": _string_or_none(payload.get("model")),
            "reasoning_effort": _string_or_none(payload.get("reasoning_effort")),
            "prompt": _string_or_none(payload.get("prompt")),
            "status": payload.get("status"),
            "agent_statuses": payload.get("agent_statuses"),
            "statuses": payload.get("statuses"),
            "payload": payload,
        }

    if classification.table_name == "lifecycle_events":
        return {
            **common,
            "event_id": f"lifecycle:{line.raw_record_id}",
            "event_type": line.payload_type,
            "message": _string_or_none(payload.get("message")),
            "phase": _string_or_none(payload.get("phase")),
            "reason": _string_or_none(payload.get("reason")),
            "last_agent_message": _string_or_none(payload.get("last_agent_message")),
            "started_at": payload.get("started_at"),
            "completed_at": payload.get("completed_at"),
            "duration_ms": payload.get("duration_ms"),
            "model_context_window": payload.get("model_context_window"),
            "collaboration_mode_kind": _string_or_none(
                payload.get("collaboration_mode_kind")
            ),
            "payload": payload,
        }

    return {
        **common,
        "event_id": f"{classification.table_name}:{line.raw_record_id}",
        "event_type": line.payload_type or line.record_type,
        "payload": payload,
    }


def _extract_content_text(content_parts: list[Any]) -> str:
    fragments: list[str] = []
    for part in content_parts:
        if not isinstance(part, dict):
            continue
        text = _string_or_none(part.get("text"))
        if text:
            fragments.append(text)
            continue
        content = _string_or_none(part.get("content"))
        if content:
            fragments.append(content)
    return "\n".join(fragments)


def _parse_jsonish(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text or text[0] not in "{[":
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _extract_session_id(value: Any) -> str | None:
    if isinstance(value, dict):
        session_id = value.get("session_id")
        if isinstance(session_id, str) and session_id:
            return session_id
        for nested in value.values():
            found = _extract_session_id(nested)
            if found:
                return found
        return None
    if isinstance(value, list):
        for item in value:
            found = _extract_session_id(item)
            if found:
                return found
    return None


def _nested_get(value: Any, *path: str) -> Any:
    current = value
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _string_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) else None
