# Phase 12 Sub-Task A (Rust-Kern): Test-Gates + Queue-spawned_by

Status: historisch

Repo: `<repo-root>`, Rust-Kern in `src-tauri/`.
Phase 11 ist committed (`9b4a2c2`), der Tree ist sauber.

## Deine Dateien

Du aenderst **ausschliesslich**:

- `src-tauri/src/store.rs`
- `src-tauri/src/testgate.rs` (**neu**)
- `src-tauri/src/status.rs`
- `src-tauri/src/main.rs`
- `src-tauri/src/api.rs`
- `src-tauri/src/queue.rs`

Parallel arbeiten: ein Worker im **Frontend** (`src/**`) und einer in
**`src-tauri/src/bin/pa.rs`**. Fass beides **nicht** an. Wenn du glaubst, eine
andere Datei muesse sich aendern: **melde es, aendere sie nicht.**

## Teil 1 — Test-Gates

### 1. `store.rs`: Schema

- `projects.test_command TEXT NULL` und `workers.test_status TEXT NULL` und
  `workers.tested_at INTEGER NULL`, alle drei ueber das vorhandene
  `add_missing_column`-Migrationsmuster; im Down-Test mit `DROP COLUMN`
  abdecken, genau wie bei `spawned_by`/`max_workers` in Phase 9.
- `Project` um `test_command: Option<String>`, `Worker`/`WorkerRow` um
  `test_status: Option<String>` und `tested_at: Option<i64>`. Alle betroffenen
  Queries und `WORKER_COLUMNS` nachziehen.
- `test_status` ist `"pass"`, `"fail"`, `"running"` oder `NULL` (nie gelaufen).
  Leg dafuer Konstanten an, so wie `STATUS_*`/`KIND_*` es vormachen.
- Setter: `set_project_test_command(project_id, Option<&str>)` und
  `set_worker_test_status(worker_id, Option<&str>, tested_at: Option<i64>)`.

### 2. Auto-Detect beim Anlegen

```rust
pub fn detect_test_command(repo_path: &Path) -> Option<String>
```

`package.json` -> `npm test`; `Cargo.toml` -> `cargo test --quiet`; **beide** ->
`npm test && cargo test --quiet`; keins -> `None`. **Rein und inline getestet**
mit `testutil::TempDir`-Fixtures (alle vier Faelle). `create_project` ruft sie
und schreibt das Ergebnis mit in die Zeile.

### 3./6. Tauri-Commands (`main.rs`)

- `set_project_test_command(project_id: String, command: Option<String>)`
- `run_worker_tests(worker_id: String) -> Result<Worker, String>`

**Beide in `tauri::generate_handler!` eintragen** - ein nicht registrierter
Command ist der klassische stille Fehler. `mod testgate;` nicht vergessen.

### 5. Neues Modul `testgate.rs`

`pub async fn run_test_gate(store: &Store, worker_id: &str) -> Result<Worker, String>`

- Liest Worker + Projekt. Kein `test_command` -> sauberer Fehler, **kein Panic**.
- Setzt zuerst `running`, laeuft dann auf einem Blocking-Thread
  (`tauri::async_runtime::spawn_blocking`), Arbeitsverzeichnis =
  `worker.worktree_path`.
- Ausfuehrung ueber die Shell, weil das Kommando ein `&&` enthalten kann:
  unter Windows `cmd /c <command>`. Schau in `gh.rs`, wie dort
  `std::process::Command` samt `.output()` benutzt wird, und halte dich an den
  Stil. **Keine neuen Dependencies.**
- **Timeout 10 Minuten.** `std::process::Command` kennt keinen Timeout -
  loese es mit den Mitteln der Standardbibliothek (z. B. Kindprozess + eigener
  Thread + `Receiver::recv_timeout`, danach `child.kill()`), und **begruende
  im Kommentar**, warum ein haengender Testlauf den Worker nicht ewig blockieren
  darf. Timeout zaehlt als `fail`.
- Danach `pass`/`fail` + `tested_at` schreiben und die **letzten ~50 Zeilen**
  von stdout+stderr als `messages`-Eintrag mit Rolle `system` anhaengen
  (`workers::log_message`).
