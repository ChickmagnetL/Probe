import type { JSONDict, ExtractionBuffers } from "./models";
import { stringOrNull } from "./summary-helpers";
import {
  type SessionBuild,
  createSession,
  serializeImportedSession,
  serializeTree,
} from "./summary-serialize";

function ensureSession(
  sessions: Map<string, SessionBuild>,
  session_id: string,
): SessionBuild {
  let s = sessions.get(session_id);
  if (!s) {
    s = createSession(session_id);
    sessions.set(session_id, s);
  }
  return s;
}

function sessionIdFromRow(row: JSONDict): string | null {
  return stringOrNull(row.conversation_id)
    ?? stringOrNull(row.thread_id)
    ?? stringOrNull(row.id);
}

function seedSessions(
  buffers: ExtractionBuffers,
  sessions: Map<string, SessionBuild>,
): void {
  for (const row of buffers.conversation_meta_raw) {
    const session_id = sessionIdFromRow(row) ?? "unknown";
    const session = ensureSession(sessions, session_id);
    const sp = stringOrNull(row.source_path);
    if (sp) {
      session.source_path = sp;
      session.file_name = sp.split("/").pop() ?? null;
    }
    if (!session.source_raw_record_id) {
      session.source_raw_record_id = stringOrNull(row.raw_record_id);
    }
    if (session.source_line_no === null && typeof row.source_line_no === "number") {
      session.source_line_no = row.source_line_no;
    }
    if (!session.source_raw_text) {
      session.source_raw_text = stringOrNull(row.raw_text);
    }
    if (!session.base_instructions_text) {
      session.base_instructions_text = stringOrNull(row.base_instructions_text);
    }
    const threadSpawn = (typeof row.thread_spawn === "object" && row.thread_spawn !== null)
      ? row.thread_spawn as JSONDict : {};
    const parentSessionId = stringOrNull(threadSpawn.parent_thread_id);
    if (parentSessionId) {
      session.parent_session_id = parentSessionId;
      session.is_subagent = true;
    }
    const source = row.source;
    if (typeof source === "object" && source !== null) {
      const subagentInfo = (source as JSONDict).subagent;
      if (typeof subagentInfo === "object" && subagentInfo !== null) {
        session.is_subagent = true;
        const subagentType = stringOrNull((subagentInfo as JSONDict).other)
          ?? stringOrNull((subagentInfo as JSONDict).type);
        if (subagentType && !session.agent_role) session.agent_role = subagentType;
      }
    }
    session.agent_nickname = stringOrNull(row.agent_nickname)
      ?? stringOrNull(threadSpawn.agent_nickname);
    session.agent_role = session.agent_role
      ?? stringOrNull(row.agent_role)
      ?? stringOrNull(threadSpawn.agent_role);
    session.cli_version = stringOrNull(row.cli_version);
    session.start_time = stringOrNull(row.conversation_started_at)
      ?? stringOrNull(row.timestamp);
  }
}

function sessionForRow(
  row: JSONDict,
  sessions: Map<string, SessionBuild>,
): SessionBuild {
  let session_id = sessionIdFromRow(row);
  if (!session_id) {
    const sp = stringOrNull(row.source_path);
    session_id = sp ?? "unknown-session";
  }
  const session = ensureSession(sessions, session_id);
  const sp = stringOrNull(row.source_path);
  if (sp) {
    session.source_path = session.source_path ?? sp;
    session.file_name = session.file_name ?? sp.split("/").pop() ?? null;
  }
  return session;
}

