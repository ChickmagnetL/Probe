import {
  graphNodeLabelPadding,
  graphNodeLabelRadius,
  type GraphNode,
  type GraphData,
  type TurnSpindle,
} from "./graph-layout";

export interface RenderState {
  transform: { x: number; y: number; k: number };
  hoveredNodeId: string | null;
  selectedNodeId: string | null;
  labelsVisible: boolean;
}

export interface ViewportBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

const LABEL_FONT = "12px -apple-system, sans-serif";
const SIDE_LABEL_GAP = 8;
const BELOW_LABEL_GAP = 4;

function drawNodeLabel(
  ctx: CanvasRenderingContext2D,
  node: GraphNode,
  dimmed: boolean,
) {
  const r = graphNodeLabelRadius(node);
  ctx.font = LABEL_FONT;
  ctx.fillStyle = dimmed ? "rgba(102,102,102,0.35)" : "#666";

  if (node.isAnchor) {
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(node.label, node.x, node.y + r + BELOW_LABEL_GAP);
    return;
  }

  // Non-anchor nodes: default to right side, unless labelAlign is "left"
  if (node.labelAlign === "left") {
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(node.label, node.x - r - SIDE_LABEL_GAP, node.y);
  } else {
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(node.label, node.x + r + SIDE_LABEL_GAP, node.y);
  }
}

// ── Subagent Marker (R4) ───────────────────────────────

/**
 * Draw a subagent marker: white background circle + colored outer ring + black inner core.
 * White background MUST be drawn first (guides pass underneath and get occluded).
 */
function markerSubagent(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  options: { outerColor?: string; innerColor?: string; size?: number; dimmed?: boolean } = {},
) {
  const outerColor = options.outerColor ?? "#475569";
  const innerColor = options.innerColor ?? "#000";
  const size = options.size ?? 1;
  const dimmed = options.dimmed ?? false;
  const rOuter = 8 * size;
  const rInner = 4 * size;

  // 1) White background (covers ribbon underneath)
  ctx.beginPath();
  ctx.arc(x, y, rOuter, 0, Math.PI * 2);
  ctx.fillStyle = dimmed ? "rgba(255,255,255,0.8)" : "#fff";
  ctx.fill();

  // 2) Outer ring
  ctx.strokeStyle = dimmed ? outerColor + "55" : outerColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 3) Black inner core
  ctx.beginPath();
  ctx.arc(x, y, rInner, 0, Math.PI * 2);
  ctx.fillStyle = dimmed ? "#00000055" : innerColor;
  ctx.fill();
}

function isInViewport(
  nx: number,
  ny: number,
  r: number,
  vp: ViewportBounds,
): boolean {
  return (
    nx + r >= vp.x &&
    nx - r <= vp.x + vp.w &&
    ny + r >= vp.y &&
    ny - r <= vp.y + vp.h
  );
}

function isNodeLabelInViewport(node: GraphNode, vp: ViewportBounds): boolean {
  const labelPadding = graphNodeLabelPadding(node);
  return (
    node.x + labelPadding.right >= vp.x &&
    node.x - labelPadding.left <= vp.x + vp.w &&
    node.y + labelPadding.y >= vp.y &&
    node.y - labelPadding.y <= vp.y + vp.h
  );
}

function isLinkInViewport(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  vp: ViewportBounds,
): boolean {
  const minX = Math.min(sx, tx);
  const maxX = Math.max(sx, tx);
  const minY = Math.min(sy, ty);
  const maxY = Math.max(sy, ty);
  return (
    maxX >= vp.x &&
    minX <= vp.x + vp.w &&
    maxY >= vp.y &&
    minY <= vp.y + vp.h
  );
}

// ── Folder Guide Drawing ────────────────────────────────

/**
 * Draw one vertical spine per turn plus horizontal indent guides for child rows.
 */
