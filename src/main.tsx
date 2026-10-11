import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { AppErrorBoundary } from "./errors/AppErrorBoundary";
import { installFrontendErrorHandlers } from "./errors/reportFrontendError";
import "./styles.css";

// Browser E2E runs outside Tauri. The mock is loaded before React mounts so
// every boot-time invoke/listen crosses the same public Tauri API as production.
if (import.meta.env.DEV && import.meta.env.VITE_TAURI_MOCKS === "true") {
  await import("./test/tauriBrowserMock");
}

const disposeErrorHandlers = installFrontendErrorHandlers();
if (import.meta.hot) import.meta.hot.dispose(disposeErrorHandlers);

const container = document.getElementById("root");
if (!container) throw new Error("root element missing from index.html");

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </React.StrictMode>,
);
