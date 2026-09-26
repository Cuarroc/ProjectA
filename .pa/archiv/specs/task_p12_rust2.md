# Phase 12 Sub-Task A2 (Rust): Test-Gate-Ausfuehrung fertigstellen

Status: historisch

Repo: `<repo-root>`, Rust-Kern in `src-tauri/`.
Phase 11 ist committed (`9b4a2c2`). Der Worktree ist **uncommitted, aber
kompilierbar** - `cargo check --all-targets` ist gruen. Nichts committen.

## Deine Dateien

Du aenderst **ausschliesslich**:

- `src-tauri/src/testgate.rs` (**neu anlegen**)
- `src-tauri/src/status.rs`
- `src-tauri/src/main.rs`
- `src-tauri/src/api.rs`

Ein Frontend-Worker hat `src/**` bereits fertig; **fass `src/` nicht an**.
`store.rs`, `queue.rs` und `bin/pa.rs` sind ebenfalls **fertig und tabu**.
Wenn du glaubst, eine andere Datei muesse sich aendern: **melde es, aendere sie nicht.**

## Was schon da ist (lies es nach, bau nicht neu)

Ein Vorgaenger-Worker hat die **Speicherschicht bereits erledigt**. In `store.rs`
existieren fertig und getestet:

- `projects.test_command`, `workers.test_status`, `workers.tested_at` samt
  Migrationen; `Project.test_command`, `Worker.test_status`, `Worker.tested_at`.
- Konstanten `TEST_PASS` (`"pass"`), `TEST_FAIL` (`"fail"`), `TEST_RUNNING` (`"running"`).
  `NULL` heisst: nie gelaufen.
- `pub fn detect_test_command(repo_path: &Path) -> Option<String>` samt Auto-Detect
  in `create_project`.
- `Store::set_project_test_command(project_id, Option<&str>)`
- `Store::set_worker_test_status(worker_id, Option<&str>, tested_at: Option<i64>)`

Ausserdem ist die Queue-Buchung (`task_queue.spawned_by`, Durchreichen im
Dispatcher, `pa queue add --on-behalf-of`) **fertig**. Finger weg.

**Deine Aufgabe ist nur noch die Ausfuehrung und die Verdrahtung.**

## Auftrag

### 1. Neues Modul `testgate.rs`

```rust
pub async fn run_test_gate(store: &Store, worker_id: &str) -> Result<Worker, String>
```

- Liest Worker + Projekt. Kein `test_command` am Projekt -> sauberer Fehler,
  **kein Panic**.
- Setzt zuerst `TEST_RUNNING`, laeuft dann auf einem Blocking-Thread
  (`tauri::async_runtime::spawn_blocking`), Arbeitsverzeichnis =
  `worker.worktree_path`.
- Ausfuehrung ueber die Shell, weil das Kommando ein `&&` enthalten kann
  (z. B. `npm test && cargo test --quiet`): unter Windows `cmd /c <command>`.
  Schau in `gh.rs`, wie dort `std::process::Command` samt `.output()` benutzt
  wird, und halte dich an den Stil. **Keine neuen Dependencies.**
- **Timeout 10 Minuten.** `std::process::Command` kennt keinen Timeout - loese
  es mit der Standardbibliothek (Kindprozess + Thread + `Receiver::recv_timeout`,
  danach `child.kill()`) und **begruende im Kommentar**, warum ein haengender
  Testlauf den Worker nicht ewig blockieren darf. Timeout zaehlt als `fail`.
- Danach `TEST_PASS`/`TEST_FAIL` + `tested_at` ueber
  `set_worker_test_status` schreiben und die **letzten ~50 Zeilen** von
  stdout+stderr als Nachricht mit Rolle `system` anhaengen
  (`crate::workers::log_message`).
- **Reine Mapping-Funktion**, z. B.
  `pub fn gate_result(exit_code: Option<i32>, timed_out: bool) -> &'static str`,
  **inline getestet**: Erfolg, Fehlschlag, vom Signal beendet (kein Code),
  Timeout.
- `mod testgate;` in `main.rs` eintragen.

### 2. Tauri-Commands (`main.rs`)

- `set_project_test_command(project_id: String, command: Option<String>) -> Result<(), String>`
- `run_worker_tests(worker_id: String) -> Result<Worker, String>`

**Beide in `tauri::generate_handler!` eintragen** - ein nicht registrierter
Command ist der klassische stille Fehler.

### 3. Auto-Trigger in `status.rs`

Wechselt eine Karte **nach `COL_IN_REVIEW`**, hat das Projekt ein
`test_command` und liegt fuer den aktuellen Stand noch kein `TEST_PASS` vor,
wird `run_test_gate` **einmalig** angestossen.

- **Async, feuern und vergessen**; Fehler nur per `eprintln!`.
- **Ein Testlauf darf die Status-Engine niemals blockieren**: kein `await`
  waehrend ein Lock gehalten wird, nichts Blockierendes im
  `observe_worker`-Pfad.
- Kein Dauerfeuer: derselbe Worker darf nicht bei jedem Poll erneut starten.
  Wie du entprellst, ist deine Entscheidung - **begruende sie im Kommentar**.
- Wenn ein sauberer Trigger hier die Engine verkompliziert oder eine
  Layering-Verletzung waere: **melde das**, statt etwas zu erzwingen. Ein
  ehrlicher Bericht ist besser als ein Trigger, der die Engine blockiert.

### 4. Board-State (`status.rs`, ggf. `api.rs`-Fixture)

`WorkerBoardState` bekommt `test_status` und `tested_at` (camelCase auf der
Leitung, wie `controlled_by` in Phase 11). Fixtures in `api.rs` mitziehen -
das sind Ein-Zeilen-Ripples.

Das Frontend erwartet auf der Karte exakt `testStatus` und `testedAt`.

## Konventionen

- Kommentare/Docs **Englisch** (WARUM, nicht WAS). **Keine neuen Dependencies.**
- Fehler als `Result<_, String>`. Tests inline.
- Minimaler Diff, kein Refactoring "bei der Gelegenheit".

## Verboten

- **Keine Git-Mutationen.** **Kein `npm run tauri dev`.**
- Keine `src/`-Dateien, kein `store.rs`, `queue.rs`, `bin/pa.rs`.
- **Setz niemals `CARGO_PROFILE_*`** - das entwertet den Dependency-Cache und
  erzwingt einen Rebuild von rund 400 Crates, den diese Maschine kaum schafft.
  `CARGO_BUILD_JOBS=2` ist der richtige Hebel.

## Gate

In `src-tauri/`:

```
cargo check --all-targets
```

Muss gruen sein; Exit-Code separat pruefen, nicht durch `tail` maskieren.
**Starte keinen vollen `cargo test`- oder `clippy`-Lauf** - die Maschine hat
wenig RAM, und die Gesamt-Gates fahre ich nach der Integration seriell.

## Fertig

Berichte: geaenderte/neue Dateien, die Signaturen von `run_test_gate` und der
Ergebnis-Mapping-Funktion, wie du den Auto-Trigger entprellst, die Namen deiner
Tests und das `cargo check`-Ergebnis mit Exit-Code.
