import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SESSION_PLATFORMS } from "../../lib/session-platform";
import type { SessionPlatform } from "../../ipc/types";

interface PlatformSwitcherProps {
  activePlatform: SessionPlatform;
  onSwitch: (platform: SessionPlatform) => void | Promise<void>;
}

export function PlatformSwitcher({
  activePlatform,
  onSwitch,
}: PlatformSwitcherProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!containerRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      data-tauri-drag-region="false"
      className="relative"
    >
      <button
        onClick={() => setOpen((value) => !value)}
        className={`flex items-center gap-1 rounded-lg p-2 text-muted-foreground transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
          open
            ? "bg-muted text-foreground"
            : "hover:bg-muted hover:text-foreground hover:scale-112 active:scale-90"
        }`}
        aria-label={t("platform.switcherAria")}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? "platform-switcher-menu" : undefined}
        type="button"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="7" height="7" rx="1.5" />
          <rect x="14" y="4" width="7" height="7" rx="1.5" />
          <rect x="8.5" y="14" width="7" height="7" rx="1.5" />
        </svg>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={open ? "rotate-180 transition-transform" : "transition-transform"}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          id="platform-switcher-menu"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 min-w-36 rounded-xl border border-border bg-card/95 p-1 shadow-lg backdrop-blur"
          aria-label={t("platform.switcherAria")}
        >
          {SESSION_PLATFORMS.map((platform) => {
            const selected = platform === activePlatform;
            return (
              <button
                key={platform}
                onClick={() => {
                  setOpen(false);
                  void onSwitch(platform);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  selected
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                aria-label={t(
                  platform === "codex_cli"
                    ? "platform.codexCliAria"
                    : "platform.claudeCodeAria",
                )}
                aria-pressed={selected}
                type="button"
              >
                <span>
                  {t(platform === "codex_cli" ? "platform.codexCli" : "platform.claudeCode")}
                </span>
                {selected && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
