import { kindColor } from "../../lib/color";
import { detailLabel, kindLabel, extractToolName } from "./graph-labels";

// ── Interfaces ──────────────────────────────────────────

export interface GraphNode {
  id: string;
  eventId: string;
  label: string;
  kind: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  filled: boolean;
  strokeWidth: number;
  isAnchor: boolean;
  isInput: boolean;
  sessionId?: string;
  spindleRole?: "anchor" | "intermediate" | "subagent";
  subagentTint?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphLink {
  source: string;
  target: string;
  type: "primary" | "branch" | "spawn";
  tint?: string;
  isThin?: boolean;
  /** Spawn link start offset from source node x (e.g. +8 past marker outer ring) */
  spawnFromDx?: number;
  /** Spawn link end offset from target node x (e.g. -(Rpeak_sub+4) left of child spindle) */
  spawnToDx?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  nodeMap: Map<string, GraphNode>;
  adjacencyMap: Map<string, Set<string>>;
  spindles?: TurnSpindle[];
}

export interface GraphTurn {
  turn_id: string;
  input: TurnEvent | null;
  input_details: TurnEvent[];
  output: TurnEvent | null;
  output_details: TurnEvent[];
}

export interface TurnEvent {
  event_id: string;
  kind: string;
  title?: string;
  summary?: string;
  child_session_id?: string;
  output_event_id?: string;
  metadata?: RawEvent;
  [key: string]: unknown;
}

export interface ChildSession {
  session_id: string;
  graph_turns?: GraphTurn[];
  child_sessions?: ChildSession[];
}

/** Position of one event along a spindle curve */
export interface TurnEventPosition {
  x: number;
  y: number;
  event: TurnEvent;
  index: number;
}

/** Pre-computed geometry for rendering one turn's spindle ribbon */
export interface TurnSpindle {
  turnId: string;
  cx: number;
  top: number;
  bottom: number;
  pitch: number;
  tMax: number;
  omega: number;
  RPeak: number;
  RFn: (u: number) => number;
  events: TurnEventPosition[];
  isThin: boolean;
}

// ── Constants ───────────────────────────────────────────

const SPINDLE_PITCH = 50;
const SPINDLE_PITCH_DEGENERATE = 130;
const SPINDLE_R_PEAK = 58;
const SPINDLE_R_PEAK_DEGENERATE = 14;
const ANCHOR_RADIUS = 11;
const ANCHOR_RADIUS_DEGENERATE = 9;
const INTERMEDIATE_RADIUS = 5;
const SUBAGENT_MARKER_RADIUS = 8;

const SUBAGENT_PALETTE = [
  "#dc2626", "#0891b2", "#16a34a",
  "#b91c1c", "#0e7490", "#15803d",
  "#7f1d1d", "#164e63", "#14532d",
];

const SUBAGENT_LANE_BASE = 230;

function subagentTintAt(indexInTurn: number): string {
  return SUBAGENT_PALETTE[indexInTurn % SUBAGENT_PALETTE.length];
}

function subagentLaneStep(subagentCount: number): number {
  if (subagentCount <= 1) return 0;
  if (subagentCount <= 3) return 180;
  if (subagentCount <= 6) return 120;
  if (subagentCount <= 9) return 100;
  return 80;
}

/** R7.1: Adaptive RPeak for child spindles based on sibling subagent count */
function childRPeak(subagentCount: number): number {
  if (subagentCount <= 1) return 50;
  if (subagentCount <= 3) return 36;
  if (subagentCount <= 6) return 30;
  if (subagentCount <= 9) return 26;
  return 24;
}

/** R7.1: Adaptive pitch for child spindles based on sibling subagent count */
function childPitch(subagentCount: number): number {
  if (subagentCount <= 1) return 42;
  if (subagentCount <= 3) return 32;
  if (subagentCount <= 6) return 28;
  if (subagentCount <= 9) return 26;
  return 24;
}

const PADDING = 60;

// ── Layout Builder ──────────────────────────────────────

export function buildGraphFromTurns(
  turns: GraphTurn[],
  childSessions?: ChildSession[],
  startX = PADDING,
  startY = PADDING,
  overrides?: { RPeak?: number; pitch?: number },
): GraphData & { totalWidth: number; totalHeight: number } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const spindles: TurnSpindle[] = [];
  const sessionMap = new Map<string, ChildSession>();

