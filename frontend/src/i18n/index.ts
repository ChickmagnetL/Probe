import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

function detectLanguage(): string {
  const nav = navigator.language || "en";
  return nav.startsWith("zh") ? "zh" : "en";
}

export const i18n = i18next.createInstance();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: detectLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});
