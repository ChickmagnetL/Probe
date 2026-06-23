import { create } from "zustand";
import { invoke } from "../ipc/invoke";
import type {
  SessionRow,
  SessionDetail,
  ListSessionsParams,
} from "../ipc/types";

const DETAIL_CACHE = new Map<string, SessionDetail>();
const MAX_CACHE_SIZE = 10;

function cacheGet(key: string): SessionDetail | undefined {
  const val = DETAIL_CACHE.get(key);
  if (val !== undefined) {
    DETAIL_CACHE.delete(key);
    DETAIL_CACHE.set(key, val);
  }
  return val;
}

function cacheSet(key: string, val: SessionDetail): void {
  DETAIL_CACHE.delete(key);
  DETAIL_CACHE.set(key, val);
  if (DETAIL_CACHE.size > MAX_CACHE_SIZE) {
    const oldest = DETAIL_CACHE.keys().next().value;
    if (oldest) DETAIL_CACHE.delete(oldest);
  }
}

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

  // Tree nesting
  expandedSessions: Set<string>;
  setExpanded: (sessionId: string, expanded: boolean) => void;

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

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  total: 0,
  loading: false,
  error: null,
  activeSessionId: null,
  detail: null,
  detailLoading: false,
  selectedEventId: null,
  expandedSessions: new Set<string>(),
  selectedIds: new Set(),
  selectionMode: false,

  setExpanded: (sessionId, expanded) => {
    const { expandedSessions } = get();
    const next = new Set(expandedSessions);
    if (expanded) next.add(sessionId);
    else next.delete(sessionId);
    set({ expandedSessions: next });
  },

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
    const cached = cacheGet(sessionId);
    if (cached) {
      set({ activeSessionId: sessionId, detail: cached, detailLoading: false, selectedEventId: null });
      return;
    }

    set({ detailLoading: true, activeSessionId: sessionId, selectedEventId: null });
    try {
      const detail = await invoke.getSessionDetail(sessionId);
      cacheSet(sessionId, detail);
      set({ detail, detailLoading: false });
    } catch (e) {
      set({ error: String(e), detailLoading: false });
    }
  },

  selectEvent: (eventId) => set({ selectedEventId: eventId }),

  clearDetail: () => {
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
