import type { JSONDict } from "./models";
import { stringOrNull, truncate, eventSortKey, detailSortKey, pickPrimaryInputAnchor, classifyInputDetailKind, classifyInputPartKind, extractInputPartContent, describeInputDetail } from "./summary-helpers";
import { estimateTextTokens } from "./token-estimator";

const USER_SIDE_KINDS = new Set(["user_input", "agents_md", "instruction"]);

interface SessionBuildRef {
  session_id: string;
  events: JSONDict[];
  start_time: string | null;
  base_instructions_text: string | null;
  source_raw_record_id: string | null;
  source_path: string | null;
  source_line_no: number | null;
  source_record: JSONDict | null;
  source_raw_text: string | null;
}

export function buildSessionEvents(
  session: SessionBuildRef,
  _ownMetrics: JSONDict,
): JSONDict[] {
  const events = session.events.map((e: JSONDict) => ({ ...e }));
  events.sort((a: JSONDict, b: JSONDict) => {
    const ka = eventSortKey(a as unknown as Record<string, unknown>);
    const kb = eventSortKey(b as unknown as Record<string, unknown>);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || ka[3].localeCompare(kb[3]);
  });
  attachUsageBadge(events, _ownMetrics);
  return events;
}

export function buildTimeline(
  session: SessionBuildRef & { branch_meta: Record<string, JSONDict> },
  ownEvents: JSONDict[],
  childSessions: JSONDict[],
): JSONDict[] {
  const timeline = ownEvents.map((e) => ({ ...e }));
  for (const childSession of childSessions) {
    const branchMeta = session.branch_meta[childSession.session_id as string] ?? {};
    const displayName = childSession.display_name as string ?? "subagent";
    const promptPreview = stringOrNull(branchMeta.prompt_preview);
    timeline.push({
      event_id: `subagent:${childSession.session_id}`,
      kind: "subagent_session",
      session_id: session.session_id,
      timestamp: stringOrNull(branchMeta.timestamp)
        ?? stringOrNull(childSession.start_time)
        ?? stringOrNull((childSession.metrics as JSONDict)?.start_time),
      record_type: "event_msg",
      payload_type: stringOrNull(branchMeta.payload_type) ?? "collab_agent_spawn_end",
      title: `subagent branch · ${displayName}`,
      summary: subagentSummary(childSession, branchMeta),
      prompt_preview: promptPreview,
      child_session_id: childSession.session_id,
    });
  }
  timeline.sort((a, b) => {
    const ka = eventSortKey(a as unknown as Record<string, unknown>);
    const kb = eventSortKey(b as unknown as Record<string, unknown>);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || ka[3].localeCompare(kb[3]);
  });
  return timeline;
}

export function buildGraphTurns(timeline: JSONDict[]): JSONDict[] {
  const turns: JSONDict[] = [];
  let pendingUser: JSONDict[] = [];
  let pendingAssistant: JSONDict[] = [];

  function flushTurn(): void {
    if (pendingUser.length === 0 && pendingAssistant.length === 0) return;
    const { anchor: inputAnchor, details: inputDetails } = resolveInputTurn(pendingUser);
    const { anchor: outputAnchor, details: outputDetails } = resolveOutputTurn(pendingAssistant);
    const turnId = stringOrNull(inputAnchor?.event_id) ?? stringOrNull(outputAnchor?.event_id) ?? `turn:${turns.length + 1}`;
    turns.push({
      turn_id: `graph-turn:${turnId}`,
      input: inputAnchor,
      input_details: inputDetails,
      output: outputAnchor,
      output_details: outputDetails,
    });
    pendingUser = [];
    pendingAssistant = [];
  }

  for (const item of timeline) {
    const kind = stringOrNull(item.kind) ?? "";
    if (USER_SIDE_KINDS.has(kind)) {
      if (pendingAssistant.length > 0) flushTurn();
      pendingUser.push(item);
    } else {
      pendingAssistant.push(item);
    }
  }
  flushTurn();
  return turns;
}

