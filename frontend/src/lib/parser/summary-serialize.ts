import type { JSONDict } from "./models";
import { stringOrNull, asInt, shortId, parseTimestamp, sortKeyFromTimestamp, eventSortKey } from "./summary-helpers";
import { buildSessionEvents, buildGraphTurns, buildTimeline, buildSessionPreambleDetails } from "./summary-events";

/** Minimal session shape needed for serialization. */
export interface SessionBuild {
  session_id: string;
  source_path: string | null;
  file_name: string | null;
  source_raw_record_id: string | null;
  source_line_no: number | null;
  source_record: JSONDict | null;
  source_raw_text: string | null;
  base_instructions_text: string | null;
  parent_session_id: string | null;
  is_subagent: boolean;
  is_synthetic: boolean;
  agent_nickname: string | null;
  agent_role: string | null;
  cli_version: string | null;
  start_time: string | null;
  events: JSONDict[];
  telemetry: JSONDict[];
  lifecycle: JSONDict[];
  child_ids: Set<string>;
  branch_meta: Record<string, JSONDict>;
}

export function createSession(session_id: string): SessionBuild {
  return {
    session_id,
    source_path: null,
    file_name: null,
    source_raw_record_id: null,
    source_line_no: null,
    source_record: null,
    source_raw_text: null,
    base_instructions_text: null,
    parent_session_id: null,
    is_subagent: false,
    is_synthetic: false,
    agent_nickname: null,
    agent_role: null,
    cli_version: null,
    start_time: null,
    events: [],
    telemetry: [],
    lifecycle: [],
    child_ids: new Set(),
    branch_meta: {},
  };
}

export function calculateOwnMetrics(session: SessionBuild): JSONDict {
  let latestTelemetry: JSONDict | null = null;
  if (session.telemetry.length > 0) {
    const sorted = [...session.telemetry].sort(
      (a, b) => sortKeyFromTimestamp(stringOrNull(a.timestamp)) - sortKeyFromTimestamp(stringOrNull(b.timestamp)),
    );
    latestTelemetry = sorted[sorted.length - 1];
  }

  const latestTaskComplete = findLatestTaskComplete(session.lifecycle);

  const allTimestamps = [
    session.start_time,
    ...session.events.map((e) => stringOrNull(e.timestamp)),
    ...session.telemetry.map((t) => stringOrNull(t.timestamp)),
  ];
  const startTime = firstTimestamp(allTimestamps);
  const endTime = lastTimestamp(allTimestamps);

  const metrics: JSONDict = {
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_reasoning_output_tokens: 0,
    total_cached_input_tokens: 0,
    total_tokens: 0,
    last_input_tokens: 0,
    last_output_tokens: 0,
    last_reasoning_output_tokens: 0,
    last_cached_input_tokens: 0,
    last_total_tokens: 0,
    node_count: session.events.length,
    display_node_count: session.events.length,
    session_count: session.is_synthetic ? 0 : 1,
    imported_file_count: session.source_path ? 1 : 0,
    elapsed_sec: elapsedSeconds(startTime, endTime),
    task_elapsed_sec: taskElapsedSeconds(latestTaskComplete),
    start_time: startTime,
    end_time: endTime,
  };

  if (latestTelemetry) {
    const inputTokens = asInt(latestTelemetry.total_input_tokens);
    const outputTokens = asInt(latestTelemetry.total_output_tokens);
    metrics.total_input_tokens = inputTokens;
    metrics.total_output_tokens = outputTokens;
    metrics.total_reasoning_output_tokens = asInt(
      latestTelemetry.total_reasoning_output_tokens ?? latestTelemetry.total_reasoning_tokens,
    );
    metrics.total_cached_input_tokens = asInt(latestTelemetry.total_cached_input_tokens);
    const totalTokens = asInt(latestTelemetry.total_tokens);
    metrics.total_tokens = totalTokens || (inputTokens + outputTokens);
    metrics.last_input_tokens = asInt(latestTelemetry.last_input_tokens);
    metrics.last_output_tokens = asInt(latestTelemetry.last_output_tokens);
    metrics.last_reasoning_output_tokens = asInt(
      latestTelemetry.last_reasoning_output_tokens ?? latestTelemetry.last_reasoning_tokens,
    );
    metrics.last_cached_input_tokens = asInt(latestTelemetry.last_cached_input_tokens);
    const lastTotalTokens = asInt(latestTelemetry.last_total_tokens);
    metrics.last_total_tokens = lastTotalTokens
      || (asInt(latestTelemetry.last_input_tokens) + asInt(latestTelemetry.last_output_tokens));
  }
  return metrics;
}

