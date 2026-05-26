import type { GraphNode, GraphData, TurnSpindle } from "./graph-layout";

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

// ── Subagent Marker (R4) ───────────────────────────────

/**
 * Draw a subagent marker: white background circle + colored outer ring + black inner core.
 * White background MUST be drawn first (ribbon passes underneath and gets occluded).
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

// ── Spindle Ribbon Drawing (R2) ─────────────────────────

/**
 * Draw wide ribbon for normal mode (>= 2 intermediates).
 * Two strands: phase 0 (amber) and phase PI (purple).
 * Uses filled quadrilaterals with depth-based width and alpha.
 */
function drawRibbon(
  ctx: CanvasRenderingContext2D,
  spindle: TurnSpindle,
  baseAlpha: number,
) {
  const { cx, top, pitch, tMax, omega, RFn, isThin } = spindle;
  if (tMax < 1) return;
  if (isThin) return;

  const samples = Math.max(120, Math.ceil(tMax * 30));
  const colors = ["#f59e0b", "#a855f7"];
  const phases = [0, Math.PI];

  for (let strand = 0; strand < 2; strand++) {
    const color = colors[strand];
    const phase = phases[strand];

    for (let i = 0; i < samples; i++) {
      const t0 = (i / samples) * tMax;
      const t1 = ((i + 1) / samples) * tMax;
      const u0 = t0 / tMax;
      const u1 = t1 / tMax;
      const R0 = RFn(u0);
      const R1 = RFn(u1);
      const y0 = top + t0 * pitch;
      const y1 = top + t1 * pitch;
      const c0 = Math.cos(t0 * omega + phase);
      const c1 = Math.cos(t1 * omega + phase);
      const x0 = cx + R0 * c0;
      const x1 = cx + R1 * c1;

      const depth0 = (c0 + 1) / 2;
      const depth1 = (c1 + 1) / 2;
      const baseW = 9;
      const w0 = baseW * (0.35 + 0.65 * depth0);
      const w1 = baseW * (0.35 + 0.65 * depth1);

      const alpha = baseAlpha * (0.30 + 0.55 * ((depth0 + depth1) / 2));
      const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, "0");
      ctx.fillStyle = color + alphaHex;

      ctx.beginPath();
      ctx.moveTo(x0 - w0 / 2, y0);
      ctx.lineTo(x0 + w0 / 2, y0);
      ctx.lineTo(x1 + w1 / 2, y1);
      ctx.lineTo(x1 - w1 / 2, y1);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/**
 * Draw thin strand for degenerate mode (<= 0 intermediates, 2-event turn).
 * Two-pass rendering: background (dark) then foreground (bright).
 * Segments split by cos sign for front/back layering.
 */
function drawThinStrand(
  ctx: CanvasRenderingContext2D,
  spindle: TurnSpindle,
  baseAlpha: number,
) {
  const { cx, top, pitch, tMax, omega, RFn, isThin } = spindle;
  if (tMax < 1 || !isThin) return;

  const samples = Math.max(80, Math.ceil(tMax * 30));
  const colors = ["#f59e0b", "#a855f7"];
  const phases = [0, Math.PI];

  for (let strand = 0; strand < 2; strand++) {
    const color = colors[strand];
    const phase = phases[strand];

    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      let drawing = false;

      for (let i = 0; i <= samples; i++) {
        const t = (i / samples) * tMax;
        const c = Math.cos(t * omega + phase);
        const wantFront = c > 0;

        if ((pass === 0 && !wantFront) || (pass === 1 && wantFront)) {
          const u = t / tMax;
          const x = cx + RFn(u) * c;
          const y = top + t * pitch;
          if (drawing) {
            ctx.lineTo(x, y);
          } else {
            ctx.moveTo(x, y);
            drawing = true;
          }
        } else {
          drawing = false;
        }
      }

      if (pass === 0) {
        ctx.globalAlpha = baseAlpha * 0.33;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
      } else {
        ctx.globalAlpha = baseAlpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Draw all spindles' ribbons with dimming support.
 */
function drawSpindleRibbons(
  ctx: CanvasRenderingContext2D,
  spindles: TurnSpindle[],
  connectedIds: Set<string>,
  isDimming: boolean,
  dotMode: boolean,
) {
  if (dotMode) return;

  for (const spindle of spindles) {
    let alpha = 1;
    if (isDimming) {
      let hasConnected = false;
      for (const pos of spindle.events) {
        if (connectedIds.has(pos.event.event_id)) {
          hasConnected = true;
          break;
        }
      }
      if (!hasConnected) alpha = 0.35;
    }

    if (spindle.isThin) {
      drawThinStrand(ctx, spindle, alpha);
    } else {
      drawRibbon(ctx, spindle, alpha);
    }
  }
}

/**
 * Render the full static graph to a world-coordinate canvas (identity transform).
 * The offscreen cache stores this, and the main canvas applies pan/zoom when blitting.
 */
export function renderStaticLayer(
  ctx: CanvasRenderingContext2D,
  data: GraphData,
  selectedNodeId: string | null,
) {
  const { nodes, links, nodeMap, adjacencyMap, spindles } = data;

  const focusId = selectedNodeId;
  const connectedIds = new Set<string>();
  if (focusId) {
    connectedIds.add(focusId);
    const adj = adjacencyMap.get(focusId);
    if (adj) for (const id of adj) connectedIds.add(id);
  }
  const isDimming = connectedIds.size > 0;

  // ── Draw spindle ribbons ──────────────────────────────
  if (spindles) {
    drawSpindleRibbons(ctx, spindles, connectedIds, isDimming, false);
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
) {
  if (!labelsVisible || transform.k < 0.5) return;

  const { nodes, adjacencyMap } = data;
  const connectedIds = new Set<string>();
  const focusId = hoveredNodeId ?? selectedNodeId;
  if (focusId) {
    connectedIds.add(focusId);
    const adj = adjacencyMap.get(focusId);
    if (adj) for (const id of adj) connectedIds.add(id);
  }
  const isDimming = connectedIds.size > 0;

  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);
  ctx.font = LABEL_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (const node of nodes) {
    if (!isInViewport(node.x, node.y, node.radius, viewport)) continue;
    const dimmed = isDimming && !connectedIds.has(node.id);
    ctx.fillStyle = dimmed ? "rgba(102,102,102,0.35)" : "#666";
    ctx.fillText(node.label, node.x, node.y + node.radius + 4);
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
) {
  const { transform, hoveredNodeId, selectedNodeId, labelsVisible } = state;
  const { nodes, links, nodeMap, adjacencyMap, spindles } = data;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  const focusId = hoveredNodeId ?? selectedNodeId;
  const connectedIds = new Set<string>();
  if (focusId) {
    connectedIds.add(focusId);
    const adj = adjacencyMap.get(focusId);
    if (adj) for (const id of adj) connectedIds.add(id);
  }
  const isDimming = connectedIds.size > 0;
  const drawLabels = labelsVisible && transform.k >= 0.5;
  const skipDetails = transform.k < 0.3;
  const dotMode = transform.k < 0.15;
  const vp = viewport;

  // ── Draw spindle ribbons ──────────────────────────────
  if (spindles && !dotMode) {
    drawSpindleRibbons(ctx, spindles, connectedIds, isDimming, false);
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
    // LOD: in skipDetails mode, hide intermediate nodes but keep anchors and subagent markers
    if (skipDetails && node.spindleRole === "intermediate") continue;
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
        ctx.font = LABEL_FONT;
        ctx.fillStyle = dimmed ? "rgba(102,102,102,0.35)" : "#666";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(node.label, node.x, node.y + 8 + 4);
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
      ctx.font = LABEL_FONT;
      ctx.fillStyle = dimmed ? "rgba(102,102,102,0.35)" : "#666";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(node.label, node.x, node.y + r + 4);
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
  const skipDetails = transform.k < 0.3;
  const dotMode = transform.k < 0.15;
  const vp = viewport;

  // ── Draw spindle ribbons ──────────────────────────────
  if (spindles && !dotMode) {
    drawSpindleRibbons(ctx, spindles, connectedIds, isDimming, false);
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
    // LOD: in skipDetails mode, hide intermediate nodes but keep anchors and subagent markers
    if (skipDetails && node.spindleRole === "intermediate") continue;
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
        ctx.font = LABEL_FONT;
        ctx.fillStyle = dimmed ? "rgba(102,102,102,0.35)" : "#666";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(node.label, node.x, node.y + 8 + 4);
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
      ctx.font = LABEL_FONT;
      ctx.fillStyle = dimmed ? "rgba(102,102,102,0.35)" : "#666";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(node.label, node.x, node.y + r + 4);
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