export function buildSessionPreambleDetails(session: SessionBuildRef): JSONDict[] {
  const content = stringOrNull(session.base_instructions_text);
  if (!content) return [];
  return [{
    event_id: `session-input:${session.session_id}:base-instructions`,
    session_id: session.session_id,
    timestamp: session.start_time,
    kind: "system_prompt",
    record_type: "session_meta",
    payload_type: null,
    content,
    estimated_input_tokens: estimateTextTokens(content),
    detail_note: "base_instructions",
    raw_record_id: session.source_raw_record_id,
    source_path: session.source_path,
    source_line_no: session.source_line_no,
    source_record: session.source_record,
    raw_text: session.source_raw_text,
  }];
}

// ── Internal helpers ────────────────────────────────────

function resolveInputTurn(events: JSONDict[]): { anchor: JSONDict | null; details: JSONDict[] } {
  if (events.length === 0) return { anchor: null, details: [] };
  const userEvents = events.filter((e) => {
    const k = stringOrNull(e.kind);
    return k === "user_input" || k === "agents_md";
  });
  const anchor = pickPrimaryInputAnchor(userEvents as unknown as Record<string, unknown>[]) as JSONDict | null;
  const details: JSONDict[] = [];

  for (const event of events) {
    if (anchor && event.event_id === anchor.event_id) continue;
    details.push(buildInputDetailEvent(event));
  }
  if (anchor) {
    details.push(...buildInputPartDetails(anchor));
  }
  details.sort((a, b) => {
    const ka = detailSortKey(a as unknown as Record<string, unknown>);
    const kb = detailSortKey(b as unknown as Record<string, unknown>);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });
  return { anchor, details };
}

function resolveOutputTurn(events: JSONDict[]): { anchor: JSONDict | null; details: JSONDict[] } {
  if (events.length === 0) return { anchor: null, details: [] };
  const assistantOutputs = events.filter((e) => stringOrNull(e.kind) === "assistant_output");
  const anchor = assistantOutputs.length > 0 ? assistantOutputs[assistantOutputs.length - 1] : null;
  const details = events.filter((e) => !anchor || e.event_id !== anchor.event_id).map((e) => ({ ...e }));
  details.sort((a, b) => {
    const ka = detailSortKey(a as unknown as Record<string, unknown>);
    const kb = detailSortKey(b as unknown as Record<string, unknown>);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });
  return { anchor, details };
}

function buildInputDetailEvent(event: JSONDict): JSONDict {
  const detailKind = classifyInputDetailKind(event as unknown as Record<string, unknown>);
  const detailContent = stringOrNull(event.content) ?? jsonishTextParts(event.content_parts);
  const descriptor = describeInputDetail(detailKind, detailContent, stringOrNull(event.title));
  return {
    event_id: `input-detail:${event.event_id}`,
    session_id: event.session_id,
    timestamp: event.timestamp,
    kind: detailKind,
    summary: descriptor.summary || stringOrNull(event.summary) || truncate(detailContent ?? "", 120),
    content: detailContent,
    estimated_input_tokens: estimateTextTokens(detailContent),
    detail_note: event.title,
    raw_record_id: event.raw_record_id,
    source_path: event.source_path,
    source_line_no: event.source_line_no,
    source_record: event.source_record,
    source_raw_text: event.source_raw_text,
  };
}

function buildInputPartDetails(anchor: JSONDict): JSONDict[] {
  const parts = anchor.content_parts;
  if (!Array.isArray(parts) || parts.length === 0) return [];
  if (!shouldExpandInputParts(parts)) return [];
  if (isGuardianAssessmentMessage(anchor)) return [];

  const details: JSONDict[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (typeof part !== "object" || part === null) continue;
    const partDict = part as Record<string, unknown>;
    const detailKind = classifyInputPartKind(partDict);
    const content = extractInputPartContent(partDict);
    if (!content) continue;
    const descriptor = describeInputDetail(detailKind, content, null, stringOrNull(partDict.type));
    details.push({
      event_id: `${anchor.event_id}:part:${i}`,
      session_id: anchor.session_id,
      timestamp: anchor.timestamp,
      kind: detailKind,
      record_type: "response_item",
      payload_type: "message",
      summary: descriptor.summary || truncate(content, 120),
      content,
      estimated_input_tokens: estimateTextTokens(content),
      detail_note: stringOrNull(partDict.type),
      raw_record_id: anchor.raw_record_id,
      source_path: anchor.source_path,
      source_line_no: anchor.source_line_no,
      source_record: anchor.source_record,
      source_raw_text: anchor.source_raw_text,
    });
  }
  return details;
}

