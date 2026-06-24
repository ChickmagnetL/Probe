import { useRef, useEffect, useState, useCallback } from "react";
import type { EventRow } from "../../ipc/types";
import type { GraphData, GraphTurn, ChildSession, GraphNode } from "./graph-layout";
import { buildGraphFromTurns, buildTurnsFromEvents } from "./graph-layout";
import {
  renderStaticLayer,
  renderLabels,
  renderDynamicOverlay,
  renderLODLayer,
  hitTest,
  type RenderState,
  type ViewportBounds,
} from "./graph-renderer";
import { createInteractionHandlers, type Transform } from "./graph-interaction";
import { GraphTooltip } from "./GraphTooltip";
import { GraphInputAxis } from "./GraphInputAxis";
import { GraphCanvasControls } from "./GraphCanvasControls";
import { buildInputAxisItems, centerGraphNodeInViewport, type InputAxisItem } from "./graph-input-axis";
import { computeResetViewTransform, graphBounds, type GraphViewportSize } from "./graph-viewport";
import { extractVisibleKinds, type LegendItem } from "./graph-legend-utils";

interface GraphCanvasProps {
  graphTurns?: GraphTurn[];
  events?: EventRow[];
  childSessions?: ChildSession[];
  selectedEventId: string | null;
  graphSessionId?: string;
  selectedSessionId?: string;
  onNodeClick: (eventId: string | null, sessionId?: string, parentSessionId?: string) => void;
}

function sizeCanvasToContainer(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
) {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = container.getBoundingClientRect();
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.scale(dpr, dpr);
}

