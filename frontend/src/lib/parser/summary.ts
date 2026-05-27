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
  ] as const) {
    const arr = buffers[key];
    tableCounts[key] = Array.isArray(arr) ? arr.length : 0;
  }

  return {
    total_files: buffers.file_manifest.length,
    parsed_records: buffers.raw_records.length,
    parse_errors: buffers.parse_errors.length,
    imported_session_count: flatSessions.length,
    root_session_count: rootSessions.length,
    sessions: flatSessions,
    root_sessions: rootSessions,
    table_counts: tableCounts,
  };
}
