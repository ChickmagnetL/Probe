import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "../../i18n";
import { invoke } from "../../ipc/invoke";
import { useSettingsStore } from "../../stores/settings";
import { useImportProgressStore } from "../../stores/import_progress";
import { SettingsTabs, type SettingsTab } from "./SettingsTabs";
import { UpdateTab } from "./UpdateTab";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const loading = useSettingsStore((s) => s.loading);
  const error = useSettingsStore((s) => s.error);
  const load = useSettingsStore((s) => s.load);
  const setCodexPath = useSettingsStore((s) => s.setCodexPath);
  const setInterfaceLanguage = useSettingsStore((s) => s.setInterfaceLanguage);
  const runIncrementalImport = useImportProgressStore((s) => s.runIncrementalImport);

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [path, setPath] = useState("");
  const [lang, setLang] = useState("");
  const [saving, setSaving] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const effectivePath = settings.codex_path ?? settings.default_codex_path ?? "";

  // Load settings when the panel opens.
  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reactive prefill: when settings finish loading and the local input is
  // still empty, sync the configured path or platform default into the input.
  useEffect(() => {
    if (open && !path && effectivePath) {
      setPath(effectivePath);
    }
  }, [open, effectivePath, path]);

  // Reactive prefill: when settings finish loading and the local draft is
  // still empty, sync interface_language (i18n fallback) into the draft.
  useEffect(() => {
    if (open && !lang) {
      setLang(settings.interface_language || i18n.language || "");
    }
  }, [open, settings.interface_language, lang]);

  // Discard unsaved drafts when the panel closes so reopening reseed from
  // the persisted values (the prefill effects above only run on empty drafts).
  useEffect(() => {
    if (!open) {
      setPath("");
      setLang("");
    }
  }, [open]);

  const handleClose = useCallback(() => {
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

  // Close language dropdown when clicking outside.
  useEffect(() => {
    if (!langOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [langOpen]);

  const handleBrowse = useCallback(async () => {
    try {
      const selected = await invoke.openFileDialog({ directory: true, title: "Select Codex CLI folder" });
      if (selected) setPath(selected);
    } catch {
      // Dialog cancelled or unavailable — keep current input.
    }
  }, []);

  const defaultHint = settings.default_codex_path;
  const currentLang = i18n.language;
  const pathDirty = path.trim() !== effectivePath.trim();
  const langDirty = lang !== (settings.interface_language || currentLang || "");
  const dirty = pathDirty || langDirty;

  const handleSave = useCallback(async () => {
    const trimmed = path.trim();
    const langValue = lang.trim();
    if (!trimmed && !langValue) return;
    setSaving(true);
    try {
      if (pathDirty && trimmed) {
        await setCodexPath(trimmed);
        void runIncrementalImport(trimmed);
      }
      if (langDirty && langValue) {
        await setInterfaceLanguage(langValue);
        await i18n.changeLanguage(langValue);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }, [
    path,
    lang,
    pathDirty,
    langDirty,
    setCodexPath,
    setInterfaceLanguage,
    runIncrementalImport,
    onClose,
  ]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="relative w-full max-w-[600px] min-h-[520px] mx-4 bg-card rounded-lg border border-border shadow-xl animate-scale-in flex flex-col">
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 btn-ghost p-1.5 z-10 hover:scale-112 active:scale-90 transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          aria-label={t("settings.close")}
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="p-8 flex flex-col flex-1">
          <h2 className="text-xl font-semibold text-foreground mb-1">{t("settings.title")}</h2>

          <div className="mb-6">
            <SettingsTabs active={activeTab} onChange={setActiveTab} />
          </div>

          <div className="flex flex-col flex-1 min-h-[300px]">
            <div className="flex-1">
              {activeTab === "general" && (
                <>
                  <div className="mb-2">
                    <p id="settings-general-title" className="text-sm font-medium text-foreground">
                      {t("settings.codexPath")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("settings.subtitle")}
                    </p>
                  </div>

                  <div className="flex gap-2 mt-4">
                    <input
                      id="codex-path-input"
                      aria-labelledby="settings-general-title"
                      type="text"
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      placeholder={defaultHint ?? "~/.codex"}
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
                      {t("settings.browse")}
                    </button>
                  </div>
                  {defaultHint && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {t("settings.default")} <span className="font-mono">{defaultHint}</span>
                    </p>
                  )}
                </>
              )}

              {activeTab === "interface" && (
                <>
                  <div className="mb-2">
                    <p id="settings-interface-title" className="text-sm font-medium text-foreground">
                      {t("settings.language")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("settings.languageHint")}
                    </p>
                  </div>
                  <div ref={langRef} className="relative mt-4">
                    <button
                      type="button"
                      aria-labelledby="settings-interface-title"
                      onClick={() => setLangOpen((v) => !v)}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-ring/40"
                    >
                      <span>{(lang || currentLang) === "zh" ? "中文" : "English"}</span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground shrink-0 ml-2">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {langOpen && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow-lg overflow-hidden">
                        {(["en", "zh"] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => {
                              setLang(value);
                              setLangOpen(false);
                            }}
                            className={`w-full px-3 py-2 text-sm text-left transition-colors ${
                              (lang || currentLang) === value
                                ? "bg-primary/10 text-foreground"
                                : "text-foreground hover:bg-accent"
                            }`}
                          >
                            {value === "zh" ? "中文" : "English"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {activeTab === "update" && (
                <UpdateTab active={activeTab === "update"} />
              )}
            </div>

            {activeTab !== "update" && error && (
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

            <div className="flex justify-end gap-3 mt-auto pt-6 border-t border-border">
              {activeTab === "update" ? (
                <button
                  onClick={handleClose}
                  className="btn-primary px-4 py-2"
                  type="button"
                >
                  {t("settings.close")}
                </button>
              ) : (
                <>
                  <button
                    onClick={handleClose}
                    className="btn-ghost px-4 py-2"
                    type="button"
                  >
                    {t("confirm.cancel")}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={loading || saving || !dirty}
                    className="btn-primary px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    type="button"
                  >
                    {saving ? t("settings.saving") : t("settings.save")}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
