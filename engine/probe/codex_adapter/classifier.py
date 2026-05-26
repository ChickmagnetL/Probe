from __future__ import annotations

from dataclasses import dataclass

LIFECYCLE_EVENT_TYPES = {
    "task_started",
    "task_complete",
    "turn_aborted",
    "user_message",
    "agent_message",
}

STRUCTURED_TOOL_END_EVENT_TYPES = {
    "exec_command_end",
    "patch_apply_end",
    "mcp_tool_call_end",
    "view_image_tool_call",
}

COLLABORATION_EVENT_TYPES = {
    "collab_agent_spawn_end",
    "collab_agent_interaction_end",
    "collab_waiting_end",
    "collab_close_end",
}

SYSTEM_EVENT_TYPES = {
    "guardian_assessment",
    "error",
    "thread_rolled_back",
}

SEARCH_EVENT_TYPES = {
    "web_search_call",
    "web_search_end",
}


@dataclass(frozen=True)
class Classification:
    table_name: str | None
    route_key: str
    reserved: bool = False


def classify_record(record_type: str, payload_type: str | None) -> Classification:
    if record_type == "session_meta":
        return Classification("conversation_meta_raw", "session_meta")

    if record_type == "turn_context":
        return Classification("turn_manifest", "turn_context")

    if record_type == "response_item":
        if payload_type == "message":
            return Classification("message_items_raw", "response_item.message")
        if payload_type == "reasoning":
            return Classification("reasoning_items_raw", "response_item.reasoning")
        if payload_type in {"function_call", "custom_tool_call"}:
            return Classification("tool_calls_raw", f"response_item.{payload_type}")
        if payload_type in {"function_call_output", "custom_tool_call_output"}:
            return Classification(
                "tool_call_outputs_raw",
                f"response_item.{payload_type}",
            )
        return Classification(None, f"response_item.{payload_type or 'unknown'}")

    if record_type == "event_msg":
        if payload_type == "agent_reasoning":
            return Classification("reasoning_items_raw", "event_msg.agent_reasoning")
        if payload_type == "token_count":
            return Classification("telemetry_events", "event_msg.token_count")
        if payload_type in LIFECYCLE_EVENT_TYPES:
            return Classification("lifecycle_events", f"event_msg.{payload_type}")
        if payload_type in STRUCTURED_TOOL_END_EVENT_TYPES:
            return Classification(
                "structured_tool_end_events",
                f"event_msg.{payload_type}",
                reserved=True,
            )
        if payload_type in COLLABORATION_EVENT_TYPES:
            return Classification(
                "collaboration_events",
                f"event_msg.{payload_type}",
                reserved=True,
            )
        if payload_type in SYSTEM_EVENT_TYPES:
            return Classification(
                "system_events",
                f"event_msg.{payload_type}",
                reserved=True,
            )
        if payload_type in SEARCH_EVENT_TYPES:
            return Classification(
                "search_events",
                f"event_msg.{payload_type}",
                reserved=True,
            )
        if payload_type == "context_compacted":
            return Classification(
                "compaction_events",
                "event_msg.context_compacted",
                reserved=True,
            )
        return Classification(None, f"event_msg.{payload_type or 'unknown'}")

    if record_type == "compacted":
        return Classification("compaction_events", "compacted", reserved=True)

    return Classification(None, record_type)
