import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelStore } from "../../stores/panel";
import { useSessionStore } from "../../stores/session";
import { DraggableDivider } from "./DraggableDivider";
import { SplitMenu } from "./SplitMenu";
import type { LayoutNode, ViewKind } from "../../stores/panel";
import type { EventRow, ChildSessionDetail } from "../../ipc/types";
import { GraphCanvas } from "../graph/GraphCanvas";
import type { ChildSession } from "../graph/graph-layout";
import { buildTurnsFromEvents } from "../graph/graph-layout";
import { TimelineView } from "../timeline/TimelineView";
import { ConversationView } from "../conversation/ConversationView";
import { RawView } from "../raw/RawView";
import {
  DebugBasketPanel,
  debugBasketBadgeCount,
  hasDebugBasketContent,
} from "./DebugBasketPanel";

// ── Pill tab bar ───────────────────────────────────────

const VIEW_TABS: ViewKind[] = ["graph", "timeline", "chat", "raw"];

interface PillTabBarProps {
  activeView: ViewKind;
  panelId: string;
  panelCount: number;
  showDebugButton: boolean;
  debugOpen: boolean;
  debugBadgeCount: number;
  onToggleDebug: () => void;
}

const PillTabBar = memo(function PillTabBar({
  activeView,
  panelId,
  panelCount,
  showDebugButton,
  debugOpen,
  debugBadgeCount,
  onToggleDebug,
}: PillTabBarProps) {
  const changeView = usePanelStore((s) => s.changeView);
  const splitPanel = usePanelStore((s) => s.splitPanel);
  const [menuOpen, setMenuOpen] = useState(false);
  const canSplit = panelCount < 4;

  const indicatorRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const handleSplitRight = useCallback(() => {
    setMenuOpen(false);
    splitPanel(panelId, "horizontal");
  }, [panelId, splitPanel]);

  const handleSplitDown = useCallback(() => {
    setMenuOpen(false);
    splitPanel(panelId, "vertical");
  }, [panelId, splitPanel]);

  const handleCloseMenu = useCallback(() => setMenuOpen(false), []);

  // Update indicator position after render
  const updateIndicator = useCallback(() => {
    if (!tabsRef.current || !indicatorRef.current) return;
    const activeTab = tabsRef.current.querySelector(`[data-view="${activeView}"]`) as HTMLElement | null;
    if (activeTab) {
      indicatorRef.current.style.width = `${activeTab.offsetWidth}px`;
      indicatorRef.current.style.transform = `translateX(${activeTab.offsetLeft}px)`;
    }
  }, [activeView]);

  // Use requestAnimationFrame to position indicator after DOM update
  useMemo(() => {
    requestAnimationFrame(updateIndicator);
  }, [updateIndicator]);

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
      <div className="liquid-glass rounded-full p-0.5 flex items-center relative">
        <div ref={tabsRef} className="relative flex items-center">
          {/* Sliding indicator */}
          <div
            ref={indicatorRef}
            className="absolute top-0.5 bottom-0.5 left-0 rounded-full bg-primary/90 transition-all duration-300 ease-out"
          />
          {VIEW_TABS.map((v) => (
            <button
              key={v}
              type="button"
              data-view={v}
              onClick={() => changeView(panelId, v)}
              className="flex-shrink-0 py-1 px-3 text-[11px] font-semibold rounded-full relative z-10 transition-colors duration-200 text-center"
              style={{
                color:
                  v === activeView
                    ? "var(--color-on-primary, #FFFFFF)"
                    : "var(--color-muted-foreground, #64748B)",
              }}
            >
              {v === "graph" ? "Graph" : v === "timeline" ? "Timeline" : v === "chat" ? "Chat" : "Raw"}
            </button>
          ))}
        </div>
        <div className="w-px h-3.5 bg-gray-400/70 mx-0.5" />
        {/* Split trigger */}
        <button
          type="button"
          disabled={!canSplit}
          onClick={() => canSplit && setMenuOpen(!menuOpen)}
          className="relative z-10 bg-transparent border-none py-1 px-2 rounded-full cursor-pointer flex items-center transition-all duration-200"
          style={{
            color: "var(--color-muted-foreground, #64748B)",
            opacity: canSplit ? 1 : 0.3,
            pointerEvents: canSplit ? "auto" : "none",
          }}
          title={canSplit ? "Split panel" : "已达 4 面板上限"}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="12" y1="3" x2="12" y2="21" />
          </svg>
        </button>
        {showDebugButton && (
          <button
            type="button"
            onClick={onToggleDebug}
            className="relative z-10 bg-transparent border-none py-1 px-2 rounded-full cursor-pointer flex items-center transition-all duration-200"
            style={{
              color: debugBadgeCount > 0 ? "#B45309" : "var(--color-muted-foreground, #64748B)",
            }}
            title="导入内容确认"
            aria-label="导入内容确认"
            aria-pressed={debugOpen}
          >
            <span
              className="block h-2.5 w-2.5 rounded-full"
              style={{
                background: debugBadgeCount > 0 ? "#F59E0B" : "#94A3B8",
                boxShadow: debugOpen ? "0 0 0 3px rgba(245, 158, 11, 0.18)" : "none",
              }}
            />
            {debugBadgeCount > 0 && (
              <span className="absolute -right-1 -top-1 min-w-4 h-4 rounded-full bg-rose-600 px-1 text-[9px] font-bold leading-4 text-white tabular-nums">
                {debugBadgeCount > 99 ? "99+" : debugBadgeCount}
              </span>
            )}
          </button>
        )}
        <SplitMenu
          open={menuOpen}
          onSplitRight={handleSplitRight}
          onSplitDown={handleSplitDown}
          onClose={handleCloseMenu}
        />
      </div>
    </div>
  );
});

