import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useSessionStore } from "../../stores/session";
import { SessionCard } from "./SessionCard";
import { ProjectFolder } from "./ProjectFolder";
import { DateBucket } from "./DateBucket";
import { EmptyState } from "../shared/EmptyState";
import { SkeletonLines } from "../shared/SkeletonLines";
import { formatRelative } from "../../lib/format";
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

// Date bucket order (newest first). Sessions fall into the first matching
// bucket based on their start_time vs the current calendar day. "本周" uses a
// rolling 7-day window excluding 今天/昨天 — simple and intuitive enough.
type BucketKey = "today" | "yesterday" | "this_week" | "older";
const BUCKET_ORDER: BucketKey[] = ["today", "yesterday", "this_week", "older"];
const BUCKET_LABELS: Record<BucketKey, string> = {
  today: "今天",
  yesterday: "昨天",
  this_week: "本周",
  older: "更早",
};

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function bucketFor(startIso: string | null, now: Date): BucketKey {
  if (!startIso) return "older";
  const then = new Date(startIso).getTime();
  if (Number.isNaN(then)) return "older";
  const todayStart = startOfDay(now);
  const dayMs = 86_400_000;
  if (then >= todayStart) return "today";
  if (then >= todayStart - dayMs) return "yesterday";
  if (then >= todayStart - 7 * dayMs) return "this_week";
  return "older";
}

function groupKeyFor(session: SessionRow): string {
  return session.cwd ?? UNKNOWN_GROUP_KEY;
}

