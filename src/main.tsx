import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { loadUiThemeStyle } from "./lib/settings";
import "./styles.css";
import "./design/themes/index.css";

// Mirror the stored style onto <html> before the first React paint so body
// (outside .app) does not flash Klassisch when a non-classic theme is saved.
document.documentElement.setAttribute("data-theme-style", loadUiThemeStyle());

// Browser E2E runs outside Tauri. The mock is loaded before React mounts so
// every boot-time invoke/listen crosses the same public Tauri API as production.
if (import.meta.env.DEV && import.meta.env.VITE_TAURI_MOCKS === "true") {
  await import("./test/tauriBrowserMock");
}

const container = document.getElementById("root");
if (!container) throw new Error("root element missing from index.html");

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