  function indexSessions(sessions: ChildSession[]) {
    for (const s of sessions) {
      sessionMap.set(s.session_id, s);
      if (s.child_sessions) indexSessions(s.child_sessions);
    }
  }
  if (childSessions) indexSessions(childSessions);

  let currentY = startY;
  let lastAnchorId: string | null = null;

  for (const turn of turns) {
    const result = layoutTurn(turn, startX, currentY, sessionMap, overrides);
    // Link from previous turn's anchor to this turn's input anchor
    if (lastAnchorId && result.nodes.length > 0) {
      const target = result.nodes.find(n => n.isInput) ?? result.nodes[0];
      if (target) {
        links.push({ source: lastAnchorId, target: target.id, type: "primary" });
      }
    }
    // Update lastAnchorId to this turn's last anchor (output preferred, else input)
    const lastPos = lastOutputAnchor(result.spindles);
    if (lastPos) {
      lastAnchorId = lastPos.event.event_id;
    }
    // If no output anchor, keep lastAnchorId from previous turn (don't reset to null)
    nodes.push(...result.nodes);
    links.push(...result.links);
    spindles.push(...result.spindles);
    currentY = result.nextY;
  }

  let maxNodeX = startX;
  for (const n of nodes) {
    if (n.x + n.radius + 80 > maxNodeX) maxNodeX = n.x + n.radius + 80;
  }
  const totalWidth = maxNodeX + PADDING;
  const totalHeight = currentY + PADDING;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const adjacencyMap = new Map<string, Set<string>>();
  for (const link of links) {
    let s = adjacencyMap.get(link.source);
    if (!s) { s = new Set(); adjacencyMap.set(link.source, s); }
    s.add(link.target);
    let t = adjacencyMap.get(link.target);
    if (!t) { t = new Set(); adjacencyMap.set(link.target, t); }
    t.add(link.source);
  }

  return { nodes, links, nodeMap, adjacencyMap, spindles, totalWidth, totalHeight };
}

// ── Event Collection ────────────────────────────────────

/**
 * Merge input / input_details / output / output_details into a single
 * time-sorted TurnEvent[] per R0.
 *
 * - input is always events[0] (if present)
 * - output is always events[N-1] (if present)
 * - middle events sorted by source_line_no then timestamp
 */
function collectTurnEvents(turn: GraphTurn): TurnEvent[] {
  const middle = [
    ...(turn.input_details ?? []),
    ...(turn.output_details ?? []),
  ].sort(detailSort);

  const events: TurnEvent[] = [];
  if (turn.input) events.push(turn.input);
  events.push(...middle);
  if (turn.output) events.push(turn.output);
  return mergeToolCallPairs(events);
}

/**
 * Merge tool_call + tool_output pairs into single events.
 * Uses name-based matching: indexes tool_call events by tool name,
 * then finds the matching tool_call for each tool_output.
 * Falls back to matching the last unmatched tool_call if name lookup fails.
 */
function mergeToolCallPairs(events: TurnEvent[]): TurnEvent[] {
  const callMap = new Map<string, number>(); // tool_name → index in result
  const result: TurnEvent[] = [];

  for (const ev of events) {
    if (ev.kind === "tool_call") {
      const meta = ev.metadata as string | Record<string, unknown> | null | undefined;
      const toolName = extractToolName(meta);
      const key = toolName || `__idx_${result.length}`;
      result.push(ev);
      callMap.set(key, result.length - 1);
    } else if (ev.kind === "tool_output") {
      // Try to find matching tool_call by tool name
      let matched = false;
      const meta = ev.metadata as string | Record<string, unknown> | null | undefined;
      if (meta) {
        const outputToolName = extractToolName(meta);
        if (outputToolName && callMap.has(outputToolName)) {
          const idx = callMap.get(outputToolName)!;
          result[idx] = { ...result[idx], output_event_id: ev.event_id };
          matched = true;
        }
      }
      // Fallback: match with last unmatched tool_call
      if (!matched) {
        for (const [, idx] of callMap) {
          if (!result[idx].output_event_id) {
            result[idx] = { ...result[idx], output_event_id: ev.event_id };
            matched = true;
            break;
          }
        }
      }
      // If still unmatched, keep as separate node
      if (!matched) {
        result.push(ev);
      }
    } else {
      result.push(ev);
    }
  }
  return result;
}

// ── Spindle Layout ──────────────────────────────────────

/**
 * Layout one turn as a DNA-spindle shape.
 * Returns nodes, links, spindles, and the Y offset for the next turn.
 */
