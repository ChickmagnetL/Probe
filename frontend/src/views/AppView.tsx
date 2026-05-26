import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useSessionStore } from "../stores/session";
import { useImportStore } from "../stores/import";
import { SessionList } from "../components/session/SessionList";
import { GraphCanvas } from "../components/graph/GraphCanvas";
import { TimelineView } from "../components/timeline/TimelineView";
import { ConversationView } from "../components/conversation/ConversationView";
import { EmptyState } from "../components/shared/EmptyState";
import { EventDetailOverlay } from "../components/shared/EventDetailOverlay";
import { SkeletonLines } from "../components/shared/SkeletonLines";
import { ErrorBoundary } from "../components/shared/ErrorBoundary";
import { TitleDragRegion } from "../components/shared/TitleBar";
import { FilterBar } from "../components/shared/FilterBar";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import type { EventRow } from "../ipc/types";

const SORT_OPTIONS = [
  { value: "imported_at:desc", label: "Newest" },
  { value: "imported_at:asc", label: "Oldest" },
  { value: "start_time:desc", label: "Latest start" },
];

function extractCallId(metadata: string | Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  let parsed: Record<string, unknown>;
  if (typeof metadata === "string") {
    try { parsed = JSON.parse(metadata); } catch { return null; }
  } else {
    parsed = metadata;
  }
  const rawText = parsed.raw_text;
  if (typeof rawText !== "string") return null;
  try {
    const jsonl = JSON.parse(rawText);
    const payload = jsonl.payload ?? jsonl;
    return typeof payload.call_id === "string" ? payload.call_id : null;
  } catch {
    return null;
  }
}