function collectEvents(
  buffers: ExtractionBuffers,
  sessions: Map<string, SessionBuild>,
): void {
  for (const row of buffers.message_items_raw) {
    const session = sessionForRow(row, sessions);
    session.events.push(buildMessageEvent(row, session.session_id));
  }
  for (const row of buffers.tool_calls_raw) {
    const session = sessionForRow(row, sessions);
    session.events.push(buildToolCallEvent(row, session.session_id));
  }
  for (const row of buffers.tool_call_outputs_raw) {
    const session = sessionForRow(row, sessions);
    session.events.push(buildToolOutputEvent(row, session.session_id));
  }
  for (const row of buffers.telemetry_events) {
    const session = sessionForRow(row, sessions);
    session.telemetry.push(buildTelemetrySnapshot(row));
  }
  for (const row of buffers.lifecycle_events) {
    const session = sessionForRow(row, sessions);
    session.lifecycle.push({ ...row });
  }
  for (const row of buffers.structured_tool_end_events) {
    const session = sessionForRow(row, sessions);
    session.events.push(buildParserEvent(row, session.session_id, "tool_event"));
  }
  for (const row of buffers.search_events) {
    const session = sessionForRow(row, sessions);
    session.events.push(buildParserEvent(row, session.session_id, "search_event"));
  }
  for (const row of buffers.system_events) {
    const session = sessionForRow(row, sessions);
    session.events.push(buildParserEvent(row, session.session_id, "system_event"));
  }
  for (const row of buffers.compaction_events) {
    const session = sessionForRow(row, sessions);
    session.events.push(buildParserEvent(row, session.session_id, "compaction_event"));
  }
}

function ensureSyntheticRoots(sessions: Map<string, SessionBuild>): void {
  const parentIds = new Set<string>();
  for (const s of sessions.values()) {
    if (s.parent_session_id) parentIds.add(s.parent_session_id);
  }
  for (const pid of parentIds) {
    if (!sessions.has(pid)) {
      const synth = createSession(pid);
      synth.is_synthetic = true;
      sessions.set(pid, synth);
    }
  }
  for (const s of sessions.values()) {
    if (s.parent_session_id && sessions.has(s.parent_session_id)) {
      sessions.get(s.parent_session_id)!.child_ids.add(s.session_id);
    }
  }
}

function sortedImportedSessionIds(sessions: Map<string, SessionBuild>): string[] {
  return [...sessions.values()]
    .filter((s) => s.source_path)
    .sort((a, b) => a.session_id.localeCompare(b.session_id))
    .map((s) => s.session_id);
}

function sortedRootSessionIds(sessions: Map<string, SessionBuild>): string[] {
  return [...sessions.values()]
    .filter((s) => !s.parent_session_id)
    .sort((a, b) => a.session_id.localeCompare(b.session_id))
    .map((s) => s.session_id);
}

// ── Event builders (used by collectEvents) ──────────────

const KIND_LABELS: Record<string, string> = {
  agents_md: "项目规则（AGENTS.md）",
  user_input: "用户输入",
  assistant_output: "最终回复",
  assistant_update: "处理中回复",
  instruction: "开发者指令",
};

function messageKind(role: string | null, phase: string | null): string {
  if (role === "user") return "user_input";
  if (role === "assistant" && phase === "final_answer") return "assistant_output";
  if (role === "assistant") return "assistant_update";
  if (role === "developer") return "instruction";
  return "instruction";
}

function roleLabel(role: string | null): string {
  const map: Record<string, string> = { user: "用户", assistant: "助手", developer: "开发者" };
  return map[role ?? ""] ?? role ?? "消息";
}

function truncate(text: string, limit: number): string {
  const normalized = text.split(/\s+/).join(" ");
  if (normalized.length <= limit) return normalized;
  return normalized.slice(0, limit - 1) + "…";
}

function jsonishText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function buildMessageEvent(row: JSONDict, session_id: string): JSONDict {
  const role = stringOrNull(row.role);
  const phase = stringOrNull(row.phase);
  const content = stringOrNull(row.content_text) ?? jsonishText(row.content_parts);
  const contentParts = Array.isArray(row.content_parts) ? row.content_parts : [];
  let kind = messageKind(role, phase);
  if (kind === "user_input" && (content ?? "").startsWith("# AGENTS.md instructions")) kind = "agents_md";
  const title = KIND_LABELS[kind] ?? roleLabel(role);
  const isUserSide = kind === "user_input" || kind === "agents_md" || kind === "instruction";
  return {
    event_id: row.message_id ?? row.raw_record_id,
    session_id,
    timestamp: row.timestamp,
    kind,
    role,
    phase,
    title,
    summary: truncate(content ?? "没有可见文本", 120),
    content,
    content_parts: contentParts,
    content_label: "消息内容",
    estimated_input_tokens: isUserSide ? 0 : null,
    raw_record_id: row.raw_record_id,
    source_path: row.source_path,
    source_line_no: row.source_line_no,
    raw_text: row.raw_text,
  };
}

