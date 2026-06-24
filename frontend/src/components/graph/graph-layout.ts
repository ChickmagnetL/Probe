import { kindColor } from "../../lib/color";
import { eventTypeLabel } from "./graph-labels";

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
  parentSessionId?: string;
  spindleRole?: "anchor" | "intermediate" | "subagent";
  subagentTint?: string;
  metadata?: Record<string, unknown>;
  labelAlign?: "left" | "right";
}

export interface GraphLink {
  source: string;
  target: string;
  type: "primary" | "branch" | "spawn";
  tint?: string;
  isThin?: boolean;
  /** Spawn link start offset from source node x (e.g. past marker outer ring) */
  spawnFromDx?: number;
  /** Spawn link end offset from target node x. */
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
  first_event_timestamp?: string | null;
}

/** Position of one event in the folder tree */
export interface TurnEventPosition {
  x: number;
  y: number;
  event: TurnEvent;
  index: number;
  isAnchor: boolean;
  isInput: boolean;
}

/** Pre-computed geometry for rendering one turn's folder guide */
export interface TurnSpindle {
  turnId: string;
  cx: number;
  top: number;
  bottom: number;
  events: TurnEventPosition[];
  tint?: string;
}

// ── Constants ───────────────────────────────────────────

const TURN_STEP_GAP = 28;
const TURN_GAP = 35;
const FOLDER_INDENT_STEP = 20;
const ANCHOR_RADIUS = 7.5;
const INTERMEDIATE_RADIUS = 4.5;
const SUBAGENT_MARKER_RADIUS = 6;
const SUBAGENT_LABEL_RADIUS = 8;
const ANCHOR_LABEL_BOUNDS_PAD = 80;
const SIDE_LABEL_BOUNDS_GAP = 8;
const SIDE_LABEL_BOUNDS_LEFT_PAD = 16;
const SIDE_LABEL_MIN_WIDTH = 80;
const SIDE_LABEL_MAX_WIDTH = 280;
const LABEL_CHAR_WIDTH = 7;
const TOOLTIP_DISPLAY_FIELDS = [
  "title",
  "summary",
  "detail_note",
  "content",
  "content_label",
  "intro",
];

const SUBAGENT_PALETTE = [
  "#dc2626", "#0891b2", "#16a34a",
  "#b91c1c", "#0e7490", "#15803d",
  "#7f1d1d", "#164e63", "#14532d",
];

function subagentTintAt(indexInTurn: number): string {
  return SUBAGENT_PALETTE[indexInTurn % SUBAGENT_PALETTE.length];
}

const PADDING = 60;

export function graphNodeLabelRadius(
  node: Pick<GraphNode, "radius" | "spindleRole">,
): number {
  return node.spindleRole === "subagent" ? SUBAGENT_LABEL_RADIUS : node.radius;
}

export function graphNodeLabelPadding(
  node: Pick<GraphNode, "isAnchor" | "label" | "radius" | "spindleRole" | "labelAlign">,
): { left: number; right: number; y: number } {
  const r = graphNodeLabelRadius(node);
  if (node.isAnchor) {
    const padX = r + ANCHOR_LABEL_BOUNDS_PAD;
    return { left: padX, right: padX, y: r + 24 };
  }

  const labelWidth = Math.min(
    SIDE_LABEL_MAX_WIDTH,
    Math.max(SIDE_LABEL_MIN_WIDTH, node.label.length * LABEL_CHAR_WIDTH),
  );

  // If label is on the left, swap left/right padding
  if (node.labelAlign === "left") {
    return {
      left: r + SIDE_LABEL_BOUNDS_GAP + labelWidth,
      right: r + SIDE_LABEL_BOUNDS_LEFT_PAD,
      y: Math.max(r + 10, 16),
    };
  }

  return {
    left: r + SIDE_LABEL_BOUNDS_LEFT_PAD,
    right: r + SIDE_LABEL_BOUNDS_GAP + labelWidth,
    y: Math.max(r + 10, 16),
  };
}