function groupNameFor(key: string): string {
  if (key === UNKNOWN_GROUP_KEY) return UNKNOWN_GROUP_NAME;
  // Basename of the cwd path. Handle both POSIX and Windows separators.
  const parts = key.split(/[/\\]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : UNKNOWN_GROUP_NAME;
}

interface BucketData {
  key: BucketKey;
  label: string;
  roots: TreeItem[];
}

interface ProjectGroupData {
  key: string;
  name: string;
  fullPath: string | null;
  buckets: BucketData[];
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
  const setExpanded = useSessionStore((s) => s.setExpanded);

  // Expanded project folders — local state, default empty = all collapsed.
  // Using an "expanded" set (not "collapsed") so data-driven project keys
  // default to collapsed without needing to know them ahead of time.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // Expanded date buckets, keyed by `${cwdKey}::${bucketKey}`. Default empty.
  const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(new Set());

  // Find the first non-empty bucket key for a group (BUCKET_ORDER is newest
  // first), or null if the group has no buckets.
  const firstNonEmptyBucket = useCallback((group: ProjectGroupData): BucketKey | null => {
    for (const bucket of group.buckets) {
      if (bucket.roots.length > 0) return bucket.key;
    }
    return null;
  }, []);

  const toggleGroup = useCallback((group: ProjectGroupData) => {
    const isCurrentlyExpanded = expandedGroups.has(group.key);
    setExpandedGroups((prevExpanded) => {
      const nextExpanded = new Set(prevExpanded);
      if (isCurrentlyExpanded) nextExpanded.delete(group.key);
      else nextExpanded.add(group.key);
      return nextExpanded;
    });
    setExpandedBuckets((prevBuckets) => {
      const nextBuckets = new Set(prevBuckets);
      const prefix = `${group.key}::`;
      if (isCurrentlyExpanded) {
        // Collapsing: clear this group's bucket entries to avoid stale residue.
        for (const k of nextBuckets) {
          if (k.startsWith(prefix)) nextBuckets.delete(k);
        }
      } else {
        // Expanding: auto-expand the first non-empty bucket so the most
        // recent date bucket is immediately visible.
        const firstBucket = firstNonEmptyBucket(group);
        if (firstBucket) nextBuckets.add(`${prefix}${firstBucket}`);
      }
      return nextBuckets;
    });
  }, [expandedGroups, firstNonEmptyBucket]);

  const toggleBucket = useCallback((bucketKey: string) => {
    setExpandedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(bucketKey)) next.delete(bucketKey);
      else next.add(bucketKey);
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

  // Group root-level tree items by cwd, then split each group into date buckets.
  const groups = useMemo((): ProjectGroupData[] => {
    const now = new Date();
    const byKey = new Map<string, TreeItem[]>();
    for (const item of tree) {
      const key = groupKeyFor(item.session);
      const list = byKey.get(key);
      if (list) list.push(item);
      else byKey.set(key, [item]);
    }

    const groupList: ProjectGroupData[] = [];
    for (const [key, items] of byKey) {
      let latest = "";
      const byBucket = new Map<BucketKey, TreeItem[]>();
      for (const item of items) {
        const t = item.session.start_time ?? "";
        if (t > latest) latest = t;
        const bk = bucketFor(item.session.start_time, now);
        const list = byBucket.get(bk);
        if (list) list.push(item);
        else byBucket.set(bk, [item]);
      }

      const buckets: BucketData[] = [];
      for (const bk of BUCKET_ORDER) {
        const roots = byBucket.get(bk);
        if (roots && roots.length > 0) {
          // roots are already sorted newest-first (from tree sort).
          buckets.push({ key: bk, label: BUCKET_LABELS[bk], roots });
        }
      }

      groupList.push({
        key,
        name: groupNameFor(key),
        fullPath: key === UNKNOWN_GROUP_KEY ? null : key,
        buckets,
        latestStart: latest,
        totalSessions: items.length,
      });
    }
    // Sort groups by latest session start_time, newest first.
    groupList.sort((a, b) => b.latestStart.localeCompare(a.latestStart));
    return groupList;
  }, [tree]);

  // Flatten into visible rows (used only for indicator re-measure triggers).
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
    if (selectionMode) {
      for (const group of groups) collect(group.buckets.flatMap((b) => b.roots));
      return result;
    }
    for (const group of groups) {
      if (!expandedGroups.has(group.key)) continue;
      for (const bucket of group.buckets) {
        const bkey = `${group.key}::${bucket.key}`;
        if (!expandedBuckets.has(bkey)) continue;
        collect(bucket.roots);
      }
    }
    return result;
  }, [groups, expandedSessions, expandedGroups, expandedBuckets, selectionMode]);

  // Sliding indicator state — positioned via getBoundingClientRect relative
  // to the scroll container, which stays robust across the 3-level nesting
  // (project folder + date bucket headers + session card). offsetTop would
  // break if any intermediate container gained `position: relative`.
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stable, id-agnostic callback used as the SessionCard ref. Renamed from
  // setCardRef → registerCardRef to match the card's new prop contract; the
  // card resolves its own session.id so callers never pre-bind inline arrows
  // (those would break SessionCard's memo by changing identity every render).
  const registerCardRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  // Render a tree item plus its subagent children. Children are rendered
  // conditionally (mounted when expanded, unmounted when collapsed) — no
  // transition, instant show/hide.
  //
  // All callbacks handed to SessionCard are stable references (store actions
  // or useCallback'd helpers). The card branches on its own session.id and
  // click context, so this render fn must NOT wrap them in inline arrows —
  // doing so would re-create the prop every render and defeat SessionCard's
  // memo, forcing every visible card to re-render on expand/collapse.
  const renderTree = useCallback((item: TreeItem): React.ReactNode => {
    const isActive = item.session.id === activeId;
    const hasChildren = item.children.length > 0;
    const isOpen = expandedSessions.has(item.session.id);
    return [
      <SessionCard
        key={item.session.id}
        session={item.session}
        isActive={isActive}
        selected={selectedIds.has(item.session.id)}
        selectionMode={selectionMode}
        onSelect={onSessionSelect}
        onToggleSelect={toggleSelect}
        onSetExpanded={setExpanded}
        registerCardRef={registerCardRef}
        depth={item.depth}
        hasChildren={hasChildren}
        isExpanded={isOpen}
      />,
      hasChildren && isOpen
        ? item.children.map((child) => renderTree(child))
        : null,
    ];
  }, [activeId, selectedIds, selectionMode, expandedSessions, toggleSelect, setExpanded, onSessionSelect, registerCardRef]);

  // Measure indicator after paint. When the active card is hidden — either
  // because its project folder / date bucket is collapsed (card unmounts,
  // ref disappears) or because it lives inside a collapsed subagent block
  // (card unmounts, ref disappears) — clear the indicator. Expanding the
  // block re-mounts the card and this effect re-runs (visibleItems depends
  // on expandedSessions) to restore the indicator at the correct offset.
  useEffect(() => {
    if (!activeId) { setIndicator(null); return; }
    const raf = requestAnimationFrame(() => {
      const el = cardRefs.current.get(activeId);
      const scroll = scrollRef.current;
      if (!el || !scroll) { setIndicator(null); return; }
      if (el.offsetHeight === 0) { setIndicator(null); return; }
      const elRect = el.getBoundingClientRect();
      if (elRect.height === 0) { setIndicator(null); return; }
      const scrollRect = scroll.getBoundingClientRect();
      setIndicator({
        top: elRect.top - scrollRect.top + scroll.scrollTop,
        height: el.offsetHeight,
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeId, visibleItems]);

  // Content exists as long as there are project groups. Collapsed groups
  // still render their folder headers, so do not gate the empty state on
  // visibleItems — otherwise folding every group would wrongly show "No
  // sessions".
  const hasContent = groups.length > 0;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto p-3 space-y-0.5">
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
            const collapsed = !selectionMode && !expandedGroups.has(group.key);
            // In selection mode: hide project/bucket headers so the
            // multi-select surface stays flat (consistent with how subagent
            // expand arrows hide), and ignore collapse so every session stays
            // reachable for batch select / delete.
            return (
              <div key={group.key}>
                {!selectionMode && (
                  <ProjectFolder
                    name={group.name}
                    fullPath={group.fullPath}
                    collapsed={collapsed}
                    count={group.totalSessions}
                    latestRelative={group.latestStart ? formatRelative(group.latestStart) : null}
                    onToggle={() => toggleGroup(group)}
                  />
                )}
                {!collapsed && (
                  <div className="ml-3.5 pl-3.5 border-l border-dashed border-border">
                    {group.buckets.map((bucket) => {
                      const bkey = `${group.key}::${bucket.key}`;
                      const bucketCollapsed = !selectionMode && !expandedBuckets.has(bkey);
                      return (
                        <div key={bkey}>
                          {!selectionMode && (
                            <DateBucket
                              label={bucket.label}
                              collapsed={bucketCollapsed}
                              count={bucket.roots.length}
                              onToggle={() => toggleBucket(bkey)}
                            />
                          )}
                          {!bucketCollapsed && bucket.roots.flatMap((item) => renderTree(item))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
