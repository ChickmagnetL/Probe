import { create } from "zustand";
import { invoke } from "../ipc/invoke";
import type {
  SessionRow,
  SessionDetail,
  ListSessionsParams,
} from "../ipc/types";

const ANIM_DURATION = 500;

interface SessionState {
  sessions: SessionRow[];
  total: number;
  loading: boolean;
  error: string | null;

  // Detail
  activeSessionId: string | null;
  detail: SessionDetail | null;
  detailLoading: boolean;

  // Selected event
  selectedEventId: string | null;

  // Multi-select
  selectionMode: boolean;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;

  fetchSessions: (params?: ListSessionsParams) => Promise<void>;
  fetchDetail: (sessionId: string) => Promise<void>;
  selectEvent: (eventId: string | null) => void;
  clearDetail: () => void;
  deleteSessions: (deleteFiles: boolean) => Promise<void>;
}

let _pendingTimeout: ReturnType<typeof setTimeout> | null = null;

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  total: 0,
  loading: false,
  error: null,
  activeSessionId: null,
  detail: null,
  detailLoading: false,
  selectedEventId: null,
  selectedIds: new Set(),
  selectionMode: false,

  enterSelectionMode: () => set({ selectionMode: true, selectedIds: new Set() }),

  exitSelectionMode: () => set({ selectionMode: false, selectedIds: new Set() }),

  toggleSelect: (id) => {
    const { selectedIds } = get();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selectedIds: next });
  },

  selectAll: () => {
    const { sessions, selectedIds } = get();
    const allIds = sessions.map((s) => s.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      set({ selectedIds: new Set() });
    } else {
      set({ selectedIds: new Set(allIds), selectionMode: true });
    }
  },

  clearSelection: () => set({ selectedIds: new Set(), selectionMode: false }),

  fetchSessions: async (params) => {
    set({ loading: true, error: null });
    try {
      const res = await invoke.listSessions(params);
      set({ sessions: res.sessions, total: res.total, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  fetchDetail: async (sessionId) => {
    // Cancel any pending delayed apply from a previous session switch
    if (_pendingTimeout) { clearTimeout(_pendingTimeout); _pendingTimeout = null; }

    // Step 1: Update activeSessionId immediately → indicator starts sliding
    set({ detailLoading: true, activeSessionId: sessionId, selectedEventId: null });

    // Step 2: Fetch data (non-blocking IPC)
    try {
      const detail = await invoke.getSessionDetail(sessionId);
      // Step 3: Delay applying detail until indicator animation finishes
      _pendingTimeout = setTimeout(() => {
        _pendingTimeout = null;
        set({ detail, detailLoading: false });
      }, ANIM_DURATION);
    } catch (e) {
      set({ error: String(e), detailLoading: false });
    }
  },

  selectEvent: (eventId) => set({ selectedEventId: eventId }),

  clearDetail: () => {
    if (_pendingTimeout) { clearTimeout(_pendingTimeout); _pendingTimeout = null; }
    set({ activeSessionId: null, detail: null, detailLoading: false, selectedEventId: null });
  },

  deleteSessions: async (deleteFiles) => {
    const { selectedIds, activeSessionId, clearDetail, fetchSessions } = get();
    if (selectedIds.size === 0) return;

    const idsToDelete = Array.from(selectedIds);
    try {
      await invoke.deleteSessions(idsToDelete, deleteFiles);
      set({ selectedIds: new Set(), selectionMode: false });
      // If the active session was deleted, clear detail
      if (activeSessionId && idsToDelete.includes(activeSessionId)) {
        clearDetail();
      }
      // Refresh the list
      await fetchSessions();
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
