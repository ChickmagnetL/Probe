import { create } from "zustand";
import { toIpcError } from "../ipc/errors";
import { invoke } from "../ipc/invoke";
import type { AppearanceMode, IpcError, SessionPlatform, Settings } from "../ipc/types";

interface SettingsState {
  settings: Settings;
  loading: boolean;
  error: IpcError | null;
  /** True until the initial load() has run at least once. */
  initialized: boolean;

  load: () => Promise<void>;
  /** Persist the Codex CLI path to the engine KV store and mirror it locally. */
  setCodexPath: (path: string) => Promise<void>;
  /** Persist the Claude Code path to the engine KV store and mirror it locally. */
  setClaudePath: (path: string) => Promise<void>;
  /** Persist the active session platform filter and mirror it locally. */
  setActivePlatform: (platform: SessionPlatform) => Promise<void>;
  /** Persist the interface language to the engine KV store and mirror it locally. */
  setInterfaceLanguage: (lang: string) => Promise<void>;
  /** Persist the interface appearance mode to the engine KV store and mirror it locally. */
  setAppearanceMode: (mode: AppearanceMode) => Promise<void>;
  /** Persist the auto_sync flag to the engine KV store and mirror it locally. */
  setAutoSync: (value: boolean) => Promise<void>;
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

  setClaudePath: async (path) => {
    set({ loading: true, error: null });
    try {
      await invoke.setSettings("claude_path", path);
      const settings = await invoke.getSettings();
      set({ settings, loading: false });
    } catch (e) {
      set({ error: toIpcError(e), loading: false });
    }
  },

  setActivePlatform: async (platform) => {
    set({ error: null });
    try {
      await invoke.setSettings("active_platform", platform);
      const settings = await invoke.getSettings();
      set({ settings });
    } catch (e) {
      set({ error: toIpcError(e) });
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

  setAppearanceMode: async (mode) => {
    try {
      await invoke.setSettings("appearance_mode", mode);
      const settings = await invoke.getSettings();
      set({ settings });
    } catch (e) {
      set({ error: toIpcError(e) });
    }
  },

  setAutoSync: async (value) => {
    try {
      await invoke.setSettings("auto_sync", value);
      const settings = await invoke.getSettings();
      set({ settings });
    } catch (e) {
      set({ error: toIpcError(e) });
    }
  },
}));
