# Phase 13 Sub-Task A (Rust): Merge/Push-Pipeline

Status: historisch

Repo: `<repo-root>`, Rust-Kern in `src-tauri/`.
Phase 12 ist committed (`e608258`), der Tree ist sauber.

## Deine Dateien

Du aenderst **ausschliesslich**:

- `src-tauri/src/gh.rs`
- `src-tauri/src/workers.rs`
- `src-tauri/src/main.rs`
- `src-tauri/src/api.rs`
- `src-tauri/src/bin/pa.rs`

Ein Frontend-Worker arbeitet parallel in `src/**`. Fass **kein** `src/`-File an.
Wenn du glaubst, eine andere Datei muesse sich aendern: **melde es, aendere sie nicht.**

## Ziel

Der Merge-Knopf. Eine Karte in der Spalte `ready_to_merge` wird gemergt: als PR
ueber `gh`, wenn das Repo ein GitHub-Remote hat, sonst als lokaler Merge.

**Nur der Mensch mergt.** Siehe die harte Regel unter Punkt 4 - die ist kein
Detail, sondern der Kern der Aufgabe.

## 1. `gh.rs`

Drei neue Funktionen, im Stil von `create_github_repo` (gh.rs:287): erst die
Vorbedingungen pruefen, dann `crate::providers::program_invocation("gh")` und
`std::process::Command`, blockend auf dem aufrufenden Worker-Thread.

- `pub fn create_pr(repo_path: &str, branch: &str, title: &str, body: &str) -> Result<String, String>`
  Erst den Branch **non-interaktiv** pushen (`git -C <repo> push -u origin <branch>`),
  dann `gh pr create --head <branch> --title <..> --body <..>`. Rueckgabe ist die
  **PR-URL** aus der gh-Ausgabe.
- `pub fn merge_pr(repo_path: &str, branch: &str) -> Result<(), String>`
  `gh pr merge <branch> --merge`.
- `pub fn merge_local(repo_path: &str, base_branch: &str, branch: &str) -> Result<(), String>`
  `git -C <repo> merge --no-ff <branch>`. Der Push danach ist **Sache des Aufrufers**,
  nicht dieser Funktion.

**Konflikte und jeder andere Fehler werden als Text durchgereicht** - stdout/stderr
in die Fehlermeldung, damit der Mensch im Dialog sieht, was git gesagt hat.
**Niemals still abbrechen.**

**Arg-Bau als reine Funktionen** (`build_pr_create_args`, `build_merge_args`, ...)
und **inline testen** - genau wie `build_gh_create_args` es vormacht. Das ist der
testbare Teil; die Prozessaufrufe selbst testest du nicht.

## 2. `workers::merge_worker`

**Fixierte Signatur** (weicht bewusst von der Grob-Spec ab):

```rust
pub async fn merge_worker(
    store: &Store,
    agents: &dyn AgentControl,
    engine: &crate::status::StatusEngine,
    worker_id: &str,
    remove_worktree: bool,
) -> Result<Worker, String>
```

Die `engine` steht drin, weil die Spaltenpruefung **ueber die Ableitung der
Status-Engine** laufen muss (`engine.verdict_for(worker_id).column`) und nicht
ueber das, was das UI gerade anzeigt. Der Tauri-Command in `main.rs` hat die
Engine bereits als `State`.

**Guards, genau in dieser Reihenfolge**, jeder mit einer eigenen, sprechenden
Fehlermeldung:

1. Worker existiert.
2. Spalte ist `COL_READY_TO_MERGE`.
3. Hat das Projekt ein `test_command`, muss `worker.test_status == TEST_PASS` sein.
   (Ohne `test_command` gibt es kein Gate und der Merge ist erlaubt.)
4. Der Worker hat **keine laufende Session** mehr - sonst Hinweis, erst zu
   archivieren bzw. zu beenden.

Danach:

- `gh::has_github_remote(repo_path)` wahr -> `create_pr` + `merge_pr`.
- sonst -> `merge_local` in die **Basis-Branch**. Den Default-Branch des Repos
  ermitteln (z. B. `git symbolic-ref refs/remotes/origin/HEAD`, Fallback `main`,
  dann `master`) - **dokumentiere deine Wahl und die Reihenfolge im Code**.