function buildToolCallEvent(row: JSONDict, session_id: string): JSONDict {
  const toolName = stringOrNull(row.tool_name) ?? "unknown_tool";
  const args = stringOrNull(row.arguments_raw) ?? stringOrNull(row.input_raw);
  return {
    event_id: row.tool_call_id ?? row.raw_record_id,
    session_id,
    timestamp: row.timestamp,
    kind: "tool_call",
    title: `工具调用 · ${toolName}`,
    summary: truncate(args ?? "已记录调用参数", 96),
    args,
    content_label: "调用参数",
    raw_record_id: row.raw_record_id,
    source_path: row.source_path,
    source_line_no: row.source_line_no,
    raw_text: row.raw_text,
  };
}

function buildToolOutputEvent(row: JSONDict, session_id: string): JSONDict {
  const output = stringOrNull(row.output_raw) ?? jsonishText(row.output_raw);
  const status = stringOrNull(row.status);
  return {
    event_id: row.tool_output_id ?? row.raw_record_id,
    session_id,
    timestamp: row.timestamp,
    kind: "tool_output",
    title: "工具输出",
    summary: truncate(output ?? status ?? "工具已返回输出", 96),
    content: output,
    content_label: "输出内容",
    detail_note: status,
    raw_record_id: row.raw_record_id,
    source_path: row.source_path,
    source_line_no: row.source_line_no,
    raw_text: row.raw_text,
  };
}

function buildTelemetrySnapshot(row: JSONDict): JSONDict {
  function asInt(v: unknown): number {
    if (typeof v === "boolean") return 0;
    if (typeof v === "number") return v;
    return 0;
  }
  return {
    timestamp: row.timestamp,
    total_input_tokens: asInt(row.total_input_tokens),
    total_output_tokens: asInt(row.total_output_tokens),
    total_reasoning_output_tokens: asInt(row.total_reasoning_output_tokens ?? row.total_reasoning_tokens),
    total_cached_input_tokens: asInt(row.total_cached_input_tokens),
    total_tokens: asInt(row.total_tokens),
  };
}

function buildParserEvent(row: JSONDict, session_id: string, kind: string): JSONDict {
  const eventType = stringOrNull(row.event_type) ?? stringOrNull(row.payload_type) ?? "event";
  const title = eventTitle(eventType);
  const content = eventContent(row, eventType);
  return {
    event_id: row.event_id ?? row.raw_record_id,
    session_id,
    timestamp: row.timestamp,
    kind,
    role: null,
    phase: null,
    title,
    summary: truncate(eventSummary(row, eventType, content), 120),
    content,
    content_label: "事件详情",
    detail_note: stringOrNull(row.status) ?? stringOrNull(row.error_type),
    raw_record_id: row.raw_record_id,
    source_path: row.source_path,
    source_line_no: row.source_line_no,
    raw_text: row.raw_text,
    event_type: eventType,
  };
}

function eventTitle(eventType: string): string {
  const labels: Record<string, string> = {
    exec_command_begin: "命令开始",
    exec_command_end: "命令结果",
    patch_apply_end: "文件修改结果",
    mcp_tool_call_end: "外部工具结果",
    view_image_tool_call: "查看图片",
    image_generation_call: "图片生成",
    web_search_call: "网页搜索",
    web_search_begin: "网页搜索开始",
    web_search_end: "网页搜索结果",
    guardian_assessment: "安全审查",
    error: "错误",
    stream_error: "流错误",
    thread_rolled_back: "线程回滚",
    turn_diff: "回合变更",
    plan_update: "计划更新",
    thread_goal_updated: "目标更新",
    context_compacted: "上下文压缩",
  };
  return labels[eventType] ?? eventType;
}

