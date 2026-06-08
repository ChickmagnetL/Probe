const LIFECYCLE_EVENT_TYPES = new Set([
  "task_started",
  "task_complete",
  "turn_aborted",
  "user_message",
  "agent_message",
]);

const STRUCTURED_TOOL_END_EVENT_TYPES = new Set([
  "exec_command_begin",
  "exec_command_end",
  "patch_apply_end",
  "mcp_tool_call_end",
  "view_image_tool_call",
]);

const COLLABORATION_EVENT_TYPES = new Set([
  "collab_agent_spawn_end",
  "collab_agent_interaction_end",
  "collab_waiting_end",
  "collab_close_end",
]);

const SYSTEM_EVENT_TYPES = new Set([
  "guardian_assessment",
  "error",
  "stream_error",
  "thread_rolled_back",
  "turn_diff",
  "plan_update",
  "thread_goal_updated",
  "hook_started",
  "hook_completed",
]);

const SEARCH_EVENT_TYPES = new Set([
  "web_search_begin",
  "web_search_end",
]);

export interface Classification {
  table_name: string | null;
  route_key: string;
  reserved: boolean;
}

export function classifyRecord(
  record_type: string,
  payload_type: string | null,
): Classification {
  if (record_type === "session_meta") {
    return { table_name: "conversation_meta_raw", route_key: "session_meta", reserved: false };
  }

  if (record_type === "turn_context") {
    return { table_name: "turn_manifest", route_key: "turn_context", reserved: false };
  }

  if (record_type === "response_item") {
    if (payload_type === "message") {
      return { table_name: "message_items_raw", route_key: "response_item.message", reserved: false };
    }
    if (payload_type === "reasoning") {
      return { table_name: "reasoning_items_raw", route_key: "response_item.reasoning", reserved: false };
    }
    if (payload_type === "function_call" || payload_type === "custom_tool_call") {
      return { table_name: "tool_calls_raw", route_key: `response_item.${payload_type}`, reserved: false };
    }
    if (payload_type === "function_call_output" || payload_type === "custom_tool_call_output") {
      return { table_name: "tool_call_outputs_raw", route_key: `response_item.${payload_type}`, reserved: false };
    }
    if (payload_type === "web_search_call") {
      return { table_name: "search_events", route_key: "response_item.web_search_call", reserved: false };
    }
    if (payload_type === "image_generation_call") {
      return { table_name: "structured_tool_end_events", route_key: "response_item.image_generation_call", reserved: false };
    }
    return { table_name: null, route_key: `response_item.${payload_type || "unknown"}`, reserved: false };
  }

  if (record_type === "event_msg") {
    if (payload_type === "agent_reasoning") {
      return { table_name: "reasoning_items_raw", route_key: "event_msg.agent_reasoning", reserved: false };
    }
    if (payload_type === "token_count") {
      return { table_name: "telemetry_events", route_key: "event_msg.token_count", reserved: false };
    }
    if (payload_type !== null && LIFECYCLE_EVENT_TYPES.has(payload_type)) {
      return { table_name: "lifecycle_events", route_key: `event_msg.${payload_type}`, reserved: false };
    }
    if (payload_type !== null && STRUCTURED_TOOL_END_EVENT_TYPES.has(payload_type)) {
      return { table_name: "structured_tool_end_events", route_key: `event_msg.${payload_type}`, reserved: true };
    }
    if (payload_type !== null && COLLABORATION_EVENT_TYPES.has(payload_type)) {
      return { table_name: "collaboration_events", route_key: `event_msg.${payload_type}`, reserved: true };
    }
    if (payload_type !== null && SYSTEM_EVENT_TYPES.has(payload_type)) {
      return { table_name: "system_events", route_key: `event_msg.${payload_type}`, reserved: true };
    }
    if (payload_type !== null && SEARCH_EVENT_TYPES.has(payload_type)) {
      return { table_name: "search_events", route_key: `event_msg.${payload_type}`, reserved: true };
    }
    if (payload_type === "context_compacted") {
      return { table_name: "compaction_events", route_key: "event_msg.context_compacted", reserved: true };
    }
    return { table_name: null, route_key: `event_msg.${payload_type || "unknown"}`, reserved: false };
  }

  if (record_type === "compacted") {
    return { table_name: "compaction_events", route_key: "compacted", reserved: true };
  }

  return { table_name: null, route_key: record_type, reserved: false };
}
