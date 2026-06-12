import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useSessionStore } from "../../stores/session";
import { SessionCard } from "./SessionCard";
import { EmptyState } from "../shared/EmptyState";
import { SkeletonLines } from "../shared/SkeletonLines";
import type { SessionRow } from "../../ipc/types";

interface TreeItem {
  session: SessionRow;
  children: TreeItem[];
  depth: number;
}

interface SessionListProps {
  onSessionSelect: (sessionId: string) => void;
  emptyAction?: React.ReactNode;
  filterText?: string;
  sortBy?: string;
}

export function SessionList({ onSessionSelect, emptyAction }: SessionListProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const loading = useSessionStore((s) => s.loading);
  const selectedIds = useSessionStore((s) => s.selectedIds);
  const toggleSelect = useSessionStore((s) => s.toggleSelect);
  const selectionMode = useSessionStore((s) => s.selectionMode);
  const activeId = useSessionStore((s) => s.activeSessionId);
  const expandedSessions = useSessionStore((s) => s.expandedSessions);
  const toggleExpand = useSessionStore((s) => s.toggleExpand);

  // Build tree: root sessions (non-subagent) + group children by parent_session_id
  const tree = useMemo((): TreeItem[] => {
    const childrenByParent = new Map<string, SessionRow[]>();
    const roots: SessionRow[] = [];

    for (const s of sessions) {
      if (s.parent_session_id) {
        const list = childrenByParent.get(s.parent_session_id);
        if (list) list.push(s);
        else childrenByParent.set(s.parent_session_id, [s]);
      } else {
        roots.push(s);
      }
    }

    function buildTree(parentSessions: SessionRow[], depth: number): TreeItem[] {
      return parentSessions.map((session) => ({
        session,
        depth,
        children: buildTree(childrenByParent.get(session.id) ?? [], depth + 1),
      }));
    }

    // Sort children within each parent by start_time
    for (const children of childrenByParent.values()) {
      children.sort((a, b) => {
        const at = a.start_time ?? "";
        const bt = b.start_time ?? "";
        return at.localeCompare(bt);
      });
    }

    return buildTree(roots, 0);
  }, [sessions]);

  // Flatten tree into visible rows based on expanded state
  const visibleItems = useMemo((): TreeItem[] => {
    const result: TreeItem[] = [];
    function collect(items: TreeItem[]) {
      for (const item of items) {
        result.push(item);
        if (item.children.length > 0 && expandedSessions.has(item.session.id)) {
          collect(item.children);
        }
      }
    }
    collect(tree);
    return result;
  }, [tree, expandedSessions]);

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
  }, [activeId, visibleItems]);

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
        ) : visibleItems.length === 0 ? (
          <EmptyState
            title="No sessions"
            description="Import files to create sessions"
            action={emptyAction}
          />
        ) : (
          visibleItems.map((item) => (
            <SessionCard
              key={item.session.id}
              session={item.session}
              isActive={item.session.id === activeId}
              selected={selectedIds.has(item.session.id)}
              selectionMode={selectionMode}
              onClick={() => onSessionSelect(item.session.id)}
              onToggleSelect={() => toggleSelect(item.session.id)}
              cardRef={(el) => setCardRef(item.session.id, el)}
              depth={item.depth}
              hasChildren={item.children.length > 0}
              isExpanded={expandedSessions.has(item.session.id)}
              onToggleExpand={() => toggleExpand(item.session.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