function drawFolderGuides(
  ctx: CanvasRenderingContext2D,
  spindles: TurnSpindle[],
  connectedIds: Set<string>,
  isDimming: boolean,
  dotMode: boolean,
) {
  if (dotMode) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.setLineDash([]);

  for (const spindle of spindles) {
    let dimmed = false;
    if (isDimming) {
      dimmed = true;
      for (const pos of spindle.events) {
        if (connectedIds.has(pos.event.event_id)) {
          dimmed = false;
          break;
        }
      }
    }

    ctx.globalAlpha = dimmed ? 0.22 : 0.85;
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = dimmed ? 1 : 2;
    ctx.beginPath();
    ctx.moveTo(spindle.cx, spindle.top);
    ctx.lineTo(spindle.cx, spindle.bottom);
    ctx.stroke();

    ctx.globalAlpha = dimmed ? 0.18 : 0.9;
    ctx.lineWidth = 1.2;
    for (const pos of spindle.events) {
      const dx = pos.x - spindle.cx;
      if (Math.abs(dx) < 0.5) continue;
      const endX = pos.x - Math.sign(dx) * 6;
      ctx.beginPath();
      ctx.moveTo(spindle.cx, pos.y);
      ctx.lineTo(endX, pos.y);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Render the full static graph to a world-coordinate canvas (identity transform).
 * The offscreen cache stores this, and the main canvas applies pan/zoom when blitting.
 */
export function renderStaticLayer(
  ctx: CanvasRenderingContext2D,
  data: GraphData,
  selectedNodeId: string | null,
  highlightIds?: Set<string> | null,
) {
  const { nodes, links, nodeMap, adjacencyMap, spindles } = data;

  const focusId = selectedNodeId;
  const connectedIds = highlightIds ?? (() => {
    const ids = new Set<string>();
    if (focusId) {
      ids.add(focusId);
      const adj = adjacencyMap.get(focusId);
      if (adj) for (const id of adj) ids.add(id);
    }
    return ids;
  })();
  const isDimming = connectedIds.size > 0;

  // ── Draw folder guides ────────────────────────────────
  if (spindles) {
    drawFolderGuides(ctx, spindles, connectedIds, isDimming, false);
  }

  // ── Draw links (batched by type+dimmed) ─────────────────
  const batches = new Map<string, { src: GraphNode; tgt: GraphNode; tint?: string; isThin?: boolean; fromDx?: number; toDx?: number }[]>();
  for (const link of links) {
    const src = nodeMap.get(link.source);
    const tgt = nodeMap.get(link.target);
    if (!src || !tgt) continue;
    const dimmed = isDimming && !connectedIds.has(link.source) && !connectedIds.has(link.target);
    const key = `${link.type}_${dimmed ? 1 : 0}`;
    let arr = batches.get(key);
    if (!arr) { arr = []; batches.set(key, arr); }
    arr.push({ src, tgt, tint: link.tint, isThin: link.isThin, fromDx: link.spawnFromDx, toDx: link.spawnToDx });
  }

  for (const [key, arr] of batches) {
    const [type, dimmedS] = key.split("_");
    const dimmed = dimmedS === "1";

    if (type === "spawn") {
      // Draw spawn links individually with per-link tint and offsets (R6)
      for (const { src, tgt, tint, fromDx, toDx } of arr) {
        const fromX = src.x + (fromDx ?? 0);
        const fromY = src.y;
        const toX = tgt.x + (toDx ?? 0);
        const toY = tgt.y;
        const midX = (fromX + toX) / 2;

        // Spawn link bezier
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.bezierCurveTo(midX, fromY, midX, toY, toX, toY);
        ctx.globalAlpha = dimmed ? 0.28 : 0.8;
        ctx.strokeStyle = tint ? tint + "cc" : (dimmed ? "#bbb" : "#94a3b8");
        ctx.lineWidth = 1.7;
        ctx.setLineDash([5, 4]);
        ctx.stroke();

        // Tint circle at child spindle top (multi-agent only, R6)
        if (tint) {
          ctx.globalAlpha = 1;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(tgt.x, tgt.y, 14, 0, Math.PI * 2);
          ctx.strokeStyle = tint + (dimmed ? "26" : "55");
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
    } else {
      ctx.beginPath();
      for (const { src, tgt } of arr) {
        if (type === "branch") {
          const cpX = (src.x + tgt.x) / 2;
          ctx.moveTo(src.x, src.y);
          ctx.quadraticCurveTo(cpX, src.y, tgt.x, tgt.y);
        } else {
          ctx.moveTo(src.x, src.y);
          ctx.lineTo(tgt.x, tgt.y);
        }
      }
      if (type === "branch") {
        ctx.globalAlpha = dimmed ? 0.15 : 0.4;
        ctx.strokeStyle = dimmed ? "#ddd" : "#ddd";
        ctx.lineWidth = dimmed ? 1 : 1.5;
        ctx.setLineDash([3, 3]);
      } else {
        ctx.globalAlpha = dimmed ? 0.15 : 0.7;
        ctx.strokeStyle = dimmed ? "#bbb" : "#bbb";
        ctx.lineWidth = dimmed ? 2 : 3;
        ctx.setLineDash([]);
      }
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  // ── Draw nodes ────────────────────────────────────────
  for (const node of nodes) {
    const dimmed = isDimming && !connectedIds.has(node.id);
    const isSelected = node.id === selectedNodeId;
    const r = node.radius;

    if (node.spindleRole === "subagent") {
      // Subagent marker: white bg + outer ring + black inner core (R4)
      markerSubagent(ctx, node.x, node.y, {
        outerColor: node.color,
        dimmed,
      });
      if (isSelected && !dimmed) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 8 + 4, 0, Math.PI * 2);
        ctx.strokeStyle = node.color + "66";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      continue;
    }

    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);

    if (node.filled) {
      ctx.fillStyle = dimmed ? node.color + "55" : node.color;
      ctx.fill();
      ctx.strokeStyle = dimmed ? node.color + "55" : node.color;
      ctx.lineWidth = isSelected ? 4 : node.strokeWidth;
      ctx.stroke();
    } else {
      ctx.fillStyle = dimmed ? "rgba(255,255,255,0.8)" : "#fff";
      ctx.fill();
      ctx.strokeStyle = dimmed ? node.color + "55" : node.color;
      ctx.lineWidth = isSelected ? 3 : node.strokeWidth;
      ctx.stroke();
    }

    // Selected highlight: outer ring instead of shadowBlur
    if (isSelected && !dimmed) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = node.color + "66";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}

/**
 * Render labels directly on the main canvas (not offscreen) for crisp text.
 */
export function renderLabels(
  ctx: CanvasRenderingContext2D,
  data: GraphData,
  transform: { x: number; y: number; k: number },
  selectedNodeId: string | null,
  hoveredNodeId: string | null,
  labelsVisible: boolean,
  viewport: ViewportBounds,
  highlightIds?: Set<string> | null,
) {
  if (!labelsVisible || transform.k < 0.5) return;

  const { nodes, adjacencyMap } = data;
  const connectedIds = highlightIds ?? (() => {
    const ids = new Set<string>();
    const focusId = hoveredNodeId ?? selectedNodeId;
    if (focusId) {
      ids.add(focusId);
      const adj = adjacencyMap.get(focusId);
      if (adj) for (const id of adj) ids.add(id);
    }
    return ids;
  })();
  const isDimming = connectedIds.size > 0;

  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  for (const node of nodes) {
    if (!isNodeLabelInViewport(node, viewport)) continue;
    const dimmed = isDimming && !connectedIds.has(node.id);
    drawNodeLabel(ctx, node, dimmed);
  }

  ctx.restore();
}

/**
 * LOD-aware rendering for the main canvas with viewport culling.
 * Used during pan/zoom when the offscreen cache is valid (drawImage) but
 * LOD needs to skip detail nodes or use dot mode.
 */
export function renderLODLayer(
  ctx: CanvasRenderingContext2D,
  data: GraphData,
  state: RenderState,
  width: number,
  height: number,
  viewport: ViewportBounds,
  highlightIds?: Set<string> | null,
) {
  const { transform, hoveredNodeId, selectedNodeId, labelsVisible } = state;
  const { nodes, links, nodeMap, adjacencyMap, spindles } = data;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  const focusId = hoveredNodeId ?? selectedNodeId;
  const connectedIds = highlightIds ?? (() => {
    const ids = new Set<string>();
    if (focusId) {
      ids.add(focusId);
      const adj = adjacencyMap.get(focusId);
      if (adj) for (const id of adj) ids.add(id);
    }
    return ids;
  })();
  const isDimming = connectedIds.size > 0;
  const drawLabels = labelsVisible && transform.k >= 0.5;
  const dotMode = transform.k < 0.15;
  const vp = viewport;

  // ── Draw folder guides ────────────────────────────────
  if (spindles && !dotMode) {
    drawFolderGuides(ctx, spindles, connectedIds, isDimming, false);
  }

  // Links
  const batches = new Map<string, { src: GraphNode; tgt: GraphNode; tint?: string; fromDx?: number; toDx?: number }[]>();
  for (const link of links) {
    const src = nodeMap.get(link.source);
    const tgt = nodeMap.get(link.target);
    if (!src || !tgt) continue;
    if (!isLinkInViewport(src.x, src.y, tgt.x, tgt.y, vp)) continue;
    const dimmed = isDimming && !connectedIds.has(link.source) && !connectedIds.has(link.target);
    const key = `${link.type}_${dimmed ? 1 : 0}`;
    let arr = batches.get(key);
    if (!arr) { arr = []; batches.set(key, arr); }
    arr.push({ src, tgt, tint: link.tint, fromDx: link.spawnFromDx, toDx: link.spawnToDx });
  }

  for (const [key, arr] of batches) {
    const [type, dimmedS] = key.split("_");
    const dimmed = dimmedS === "1";

    if (type === "spawn") {
      // Draw spawn links individually with per-link tint and offsets (R6)
      for (const { src, tgt, tint, fromDx, toDx } of arr) {
        const fromX = src.x + (fromDx ?? 0);
        const fromY = src.y;
        const toX = tgt.x + (toDx ?? 0);
        const toY = tgt.y;
        const midX = (fromX + toX) / 2;

        // Spawn link bezier
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.bezierCurveTo(midX, fromY, midX, toY, toX, toY);
        ctx.globalAlpha = dimmed ? 0.28 : 0.8;
        ctx.strokeStyle = tint ? tint + "cc" : (dimmed ? "#bbb" : "#94a3b8");
        ctx.lineWidth = 1.7;
        ctx.setLineDash([5, 4]);
        ctx.stroke();

        // Tint circle at child spindle top (multi-agent only, R6)
        if (tint && !dotMode) {
          ctx.globalAlpha = 1;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(tgt.x, tgt.y, 14, 0, Math.PI * 2);
          ctx.strokeStyle = tint + (dimmed ? "26" : "55");
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
    } else {
      ctx.beginPath();
      for (const { src, tgt } of arr) {
        if (type === "branch") {
          const cpX = (src.x + tgt.x) / 2;
          ctx.moveTo(src.x, src.y);
          ctx.quadraticCurveTo(cpX, src.y, tgt.x, tgt.y);
        } else {
          ctx.moveTo(src.x, src.y);
          ctx.lineTo(tgt.x, tgt.y);
        }
      }
      if (type === "branch") {
        ctx.globalAlpha = dimmed ? 0.15 : 0.4;
        ctx.strokeStyle = dimmed ? "#ddd" : "#ddd";
        ctx.lineWidth = dimmed ? 1 : 1.5;
        ctx.setLineDash([3, 3]);
      } else {
        ctx.globalAlpha = dimmed ? 0.15 : 0.7;
        ctx.strokeStyle = dimmed ? "#bbb" : "#bbb";
        ctx.lineWidth = dimmed ? 2 : 3;
        ctx.setLineDash([]);
      }
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  // Nodes
  for (const node of nodes) {
    if (!isInViewport(node.x, node.y, node.radius, vp)) continue;

    const dimmed = isDimming && !connectedIds.has(node.id);
    const isSelected = node.id === selectedNodeId;
    const isHovered = node.id === hoveredNodeId;
    const isFocused = isSelected || isHovered;
    const r = node.radius;

    if (dotMode) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = dimmed ? node.color + "55" : node.color;
      ctx.fill();
      continue;
    }

    if (node.spindleRole === "subagent") {
      // Subagent marker: white bg + outer ring + black inner core (R4)
      markerSubagent(ctx, node.x, node.y, {
        outerColor: node.color,
        dimmed,
      });
      if (isFocused && !dimmed) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 8 + 4, 0, Math.PI * 2);
        ctx.strokeStyle = node.color + "66";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      if (drawLabels) {
        drawNodeLabel(ctx, node, dimmed);
      }
      continue;
    }

    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);

    if (node.filled) {
      ctx.fillStyle = dimmed ? node.color + "55" : node.color;
      ctx.fill();
      ctx.strokeStyle = dimmed ? node.color + "55" : node.color;
      ctx.lineWidth = isSelected ? 4 : isHovered ? 3 : node.strokeWidth;
      ctx.stroke();
    } else {
      ctx.fillStyle = dimmed ? "rgba(255,255,255,0.8)" : "#fff";
      ctx.fill();
      ctx.strokeStyle = dimmed ? node.color + "55" : node.color;
      ctx.lineWidth = isSelected ? 3 : isHovered ? 2.5 : node.strokeWidth;
      ctx.stroke();
    }

    if (isFocused && !dimmed) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = node.color + "66";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    if (drawLabels) {
      drawNodeLabel(ctx, node, dimmed);
    }
  }

  ctx.restore();
}

/**
 * Render only the dynamic hover overlay on top of the cached static layer.
 */
export function renderDynamicOverlay(
  ctx: CanvasRenderingContext2D,
  data: GraphData,
  transform: { x: number; y: number; k: number },
  hoveredNodeId: string | null,
) {
  if (!hoveredNodeId) return;

  const { nodes, nodeMap, adjacencyMap } = data;
  const node = nodeMap.get(hoveredNodeId);
  if (!node) return;

  const connectedIds = new Set<string>([hoveredNodeId]);
  const adj = adjacencyMap.get(hoveredNodeId);
  if (adj) for (const id of adj) connectedIds.add(id);

  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  // Dim non-connected nodes
  for (const n of nodes) {
    if (connectedIds.has(n.id)) continue;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius + 1, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fill();
  }

  // Hover highlight ring (PRD: radius + 4, color + '66')
  ctx.beginPath();
  ctx.arc(node.x, node.y, node.radius + 4, 0, Math.PI * 2);
  ctx.strokeStyle = node.color + "66";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.restore();
}

/**
 * Full render (no caching). Used as fallback.
 */
export function renderGraph(
  ctx: CanvasRenderingContext2D,
  data: GraphData,
  state: RenderState,
  width: number,
  height: number,
  viewport?: ViewportBounds,
) {
  const { transform, hoveredNodeId, selectedNodeId, labelsVisible } = state;
  const { spindles } = data;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  const connectedIds = new Set<string>();
  if (hoveredNodeId || selectedNodeId) {
    const focusId = hoveredNodeId ?? selectedNodeId;
    if (focusId) {
      connectedIds.add(focusId);
      const adj = data.adjacencyMap.get(focusId);
      if (adj) for (const id of adj) connectedIds.add(id);
    }
  }

  const isDimming = connectedIds.size > 0;
  const drawLabels = labelsVisible && transform.k >= 0.5;
  const dotMode = transform.k < 0.15;
  const vp = viewport;

  // ── Draw folder guides ────────────────────────────────
  if (spindles && !dotMode) {
    drawFolderGuides(ctx, spindles, connectedIds, isDimming, false);
  }

  // Links
  const batches = new Map<string, { src: GraphNode; tgt: GraphNode; tint?: string; fromDx?: number; toDx?: number }[]>();
  for (const link of data.links) {
    const src = data.nodeMap.get(link.source);
    const tgt = data.nodeMap.get(link.target);
    if (!src || !tgt) continue;
    if (vp && !isLinkInViewport(src.x, src.y, tgt.x, tgt.y, vp)) continue;
    const dimmed = isDimming && !connectedIds.has(link.source) && !connectedIds.has(link.target);
    const key = `${link.type}_${dimmed ? 1 : 0}`;
    let arr = batches.get(key);
    if (!arr) { arr = []; batches.set(key, arr); }
    arr.push({ src, tgt, tint: link.tint, fromDx: link.spawnFromDx, toDx: link.spawnToDx });
  }

  for (const [key, arr] of batches) {
    const [type, dimmedS] = key.split("_");
    const dimmed = dimmedS === "1";

    if (type === "spawn") {
      // Draw spawn links individually with per-link tint and offsets (R6)
      for (const { src, tgt, tint, fromDx, toDx } of arr) {
        const fromX = src.x + (fromDx ?? 0);
        const fromY = src.y;
        const toX = tgt.x + (toDx ?? 0);
        const toY = tgt.y;
        const midX = (fromX + toX) / 2;

        // Spawn link bezier
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.bezierCurveTo(midX, fromY, midX, toY, toX, toY);
        ctx.globalAlpha = dimmed ? 0.28 : 0.8;
        ctx.strokeStyle = tint ? tint + "cc" : (dimmed ? "#bbb" : "#94a3b8");
        ctx.lineWidth = 1.7;
        ctx.setLineDash([5, 4]);
        ctx.stroke();

        // Tint circle at child spindle top (multi-agent only, R6)
        if (tint && !dotMode) {
          ctx.globalAlpha = 1;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(tgt.x, tgt.y, 14, 0, Math.PI * 2);
          ctx.strokeStyle = tint + (dimmed ? "26" : "55");
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
    } else {
      ctx.beginPath();
      for (const { src, tgt } of arr) {
        if (type === "branch") {
          const cpX = (src.x + tgt.x) / 2;
          ctx.moveTo(src.x, src.y);
          ctx.quadraticCurveTo(cpX, src.y, tgt.x, tgt.y);
        } else {
          ctx.moveTo(src.x, src.y);
          ctx.lineTo(tgt.x, tgt.y);
        }
      }
      if (type === "branch") {
        ctx.globalAlpha = dimmed ? 0.15 : 0.4;
        ctx.strokeStyle = dimmed ? "#ddd" : "#ddd";
        ctx.lineWidth = dimmed ? 1 : 1.5;
        ctx.setLineDash([3, 3]);
      } else {
        ctx.globalAlpha = dimmed ? 0.15 : 0.7;
        ctx.strokeStyle = dimmed ? "#bbb" : "#bbb";
        ctx.lineWidth = dimmed ? 2 : 3;
        ctx.setLineDash([]);
      }
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  // Nodes
  for (const node of data.nodes) {
    if (vp && !isInViewport(node.x, node.y, node.radius, vp)) continue;

    const dimmed = isDimming && !connectedIds.has(node.id);
    const isSelected = node.id === selectedNodeId;
    const isHovered = node.id === hoveredNodeId;
    const isFocused = isSelected || isHovered;
    const r = node.radius;

    // LOD dotMode: all nodes are simple colored dots
    if (dotMode) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = dimmed ? node.color + "55" : node.color;
      ctx.fill();
      continue;
    }

    if (node.spindleRole === "subagent") {
      // Subagent marker: white bg + outer ring + black inner core (R4)
      markerSubagent(ctx, node.x, node.y, {
        outerColor: node.color,
        dimmed,
      });
      if (isFocused && !dimmed) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 8 + 4, 0, Math.PI * 2);
        ctx.strokeStyle = node.color + "66";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      if (drawLabels) {
        drawNodeLabel(ctx, node, dimmed);
      }
      continue;
    }

    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);

    if (node.filled) {
      ctx.fillStyle = dimmed ? node.color + "55" : node.color;
      ctx.fill();
      ctx.strokeStyle = dimmed ? node.color + "55" : node.color;
      ctx.lineWidth = isSelected ? 4 : isHovered ? 3 : node.strokeWidth;
      ctx.stroke();
    } else {
      ctx.fillStyle = dimmed ? "rgba(255,255,255,0.8)" : "#fff";
      ctx.fill();
      ctx.strokeStyle = dimmed ? node.color + "55" : node.color;
      ctx.lineWidth = isSelected ? 3 : isHovered ? 2.5 : node.strokeWidth;
      ctx.stroke();
    }

    // Focus highlight: outer ring (PRD: radius+4, color+'66', lineWidth 3)
    if (isFocused && !dimmed) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = node.color + "66";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    if (drawLabels) {
      drawNodeLabel(ctx, node, dimmed);
    }
  }

  ctx.restore();
}

export function hitTest(
  nodes: GraphNode[],
  mx: number,
  my: number,
  transform: { x: number; y: number; k: number },
  viewport?: ViewportBounds,
): GraphNode | null {
  const x = (mx - transform.x) / transform.k;
  const y = (my - transform.y) / transform.k;

  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (viewport && !isInViewport(n.x, n.y, n.radius, viewport)) continue;
    const dx = x - n.x;
    const dy = y - n.y;
    if (dx * dx + dy * dy <= n.radius * n.radius) return n;
  }
  return null;
}
