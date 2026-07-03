import type { SessionPlatform, Settings } from "../ipc/types";

export const DEFAULT_SESSION_PLATFORM: SessionPlatform = "codex_cli";

export const SESSION_PLATFORMS: SessionPlatform[] = ["codex_cli", "claude_code"];

export function getActivePlatform(settings: Settings): SessionPlatform {
  return settings.active_platform === "claude_code" || settings.active_platform === "codex_cli"
    ? settings.active_platform
    : DEFAULT_SESSION_PLATFORM;
}

export function getEffectivePlatformPath(
  settings: Settings,
  platform: SessionPlatform,
): string {
  const configuredPath = platform === "claude_code" ? settings.claude_path : settings.codex_path;
  const trimmedConfiguredPath = configuredPath?.trim();
  if (trimmedConfiguredPath) {
    return trimmedConfiguredPath;
  }

  if (platform === "claude_code") {
    return settings.default_claude_path?.trim() ?? "";
  }
  return settings.default_codex_path?.trim() ?? "";
}