function eventContent(row: JSONDict, eventType: string): string | null {
  if (eventType === "exec_command_end" || eventType === "exec_command_begin") {
    const lines = [
      stringOrNull(row.command_text) ? `$ ${stringOrNull(row.command_text)}` : null,
      typeof row.exit_code === "number" ? `exit_code: ${row.exit_code}` : null,
      stringOrNull(row.status) ? `status: ${stringOrNull(row.status)}` : null,
      stringOrNull(row.aggregated_output) ?? stringOrNull(row.formatted_output)
        ?? stringOrNull(row.stdout) ?? stringOrNull(row.stderr),
    ].filter((line): line is string => Boolean(line));
    return lines.length > 0 ? lines.join("\n") : jsonishText(row.payload);
  }
  if (eventType === "patch_apply_end") {
    const changes = row.changes;
    const diff = firstUnifiedDiff(changes);
    return diff ?? stringOrNull(row.stdout) ?? jsonishText(changes);
  }
  if (eventType === "web_search_call" || eventType === "web_search_begin" || eventType === "web_search_end") {
    return stringOrNull(row.query) ?? jsonishText(row.results) ?? jsonishText(row.sources) ?? jsonishText(row.action);
  }
  if (eventType === "guardian_assessment") {
    return stringOrNull(row.rationale) ?? jsonishText(row.action);
  }
  if (eventType === "error" || eventType === "stream_error") {
    return stringOrNull(row.message) ?? jsonishText(row.additional_details);
  }
  if (eventType === "turn_diff") {
    return stringOrNull(row.unified_diff) ?? jsonishText(row.changes);
  }
  if (eventType === "plan_update") {
    return jsonishText(row.plan) ?? stringOrNull(row.explanation);
  }
  return stringOrNull(row.message) ?? stringOrNull(row.summary) ?? jsonishText(row.payload);
}

function eventSummary(row: JSONDict, eventType: string, content: string | null): string {
  if (eventType === "exec_command_end" || eventType === "exec_command_begin") {
    const cmd = stringOrNull(row.command_text);
    const exit = typeof row.exit_code === "number" ? ` exit ${row.exit_code}` : "";
    return cmd ? `${cmd}${exit}` : content ?? eventType;
  }
  if (eventType === "patch_apply_end") {
    const changes = objectKeyCount(row.changes);
    return changes > 0 ? `${changes} file change${changes === 1 ? "" : "s"}` : content ?? eventType;
  }
  if (eventType === "thread_rolled_back" && typeof row.num_turns === "number") {
    return `${row.num_turns} turn(s) rolled back`;
  }
  return content ?? stringOrNull(row.status) ?? eventType;
}

function firstUnifiedDiff(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  for (const item of Object.values(value as JSONDict)) {
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      const diff = stringOrNull((item as JSONDict).unified_diff);
      if (diff) return diff;
    }
  }
  return null;
}

function objectKeyCount(value: unknown): number {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.keys(value as JSONDict).length
    : 0;
}

