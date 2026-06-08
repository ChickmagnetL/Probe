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
    _warn_missing_required_fields(buffers, file_context, line, classification)
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


REQUIRED_PAYLOAD_FIELDS = {
    "event_msg.exec_command_end": ["call_id", "command"],
    "event_msg.patch_apply_end": ["call_id", "changes"],
    "event_msg.mcp_tool_call_end": ["call_id", "invocation"],
    "event_msg.error": ["message"],
    "event_msg.stream_error": ["message"],
    "response_item.web_search_call": ["call_id"],
}


def _append_parse_warning(
    buffers: ExtractionBuffers,
    file_context: FileContext,
    line: ParsedLine,
    route_key: str,
    field: str,
) -> None:
    buffers.parse_errors.append(
        {
            "parse_error_id": f"{line.raw_record_id}:missing:{field}",
            "source_path": line.source_path,
            "source_line_no": line.source_line_no,
            "raw_text": line.raw_text,
            "error": f"payload field '{field}' is missing for {route_key}",
            "error_type": "missing_required_field",
            "severity": "warning",
            "route_key": route_key,
            "field": field,
        }
    )
    file_context.parse_error_count += 1


def _warn_missing_required_fields(
    buffers: ExtractionBuffers,
    file_context: FileContext,
    line: ParsedLine,
    classification: Classification,
) -> None:
    for field in REQUIRED_PAYLOAD_FIELDS.get(classification.route_key, []):
        value = line.payload.get(field)
        if value is None or value == "":
            _append_parse_warning(
                buffers,
                file_context,
                line,
                classification.route_key,
                field,
            )


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
        "route_key": classification.route_key,
        "route_table": classification.table_name,
        "raw_text": line.raw_text,
        "conversation_id": conversation_id,
        "turn_id": turn_id,
    }
    payload = line.payload

    if classification.table_name == "conversation_meta_raw":
        return _finalize_row(
            {
            **common,
            "conversation_started_at": _string_or_none(payload.get("timestamp")),
            "cwd": _string_or_none(payload.get("cwd")),
            "cli_version": _string_or_none(payload.get("cli_version")),
            "originator": _string_or_none(payload.get("originator")),
            "model_provider": _string_or_none(payload.get("model_provider")),
            "agent_nickname": _string_or_none(payload.get("agent_nickname")),
            "agent_role": _string_or_none(payload.get("agent_role")),
            "forked_from_id": _string_or_none(payload.get("forked_from_id")),
            "thread_source": payload.get("thread_source"),
            "agent_path": _string_or_none(payload.get("agent_path")),
            "dynamic_tools": payload.get("dynamic_tools"),
            "memory_mode": _string_or_none(payload.get("memory_mode")),
            "git": payload.get("git"),
            "source": payload.get("source"),
            "thread_spawn": _nested_get(payload, "source", "subagent", "thread_spawn"),
            "base_instructions_text": _nested_get(
                payload,
                "base_instructions",
                "text",
            ),
            "payload": payload,
            },
            payload,
            [
                "id", "timestamp", "cwd", "cli_version", "originator",
                "model_provider", "agent_nickname", "agent_role",
                "forked_from_id", "thread_source", "agent_path",
                "dynamic_tools", "memory_mode", "git", "source",
                "base_instructions",
            ],
        )

    if classification.table_name == "turn_manifest":
        return _finalize_row(
            {
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
            "developer_instructions": payload.get("developer_instructions"),
            "effort": payload.get("effort"),
            "final_output_json_schema": payload.get("final_output_json_schema"),
            "realtime_active": payload.get("realtime_active"),
            "summary": payload.get("summary"),
            "user_instructions": payload.get("user_instructions"),
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
            },
            payload,
            [
                "turn_id", "cwd", "current_date", "timezone",
                "approval_policy", "sandbox_policy", "model", "personality",
                "developer_instructions", "effort", "final_output_json_schema",
                "realtime_active", "summary", "user_instructions",
                "collaboration_mode", "truncation_policy",
            ],
        )

    if classification.table_name == "message_items_raw":
        content_parts = payload.get("content")
        if not isinstance(content_parts, list):
            content_parts = []
        return _finalize_row(
            {
            **common,
            "message_id": f"message:{line.raw_record_id}",
            "role": _string_or_none(payload.get("role")),
            "phase": _string_or_none(payload.get("phase")),
            "summary": payload.get("summary"),
            "status": _string_or_none(payload.get("status")),
            "content_parts": content_parts,
            "content_text": _extract_content_text(content_parts),
            "input_images": _extract_input_images(content_parts),
            "payload": payload,
            },
            payload,
            ["role", "phase", "summary", "status", "content"],
        )

    if classification.table_name == "reasoning_items_raw":
        return _finalize_row(
            {
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
            },
            payload,
            ["summary", "content", "encrypted_content", "text"],
        )

    if classification.table_name == "tool_calls_raw":
        raw_input = (
            payload.get("arguments")
            if line.payload_type == "function_call"
            else payload.get("input")
        )
        parsed_input = _parse_jsonish(raw_input)
        return _finalize_row(
            {
            **common,
            "tool_call_id": f"tool-call:{line.raw_record_id}",
            "call_id": _string_or_none(payload.get("call_id")),
            "tool_name": _string_or_none(payload.get("name")),
            "namespace": _string_or_none(payload.get("namespace")),
            "tool_kind": line.payload_type,
            "status": _string_or_none(payload.get("status")),
            "arguments_raw": payload.get("arguments"),
            "input_raw": payload.get("input"),
            "session_id": _extract_session_id(
                parsed_input if parsed_input is not None else raw_input
            ),
            "payload": payload,
            },
            payload,
            ["call_id", "name", "namespace", "status", "arguments", "input"],
        )

    if classification.table_name == "tool_call_outputs_raw":
        return _finalize_row(
            {
            **common,
            "tool_output_id": f"tool-output:{line.raw_record_id}",
            "call_id": _string_or_none(payload.get("call_id")),
            "tool_kind": line.payload_type,
            "status": _string_or_none(payload.get("status")),
            "output_raw": payload.get("output"),
            "output_images": _extract_input_images(payload.get("output")),
            "payload": payload,
            },
            payload,
            ["call_id", "status", "output"],
        )

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
        return _finalize_row(
            {
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
            },
            payload,
            ["info", "rate_limits"],
        )

    if classification.table_name == "collaboration_events":
        return _finalize_row(
            {
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
            },
            payload,
            [
                "call_id", "sender_thread_id", "receiver_thread_id",
                "new_thread_id", "receiver_agent_nickname",
                "receiver_agent_role", "new_agent_nickname", "new_agent_role",
                "model", "reasoning_effort", "prompt", "status",
                "agent_statuses", "statuses",
            ],
        )

    if classification.table_name == "lifecycle_events":
        is_user_msg = line.payload_type == "user_message"
        is_agent_msg = line.payload_type == "agent_message"
        extra_row: JSONDict = {}
        if is_user_msg:
            extra_row = {
                "images": payload.get("images"),
                "image_details": payload.get("image_details"),
                "local_images": payload.get("local_images"),
                "local_image_details": payload.get("local_image_details"),
                "text_elements": payload.get("text_elements"),
                "client_id": _string_or_none(payload.get("client_id")),
            }
        elif is_agent_msg:
            extra_row = {
                "memory_citation": payload.get("memory_citation"),
            }
        return _finalize_row(
            {
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
            "time_to_first_token_ms": payload.get("time_to_first_token_ms"),
            "model_context_window": payload.get("model_context_window"),
            "collaboration_mode_kind": _string_or_none(
                payload.get("collaboration_mode_kind")
            ),
            **extra_row,
            "payload": payload,
            },
            payload,
            [
                "message", "phase", "reason", "last_agent_message",
                "started_at", "completed_at", "duration_ms",
                "time_to_first_token_ms",
                "model_context_window", "collaboration_mode_kind", "turn_id",
                "trace_id",
                "images", "image_details", "local_images", "local_image_details",
                "text_elements", "client_id",
                "memory_citation", "role", "content", "status", "summary",
            ],
        )

    if classification.table_name == "structured_tool_end_events":
        invocation = payload.get("invocation")
        invocation = invocation if isinstance(invocation, dict) else None
        return _finalize_row(
            {
                **common,
                "event_id": f"tool-event:{line.raw_record_id}",
                "event_type": line.payload_type or line.record_type,
                "call_id": _string_or_none(payload.get("call_id")),
                "process_id": _string_or_none(payload.get("process_id")),
                "command": payload.get("command"),
                "command_text": _command_to_text(payload.get("command")),
                "cwd": _string_or_none(payload.get("cwd")),
                "parsed_cmd": payload.get("parsed_cmd"),
                "source": _string_or_none(payload.get("source")),
                "stdout": _string_or_none(payload.get("stdout")),
                "stderr": _string_or_none(payload.get("stderr")),
                "aggregated_output": _string_or_none(payload.get("aggregated_output")),
                "formatted_output": _string_or_none(payload.get("formatted_output")),
                "exit_code": payload.get("exit_code"),
                "duration": payload.get("duration"),
                "duration_ms": _duration_ms(payload.get("duration")),
                "status": _string_or_none(payload.get("status")),
                "success": payload.get("success"),
                "changes": payload.get("changes"),
                "invocation": invocation,
                "server": _string_or_none(invocation.get("server")) if invocation else None,
                "tool_name": _string_or_none(invocation.get("tool")) if invocation else None,
                "result": payload.get("result"),
                "path": _string_or_none(payload.get("path")),
                "revised_prompt": _string_or_none(payload.get("revised_prompt")),
                "generation_result": payload.get("result"),
                "payload": payload,
            },
            payload,
            [
                "call_id", "process_id", "command", "cwd", "parsed_cmd",
                "source", "stdout", "stderr", "aggregated_output",
                "formatted_output", "exit_code", "duration", "status",
                "success", "changes", "invocation", "result", "path",
                "revised_prompt",
            ],
        )

    if classification.table_name == "search_events":
        action = payload.get("action")
        action = action if isinstance(action, dict) else None
        return _finalize_row(
            {
                **common,
                "event_id": f"search:{line.raw_record_id}",
                "event_type": line.payload_type or line.record_type,
                "call_id": _string_or_none(payload.get("call_id")),
                "status": _string_or_none(payload.get("status")),
                "action": payload.get("action"),
                "query": _string_or_none(payload.get("query"))
                or (_string_or_none(action.get("query")) if action else None),
                "results": payload.get("results"),
                "sources": payload.get("sources"),
                "duration": payload.get("duration"),
                "duration_ms": _duration_ms(payload.get("duration")),
                "payload": payload,
            },
            payload,
            ["call_id", "status", "action", "query", "results", "sources", "duration"],
        )

    if classification.table_name == "system_events":
        return _finalize_row(
            {
                **common,
                "event_id": f"system:{line.raw_record_id}",
                "event_type": line.payload_type or line.record_type,
                "id": _string_or_none(payload.get("id")),
                "target_item_id": _string_or_none(payload.get("target_item_id")),
                "status": _string_or_none(payload.get("status")),
                "message": _string_or_none(payload.get("message")),
                "error_type": (
                    _string_or_none(payload.get("error_type"))
                    or _string_or_none(payload.get("kind"))
                    or _string_or_none(payload.get("code"))
                ),
                "additional_details": payload.get("additional_details"),
                "risk_level": _string_or_none(payload.get("risk_level")),
                "risk_score": payload.get("risk_score"),
                "user_authorization": _string_or_none(payload.get("user_authorization")),
                "rationale": _string_or_none(payload.get("rationale")),
                "decision_source": _string_or_none(payload.get("decision_source")),
                "action": payload.get("action"),
                "num_turns": payload.get("num_turns"),
                "unified_diff": _string_or_none(payload.get("unified_diff")),
                "changes": payload.get("changes"),
                "explanation": _string_or_none(payload.get("explanation")),
                "plan": payload.get("plan"),
                "goal": _string_or_none(payload.get("goal")),
                "payload": payload,
            },
            payload,
            [
                "id", "target_item_id", "status", "message", "error_type",
                "kind", "code", "additional_details", "risk_level",
                "risk_score", "user_authorization", "rationale",
                "decision_source", "action", "num_turns", "unified_diff",
                "changes", "explanation", "plan", "goal",
            ],
        )

    if classification.table_name == "compaction_events":
        return _finalize_row(
            {
                **common,
                "event_id": f"compaction:{line.raw_record_id}",
                "event_type": line.payload_type or line.record_type,
                "summary": payload.get("summary"),
                "original_token_count": payload.get("original_token_count"),
                "compacted_token_count": payload.get("compacted_token_count"),
                "payload": payload,
            },
            payload,
            ["summary", "original_token_count", "compacted_token_count"],
        )

    return _finalize_row(
        {
            **common,
            "event_id": f"{classification.table_name}:{line.raw_record_id}",
            "event_type": line.payload_type or line.record_type,
            "payload": payload,
        },
        payload,
        [],
    )


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