// ── Layout Builder ──────────────────────────────────────

export function buildGraphFromTurns(
  turns: GraphTurn[],
  childSessions?: ChildSession[],
  startX = PADDING,
  startY = PADDING,
  sessionId?: string,
  hiddenKinds?: Set<string>,
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
    const result = layoutTurn(turn, startX, currentY, sessionMap, sessionId, hiddenKinds);
    const mainSpindle = result.spindles[0];
    // Link previous turn's anchor to this turn's first main-spine anchor.
    if (lastAnchorId && mainSpindle) {
      const target = firstMainAnchor(mainSpindle);
      if (target) {
        links.push({ source: lastAnchorId, target: target.event.event_id, type: "primary" });
      }
    }
    // Update lastAnchorId to this turn's last anchor (output preferred, else input)
    const lastPos = mainSpindle ? lastMainAnchor(mainSpindle) : null;
    if (lastPos) {
      lastAnchorId = lastPos.event.event_id;
    }
    // If the turn has no main anchor, keep lastAnchorId from previous turn.
    nodes.push(...result.nodes);
    links.push(...result.links);
    spindles.push(...result.spindles);
    currentY = result.nextY;
  }

  // ── Synthesize markers for sub-agents without spawn events ──
  // Some children are linked via parent_session_id but have no
  // `subagent_session` spawn event in the parent's events table, so
  // layoutTurn never created a marker for them. Synthesize one per
  // unconsumed direct child, positioned by time relative to parent
  // input anchors. In focus mode the subtree is collapsed: only the
  // marker node is created, never its descendant nodes.
  if (childSessions && childSessions.length > 0) {
    // Collect child_session_ids already consumed by real spawn markers.
    const consumedChildIds = new Set<string>();
    for (const n of nodes) {
      if (n.kind === "subagent_session" && n.sessionId) {
        consumedChildIds.add(n.sessionId);
      }
    }

    // Parent input anchors (this graph's session), sorted by y, used to
    // place synthesized markers at the y of the latest parent input
    // whose timestamp is ≤ the child's first event timestamp.
    const parentInputAnchors = nodes
      .filter((n) => n.isInput && n.sessionId === sessionId)
      .sort((a, b) => a.y - b.y);
    // Build parallel timestamp array (ms since epoch or Infinity).
    const parentInputTimes = parentInputAnchors.map((n) => {
      const ts = nodeEventTimestamp(n);
      return ts !== null ? Date.parse(ts) : Infinity;
    });

    // Global multi-sub tint: count real spawn markers + synthesized ones.
    const realMarkerCount = consumedChildIds.size;
    const synthCandidates: ChildSession[] = [];
    for (const child of childSessions) {
      if (!consumedChildIds.has(child.session_id)) {
        synthCandidates.push(child);
      }
    }
    const totalSubagents = realMarkerCount + synthCandidates.length;
    const multiSub = totalSubagents >= 2;

    // Track lane occupancy per y so synthesized markers at the same y
    // don't overlap. Real spawn markers' lanes are per-turn local; we
    // only need to avoid collisions among synthesized markers here,
    // and we start each y's lane at 0 (real spawn markers at that y
    // already used their own per-turn lanes, but a synthesized marker
    // at the same y is visually acceptable in its own lane since
    // CHILD_SESSION_LANE_STEP is wide enough to read).
    const laneByY = new Map<number, number>();
    let synthIdx = 0;

    for (const child of synthCandidates) {
      if (!child.graph_turns) continue;

      // Determine marker y from child's first event timestamp.
      // Use pre-computed timestamp if available, otherwise fall back to computing it
      const childFirstTs = child.first_event_timestamp ?? childFirstEventTimestamp(child);
      let markerY: number;
      if (parentInputAnchors.length === 0) {
        markerY = startY;
      } else if (childFirstTs === null) {
        // No child timestamp; fall back to the last parent input anchor.
        markerY = parentInputAnchors[parentInputAnchors.length - 1].y;
      } else {
        const childMs = Date.parse(childFirstTs);
        // Find the largest parent input timestamp ≤ childMs.
        let picked = parentInputAnchors[0].y;
        for (let i = 0; i < parentInputAnchors.length; i++) {
          if (parentInputTimes[i] <= childMs) {
            picked = parentInputAnchors[i].y;
          } else {
            break;
          }
        }
        markerY = picked;
      }

      // Lane assignment: per-y incremental.
      const laneIdx = laneByY.get(markerY) ?? 0;
      laneByY.set(markerY, laneIdx + 1);

      const tint = multiSub ? subagentTintAt(synthIdx) : "#475569";
      const markerId = `synth:${child.session_id}`;

      const markerNode: GraphNode = {
        id: markerId,
        eventId: markerId,
        label: eventTypeLabel({ kind: "subagent_session", metadata: undefined }),
        kind: "subagent_session",
        x: startX + indentForKind("subagent_session"),
        y: markerY,
        radius: SUBAGENT_MARKER_RADIUS,
        color: tint,
        filled: false,
        strokeWidth: 1.5,
        isAnchor: false,
        isInput: false,
        sessionId: child.session_id,
        parentSessionId: sessionId,
        spindleRole: "subagent",
        metadata: { synthesized: true },
        labelAlign: "left",
        ...(multiSub ? { subagentTint: tint } : {}),
      };
      nodes.push(markerNode);

      // Create spawn link from the nearest parent input anchor to this marker
      let sourceAnchorId: string | null = null;
      for (let i = parentInputAnchors.length - 1; i >= 0; i--) {
        if (parentInputAnchors[i].y <= markerY) {
          sourceAnchorId = parentInputAnchors[i].id;
          break;
        }
      }
      // If no anchor found (marker before first input), use the first input
      if (!sourceAnchorId && parentInputAnchors.length > 0) {
        sourceAnchorId = parentInputAnchors[0].id;
      }

      if (sourceAnchorId) {
        links.push({
          source: sourceAnchorId,
          target: markerId,
          type: "spawn",
          tint: multiSub ? tint : undefined,
        });
      }

      synthIdx++;
    }
  }

  let maxNodeX = startX;
  for (const n of nodes) {
    const { right } = graphNodeLabelPadding(n);
    if (n.x + right > maxNodeX) maxNodeX = n.x + right;
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
  const middle = mergeToolPairs([
    ...(turn.input_details ?? []),
    ...(turn.output_details ?? []),
  ].sort(detailSort));

  const events: TurnEvent[] = [];
  if (turn.input) events.push(turn.input);
  events.push(...middle);
  if (turn.output) events.push(turn.output);
  return events;
}