export function AppView() {
  const {
    detail,
    detailLoading,
    fetchDetail,
    selectEvent,
    selectedEventId,
    sessions,
    loading,
    fetchSessions,
    selectedIds,
    selectionMode,
    enterSelectionMode,
    exitSelectionMode,
    selectAll,
    deleteSessions,
  } = useSessionStore();
  const openImportModal = useImportStore((s) => s.openModal);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'graph' | 'timeline' | 'conversation'>('graph');

  // FilterBar state
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(SORT_OPTIONS[0].value);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const [sortField, sortOrder] = sort.split(":") as [string, "asc" | "desc"];
      fetchSessions({
        filter: search || undefined,
        sort: sortField,
        sort_order: sortOrder,
      });
    }, search ? 300 : 0);
    return () => clearTimeout(debounceRef.current);
  }, [search, sort, fetchSessions]);

  const sortedEvents = useMemo(() => {
    if (!detail?.events) return [];
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

  const selectedEvent = sortedEvents.find((e) => e.id === selectedEventId);

  const toolPairMap = useMemo(() => {
    const pairs = new Map<string, { call?: EventRow; output?: EventRow }>();
    for (const ev of sortedEvents) {
      if (ev.kind !== "tool_call" && ev.kind !== "tool_output") continue;
      const callId = extractCallId(ev.metadata);
      if (!callId) continue;
      const entry = pairs.get(callId) ?? {};
      if (ev.kind === "tool_call") entry.call = ev;
      else entry.output = ev;
      pairs.set(callId, entry);
    }
    return pairs;
  }, [sortedEvents]);

  const pairedEvent = useMemo(() => {
    if (!selectedEvent) return undefined;
    if (selectedEvent.kind !== "tool_call" && selectedEvent.kind !== "tool_output") return undefined;
    const callId = extractCallId(selectedEvent.metadata);
    if (!callId) return undefined;
    const pair = toolPairMap.get(callId);
    if (!pair) return undefined;
    return selectedEvent.kind === "tool_call" ? pair.output : pair.call;
  }, [selectedEvent, toolPairMap]);

  const handleOverlayClose = () => {
    setOverlayOpen(false);
    selectEvent(null);
  };

  const handleSessionSelect = (sessionId: string) => {
    fetchDetail(sessionId);
  };

  const selectedCount = selectedIds.size;

  const handleDeleteConfirm = useCallback(async () => {
    await deleteSessions(deleteFiles);
    setDeleteDialogOpen(false);
    setDeleteFiles(false);
  }, [deleteFiles, deleteSessions]);

  const handleDeleteClick = useCallback(() => {
    if (!selectionMode) {
      enterSelectionMode();
    } else if (selectedCount > 0) {
      setDeleteDialogOpen(true);
    } else {
      exitSelectionMode();
    }
  }, [selectionMode, selectedCount, enterSelectionMode, exitSelectionMode]);

  return (
    <ErrorBoundary>
    <div className="relative flex h-screen overflow-hidden bg-background">
      {/* Left: Graph canvas */}
      <main className="flex-1 min-w-0 flex flex-col bg-background">
        {/* Drag region for left side - transparent, above graph content */}
        <TitleDragRegion className="fixed top-0 left-0 h-5 z-40 select-none" style={{ right: '280px' }} />
        {detailLoading && !detail ? (
          <SkeletonLines count={3} />
        ) : detail ? (
          <div className="relative flex-1 flex flex-col">
            {/* 固定浮动 tab 切换器 */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
              <div className="liquid-glass rounded-full p-0.5 flex relative" style={{ minWidth: '240px' }}>
                <div
                  className="absolute top-0.5 bottom-0.5 rounded-full bg-primary/90 transition-all duration-300 ease-out"
                  style={{
                    width: 'calc(33.333% - 2px)',
                    left: viewMode === 'graph' ? '2px' : viewMode === 'timeline' ? 'calc(33.333%)' : 'calc(66.666%)',
                  }}
                />
                <button
                  onClick={() => setViewMode('graph')}
                  className="flex-1 py-1 px-3 text-[11px] font-semibold rounded-full relative z-10 transition-colors duration-200 text-center"
                  style={{
                    color: viewMode === 'graph' ? 'var(--color-on-primary)' : 'var(--color-muted-foreground)',
                  }}
                >
                  Graph
                </button>
                <button
                  onClick={() => setViewMode('timeline')}
                  className="flex-1 py-1 px-3 text-[11px] font-semibold rounded-full relative z-10 transition-colors duration-200 text-center"
                  style={{
                    color: viewMode === 'timeline' ? 'var(--color-on-primary)' : 'var(--color-muted-foreground)',
                  }}
                >
                  Timeline
                </button>
                <button
                  onClick={() => setViewMode('conversation')}
                  className="flex-1 py-1 px-3 text-[11px] font-semibold rounded-full relative z-10 transition-colors duration-200 text-center"
                  style={{
                    color: viewMode === 'conversation' ? 'var(--color-on-primary)' : 'var(--color-muted-foreground)',
                  }}
                >
                  Chat
                </button>
              </div>
            </div>
            {/* 视图内容 */}
            <div className="flex-1 relative">
              <div
                className="absolute inset-0 transition-opacity duration-300"
                style={{ opacity: viewMode === 'graph' ? 1 : 0, pointerEvents: viewMode === 'graph' ? 'auto' : 'none' }}
              >
                <GraphCanvas
                  events={sortedEvents}
                  selectedEventId={selectedEventId}
                  onNodeClick={(id) => {
                    selectEvent(id);
                    setOverlayOpen(true);
                  }}
                />
              </div>
              <div
                className="absolute inset-0 transition-opacity duration-300"
                style={{ opacity: viewMode === 'timeline' ? 1 : 0, pointerEvents: viewMode === 'timeline' ? 'auto' : 'none' }}
              >
                <TimelineView
                  events={sortedEvents}
                  selectedEventId={selectedEventId}
                  onSelectEvent={(id) => {
                    selectEvent(id);
                    setOverlayOpen(true);
                  }}
                />
              </div>
              <div
                className="absolute inset-0 transition-opacity duration-300"
                style={{ opacity: viewMode === 'conversation' ? 1 : 0, pointerEvents: viewMode === 'conversation' ? 'auto' : 'none' }}
              >
                <ConversationView
                  events={sortedEvents}
                  selectedEventId={selectedEventId}
                  onSelectEvent={(id) => {
                    selectEvent(id);
                    setOverlayOpen(true);
                  }}
                />
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            title="Select a session"
            description="Choose a session from the right panel or import new files to get started"
            showShortcut
            action={
              <button
                onClick={openImportModal}
                className="btn-primary flex items-center gap-2"
                type="button"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                  <line x1="12" y1="11" x2="12" y2="17" />
                  <line x1="9" y1="14" x2="15" y2="14" />
                </svg>
                Import Files
              </button>
            }
          />
        )}
      </main>

      {/* Right: Function panel */}
      <aside className="w-[280px] shrink-0 flex flex-col bg-card border-l border-border">
        {/* Header with branding + actions - starts from top for seamless title bar */}
        <div className="px-4 pt-[10px] pb-3 border-b border-border flex items-center gap-3">
          <TitleDragRegion className="flex-1 min-w-0 self-stretch flex items-center select-none">
            <div className="pointer-events-none">
              <h1 className="text-base font-semibold tracking-tight text-foreground">Probe</h1>
            </div>
          </TitleDragRegion>
          <button
            data-tauri-drag-region="false"
            onClick={handleDeleteClick}
            className={`p-2 rounded-lg transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:scale-112 active:scale-90 ${selectionMode && selectedCount > 0 ? 'text-destructive bg-destructive/10 hover:bg-destructive/20' : selectionMode ? 'text-foreground bg-muted' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
            aria-label={selectionMode && selectedCount > 0 ? "Delete selected" : selectionMode ? "Exit selection" : "Delete sessions"}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
          <button
            data-tauri-drag-region="false"
            onClick={openImportModal}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:scale-112 active:scale-90"
            aria-label="Import files"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </button>
        </div>

        {/* Sessions section */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-4 pt-3 pb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Sessions
              </span>
              {selectionMode && (
                <button
                  onClick={selectAll}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Select all"
                  type="button"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                </button>
              )}
              {selectionMode && selectedCount > 0 && (
                <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                  {selectedCount}
                </span>
              )}
            </div>
            {sessions.length > 0 && !loading && (
              <FilterBar
                search={search}
                onSearchChange={setSearch}
                sort={sort}
                onSortChange={setSort}
                sortOptions={SORT_OPTIONS}
              />
            )}
          </div>
          <SessionList
            onSessionSelect={handleSessionSelect}
            filterText={search}
            sortBy={sort}
          />
        </div>
      </aside>

      {/* Event detail overlay */}
      {overlayOpen && selectedEvent && (
        <EventDetailOverlay
          event={selectedEvent}
          pairedEvent={pairedEvent}
          onClose={handleOverlayClose}
        />
      )}

      {/* Delete confirmation dialog */}
      {deleteDialogOpen && (
        <ConfirmDialog
          title="Delete Sessions"
          message={`Are you sure you want to delete ${selectedCount} session${selectedCount > 1 ? 's' : ''}? This action cannot be undone.`}
          confirmLabel="Delete"
          confirmVariant="destructive"
          onCancel={() => {
            setDeleteDialogOpen(false);
            setDeleteFiles(false);
            exitSelectionMode();
          }}
          onConfirm={handleDeleteConfirm}
        >
          <label className="flex items-center gap-2.5 cursor-pointer mt-3">
            <input
              type="checkbox"
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
              className="w-4 h-4 rounded border-border text-destructive focus:ring-ring/30"
            />
            <span className="text-sm text-muted-foreground">
              Also delete original files
            </span>
          </label>
        </ConfirmDialog>
      )}
    </div>
    </ErrorBoundary>
  );
}
