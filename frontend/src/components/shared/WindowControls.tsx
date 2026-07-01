import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Windows-only window control buttons (minimize / maximize-restore / close).
// macOS uses the native traffic lights (titleBarStyle: "Overlay"), so this
// component renders nothing there. Platform detection uses navigator.userAgent
// to avoid adding @tauri-apps/plugin-os as a new dependency.
function isWindows(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Win");
}

const BUTTON_BASE =
  "flex items-center justify-center w-[30px] h-[26px] rounded-lg text-muted-foreground transition-colors";

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isWindows()) return;

    const win = getCurrentWindow();
    let active = true;

    void win.isMaximized().then((value) => {
      if (active) setMaximized(value);
    });

    const promise = win.onResized(() => {
      void win.isMaximized().then((value) => {
        if (active) setMaximized(value);
      });
    });

    return () => {
      active = false;
      void promise.then((unlisten) => unlisten());
    };
  }, []);

  if (!isWindows()) return null;

  const handleMinimize = () => {
    void getCurrentWindow().minimize();
  };
  const handleToggleMaximize = () => {
    void getCurrentWindow().toggleMaximize();
  };
  const handleClose = () => {
    void getCurrentWindow().close();
  };

  return (
    <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={handleMinimize}
        aria-label="Minimize"
        className={`${BUTTON_BASE} hover:bg-muted hover:text-foreground`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <button
        type="button"
        onClick={handleToggleMaximize}
        aria-label={maximized ? "Restore" : "Maximize"}
        className={`${BUTTON_BASE} hover:bg-muted hover:text-foreground`}
      >
        {maximized ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 4h6v6" />
            <path d="M10 20H4v-6" />
            <path d="M20 4l-7 7" />
            <path d="M4 20l7-7" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="5" y="5" width="14" height="14" rx="2" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={handleClose}
        aria-label="Close"
        className={`${BUTTON_BASE} hover:bg-destructive hover:text-white`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </div>
  );
}
