import type { ParsedLine, JSONDict, FileContext, ExtractionBuffers } from "./models";
import { getPayload, rawRecordId, PRE_TURN_ID } from "./models";
import { classifyRecord, type Classification } from "./classifier";

function stringOrNone(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nestedGet(obj: unknown, ...path: string[]): unknown {
  let current = obj;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return null;
    current = (current as JSONDict)[key];
  }
  return current;
}

function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || text[0] !== "{" && text[0] !== "[") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractSessionId(value: unknown): string | null {
  if (typeof value === "object" && value !== null) {
    const dict = value as JSONDict;
    const sid = dict.session_id;
    if (typeof sid === "string" && sid) return sid;
    for (const v of Object.values(dict)) {
      const found = extractSessionId(v);
      if (found) return found;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractSessionId(item);
      if (found) return found;
    }
  }
  return null;
}

function extractContentText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const fragments: string[] = [];
  for (const part of parts) {
    if (typeof part !== "object" || part === null) continue;
    const dict = part as JSONDict;
    const text = stringOrNone(dict.text);
    if (text) { fragments.push(text); continue; }
    const content = stringOrNone(dict.content);
    if (content) fragments.push(content);
  }
  return fragments.join("\n");
}

function extractInputImages(parts: unknown): JSONDict[] {
  if (!Array.isArray(parts)) return [];
  const images: JSONDict[] = [];
  for (const part of parts) {
    if (typeof part !== "object" || part === null) continue;
    const dict = part as JSONDict;
    if (dict.type !== "input_image") continue;
    images.push({
      image_url: stringOrNone(dict.image_url),
      detail: dict.detail ?? null,
    });
  }
  return images;
}

function objectOrNull(value: unknown): JSONDict | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JSONDict
    : null;
}

function commandToText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(" ");
  }
  return null;
}

function durationMs(value: unknown): number | null {
  const duration = objectOrNull(value);
  if (!duration) return null;
  const secs = typeof duration.secs === "number" ? duration.secs : 0;
  const nanos = typeof duration.nanos === "number" ? duration.nanos : 0;
  return Math.round((secs * 1000 + nanos / 1_000_000) * 1000) / 1000;
}

function finalizeRow(row: JSONDict, payload: JSONDict, extractedKeys: string[]): JSONDict {
  const extracted = new Set(["type", "turn_id", ...extractedKeys]);
  const payloadKeys = Object.keys(payload);
  const extracted_fields = [...extracted]
    .filter((key) => payloadKeys.includes(key))
    .sort();
  const extra_fields: JSONDict = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!extracted.has(key)) extra_fields[key] = value;
  }
  return {
    ...row,
    extracted_fields,
    extra_fields,
  };
}

function appendRow(
  buffers: ExtractionBuffers,
  file_context: FileContext,
  table_name: string,
  row: JSONDict,
): void {
  const arr = buffers[table_name as keyof ExtractionBuffers];
  if (Array.isArray(arr)) {
    arr.push(row);
  }
  file_context.table_counts[table_name] = (file_context.table_counts[table_name] ?? 0) + 1;
}

const REQUIRED_PAYLOAD_FIELDS: Record<string, string[]> = {
  "event_msg.exec_command_end": ["call_id", "command"],
  "event_msg.patch_apply_end": ["call_id", "changes"],
  "event_msg.mcp_tool_call_end": ["call_id", "invocation"],
  "event_msg.error": ["message"],
  "event_msg.stream_error": ["message"],
  "response_item.web_search_call": ["call_id"],
};

function appendParseWarning(
  buffers: ExtractionBuffers,
  file_context: FileContext,
  line: ParsedLine,
  route_key: string,
  field: string,
): void {
  buffers.parse_errors.push({
    parse_error_id: `${rawRecordId(line)}:missing:${field}`,
    source_path: line.source_path,
    source_line_no: line.source_line_no,
    raw_text: line.raw_text,
    error: `payload field '${field}' is missing for ${route_key}`,
    error_type: "missing_required_field",
    severity: "warning",
    route_key,
    field,
  });
  file_context.parse_error_count += 1;
}