function layoutTurn(
  turn: GraphTurn,
  originX: number,
  originY: number,
  sessionMap: Map<string, ChildSession>,
  overrides?: { RPeak?: number; pitch?: number },
): { nodes: GraphNode[]; links: GraphLink[]; spindles: TurnSpindle[]; nextY: number } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const turnSpindles: TurnSpindle[] = [];

  const events = collectTurnEvents(turn);
  if (events.length === 0) {
    return { nodes, links, spindles: turnSpindles, nextY: originY + SPINDLE_PITCH };
  }

  // Degenerate: single event, just a dot
  if (events.length === 1) {
    const ev = events[0];
    const node: GraphNode = {
      id: ev.event_id,
      eventId: ev.event_id,
      label: kindLabel(ev.kind),
      kind: ev.kind,
      x: originX,
      y: originY,
      radius: ANCHOR_RADIUS,
      color: kindColor(ev.kind),
      filled: true,
      strokeWidth: 2,
      isAnchor: true,
      isInput: true,
      spindleRole: "anchor",
      metadata: ev as Record<string, unknown>,
    };
    nodes.push(node);
    const bottom = originY;
    turnSpindles.push({
      turnId: turn.turn_id,
      cx: originX,
      top: originY,
      bottom,
      pitch: SPINDLE_PITCH_DEGENERATE,
      tMax: 0,
      omega: Math.PI * 0.8,
      RPeak: SPINDLE_R_PEAK_DEGENERATE,
      RFn: () => 0,
      events: [{ x: originX, y: originY, event: ev, index: 0 }],
      isThin: true,
    });
    return { nodes, links, spindles: turnSpindles, nextY: originY + SPINDLE_PITCH };
  }

  // ── Normal / Degenerate spindle geometry (R1) ────────────
  const tMax = events.length - 1;
  const intermediates = events.length - 2;
  const isThin = intermediates <= 0;
  const pitch = isThin ? SPINDLE_PITCH_DEGENERATE : (overrides?.pitch ?? SPINDLE_PITCH);
  const RPeak = isThin ? SPINDLE_R_PEAK_DEGENERATE : (overrides?.RPeak ?? SPINDLE_R_PEAK);
  const anchorR = isThin ? ANCHOR_RADIUS_DEGENERATE : ANCHOR_RADIUS;

  let omega: number;
  if (isThin) {
    omega = Math.PI * 0.8;
  } else {
    const targetTwists = Math.max(0.7, tMax / 3);
    omega = (targetTwists * 2 * Math.PI) / tMax;
  }

  const RFn = (u: number) => RPeak * Math.sin(Math.PI * u);

  const cx = originX;
  const top = originY;
  const bottom = top + tMax * pitch;

  // Compute event positions
  const eventPositions: TurnEventPosition[] = [];
  for (let i = 0; i < events.length; i++) {
    const t = i;
    const u = t / tMax;
    const R = RFn(u);
    const y = top + t * pitch;
    const phase = i % 2 === 0 ? 0 : Math.PI;
    const x = cx + R * Math.cos(t * omega + phase);
    eventPositions.push({ x, y, event: events[i], index: i });
  }

  // Create nodes for each event
  const totalSubagentsForNodes = countSubagentSessions(events);
  let subagentIdx = 0;
  for (let i = 0; i < eventPositions.length; i++) {
    const pos = eventPositions[i];
    const ev = pos.event;
    const isAnchor = i === 0 || i === tMax;

    if (ev.kind === "subagent_session") {
      // Subagent marker node
      const multiSub = totalSubagentsForNodes >= 2;
      const tint = multiSub ? subagentTintAt(subagentIdx) : "#475569";
      const markerNode: GraphNode = {
        id: ev.event_id,
        eventId: ev.event_id,
        label: detailLabel(ev.kind, ev.summary, ev.title),
        kind: ev.kind,
        x: pos.x,
        y: pos.y,
        radius: SUBAGENT_MARKER_RADIUS,
        color: tint,
        filled: false,
        strokeWidth: 1.5,
        isAnchor: false,
        isInput: false,
        sessionId: ev.child_session_id,
        spindleRole: "subagent",
        metadata: ev as Record<string, unknown>,
        // Only set subagentTint for multi-agent (PRD R6: single agent has no tint circle)
        ...(multiSub ? { subagentTint: tint } : {}),
      };
      nodes.push(markerNode);
      subagentIdx++;
    } else if (isAnchor) {
      // Anchor node (user_input or assistant_output)
      const node: GraphNode = {
        id: ev.event_id,
        eventId: ev.event_id,
        label: kindLabel(ev.kind),
        kind: ev.kind,
        x: pos.x,
        y: pos.y,
        radius: anchorR,
        color: kindColor(ev.kind),
        filled: true,
        strokeWidth: 2,
        isAnchor: true,
        isInput: i === 0,
        spindleRole: "anchor",
        metadata: ev as Record<string, unknown>,
      };
      nodes.push(node);
    } else {
      // Intermediate node (tool_call, tool_output, reasoning, etc.)
      const node: GraphNode = {
        id: ev.event_id,
        eventId: ev.event_id,
        label: detailLabel(ev.kind, ev.summary, ev.title),
        kind: ev.kind,
        x: pos.x,
        y: pos.y,
        radius: INTERMEDIATE_RADIUS,
        color: kindColor(ev.kind),
        filled: false,
        strokeWidth: 1.8,
        isAnchor: false,
        isInput: false,
        spindleRole: "intermediate",
        metadata: ev as Record<string, unknown>,
      };
      nodes.push(node);
    }
  }

  // Create spindle record for ribbon rendering
  turnSpindles.push({
    turnId: turn.turn_id,
    cx,
    top,
    bottom,
    pitch,
    tMax,
    omega,
    RPeak,
    RFn,
    events: eventPositions,
    isThin,
  });

  // ── Handle subagent sessions (recursive) ──────────────
  let subagentLaneIdx = 0;
  const totalSubagents = countSubagentSessions(events);
  const laneStep = subagentLaneStep(totalSubagents);

  for (let i = 0; i < eventPositions.length; i++) {
    const pos = eventPositions[i];
    const ev = pos.event;
    if (ev.kind !== "subagent_session" || !ev.child_session_id) continue;

    const child = sessionMap.get(ev.child_session_id);
    if (!child?.graph_turns) {
      subagentLaneIdx++;
      continue;
    }

    const multiSub = totalSubagents >= 2;
    const tint = multiSub ? subagentTintAt(subagentLaneIdx) : "#475569";
    const subCX = cx + SUBAGENT_LANE_BASE + subagentLaneIdx * laneStep;
    const subTop = pos.y;

    // R7.1: Adaptive child spindle sizing based on sibling subagent count
    const cRPeak = childRPeak(totalSubagents);
    const cPitch = childPitch(totalSubagents);

    const childData = buildGraphFromTurns(
      child.graph_turns,
      child.child_sessions,
      subCX,
      subTop,
      { RPeak: cRPeak, pitch: cPitch },
    );

    nodes.push(...childData.nodes);
    links.push(...childData.links);
    if (childData.spindles) turnSpindles.push(...childData.spindles);

    // Spawn link from parent marker to child's first input anchor (R6)
    if (childData.nodes.length > 0) {
      const childTarget = childData.nodes.find(n => n.isInput) ?? childData.nodes[0];
      links.push({
        source: ev.event_id,
        target: childTarget.id,
        type: "spawn",
        tint: multiSub ? tint : undefined,
        spawnFromDx: 8,
        spawnToDx: -(cRPeak + 4),
      });
    }

    subagentLaneIdx++;
  }

  return { nodes, links, spindles: turnSpindles, nextY: bottom + SPINDLE_PITCH };
}