- **Reine Mapping-Funktion** `pub fn gate_result(exit_code: Option<i32>, output: &str) -> &'static str`
  (oder gleichwertig) - Exit-Code + Output -> Status, **inline getestet**:
  Erfolg, Fehlschlag, vom Signal beendet/kein Code, Timeout.

### 7. Auto-Trigger in `status.rs`

Wechselt eine Karte **nach `in_review`**, hat das Projekt ein `test_command`
und liegt fuer den aktuellen Stand noch kein `pass` vor, wird `run_test_gate`
**einmalig** angestossen.

- **Async, feuern und vergessen**; Fehler nur per `eprintln!` loggen.
- **Ein Testlauf darf die Status-Engine niemals blockieren** - kein `await` im
  Lock, kein Blockieren im `observe_worker`-Pfad. Schau dir an, wie `status.rs`
  Uebergaenge feststellt, und halte den Trigger **minimal**.
- Kein Dauerfeuer: derselbe Worker darf nicht bei jedem Poll erneut starten.
  Wie du das entprellst, ist deine Entscheidung - begruende sie im Kommentar.
- Wenn ein sauberer Trigger an dieser Stelle die Engine verkompliziert oder
  eine Layering-Verletzung waere: **melde das**, statt etwas zu erzwingen.

### 8. Board-State

`WorkerBoardState` bekommt `test_status` und `tested_at` (camelCase auf der
Leitung). Die Test-Fixture in `api.rs` zieht mit - das ist genau die Art
Ein-Zeilen-Ripple wie `controlled_by` in Phase 11.

## Teil 3 — A3: Queue-`spawned_by` (Serverseite)

- `task_queue.spawned_by TEXT NULL` + Migration; `QueueEntry` um
  `spawned_by: Option<String>`; INSERT/SELECT nachziehen.
- `queue::enqueue_with_enhancer` und `queue::enqueue` nehmen
  `spawned_by: Option<String>` entgegen.
- **`LiveLauncher::launch` reicht es an `create_worker` durch** - heute steht
  dort fest `None` mit dem Kommentar, der Dispatcher habe keinen Koordinator.
  Genau das ist die Luecke: eine Queen, die wegen vollem Limit `queue add`
  benutzt, verliert sonst ihre Buchung. Kommentar entsprechend korrigieren.
- `ControlBackend::enqueue_task` + `ApiBackend` um `spawned_by`; `POST /api/queue`
  nimmt optional `spawnedBy` entgegen.
- **Test:** ein Eintrag mit `spawned_by` wird dispatcht und der erzeugte Worker
  traegt dieselbe `spawned_by`.

## Konventionen

- Kommentare/Docs **Englisch** (WARUM, nicht WAS). **Keine neuen Dependencies.**
- Fehler als `Result<_, String>`. Tests inline, `testutil::TempDir`-Fixtures.
- Minimaler Diff, kein Refactoring "bei der Gelegenheit".

## Verboten

- **Keine Git-Mutationen.** **Kein `npm run tauri dev`.**
- Keine `src/`-Dateien, kein `bin/pa.rs`.
- **Setz niemals `CARGO_PROFILE_*`** - das entwertet den Dependency-Cache und
  erzwingt einen Rebuild von ~400 Crates, den diese Maschine kaum schafft.
  `CARGO_BUILD_JOBS=2` ist erlaubt und der richtige Hebel.

## Gate

`cargo test` und `cargo clippy --all-targets -- -D warnings` in `src-tauri/`,
beide gruen. Exit-Code separat pruefen, nicht durch `tail` maskieren.
**Lauf die Gates erst, wenn du fertig bist** - der Speicher der Maschine
vertraegt keine zwei parallelen cargo-Laeufe.

## Fertig

Berichte: geaenderte/neue Dateien, die Signaturen von `detect_test_command`,
`run_test_gate` und der Ergebnis-Mapping-Funktion, wie du den Auto-Trigger
entprellst, die Namen deiner Tests und beide Gate-Ergebnisse mit Exit-Code.
