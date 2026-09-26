# Phase 9 Sub-Task A: main.rs an die neuen Signaturen anpassen

Status: historisch

Repo: `<repo-root>`, Rust-Kern in `src-tauri/`.

## Deine Datei

Du aenderst **ausschliesslich `src-tauri/src/main.rs`**. Andere Worker arbeiten
parallel in `src-tauri/src/bin/pa.rs` und in den Test-Fixtures anderer Module.
Fass keine andere Datei an - auch nicht "nur schnell". Wenn du glaubst, eine
andere Datei muesse sich aendern: melde es, aendere sie nicht.

## Ausgangslage

Phase 9 hat `store.rs`, `workers.rs`, `queue.rs` und `api.rs` bereits umgebaut
(uncommitted im Worktree). `main.rs` haengt noch an den alten Signaturen und
bricht den Build. `cargo check` meldet in `main.rs` genau diese fuenf Fehler:

1. `src/main.rs:1341` - `crate::queue::MAX_CONCURRENT` existiert nicht mehr.
   Die Konstante heisst jetzt `crate::queue::DEFAULT_MAX_CONCURRENT`.
2. `src/main.rs:927` - `impl ControlBackend for ApiBackend` implementiert
   `create_queen` nicht.
3. `src/main.rs:929` - `ControlBackend::create_worker` hat jetzt 5 Parameter.
4. `src/main.rs:1038` - `scout::create_scout` nimmt jetzt 4 Argumente.
5. `src/main.rs:1056` - `scout::triage_repos` nimmt jetzt 5 Argumente.

## Die Vertraege (bereits fix, lies sie im Code nach, erfinde nichts)

`src-tauri/src/api.rs`, Trait `ControlBackend`:

```rust
fn create_worker(
    &self,
    project_id: &str,
    task: &str,
    profile_id: &str,
    spawned_by: Option<String>,
) -> Result<Worker, String>;

/// Start a queen: a domain coordinator without a worktree.
fn create_queen(
    &self,
    project_id: &str,
    task: &str,
    profile_id: Option<String>,
    spawned_by: Option<String>,
) -> Result<Worker, String>;
```

`src-tauri/src/workers.rs`:

```rust
pub async fn create_worker(
    store: &Store, agents: &dyn AgentControl, project_id: &str, task: &str,
    profile_id: &str, spawned_by: Option<&str>,
) -> Result<Worker, String>;

pub async fn create_queen(
    store: &Store, agents: &dyn AgentControl, project_id: &str, domain_task: &str,
    profile_id: Option<&str>, spawned_by: Option<&str>,
) -> Result<Worker, String>;
```

`src-tauri/src/scout.rs`: `create_scout` und `triage_repos` haben beide neu ein
abschliessendes `spawned_by: Option<&str>`.

## Auftrag

1. `create_worker` in `impl ControlBackend for ApiBackend` um
   `spawned_by: Option<String>` erweitern und als `spawned_by.as_deref()` an
   `workers::create_worker` durchreichen.
2. `create_queen` in derselben `impl` ergaenzen - exakt nach dem Muster der
   danebenstehenden `create_worker`: `PtyAgents::with_port(...)` aufbauen,
   `tauri::async_runtime::block_on(workers::create_queen(...))`, danach
   `self.engine.observe_worker(&worker)`, dann `Ok(worker)`.
   `profile_id.as_deref()` und `spawned_by.as_deref()` durchreichen.
3. Die Aufrufe von `scout::create_scout` und `scout::triage_repos` bekommen
   `None` als letztes Argument - diese beiden startet die UI bzw. der Mensch,
   es gibt also keinen Controller, unter dem sie zu buchen waeren. Setz einen
   kurzen Kommentar hin, der genau dieses WARUM sagt (nicht das WAS).
4. `crate::queue::MAX_CONCURRENT` -> `crate::queue::DEFAULT_MAX_CONCURRENT`.
5. Falls `main.rs` Tauri-Commands fuer Worker-Erzeugung registriert, die
   dieselben `workers::create_*`-Funktionen rufen: ebenfalls mit `None`
   nachziehen, damit der Build durchgeht. Keine neuen Tauri-Commands erfinden.

## Konventionen

- Kommentare und Docs **Englisch**, und sie erklaeren das **WARUM**, nicht das WAS.
  Systemprompt-Texte waeren Deutsch - du schreibst hier aber keine.
- Fehler als `Result<_, String>`. **Keine neuen Dependencies.**
- Halte dich exakt an den Stil der umstehenden Methoden in derselben `impl`.
- Keine Umbauten "bei der Gelegenheit". Minimaler Diff, der den Build heilt.

## Verboten

- **Kein `git add`, `git commit`, `git checkout`, `git stash`** - keinerlei
  Git-Mutation. Der Mensch commitet.
- **Kein `npm run tauri dev`**, kein Start der App.
- Keine anderen Dateien.

## Gate

In `src-tauri/`:

```
cargo check --all-targets
```

`main.rs` darf **keine** Fehler mehr melden. Fehler aus `diff.rs`, `gh.rs`,
`providers.rs`, `status.rs`, `bin/pa.rs` sind **nicht deine** - die erledigen
andere parallel. Ignoriere sie, aber melde in deinem Abschlussbericht, welche
`main.rs`-Fehler du geheilt hast.

Bei `.rmeta`- oder `0xc000012d`-Abstuerzen: `CARGO_BUILD_JOBS=2 cargo check
--all-targets` erneut - das ist Speicherdruck, kein Code-Problem.

## Fertig

Berichte: geaenderte Zeilenbereiche, die neue `create_queen`-Implementierung im
Wortlaut, und das `cargo check`-Ergebnis fuer `main.rs`.
