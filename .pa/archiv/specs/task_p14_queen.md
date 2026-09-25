# Task: Phase 14 Queen — Lernschleife (Critic → Playbook → Injection)

Status: historisch

Du bist die **Queen/Koordinatorin** fuer Phase 14 von ProjectA. Repo:
`<repo-root>`, Branch `main`. Dies ist ein frischer Run; deine
Vorgaengerin hat Betriebs-Learnings in deinem Projekt-Memory hinterlassen
(`~/.claude/projects/C--Users-<user>-Desktop-ProjectA/memory/`) — lies sie zuerst,
sie enthalten wichtige Dispatch-/Terminal-Lektionen.

## Stand der Codebase (committed)

- Phase 9 (`ffe6af4`): `workers.spawned_by`, `projects.max_workers`, `KIND_QUEEN`,
  `create_queen`, Dispatcher zaehlt nur `kind='worker'`.
- Phase 10 (`ab7706f`): `workers::send_to_orchestrator` (find-or-create), CommandChat.
- Phase 11 (`9b4a2c2`): Board mit Koordinatoren-Banner, `controlledBy`-Badges.
- Phase 12 (`e608258`): Test-Gates (`testgate.rs`, `projects.test_command`,
  `workers.test_status`), Queue traegt `spawned_by`.
- Phase 13 (`124ff41`): `workers::merge_worker` mit Guards, PR via gh / lokaler Merge.
- Memory: ruflo-AgentDB pro Projekt (`ruflo.rs`, `<repo>/.pa/memory`) existiert
  bereits als ROHES Gedaecchtnis; Orchestrator-`MEMORY.md` existiert.
- One-Shot-Engine: `enhance.rs` (headless `claude -p --add-dir <tmp> --output-format
  text`, Timeout, Throwaway-Workspace, gebündelter Skill aus `resources/`).

## Deine Rolle

- Zerlegen, Claude-Worker dispatchen (strikt datei-getrennt), integrieren, selbst
  nur Fixes <= 20 Zeilen. Nicht committen/pushen. `/fast on` bei jedem neuen Worker
  (PowerShell-Weg). Erledigte Worker-Terminals schliessen. Blocker:
  `orca orchestration ask`. Abschluss: Prose-Bericht.

## Ziel von Phase 14

Nach jedem erfolgreichen Task (Karte → `done`) destilliert ein **Critic-Agent** aus
Diff + Verlauf 0–3 Learnings. Der Mensch **reviewt** sie (annehmen/editieren/verwerfen)
im neuen Learnings-Panel. Angenommene Learnings landen in `PLAYBOOK.md` im
Projekt-Root (git-versioniert) und werden ab dann **automatisch in den Task-Prompt**
neuer Worker injiziert (Kontext-Layer). Profile sind einzeln (de)aktivierbar,
Lernen pro Kategorie schaltbar.

## Anforderungen (verbindlich)

### Teil 1 — Datenmodell + Learnings-Kern (Worker A: `store.rs`, NEU `learnings.rs`, `workers.rs`, `queue.rs`, `api.rs`, `bin/pa.rs`)

1. `store.rs`: neue Tabelle `learnings` (`id, project_id, worker_id, profile_id,
   pattern_label TEXT NULL, content TEXT, status TEXT ('pending'|'approved'|'rejected'),
   created_at`) + KV-Tabelle `settings (key TEXT PRIMARY KEY, value TEXT)`.
   CRUD: `insert_learning`, `list_learnings(project_id, status?)`,
   `set_learning_status(id, status)`, `get_setting`/`set_setting`. Tests.
2. `learnings.rs`:
   - `playbook_append(repo_path, profile_id, content)`: appended an `PLAYBOOK.md` im
     Projekt-Root; Abschnitte `## Allgemein` und `## Profil: <profileId>` werden bei
     Bedarf angelegt; Learning als Bullet. Reine String-Logik separat testbar
     (Section-Insert in bestehendes Markdown, Datei existiert evtl. nicht).
   - `playbook_excerpt(repo_path, profile_id, max_chars ~4000) -> Option<String>`:
     `## Allgemein` + passender `## Profil:`-Abschnitt, bei Ueberlange neueste
     Eintraege zuerst behalten (von unten kuerzen). Rein, getestet.
   - `approve_learning(store, learning_id, final_text)`: Status + Playbook-Append
     (final_text kann editiert sein). `reject_learning`: nur Status.
3. **Injection**: `create_worker` und Dispatcher (`queue.rs` LiveLauncher) stellen dem
   Task-Text voran: `--- PROJEKT-PLAYBOOK ---\n<excerpt>\n--- TASK ---\n<task>`, wenn
   `settings['learning.worker'] != '0'` und ein Excerpt existiert. Gleiches fuer
   Queens (`learning.queen`) — deren System-Prompt-Text bleibt unberuehrt, die
   Injection geht in den Task/Domaenen-Text.
4. **Profil-Toggles**: `list_agent_profiles` liefert `enabled` (Default true) aus
   `settings['profile.<id>.enabled']`; Spawn-Pfade (create_worker, create_queen,
   create_orchestrator, create_scout, queue-dispatch) lehnen deaktivierte Profile mit
   klarer Fehlermeldung ab. Lern-Toggle je Kategorie: `settings['learning.<kat>']`,
   Default an.
