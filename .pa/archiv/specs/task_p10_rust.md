# Phase 10 Sub-Task A (Rust): `send_to_orchestrator` — Kern, Tauri-Command, API, `pa tell`

Status: historisch

Repo: `<repo-root>`, Rust-Kern in `src-tauri/`.
Phase 9 ist committed (`ffe6af4`), der Tree ist sauber.

## Deine Dateien

Du aenderst **ausschliesslich** diese vier:

- `src-tauri/src/workers.rs`
- `src-tauri/src/main.rs`
- `src-tauri/src/api.rs`
- `src-tauri/src/bin/pa.rs`

Ein zweiter Worker sitzt **parallel im Frontend** (`src/**`). Fass **kein**
`src/`-File an, und **nicht** `src-tauri/src/scout.rs` (siehe Punkt 1 - das ist
bewusst so geloest, damit du sie nicht brauchst). Wenn du glaubst, eine andere
Datei muesse sich aendern: melde es, aendere sie nicht.

## Ziel

Der User steuert den Orchestrator per Chat aus der App und per `pa tell` von
aussen. Kern ist eine Funktion, die den Orchestrator **find-or-create**
behandelt, den Text in seine PTY schreibt und die Nachricht loggt.

## 1. `AgentControl` bekommt `write` - MIT DEFAULT-IMPL (wichtig)

`workers::AgentControl` kann heute nur `spawn`/`kill`. Zum Tippen in eine
Session fehlt ein Weg. Ergaenze im Trait:

```rust
/// Type `text` into a live session, exactly as the user would.
///
/// Defaulted because most controls never write: the test fakes in other
/// modules would otherwise all have to grow a method they do not use.
fn write(&self, _session_id: &str, _text: &str) -> Result<(), String> {
    Err("this agent control cannot write to a session".to_string())
}
```

**Die Default-Impl ist Pflicht**, nicht Geschmack: `scout.rs` hat ein eigenes
`FakeAgents`, das dir nicht gehoert. Mit Default bleibt es unberuehrt. Genau
dieses Muster nutzen `skill_packs_dir` und `start_task_delivery` schon.

Ueberschreiben musst du `write` in:
- `PtyAgents` (main.rs:189) - echte Impl ueber `PtyManager::write`, so wie
  `ApiBackend::send_to_worker` (main.rs:997-1016) es vormacht.
- `AppAgentControl` (main.rs:165), falls dieser Pfad ebenfalls schreiben koennen
  muss - sonst Default lassen und den Grund als Kommentar hinschreiben.
- `FakeAgents` in **workers.rs** (workers.rs:795) - sammelt die Writes, damit
  dein Test sie pruefen kann.

## 2. `workers::send_to_orchestrator`

```rust
pub async fn send_to_orchestrator(
    store: &Store,
    agents: &dyn AgentControl,
    project_id: &str,
    text: &str,
) -> Result<Worker, String>
```

- **Find-or-create**: einen laufenden Orchestrator des Projekts wiederverwenden
  (`kind == KIND_ORCHESTRATOR && status == STATUS_RUNNING && session_id.is_some()`),
  sonst `create_orchestrator(store, agents, project_id, None)`.
  `store.list_workers(Some(project_id))` fuellt `session_id` bereits aus der
  Session-Map - du musst sie nicht selbst nachschlagen.
- Unbekanntes Projekt: Fehler (`create_orchestrator` meldet das bereits; stell
  sicher, dass der Fehler durchkommt und nicht verschluckt wird).
- **Schreiben**: `agents.write(&session_id, &format!("{text}\r"))`. Das `\r` ist
  die Enter-Taste; ohne sie bleibt der Text auf der Prompt-Zeile stehen -
  begruende das im Kommentar so, nicht mit "fuegt \r an".
- **Loggen**: `log_message(store, &worker.id, store::MSG_USER, text)` - den
  **rohen** Text ohne `\r`.
- Rueckgabe: der Orchestrator-`Worker` (die UI braucht seine Id fuer den Verlauf).