def _extract_input_images(content_parts: Any) -> list[JSONDict]:
    if not isinstance(content_parts, list):
        return []
    images: list[JSONDict] = []
    for part in content_parts:
        if not isinstance(part, dict):
            continue
        if part.get("type") != "input_image":
            continue
        images.append(
            {
                "image_url": _string_or_none(part.get("image_url")),
                "detail": part.get("detail"),
            }
        )
    return images


def _command_to_text(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return " ".join(str(item) for item in value)
    return None


def _duration_ms(value: Any) -> float | None:
    if not isinstance(value, dict):
        return None
    secs = value.get("secs") if isinstance(value.get("secs"), (int, float)) else 0
    nanos = value.get("nanos") if isinstance(value.get("nanos"), (int, float)) else 0
    return round(secs * 1000 + nanos / 1_000_000, 3)


def _finalize_row(
    row: JSONDict,
    payload: JSONDict,
    extracted_keys: list[str],
) -> JSONDict:
    extracted = {"type", "turn_id", *extracted_keys}
    extracted_fields = sorted(key for key in extracted if key in payload)
    extra_fields = {
        key: value for key, value in payload.items()
        if key not in extracted
    }
    return {
        **row,
        "extracted_fields": extracted_fields,
        "extra_fields": extra_fields,
    }


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
