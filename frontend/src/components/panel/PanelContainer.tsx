import { memo, useCallback, useMemo, useRef, useState } from "react";
import { usePanelStore } from "../../stores/panel";
import { useSessionStore } from "../../stores/session";
import { DraggableDivider } from "./DraggableDivider";
import { SplitMenu } from "./SplitMenu";
import type { LayoutNode, ViewKind } from "../../stores/panel";
import type { EventRow } from "../../ipc/types"; // used in sortedEvents selector
import { GraphCanvas } from "../graph/GraphCanvas";
import { TimelineView } from "../timeline/TimelineView";
import { ConversationView } from "../conversation/ConversationView";
import { RawView } from "../raw/RawView";

// ── Pill tab bar ───────────────────────────────────────

const VIEW_TABS: ViewKind[] = ["graph", "timeline", "chat", "raw"];

interface PillTabBarProps {
  activeView: ViewKind;
  panelId: string;
  panelCount: number;
}

const PillTabBar = memo(function PillTabBar({
  activeView,
  panelId,
  panelCount,
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

  const handleNodeClick = useCallback(
    (id: string) => {
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
        events={sortedEvents}
        selectedEventId={selectedEventId}
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
      />
      <CloseButton panelId={panelId} panelCount={panelCount} />
      <div className="absolute inset-0 pt-[42px] overflow-hidden">
        <PanelViewContent view={view} />
      </div>
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
