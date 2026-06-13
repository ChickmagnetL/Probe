import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import "./index.css";

async function bootstrap() {
  // In browser mode (no Tauri), install the dev-mock IPC layer
  if (!window.__TAURI_INTERNALS__) {
    const { installDevMock } = await import("./dev-mock");
    installDevMock();
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

  // Complement the Rust-side window.set_focus() by re-focusing after the
  // webview content is rendered, avoiding an intermittent macOS focus bug
  // with titleBarStyle: "Overlay".
  if (window.__TAURI_INTERNALS__) {
    requestAnimationFrame(async () => {
      try {
        await getCurrentWindow().setFocus();
      } catch {
        // Focus is non-critical; ignore failures.
      }
    });
  }
}

bootstrap();