function warnMissingRequiredFields(
  buffers: ExtractionBuffers,
  file_context: FileContext,
  line: ParsedLine,
  classification: Classification,
): void {
  const required = REQUIRED_PAYLOAD_FIELDS[classification.route_key] ?? [];
  if (required.length === 0) return;
  const payload = getPayload(line);
  for (const field of required) {
    const value = payload[field];
    if (value === undefined || value === null || value === "") {
      appendParseWarning(buffers, file_context, line, classification.route_key, field);
    }
  }
}

function resolveConversationId(
  line: ParsedLine,
  file_context: FileContext,
): string | null {
  if (line.record_type === "session_meta") {
    const cid = stringOrNone(getPayload(line).id);
    if (cid) {
      file_context.conversation_id = cid;
      return cid;
    }
  }
  if (file_context.conversation_id) return file_context.conversation_id;
  return stringOrNone(getPayload(line).conversation_id);
}

function resolveTurnId(
  line: ParsedLine,
  file_context: FileContext,
): string | null {
  if (line.record_type === "session_meta") return null;

  const explicit = stringOrNone(getPayload(line).turn_id);
  if (explicit) {
    file_context.active_turn_id = explicit;
    file_context.turn_ids.add(explicit);
    return explicit;
  }
  if (file_context.active_turn_id) return file_context.active_turn_id;
  return PRE_TURN_ID;
}

