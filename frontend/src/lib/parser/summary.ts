import type { JSONDict, ExtractionBuffers } from "./models";
import { stringOrNull, sortKeyFromTimestamp, looksLikeAuxInput, eventSortKey } from "./summary-helpers";
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
    session.cwd = stringOrNull(row.cwd);
  }
}

function collectCollaborationMetadata(
  buffers: ExtractionBuffers,
  sessions: Map<string, SessionBuild>,
): void {
  for (const row of buffers.collaboration_events) {
    const senderSessionId = stringOrNull(row.sender_thread_id);
    if (!senderSessionId) continue;

    const childSessionId = stringOrNull(row.new_thread_id)
      ?? stringOrNull(row.receiver_thread_id);
    if (childSessionId) {
      registerChildLink(sessions, senderSessionId, childSessionId, row);
    }

    const agentStatuses = Array.isArray(row.agent_statuses) ? row.agent_statuses : [];
    for (const statusRow of agentStatuses) {
      if (typeof statusRow !== "object" || statusRow === null) continue;
      const threadId = stringOrNull((statusRow as JSONDict).thread_id);
      if (!threadId) continue;
      registerChildLink(sessions, senderSessionId, threadId, {
        timestamp: row.timestamp,
        status: (statusRow as JSONDict).status,
        receiver_agent_nickname: (statusRow as JSONDict).agent_nickname,
        receiver_agent_role: (statusRow as JSONDict).agent_role,
        event_type: row.event_type,
      });
    }

    const statuses = row.statuses;
    if (typeof statuses === "object" && statuses !== null && !Array.isArray(statuses)) {
      for (const [threadId, status] of Object.entries(statuses as JSONDict)) {
        if (!threadId) continue;
        registerChildLink(sessions, senderSessionId, threadId, {
          timestamp: row.timestamp,
          status,
          event_type: row.event_type,
        });
      }
    }
  }
}

function registerChildLink(
  sessions: Map<string, SessionBuild>,
  parentSessionId: string,
  childSessionId: string,
  row: JSONDict,
): void {
  const parent = ensureSession(sessions, parentSessionId);
  const child = ensureSession(sessions, childSessionId);
  parent.child_ids.add(childSessionId);
  if (!child.parent_session_id) child.parent_session_id = parentSessionId;
  child.is_subagent = true;
  child.agent_nickname = child.agent_nickname
    ?? stringOrNull(row.new_agent_nickname)
    ?? stringOrNull(row.receiver_agent_nickname);
  child.agent_role = child.agent_role
    ?? stringOrNull(row.new_agent_role)
    ?? stringOrNull(row.receiver_agent_role);

  const branchMeta = parent.branch_meta[childSessionId] ?? {};
  const timestamp = stringOrNull(row.timestamp);
  if (
    timestamp
    && (
      !stringOrNull(branchMeta.timestamp)
      || sortKeyFromTimestamp(timestamp) < sortKeyFromTimestamp(stringOrNull(branchMeta.timestamp))
    )
  ) {
    branchMeta.timestamp = timestamp;
  }

  const prompt = stringOrNull(row.prompt);
  if (prompt) branchMeta.prompt_preview = truncate(prompt, 180);

  const statusPreview = flattenStatus(row.status);
  if (statusPreview) branchMeta.status_preview = statusPreview;

  const payloadType = stringOrNull(row.event_type) ?? stringOrNull(row.payload_type);
  if (payloadType && !stringOrNull(branchMeta.payload_type)) {
    branchMeta.payload_type = payloadType;
  }

  parent.branch_meta[childSessionId] = branchMeta;
}