function shouldExpandInputParts(parts: unknown[]): boolean {
  if (parts.length > 1) return true;
  for (const part of parts) {
    if (typeof part === "object" && part !== null && partNeedsDetail(part as Record<string, unknown>)) return true;
  }
  return false;
}

function partNeedsDetail(part: Record<string, unknown>): boolean {
  const partType = (stringOrNull(part.type) ?? "").toLowerCase();
  if (partType && !["input_text", "text"].includes(partType)) return true;
  const content = extractInputPartContent(part);
  if (!content) return false;
  const lower = content.toLowerCase();
  return lower.includes("hook") || lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".gif") || lower.endsWith(".webp") || lower.endsWith(".bmp") || lower.endsWith(".svg");
}

function isGuardianAssessmentMessage(event: JSONDict): boolean {
  const text = (stringOrNull(event.content) ?? stringOrNull(event.summary) ?? "").trimStart();
  if (!text) return false;
  return text.includes("request action you are assessing") || text.startsWith("The following is the Codex agent history");
}

function subagentSummary(childSession: JSONDict, branchMeta: JSONDict): string {
  const metrics = (typeof childSession.metrics === "object" && childSession.metrics !== null) ? childSession.metrics as JSONDict : {};
  const bits = [
    stringOrNull(childSession.agent_role) ?? "subagent",
    `${asInt(metrics.display_node_count)} nodes`,
  ];
  if (asInt(metrics.total_tokens)) bits.push(`${asInt(metrics.total_tokens)} tokens`);
  const statusPreview = stringOrNull(branchMeta.status_preview);
  if (statusPreview) bits.push(statusPreview);
  return bits.filter(Boolean).join(" · ");
}

function attachUsageBadge(events: JSONDict[], ownMetrics: JSONDict): void {
  const totalUsage = {
    input_tokens: asInt(ownMetrics.total_input_tokens),
    output_tokens: asInt(ownMetrics.total_output_tokens),
    reasoning_output_tokens: asInt(ownMetrics.total_reasoning_output_tokens),
    cached_input_tokens: asInt(ownMetrics.total_cached_input_tokens),
    total_tokens: asInt(ownMetrics.total_tokens),
  };
  const lastUsage = {
    input_tokens: asInt(ownMetrics.last_input_tokens),
    output_tokens: asInt(ownMetrics.last_output_tokens),
    reasoning_output_tokens: asInt(ownMetrics.last_reasoning_output_tokens),
    cached_input_tokens: asInt(ownMetrics.last_cached_input_tokens),
    total_tokens: asInt(ownMetrics.last_total_tokens),
  };
  if (!totalUsage.input_tokens && !totalUsage.output_tokens) return;

  const assistantCandidates = events.filter((e) => {
    const k = stringOrNull(e.kind);
    return k === "assistant_output" || k === "assistant_update";
  });
  if (assistantCandidates.length === 0) return;

  let target = assistantCandidates[assistantCandidates.length - 1];
  for (let i = assistantCandidates.length - 1; i >= 0; i--) {
    if (stringOrNull(assistantCandidates[i].kind) === "assistant_output") {
      target = assistantCandidates[i];
      break;
    }
  }

  target.usage = {
    ...totalUsage,
    last_token_usage: lastUsage,
    total_token_usage: totalUsage,
  };
  const taskElapsed = ownMetrics.task_elapsed_sec;
  if (typeof taskElapsed === "number") {
    target.task_elapsed_sec = Math.round(taskElapsed * 1000) / 1000;
  }
}

function asInt(value: unknown): number {
  if (typeof value === "boolean") return 0;
  if (typeof value === "number") return value;
  return 0;
}

function jsonishTextParts(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}
