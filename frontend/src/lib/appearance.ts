import type { AppearanceMode, Settings } from "../ipc/types";

export const DEFAULT_APPEARANCE_MODE: AppearanceMode = "system";

export const APPEARANCE_MODES: AppearanceMode[] = ["system", "light", "dark"];

export function normalizeAppearanceMode(mode: string | undefined): AppearanceMode {
  if (mode === "light" || mode === "dark" || mode === "system") {
    return mode;
  }
  return DEFAULT_APPEARANCE_MODE;
}

export function getAppearanceMode(settings: Settings): AppearanceMode {
  return normalizeAppearanceMode(settings.appearance_mode);
}

export function getEffectiveAppearanceMode(
  mode: AppearanceMode,
  systemPrefersDark: boolean,
): "light" | "dark" {
  if (mode === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return mode;
}
