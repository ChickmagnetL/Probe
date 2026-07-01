import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../stores/session";
import { useImportStore } from "../stores/import";
import { usePanelStore } from "../stores/panel";
import { useSettingsStore } from "../stores/settings";
import { useImportProgressStore } from "../stores/import_progress";
import { SessionList } from "../components/session/SessionList";
import { PanelContainer } from "../components/panel/PanelContainer";
import { EmptyState } from "../components/shared/EmptyState";
import {
  MetaCardsGrid,
  ContentRenderer,
  TokenUsageSection,
  MetadataSection,
} from "../components/shared/EventDetailContent";
import { eventTypeLabel } from "../components/graph/graph-labels";
import { SkeletonLines } from "../components/shared/SkeletonLines";
import { ErrorBoundary } from "../components/shared/ErrorBoundary";
import { TitleDragRegion } from "../components/shared/TitleBar";
import { WindowControls } from "../components/shared/WindowControls";
import { FilterBar } from "../components/shared/FilterBar";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { SettingsPanel } from "../components/settings/SettingsPanel";
import { ProgressBar } from "../components/shared/ProgressBar";
import { invoke } from "../ipc/invoke";
import type { EventRow } from "../ipc/types";

function useSortOptions() {
  const { t } = useTranslation();
  return [
    { value: "start_time:desc", label: t("sort.newest") },
    { value: "start_time:asc", label: t("sort.oldest") },
  ];
}

