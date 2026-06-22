import { useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import type { GraphNode } from "./graph-layout";
import {
  inputAxisIndexFromRelativeY,
  type InputAxisItem,
  VISIBLE_WINDOW_SIZE,
  buildVisibleInputAxisItems,
  centerInputAxisWindow,
} from "./graph-input-axis";

interface GraphInputAxisProps {
  items: InputAxisItem[];
  onJump: (node: GraphNode) => void;
}

export function GraphInputAxis({ items, onJump }: GraphInputAxisProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [dragTooltipNodeId, setDragTooltipNodeId] = useState<string | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startIndex, setStartIndex] = useState(0);
  const activeTimerRef = useRef<number | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragNodeIdRef = useRef<string | null>(null);
  const suppressNextClickRef = useRef(false);
  const dragMovedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (activeTimerRef.current !== null) {
        window.clearTimeout(activeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setStartIndex(0);
  }, [items]);

  const visibleItems = buildVisibleInputAxisItems(items, startIndex, VISIBLE_WINDOW_SIZE);

  if (items.length === 0) return null;

  function clearActiveTimer() {
    if (activeTimerRef.current !== null) {
      window.clearTimeout(activeTimerRef.current);
      activeTimerRef.current = null;
    }
  }

  function scheduleActiveClear(nodeId: string) {
    activeTimerRef.current = window.setTimeout(() => {
      setActiveNodeId((current) => current === nodeId ? null : current);
      activeTimerRef.current = null;
    }, 520);
  }

  function activateNode(node: GraphNode) {
    clearActiveTimer();
    setActiveNodeId(node.id);
    onJump(node);
    scheduleActiveClear(node.id);
  }

  function updateDragSelection(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const actualIndex = inputAxisIndexFromRelativeY(
      event.clientY - rect.top,
      rect.height,
      items.length,
    );
    if (actualIndex === null) return;

    const item = items[actualIndex];
    if (!item || dragNodeIdRef.current === item.node.id) return;

    const newStartIndex = centerInputAxisWindow(
      actualIndex,
      items.length,
      VISIBLE_WINDOW_SIZE,
    );
    if (newStartIndex !== startIndex) {
      setStartIndex(newStartIndex);
    }

    clearActiveTimer();
    dragNodeIdRef.current = item.node.id;
    setDragTooltipNodeId(item.node.id);
    setActiveNodeId(item.node.id);
    onJump(item.node);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();

    dragPointerIdRef.current = event.pointerId;
    dragNodeIdRef.current = null;
    dragMovedRef.current = false;
    suppressNextClickRef.current = false;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragPointerIdRef.current !== event.pointerId) return;
    event.stopPropagation();
    event.preventDefault();
    dragMovedRef.current = true;
    updateDragSelection(event);
  }

  function finishPointerDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragPointerIdRef.current !== event.pointerId) return;
    event.stopPropagation();

    const selectedNodeId = dragNodeIdRef.current;
    const moved = dragMovedRef.current;
    dragPointerIdRef.current = null;
    dragNodeIdRef.current = null;
    setIsDragging(false);
    setDragTooltipNodeId(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    suppressNextClickRef.current = moved;
    if (selectedNodeId) {
      clearActiveTimer();
      scheduleActiveClear(selectedNodeId);
    }
  }

  function handleAxisClick(event: MouseEvent<HTMLButtonElement>, node: GraphNode) {
    event.stopPropagation();
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    activateNode(node);
  }

  const tooltipNodeId = dragTooltipNodeId ?? hoveredNodeId;
  const visibleTooltipIndex = tooltipNodeId === null
    ? -1
    : visibleItems.findIndex((item) => item.node.id === tooltipNodeId);
  const tooltipItem = visibleTooltipIndex === -1 ? null : visibleItems[visibleTooltipIndex];
  const tooltipTop = visibleTooltipIndex === -1
    ? "50%"
    : visibleItems.length === 1 ? "50%" : `${(visibleTooltipIndex / (visibleItems.length - 1)) * 100}%`;

  return (
    <div
      className="pointer-events-auto absolute left-6 top-16 bottom-24 z-40 w-6 select-none"
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
    >
      <div className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-slate-500/20" />
      {visibleItems.map((item, i) => {
        const globalIndex = startIndex + i;
        const isActive = activeNodeId === item.node.id;
        const feedbackTransitionClass = isDragging
          ? ""
          : "transition-[opacity,box-shadow,background-color] duration-150";
        const hoverFeedbackClass = isDragging
          ? ""
          : "group-hover:bg-primary/70 group-hover:opacity-100 group-hover:shadow-[0_0_0_4px_rgba(37,99,235,0.18),0_0_14px_rgba(37,99,235,0.45)]";
        const dotFeedbackClass = isActive
          ? "graph-input-axis-selected bg-primary/75 opacity-100 shadow-[0_0_0_5px_rgba(37,99,235,0.2),0_0_18px_rgba(37,99,235,0.5)]"
          : `bg-slate-600/35 opacity-60 shadow-[0_0_0_1px_rgba(255,255,255,0.55)] ${hoverFeedbackClass}`;
        const top = visibleItems.length === 1 ? "50%" : `${(i / (visibleItems.length - 1)) * 100}%`;

        return (
          <div
            key={item.node.id}
            className="absolute left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2"
            style={{ top }}
          >
            <button
              type="button"
              aria-label={`Jump to user input ${globalIndex + 1}`}
              className="group pointer-events-auto relative block h-4 w-4 appearance-none rounded-full border-0 bg-transparent p-0 leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              onClick={(event) => handleAxisClick(event, item.node)}
              onMouseEnter={() => setHoveredNodeId(item.node.id)}
              onMouseLeave={() => setHoveredNodeId(null)}
              onFocus={() => setHoveredNodeId(item.node.id)}
              onBlur={() => setHoveredNodeId(null)}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 rounded-full ${feedbackTransitionClass} ${dotFeedbackClass}`}
              />
              {isActive && (
                <span
                  aria-hidden="true"
                  className="graph-input-axis-ripple pointer-events-none absolute left-1/2 top-1/2 h-8 w-8 rounded-full bg-primary/25"
                />
              )}
            </button>
          </div>
        );
      })}
      {tooltipItem?.tooltipText && (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-7 z-50 w-64 max-w-[calc(100vw-5rem)] -translate-y-1/2 rounded-md bg-slate-950/85 px-2.5 py-1.5 text-xs leading-snug text-white shadow-lg backdrop-blur-sm"
          style={{ top: tooltipTop }}
        >
          <span className="block max-h-24 overflow-hidden whitespace-pre-wrap break-words">
            {tooltipItem.tooltipText}
          </span>
        </div>
      )}
    </div>
  );
}
