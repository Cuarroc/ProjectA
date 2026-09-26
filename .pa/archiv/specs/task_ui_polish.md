# Task: UI-Polish Worker

Status: historisch

Ziel: Web-Interface-Styling, Orchestrator-Toggle in der Sidebar, kleine UI-Hinweise.

## 1. Web-Interface-Styling (`src-tauri/src/web_interface.rs`)

Das aktuelle HTML in `web_interface.rs` ist sehr spartanisch. Verbessere es:
- Füge ein eingebettetes dunkles CSS in `html_document()` ein (dunkler Hintergrund #1e1e1e, helle Schrift #cccccc, Akzent #0e639c).
- `render_index()` soll Projekte als Karten/Tiles anzeigen (nicht als einfache Liste).
- `render_project()` soll eine Kopfzeile mit Projektname, Repo-Pfad als Link und klarer Markdown-Rendering-Vorschau zeigen.
- Füge einen Footer mit "ProjectA Web Interface" hinzu.
- Achte darauf, dass HTML weiterhin escaped wird (keine Sicherheitslücken einführen).
- Aktualisiere den Test `the_interface_serves_pages_and_shuts_down_cleanly` falls nötig (er prüft nur auf Substrings).

## 2. Orchestrator-Toggle in Sidebar (`src/components/Sidebar.tsx`)

- Ersetze den "Orchestrator"-Button pro Projekt durch einen visuellen Toggle-Schalter.
- Wenn der Toggle auf ON geschaltet wird, soll ein kleiner Inline-Dialog/Panel erscheinen mit:
  - Textarea für den Prompt (optional, kann leer bleiben)
  - Button "Prompt schärfen" (verwendet `enhancePrompt` aus `../lib/ipc`)
  - Button "Starten"
- Wenn der Toggle auf OFF geschaltet wird, soll ein laufender Orchestrator gestoppt/archiviert werden (zuerst nur visuell: Toggle wieder OFF setzen, Stop-Logik kann später kommen).
- Der Toggle zeigt an, ob ein Orchestrator für dieses Projekt läuft (`liveOrchestratorProjectIds`).

## 3. UI-Hinweise

- Füge in `App.tsx` bei leerem Zustand (kein Projekt, keine Sessions) einen kurzen Hinweis hinzu: "Wähle ein Projekt oder erstelle eines über das + in der Sidebar."
- Füge in `ViewBar.tsx` einen Tooltip/Title für die View-Segmente hinzu.

## Verifikation

- `npm run typecheck` muss grün sein.
- `npm run build` muss grün sein.
- `cd src-tauri && cargo test web_interface` muss grün sein.
- `cd src-tauri && cargo clippy --all-targets -- -D warnings` muss grün sein (oder zumindest keine neuen Warnungen einführen).

## Hinweise

- Lies `src-tauri/src/web_interface.rs`, `src/components/Sidebar.tsx`, `src/App.tsx`, `src/components/ViewBar.tsx` und `src/styles.css` vor der Änderung.
- Für den Masterprompt-Teil in der Sidebar: verwende einen einfachen lokalen State für den Prompt-Text; die Integration mit dem globalen Masterprompt kommt vom Masterprompt-Worker.
- Schreibe minimale, fokussierte Änderungen.
