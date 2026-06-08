import { create } from "zustand";
import { invoke } from "../ipc/invoke";
import type { ImportResult } from "../ipc/types";

interface ImportState {
  loading: boolean;
  error: string | null;
  result: ImportResult | null;
  lastResult: ImportResult | null;
  inputPath: string;
  modalOpen: boolean;

  setInputPath: (path: string) => void;
  openPicker: (directory?: boolean) => Promise<void>;
  startImport: () => Promise<void>;
  reset: () => void;
  openModal: () => void;
  closeModal: () => void;
}

export const useImportStore = create<ImportState>((set, get) => ({
  loading: false,
  error: null,
  result: null,
  lastResult: null,
  inputPath: "",
  modalOpen: false,

  setInputPath: (path: string) => set({ inputPath: path }),

  openPicker: async (directory = true) => {
    try {
      const selected = await invoke.openFileDialog({ directory });
      if (selected) set({ inputPath: selected });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  startImport: async () => {
    const { inputPath } = get();
    if (!inputPath.trim()) return;
    set({ loading: true, error: null, result: null });
    try {
      const res = await invoke.importFiles(inputPath);
      set({ result: res, lastResult: res, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  reset: () => set({ loading: false, error: null, result: null, inputPath: "" }),
  openModal: () => set({ modalOpen: true }),
  closeModal: () => {
    const { loading } = get();
    if (loading) return;
    set({ modalOpen: false });
  },
}));
