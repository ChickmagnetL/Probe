import { create } from "zustand";
import { toIpcError } from "../ipc/errors";
import { invoke } from "../ipc/invoke";
import { getActivePlatform } from "../lib/session-platform";
import { useSessionStore } from "./session";
import { useSettingsStore } from "./settings";
import type { IpcError, SessionPlatform } from "../ipc/types";

const BATCH_SIZE = 10;

export interface IncrementalImportTarget {
  platform: SessionPlatform;
  path: string;
}

interface ImportProgressState {
  /** True while a scan + batch loop is running. */
  active: boolean;
  /** Total files discovered across the queued platform roots. */
  total: number;
  /** Skipped + parsed so far — drives the progress bar numerator. */
  processed: number;
  /** Files still pending parse (decreases as batches complete). */
  pending: number;
  errors: string[];
  error: IpcError | null;

  runIncrementalImport: (
    targets: IncrementalImportTarget | IncrementalImportTarget[],
  ) => Promise<void>;
  reset: () => void;
}

function formatTargetError(platform: SessionPlatform, error: unknown): string {
  const normalized = toIpcError(error);
  return `${platform}: ${normalized.message}`;
}

export const useImportProgressStore = create<ImportProgressState>((set, get) => ({
  active: false,
  total: 0,
  processed: 0,
  pending: 0,
  errors: [],
  error: null,

  runIncrementalImport: async (targets) => {
    if (get().active) return;
    const queue = (Array.isArray(targets) ? targets : [targets])
      .map((target) => ({ ...target, path: target.path.trim() }))
      .filter((target) => target.path);
    if (queue.length === 0) return;

    set({
      active: true,
      total: 0,
      processed: 0,
      pending: 0,
      errors: [],
      error: null,
    });

    try {
      const scans: Array<{
        target: IncrementalImportTarget;
        pendingPaths: string[];
      }> = [];

      for (const target of queue) {
        try {
          const scan = await invoke.scanSessions(target.path, target.platform);
          scans.push({
            target,
            pendingPaths: scan.pending.map((pendingFile) => pendingFile.path),
          });
          // Unchanged files count as already processed — the progress bar jumps
          // past them quickly on app start when most files are unchanged.
          set((state) => ({
            total: state.total + scan.total,
            processed: state.processed + scan.skipped,
            pending: state.pending + scan.pending_count,
          }));
        } catch (e) {
          set((state) => ({
            errors: [...state.errors, formatTargetError(target.platform, e)],
          }));
        }
      }

      for (const { target, pendingPaths } of scans) {
        for (let i = 0; i < pendingPaths.length; i += BATCH_SIZE) {
          const batch = pendingPaths.slice(i, i + BATCH_SIZE);
          try {
            const result = await invoke.importFilesBatch(batch, target.platform);

            set((state) => ({
              processed: state.processed + result.parsed_files,
              pending: Math.max(0, state.pending - batch.length),
              errors: result.errors.length
                ? [
                    ...state.errors,
                    ...result.errors.map(
                      (item) => `${target.platform}: ${item.path}: ${item.message}`,
                    ),
                  ]
                : state.errors,
            }));

            // Refresh the session list so newly imported sessions appear
            // progressively. Outside-React access via getState() is allowed
            // by the state-management spec; documented here: this runs in the
            // import_progress store and must trigger SessionList's data source.
            if (getActivePlatform(useSettingsStore.getState().settings) === target.platform) {
              await useSessionStore.getState().fetchSessions();
            }
          } catch (e) {
            set((state) => ({
              errors: [...state.errors, formatTargetError(target.platform, e)],
            }));
            break;
          }
        }
      }

      const activePlatform = getActivePlatform(useSettingsStore.getState().settings);
      if (scans.some(({ target }) => target.platform === activePlatform)) {
        await useSessionStore.getState().fetchSessions();
      }
    } catch (e) {
      set({ error: toIpcError(e) });
    } finally {
      set({ active: false });
    }
  },

  reset: () =>
    set({ active: false, total: 0, processed: 0, pending: 0, errors: [], error: null }),
}));