// ── Close button ───────────────────────────────────────

interface CloseButtonProps {
  panelId: string;
  panelCount: number;
}

const CloseButton = memo(function CloseButton({
  panelId,
  panelCount,
}: CloseButtonProps) {
  const closePanel = usePanelStore((s) => s.closePanel);

  if (panelCount <= 1) return null;

  return (
    <button
      type="button"
      onClick={() => closePanel(panelId)}
      className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center z-[15] transition-all duration-200"
      style={{
        background: "rgba(255, 255, 255, 0.72)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: "1px solid var(--color-border, #E2E8F0)",
        color: "var(--color-muted-foreground, #64748B)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "#FFFFFF";
        e.currentTarget.style.background = "rgba(220, 38, 38, 0.8)";
        e.currentTarget.style.borderColor = "rgba(220, 38, 38, 0.6)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--color-muted-foreground, #64748B)";
        e.currentTarget.style.background = "rgba(255, 255, 255, 0.72)";
        e.currentTarget.style.borderColor = "var(--color-border, #E2E8F0)";
      }}
      aria-label="Close panel"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="18" y1="6" x2="6" y2="18" />
      </svg>
    </button>
  );
});

// ── View content ───────────────────────────────────────

interface PanelViewContentProps {
  view: ViewKind;
}

function PanelViewContent({ view }: PanelViewContentProps) {
  const detail = useSessionStore((s) => s.detail);
  const selectedEventId = useSessionStore((s) => s.selectedEventId);
  const selectEvent = useSessionStore((s) => s.selectEvent);

  // Timeline/Chat data: always from the currently selected session
  const sortedEvents = useMemo(() => {
    if (!detail?.events) return [] as EventRow[];
    return [...detail.events].sort((a, b) => {
      if (!a.timestamp && !b.timestamp)
        return (a.source_line_no ?? 0) - (b.source_line_no ?? 0);
      if (!a.timestamp) return 1;
      if (!b.timestamp) return -1;
      const cmp = a.timestamp.localeCompare(b.timestamp);
      if (cmp !== 0) return cmp;
      return (a.source_line_no ?? 0) - (b.source_line_no ?? 0);
    });
  }, [detail?.events]);

  // Graph data: independent from Timeline/Chat per PRD D3.
  // When a child sub-agent is selected, Graph must continue showing the parent's
  // merged data (parent events + all child events), not the child's own events.
  // We use a ref to persist the last non-subagent detail for graph rendering.
  const graphDetailRef = useRef<{
    events: EventRow[];
    children: ChildSessionDetail[];
    sessionId: string;
  } | null>(null);

  // Update graphDetailRef only when the selected session is NOT a sub-agent
  if (detail && detail.session.is_subagent !== 1) {
    graphDetailRef.current = {
      events: detail.events,
      children: detail.children,
      sessionId: detail.session.id,
    };
  }

  const graphDetail = graphDetailRef.current ?? (detail && detail.session.is_subagent !== 1 ? {
    events: detail.events,
    children: detail.children,
    sessionId: detail.session.id,
  } : null);

  const graphEvents = useMemo(() => {
    if (!graphDetail?.events) return [] as EventRow[];
    return [...graphDetail.events].sort((a, b) => {
      if (!a.timestamp && !b.timestamp)
        return (a.source_line_no ?? 0) - (b.source_line_no ?? 0);
      if (!a.timestamp) return 1;
      if (!b.timestamp) return -1;
      const cmp = a.timestamp.localeCompare(b.timestamp);
      if (cmp !== 0) return cmp;
      return (a.source_line_no ?? 0) - (b.source_line_no ?? 0);
    });
  }, [graphDetail?.events]);

  // R5: Convert graphDetail.children to ChildSession[] for GraphCanvas
  const childSessions = useMemo((): ChildSession[] | undefined => {
    if (!graphDetail?.children || graphDetail.children.length === 0) return undefined;
    return graphDetail.children.map((child) => ({
      session_id: child.id,
      graph_turns: buildTurnsFromEvents(child.events),
    }));
  }, [graphDetail?.children]);

  // selectedSessionId for session-based dimming: use the currently selected
  // session's ID (even if it's a child), so dimming highlights the correct
  // session in the merged graph.
  const selectedSessionId = detail?.session.id;

  const handleNodeClick = useCallback(
    (id: string | null) => {
      selectEvent(id);
    },
    [selectEvent],
  );

  const handleSelect = useCallback(
    (id: string) => {
      selectEvent(id);
    },
    [selectEvent],
  );

  if (view === "graph") {
    return (
      <GraphCanvas
        events={graphEvents}
        childSessions={childSessions}
        selectedEventId={selectedEventId}
        selectedSessionId={selectedSessionId}
        onNodeClick={handleNodeClick}
      />
    );
  }

  if (view === "timeline") {
    return (
      <TimelineView
        events={sortedEvents}
        selectedEventId={selectedEventId}
        onSelectEvent={handleSelect}
      />
    );
  }

  if (view === "chat") {
    return (
      <ConversationView
        events={sortedEvents}
        selectedEventId={selectedEventId}
        onSelectEvent={handleSelect}
      />
    );
  }

  if (view === "raw") {
    return <RawView />;
  }

  return null;
}

// ── Panel card (leaf) ──────────────────────────────────

interface PanelCardProps {
  panelId: string;
  view: ViewKind;
  panelCount: number;
}

const PanelCard = memo(function PanelCard({
  panelId,
  view,
  panelCount,
}: PanelCardProps) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const debugBasket = useSessionStore((s) => (
    s.detail?.session.id === s.activeSessionId
      ? s.detail.session.debug_basket ?? null
      : null
  ));
  const [debugOpen, setDebugOpen] = useState(false);
  const debugBadgeCount = debugBasketBadgeCount(debugBasket);
  const showDebugButton = hasDebugBasketContent(debugBasket);
  const handleToggleDebug = useCallback(() => {
    setDebugOpen((open) => !open);
  }, []);

  useEffect(() => {
    setDebugOpen(false);
  }, [activeSessionId]);

  return (
    <div
      className={`relative bg-white rounded-lg overflow-hidden min-w-0 min-h-0 w-full h-full ${panelCount > 1 ? "border border-border" : ""}`}
      style={{
        background: "linear-gradient(180deg, #FFFFFF, #F8FAFC)",
      }}
    >
      <PillTabBar
        activeView={view}
        panelId={panelId}
        panelCount={panelCount}
        showDebugButton={showDebugButton}
        debugOpen={debugOpen}
        debugBadgeCount={debugBadgeCount}
        onToggleDebug={handleToggleDebug}
      />
      <CloseButton panelId={panelId} panelCount={panelCount} />
      <div className="absolute inset-0 pt-[42px] overflow-hidden">
        <PanelViewContent view={view} />
      </div>
      {debugBasket && <DebugBasketPanel open={debugOpen} basket={debugBasket} />}
    </div>
  );
});