// ── Folder Tree Layout ──────────────────────────────────

/**
 * Find the latest input anchor at or before the given Y position.
 * Used for creating spawn links from parent input anchors to subagent markers.
 */
function findLatestInputAnchor(
  positions: TurnEventPosition[],
  beforeY: number,
): TurnEventPosition | null {
  for (let i = positions.length - 1; i >= 0; i--) {
    const pos = positions[i];
    if (pos.isAnchor && pos.isInput && pos.y <= beforeY) {
      return pos;
    }
  }
  return null;
}

/**
 * Layout one turn as a compact folder-indented tree.
 * Returns nodes, links, folder guides, and the Y offset for the next turn.
 */
function layoutTurn(
  turn: GraphTurn,
  originX: number,
  originY: number,
  _sessionMap: Map<string, ChildSession>,
  sessionId?: string,
  hiddenKinds?: Set<string>,
): { nodes: GraphNode[]; links: GraphLink[]; spindles: TurnSpindle[]; nextY: number } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const turnSpindles: TurnSpindle[] = [];
  const hidden = hiddenKinds ?? new Set();

  const events = collectTurnEvents(turn);
  if (events.length === 0) {
    return { nodes, links, spindles: turnSpindles, nextY: originY + TURN_GAP };
  }

  // Filter out hidden events (except anchors - user_input and assistant_output should never be hidden)
  const visibleEvents = events.filter(ev => {
    // Always show anchor nodes
    if (ev.kind === "user_input" || ev.kind === "assistant_output") return true;
    // Hide if kind is in hidden set
    return !hidden.has(ev.kind);
  });

  if (visibleEvents.length === 0) {
    return { nodes, links, spindles: turnSpindles, nextY: originY + TURN_GAP };
  }

  const cx = originX;
  const eventTop = originY;

  // Identify paired outputs — they share a row with their call, not their own
  const pairedOutputIds = new Set<string>();
  for (const ev of visibleEvents) {
    if (ev.kind === "tool_call" && ev.output_event_id) {
      // Only pair if the output is also visible
      const outputEvent = events.find(e => e.event_id === ev.output_event_id);
      if (outputEvent && !hidden.has(outputEvent.kind)) {
        pairedOutputIds.add(ev.output_event_id);
      }
    }
  }

  // Compute event positions, skipping paired outputs (placed alongside their call)
  const eventPositions: TurnEventPosition[] = [];
  let rowIdx = 0;
  for (let i = 0; i < visibleEvents.length; i++) {
    const event = visibleEvents[i];
    if (pairedOutputIds.has(event.event_id)) continue;
    const role = mainSpineAnchorRole(turn, event);
    const y = eventTop + rowIdx * TURN_STEP_GAP;
    rowIdx++;
    const x = role ? cx : cx + indentForKind(event.kind);
    eventPositions.push({
      x,
      y,
      event: visibleEvents[i],
      index: i,
      isAnchor: role !== null,
      isInput: role === "input",
    });
  }

  // Add paired outputs at same y as their call, offset past the call's label
  for (const pos of [...eventPositions]) {
    const ev = pos.event;
    if (ev.kind !== "tool_call" || !ev.output_event_id) continue;
    const outputEvent = visibleEvents.find((e) => e.event_id === ev.output_event_id);
    if (!outputEvent) continue;
    const label = eventTypeLabel(ev);
    const labelW = Math.min(SIDE_LABEL_MAX_WIDTH, Math.max(SIDE_LABEL_MIN_WIDTH, label.length * LABEL_CHAR_WIDTH));
    const offsetX = INTERMEDIATE_RADIUS + SIDE_LABEL_BOUNDS_GAP + labelW;
    eventPositions.push({
      x: pos.x + offsetX,
      y: pos.y,
      event: outputEvent,
      index: eventPositions.length,
      isAnchor: false,
      isInput: false,
    });
  }

  // Sort by y then x so paired outputs follow their call
  eventPositions.sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);

  const eventBottom = eventPositions.length > 0
    ? Math.max(...eventPositions.map((p) => p.y))
    : eventTop;
  const anchorPositions = eventPositions.filter((pos) => pos.isAnchor);
  const spineTop = anchorPositions[0]?.y ?? eventTop;
  const spineBottom = anchorPositions[anchorPositions.length - 1]?.y ?? spineTop;

  // Create nodes for each event
  const totalSubagentsForNodes = countSubagentSessions(visibleEvents);
  let subagentIdx = 0;
  for (let i = 0; i < eventPositions.length; i++) {
    const pos = eventPositions[i];
    const ev = pos.event;

    if (ev.kind === "subagent_session") {
      // Subagent marker node
      const multiSub = totalSubagentsForNodes >= 2;
      const tint = multiSub ? subagentTintAt(subagentIdx) : "#475569";
      const metadata = tooltipMetadataForEvent(ev);
      const markerNode: GraphNode = {
        id: ev.event_id,
        eventId: ev.event_id,
        label: eventTypeLabel(ev),
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
        parentSessionId: sessionId,
        spindleRole: "subagent",
        metadata,
        labelAlign: "left",
        // Only set subagentTint for multi-agent (PRD R6: single agent has no tint circle)
        ...(multiSub ? { subagentTint: tint } : {}),
      };
      nodes.push(markerNode);

      // Create spawn link from the latest input anchor to this marker
      const sourceAnchor = findLatestInputAnchor(eventPositions, pos.y);
      if (sourceAnchor) {
        links.push({
          source: sourceAnchor.event.event_id,
          target: ev.event_id,
          type: "spawn",
          tint: multiSub ? tint : undefined,
        });
      }

      subagentIdx++;
    } else if (pos.isAnchor) {
      // Anchor node (user_input or assistant_output)
      const metadata = tooltipMetadataForEvent(ev);
      const node: GraphNode = {
        id: ev.event_id,
        eventId: ev.event_id,
        label: eventTypeLabel(ev),
        kind: ev.kind,
        x: pos.x,
        y: pos.y,
        radius: ANCHOR_RADIUS,
        color: kindColor(ev.kind),
        filled: true,
        strokeWidth: 2,
        isAnchor: true,
        isInput: pos.isInput,
        spindleRole: "anchor",
        sessionId,
        metadata,
      };
      nodes.push(node);
    } else {
      // Intermediate node (tool_call, tool_output, reasoning, etc.)
      const metadata = tooltipMetadataForEvent(ev);
      const node: GraphNode = {
        id: ev.event_id,
        eventId: ev.event_id,
        label: eventTypeLabel(ev),
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
        sessionId,
        metadata,
      };
      nodes.push(node);
    }
  }

  // Create folder-guide record for spine rendering.
  turnSpindles.push({
    turnId: turn.turn_id,
    cx,
    top: spineTop,
    bottom: spineBottom,
    events: eventPositions,
  });

  // Branch links from tool_call to its paired tool_output (split nodes)
  for (const pos of eventPositions) {
    const ev = pos.event;
    if (ev.kind !== "tool_call" || !ev.output_event_id) continue;
    const outputPos = eventPositions.find((p) => p.event.event_id === ev.output_event_id);
    if (outputPos) {
      links.push({
        source: ev.event_id,
        target: ev.output_event_id,
        type: "branch",
      });
    }
  }

  // ── Subagent markers are already created above; no recursion in focus mode ──
  return { nodes, links, spindles: turnSpindles, nextY: eventBottom + TURN_GAP };
}

