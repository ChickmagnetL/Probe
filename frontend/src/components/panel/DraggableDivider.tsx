import { useCallback, useRef } from "react";
import { usePanelStore } from "../../stores/panel";

interface DraggableDividerProps {
  parentSplitId: string;
  firstChildIdx: number;
  direction: "horizontal" | "vertical";
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function DraggableDivider({
  parentSplitId,
  firstChildIdx,
  direction,
  onDragStart,
  onDragEnd,
}: DraggableDividerProps) {
  const setSplitRatio = usePanelStore((s) => s.setSplitRatio);
  const dragRef = useRef<{
    startPos: number;
    startRatios: number[];
    containerSize: number;
  } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const divider = e.currentTarget as HTMLElement;
      const splitEl = divider.parentElement as HTMLElement | null;
      if (!splitEl) return;

      // Get the current split ratios from the store
      const state = usePanelStore.getState();
      const root = state.root;
      let ratios: number[] | null = null;

      function findSplitRatios(n: { type: string; id: string; ratios?: number[]; children?: unknown[] }): void {
        if (ratios) return;
        if (n.type === "split" && n.id === parentSplitId && n.ratios) {
          ratios = n.ratios;
          return;
        }
        if (n.type === "split" && n.children) {
          n.children.forEach((c) => findSplitRatios(c as { type: string; id: string; ratios?: number[]; children?: unknown[] }));
        }
      }
      findSplitRatios(root as { type: string; id: string; ratios?: number[]; children?: unknown[] });

      if (!ratios) return;

      const containerSize =
        direction === "horizontal" ? splitEl.offsetWidth : splitEl.offsetHeight;
      const startPos = direction === "horizontal" ? e.clientX : e.clientY;

      dragRef.current = {
        startPos,
        startRatios: [...ratios],
        containerSize,
      };

      document.body.style.cursor =
        direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";

      onDragStart?.();

      function onMouseMove(ev: MouseEvent) {
        if (!dragRef.current) return;
        const { startPos: sp, startRatios: sr, containerSize: size } = dragRef.current;
        const currentPos = direction === "horizontal" ? ev.clientX : ev.clientY;
        const delta = currentPos - sp;
        const deltaRatio = delta / size;

        const adjacentSum = sr[firstChildIdx] + sr[firstChildIdx + 1];
        const minRatio = 120 / size;
        let newRatio = sr[firstChildIdx] + deltaRatio;
        newRatio = Math.max(minRatio, Math.min(adjacentSum - minRatio, newRatio));

        setSplitRatio(parentSplitId, firstChildIdx, newRatio);
      }

      function onMouseUp() {
        dragRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        onDragEnd?.();
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [parentSplitId, firstChildIdx, direction, setSplitRatio, onDragStart, onDragEnd],
  );

  const isHorizontal = direction === "horizontal";

  return (
    <div
      className="flex-shrink-0 relative z-[25] group"
      style={{
        width: isHorizontal ? 6 : undefined,
        height: isHorizontal ? undefined : 6,
        cursor: isHorizontal ? "col-resize" : "row-resize",
        margin: isHorizontal ? "0 -3px" : "-3px 0",
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Hover / drag indicator */}
      <div
        className="absolute rounded-sm opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          background: "rgba(37, 99, 235, 0.08)",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />
      {/* Center indicator line */}
      <div
        className="absolute rounded-sm opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          background: "#2563EB",
          ...(isHorizontal
            ? {
                width: 2,
                height: 24,
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
              }
            : {
                height: 2,
                width: 24,
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
              }),
        }}
      />
    </div>
  );
}