Beachte die Reihenfolge: ein frisch erzeugter Orchestrator hat seine
`session_id` aus `create_orchestrator`; ein wiederverwendeter aus der Liste.

## 3. Tauri-Command (main.rs)

`send_to_orchestrator(project_id: String, text: String) -> Result<Worker, String>`
nach dem Muster der umstehenden Commands, und **in `tauri::generate_handler!`
eintragen** - ein nicht registrierter Command ist der klassische stille Fehler
(vgl. den Phase-8-Fix zu doppelter Registrierung: einmal, an der richtigen Stelle).

## 4. API (api.rs)

- Neue Route `POST /api/projects/<id>/orchestrator/send`, Body `{ "text": "..." }`
  -> `Worker`. Trag sie in die Routen-Tabelle im `//!`-Header ein.
- `ControlBackend`-Trait um
  `fn send_to_orchestrator(&self, project_id: &str, text: &str) -> Result<Worker, String>;`
  erweitern, `ApiBackend` (main.rs) implementieren, Fake-Backend im api.rs-Test
  mitziehen.
- Die Route gehoert in dieselbe Token-Pruefung wie die anderen (schau, wie die
  bestehende Liste der geschuetzten Pfade aufgebaut ist, und trag sie dort ein).

## 5. `pa tell` (bin/pa.rs)

`pa tell --project <projectId> "<text>"`

- POST auf die neue Route. Ausgabe: kurze Bestaetigung **mit der
  Orchestrator-Worker-Id**, im Stil der vorhandenen Kommandos (vgl. die Zeile,
  die `worker send` druckt).
- Mehrere Argumente nach den Flags wieder zusammenfuegen, so wie `worker send`
  das macht (Shells zerlegen unquotierten Text) - fehlender Text ist ein Fehler
  mit `usage:`-Zeile.
- `USAGE`, `NOTES` und den `//!`-Modul-Header mitziehen, damit sie nicht luegen.

## 6. Tests (inline, `#[cfg(test)] mod tests`, Stil des Bestands)

Mindestens:
1. **Find**: laeuft schon ein Orchestrator, wird **kein zweiter** erzeugt -
   gleiche Worker-Id, Worker-Zahl unveraendert.
2. **Create**: laeuft keiner, wird einer angelegt (`kind == KIND_ORCHESTRATOR`).
3. **Schreiben + Loggen**: der Text landet mit `\r` bei `AgentControl::write`,
   und die Message steht mit Rolle `user` und **ohne** `\r` in `messages`.
   (`log_message` schreibt ueber `tauri::async_runtime::spawn` - wenn der Test
   sonst flaky wird, pruefe die Message robust statt mit fixem Sleep.)
4. **Unbekanntes Projekt** -> `Err`.
5. `pa tell` parst; fehlender Text bzw. fehlendes `--project` ist ein Fehler.

## Konventionen

- Kommentare/Docs **Englisch** und sie erklaeren das **WARUM**, nicht das WAS.
  UI-/Prompt-Strings blieben Deutsch - du schreibst hier keine.
- Fehler als `Result<_, String>`. **Keine neuen Dependencies.**
- Minimaler Diff, kein Refactoring "bei der Gelegenheit".

## Verboten

- **Keine Git-Mutationen** (`git add/commit/checkout/stash/restore`). Der Mensch commitet.
- **Kein `npm run tauri dev`**, kein Start der App.
- Keine `src/`-Dateien, kein `scout.rs`.

## Gate

In `src-tauri/`:

```
cargo test
cargo clippy --all-targets -- -D warnings
```

Beide muessen **gruen** sein. Bei `.rmeta`/`0xc000012d`: mit
`CARGO_BUILD_JOBS=2` erneut - das ist Speicherdruck, kein Code-Problem.
Wichtig: pipe das Ergebnis **nicht** durch `tail`, ohne den Exit-Code separat
zu pruefen - sonst maskiert die Pipe einen Fehlschlag.

## Fertig

Berichte: geaenderte Dateien, die exakte Signatur von `send_to_orchestrator`,
die Namen deiner neuen Tests und beide Gate-Ergebnisse mit Exit-Code.