// ── Helpers ─────────────────────────────────────────────

function indentForKind(kind: string): number {
  if (kind === "reasoning") return FOLDER_INDENT_STEP;
  if (kind === "tool_call" || kind === "tool_output") return FOLDER_INDENT_STEP * 2;
  if (kind === "subagent_session") return -FOLDER_INDENT_STEP * 3; // Place markers on the left of center line
  return FOLDER_INDENT_STEP;
}

function mainSpineAnchorRole(turn: GraphTurn, event: TurnEvent): "input" | "output" | null {
  if (turn.input?.event_id === event.event_id && event.kind === "user_input") {
    return "input";
  }
  if (turn.output?.event_id === event.event_id && event.kind === "assistant_output") {
    return "output";
  }
  return null;
}

function mergeToolPairs(events: TurnEvent[]): TurnEvent[] {
  const outputByCallId = new Map<string, TurnEvent>();
  for (const event of events) {
    if (event.kind !== "tool_output") continue;
    const callId = extractCallId(event);
    if (callId && !outputByCallId.has(callId)) {
      outputByCallId.set(callId, event);
    }
  }

  const callOutputIds = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== "tool_call") continue;
    const callId = extractCallId(event);
    const output = callId ? outputByCallId.get(callId) : undefined;
    if (!output) continue;
    callOutputIds.set(event.event_id, output.event_id);
  }

  return events.map((event) => {
    const outputEventId = callOutputIds.get(event.event_id);
    return outputEventId ? { ...event, output_event_id: outputEventId } : event;
  });
}

