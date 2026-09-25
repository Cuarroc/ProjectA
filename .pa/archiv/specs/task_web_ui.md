# Phase 8: Web-Interface (localhost) — UI

Status: historisch

Repo: `<repo-root>`, Branch `main`. FILE OWNERSHIP: NUR `src/**`. Ein paralleler Worker besitzt `src-tauri/**`. Nicht committen.

## Vertrag (Rust-Seite baut parallel)

- `invoke('start_web_interface', { port }) -> number` (gewählter Port)
- `invoke('stop_web_interface') -> void`
- `invoke('web_interface_status') -> number|null`

## IMPLEMENT

1. `src/lib/ipc.ts`:
   - `startWebInterface(port: number): Promise<number>`
   - `stopWebInterface(): Promise<void>`
   - `getWebInterfaceStatus(): Promise<number|null>`

2. Neues `src/components/WebInterfacePanel.tsx`:
   - Zustände: `running` (boolean), `port` (number|null), `inputPort` (string), `loading`, `error`.
   - Beim Mount Status abfragen.
   - Eingabefeld für Port (default "8787").
   - Button "Starten" → `startWebInterface`; danach URL anzeigen (`http://localhost:<port>`) als anklickbarer Link (öffnet via `open` Shell-Command, falls in ipc.ts vorhanden; sonst nur Text).
   - Button "Stoppen" → `stopWebInterface`.
   - Fehler rot anzeigen.

3. `src/App.tsx`:
   - `WebInterfacePanel` in die Sidebar unterhalb von `RecommendationsPanel` oder als zusätzlicher Bereich einbinden (da wo es visuell passt; nicht in den Haupt-View legen, es ist ein Schalter, keine Vollansicht).
   - Falls Sidebar zu voll wird, alternativ neuer View `"web"` in `ViewBar` mit nur diesem Panel — aber Sidebar ist bevorzugt.

4. `src/styles.css`:
   - Panel-Stil im dunklen Theme: Eingabe + Buttons nebeneinander, Statuszeile, Link in Akzentfarbe.

## VERIFY

```bash
npm run typecheck && npm run build
```

---
ORCA-LIFECYCLE: Du bist Orca-Worker. Task-ID und Dispatch-ID werden dir mitgeteilt. Bei Fertigstellung (typecheck + build grün) GENAU EINMAL:
`orca orchestration send --type worker_done --subject "Phase 8 web UI done" --body "<3 Sätze>" --task-id <TASK_ID> --dispatch-id <DISPATCH_ID> --outcome succeeded --json`. Bei Blockern: `orca orchestration ask --question "<frage>" --json`. Danach idle.