// ── Helpers ─────────────────────────────────────────────

function detailSort(a: TurnEvent, b: TurnEvent): number {
  const lineA = (a.source_line_no as number) ?? Number.MAX_SAFE_INTEGER;
  const lineB = (b.source_line_no as number) ?? Number.MAX_SAFE_INTEGER;
  if (lineA !== lineB) return lineA - lineB;
  const timeA = a.timestamp ? Date.parse(a.timestamp as string) : Number.MAX_SAFE_INTEGER;
  const timeB = b.timestamp ? Date.parse(b.timestamp as string) : Number.MAX_SAFE_INTEGER;
  return timeA - timeB;
}

function countSubagentSessions(events: TurnEvent[]): number {
  let count = 0;
  for (const ev of events) {
    if (ev.kind === "subagent_session") count++;
  }
  return count;
}

/** Get the last output anchor node from a list of spindles (for linking turns) */
export function lastOutputAnchor(spindles: TurnSpindle[]): TurnEventPosition | null {
  for (let i = spindles.length - 1; i >= 0; i--) {
    const s = spindles[i];
    for (let j = s.events.length - 1; j >= 0; j--) {
      if (s.events[j].event.kind === "assistant_output") return s.events[j];
    }
  }
  return null;
}

// ── Client-side turn building from EventRow[] ───────────