function extractCallId(event: TurnEvent): string | null {
  const direct = stringField(event.call_id);
  if (direct) return direct;

  const rawText = stringField(event.raw_text);
  if (rawText) {
    const fromRaw = extractCallIdFromRawText(rawText);
    if (fromRaw) return fromRaw;
  }

  return extractCallIdFromMetadata(event.metadata);
}

function extractCallIdFromMetadata(metadata: unknown): string | null {
  if (!metadata) return null;

  const parsed = typeof metadata === "string"
    ? parseJsonObject(metadata)
    : isRecord(metadata)
      ? metadata
      : null;
  if (!parsed) return null;

  const direct = stringField(parsed.call_id);
  if (direct) return direct;

  const rawText = stringField(parsed.raw_text);
  if (rawText) {
    const fromRaw = extractCallIdFromRawText(rawText);
    if (fromRaw) return fromRaw;
  }

  const nestedMetadata = parsed.metadata;
  if (typeof nestedMetadata === "string" || isRecord(nestedMetadata)) {
    return extractCallIdFromMetadata(nestedMetadata);
  }

  return null;
}

function extractCallIdFromRawText(rawText: string): string | null {
  const parsed = parseJsonObject(rawText);
  if (!parsed) return null;
  const payload = isRecord(parsed.payload) ? parsed.payload : parsed;
  return stringField(payload.call_id);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function omitTooltipDisplayFields(record: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...record };
  for (const field of TOOLTIP_DISPLAY_FIELDS) {
    delete next[field];
  }
  return next;
}

