# Task: Phase 11 Queen — Board-Hierarchie (Banner + Badges) fuer ProjectA

Status: historisch

Du bist die **Queen/Koordinatorin** fuer Phase 11. Repo: `<repo-root>`,
Branch `main`. Phase 9 (`ffe6af4`) brachte `spawned_by`, `KIND_QUEEN`,
`GET /api/projects/<id>/tree`. Phase 10 (`ab7706f`) brachte `CommandChat.tsx` +
`send_to_orchestrator`. Deine Phase-9-Notiz ist hier Scope: das Frontend-`toWorkerKind`
bildet `queen`/`scout` noch auf `worker` ab und `spawnedBy` fehlt im TS-`Worker`-Typ.

## Deine Rolle (wie gehabt)

- Zerlegen, Claude-Worker dispatchen, strikt datei-getrennt; selbst nur Fixes <= 20 Zeilen.
- Nicht committen/pushen. Blocker: `orca orchestration ask`.
- Fertig: Abschlussbericht als Prose im Terminal (worker_done wird evtl. abgelehnt).

## Ziel von Phase 11

Das Kanban-Board zeigt die Agenten-Hierarchie: **Koordinatoren-Banner** ueber den
Spalten (wer steuert gerade, live, klickbar) + **Badge auf jeder Karte** ("gesteuert
von wem"). Das klassische 5-Spalten-Kanban bleibt unveraendert.

## Anforderungen (verbindlich)

### Teil 1 — Rust (Worker A: `src-tauri/src/status.rs`, ggf. `store.rs`)

1. `get_board_state` erweitern:
   - Jede Karte bekommt `controlled_by: Option<ControlledBy>` mit
     `{ worker_id, kind, label }` — aufgeloest aus `spawned_by` (Label: bei Queens die
     Domaene aus dem Task-Text nach "Queen: ", beim Orchestrator "Orchestrator", sonst
     kurzer Task-Text). `None` = vom Menschen gestartet.
   - Neue Liste `coordinators` im Board-State: alle nicht-archivierten
     orchestrator/queen/scout-Worker des Projekts mit `worker_id, kind, label, status,
     session_id` (session_id fuer "klickbar zum Terminal").
   - Reine Mapping-Funktionen, inline getestet (inkl. Fall: spawned_by zeigt auf
     archivierten/exit-Koordinator → Badge bleibt, Label trotzdem aufloesbar).
2. `BoardCard`-/`BoardState`-Serialisierung (camelCase) entsprechend erweitern;
   Doc-Kommentare im Stil der Datei.

### Teil 2 — Frontend (Worker B: `src/types.ts`, `src/lib/board.ts`, `src/components/BoardView.tsx`, `src/App.tsx`, `src/styles.css`)

3. `types.ts`: `WorkerKind` um `"queen"` + `"scout"` erweitern (heute kollabieren beide
   in `toWorkerKind`/`WorkerKind`); `Worker` um `spawnedBy: string | null`; `BoardCard`
   um `controlledBy: { workerId: string; kind: WorkerKind; label: string } | null`;
   Board-State-Typ um `coordinators: CoordinatorInfo[]` (Felder wie oben, camelCase).
   `useBoard.ts` an den erweiterten State anpassen.
4. `BoardView.tsx`:
   - **Koordinatoren-Banner** ueber den Spalten: eine Chip-Zeile, pro Koordinator ein
     Chip mit Icon (◆ Orchestrator, ♛ Queen, 🔍 Scout), Label, Live-Statuspunkt
     (gleiche `status-dot`-Klassen wie Karten). Klick auf einen Chip mit live session
     → `onOpenCoordinator(worker)` oeffnet den Terminal-Tab. Chips ohne Session sind
     deaktiviert (Tooltip: "Keine live Session").
   - **Karten-Badge** in der `board-card-chips`-Zeile: `◆ Orchestrator` /
     `♛ <Label>` / `● du` (bei `controlledBy === null`). Tooltip mit der Kette, soweit
     bekannt.
   - Die bestehende Filterlogik (`worker.kind !== "orchestrator"`) erweitern: auch
     `queen` und `scout` bekommen keine Karten in den Spalten — sie leben im Banner.
5. `App.tsx`: `onOpenCoordinator`-Handler (oeffnet/fokussiert den Tab wie
   `openWorkerTab`; Coordinators sind in `workers`-Liste enthalten — pruefen, ob
   `listWorkers` sie liefert, sonst separat laden). `sessionTitle` fuer Queens:
   `♛ Queen · <Domaene>` (Praefix-Muster wie `ORCHESTRATOR_PREFIX`).
6. `styles.css`: Banner- + Badge-Styles, Praefix `coord-`/`board-card-controller`, dunkler
   VS-Code-Stil wie Bestand.

### Fixierter Vertrag zwischen den Workern

```json
BoardState = { "cards": [ { ..., "controlledBy": { "workerId": "wk-…", "kind": "queen",
  "label": "Backend-API" } | null } ], "coordinators": [ { "workerId": "wk-…",
  "kind": "orchestrator"|"queen"|"scout", "label": "…", "status": "running"|…,
  "sessionId": "…" | null } ] }
```

(Schau dir den tatsaechlichen Board-State-Typ in `status.rs`/`useBoard.ts` an und haenge
dich an dessen reale Form — oben nur die Neuen-Felder.)

## Konventionen

Kommentare Englisch, UI-Strings Deutsch, keine neuen Dependencies, Rust-Tests inline.
Kein `npm run tauri dev`. Bei `.rmeta`/`0xc000012d`: `CARGO_BUILD_JOBS=2` retry.

## Gates (alle gruen)

```sh
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
npm run typecheck && npm run build
```
