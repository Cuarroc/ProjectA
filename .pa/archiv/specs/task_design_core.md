# Design Studio: Landing Pages — Core

Status: historisch

Repo: `<repo-root>`, Branch `main`. FILE OWNERSHIP: NUR `src-tauri/**`. Ein paralleler Worker besitzt `src/**`. Nicht committen.

## Ziel

Jedes Projekt bekommt eine editierbare Landing Page (Markdown-Content). Speicherung in SQLite, Abruf/Update über Tauri-Commands und Control-API.

## OpenMontage-Evaluation (NICHT implementieren)

OpenMontage ([calesthio/OpenMontage](https://github.com/calesthio/OpenMontage)) ist ein agentisches **Video-Produktionssystem** — kein Landing-Page-Builder. Für statische Projekt-Landing-Pages ist es nicht passend; wir bauen einen minimalen eigenen Markdown→HTML-Renderer.

## IMPLEMENT

1. `src-tauri/src/store.rs`:
   - Migration: `ADD COLUMN landing_page_markdown TEXT` zu `projects` (wie `skill_packs`).
   - `Project` struct um `landing_page_markdown: Option<String>` erweitern (camelCase auf Wire).
   - `create_project` initialisiert das Feld als `None`.
   - `list_projects`, `get_project` selektieren das neue Feld.
   - Neue Methoden:
     - `get_landing_page(project_id: &str) -> Result<Option<String>, String>`
     - `set_landing_page(project_id: &str, markdown: Option<&str>) -> Result<(), String>`
   - Test: Migration + Round-Trip.

2. `src-tauri/src/main.rs`:
   - Tauri-Commands `get_landing_page` und `set_landing_page` (camelCase invoke-Namen).
   - In `tauri::generate_handler!` eintragen.

3. `src-tauri/src/api.rs` (additiv):
   - `GET /api/projects/<id>/landing-page` → `{"markdown": string|null}`
   - `POST /api/projects/<id>/landing-page` mit JSON `{"markdown": string|null}` → `{"ok": true}`
   - Projektauflösung wie Nachbar-Routen; 404 wenn Projekt nicht existiert.

4. `src-tauri/src/bin/pa.rs` (optional, wenn billig):
   - `pa project landing-page --project <id>` zum Lesen
   - `pa project set-landing-page --project <id> --file <path>` (liest Dateiinhalt)
   - Nur wenn der bestehende pa-Stil das einfach erlaubt; sonst weglassen.

## VERIFY

```bash
cd src-tauri && CARGO_BUILD_JOBS=2 cargo test && CARGO_BUILD_JOBS=2 cargo clippy --all-targets -- -D warnings && CARGO_BUILD_JOBS=2 cargo build
```

---
ORCA-LIFECYCLE: Du bist Orca-Worker. Task-ID und Dispatch-ID werden dir mitgeteilt. Bei Fertigstellung (alle Checks grün) GENAU EINMAL:
`orca orchestration send --type worker_done --subject "Design Studio core done" --body "<3 Sätze>" --task-id <TASK_ID> --dispatch-id <DISPATCH_ID> --outcome succeeded --json`. Bei Blockern: `orca orchestration ask --question "<frage>" --json`. Danach idle.
