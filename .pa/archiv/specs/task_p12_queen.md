# Task: Phase 12 Queen — Test-Gates (+ Queue-SpawnedBy, pa recommendations accept)

Status: historisch

Du bist die **Queen/Koordinatorin** fuer Phase 12. Repo: `<repo-root>`,
Branch `main`. Stand: Phase 9–11 committed (Hierarchie-Kern, Chat, Board-Hierarchie).
`/fast on` bei jedem neuen Claude-Worker nach dem Start, vor dem Dispatch.

## Deine Rolle (wie gehabt)

- Zerlegen, Claude-Worker dispatchen, strikt datei-getrennt; selbst nur Fixes <= 20 Zeilen.
- Nicht committen/pushen. Blocker: `orca orchestration ask`. Abschluss: Prose-Bericht.

## Hauptziel: Test-Gates

Jeder Worker-Branch bekommt ein Test-Gate: die App weiss pro Projekt, welches
Test-Kommando gilt, kann es im Worktree des Workers laufen lassen und zeigt das
Ergebnis auf der Board-Karte. Bei Rot ist der (in Phase 13 kommende) Merge gesperrt.

### Teil 1 — Rust (Worker A: `store.rs`, NEU `testgate.rs`, `status.rs`, `main.rs`)

1. `projects.test_command TEXT NULL` + Migration (add_column-Pattern, DROP in Down-Tests).
   `Project`-Struct erweitern.
2. Auto-Detect in `create_project`: `package.json` im Repo-Root → `npm test`;
   `Cargo.toml` → `cargo test --quiet`; beide → `npm test && cargo test --quiet`;
   keins → `NULL`. Reine Funktion `detect_test_command(repo_path) -> Option<String>`,
   inline getestet (TempDir-Fixtures).
3. Tauri-Command `set_project_test_command(project_id, command: Option<String>)`.
4. `workers.test_status TEXT NULL` (`pass`/`fail`/`running`, `NULL` = nie gelaufen) +
   `workers.tested_at INTEGER NULL` + Migration; `Worker`-Struct erweitern.
5. Neues Modul `testgate.rs`: `run_test_gate(store, worker_id)` — liest Worker +
   Projekt, laeuft synchron auf Blocking-Thread (`std::process::Command`, Shell-Aufruf
   `cmd /c` unter Windows — schau, wie pty.rs/gh.rs Kommandos ausfuehren), Timeout
   10 min, Arbeitspfad = `worktree_path`. Setzt `running` → `pass`/`fail`, `tested_at`,
   und haengt die letzten ~50 Output-Zeilen als `messages`-Eintrag (role `system`) an.
   Reine Ergebnis-Mapping-Funktion (exit code + output → status) inline testen.
6. Tauri-Command `run_worker_tests(worker_id) -> Result<Worker, String>`.
7. Auto-Trigger in `status.rs`: wenn eine Karte Richtung `in_review` wechselt, das
   Projekt ein `test_command` hat und fuer den aktuellen Stand noch kein `pass`
   vorliegt → einmalig `run_test_gate` anstossen (async, Fehler nur loggen; nie darf
   ein Test-Lauf die Status-Engine blockieren). Schau dir an, wie status.rs
   Transitionen behandelt, und halte den Trigger minimal.
8. Board-State: Karte bekommt `test_status` + `tested_at` (camelCase).

### Teil 2 — Frontend (Worker B: `types.ts`, `BoardView.tsx`, `SettingsView.tsx`, `ipc.ts`, `styles.css`)

9. `types.ts`: `BoardCard` um `testStatus: "pass"|"fail"|"running"|null`, `testedAt:
   number|null`; `Project` um `testCommand: string | null`.
10. `BoardView.tsx`: Test-Badge in der Chip-Zeile der Karte: ✅ pass / ❌ fail /
    ⟳ running / – nicht gelaufen; Tooltip mit Zeitpunkt + Kommando. Zusaetzlich ein
    kleiner "Tests"-Button in den Karten-Aktionen, der `runWorkerTests(worker.id)`
    aufruft (nur wenn das Projekt ein testCommand hat — dazu muss die Board-View das
    aktive Projekt kennen; schau, was App.tsx bereits durchreicht).
11. `SettingsView.tsx`: neuer Abschnitt im passenden Tab: Test-Kommando des aktiven
    Projekts anzeigen/aendern (`set_project_test_command`; leeres Feld = Auto-Detect
    beim naechsten Anlegen bzw. kein Gate). Hinweis-Text auf Deutsch.
12. `ipc.ts`: Wrapper `runWorkerTests`, `setProjectTestCommand`.

### Teil 3 — Kleinst-Tasks (Worker A oder du selbst, <= 30 Zeilen gesamt)

13. **A3 Queue-spawned_by**: `task_queue`-Tabelle um `spawned_by TEXT NULL` erweitern,
    `QueueEntry`-Struct, `pa queue add --on-behalf-of <workerId>`, Dispatcher
    (`queue.rs` `LiveLauncher::launch`) reicht es an `create_worker` durch. API
    `POST /api/queue` akzeptiert es. Test: dispatchen uebernimmt spawned_by.
14. **A4 pa recommendations accept/dismiss**: `pa recommendations accept <id>` →
    `POST /api/recommendations/<id>/accept`, `pa recommendations dismiss <id>` →
    `POST /api/recommendations/<id>/status` mit dismissed (schau dir die API-Routen
    an). Hilfetexte + USAGE-Header ergaenzen.

## Konventionen

Kommentare Englisch, UI-Strings Deutsch, keine neuen Dependencies, Rust-Tests inline.
Kein `npm run tauri dev`. RAM ist knapp: Builds seriell (`CARGO_BUILD_JOBS=2`), keine
parallelen cargo-Laeufe zweier Worker (datei-getrennte Worker duerfen parallel
*schreiben*, aber Gates erst nach Integration durch dich).

## Gates (alle gruen)

```sh
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
npm run typecheck && npm run build
```
