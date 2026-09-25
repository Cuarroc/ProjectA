# Task: Phase 10 Queen — Chat-Steuerung (App + CLI) fuer ProjectA

Status: historisch

Du bist die **Queen/Koordinatorin** fuer Phase 10. Repo: `<repo-root>`,
Branch `main`. Phase 9 (Hierarchie-Kern) ist fertig und committed (`ffe6af4`):
`workers.rs` hat `create_queen`, `spawned_by`; `pa` kann `queen spawn`/`tree`/`--on-behalf-of`.

## Deine Rolle (wie gehabt)

- Zerlegen, an Claude-Worker dispatchen (`orca orchestration task-create` +
  `worker-start`; bei `agent_prompt_stalled`: Task auf `ready` zuruecksetzen und
  `dispatch --inject` auf den live Terminal — das hat in Phase 9 funktioniert).
- Selbst nur Integrations-/Cliffy-Fixes <= 20 Zeilen. Nicht committen, nicht pushen.
- Worker strikt datei-getrennt. Blocker: `orca orchestration ask`.
- Fertig: `worker_done` mit Dateiliste, Testnamen, Gate-Ergebnissen.

## Ziel von Phase 10

Der User steuert den Orchestrator ueber eine **Chat-Leiste in der App** und von
außen ueber **`pa tell`**. Kern: eine Funktion `send_to_orchestrator`, die den
Orchestrator bei Bedarf startet (find-or-create), den Text in seine PTY schreibt
und die Nachricht loggt.

## Anforderungen (verbindlich)

### Teil 1 — Rust (Worker A: `workers.rs`, `main.rs`, `api.rs`, `bin/pa.rs`)

1. `workers::send_to_orchestrator(store, agents, project_id, text) -> Result<Worker, String>`:
   - Laufenden Orchestrator des Projekts wiederverwenden
     (`kind == KIND_ORCHESTRATOR && status == STATUS_RUNNING && session_id.is_some()`),
     sonst `create_orchestrator(...)` (spawned_by: None).
   - Text + `\r` in die PTY des Orchestrators schreiben (gleicher Mechanismus wie
     `ApiBackend::send_to_worker`; schau dir an, wie `write_pty`/`send` in main.rs
     bzw. api.rs funktionieren).
   - Nachricht in `messages` loggen (role `user`, ueber das vorhandene `log_message`).
   - Gibt den Orchestrator-Worker zurueck (UI braucht ihn fuer den Verlauf).
2. Tauri-Command `send_to_orchestrator(project_id: String, text: String) -> Result<Worker, String>`
   in `main.rs` registrieren (in `tauri::generate_handler!` eintragen).
3. API: `POST /api/projects/<id>/orchestrator/send` mit Body `{ "text": "..." }` →
   gleiche Funktion. `ControlBackend`-Trait + `ApiBackend` erweitern.
4. `pa tell --project <projectId> "<text>"` → POST an die neue Route; Ausgabe:
   kurze Bestaetigung mit Orchestrator-Worker-ID (Stil der vorhandenen Kommandos).
5. Tests: find-or-create (legt an, wenn keiner laeuft; verwendet laufenden wieder),
   Senden schreibt in PTY + loggt Message, Fehler bei unbekanntem Projekt.

### Teil 2 — Frontend (Worker B: `src/components/CommandChat.tsx` NEU, `src/App.tsx`, `src/lib/ipc.ts`, `src/styles.css`)

6. `ipc.ts`: Wrapper `sendToOrchestrator(projectId, text): Promise<Worker>`.
7. `CommandChat.tsx`: Eingabeleiste fixiert unten im Main-Bereich (ueber der
   `StatusBar`), immer sichtbar wenn ein Projekt aktiv ist. Bestandteile:
   - Texteingabe + Senden-Button (Enter sendet, Shift+Enter neue Zeile).
   - Aufklappbarer Verlauf darueber: `list_worker_messages` des
     Orchestrator-Workers des aktiven Projekts (Muster: `HistoryView.tsx`).
     Nach dem Senden Verlauf neu laden; dezentes Pollen (wie HistoryView/Board).
   - Deaktiviert mit Hinweistext, wenn kein Projekt aktiv.
   - Fehler aus dem Command als kurze Fehlerzeile im Panel.
8. `App.tsx`: `handleSendToOrchestrator` (aktuell `App.tsx:637`, direktes writePty)
   durch den neuen Command ersetzen; nach erfolgreichem Senden Board refreshen
   (`refreshBoardRef.current()`). Der bisherige "kein laufender Orchestrator"-Fehler
   entfaellt (find-or-create). Sidebar-Orchestrator-Toggle (`Sidebar.tsx`) ruft
   intern denselben Command — Signatur von `onSendToOrchestrator` darf gleich bleiben.
9. Styling in `styles.css` im vorhandenen dunklen VS-Code-Stil; Klassen mit
   Praefix `command-chat`.

### Fixierter IPC-Vertrag (Vertrag zwischen beiden Workern)

- Command: `send_to_orchestrator`, Args `{ projectId, text }`, Return: `Worker`
  (camelCase, inkl. `spawnedBy` aus Phase 9).

## Konventionen

- Kommentare Englisch, UI-Strings Deutsch, wie im Bestand. Keine neuen Dependencies.
- Rust-Tests inline; Frontend hat keine Test-Infrastruktur (nicht hinzufuegen).

## Gates (alle muessen gruen sein)

```sh
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
npm run typecheck && npm run build
```

Bei `.rmeta`/`0xc000012d`: `CARGO_BUILD_JOBS=2` retry. NICHT `npm run tauri dev`
starten. Bei Orca "run_required": `orca orchestration run-use --id <run-id>`.