- Erfolg: Worker-Status auf `archived`, Lifecycle-Log
  (`"Merged via PR <url>"` bzw. `"Merged lokal in <base>"`), und das
  Board-Refresh-Event so ausloesen, wie es die anderen Statuswechsel tun
  (schau nach, wie `archive_worker` das macht, und mach es genauso).
- `remove_worktree == true` -> vorhandene Entfernung wiederverwenden
  (`crate::worktree::remove_worktree`), **nicht neu bauen**. Default ist `false`.

## 3. API

`POST /api/workers/<id>/merge`, Body `{}` oder `{"remove_worktree": bool}`.
`ControlBackend` + `ApiBackend` erweitern, Fake-Backend im api.rs-Test mitziehen,
Route in die Token-Schutzliste und in die Routen-Tabelle im `//!`-Header.

## 4. `pa worker merge` — und die harte Regel

`pa worker merge <workerId> [--remove-worktree]`, in `USAGE`, `NOTES` und den
`//!`-Modul-Header aufnehmen.

**ABER:** die System-Prompts fuer **Orchestrator und Queen** in `workers.rs`
(`orchestrator_system_prompt`, `queen_system_prompt`) duerfen `worker merge`
**NICHT** erwaehnen und die Kommandolisten dort **nicht** darum erweitern.
Mergen ist ausdruecklich Menschen-Sache. Beide Prompts enden mit einem Satz
in der Art "Ein Kommando, das nicht in dieser Liste steht, gehoert nicht zu
deiner Rolle" - dieser Satz erledigt den Rest, solange du die Liste in Ruhe
laesst. **Fass die beiden Prompt-Listen also gar nicht an.**

## 5. Tests (inline, Stil des Bestands)

Mindestens:
1. Guard: falsche Spalte -> Fehler.
2. Guard: Projekt mit `test_command`, Worker ohne `pass` -> Fehler.
3. Guard: laufende Session -> Fehler mit Hinweis aufs Archivieren.
4. Arg-Bau: `create_pr`/`merge_pr`/`merge_local` bauen die erwarteten Argumente.
5. **Lokaler Merge gegen ein echtes Git-Repo im TempDir** - genau wie die
   Tests in `worktree.rs` es mit echtem git machen. Schau sie dir an und nutz
   dieselbe Fixture-Technik.
6. `pa worker merge` parst, mit und ohne `--remove-worktree`; fehlende Id ist
   ein Fehler mit `usage:`-Zeile.

## Konventionen

- Kommentare/Docs **Englisch** (WARUM, nicht WAS). **Keine neuen Dependencies.**
- Fehler als `Result<_, String>`. Tests inline.
- Minimaler Diff, kein Refactoring "bei der Gelegenheit".

## Verboten

- **Keine Git-Mutationen am ProjectA-Repo selbst** (`git add/commit/checkout/stash`).
  Die git-Aufrufe *im Produktionscode* sind natuerlich der Sinn der Aufgabe - gemeint
  ist: committe den Worktree nicht. Der Mensch commitet.
- **Kein `npm run tauri dev`.** Keine `src/`-Dateien.
- **Setz niemals `CARGO_PROFILE_*`** - das entwertet den Dependency-Cache und
  erzwingt einen Rebuild von rund 400 Crates. `CARGO_BUILD_JOBS=2` ist der Hebel.

## Gate

In `src-tauri/`:

```
cargo check --all-targets
```

Muss gruen sein; Exit-Code separat pruefen, nicht durch `tail` maskieren.
**Starte keinen vollen `cargo test`- oder `clippy`-Lauf** - die Gesamt-Gates
fahre ich nach der Integration seriell.

## Fertig

Berichte: geaenderte Dateien, die Signaturen der neuen `gh.rs`-Funktionen, wie
du den Default-Branch ermittelst, die Namen deiner Tests, und die Bestaetigung,
dass die Orchestrator-/Queen-Prompts unveraendert sind.