export function combineMetrics(own: JSONDict, children: JSONDict[]): JSONDict {
  const m = { ...own };
  let start = stringOrNull(m.start_time);
  let end = stringOrNull(m.end_time);

  for (const c of children) {
    m.total_input_tokens = asInt(m.total_input_tokens) + asInt(c.total_input_tokens);
    m.total_output_tokens = asInt(m.total_output_tokens) + asInt(c.total_output_tokens);
    m.total_reasoning_output_tokens = asInt(m.total_reasoning_output_tokens) + asInt(c.total_reasoning_output_tokens);
    m.total_cached_input_tokens = asInt(m.total_cached_input_tokens) + asInt(c.total_cached_input_tokens);
    m.total_tokens = asInt(m.total_tokens) + asInt(c.total_tokens);
    m.node_count = asInt(m.node_count) + asInt(c.node_count);
    m.display_node_count = asInt(m.display_node_count) + asInt(c.display_node_count) + 1;
    m.session_count = asInt(m.session_count) + asInt(c.session_count);
    m.imported_file_count = asInt(m.imported_file_count) + asInt(c.imported_file_count);
    start = minTimestamp(start, stringOrNull(c.start_time));
    end = maxTimestamp(end, stringOrNull(c.end_time));
  }

  m.start_time = start;
  m.end_time = end;
  m.elapsed_sec = elapsedSeconds(start, end);
  return m;
}

export function sessionPayload(
  session: SessionBuild,
  ownEvents: JSONDict[],
  timeline: JSONDict[],
  graphTurns: JSONDict[],
  ownMetrics: JSONDict,
  aggregateMetrics: JSONDict,
  childSessions: JSONDict[],
): JSONDict {
  const startTime = stringOrNull(aggregateMetrics.start_time) ?? stringOrNull(ownMetrics.start_time);
  const endTime = stringOrNull(aggregateMetrics.end_time) ?? stringOrNull(ownMetrics.end_time);
  return {
    session_id: session.session_id,
    short_id: shortId(session.session_id),
    display_name: displayName(session),
    source_path: session.source_path,
    file_name: session.file_name,
    source_record: session.source_record,
    source_raw_text: session.source_raw_text,
    source_label: session.file_name ?? "主线程占位视图",
    parent_session_id: session.parent_session_id,
    is_subagent: session.is_subagent,
    is_synthetic: session.is_synthetic,
    agent_nickname: session.agent_nickname,
    agent_role: session.agent_role,
    cli_version: session.cli_version,
    start_time: startTime,
    end_time: endTime,
    own_metrics: ownMetrics,
    metrics: aggregateMetrics,
    events: ownEvents,
    timeline,
    graph_turns: graphTurns,
    child_sessions: childSessions,
  };
}

export function serializeImportedSession(
  session: SessionBuild,
  sessions?: Map<string, SessionBuild>,
): JSONDict {
  const ownMetrics = calculateOwnMetrics(session);
  const ownEvents = buildSessionEvents(session, ownMetrics);
  // R1.3: Expand input_image content_parts from user_input into independent events
  expandInputImageEvents(session.session_id, ownEvents);
  if (sessions && session.child_ids.size > 0) {
    injectSubagentEventsFlat(session, ownEvents, sessions);
  }
  const gTurns = buildGraphTurns(ownEvents);
  attachSessionInputPreamble(session, gTurns);
  return sessionPayload(session, ownEvents, ownEvents, gTurns, ownMetrics, ownMetrics, []);
}

export function serializeTree(
  session_id: string,
  sessions: Map<string, SessionBuild>,
): JSONDict {
  const session = sessions.get(session_id)!;
  const childSessions = sortedChildIds(session).map((cid) => serializeTree(cid, sessions));
  const ownMetrics = calculateOwnMetrics(session);
  const ownEvents = buildSessionEvents(session, ownMetrics);
  const childMetricsList = childSessions.map((cs) => cs.metrics as JSONDict);
  const aggregateMetrics = combineMetrics(ownMetrics, childMetricsList);
  const timeline = buildTimeline(session, ownEvents, childSessions);
  // R1.2: Persist subagent_session entries from timeline into events
  injectSubagentSessionsIntoEvents(ownEvents, timeline);
  // R1.3: Expand input_image content_parts from user_input into independent events
  expandInputImageEvents(session.session_id, ownEvents);
  const gTurns = buildGraphTurns(timeline);
  attachSessionInputPreamble(session, gTurns);
  return sessionPayload(session, ownEvents, timeline, gTurns, ownMetrics, aggregateMetrics, childSessions);
}