export function AppView() {
  const { t } = useTranslation();
  const sortOptions = useSortOptions();
  const {
    detail,
    detailLoading,
    fetchDetail,
    selectEvent,
    selectedEventId,
    fetchSessions,
    selectedIds,
    selectionMode,
    enterSelectionMode,
    exitSelectionMode,
    selectAll,
    deleteSessions,
  } = useSessionStore();
  const openImportModal = useImportStore((s) => s.openModal);
  const root = usePanelStore((s) => s.root);
  const resetLayout = usePanelStore((s) => s.resetLayout);

  // Settings + incremental import
  const settingsInitialized = useSettingsStore((s) => s.initialized);
  const settingsLoad = useSettingsStore((s) => s.load);
  const codexPath = useSettingsStore((s) => s.settings.codex_path);
  const runIncrementalImport = useImportProgressStore((s) => s.runIncrementalImport);
  const importActive = useImportProgressStore((s) => s.active);
  const importTotal = useImportProgressStore((s) => s.total);
  const importProcessed = useImportProgressStore((s) => s.processed);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const autoScanStartedRef = useRef(false);

  // Sidebar width state: null = CSS clamp default, number = user-dragged px value
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // FilterBar state
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(sortOptions[0].value);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  // True while a CJK IME is composing (e.g. pinyin before the user confirms the
  // Chinese). It is state (not a ref) so flipping it back to false on
  // compositionend re-renders and re-runs the effect below, firing the search
  // with the confirmed text. During composition the effect short-circuits so
  // intermediate letters never trigger a query.
  const [isComposing, setIsComposing] = useState(false);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);

  // Resize divider drag handlers
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const startWidth = sidebar.getBoundingClientRect().width;
    dragRef.current = { startX: e.clientX, startWidth };
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaX = e.clientX - drag.startX;
    const newWidth = Math.min(500, Math.max(250, drag.startWidth - deltaX));
    setSidebarWidth(newWidth);
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  useEffect(() => {
    return () => {
      // Cleanup drag listeners on unmount
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove]);

  useEffect(() => {
    // Skip search while the IME is composing — the search text is still
    // intermediate pinyin. When composition ends, isComposing flips to false,
    // this effect re-runs, and the search fires with the confirmed value.
    if (isComposing) return;
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
  }, [search, sort, fetchSessions, isComposing]);

  // Listen for dev-mock data updates (browser mode dynamic import)
  useEffect(() => {
    const handler = () => fetchSessions();
    window.addEventListener("dev-mock-updated", handler);
    return () => window.removeEventListener("dev-mock-updated", handler);
  }, [fetchSessions]);

  // Load settings on mount; once loaded, trigger a background incremental
  // scan/import if a Codex path is configured. Guarded by a ref so StrictMode
  // double-invoke and re-renders do not start a second concurrent run.
  useEffect(() => {
    if (!settingsInitialized) {
      void settingsLoad();
      return;
    }
    if (autoScanStartedRef.current) return;
    if (codexPath) {
      autoScanStartedRef.current = true;
      void runIncrementalImport(codexPath);
    }
  }, [settingsInitialized, codexPath, settingsLoad, runIncrementalImport]);

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

  // Lazily load full event content when the detail overlay opens.
  // The backend may strip `content` from get_session_detail, keeping only
  // `content_preview`. When an event without `content` is selected, fetch
  // the full event via get_event_detail IPC.
  const [loadedEvent, setLoadedEvent] = useState<EventRow | null>(null);
  const [loadingEvent, setLoadingEvent] = useState(false);

  useEffect(() => {
    if (!selectedEvent) {
      setLoadedEvent(null);
      setLoadingEvent(false);
      return;
    }
    if (selectedEvent.content) {
      // Event already has full content, no need to fetch
      setLoadedEvent(null);
      setLoadingEvent(false);
      return;
    }
    let cancelled = false;
    setLoadingEvent(true);
    invoke.getEventDetail(selectedEvent.id).then((full) => {
      if (!cancelled) {
        setLoadedEvent(full);
        setLoadingEvent(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setLoadingEvent(false);
      }
    });
    return () => { cancelled = true; };
  }, [selectedEvent]);

  // Use the lazy-loaded event if available, otherwise the selected event
  const displayEvent = loadedEvent ?? selectedEvent;

  const handleOverlayClose = () => {
    selectEvent(null);
  };

  // ESC key to close event detail
  useEffect(() => {
    if (!selectedEvent) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") selectEvent(null);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedEvent, selectEvent]);

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      fetchDetail(sessionId);
      resetLayout();
    },
    [fetchDetail, resetLayout],
  );

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
      {/* Left: Main panel area */}
      <main className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col bg-background">
        {/* Drag region for left side - transparent, above content */}
        <TitleDragRegion
          className="fixed top-0 left-0 h-5 z-40 select-none"
          style={{ right: sidebarWidth !== null ? `${sidebarWidth}px` : "clamp(300px, calc(130px + 12vw), 500px)" }}
        />
        {detailLoading && !detail ? (
          <SkeletonLines count={3} />
        ) : detail ? (
          <PanelContainer node={root} />
        ) : (
          <EmptyState
            title={t("app.emptyTitle")}
            description={t("app.emptyDescription")}
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
                {t("app.importFiles")}
              </button>
            }
          />
        )}
      </main>

      {/* Resizable divider */}
      <div
        className="w-px shrink-0 bg-transparent cursor-col-resize"
        onMouseDown={handleDividerMouseDown}
      />

      {/* Right: Function panel */}
      <aside
          ref={sidebarRef}
          className="shrink-0 flex flex-col bg-card border-l border-border"
          style={{ width: sidebarWidth !== null ? `${sidebarWidth}px` : "clamp(300px, calc(130px + 12vw), 500px)" }}
        >
        {/* Header with branding + actions - starts from top for seamless title bar */}
        <div className="px-4 pt-[10px] pb-3 border-b border-border flex items-center gap-3">
          <TitleDragRegion className="flex-1 min-w-0 self-stretch flex items-center select-none">
            <div className="pointer-events-none">
              <h1 className="text-base font-semibold tracking-tight text-foreground">Probe</h1>
            </div>
          </TitleDragRegion>
          <button
            data-tauri-drag-region="false"
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:scale-112 active:scale-90"
            aria-label={t("app.settings")}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
          <WindowControls />
        </div>

        {/* Sessions section */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-4 pt-3 pb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                {t("app.sessions")}
              </span>
              {selectionMode && (
                <button
                  onClick={selectAll}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={t("delete.selectAll")}
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
            <FilterBar
              search={search}
              onSearchChange={setSearch}
              onCompositionChange={setIsComposing}
              sort={sort}
              onSortChange={setSort}
              sortOptions={sortOptions}
            >
              <button
                data-tauri-drag-region="false"
                onClick={openImportModal}
                className="btn-ghost p-1.5"
                aria-label={t("app.importFiles")}
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                  <line x1="12" y1="11" x2="12" y2="17" />
                  <line x1="9" y1="14" x2="15" y2="14" />
                </svg>
              </button>
              <button
                data-tauri-drag-region="false"
                onClick={handleDeleteClick}
                className={`btn-ghost p-1.5 ${selectionMode && selectedCount > 0 ? 'text-destructive bg-destructive/10 hover:bg-destructive/20 hover:text-destructive' : selectionMode ? 'bg-muted text-foreground' : ''}`}
                aria-label={selectionMode && selectedCount > 0 ? t("delete.deleteSelected") : selectionMode ? t("delete.exitSelection") : t("delete.deleteSessions")}
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </button>
            </FilterBar>
          </div>
          {importActive && (
            <div className="px-4 py-2 border-b border-border bg-muted/30">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-muted border-t-accent rounded-full animate-spin" />
                  {t("app.scanning")}
                </span>
                <span className="tabular-nums">
                  {importProcessed}/{importTotal}
                </span>
              </div>
              <ProgressBar value={importProcessed} max={importTotal || 1} />
            </div>
          )}
          <SessionList
            onSessionSelect={handleSessionSelect}
            filterText={search}
            sortBy={sort}
          />
        </div>
      </aside>

      {/* Event detail overlay - covers full height from top */}
      {selectedEvent && (
        <div
          className="absolute top-0 right-0 h-full z-30 flex flex-col bg-card border-l border-border shadow-lg"
          style={{ width: sidebarWidth !== null ? `${sidebarWidth}px` : "clamp(300px, calc(130px + 12vw), 500px)" }}
        >
          <div className="flex items-center gap-2 px-4 pt-[10px] pb-2 border-b border-border">
            <button
              onClick={handleOverlayClose}
              className="flex items-center px-3 py-1.5 -ml-3 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label={t("app.backToSessions")}
              type="button"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {eventTypeLabel(selectedEvent)}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {displayEvent ? (
              <>
                <MetaCardsGrid event={displayEvent} />
                <TokenUsageSection event={displayEvent} />
                {loadingEvent ? (
                  <SkeletonLines count={2} />
                ) : (
                  <ContentRenderer event={displayEvent} />
                )}
                <MetadataSection
                  metadata={displayEvent.metadata}
                  sourceLineNo={displayEvent.source_line_no}
                />
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteDialogOpen && (
        <ConfirmDialog
          title={t("delete.title")}
          message={t("delete.message_other", { count: selectedCount })}
          confirmLabel={t("delete.confirm")}
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
              {t("delete.alsoDeleteFiles")}
            </span>
          </label>
        </ConfirmDialog>
      )}

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
    </ErrorBoundary>
  );
}
