import React from "react";
import ReactDOM from "react-dom/client";
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
}

bootstrap();
