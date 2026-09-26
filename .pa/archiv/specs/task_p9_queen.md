# Task: Phase 9 Queen — Hierarchie-Kern fuer ProjectA

Status: historisch

Du bist die **Queen/Koordinatorin** fuer die Implementierung von Phase 9 in ProjectA
(Repo: `<repo-root>`, Branch `main`, Rust-Kern in `src-tauri/`).
Du arbeitest im Orca-Orchestration-Run, der dir per Preamble zugewiesen wurde.

## Deine Rolle

- Du **zerlegst** Phase 9 in Sub-Tasks und **dispatchet** sie an Claude-Worker
  (`orca orchestration task-create --spec ...` + `orca orchestration worker-start --task <id> --worktree current --agent claude --json`).
- Du schreibst **selbst keinen Feature-Code**. Ausnahme: kleine Integrations- und
  Clippy-Fixes (<= 20 Zeilen) beim Zusammenfuehren der Worker-Ergebnisse.
- Du **commitest nicht** und pushst nicht. Der menschliche Owner committed.
- Alle Worker teilen sich denselben Checkout (main worktree). Vergib Sub-Tasks
  daher strikt **datei-getrennt**, damit sich keine zwei Worker in derselben Datei
  ins Gehege kommen.
- Bei Blockern: `orca orchestration ask --question "..." --timeout-ms 600000 --json`.
- Fertig: `worker_done` mit Dateiliste, Testnamen, Gate-Ergebnissen.

## Hintergrund (Ist-Zustand)

- Rollen heute: `worker` (eigener git-Worktree), `orchestrator`, `scout`
  (`workers.kind` in `src-tauri/src/store.rs`, Konstanten in `workers.rs`).
- Kein `spawned_by`: wer wen gestartet hat, wird nicht gespeichert.
- Dispatcher-Limit: `queue.rs` `MAX_CONCURRENT = 3`, zaehlt aktuell ALLE laufenden
  Worker inkl. Koordinatoren.
- API: `api.rs` `route()` mit `POST /api/workers` etc.; `ControlBackend`-Trait;
  Implementierung `ApiBackend`. CLI: `src-tauri/src/bin/pa.rs`.
- Detaillierter Gesamtplan (nur Abschnitt "Phase 9" ist Scope):
  `~/.kimi-code/sessions/wd_projecta_17cdd2f1fac2/session_c3e40803-8c14-4195-a928-0f400e8aa172/agents/main/plans/gamora-black-lightning-venom.md`

## Anforderungen Phase 9 (verbindlich)

1. **store.rs**:
   - `workers.spawned_by TEXT NULL` und `projects.max_workers INTEGER NULL` ueber das
     vorhandene `add_column`-Migrations-Pattern nachruesten (inkl. DROP COLUMN in den
     Down-Tests, wie bei `pr_url`/`status_events.source`).
   - `KIND_QUEEN = "queen"` Konstante.
   - `WorkerRow`/`Worker` um `spawned_by: Option<String>` erweitern; `Project` um
     `max_workers: Option<i64>`; alle betroffenen Queries anpassen.
2. **workers.rs**:
   - `pub async fn create_queen(store: &Store, agents: &dyn AgentControl, project_id: &str, domain_task: &str, profile_id: &str, spawned_by: Option<String>) -> Result<Worker, String>`
     — DIESE Signatur ist der Vertrag fuer die API-Welle; halte sie exakt ein.
     Nach Vorbild `create_orchestrator`: kein Worktree, `kind = KIND_QUEEN`,
     `task = format!("Queen: {domain_task}")`, `spawned_by` persistieren.
   - `queen_system_prompt(project_name, project_id, domain, queen_id)`: Deutsch, harte
     Regeln wie Orchestrator (plant/steuert NUR ueber `pa`, schreibt nie Code, spawnt
     Employees nur mit `pa worker spawn --on-behalf-of <queen_id>`, Eskalation an
     Orchestrator). Listet nur Queen-relevante pa-Kommandos (worker spawn/list/status/send,
     queue add/list/cancel, board, quota).
   - `create_worker`/`create_orchestrator`/`create_scout` bekommen
     `spawned_by: Option<String>` (oder Params-Struct, wenn stilgerechter).
     Aufrufstellen (main.rs, queue.rs LiveLauncher, scout.rs, api.rs) anpassen, `None`
     wo kein Controller.
   - Orchestrator-Prompt erweitern um: `pa queen spawn --project <id> --task "<Domaene>"`,
     `pa tree`, Hierarchie-Regeln (max. 3 Ebenen; Queens nur fuer Domaenen mit >= 2
     Teilaufgaben; Queens muessen `--on-behalf-of` nutzen).
3. **queue.rs**: `dispatch_project` zaehlt nur `kind == KIND_WORKER`; Limit aus
   `project.max_workers`, Fallback 4. Bestehenden Capacity-Test anpassen + neuer Test:
   Koordinatoren zaehlen nicht.
4. **api.rs**: `POST /api/workers` akzeptiert optional `spawned_by`; neu
   `POST /api/queens` `{project_id, task, profile_id?, spawned_by?}`; neu
   `GET /api/projects/<id>/tree` (verschachtelter JSON-Baum aus flacher Worker-Liste;
   Mapping-Funktion rein und getestet). `ControlBackend`-Trait + `ApiBackend` erweitern.
5. **bin/pa.rs**: `worker spawn --on-behalf-of <id>`, `queen spawn --project .. --task .. [--profile ..]`,
   `tree [--project <id>]` (eingerueckte Text-Baumansicht). Hilfetexte im Stil der
   vorhandenen.

## Konventionen

- Kommentare/Docs Englisch (jede Datei hat `//!`-Header; erklaere das WARUM).
  Systemprompt-Texte Deutsch. Fehler als `Result<_, String>`. Keine neuen Dependencies.
- Tests inline `#[cfg(test)] mod tests`, `testutil::TempDir`-Fixtures wie vorhanden.
- Worker duerfen KEIN `npm run tauri dev`, keine Git-Mutationen.

## Empfohlener Ablauf (darfst du anpassen)

- Welle 1 (1 Worker): store.rs komplett.
- Welle 2 (parallel, 2 Worker): (a) workers.rs + queue.rs, (b) api.rs + bin/pa.rs —
  (b) codet gegen die oben fixierte `create_queen`-Signatur, ohne dass (a) fertig ist.
- Integration: du pruefst die Uebergaben, fixt Kleinkram selbst.
- Abschluss-Gates (in `src-tauri/`): `cargo test` und
  `cargo clippy --all-targets -- -D warnings` — beide muessen gruen sein.
  Bei `.rmeta`/`0xc000012d`-Fehlern: `CARGO_BUILD_JOBS=2` retry (Speicherdruck, kein
  Code-Problem).

## Rückversicherung

Bei Orca-Fehlern "run_required"/"not found": zuerst
`orca orchestration run-use --id <run-id aus deiner Preamble> --json`.