// ── Helpers ─────────────────────────────────────────────

function displayName(session: SessionBuild): string {
  if (session.is_synthetic) return `主代理 ${shortId(session.session_id)}`;
  if (session.agent_role === "guardian") return "Guardian";
  if (session.agent_nickname && session.agent_role) return `${session.agent_nickname} · ${session.agent_role}`;
  if (session.agent_nickname) return session.agent_nickname;
  if (session.is_subagent) return `子代理 ${shortId(session.session_id)}`;
  return `会话 ${shortId(session.session_id)}`;
}

function sortedChildIds(session: SessionBuild): string[] {
  return [...session.child_ids].sort((a, b) => a.localeCompare(b));
}

function attachSessionInputPreamble(session: SessionBuild, graphTurns: JSONDict[]): void {
  if (graphTurns.length === 0) return;
  const firstTurn = graphTurns.find((t) => t.input);
  if (!firstTurn) return;
  const details = buildSessionPreambleDetails(session);
  if (details.length === 0) return;
  const existingIds = new Set(
    (firstTurn.input_details as JSONDict[] | undefined)?.map((d) => stringOrNull(d.event_id) ?? "") ?? [],
  );
  const inputDetails = [...(firstTurn.input_details as JSONDict[] ?? [])];
  for (const d of details) {
    const eid = stringOrNull(d.event_id) ?? "";
    if (eid && !existingIds.has(eid)) {
      inputDetails.push(d);
      existingIds.add(eid);
    }
  }
  inputDetails.sort((a, b) => {
    const aLine = typeof a.source_line_no === "number" ? a.source_line_no : 1e9;
    const bLine = typeof b.source_line_no === "number" ? b.source_line_no : 1e9;
    return aLine - bLine || sortKeyFromTimestamp(stringOrNull(a.timestamp)) - sortKeyFromTimestamp(stringOrNull(b.timestamp));
  });
  firstTurn.input_details = inputDetails;
}

function findLatestTaskComplete(lifecycle: JSONDict[]): JSONDict | null {
  const taskCompletes = lifecycle.filter((r) => stringOrNull(r.event_type) === "task_complete");
  if (taskCompletes.length === 0) return null;
  taskCompletes.sort((a, b) => {
    const ta = sortKeyFromTimestamp(stringOrNull(a.timestamp));
    const tb = sortKeyFromTimestamp(stringOrNull(b.timestamp));
    return ta - tb || ((typeof a.source_line_no === "number" ? a.source_line_no : 1e9) - (typeof b.source_line_no === "number" ? b.source_line_no : 1e9));
  });
  return taskCompletes[taskCompletes.length - 1];
}

function taskElapsedSeconds(row: JSONDict | null): number | null {
  if (!row) return null;
  const ms = row.duration_ms;
  if (typeof ms === "number") return Math.round(ms / 1000 * 1000) / 1000;
  return null;
}

function firstTimestamp(values: (string | null | undefined)[]): string | null {
  const valid = values.filter((v): v is string => typeof v === "string" && parseTimestamp(v) > 0);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => parseTimestamp(a) <= parseTimestamp(b) ? a : b);
}

function lastTimestamp(values: (string | null | undefined)[]): string | null {
  const valid = values.filter((v): v is string => typeof v === "string" && parseTimestamp(v) > 0);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => parseTimestamp(a) >= parseTimestamp(b) ? a : b);
}

function minTimestamp(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return parseTimestamp(a) <= parseTimestamp(b) ? a : b;
}

function maxTimestamp(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return parseTimestamp(a) >= parseTimestamp(b) ? a : b;
}

function elapsedSeconds(start: string | null, end: string | null): number {
  const s = parseTimestamp(start);
  const e = parseTimestamp(end);
  if (s === 0 || e === 0) return 0;
  return Math.round(Math.max((e - s) / 1000, 0) * 10) / 10;
}

// ── R1.2: Inject subagent_session entries from timeline into events ──

const IMAGE_PATH_SUFFIXES = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];

function injectSubagentSessionsIntoEvents(
  ownEvents: JSONDict[],
  timeline: JSONDict[],
): void {
  const existingIds = new Set(ownEvents.map((e) => stringOrNull(e.event_id)));
  for (const item of timeline) {
    if (item.kind === "subagent_session") {
      const eid = stringOrNull(item.event_id);
      if (eid && !existingIds.has(eid)) {
        ownEvents.push({ ...item });
      }
    }
  }
  ownEvents.sort((a, b) => {
    const ka = eventSortKey(a as unknown as Record<string, unknown>);
    const kb = eventSortKey(b as unknown as Record<string, unknown>);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || ka[3].localeCompare(kb[3]);
  });
}

