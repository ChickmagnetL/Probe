import { useEffect } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { i18n } from "./i18n";
import { AppView } from "./views/AppView";
import { ImportModal } from "./components/shared/ImportModal";
import { useSettingsStore } from "./stores/settings";
import { getEffectiveAppearanceMode, normalizeAppearanceMode } from "./lib/appearance";

function applyDocumentTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function App() {
  const settingsInitialized = useSettingsStore((s) => s.initialized);
  const interfaceLanguage = useSettingsStore((s) => s.settings.interface_language);
  const storedAppearanceMode = useSettingsStore((s) => s.settings.appearance_mode);
  const load = useSettingsStore((s) => s.load);

  // Load settings on mount
  useEffect(() => {
    if (!settingsInitialized) {
      void load();
    }
  }, [settingsInitialized, load]);

  // Once settings are loaded, override i18n language if persisted
  useEffect(() => {
    if (settingsInitialized && interfaceLanguage) {
      void i18n.changeLanguage(interfaceLanguage);
    }
  }, [settingsInitialized, interfaceLanguage]);

  // Apply appearance globally and keep system mode in sync with OS changes.
  useEffect(() => {
    if (!settingsInitialized) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const appearanceMode = normalizeAppearanceMode(storedAppearanceMode);
    const apply = () => {
      applyDocumentTheme(getEffectiveAppearanceMode(appearanceMode, media.matches));
    };

    apply();
    if (appearanceMode !== "system") return;

    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settingsInitialized, storedAppearanceMode]);

  return (
    <I18nextProvider i18n={i18n}>
      <HashRouter>
        <Routes>
          <Route path="*" element={<AppView />} />
        </Routes>
        <ImportModal />
      </HashRouter>
    </I18nextProvider>
  );
}

export default App;