function recordFromMetadata(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value === "string") return parseJsonObject(value);
  return null;
}

function tooltipMetadataForEvent(ev: TurnEvent): Record<string, unknown> {
  const structuredEvent = omitTooltipDisplayFields(ev);

  const raw = isRecord(ev.metadata) ? ev.metadata : null;
  const rawMeta = raw ? recordFromMetadata(raw.metadata) : null;
  const sourceRecord = isRecord(ev.source_record) ? ev.source_record : null;
  const sourcePayload = sourceRecord && isRecord(sourceRecord.payload) ? sourceRecord.payload : null;
  const inputContentText = inputContentTextForEvent(ev, raw, rawMeta, sourcePayload);
  delete structuredEvent.metadata;
  delete structuredEvent.source_record;
  const eventType = stringField(rawMeta?.event_type)
    ?? stringField(raw?.event_type)
    ?? stringField(sourceRecord?.event_type)
    ?? stringField(sourcePayload?.type)
    ?? stringField(ev.event_type)
    ?? ev.kind;

  const tooltipMeta: Record<string, unknown> = {
    ...structuredEvent,
    ...(raw ? omitTooltipDisplayFields(raw) : {}),
    ...(rawMeta ? omitTooltipDisplayFields(rawMeta) : {}),
    ...(sourceRecord ? omitTooltipDisplayFields(sourceRecord) : {}),
    ...(sourcePayload ? omitTooltipDisplayFields(sourcePayload) : {}),
    event_type: eventType,
  };
  if (inputContentText) {
    tooltipMeta.input_content_text = inputContentText;
  }
  delete tooltipMeta.metadata;
  delete tooltipMeta.source_record;
  delete tooltipMeta.payload;
  return tooltipMeta;
}

function inputContentTextForEvent(
  ev: TurnEvent,
  raw: Record<string, unknown> | null,
  rawMeta: Record<string, unknown> | null,
  sourcePayload: Record<string, unknown> | null,
): string | null {
  return textFromContent(sourcePayload?.content)
    ?? textFromContent(rawMeta?.content)
    ?? textFromContent(raw?.content)
    ?? stringField(rawMeta?.content_text)
    ?? stringField(raw?.content_text)
    ?? stringField(ev.content);
}

function textFromContent(content: unknown): string | null {
  if (typeof content === "string") return content.length > 0 ? content : null;
  if (Array.isArray(content)) {
    const fragments: string[] = [];
    for (const part of content) {
      if (!isRecord(part)) continue;
      const text = stringField(part.text) ?? stringField(part.content);
      if (text) fragments.push(text);
    }
    return fragments.length > 0 ? fragments.join("\n") : null;
  }
  if (isRecord(content)) {
    return stringField(content.text);
  }
  return null;
}