function injectSubagentEventsFlat(
  parentSession: SessionBuild,
  ownEvents: JSONDict[],
  sessions: Map<string, SessionBuild>,
): void {
  for (const childId of parentSession.child_ids) {
    const child = sessions.get(childId);
    if (!child) continue;
    const branchMeta = parentSession.branch_meta[childId] ?? {};
    const childMetrics = calculateOwnMetrics(child);
    const summaryBits = [
      child.agent_role ?? "子代理",
      childMetrics.display_node_count ? `${childMetrics.display_node_count} 个节点` : null,
      childMetrics.total_tokens ? `${childMetrics.total_tokens} tokens` : null,
      stringOrNull(branchMeta.status_preview),
    ].filter((value): value is string => Boolean(value));
    ownEvents.push({
      event_id: `subagent:${childId}`,
      session_id: parentSession.session_id,
      timestamp: stringOrNull(branchMeta.timestamp) ?? stringOrNull(childMetrics.start_time),
      kind: "subagent_session",
      record_type: "event_msg",
      payload_type: stringOrNull(branchMeta.payload_type) ?? "collab_agent_spawn_end",
      role: null,
      phase: null,
      title: `子代理分支 · ${child.agent_nickname ?? childId.slice(0, 8)}`,
      summary: summaryBits.join(" · "),
      detail_note: "从左侧栏聚焦这个子会话时，会突出当前子链，其余分支会被弱化显示。",
      prompt_preview: stringOrNull(branchMeta.prompt_preview),
      child_session_id: childId,
      status: stringOrNull(branchMeta.status_preview),
      raw_record_id: null,
      source_path: child.source_path,
      source_line_no: null,
      raw_text: child.source_raw_text,
    });
  }
  ownEvents.sort((a, b) => {
    const ka = eventSortKey(a as unknown as Record<string, unknown>);
    const kb = eventSortKey(b as unknown as Record<string, unknown>);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || ka[3].localeCompare(kb[3]);
  });
}

// ── R1.3: Expand input_image content_parts from user_input into events ──

function expandInputImageEvents(
  sessionId: string,
  ownEvents: JSONDict[],
): void {
  const newEvents: JSONDict[] = [];
  for (const event of ownEvents) {
    if (event.kind !== "user_input") continue;
    const parts = event.content_parts;
    if (!Array.isArray(parts) || parts.length === 0) continue;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (typeof part !== "object" || part === null) continue;
      const partType = (stringOrNull(part.type) ?? "").toLowerCase();
      // Use same content extraction as Python's _extract_input_part_content
      const content =
        typeof part.text === "string" ? part.text
        : typeof part.content === "string" ? part.content
        : typeof part.image_url === "string" ? part.image_url
        : typeof part.path === "string" ? part.path
        : typeof part.file_path === "string" ? part.file_path
        : typeof part.local_path === "string" ? part.local_path
        : typeof part.url === "string" ? part.url
        : typeof part.uri === "string" ? part.uri
        : typeof part.value === "string" ? part.value
        : null;
      if (!content) continue;
      const isImage = partType.includes("image")
        || IMAGE_PATH_SUFFIXES.some((s) => content.toLowerCase().endsWith(s));
      if (!isImage) continue;
      newEvents.push({
        event_id: `${stringOrNull(event.event_id) ?? "unknown"}:input_image:${index}`,
        session_id: sessionId,
        timestamp: event.timestamp,
        kind: "input_image",
        record_type: "response_item",
        payload_type: "message",
        role: null,
        phase: null,
        title: "附加输入 · 图片",
        summary: truncate(content, 120),
        content,
        content_label: "图片路径",
        detail_note: partType || "image",
        raw_record_id: event.raw_record_id,
        source_path: event.source_path,
        source_line_no: event.source_line_no,
        raw_text: event.raw_text,
        event_type: "input_image",
      });
    }
  }
  ownEvents.push(...newEvents);
  ownEvents.sort((a, b) => {
    const ka = eventSortKey(a as unknown as Record<string, unknown>);
    const kb = eventSortKey(b as unknown as Record<string, unknown>);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || ka[3].localeCompare(kb[3]);
  });
}

function truncate(text: string, limit: number): string {
  const normalized = text.split(/\s+/).join(" ");
  if (normalized.length <= limit) return normalized;
  return normalized.slice(0, limit - 1) + "…";
}