function buildDebugBasket(buffers: ExtractionBuffers): JSONDict {
  const extracted = new Map<string, { table_name: string; count: number; keys: Set<string> }>();
  const residual = new Map<string, { table_name: string; count: number; keys: Set<string> }>();
  const tables = [
    "conversation_meta_raw", "turn_manifest", "message_items_raw",
    "reasoning_items_raw", "tool_calls_raw", "tool_call_outputs_raw",
    "telemetry_events", "lifecycle_events", "structured_tool_end_events",
    "collaboration_events", "search_events", "system_events", "compaction_events",
  ] as const;

  for (const table of tables) {
    for (const row of buffers[table]) {
      const route = stringOrNull(row.route_key) ?? table;
      const extractedFields = Array.isArray(row.extracted_fields) ? row.extracted_fields : [];
      const extra = typeof row.extra_fields === "object" && row.extra_fields !== null && !Array.isArray(row.extra_fields)
        ? row.extra_fields as JSONDict
        : {};
      if (extractedFields.length > 0) {
        const entry = extracted.get(route) ?? { table_name: table, count: 0, keys: new Set<string>() };
        entry.count += 1;
        for (const key of extractedFields) {
          if (typeof key === "string") entry.keys.add(key);
        }
        extracted.set(route, entry);
      }
      const extraKeys = Object.keys(extra);
      if (extraKeys.length > 0) {
        const entry = residual.get(route) ?? { table_name: table, count: 0, keys: new Set<string>() };
        entry.count += 1;
        for (const key of extraKeys) entry.keys.add(key);
        residual.set(route, entry);
      }
    }
  }

  const unknown_routes = Object.entries(buffers.unknown_route_counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([route_key, count]) => ({
      route_key,
      count,
      sources: buffers.raw_records
        .filter((row) => row.route_key === route_key && row.route_table === null)
        .slice(0, 8)
        .map((row) => `${String(row.source_path ?? "")}:${String(row.source_line_no ?? "")}`),
    }));

  const residualGroups = mapDebugGroups(residual);
  return {
    extracted_fields: mapDebugGroups(extracted),
    residual_fields: residualGroups,
    unknown_routes,
    residual_field_count: residualGroups.reduce((acc, item) => acc + (item.keys as string[]).length, 0),
    unknown_record_count: unknown_routes.reduce((acc, item) => acc + Number(item.count ?? 0), 0),
  };
}

function mapDebugGroups(
  map: Map<string, { table_name: string; count: number; keys: Set<string> }>,
): JSONDict[] {
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([route_key, entry]) => ({
      route_key,
      table_name: entry.table_name,
      count: entry.count,
      keys: [...entry.keys].sort(),
    }));
}

// ── Public API ──────────────────────────────────────────

export function buildSummary(buffers: ExtractionBuffers): JSONDict {
  const sessions = new Map<string, SessionBuild>();
  seedSessions(buffers, sessions);
  collectEvents(buffers, sessions);
  ensureSyntheticRoots(sessions);

  const flatSessions = sortedImportedSessionIds(sessions)
    .map((id) => serializeImportedSession(sessions.get(id)!));
  const rootSessions = sortedRootSessionIds(sessions)
    .map((id) => serializeTree(id, sessions));

  const tableCounts: Record<string, number> = {};
  for (const key of [
    "parse_errors", "raw_records", "conversation_meta_raw", "turn_manifest",
    "message_items_raw", "reasoning_items_raw", "tool_calls_raw",
    "tool_call_outputs_raw", "tool_call_pairs", "telemetry_events", "lifecycle_events",
    "structured_tool_end_events", "collaboration_events", "search_events",
    "system_events", "compaction_events",
  ] as const) {
    const arr = buffers[key];
    tableCounts[key] = Array.isArray(arr) ? arr.length : 0;
  }
  const debugBasket = buildDebugBasket(buffers);
  attachDebugBasket(flatSessions, debugBasket);
  attachDebugBasket(rootSessions, debugBasket);

  return {
    total_files: buffers.file_manifest.length,
    parsed_records: buffers.raw_records.length,
    parse_errors: buffers.parse_errors.length,
    unknown_record_count: debugBasket.unknown_record_count,
    unknown_route_keys: Object.keys(buffers.unknown_route_counts).sort(),
    imported_session_count: flatSessions.length,
    root_session_count: rootSessions.length,
    sessions: flatSessions,
    root_sessions: rootSessions,
    table_counts: tableCounts,
    record_type_counts: buffers.record_type_counts,
    payload_type_counts: buffers.payload_type_counts,
    reserved_route_counts: buffers.reserved_route_counts,
    unknown_route_counts: buffers.unknown_route_counts,
    debug_basket: debugBasket,
  };
}

function attachDebugBasket(sessions: JSONDict[], debugBasket: JSONDict): void {
  for (const session of sessions) {
    session.debug_basket = debugBasket;
    const childSessions = Array.isArray(session.child_sessions)
      ? session.child_sessions as JSONDict[]
      : [];
    attachDebugBasket(childSessions, debugBasket);
  }
}
