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
    raw_text: line.raw_text,
    conversation_id,
    turn_id,
  };

  switch (classification.table_name) {
    case "conversation_meta_raw": {
      const threadSpawn = nestedGet(payload, "source", "subagent", "thread_spawn");
      return {
        ...common,
        conversation_started_at: stringOrNone(payload.timestamp),
        cwd: stringOrNone(payload.cwd),
        cli_version: stringOrNone(payload.cli_version),
        originator: stringOrNone(payload.originator),
        model_provider: stringOrNone(payload.model_provider),
        agent_nickname: stringOrNone(payload.agent_nickname),
        agent_role: stringOrNone(payload.agent_role),
        git: payload.git,
        source: payload.source,
        thread_spawn: typeof threadSpawn === "object" && threadSpawn !== null ? threadSpawn : null,
        base_instructions_text: nestedGet(payload, "base_instructions", "text"),
        payload,
      };
    }
    case "turn_manifest":
      return {
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
        collaboration_mode: nestedGet(payload, "collaboration_mode", "mode"),
        reasoning_effort: nestedGet(payload, "collaboration_mode", "settings", "reasoning_effort"),
        truncation_mode: nestedGet(payload, "truncation_policy", "mode"),
        truncation_limit: nestedGet(payload, "truncation_policy", "limit"),
        payload,
      };
    case "message_items_raw": {
      const contentParts = Array.isArray(payload.content) ? payload.content : [];
      return {
        ...common,
        message_id: `message:${rawRecordId(line)}`,
        role: stringOrNone(payload.role),
        phase: stringOrNone(payload.phase),
        summary: payload.summary,
        status: stringOrNone(payload.status),
        content_parts: contentParts,
        content_text: extractContentText(contentParts),
        payload,
      };
    }
    case "reasoning_items_raw":
      return {
        ...common,
        reasoning_id: `reasoning:${rawRecordId(line)}`,
        reasoning_kind: classification.route_key === "event_msg.agent_reasoning" ? "agent_reasoning" : "reasoning",
        summary: payload.summary,
        content: payload.content,
        encrypted_content: payload.encrypted_content,
        text: stringOrNone(payload.text),
        payload,
      };
    case "tool_calls_raw": {
      const rawInput = line.payload_type === "function_call" ? payload.arguments : payload.input;
      const parsedInput = parseJsonish(rawInput);
      return {
        ...common,
        tool_call_id: `tool-call:${rawRecordId(line)}`,
        call_id: stringOrNone(payload.call_id),
        tool_name: stringOrNone(payload.name),
        tool_kind: line.payload_type,
        status: stringOrNone(payload.status),
        arguments_raw: payload.arguments,
        input_raw: payload.input,
        session_id: extractSessionId(parsedInput ?? rawInput),
        payload,
      };
    }
    case "tool_call_outputs_raw":
      return {
        ...common,
        tool_output_id: `tool-output:${rawRecordId(line)}`,
        call_id: stringOrNone(payload.call_id),
        tool_kind: line.payload_type,
        status: stringOrNone(payload.status),
        output_raw: payload.output,
        payload,
      };
    case "telemetry_events": {
      const info = typeof payload.info === "object" && payload.info !== null ? payload.info as JSONDict : {};
      const totalUsage = typeof info.total_token_usage === "object" && info.total_token_usage !== null ? info.total_token_usage as JSONDict : {};
      const lastUsage = typeof info.last_token_usage === "object" && info.last_token_usage !== null ? info.last_token_usage as JSONDict : {};
      const rateLimits = typeof payload.rate_limits === "object" && payload.rate_limits !== null ? payload.rate_limits as JSONDict : {};
      const totalReasoning = totalUsage.reasoning_output_tokens ?? totalUsage.reasoning_tokens;
      const lastReasoning = lastUsage.reasoning_output_tokens ?? lastUsage.reasoning_tokens;
      return {
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
      };
    }
    case "lifecycle_events":
      return {
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
        model_context_window: payload.model_context_window,
        collaboration_mode_kind: stringOrNone(payload.collaboration_mode_kind),
        payload,
      };
    default:
      return {
        ...common,
        event_id: `${classification.table_name}:${rawRecordId(line)}`,
        event_type: line.payload_type || line.record_type,
        payload,
      };
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
    const unkCount = file_context.unknown_route_counts[routeKey] ?? 0;
    file_context.unknown_route_counts[routeKey] = unkCount + 1;
    const bufUnkCount = buffers.unknown_route_counts[routeKey] ?? 0;
    buffers.unknown_route_counts[routeKey] = bufUnkCount + 1;
    return;
  }

  if (classification.reserved) {
    const resCount = file_context.reserved_route_counts[routeKey] ?? 0;
    file_context.reserved_route_counts[routeKey] = resCount + 1;
    const bufResCount = buffers.reserved_route_counts[routeKey] ?? 0;
    buffers.reserved_route_counts[routeKey] = bufResCount + 1;
  }

  const row = extractRow(classification, line, conversation_id, turn_id);
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
