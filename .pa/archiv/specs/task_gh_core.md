# GitHub-Anbindung: Rust-Kern (Core-Worker)

Status: historisch

Repo: Orca-Worktree, in dem du laeufst (Branch ist vorbereitet). ProjectA = Tauri 2
"agentic terminal". Lies ZUERST: `src-tauri/src/gh.rs`, `src-tauri/src/api.rs`,
`src-tauri/src/bin/pa.rs`, `src-tauri/src/main.rs`, `src-tauri/src/store.rs` (Project-Struct).
FILE OWNERSHIP: NUR `src-tauri/**`. Ein paralleler Worker besitzt `src/**`. NICHT committen.
Lies niemals `.pa/secrets.json`.

## Ziel

Ein Projekt in ProjectA ist ein lokales Git-Repo. Neu: vom Projekt aus ein GitHub-Repo
erstellen (`gh repo create`) oder ein bestehendes verknuepfen. `gh.rs` hat schon
`gh_available()` und `has_github_remote(repo_path)` — darauf aufbauen.

## IMPLEMENT

1. `gh.rs`:
   - `pub fn create_github_repo(repo_path: &str, name: &str, private: bool) -> Result<String, String>`
     — spawnt `gh repo create <name> [--private|--public] --source <repo_path> --remote origin --push`,
     gebundener Wait (5s-Spawn + try_wait/kill-Muster wie in providers.rs), stdout/Remote-URL
     zurueckgeben (die URL aus `git remote get-url origin` nach Erfolg lesen — robuster als
     gh-Stdout zu parsen). Fehlerfaelle: gh fehlt ("github cli (gh) is not available"),
     Repo-Name leer/ungueltig, remote origin existiert bereits ("remote 'origin' already exists"),
     gh-Exit != 0 → stderr-Text durchreichen (gekuerzt auf 500 Zeichen).
   - `pub fn link_github_remote(repo_path: &str, url: &str) -> Result<(), String>`
     — `git remote add origin <url>`; Fehler wenn origin existiert; URL muss mit
     `https://github.com/` oder `git@github.com:` beginnen, sonst Fehler.
   - Beides rein spawn-basiert, keine neuen Dependencies.
2. Tauri-Commands in `main.rs` + HTTP-Routen in `api.rs`:
   - `create_github_repo(project_id, name, private) -> String (repo url)` /
     `POST /api/projects/<id>/github/create` mit JSON `{name, private}`
   - `link_github_remote(project_id, url) -> ()` /
     `POST /api/projects/<id>/github/link` mit JSON `{url}`
   - Projekt ueber store aufloesen (repo_path), wie die Nachbar-Commands.
   - `GET /api/projects` bzw. das bestehende Project-Listing um `github_remote: bool`
     erweitern (via `has_github_remote`), ADDITIV — bestehende Felder unveraendert.
3. `pa`-CLI (`bin/pa.rs`): `pa github create --project <id> [--name <n>] [--public]`
   (Default: private, Default-Name = Projektname) und `pa github link --project <id> <url>`.
   Konsistent zum bestehenden pa-Stil.
4. Tests: Arg-Bau und Fehlerfaelle als reine Funktionen (kein echtes gh/git noetig —
   Fehlerpfade ueber nicht-existente Repo-Pfade/commands testbar); api.rs-Wire-Test fuer
   das neue `github_remote`-Feld; pa-Render-Test fuer die neuen Subcommands (Hilfetext/
   Dispatch). Alle bestehenden Tests muessen gruen bleiben.

## VERIFY

`cd src-tauri && CARGO_BUILD_JOBS=2 cargo test` gruen, `CARGO_BUILD_JOBS=2 cargo clippy
--all-targets -- -D warnings` sauber, `cargo build` ok. NICHT committen — der Koordinator
reviewt und committet.

---
ORCA-LIFECYCLE: Du bist Orca-Worker. Task-ID und Dispatch-ID stehen in der injizierten
Praeambel bzw. werden dir im Prompt mitgeteilt. Bei Fertigstellung (alle Checks gruen)
GENAU EINMAL: orca orchestration send --type worker_done --subject "GitHub-Anbindung core
done" --body "<3 Saetze: was gebaut, was gefunden, was offen>" --task-id <TASK_ID>
--dispatch-id <DISPATCH_ID> --outcome succeeded --json. Bei Blockern:
orca orchestration ask --question "<frage>" --json. Danach idle.