function extractRow(
  classification: Classification,
  line: ParsedLine,
  conversation_id: string | null,
  turn_id: string | null,
): JSONDict {
  const payload = getPayload(line);
  const common: JSONDict = {
    raw_record_id: rawRecordId(line),
    source_path: line.source_path,
    source_line_no: line.source_line_no,
    timestamp: line.timestamp,
    record_type: line.record_type,
    payload_type: line.payload_type,
    route_key: classification.route_key,
    route_table: classification.table_name,
    raw_text: line.raw_text,
    conversation_id,
    turn_id,
  };

  switch (classification.table_name) {
    case "conversation_meta_raw": {
      const threadSpawn = nestedGet(payload, "source", "subagent", "thread_spawn");
      return finalizeRow({
        ...common,
        conversation_started_at: stringOrNone(payload.timestamp),
        cwd: stringOrNone(payload.cwd),
        cli_version: stringOrNone(payload.cli_version),
        originator: stringOrNone(payload.originator),
        model_provider: stringOrNone(payload.model_provider),
        agent_nickname: stringOrNone(payload.agent_nickname),
        agent_role: stringOrNone(payload.agent_role),
        forked_from_id: stringOrNone(payload.forked_from_id),
        thread_source: payload.thread_source,
        agent_path: stringOrNone(payload.agent_path),
        dynamic_tools: payload.dynamic_tools,
        memory_mode: stringOrNone(payload.memory_mode),
        git: payload.git,
        source: payload.source,
        thread_spawn: typeof threadSpawn === "object" && threadSpawn !== null ? threadSpawn : null,
        base_instructions_text: nestedGet(payload, "base_instructions", "text"),
        payload,
      }, payload, [
        "id", "timestamp", "cwd", "cli_version", "originator", "model_provider",
        "agent_nickname", "agent_role", "forked_from_id", "thread_source",
        "agent_path", "dynamic_tools", "memory_mode", "git", "source",
        "base_instructions",
      ]);
    }
    case "turn_manifest":
      return finalizeRow({
        ...common,
        cwd: stringOrNone(payload.cwd),
        current_date: stringOrNone(payload.current_date),
        timezone: stringOrNone(payload.timezone),
        approval_policy: stringOrNone(payload.approval_policy),
        sandbox_policy_type: nestedGet(payload, "sandbox_policy", "type"),
        sandbox_writable_roots: nestedGet(payload, "sandbox_policy", "writable_roots"),
        sandbox_network_access: nestedGet(payload, "sandbox_policy", "network_access"),
        model: stringOrNone(payload.model),
        personality: stringOrNone(payload.personality),
        developer_instructions: payload.developer_instructions,
        effort: payload.effort,
        final_output_json_schema: payload.final_output_json_schema,
        realtime_active: payload.realtime_active,
        summary: payload.summary,
        user_instructions: payload.user_instructions,
        collaboration_mode: nestedGet(payload, "collaboration_mode", "mode"),
        reasoning_effort: nestedGet(payload, "collaboration_mode", "settings", "reasoning_effort"),
        truncation_mode: nestedGet(payload, "truncation_policy", "mode"),
        truncation_limit: nestedGet(payload, "truncation_policy", "limit"),
        payload,
      }, payload, [
        "turn_id", "cwd", "current_date", "timezone", "approval_policy",
        "sandbox_policy", "model", "personality", "developer_instructions",
        "effort", "final_output_json_schema", "realtime_active", "summary",
        "user_instructions", "collaboration_mode", "truncation_policy",
      ]);
    case "message_items_raw": {
      const contentParts = Array.isArray(payload.content) ? payload.content : [];
      return finalizeRow({
        ...common,
        message_id: `message:${rawRecordId(line)}`,
        role: stringOrNone(payload.role),
        phase: stringOrNone(payload.phase),
        summary: payload.summary,
        status: stringOrNone(payload.status),
        content_parts: contentParts,
        content_text: extractContentText(contentParts),
        input_images: extractInputImages(contentParts),
        payload,
      }, payload, ["role", "phase", "summary", "status", "content"]);
    }
    case "reasoning_items_raw":
      return finalizeRow({
        ...common,
        reasoning_id: `reasoning:${rawRecordId(line)}`,
        reasoning_kind: classification.route_key === "event_msg.agent_reasoning" ? "agent_reasoning" : "reasoning",
        summary: payload.summary,
        content: payload.content,
        encrypted_content: payload.encrypted_content,
        text: stringOrNone(payload.text),
        payload,
      }, payload, ["summary", "content", "encrypted_content", "text"]);
    case "tool_calls_raw": {
      const rawInput = line.payload_type === "function_call" ? payload.arguments : payload.input;
      const parsedInput = parseJsonish(rawInput);
      return finalizeRow({
        ...common,
        tool_call_id: `tool-call:${rawRecordId(line)}`,
        call_id: stringOrNone(payload.call_id),
        tool_name: stringOrNone(payload.name),
        namespace: stringOrNone(payload.namespace),
        tool_kind: line.payload_type,
        status: stringOrNone(payload.status),
        arguments_raw: payload.arguments,
        input_raw: payload.input,
        session_id: extractSessionId(parsedInput ?? rawInput),
        payload,
      }, payload, ["call_id", "name", "namespace", "status", "arguments", "input"]);
    }
    case "tool_call_outputs_raw":
      return finalizeRow({
        ...common,
        tool_output_id: `tool-output:${rawRecordId(line)}`,
        call_id: stringOrNone(payload.call_id),
        tool_kind: line.payload_type,
        status: stringOrNone(payload.status),
        output_raw: payload.output,
        output_images: extractInputImages(payload.output),
        payload,
      }, payload, ["call_id", "status", "output"]);
    case "telemetry_events": {
      const info = typeof payload.info === "object" && payload.info !== null ? payload.info as JSONDict : {};
      const totalUsage = typeof info.total_token_usage === "object" && info.total_token_usage !== null ? info.total_token_usage as JSONDict : {};
      const lastUsage = typeof info.last_token_usage === "object" && info.last_token_usage !== null ? info.last_token_usage as JSONDict : {};
      const rateLimits = typeof payload.rate_limits === "object" && payload.rate_limits !== null ? payload.rate_limits as JSONDict : {};
      const totalReasoning = totalUsage.reasoning_output_tokens ?? totalUsage.reasoning_tokens;
      const lastReasoning = lastUsage.reasoning_output_tokens ?? lastUsage.reasoning_tokens;
      return finalizeRow({
        ...common,
        event_type: line.payload_type,
        model_context_window: info.model_context_window,
        total_input_tokens: totalUsage.input_tokens,
        total_output_tokens: totalUsage.output_tokens,
        total_reasoning_tokens: totalReasoning,
        total_reasoning_output_tokens: totalReasoning,
        total_cached_input_tokens: totalUsage.cached_input_tokens,
        total_tokens: totalUsage.total_tokens,
        last_input_tokens: lastUsage.input_tokens,
        last_output_tokens: lastUsage.output_tokens,
        last_reasoning_tokens: lastReasoning,
        last_reasoning_output_tokens: lastReasoning,
        last_cached_input_tokens: lastUsage.cached_input_tokens,
        last_total_tokens: lastUsage.total_tokens,
        rate_limit_id: stringOrNone(rateLimits.limit_id),
        rate_limit_name: stringOrNone(rateLimits.limit_name),
        primary_rate_limit: rateLimits.primary,
        secondary_rate_limit: rateLimits.secondary,
        credits: rateLimits.credits,
        plan_type: stringOrNone(rateLimits.plan_type),
        info,
        rate_limits: rateLimits,
        payload,
      }, payload, ["info", "rate_limits"]);
    }
    case "lifecycle_events": {
      const isUserMsg = line.payload_type === "user_message";
      const isAgentMsg = line.payload_type === "agent_message";
      return finalizeRow({
        ...common,
        event_id: `lifecycle:${rawRecordId(line)}`,
        event_type: line.payload_type,
        message: stringOrNone(payload.message),
        phase: stringOrNone(payload.phase),
        reason: stringOrNone(payload.reason),
        last_agent_message: stringOrNone(payload.last_agent_message),
        started_at: payload.started_at,
        completed_at: payload.completed_at,
        duration_ms: payload.duration_ms,
        time_to_first_token_ms: payload.time_to_first_token_ms,
        model_context_window: payload.model_context_window,
        collaboration_mode_kind: stringOrNone(payload.collaboration_mode_kind),
        ...(isUserMsg ? {
          images: payload.images,
          image_details: payload.image_details,
          local_images: payload.local_images,
          local_image_details: payload.local_image_details,
          text_elements: payload.text_elements,
          client_id: stringOrNone(payload.client_id),
        } : {}),
        ...(isAgentMsg ? {
          memory_citation: payload.memory_citation,
        } : {}),
        payload,
      }, payload, [
        "message", "phase", "reason", "last_agent_message", "started_at",
        "completed_at", "duration_ms", "time_to_first_token_ms",
        "model_context_window", "collaboration_mode_kind", "turn_id",
        "trace_id",
        "images", "image_details", "local_images", "local_image_details",
        "text_elements", "client_id",
        "memory_citation", "role", "content", "status", "summary",
      ]);
    }
    case "structured_tool_end_events": {
      const invocation = objectOrNull(payload.invocation);
      return finalizeRow({
        ...common,
        event_id: `tool-event:${rawRecordId(line)}`,
        event_type: line.payload_type || line.record_type,
        call_id: stringOrNone(payload.call_id),
        process_id: stringOrNone(payload.process_id),
        command: payload.command,
        command_text: commandToText(payload.command),
        cwd: stringOrNone(payload.cwd),
        parsed_cmd: payload.parsed_cmd,
        source: stringOrNone(payload.source),
        stdout: stringOrNone(payload.stdout),
        stderr: stringOrNone(payload.stderr),
        aggregated_output: stringOrNone(payload.aggregated_output),
        formatted_output: stringOrNone(payload.formatted_output),
        exit_code: payload.exit_code,
        duration: payload.duration,
        duration_ms: durationMs(payload.duration),
        status: stringOrNone(payload.status),
        success: payload.success,
        changes: payload.changes,
        invocation,
        server: stringOrNone(invocation?.server),
        tool_name: stringOrNone(invocation?.tool),
        result: payload.result,
        path: stringOrNone(payload.path),
        revised_prompt: stringOrNone(payload.revised_prompt),
        generation_result: payload.result,
        payload,
      }, payload, [
        "call_id", "process_id", "command", "cwd", "parsed_cmd", "source",
        "stdout", "stderr", "aggregated_output", "formatted_output",
        "exit_code", "duration", "status", "success", "changes",
        "invocation", "result", "path", "revised_prompt",
      ]);
    }
    case "collaboration_events":
      return finalizeRow({
        ...common,
        collab_event_id: `collab:${rawRecordId(line)}`,
        event_type: line.payload_type,
        call_id: stringOrNone(payload.call_id),
        sender_thread_id: stringOrNone(payload.sender_thread_id),
        receiver_thread_id: stringOrNone(payload.receiver_thread_id),
        new_thread_id: stringOrNone(payload.new_thread_id),
        receiver_agent_nickname: stringOrNone(payload.receiver_agent_nickname),
        receiver_agent_role: stringOrNone(payload.receiver_agent_role),
        new_agent_nickname: stringOrNone(payload.new_agent_nickname),
        new_agent_role: stringOrNone(payload.new_agent_role),
        model: stringOrNone(payload.model),
        reasoning_effort: stringOrNone(payload.reasoning_effort),
        prompt: stringOrNone(payload.prompt),
        status: payload.status,
        agent_statuses: payload.agent_statuses,
        statuses: payload.statuses,
        payload,
      }, payload, [
        "call_id", "sender_thread_id", "receiver_thread_id", "new_thread_id",
        "receiver_agent_nickname", "receiver_agent_role", "new_agent_nickname",
        "new_agent_role", "model", "reasoning_effort", "prompt", "status",
        "agent_statuses", "statuses",
      ]);
    case "search_events": {
      const action = objectOrNull(payload.action);
      return finalizeRow({
        ...common,
        event_id: `search:${rawRecordId(line)}`,
        event_type: line.payload_type || line.record_type,
        call_id: stringOrNone(payload.call_id),
        status: stringOrNone(payload.status),
        action: payload.action,
        query: stringOrNone(payload.query) ?? stringOrNone(action?.query),
        results: payload.results,
        sources: payload.sources,
        duration: payload.duration,
        duration_ms: durationMs(payload.duration),
        payload,
      }, payload, ["call_id", "status", "action", "query", "results", "sources", "duration"]);
    }
    case "system_events":
      return finalizeRow({
        ...common,
        event_id: `system:${rawRecordId(line)}`,
        event_type: line.payload_type || line.record_type,
        id: stringOrNone(payload.id),
        target_item_id: stringOrNone(payload.target_item_id),
        status: stringOrNone(payload.status),
        message: stringOrNone(payload.message),
        error_type: stringOrNone(payload.error_type) ?? stringOrNone(payload.kind) ?? stringOrNone(payload.code),
        additional_details: payload.additional_details,
        risk_level: stringOrNone(payload.risk_level),
        risk_score: payload.risk_score,
        user_authorization: stringOrNone(payload.user_authorization),
        rationale: stringOrNone(payload.rationale),
        decision_source: stringOrNone(payload.decision_source),
        action: payload.action,
        num_turns: payload.num_turns,
        unified_diff: stringOrNone(payload.unified_diff),
        changes: payload.changes,
        explanation: stringOrNone(payload.explanation),
        plan: payload.plan,
        goal: stringOrNone(payload.goal),
        payload,
      }, payload, [
        "id", "target_item_id", "status", "message", "error_type", "kind",
        "code", "additional_details", "risk_level", "risk_score",
        "user_authorization", "rationale", "decision_source", "action",
        "num_turns", "unified_diff", "changes", "explanation", "plan", "goal",
      ]);
    case "compaction_events":
      return finalizeRow({
        ...common,
        event_id: `compaction:${rawRecordId(line)}`,
        event_type: line.payload_type || line.record_type,
        summary: payload.summary,
        original_token_count: payload.original_token_count,
        compacted_token_count: payload.compacted_token_count,
        payload,
      }, payload, ["summary", "original_token_count", "compacted_token_count"]);
    default:
      return finalizeRow({
        ...common,
        event_id: `${classification.table_name}:${rawRecordId(line)}`,
        event_type: line.payload_type || line.record_type,
        payload,
      }, payload, []);
  }
}