function flattenStatus(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
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
    const eventType = stringOrNull(row.event_type);
    if (eventType === "turn_aborted") {
      session.events.push(buildTurnAbortedEvent(row, session.session_id));
    }
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

function messageKind(role: string | null, phase: string | null): string {
  if (role === "user") return "user_input";
  if (role === "assistant" && phase === "final_answer") return "assistant_output";
  if (role === "assistant") return "assistant_update";
  if (role === "developer") return "instruction";
  return "instruction";
}

function truncate(text: string, limit: number): string {
  const normalized = text.trim().split(/\s+/).join(" ");
  if (normalized.length <= limit) return normalized;
  return normalized.slice(0, limit - 1) + "…";
}

const TITLE_LIMIT = 60;

function deriveSessionTitles(sessions: Map<string, SessionBuild>): void {
  for (const session of sessions.values()) {
    if (session.is_synthetic) continue;
    if (session.agent_nickname) continue; // subagents keep nickname display
    if (session.title) continue;
    session.title = firstUserInputTitle(session);
  }
}

function firstUserInputTitle(session: SessionBuild): string | null {
  const candidates = session.events
    .filter((e) => stringOrNull(e.kind) === "user_input" && !looksLikeAuxInput(e))
    .sort((a, b) => {
      const ak = eventSortKey(a as Record<string, unknown>);
      const bk = eventSortKey(b as Record<string, unknown>);
      // Mirror Python _event_sort_key: 4-tuple (timestamp, line_no, order, id).
      for (let i = 0; i < ak.length; i++) {
        const cmp = ak[i] < bk[i] ? -1 : ak[i] > bk[i] ? 1 : 0;
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  if (candidates.length === 0) return null;
  const content = stringOrNull(candidates[0].content);
  if (!content) return null;
  const title = truncate(content, TITLE_LIMIT);
  return title || null;
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
  const isUserSide = kind === "user_input" || kind === "agents_md" || kind === "instruction";
  return {
    event_id: row.message_id ?? row.raw_record_id,
    session_id,
    timestamp: row.timestamp,
    kind,
    record_type: stringOrNull(row.record_type) ?? "response_item",
    payload_type: stringOrNull(row.payload_type) ?? "message",
    role,
    phase,
    content,
    content_parts: contentParts,
    estimated_input_tokens: isUserSide ? 0 : null,
    raw_record_id: row.raw_record_id,
    source_path: row.source_path,
    source_line_no: row.source_line_no,
    raw_text: row.raw_text,
  };
}

function buildToolCallEvent(row: JSONDict, session_id: string): JSONDict {
  const args = stringOrNull(row.arguments_raw) ?? stringOrNull(row.input_raw);
  return {
    event_id: row.tool_call_id ?? row.raw_record_id,
    session_id,
    timestamp: row.timestamp,
    kind: "tool_call",
    record_type: stringOrNull(row.record_type) ?? "response_item",
    payload_type: stringOrNull(row.payload_type),
    name: stringOrNull(row.tool_name),
    call_id: stringOrNull(row.call_id),
    args,
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
    record_type: stringOrNull(row.record_type) ?? "response_item",
    payload_type: stringOrNull(row.payload_type),
    call_id: stringOrNull(row.call_id),
    content: output,
    detail_note: status,
    raw_record_id: row.raw_record_id,
    source_path: row.source_path,
    source_line_no: row.source_line_no,
    raw_text: row.raw_text,
  };
}

function buildTurnAbortedEvent(row: JSONDict, session_id: string): JSONDict {
  const reason = stringOrNull(row.reason) ?? "Unknown";
  const turnId = stringOrNull(row.turn_id);
  const contentText = turnId
    ? `Turn ${turnId} aborted: ${reason}`
    : `Turn aborted: ${reason}`;
  return {
    event_id: row.event_id ?? row.raw_record_id,
    session_id,
    timestamp: row.timestamp,
    kind: "turn_aborted",
    record_type: stringOrNull(row.record_type) ?? "event_msg",
    payload_type: stringOrNull(row.payload_type) ?? "turn_aborted",
    role: null,
    phase: null,
    content: contentText,
    detail_note: reason,
    raw_record_id: row.raw_record_id,
    source_path: row.source_path,
    source_line_no: row.source_line_no,
    raw_text: row.raw_text,
    event_type: "turn_aborted",
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
    last_input_tokens: asInt(row.last_input_tokens),
    last_output_tokens: asInt(row.last_output_tokens),
    last_reasoning_output_tokens: asInt(row.last_reasoning_output_tokens ?? row.last_reasoning_tokens),
    last_cached_input_tokens: asInt(row.last_cached_input_tokens),
    last_total_tokens: asInt(row.last_total_tokens),
  };
}

function buildParserEvent(row: JSONDict, session_id: string, kind: string): JSONDict {
  const eventType = stringOrNull(row.event_type) ?? stringOrNull(row.payload_type) ?? "event";
  const content = eventContent(row, eventType);
  return {
    event_id: row.event_id ?? row.raw_record_id,
    session_id,
    timestamp: row.timestamp,
    kind,
    record_type: stringOrNull(row.record_type) ?? "event_msg",
    payload_type: stringOrNull(row.payload_type),
    role: null,
    phase: null,
    content,
    detail_note: stringOrNull(row.status) ?? stringOrNull(row.error_type),
    name: stringOrNull(row.name) ?? stringOrNull(row.tool_name),
    call_id: stringOrNull(row.call_id),
    command: typeof row.command === "string"
      ? row.command
      : Array.isArray(row.command)
        ? row.command.map(String).join(" ")
        : stringOrNull(row.command_text),
    status: stringOrNull(row.status),
    invocation: typeof row.invocation === "object" && row.invocation !== null ? row.invocation : null,
    server: stringOrNull(row.server),
    tool_name: stringOrNull(row.tool_name),
    path: stringOrNull(row.path),
    risk_level: stringOrNull(row.risk_level),
    error_type: stringOrNull(row.error_type),
    duration_ms: typeof row.duration_ms === "number" ? row.duration_ms : null,
    collaboration_mode_kind: stringOrNull(row.collaboration_mode_kind),
    reason: stringOrNull(row.reason),
    receiver_agent_nickname: stringOrNull(row.receiver_agent_nickname),
    query: stringOrNull(row.query),
    raw_record_id: row.raw_record_id,
    source_path: row.source_path,
    source_line_no: row.source_line_no,
    raw_text: row.raw_text,
    event_type: eventType,
  };
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

// ── Public API ──────────────────────────────────────────

export function buildSummary(buffers: ExtractionBuffers): JSONDict {
  const sessions = new Map<string, SessionBuild>();
  seedSessions(buffers, sessions);
  collectCollaborationMetadata(buffers, sessions);
  collectEvents(buffers, sessions);
  ensureSyntheticRoots(sessions);
  deriveSessionTitles(sessions);

  const flatSessions = sortedImportedSessionIds(sessions)
    .map((id) => serializeImportedSession(sessions.get(id)!, sessions));
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

  // Compute unknown_record_count directly from buffers
  let unknownRecordCount = 0;
  for (const count of Object.values(buffers.unknown_route_counts)) {
    unknownRecordCount += Number(count ?? 0);
  }

  return {
    total_files: buffers.file_manifest.length,
    parsed_records: buffers.raw_records.length,
    parse_errors: buffers.parse_errors.length,
    unknown_record_count: unknownRecordCount,
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
  };
}