export interface RawEvent {
  id: string;
  kind: string;
  role?: string | null;
  timestamp?: string | null;
  content?: string | null;
  source_line_no?: number | null;
  metadata?: string | Record<string, unknown> | null;
}

const USER_SIDE_KINDS = new Set(["user_input", "agents_md", "instruction", "system_prompt"]);
const AUX_INPUT_PREFIXES = [
  "# AGENTS.md instructions",
  "<environment_context>",
  "<session-context>",
  "<current-state>",
  "<workflow>",
  "<guidelines>",
  "<instructions>",
  "<skill>",
  "<turn_aborted>",
];

export function buildTurnsFromEvents(events: RawEvent[]): GraphTurn[] {
  const turns: GraphTurn[] = [];
  let pendingUser: RawEvent[] = [];
  let pendingAssistant: RawEvent[] = [];

  function flush() {
    if (pendingUser.length === 0 && pendingAssistant.length === 0) return;

    const [inputAnchor, inputDetails] = resolveInput(pendingUser);
    const [outputAnchor, outputDetails] = resolveOutput(pendingAssistant);
    const turnId = inputAnchor?.event_id || outputAnchor?.event_id || `turn:${turns.length + 1}`;

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

  // Sort by timestamp first
  const sorted = [...events].sort((a, b) => {
    if (!a.timestamp && !b.timestamp) return (a.source_line_no ?? 0) - (b.source_line_no ?? 0);
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    const cmp = a.timestamp.localeCompare(b.timestamp);
    if (cmp !== 0) return cmp;
    return (a.source_line_no ?? 0) - (b.source_line_no ?? 0);
  });

  for (const ev of sorted) {
    if (USER_SIDE_KINDS.has(ev.kind)) {
      if (pendingAssistant.length > 0) flush();
      pendingUser.push(ev);
    } else {
      pendingAssistant.push(ev);
    }
  }
  flush();
  return turns;
}

function resolveInput(events: RawEvent[]): [TurnEvent | null, TurnEvent[]] {
  if (events.length === 0) return [null, []];

  const userEvents = events.filter((e) => e.kind === "user_input" || e.kind === "agents_md");
  const anchor = pickPrimaryInput(userEvents);
  const details: TurnEvent[] = [];

  for (const ev of events) {
    if (anchor && ev.id === anchor.event_id) continue;
    details.push(toTurnEvent(ev));
  }

  return [anchor, details];
}

function resolveOutput(events: RawEvent[]): [TurnEvent | null, TurnEvent[]] {
  if (events.length === 0) return [null, []];

  const assistantOutputs = events.filter((e) => e.kind === "assistant_output");
  const anchor = assistantOutputs.length > 0 ? toTurnEvent(assistantOutputs[assistantOutputs.length - 1]) : null;
  const details = events
    .filter((e) => !anchor || e.id !== anchor.event_id)
    .map(toTurnEvent);

  return [anchor, details];
}

function pickPrimaryInput(events: RawEvent[]): TurnEvent | null {
  if (events.length === 0) return null;
  const nonAux = events.filter((e) => !looksLikeAux(e));
  const picked = nonAux.length > 0 ? nonAux[nonAux.length - 1] : events[events.length - 1];
  return toTurnEvent(picked);
}

function looksLikeAux(ev: RawEvent): boolean {
  const text = (ev.content ?? "").trimStart();
  if (!text) return false;
  return AUX_INPUT_PREFIXES.some((p) => text.startsWith(p));
}

function toTurnEvent(ev: RawEvent): TurnEvent {
  let title = kindLabel(ev.kind);
  let summary = ev.content?.slice(0, 80) ?? ev.kind;

  // For tool_call, use function_call:{tool_name} as the label
  if (ev.kind === "tool_call") {
    const toolName = extractToolName(ev.metadata);
    if (toolName) {
      const label = `function_call:${toolName}`;
      title = label;
      summary = label;
    }
  }

  return {
    event_id: ev.id,
    kind: ev.kind,
    title,
    summary,
    timestamp: ev.timestamp ?? undefined,
    source_line_no: ev.source_line_no ?? undefined,
    metadata: ev,
  };
}
