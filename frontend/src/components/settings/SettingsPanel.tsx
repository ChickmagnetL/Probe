import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "../../i18n";
import { invoke } from "../../ipc/invoke";
import type { AppearanceMode } from "../../ipc/types";
import { APPEARANCE_MODES, getAppearanceMode } from "../../lib/appearance";
import { getEffectivePlatformPath } from "../../lib/session-platform";
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
  const initialized = useSettingsStore((s) => s.initialized);
  const load = useSettingsStore((s) => s.load);
  const setCodexPath = useSettingsStore((s) => s.setCodexPath);
  const setClaudePath = useSettingsStore((s) => s.setClaudePath);
  const setInterfaceLanguage = useSettingsStore((s) => s.setInterfaceLanguage);
  const setAppearanceMode = useSettingsStore((s) => s.setAppearanceMode);
  const setAutoSync = useSettingsStore((s) => s.setAutoSync);
  const runIncrementalImport = useImportProgressStore((s) => s.runIncrementalImport);

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [codexPath, setCodexPathDraft] = useState("");
  const [claudePath, setClaudePathDraft] = useState("");
  const [lang, setLang] = useState("");
  const [appearanceMode, setAppearanceModeDraft] = useState<AppearanceMode>("system");
  const [autoSyncDraft, setAutoSyncDraft] = useState(true);
  const [saving, setSaving] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const appearanceRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const draftsHydratedRef = useRef(false);
  const effectiveCodexPath = getEffectivePlatformPath(settings, "codex_cli");
  const effectiveClaudePath = getEffectivePlatformPath(settings, "claude_code");
  const savedAppearanceMode = getAppearanceMode(settings);

  // Load settings when the panel opens.
  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Seed the draft inputs once per open cycle so later user edits are not
  // overwritten while the panel remains open.
  useEffect(() => {
    if (!open || draftsHydratedRef.current || loading || !initialized) return;
    setCodexPathDraft(effectiveCodexPath);
    setClaudePathDraft(effectiveClaudePath);
    setLang(settings.interface_language || i18n.language || "");
    setAppearanceModeDraft(savedAppearanceMode);
    setAutoSyncDraft(Boolean(settings.auto_sync !== false));
    draftsHydratedRef.current = true;
  }, [
    open,
    loading,
    initialized,
    effectiveCodexPath,
    effectiveClaudePath,
    settings.interface_language,
    settings.auto_sync,
    savedAppearanceMode,
  ]);

  // Discard unsaved drafts when the panel closes so reopening rehydrates from
  // the persisted values exactly once for the next open cycle.
  useEffect(() => {
    if (!open) {
      setCodexPathDraft("");
      setClaudePathDraft("");
      setLang("");
      setAppearanceModeDraft("system");
      setAutoSyncDraft(true);
      setAppearanceOpen(false);
      setLangOpen(false);
      draftsHydratedRef.current = false;
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

  // Close appearance dropdown when clicking outside.
  useEffect(() => {
    if (!appearanceOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (appearanceRef.current && !appearanceRef.current.contains(e.target as Node)) {
        setAppearanceOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [appearanceOpen]);

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

  const handleBrowse = useCallback(async (platform: "codex_cli" | "claude_code") => {
    try {
      const selected = await invoke.openFileDialog({
        directory: true,
        title:
          platform === "codex_cli"
            ? "Select Codex CLI folder"
            : "Select Claude Code folder",
      });
      if (!selected) return;
      if (platform === "codex_cli") {
        setCodexPathDraft(selected);
        return;
      }
      setClaudePathDraft(selected);
    } catch {
      // Dialog cancelled or unavailable — keep current input.
    }
  }, []);

  const defaultCodexHint = settings.default_codex_path;
  const defaultClaudeHint = settings.default_claude_path;
  const currentLang = i18n.language;
  const appearanceModeLabels: Record<AppearanceMode, string> = {
    system: t("settings.appearanceSystem"),
    light: t("settings.appearanceLight"),
    dark: t("settings.appearanceDark"),
  };
  const codexPathDirty = codexPath.trim() !== effectiveCodexPath.trim();
  const claudePathDirty = claudePath.trim() !== effectiveClaudePath.trim();
  const langDirty = lang !== (settings.interface_language || currentLang || "");
  const appearanceModeDirty = appearanceMode !== savedAppearanceMode;
  const autoSyncDirty = autoSyncDraft !== Boolean(settings.auto_sync !== false);
  const dirty = codexPathDirty || claudePathDirty || langDirty || appearanceModeDirty || autoSyncDirty;

  const handleSave = useCallback(async () => {
    const codexValue = codexPath.trim();
    const claudeValue = claudePath.trim();
    const langValue = lang.trim();
    if (!dirty) return;
    setSaving(true);
    try {
      const importTargets: Array<{ platform: "codex_cli" | "claude_code"; path: string }> = [];
      if (codexPathDirty) {
        await setCodexPath(codexValue);
        const nextCodexImportPath = codexValue || defaultCodexHint?.trim() || "";
        if (nextCodexImportPath) {
          importTargets.push({ platform: "codex_cli", path: nextCodexImportPath });
        }
      }
      if (claudePathDirty) {
        await setClaudePath(claudeValue);
        const nextClaudeImportPath = claudeValue || defaultClaudeHint?.trim() || "";
        if (nextClaudeImportPath) {
          importTargets.push({ platform: "claude_code", path: nextClaudeImportPath });
        }
      }
      if (importTargets.length > 0) {
        void runIncrementalImport(importTargets);
      }
      if (langDirty && langValue) {
        await setInterfaceLanguage(langValue);
        await i18n.changeLanguage(langValue);
      }
      if (appearanceModeDirty) {
        await setAppearanceMode(appearanceMode);
      }
      if (autoSyncDirty) {
        await setAutoSync(autoSyncDraft);
      }
      setAppearanceOpen(false);
      setLangOpen(false);
    } finally {
      setSaving(false);
    }
  }, [
    codexPath,
    claudePath,
    lang,
    dirty,
    codexPathDirty,
    claudePathDirty,
    langDirty,
    appearanceMode,
    appearanceModeDirty,
    autoSyncDraft,
    autoSyncDirty,
    setCodexPath,
    setClaudePath,
    setInterfaceLanguage,
    setAppearanceMode,
    setAutoSync,
    runIncrementalImport,
    defaultCodexHint,
    defaultClaudeHint,
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
                    <div className="flex items-center justify-between">
                      <p id="settings-general-title" className="text-sm font-medium text-foreground">
                        {t("settings.sessionPaths")}
                      </p>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={autoSyncDraft}
                          onChange={(e) => setAutoSyncDraft(e.target.checked)}
                          className="w-4 h-4 rounded border-border text-primary focus:ring-ring/30"
                        />
                        <span className="text-sm text-foreground">{t("settings.autoSync")}</span>
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("settings.subtitle")}
                    </p>
                  </div>

                  <div className="mt-4 space-y-5">
                    <div>
                      <label
                        htmlFor="codex-path-input"
                        className="block text-sm font-medium text-foreground"
                      >
                        {t("settings.codexPath")}
                      </label>
                      <div className="flex gap-2 mt-2">
                        <input
                          id="codex-path-input"
                          aria-labelledby="settings-general-title"
                          type="text"
                          value={codexPath}
                          onChange={(e) => setCodexPathDraft(e.target.value)}
                          placeholder={defaultCodexHint ?? "~/.codex"}
                          spellCheck={false}
                          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                        />
                        <button
                          onClick={() => {
                            void handleBrowse("codex_cli");
                          }}
                          className="btn-secondary flex items-center gap-2"
                          type="button"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                          </svg>
                          {t("settings.browse")}
                        </button>
                      </div>
                      {defaultCodexHint && (
                        <p className="text-xs text-muted-foreground mt-2">
                          {t("settings.default")} <span className="font-mono">{defaultCodexHint}</span>
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="claude-path-input"
                        className="block text-sm font-medium text-foreground"
                      >
                        {t("settings.claudePath")}
                      </label>
                      <div className="flex gap-2 mt-2">
                        <input
                          id="claude-path-input"
                          type="text"
                          value={claudePath}
                          onChange={(e) => setClaudePathDraft(e.target.value)}
                          placeholder={defaultClaudeHint ?? "~/.claude"}
                          spellCheck={false}
                          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                        />
                        <button
                          onClick={() => {
                            void handleBrowse("claude_code");
                          }}
                          className="btn-secondary flex items-center gap-2"
                          type="button"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                          </svg>
                          {t("settings.browse")}
                        </button>
                      </div>
                      {defaultClaudeHint && (
                        <p className="text-xs text-muted-foreground mt-2">
                          {t("settings.default")} <span className="font-mono">{defaultClaudeHint}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </>
              )}

              {activeTab === "interface" && (
                <>
                  <div className="space-y-6">
                    <div>
                      <div className="mb-2">
                        <p id="settings-appearance-title" className="text-sm font-medium text-foreground">
                          {t("settings.appearance")}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("settings.appearanceHint")}
                        </p>
                      </div>
                      <div ref={appearanceRef} className="relative mt-4">
                        <button
                          type="button"
                          aria-labelledby="settings-appearance-title"
                          onClick={() => {
                            setAppearanceOpen((v) => !v);
                            setLangOpen(false);
                          }}
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-ring/40"
                        >
                          <span>{appearanceModeLabels[appearanceMode]}</span>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground shrink-0 ml-2">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                        {appearanceOpen && (
                          <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow-lg overflow-hidden">
                            {APPEARANCE_MODES.map((value) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() => {
                                  setAppearanceModeDraft(value);
                                  setAppearanceOpen(false);
                                }}
                                className={`w-full px-3 py-2 text-sm text-left transition-colors ${
                                  appearanceMode === value
                                    ? "bg-primary/10 text-foreground"
                                    : "text-foreground hover:bg-accent"
                                }`}
                              >
                                {appearanceModeLabels[value]}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2">
                        <p id="settings-language-title" className="text-sm font-medium text-foreground">
                          {t("settings.language")}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("settings.languageHint")}
                        </p>
                      </div>
                      <div ref={langRef} className="relative mt-4">
                        <button
                          type="button"
                          aria-labelledby="settings-language-title"
                          onClick={() => {
                            setLangOpen((v) => !v);
                            setAppearanceOpen(false);
                          }}
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
                    </div>
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
