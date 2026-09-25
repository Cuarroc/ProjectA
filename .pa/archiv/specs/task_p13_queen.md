# Task: Phase 13 Queen — Merge/Push-Pipeline fuer ProjectA

Status: historisch

Du bist die **Queen/Koordinatorin** fuer Phase 13. Repo: `<repo-root>`,
Branch `main`. Stand: Phase 9–12 committed (Hierarchie, Chat, Board-Banner, Test-Gates;
`workers.test_status`, `projects.test_command`, Board-Spalte `ready_to_merge` existieren).
Regeln: `/fast on` bei jedem neuen Worker (via PowerShell-Weg, nicht Git Bash),
Worker datei-getrennt, erledigte Worker-Terminals nach worker_done schliessen
(`orca terminal close`), selbst nur kleine Fixes, NICHT committen. RAM ist jetzt
entspannter (7 GB frei), Gates trotzdem seriell.

## Ziel von Phase 13

Der Merge-Button: Eine Karte in `ready_to_merge` wird per Klick gemergt — als PR ueber
`gh`, wenn das Repo ein GitHub-Remote hat, sonst als lokaler Merge + optionalem Push.
**Nur der Mensch mergt** (UI-Button + `pa worker merge`); der Orchestrator-Prompt
bekommt das Kommando NICHT. Bei rotem/fehlendem Test-Gate ist der Merge gesperrt.

## Anforderungen (verbindlich)

### Teil 1 — Rust (Worker A: `gh.rs`, `workers.rs`, `api.rs`, `bin/pa.rs`)

1. `gh.rs`:
   - `gh::create_pr(repo_path, branch, title, body) -> Result<String, String>` (PR-URL).
     Branch zuerst non-interaktiv pushen (`git -C <repo> push -u origin <branch>`),
     dann `gh pr create --head <branch> --title .. --body ..`. gh-Aufrufe blockend auf
     Worker-Thread (Muster: `gh.rs` `create_github_repo`).
   - `gh::merge_pr(repo_path, branch) -> Result<(), String>` → `gh pr merge <branch> --merge`.
   - `merge_local(repo_path, base_branch, branch) -> Result<(), String>` →
     `git -C <repo> merge --no-ff <branch>`; danach optionaler Push ist Aufgabe des
     Aufrufers. Konflikt-Fehler textuell durchreichen (nie still abbrechen).
   - Arg-Bau als reine Funktionen testen (Muster: `build_gh_create_args`-Tests).
2. `workers::merge_worker(store, agents, worker_id) -> Result<Worker, String>`:
   Guards in dieser Reihenfolge: Worker existiert; Board-Spalte ist `ready_to_merge`
   (ueber die Status-Engine-Ableitung, nicht das UI); wenn das Projekt ein
   `test_command` hat, muss `test_status == "pass"` sein; Worker hat keine laufende
   Session mehr (sonst Hinweis, erst archivieren/beenden).
   Dann: GitHub-Remote vorhanden (`gh::has_github_remote`)? → create_pr + merge_pr.
   Sonst → merge_local in die Basis-Branch (Default-Branch des Repos ermitteln,
   z.B. ueber `git symbolic-ref refs/remotes/origin/HEAD` oder Fallback `main`/`master`,
   Dokumentation der Wahl im Code). Erfolg → Worker-Status `archived`, Lifecycle-Log
   ("Merged via PR <url>" / "Merged lokal in <base>"), Board-Refresh-Event wie bei
   anderen Statuswechseln. Optionaler Parameter `remove_worktree: bool` (Default false;
   true = Worktree nach Merge entfernen — vorhandene Worktree-Entfernung wiederverwenden).
3. API: `POST /api/workers/<id>/merge` (Body `{}` oder `{"remove_worktree": bool}`) →
   `merge_worker`. `ControlBackend` + `ApiBackend` erweitern.
4. `pa worker merge <workerId> [--remove-worktree]`. In der `pa`-Hilfe aufnehmen,
   aber NICHT in den Orchestrator-/Queen-Systemprompts erwähnen (die duerfen nicht
   mergen — das bleibt Menschen-Sache).
5. Tests: Guards (falsche Spalte, fehlender Test-Pass, laufende Session), Arg-Bau,
   Local-Merge-Pfad gegen ein TempDir-Git-Repo (echtes git, wie die worktree.rs-Tests).

### Teil 2 — Frontend (Worker B: `BoardView.tsx`, `ipc.ts`, `types.ts` falls noetig, `styles.css`)

6. Merge-Button auf Karten in `ready_to_merge` (primaere Aktion in der Karten-Zeile):
   - Disabled mit Tooltip-Begruendung, wenn `testCommand` gesetzt und
     `testStatus !== "pass"` ("Tests erst gruen machen").
   - Klick → Bestaetigungs-Dialog (klein, inline oder Modal im Stil von
     NewWorkerDialog): PR-Titel (default: Task-Text), Checkbox "Worktree nach Merge
     entfernen" (default aus), Hinweis ob PR-via-gh oder lokaler Merge greift
    (das weiss das Frontend aus `project.githubRemote`).
   - Erfolg → Board-Refresh (Karte wandert nach done), Fehler als rote Zeile im Dialog.
7. `ipc.ts`: `mergeWorker(workerId, removeWorktree): Promise<Worker>`.

### Fixierter Vertrag

- Tauri-Command: `merge_worker(workerId: string, removeWorktree: boolean) -> Worker`.
- Fehler kommen als String und werden im Dialog verbatim gezeigt.

## Konventionen

Kommentare Englisch, UI-Strings Deutsch, keine neuen Dependencies, Rust-Tests inline.
Kein `npm run tauri dev`. Gates seriell.

## Gates (alle gruen)

```sh
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
npm run typecheck && npm run build
```
