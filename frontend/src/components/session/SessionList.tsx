import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
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

// Date bucket order (newest first). Sessions fall into the first matching
// bucket based on their start_time vs the current calendar day. "This Week" uses a
// rolling 7-day window excluding Today/Yesterday.
type BucketKey = "today" | "yesterday" | "this_week" | "older";
const BUCKET_ORDER: BucketKey[] = ["today", "yesterday", "this_week", "older"];

function useBucketLabels(): Record<BucketKey, string> {
  const { t } = useTranslation();
  return {
    today: t("session.today"),
    yesterday: t("session.yesterday"),
    this_week: t("session.thisWeek"),
    older: t("session.older"),
  };
}

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

function groupNameFor(key: string, t: (key: string) => string): string {
  if (key === UNKNOWN_GROUP_KEY) return t("session.unknown");
  // Basename of the cwd path. Handle both POSIX and Windows separators.
  const parts = key.split(/[/\\]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : t("session.unknown");
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

export function SessionList({ onSessionSelect, emptyAction, filterText, sortBy }: SessionListProps) {
  const { t } = useTranslation();
  const bucketLabels = useBucketLabels();
  // sortBy is a "field:order" string (e.g. "start_time:asc"). Only the order
  // is consumed here — the field is fixed to start_time (session creation
  // time) everywhere, so sorting/bucketing/display share one dimension.
  const [, order = "desc"] = (sortBy ?? "start_time:desc").split(":");
  const desc = order !== "asc";
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

    // Sort sessions by their start_time (session creation time). The UI's
    // "x days ago" label also shows start_time, so sorting, bucketing, and
    // the displayed relative time all share one dimension — no mismatch.
    const valueOf = (s: SessionRow): string => s.start_time ?? "";

    // Sort children within each parent by the selected field and direction.
    for (const children of childrenByParent.values()) {
      children.sort((a, b) => {
        const at = valueOf(a);
        const bt = valueOf(b);
        return desc ? bt.localeCompare(at) : at.localeCompare(bt);
      });
    }

    // Root sessions follow the same sort.
    roots.sort((a, b) => {
      const at = valueOf(a);
      const bt = valueOf(b);
      return desc ? bt.localeCompare(at) : at.localeCompare(bt);
    });

    return buildTree(roots, 0);
  }, [sessions, sortBy, desc]);

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
        // Bucket by start_time (session creation time) — same dimension as
        // the within-bucket sort and the displayed "x days ago" label, so the
        // visible order never disagrees with the bucket placement.
        // start_time may be null; bucketFor maps null/invalid → "older".
        const iso = item.session.start_time ?? "";
        if (iso > latest) latest = iso;
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
          buckets.push({ key: bk, label: bucketLabels[bk], roots });
        }
      }

      groupList.push({
        key,
        name: groupNameFor(key, t),
        fullPath: key === UNKNOWN_GROUP_KEY ? null : key,
        buckets,
        latestStart: latest,
        totalSessions: items.length,
      });
    }
    // Sort groups by the latest sort-field value for each group, always
    // newest-first (fixed; independent of the within-bucket sort direction).
    // Tie-break on the group key (cwd path) so folders with identical
    // latestStart — common during batch imports that share one timestamp —
    // keep a stable order instead of leaking the within-bucket sort direction.
    groupList.sort((a, b) => {
      const byLatest = b.latestStart.localeCompare(a.latestStart);
      if (byLatest !== 0) return byLatest;
      return a.key.localeCompare(b.key);
    });
    return groupList;
  }, [tree, t, bucketLabels]);

  // Flatten into visible rows (used only for indicator re-measure triggers).
  // Respect project-folder and date-bucket collapse state in both normal and
  // selection mode so the list keeps the same three-level structure when the
  // user is picking sessions to delete.
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
      if (!expandedGroups.has(group.key)) continue;
      for (const bucket of group.buckets) {
        const bkey = `${group.key}::${bucket.key}`;
        if (!expandedBuckets.has(bkey)) continue;
        collect(bucket.roots);
      }
    }
    return result;
  }, [groups, expandedSessions, expandedGroups, expandedBuckets]);

  // Sliding indicator state — positioned via getBoundingClientRect relative
  // to the scroll container, which stays robust across the 3-level nesting
  // (project folder + date bucket headers + session card). offsetTop would
  // break if any intermediate container gained `position: relative`.
  const [indicator, setIndicator] = useState<{ top: number; height: number; left: number; right: number } | null>(null);
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
        ? (
          // Wrap direct sub-agent children in an indented container with a
          // left dashed border. This shifts the entire sub-agent subtree box
          // to the right (so the row backgrounds/hover regions are visibly
          // inset under the parent main agent) AND draws the vertical tree
          // guide line down the side of the group. `ml-5` sets the indent
          // (larger than a row's own padding); `pl-3` creates a breathing
          // gap between the dashed border and the child row boxes (so they
          // don't visually touch the line). Multi-level nesting composes:
          // each TreeItem wraps its own children the same way, so sub-sub-
          // agents get another ml-5 + pl-3 + dashed border layer.
          <div key={`${item.session.id}__children`} className="ml-5 pl-3 border-l border-dashed border-border">
            {item.children.map((child) => renderTree(child))}
          </div>
        )
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
        // Capture the active card's horizontal extents relative to the
        // scroll container. This makes the sliding indicator track the
        // card's actual box: full-width for main agents, inset for
        // sub-agents (whose card lives inside the indented wrapper). Using
        // fixed left-3/right-3 here would ignore the wrapper indent and
        // paint the blue box full-width even for sub-agents.
        left: elRect.left - scrollRect.left,
        right: scrollRect.right - elRect.right,
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
            className="absolute rounded-lg bg-primary shadow-md pointer-events-none z-0 transition-all duration-500"
            style={{
              top: indicator.top,
              height: indicator.height,
              left: indicator.left,
              right: indicator.right,
              transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          />
        )}
        {loading && sessions.length === 0 ? (
          <SkeletonLines count={3} />
        ) : !hasContent ? (
          filterText ? (
            <EmptyState
              title={t("session.noResults", { query: filterText })}
            />
          ) : (
            <EmptyState
              title={t("session.noSessions")}
              description={t("session.importToCreate")}
              action={emptyAction}
            />
          )
        ) : (
          groups.map((group) => {
            const collapsed = !expandedGroups.has(group.key);
            return (
              <div key={group.key}>
                <ProjectFolder
                  name={group.name}
                  fullPath={group.fullPath}
                  collapsed={collapsed}
                  count={group.totalSessions}
                  latestRelative={group.latestStart ? formatRelative(group.latestStart, t) : null}
                  onToggle={() => toggleGroup(group)}
                />
                {!collapsed && (
                  <div>
                    {group.buckets.map((bucket) => {
                      const bkey = `${group.key}::${bucket.key}`;
                      const bucketCollapsed = !expandedBuckets.has(bkey);
                      return (
                        <div key={bkey}>
                          <DateBucket
                            label={bucket.label}
                            collapsed={bucketCollapsed}
                            count={bucket.roots.length}
                            onToggle={() => toggleBucket(bkey)}
                          />
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
