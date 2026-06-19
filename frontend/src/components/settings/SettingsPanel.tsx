import { useEffect, useState, useCallback } from "react";
import { invoke } from "../../ipc/invoke";
import { useSettingsStore } from "../../stores/settings";
import { useImportProgressStore } from "../../stores/import_progress";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const settings = useSettingsStore((s) => s.settings);
  const loading = useSettingsStore((s) => s.loading);
  const error = useSettingsStore((s) => s.error);
  const load = useSettingsStore((s) => s.load);
  const setCodexPath = useSettingsStore((s) => s.setCodexPath);
  const runIncrementalImport = useImportProgressStore((s) => s.runIncrementalImport);

  const [path, setPath] = useState("");
  // Saving state is local: it represents an in-progress `setCodexPath` save,
  // distinct from `loading` (which is the settings *read* state). Reading
  // settings must not block closing the panel or show "Saving...".
  const [saving, setSaving] = useState(false);

  // Load settings when the panel opens.
  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reactive prefill: when settings finish loading and the local input is
  // still empty, sync the persisted codex_path into the input. The open-only
  // effect above may run while the read is still in flight (path stays ""),
  // so we also sync here once a value arrives.
  useEffect(() => {
    if (open && !path && settings.codex_path) {
      setPath(settings.codex_path);
    }
  }, [open, settings.codex_path, path]);

  const handleClose = useCallback(() => {
    // Closing the panel is never blocked by a settings read; the background
    // import runs independently of the panel.
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  const handleBrowse = useCallback(async () => {
    try {
      const selected = await invoke.openFileDialog({ directory: true, title: "Select Codex CLI folder" });
      if (selected) setPath(selected);
    } catch {
      // Dialog cancelled or unavailable — keep current input.
    }
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = path.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await setCodexPath(trimmed);
      // Trigger incremental import for the newly configured path.
      void runIncrementalImport(trimmed);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [path, setCodexPath, runIncrementalImport, onClose]);

  if (!open) return null;

  const defaultHint = settings.default_codex_path;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="relative w-full max-w-lg mx-4 bg-card rounded-lg border border-border shadow-xl animate-scale-in">
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 btn-ghost p-1.5 z-10 hover:scale-112 active:scale-90 transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          aria-label="Close settings"
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="p-8">
          <h2 className="text-xl font-semibold text-foreground mb-1">Settings</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Configure where Probe scans for Codex CLI sessions.
          </p>

          <label
            htmlFor="codex-path-input"
            className="block text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2"
          >
            Codex CLI Path
          </label>
          <div className="flex gap-2 mb-2">
            <input
              id="codex-path-input"
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="~/.codex"
              spellCheck={false}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
            <button
              onClick={handleBrowse}
              className="btn-secondary flex items-center gap-2"
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              Browse
            </button>
          </div>
          {defaultHint && (
            <p className="text-xs text-muted-foreground">
              Default: <span className="font-mono">{defaultHint}</span>
            </p>
          )}

          {error && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500 shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              <div>
                <p className="font-semibold text-red-800">{error.code}</p>
                <p className="mt-0.5 text-red-600">{error.message}</p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={handleClose}
              className="btn-ghost px-4 py-2"
              type="button"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading || saving || !path.trim()}
              className="btn-primary px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