// ── Recursive renderer ─────────────────────────────────

interface PanelNodeRendererProps {
  node: LayoutNode;
  panelCount: number;
}

function PanelNodeRenderer({ node, panelCount }: PanelNodeRendererProps) {
  if (node.type === "panel") {
    return <PanelCard panelId={node.id} view={node.view} panelCount={panelCount} />;
  }

  // Split node
  const isHorizontal = node.direction === "horizontal";

  return (
    <div
      className="flex w-full h-full"
      style={{
        flexDirection: isHorizontal ? "row" : "column",
      }}
    >
      {node.children.map((child, i) => (
        <div
          key={child.type === "panel" ? child.id : child.id}
          className="min-w-0 min-h-0 relative"
          style={{
            flex: `${node.ratios[i]} 1 0%`,
            ...(isHorizontal
              ? { minWidth: 120 }
              : { minHeight: 120 }),
          }}
        >
          <PanelNodeRenderer node={child} panelCount={panelCount} />
        </div>
      )).reduce<React.ReactNode[]>((acc, childEl, i) => {
        if (i > 0) {
          acc.push(
            <DraggableDivider
              key={`divider-${node.id}-${i}`}
              parentSplitId={node.id}
              firstChildIdx={i - 1}
              direction={node.direction}
            />,
          );
        }
        acc.push(childEl);
        return acc;
      }, [])}
    </div>
  );
}

// ── Main export ────────────────────────────────────────

interface PanelContainerProps {
  node: LayoutNode;
}

export function PanelContainer({ node }: PanelContainerProps) {
  const panelCount = usePanelStore((s) => s.panelCount);

  return (
    <div className="w-full h-full overflow-hidden p-2">
      <PanelNodeRenderer node={node} panelCount={panelCount} />
    </div>
  );
}