/** Extract the ISO timestamp string from a node's metadata (set by tooltipMetadataForEvent). */
function nodeEventTimestamp(node: GraphNode): string | null {
  const ts = node.metadata?.timestamp;
  return typeof ts === "string" && ts.length > 0 ? ts : null;
}

/** Earliest event timestamp across a child session's graph turns (or null if none). */
function childFirstEventTimestamp(child: ChildSession): string | null {
  if (!child.graph_turns || child.graph_turns.length === 0) return null;
  let best: number | null = null;
  let bestTs: string | null = null;
  for (const turn of child.graph_turns) {
    const events = collectTurnEvents(turn);
    for (const ev of events) {
      const ts = ev.timestamp;
      if (typeof ts !== "string" || ts.length === 0) continue;
      const ms = Date.parse(ts);
      if (Number.isNaN(ms)) continue;
      if (best === null || ms < best) {
        best = ms;
        bestTs = ts;
      }
    }
  }
  return bestTs;
}

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
      if (s.events[j].isAnchor && s.events[j].event.kind === "assistant_output") return s.events[j];
    }
  }
  return null;
}

function firstMainAnchor(spindle: TurnSpindle): TurnEventPosition | null {
  for (const pos of spindle.events) {
    if (pos.isAnchor) return pos;
  }
  return null;
}

function lastMainAnchor(spindle: TurnSpindle): TurnEventPosition | null {
  const outputAnchor = lastOutputAnchor([spindle]);
  if (outputAnchor) return outputAnchor;

  for (let i = spindle.events.length - 1; i >= 0; i--) {
    const pos = spindle.events[i];
    if (pos.isAnchor) {
      return pos;
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

  const userEvents = events.filter((e) => e.kind === "user_input");
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
  const picked = nonAux[nonAux.length - 1];
  return picked ? toTurnEvent(picked) : null;
}

function looksLikeAux(ev: RawEvent): boolean {
  const text = (ev.content ?? "").trimStart();
  if (!text) return false;
  return AUX_INPUT_PREFIXES.some((p) => text.startsWith(p));
}

function toTurnEvent(ev: RawEvent): TurnEvent {
  // R5: Extract child_session_id from metadata for subagent_session events
  let childSessionId: string | undefined;
  if (ev.kind === "subagent_session") {
    childSessionId = _extractChildSessionId(ev.metadata);
  }

  // Build a lightweight metadata object instead of embedding the full RawEvent,
  // which duplicates all event data in memory. Only keep fields needed downstream.
  const rawMeta = typeof ev.metadata === "string"
    ? (() => { try { return JSON.parse(ev.metadata); } catch { return null; } })()
    : isRecord(ev.metadata) ? ev.metadata : null;

  return {
    event_id: ev.id,
    kind: ev.kind,
    title: eventTypeLabel(ev),
    summary: (ev as any).content_preview?.slice(0, 80) ?? ev.content?.slice(0, 80) ?? ev.kind,
    child_session_id: childSessionId,
    timestamp: ev.timestamp ?? undefined,
    source_line_no: ev.source_line_no ?? undefined,
    metadata: {
      timestamp: ev.timestamp,
      source_line_no: ev.source_line_no,
      role: ev.role,
      content_preview: (ev as any).content_preview ?? ev.content?.slice(0, 200),
      ...(rawMeta ? rawMeta : {}),
    },
  };
}

/** R5: Extract child_session_id from metadata (JSON string or object). */
function _extractChildSessionId(
  metadata: string | Record<string, unknown> | null | undefined,
): string | undefined {
  if (!metadata) return undefined;
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);
      if (typeof parsed?.child_session_id === "string") {
        return parsed.child_session_id;
      }
    } catch { /* ignore */ }
    return undefined;
  }
  if (typeof metadata.child_session_id === "string") {
    return metadata.child_session_id;
  }
  return undefined;
}
