import { useEffect, useRef, useCallback, useState } from "react";
import { useSessionStore } from "../../stores/session";
import { SessionCard } from "./SessionCard";
import { EmptyState } from "../shared/EmptyState";
import { SkeletonLines } from "../shared/SkeletonLines";

interface SessionListProps {
  onSessionSelect: (sessionId: string) => void;
  emptyAction?: React.ReactNode;
  filterText?: string;
  sortBy?: string;
}

export function SessionList({ onSessionSelect, emptyAction }: SessionListProps) {
  const { sessions, loading, selectedIds, toggleSelect, selectionMode } = useSessionStore();
  const activeId = useSessionStore((s) => s.activeSessionId);

  // Sliding indicator state
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const setCardRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  // Measure indicator position after paint to avoid blocking the animation start
  useEffect(() => {
    if (!activeId) { setIndicator(null); return; }
    const raf = requestAnimationFrame(() => {
      const el = cardRefs.current.get(activeId);
      if (el) setIndicator({ top: el.offsetTop, height: el.offsetHeight });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeId, sessions]);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="relative flex-1 overflow-y-auto p-3 space-y-0.5">
        {/* Sliding indicator */}
        {indicator && (
          <div
            className="absolute left-3 right-3 rounded-lg bg-primary shadow-md pointer-events-none z-0 transition-all duration-500"
            style={{
              top: indicator.top,
              height: indicator.height,
              transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          />
        )}
        {loading && sessions.length === 0 ? (
          <SkeletonLines count={3} />
        ) : sessions.length === 0 ? (
          <EmptyState
            title="No sessions"
            description="Import files to create sessions"
            action={emptyAction}
          />
        ) : (
          sessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              isActive={s.id === activeId}
              selected={selectedIds.has(s.id)}
              selectionMode={selectionMode}
              onClick={() => onSessionSelect(s.id)}
              onToggleSelect={() => toggleSelect(s.id)}
              cardRef={(el) => setCardRef(s.id, el)}
            />
          ))
        )}
      </div>
    </div>
  );
}
