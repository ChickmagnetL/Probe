import { create } from "zustand";
import { toIpcError } from "../ipc/errors";
import { invoke } from "../ipc/invoke";
import { useSessionStore } from "./session";
import type { IpcError } from "../ipc/types";

const BATCH_SIZE = 10;

interface ImportProgressState {
  /** True while a scan + batch loop is running. */
  active: boolean;
  /** Total files discovered in the Codex sessions directory. */
  total: number;
  /** Skipped + parsed so far — drives the progress bar numerator. */
  processed: number;
  /** Files still pending parse (decreases as batches complete). */
  pending: number;
  errors: string[];
  error: IpcError | null;

  runIncrementalImport: (codexPath: string) => Promise<void>;
  reset: () => void;
}

export const useImportProgressStore = create<ImportProgressState>((set, get) => ({
  active: false,
  total: 0,
  processed: 0,
  pending: 0,
  errors: [],
  error: null,

  runIncrementalImport: async (codexPath) => {
    if (get().active) return;
    set({
      active: true,
      total: 0,
      processed: 0,
      pending: 0,
      errors: [],
      error: null,
    });

    try {
      const scan = await invoke.scanCodexSessions(codexPath);
      // Unchanged files count as already processed — the progress bar jumps
      // past them quickly on app start when most files are unchanged.
      set({
        total: scan.total,
        processed: scan.skipped,
        pending: scan.pending_count,
      });

      const pendingPaths = scan.pending.map((p) => p.path);
      for (let i = 0; i < pendingPaths.length; i += BATCH_SIZE) {
        const batch = pendingPaths.slice(i, i + BATCH_SIZE);
        const result = await invoke.importFilesBatch(batch);

        set((s) => ({
          processed: s.processed + result.parsed_files,
          pending: Math.max(0, s.pending - batch.length),
          errors: result.errors.length
            ? [
                ...s.errors,
                ...result.errors.map((e) => `${e.path}: ${e.message}`),
              ]
            : s.errors,
        }));

        // Refresh the session list so newly imported sessions appear
        // progressively. Outside-React access via getState() is allowed
        // by the state-management spec; documented here: this runs in the
        // import_progress store and must trigger SessionList's data source.
        await useSessionStore.getState().fetchSessions();
      }

      // Final refresh after the loop completes.
      await useSessionStore.getState().fetchSessions();
    } catch (e) {
      set({ error: toIpcError(e) });
    } finally {
      set({ active: false });
    }
  },

  reset: () =>
    set({ active: false, total: 0, processed: 0, pending: 0, errors: [], error: null }),
}));
