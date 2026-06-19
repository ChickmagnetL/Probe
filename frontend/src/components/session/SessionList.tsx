import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useSessionStore } from "../../stores/session";
import { SessionCard } from "./SessionCard";
import { ProjectGroup } from "./ProjectGroup";
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

const UNKNOWN_GROUP_KEY = "__unknown__";
const UNKNOWN_GROUP_NAME = "Unknown";

function groupKeyFor(session: SessionRow): string {
  return session.cwd ?? UNKNOWN_GROUP_KEY;
}

function groupNameFor(key: string): string {
  if (key === UNKNOWN_GROUP_KEY) return UNKNOWN_GROUP_NAME;
  // Basename of the cwd path. Handle both POSIX and Windows separators.
  const parts = key.split(/[/\\]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : UNKNOWN_GROUP_NAME;
}

interface ProjectGroupData {
  key: string;
  name: string;
  fullPath: string | null;
  roots: TreeItem[];
  latestStart: string;
  totalSessions: number;
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

  // Collapsed project groups — local state, default all expanded.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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

    // Sort children within each parent by start_time (newest first).
    for (const children of childrenByParent.values()) {
      children.sort((a, b) => {
        const at = a.start_time ?? "";
        const bt = b.start_time ?? "";
        return bt.localeCompare(at);
      });
    }

    // Root sessions: newest first.
    roots.sort((a, b) => {
      const at = a.start_time ?? "";
      const bt = b.start_time ?? "";
      return bt.localeCompare(at);
    });

    return buildTree(roots, 0);
  }, [sessions]);

  // Group root-level tree items by cwd.
  const groups = useMemo((): ProjectGroupData[] => {
    const byKey = new Map<string, TreeItem[]>();
    for (const item of tree) {
      const key = groupKeyFor(item.session);
      const list = byKey.get(key);
      if (list) list.push(item);
      else byKey.set(key, [item]);
    }
    // Root items within a group are already sorted newest-first (tree sort).
    // Build group list with latest start time per group.
    const groupList: ProjectGroupData[] = [];
    for (const [key, items] of byKey) {
      let latest = "";
      for (const item of items) {
        const t = item.session.start_time ?? "";
        if (t > latest) latest = t;
      }
      groupList.push({
        key,
        name: groupNameFor(key),
        fullPath: key === UNKNOWN_GROUP_KEY ? null : key,
        roots: items,
        latestStart: latest,
        totalSessions: items.length,
      });
    }
    // Sort groups by latest session start_time, newest first.
    groupList.sort((a, b) => b.latestStart.localeCompare(a.latestStart));
    return groupList;
  }, [tree]);

  // Flatten into visible rows respecting expanded sessions + collapsed groups.
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
    for (const group of groups) {
      const collapsed = !selectionMode && collapsedGroups.has(group.key);
      if (!collapsed) collect(group.roots);
    }
    return result;
  }, [groups, expandedSessions, collapsedGroups, selectionMode]);

  // Sliding indicator state
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const setCardRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  // Render a tree item and, if expanded, its children recursively. Children
  // stay inside the same project group as their root (subagents inherit the
  // root's cwd grouping), preserving the indented tree across group renders.
  const renderTree = useCallback((item: TreeItem) => {
    const nodes: React.ReactNode[] = [
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
      />,
    ];
    if (item.children.length > 0 && expandedSessions.has(item.session.id)) {
      for (const child of item.children) nodes.push(renderTree(child));
    }
    return nodes;
  }, [activeId, selectedIds, selectionMode, expandedSessions, toggleSelect, toggleExpand, onSessionSelect, setCardRef]);

  // Measure indicator position after paint to avoid blocking the animation start.
  // offsetTop is relative to offsetParent (the scroll container), so group
  // header DOM interleaved between cards does not invalidate the measurement.
  useEffect(() => {
    if (!activeId) { setIndicator(null); return; }
    const raf = requestAnimationFrame(() => {
      const el = cardRefs.current.get(activeId);
      // Active card may be hidden (e.g. its project group is collapsed) —
      // the card unmounts and setCardRef(null) removes it from the map.
      // Clear the indicator so it doesn't stick at the stale offset and
      // visually clip / push apart rows below. Re-expanding the group
      // re-measures and restores the indicator.
      if (el) setIndicator({ top: el.offsetTop, height: el.offsetHeight });
      else setIndicator(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [activeId, visibleItems]);

  // Content exists as long as there are project groups. Collapsed groups
  // still render their headers (so the user can re-expand), so do not gate
  // the empty state on visibleItems — that would hide every group when all
  // are folded and wrongly show "No sessions".
  const hasContent = groups.length > 0;

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
        ) : !hasContent ? (
          <EmptyState
            title="No sessions"
            description="Import files to create sessions"
            action={emptyAction}
          />
        ) : (
          groups.map((group) => {
            const collapsed = !selectionMode && collapsedGroups.has(group.key);
            // In selection mode: hide group header so the multi-select surface
            // stays flat (consistent with how subagent expand arrows hide),
            // and ignore per-group collapse so every session stays reachable
            // for batch select / delete (no "lost" rows behind a folded group).
            return (
              <div key={group.key}>
                {!selectionMode && (
                  <ProjectGroup
                    name={group.name}
                    fullPath={group.fullPath}
                    collapsed={collapsedGroups.has(group.key)}
                    count={group.totalSessions}
                    onToggle={() => toggleGroup(group.key)}
                  />
                )}
                {!collapsed && group.roots.flatMap((item) => renderTree(item))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
