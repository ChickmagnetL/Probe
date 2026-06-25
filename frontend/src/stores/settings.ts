import { create } from "zustand";
import { invoke } from "../ipc/invoke";
import type { IpcError, Settings } from "../ipc/types";

interface SettingsState {
  settings: Settings;
  loading: boolean;
  error: IpcError | null;
  /** True until the initial load() has run at least once. */
  initialized: boolean;

  load: () => Promise<void>;
  /** Persist the Codex CLI path to the engine KV store and mirror it locally. */
  setCodexPath: (path: string) => Promise<void>;
  /** Persist the interface language to the engine KV store and mirror it locally. */
  setInterfaceLanguage: (lang: string) => Promise<void>;
}

/** Narrow an unknown caught value into the cross-layer IpcError shape. */
function toIpcError(raw: unknown): IpcError {
  if (typeof raw === "object" && raw !== null && "kind" in raw) {
    const r = raw as { kind: string; data: unknown };
    if (r.kind === "Engine" && typeof r.data === "object" && r.data !== null) {
      const d = r.data as { code: string; message: string };
      return { code: d.code, message: d.message };
    }
    return {
      code: r.kind.toUpperCase(),
      message: typeof r.data === "string" ? r.data : JSON.stringify(r.data),
    };
  }
  if (raw instanceof Error) return { code: "INTERNAL_ERROR", message: raw.message };
  return { code: "INTERNAL_ERROR", message: String(raw) };
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {},
  loading: false,
  error: null,
  initialized: false,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const settings = await invoke.getSettings();
      set({ settings, loading: false, initialized: true });
    } catch (e) {
      set({ error: toIpcError(e), loading: false, initialized: true });
    }
  },

  setCodexPath: async (path) => {
    set({ loading: true, error: null });
    try {
      await invoke.setSettings("codex_path", path);
      const settings = await invoke.getSettings();
      set({ settings, loading: false });
    } catch (e) {
      set({ error: toIpcError(e), loading: false });
    }
  },

  setInterfaceLanguage: async (lang) => {
    try {
      await invoke.setSettings("interface_language", lang);
      const settings = await invoke.getSettings();
      set({ settings });
    } catch (e) {
      set({ error: toIpcError(e) });
    }
  },
}));