5. API: `GET /api/projects/<id>/learnings`, `POST /api/learnings/<id>/approve`
   (`{"text": final}`), `POST /api/learnings/<id>/reject`. pa:
   `pa learnings list [--project <id>]`, `pa learnings approve <id> [--text ".."]`,
   `pa learnings reject <id>`. Orchestrator-Prompt: nur `learnings list` dazu
   (Sichtbarkeit), KEIN approve/reject — Review ist menschlich.

### Teil 2 — Critic (Worker B: NEU `oneshot.rs` + `critic.rs`, `enhance.rs`, `status.rs`, `main.rs`, `resources/learning-critic/`)

6. `oneshot.rs`: den Throwaway-Workspace- + Headless-Run-Mechanismus aus `enhance.rs`
   verallgemeinern (Skill-Quellverzeichnis + Input-Text parametrisierbar, Timeout,
   stdout als String). `enhance.rs` behaelt seine oeffentliche API und nutzt intern
   oneshot. Keine Verhaltensaenderung am Prompt-Master.
7. `resources/learning-critic/SKILL.md` (neuer gebündelter Skill, Englisch): bekommt
   Task-Text, `git diff --stat` + gekuerztes Diff und das Ende der `messages`-Historie;
   liefert 0–3 Learnings, striktes Ausgabeformat:
   `PATTERN: <kurz-label>` + `LEARNING: <1-2 Saetze, umsetzbar>` pro Kandidat.
   Regeln: nur dauerhaft Nuetzliches, keine Projekt-Banality, keine Rohlogs.
8. `critic.rs`: `run_critic(store, worker_id) -> Result<usize, String>` (Anzahl
   eingefuegter Learnings): sammelt Task, Diff (`diff.rs`), messages-Tail, ruft
   oneshot mit learning-critic, parst das strikte Format (Parser rein, getestet),
   insert als `pending`. Profil des Critics = Profil des Workers (gleiche Dialekt-
   Erfahrung). Fehler (CLI fehlt, Timeout, Parse-Fehler) → Err-String, nie panisch.
9. **Trigger**: Status-Engine-Transition einer Worker-Karte nach `done` → Critic
   anstossen (async, best-effort, nur wenn `learning.worker` an und das Projekt
   es erlaubt). Fehler nur loggen — ein Critic-Ausfall darf nie das Board stoeren.
10. Tauri-Commands in `main.rs` registrieren (Worker B besitzt main.rs allein):
    `list_learnings(project_id)`, `approve_learning(id, text)`, `reject_learning(id)`,
    `run_learning_critic(worker_id)` (manueller Button), `set_profile_enabled(id, enabled)`,
    `set_category_learning(category, enabled)`, `get_learning_settings()`.
    Signaturen in `learnings.rs` (Worker A) — abstimmen ueber exakt diese Namen/Args.

### Teil 3 — Frontend (Worker C: `types.ts`, `ipc.ts`, NEU `components/LearningsPanel.tsx`, `SettingsView.tsx`, `Sidebar.tsx`, `App.tsx`, `styles.css`)

11. `types.ts`: `Learning { id, projectId, workerId, profileId, patternLabel: string|null,
    content, status, createdAt }`; `AgentProfile` um `enabled: boolean`.
12. `LearningsPanel.tsx` nach dem Muster von `RecommendationsPanel.tsx`: Pending-Liste
    mit Volltext, Edit-Textarea (vorbefuellt), Annehmen/Verwerfen-Buttons, Pattern-
    Badge. Nach Aktion Liste neu laden. Platziert in der Sidebar unter den
    Empfehlungen; Badge mit Anzahl offener Learnings.
13. `SettingsView.tsx`: im Tab "Agent-Kategorien" pro Kategorie ein "Lernen"-Toggle
    (DB-backed via `set_category_learning`, NICHT mehr nur localStorage);
    Profil-Liste mit "Aktiv"-Toggle je Profil (`set_profile_enabled`).
14. `BoardView.tsx` oder Karten-Aktionen: kleiner Button "Learning" pro Karte in
    `done`, der `run_learning_critic(worker.id)` manuell ausloest.
15. `ipc.ts`: Wrapper fuer alle neuen Commands.

### Fixierte Vertraege

- Tauri-Command-Namen wie in Punkt 10, camelCase-Args.
- Learning-JSON: camelCase wie `types.ts`-Punkt 11.
- PLAYBOOK-Injection-Format: exakt die Marker `--- PROJEKT-PLAYBOOK ---` / `--- TASK ---`.

## Konventionen

Kommentare Englisch, UI-Strings Deutsch, keine neuen Dependencies, Rust-Tests inline,
Frontend ohne Test-Infra. Kein `npm run tauri dev`. Gates seriell, bei
`.rmeta`/`0xc000012d` → `CARGO_BUILD_JOBS=2` retry.

## Gates (alle gruen)

```sh
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
npm run typecheck && npm run build
```