export function GraphCanvas({
  graphTurns,
  events,
  childSessions,
  selectedEventId,
  graphSessionId,
  selectedSessionId,
  onNodeClick,
}: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef<GraphData | null>(null);
  const transformRef = useRef<Transform>({ x: 0, y: 0, k: 1 });
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [tooltipNode, setTooltipNode] = useState<{ node: GraphNode; x: number; y: number } | null>(null);
  const [inputAxisItems, setInputAxisItems] = useState<InputAxisItem[]>([]);
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [visibleKinds, setVisibleKinds] = useState<LegendItem[]>([]);

  // Hover via ref — no React re-render
  const hoveredNodeIdRef = useRef<string | null>(null);
  const jumpHighlightedNodeIdRef = useRef<string | null>(null);
  const jumpHighlightTimerRef = useRef<number | null>(null);

  // Offscreen cache (world coordinates, no transform)
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cacheDirtyRef = useRef(true);
  const cacheBoundsRef = useRef<{ minX: number; minY: number }>({ minX: 0, minY: 0 });
  const layoutCacheRef = useRef<{ key: string; data: GraphData } | null>(null);

  const dirtyRef = useRef(true);

  // Stable refs for draw loop
  const selectedEventIdRef = useRef(selectedEventId);
  const labelsVisibleRef = useRef(labelsVisible);
  const selectedSessionIdRef = useRef(selectedSessionId);
  const hiddenKindsRef = useRef(hiddenKinds);
  selectedEventIdRef.current = selectedEventId;
  labelsVisibleRef.current = labelsVisible;
  selectedSessionIdRef.current = selectedSessionId;
  hiddenKindsRef.current = hiddenKinds;

  const resetGraphView = useCallback((data?: GraphData) => {
    const d = data ?? dataRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !d) {
      transformRef.current = { x: 0, y: 0, k: 1 };
      return;
    }
    sizeCanvasToContainer(canvas, container);
    const canvasRect = canvas.getBoundingClientRect();
    const viewport: GraphViewportSize = { width: canvasRect.width, height: canvasRect.height };
    transformRef.current = computeResetViewTransform(d, viewport, graphSessionId);
  }, [graphSessionId]);

  // Build graph data
  useEffect(() => {
    const turns = graphTurns ?? (events ? buildTurnsFromEvents(events) : []);
    if (turns.length === 0) {
      dataRef.current = null;
      setInputAxisItems([]);
      dirtyRef.current = true;
      cacheDirtyRef.current = true;
      return;
    }

    const cacheKey = `${turns.length}-${turns[0]?.input?.event_id ?? 'none'}-${turns[turns.length - 1]?.output?.event_id ?? 'none'}-${childSessions?.length ?? 0}`;
    if (layoutCacheRef.current?.key === cacheKey && layoutCacheRef.current.data) {
      const cached = layoutCacheRef.current.data;
      dataRef.current = cached;
      setInputAxisItems(buildInputAxisItems(cached.nodes));
      dirtyRef.current = true;
      cacheDirtyRef.current = true;
      return;
    }

    const result = buildGraphFromTurns(turns, childSessions, undefined, undefined, graphSessionId);
    const newData: GraphData = {
      nodes: result.nodes,
      links: result.links,
      nodeMap: result.nodeMap,
      adjacencyMap: result.adjacencyMap,
      spindles: result.spindles,
    };

    layoutCacheRef.current = { key: cacheKey, data: newData };

    resetGraphView(newData);

    dataRef.current = newData;
    setInputAxisItems(buildInputAxisItems(newData.nodes));

    // Extract visible kinds for legend
    const kinds = extractVisibleKinds(newData.nodes);
    setVisibleKinds(kinds);

    dirtyRef.current = true;
    cacheDirtyRef.current = true;
  }, [graphTurns, events, childSessions, graphSessionId, resetGraphView]);

  // Invalidate cache on selection change & animate to selected node
  useEffect(() => {
    cacheDirtyRef.current = true;
    dirtyRef.current = true;

    if (!dataRef.current || !canvasRef.current) return;

    // Center on the explicitly selected event.
    // In focus mode, graphSessionId === selectedSessionId, so selecting a sub-agent
    // triggers the data-build effect's resetGraphView (which centers to the new
    // session's first input), not this effect.
    let node: GraphNode | undefined;
    if (selectedEventId) {
      node = dataRef.current.nodes.find((n) => n.eventId === selectedEventId);
    }
    if (!node) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const t = transformRef.current;

    // Target transform: center the node in the canvas
    const targetX = rect.width / 2 - node.x * t.k;
    const targetY = rect.height / 2 - node.y * t.k;

    // Skip animation if already roughly centered (within 30px)
    const dx = Math.abs(t.x - targetX);
    const dy = Math.abs(t.y - targetY);
    if (dx < 30 && dy < 30) return;

    const startX = t.x;
    const startY = t.y;
    const startTime = performance.now();
    const duration = 300;

    function lerp(a: number, b: number, t: number): number {
      return a + (b - a) * t;
    }

    function easeOutCubic(t: number): number {
      return 1 - Math.pow(1 - t, 3);
    }

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = easeOutCubic(progress);

      transformRef.current = {
        x: lerp(startX, targetX, ease),
        y: lerp(startY, targetY, ease),
        k: t.k,
      };
      dirtyRef.current = true;

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    }

    requestAnimationFrame(animate);
  }, [selectedEventId]);

  // Labels don't need cache rebuild, just repaint
  useEffect(() => {
    dirtyRef.current = true;
  }, [labelsVisible]);

  // Reset filter state when session changes
  useEffect(() => {
    setHiddenKinds(new Set());
  }, [graphSessionId]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const data = dataRef.current;
    if (!canvas || !data) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const t = transformRef.current;
    const hoveredNodeId = hoveredNodeIdRef.current;
    const jumpHighlightedNodeId = jumpHighlightedNodeIdRef.current;
    const selectedNodeId = selectedEventIdRef.current;
    const labelsVisible = labelsVisibleRef.current;
    const selectedSessionId = selectedSessionIdRef.current;
    const hiddenKinds = hiddenKindsRef.current;

    const viewport: ViewportBounds = {
      x: -t.x / t.k,
      y: -t.y / t.k,
      w: rect.width / t.k,
      h: rect.height / t.k,
    };

    // Compute highlight set: event-based takes priority, then session-based
    let highlightIds: Set<string> | null = null;
    if (selectedNodeId) {
      highlightIds = new Set([selectedNodeId]);
      const adj = data.adjacencyMap.get(selectedNodeId);
      if (adj) for (const id of adj) highlightIds.add(id);
    } else if (selectedSessionId) {
      highlightIds = new Set<string>();
      for (const node of data.nodes) {
        if (node.sessionId === selectedSessionId) {
          highlightIds.add(node.id);
        }
      }
    }

    // LOD mode: skip cache, render directly with culling
    if (t.k < 0.3) {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const state: RenderState = {
        transform: t,
        hoveredNodeId: hoveredNodeId ?? jumpHighlightedNodeId,
        selectedNodeId,
        labelsVisible,
      };
      renderLODLayer(ctx, data, state, rect.width, rect.height, viewport, highlightIds, hiddenKinds);
      return;
    }

    // Normal zoom: use offscreen cache
    const dpr = window.devicePixelRatio || 1;
    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement("canvas");
    }
    const offscreen = offscreenCanvasRef.current;

    // Rebuild cache if dirty
    if (cacheDirtyRef.current) {
      const bounds = graphBounds(data);
      cacheBoundsRef.current = { minX: bounds.minX, minY: bounds.minY };
      const w = Math.ceil(bounds.w);
      const h = Math.ceil(bounds.h);
      offscreen.width = w * dpr;
      offscreen.height = h * dpr;

      const offCtx = offscreen.getContext("2d");
      if (offCtx) {
        offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        offCtx.clearRect(0, 0, w, h);
        offCtx.translate(-bounds.minX, -bounds.minY);
        renderStaticLayer(offCtx, data, selectedNodeId, highlightIds, hiddenKinds);
      }
      cacheDirtyRef.current = false;
    }

    // Blit cached image with current transform
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Draw background grid dots
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.15)';
    const gridSize = 30;
    const startX = Math.floor((-t.x / t.k) / gridSize) * gridSize;
    const startY = Math.floor((-t.y / t.k) / gridSize) * gridSize;
    const endX = startX + rect.width / t.k + gridSize;
    const endY = startY + rect.height / t.k + gridSize;
    for (let x = startX; x < endX; x += gridSize) {
      for (let y = startY; y < endY; y += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);
    const cb = cacheBoundsRef.current;
    ctx.drawImage(offscreen, 0, 0, offscreen.width, offscreen.height, cb.minX, cb.minY, offscreen.width / dpr, offscreen.height / dpr);
    ctx.restore();

    // Labels rendered directly on main canvas for crisp text
    renderLabels(ctx, data, t, selectedNodeId, hoveredNodeId, labelsVisible, viewport, highlightIds, hiddenKinds);

    // Dynamic hover overlay
    renderDynamicOverlay(ctx, data, t, hoveredNodeId ?? jumpHighlightedNodeId, hiddenKinds);
  }, []);

  useEffect(() => {
    let rafId = 0;
    const minFrameMs = 16; // ~60fps cap
    let lastFrameTime = 0;

    const tick = (now: number) => {
      if (dirtyRef.current && now - lastFrameTime >= minFrameMs) {
        dirtyRef.current = false;
        lastFrameTime = now;
        draw();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [draw]);

  useEffect(() => {
    return () => {
      if (jumpHighlightTimerRef.current !== null) {
        window.clearTimeout(jumpHighlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function getViewport(): ViewportBounds | undefined {
      const rect = canvas?.getBoundingClientRect();
      if (!rect) return undefined;
      const t = transformRef.current;
      return {
        x: -t.x / t.k,
        y: -t.y / t.k,
        w: rect.width / t.k,
        h: rect.height / t.k,
      };
    }

    return createInteractionHandlers(
      canvas,
      () => transformRef.current,
      (t) => {
        transformRef.current = t;
        dirtyRef.current = true;
      },
      (mx, my) => {
        const data = dataRef.current;
        if (!data) return;
        const node = hitTest(data.nodes, mx, my, transformRef.current, getViewport());
        const newId = node?.id ?? null;
        if (hoveredNodeIdRef.current !== newId) {
          hoveredNodeIdRef.current = newId;
          dirtyRef.current = true;
        }
        // Update tooltip state when hovering
        if (node) {
          setTooltipNode({ node, x: mx, y: my });
        } else {
          setTooltipNode(null);
        }
        canvas.style.cursor = node ? "pointer" : "grab";
      },
      (mx, my) => {
        const data = dataRef.current;
        if (!data) return;
        const node = hitTest(data.nodes, mx, my, transformRef.current, getViewport());
        // Clear tooltip on click
        setTooltipNode(null);
        if (node) {
          // Synthesized markers (no real spawn event) carry an eventId of
          // the form "synth:<sessionId>". Don't propagate that as a
          // selectedEventId — it isn't a real event. The sessionId drives
          // reverse-sync (fetchDetail) which is what we actually want.
          const eventId = node.eventId?.startsWith("synth:") ? null : node.eventId;
          onNodeClick(eventId, node.sessionId, node.parentSessionId);
        } else {
          // Click on blank area: clear event selection, revert to session dimming
          onNodeClick(null);
        }
      },
      () => {
        setTooltipNode(null);
        hoveredNodeIdRef.current = null;
        dirtyRef.current = true;
      },
      resetGraphView,
    );
  }, [onNodeClick, resetGraphView]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const obs = new ResizeObserver(() => {
      sizeCanvasToContainer(canvas, container);
      dirtyRef.current = true;
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  const resetView = useCallback(() => {
    resetGraphView();
    dirtyRef.current = true;
  }, [resetGraphView]);

  const toggleLabels = useCallback(() => {
    setLabelsVisible((v) => !v);
  }, []);

  const toggleKind = useCallback((kind: string) => {
    setHiddenKinds(prev => {
      const next = new Set(prev);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
    cacheDirtyRef.current = true;
    dirtyRef.current = true;
  }, []);

  const jumpToInputNode = useCallback((node: GraphNode) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (jumpHighlightTimerRef.current !== null) {
      window.clearTimeout(jumpHighlightTimerRef.current);
    }
    const rect = canvas.getBoundingClientRect();
    transformRef.current = centerGraphNodeInViewport(
      node,
      { width: rect.width, height: rect.height },
      transformRef.current,
    );
    hoveredNodeIdRef.current = null;
    jumpHighlightedNodeIdRef.current = node.id;
    setTooltipNode(null);
    dirtyRef.current = true;
    jumpHighlightTimerRef.current = window.setTimeout(() => {
      if (jumpHighlightedNodeIdRef.current === node.id) {
        jumpHighlightedNodeIdRef.current = null;
        dirtyRef.current = true;
      }
      jumpHighlightTimerRef.current = null;
    }, 900);
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0"
        style={{ cursor: "grab" }}
      />

      <div className="pointer-events-none absolute inset-0">
        <GraphInputAxis items={inputAxisItems} onJump={jumpToInputNode} />
        {tooltipNode && (
          <GraphTooltip
            node={tooltipNode.node}
            x={tooltipNode.x}
            y={tooltipNode.y}
            viewportWidth={containerRef.current?.clientWidth ?? 800}
            viewportHeight={containerRef.current?.clientHeight ?? 600}
          />
        )}
        <GraphCanvasControls
          labelsVisible={labelsVisible}
          onResetView={resetView}
          onToggleLabels={toggleLabels}
          visibleKinds={visibleKinds}
          hiddenKinds={hiddenKinds}
          onToggleKind={toggleKind}
        />
      </div>
    </div>
  );
}