/**
 * Process a single parsed line, extracting rows into buffers.
 */
export function processLine(
  line: ParsedLine,
  file_context: FileContext,
  buffers: ExtractionBuffers,
): void {
  file_context.parsed_record_count += 1;

  const rtCount = buffers.record_type_counts[line.record_type] ?? 0;
  buffers.record_type_counts[line.record_type] = rtCount + 1;

  const routeKey = line.payload_type ? `${line.record_type}.${line.payload_type}` : line.record_type;
  const pkCount = buffers.payload_type_counts[routeKey] ?? 0;
  buffers.payload_type_counts[routeKey] = pkCount + 1;

  const conversation_id = resolveConversationId(line, file_context);
  const turn_id = resolveTurnId(line, file_context);
  const classification = classifyRecord(line.record_type, line.payload_type);

  const raw_record: JSONDict = {
    raw_record_id: rawRecordId(line),
    source_path: line.source_path,
    source_line_no: line.source_line_no,
    timestamp: line.timestamp,
    record_type: line.record_type,
    payload_type: line.payload_type,
    route_key: classification.route_key,
    route_table: classification.table_name,
    conversation_id,
    turn_id,
    call_id: stringOrNone(getPayload(line).call_id),
    raw_text: line.raw_text,
    record: line.data,
  };
  appendRow(buffers, file_context, "raw_records", raw_record);

  if (classification.table_name === null) {
    const unkCount = file_context.unknown_route_counts[classification.route_key] ?? 0;
    file_context.unknown_route_counts[classification.route_key] = unkCount + 1;
    const bufUnkCount = buffers.unknown_route_counts[classification.route_key] ?? 0;
    buffers.unknown_route_counts[classification.route_key] = bufUnkCount + 1;
    return;
  }

  if (classification.reserved) {
    const resCount = file_context.reserved_route_counts[routeKey] ?? 0;
    file_context.reserved_route_counts[routeKey] = resCount + 1;
    const bufResCount = buffers.reserved_route_counts[routeKey] ?? 0;
    buffers.reserved_route_counts[routeKey] = bufResCount + 1;
  }

  const row = extractRow(classification, line, conversation_id, turn_id);
  warnMissingRequiredFields(buffers, file_context, line, classification);
  appendRow(buffers, file_context, classification.table_name, row);

  if (classification.table_name === "tool_calls_raw") {
    const callId = stringOrNone(row.call_id);
    if (callId) {
      if (!file_context.call_records[callId]) file_context.call_records[callId] = [];
      file_context.call_records[callId].push(rawRecordId(line));
    }
  } else if (classification.table_name === "tool_call_outputs_raw") {
    const callId = stringOrNone(row.call_id);
    if (callId) {
      if (!file_context.call_outputs[callId]) file_context.call_outputs[callId] = [];
      file_context.call_outputs[callId].push(rawRecordId(line));
    }
  }
}

/**
 * Build tool call pair rows from the file context's call/output records.
 */
export function buildToolCallPairs(file_context: FileContext): JSONDict[] {
  const rows: JSONDict[] = [];
  const allIds = new Set([
    ...Object.keys(file_context.call_records),
    ...Object.keys(file_context.call_outputs),
  ]);
  const sortedIds = [...allIds].sort();

  for (const callId of sortedIds) {
    const callRefs = file_context.call_records[callId] ?? [];
    const outputRefs = file_context.call_outputs[callId] ?? [];
    let pairStatus: string;
    if (callRefs.length > 0 && outputRefs.length > 0) pairStatus = "paired";
    else if (callRefs.length > 0) pairStatus = "missing_output";
    else pairStatus = "orphan_output";

    rows.push({
      call_id: callId,
      source_path: file_context.source_path,
      call_record_ref: callRefs[0] ?? null,
      output_record_ref: outputRefs[0] ?? null,
      call_record_refs: callRefs,
      output_record_refs: outputRefs,
      call_count: callRefs.length,
      output_count: outputRefs.length,
      pair_status: pairStatus,
    });
  }
  return rows;
}
