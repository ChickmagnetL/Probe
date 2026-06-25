import { useEffect } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { i18n } from "./i18n";
import { AppView } from "./views/AppView";
import { ImportModal } from "./components/shared/ImportModal";
import { useSettingsStore } from "./stores/settings";

function App() {
  const settingsInitialized = useSettingsStore((s) => s.initialized);
  const settings = useSettingsStore((s) => s.settings);
  const load = useSettingsStore((s) => s.load);

  // Load settings on mount
  useEffect(() => {
    if (!settingsInitialized) {
      void load();
    }
  }, [settingsInitialized, load]);

  // Once settings are loaded, override i18n language if persisted
  useEffect(() => {
    if (settingsInitialized && settings.interface_language) {
      void i18n.changeLanguage(settings.interface_language);
    }
  }, [settingsInitialized, settings.interface_language]);

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
