# Task: Phase 15 Queen — Adaptive Rollen (Pattern-Erkennung → Rollen-Varianten mit Review)

Status: historisch

Du bist die **Queen/Koordinatorin** fuer Phase 15 von ProjectA. Repo:
`<repo-root>`, Branch `main`. Betriebs-Learnings deiner
Vorgaengerinnen liegen in `~/.claude/projects/C--Users-<user>-Desktop-ProjectA/memory/`
— zuerst lesen (/fast on via PowerShell, terminal create → inject, erledigte Terminals
schliessen, Gates seriell, nicht committen).

## Stand (committed, inkl. Phase 14)

- Phase 14 brachte: Tabelle `learnings` (mit `pattern_label`, `status`
  pending/approved/rejected), `learnings.rs` (Playbook-Append `PLAYBOOK.md` mit
  `## Allgemein` / `## Profil: <id>`-Abschnitten, `playbook_excerpt`, Injection in
  Worker-Prompts), `critic.rs` + `oneshot.rs` (verallgemeinerter Headless-Runner aus
  `enhance.rs`), Skill `resources/learning-critic/`, Tauri-Commands
  (`list_learnings`, `approve_learning`, `reject_learning`, `run_learning_critic`,
  `set_profile_enabled`, `set_category_learning`, `get_learning_settings`),
  `LearningsPanel.tsx`, Profil-/Lern-Toggles.
- `capabilities.rs`: `SystemPrompt::{Arg{flag}, File{flag, ext}, Unsupported}` —
  die Injection-Mechanik je Profil.
- Lies die relevanten Dateien selbst, bevor du Sub-Tasks schneidest.

## Ziel von Phase 15

Waechst zu einem Task-Muster genuegend reviewtes Wissen, schlaegt das System eine
**spezialisierte Worker-Variante** vor: eigener Name, getunter System-Prompt-Zusatz
(aus den Learnings destilliert), kuratiert. Erst nach menschlichem Review wird die
Variante spawnbar. Kein Auto-Apply (Drift-Risiko). Beispiel: 3 approved Learnings mit
Pattern `tests-fixen` auf Profil `claude` → Vorschlag "Claude · Test-Fixer".

## Anforderungen (verbindlich)

### Teil 1 — Rust (Worker A: `store.rs`, NEU `roles.rs`, `learnings.rs` nur Approve-Hook, `api.rs`, `bin/pa.rs`)

1. `store.rs`: Tabelle `role_variants` (`id, project_id, name, base_profile_id,
   pattern_label, system_prompt_addition TEXT, version INTEGER, status TEXT
   ('pending'|'approved'|'rejected'), created_at`) + CRUD
   (`insert_role_variant`, `list_role_variants(project_id, status?)`,
   `get_role_variant`, `set_role_variant_status`,
   `count_approved_learnings(project_id, pattern_label, profile_id) -> i64`,
   `approved_variant_for(project_id, pattern_label, profile_id)`). Tests.
2. `roles.rs`:
   - `maybe_propose_role(store, learning) -> Result<Option<RoleVariant>, String>` —
     aufgerufen aus `approve_learning` (Hook dort einbauen, nach erfolgreichem
     Approve): wenn `pattern_label` vorhanden und >= 3 approved Learnings mit
     gleichem `(project_id, pattern_label, profile_id)` und keine offene/aktive
     Variante mit gleichem Schluessel existiert → Vorschlag erzeugen.
   - Vorschlagstext: One-Shot-Destillation ueber `oneshot.rs` mit neuem Skill
     `resources/role-distiller/SKILL.md` (bekommt die 3+ Learnings, liefert
     `NAME: <Kurzname>` + `SYSTEM_PROMPT: <Zusatz, 5-15 Zeilen, umsetzbar>`).
     Parser rein und getestet. Schlaegt die Destillation fehl (CLI weg, Timeout),
     wird ein schlichter Fallback-Vorschlag (Name aus Pattern, Prompt =
     Aufzaehlung der Learnings) erzeugt — der Vorschlag darf nie am Critic-Pfad
     scheitern.
   - Existiert bereits eine approved Variante zum Schluessel → neue Zeile mit
     `version = alt + 1`, Status `pending` (Versions-Vorschlag).
3. API: `GET /api/projects/<id>/roles`, `POST /api/roles/<id>/approve`,
   `POST /api/roles/<id>/reject`. pa: `pa roles list [--project <id>]`,
   `pa roles approve <id>`, `pa roles reject <id>`. Orchestrator-/Queen-Prompts:
   hoechstens `roles list` ergaenzen, KEIN approve.

### Teil 2 — Spawnbarkeit (Worker A oder B: `workers.rs`, `profiles.rs`)

4. Approved Varianten werden spawnbar: `create_worker`/`create_queen` akzeptieren
   optional eine `role_variant_id`; bei gesetzter Variante wird deren
   `system_prompt_addition` ueber die `caps.system_prompt`-Mechanik des
   Basis-Profils injiziert: `Arg` → zusaetzliches Flag-Argument; `File` (kimi) →
   Abschnitt in die Agent-Datei; `Unsupported` → Fehler "Variante nicht spawnbar
   (kein Prompt-Kanal)" — ehrlich statt still ohne Zusatz zu laufen.
   Branch-/Task-Name bekommen den Varianten-Namen zur Kenntlichmachung.
   Tests: Arg- und File-Pfad mit einem Mock-Profil.
5. `list_agent_profiles` bleibt unveraendert; Varianten kommen ueber eigenen
   Tauri-Command `list_role_variants(project_id)` (nur approved + pending).

### Teil 3 — Frontend (Worker C: `types.ts`, `ipc.ts`, `LearningsPanel.tsx`, `NewWorkerDialog.tsx`, `ProfilePicker.tsx`, `styles.css`)

6. `LearningsPanel.tsx`: neuer Tab "Rollen" (neben "Learnings"): Vorschlags-Karten
   mit Name, Pattern, Basis-Profil, Version, auf-/zuklappbarem Prompt-Text
   (bei v2+: Hinweis "neue Version"), Annehmen/Verwerfen.
7. `NewWorkerDialog.tsx` + `ProfilePicker.tsx`: approved Varianten des Projekts
   erscheinen als eigene Eintraege unter dem Basis-Profil, z.B. "Claude · Test-Fixer
   v2". Auswahl → Worker-Spawn mit `roleVariantId`.
8. `ipc.ts`: `listRoleVariants`, `approveRoleVariant`, `rejectRoleVariant`;
   `createWorker` um optionales `roleVariantId` erweitern (Tauri-Command
   `create_worker` bekommt optionales Arg — Worker A/B stimmen die Signatur ab).

### Fixierte Vertraege

- `RoleVariant` JSON camelCase: `{ id, projectId, name, baseProfileId, patternLabel,
  systemPromptAddition, version, status, createdAt }`.
- Tauri: `list_role_variants(project_id)`, `approve_role_variant(id)`,
  `reject_role_variant(id)`, `create_worker(..., role_variant_id: Option<String>)`.

## Konventionen

Kommentare Englisch, UI-Strings Deutsch, keine neuen Dependencies, Rust-Tests inline.
Kein `npm run tauri dev`. Gates seriell.

## Gates (alle gruen)

```sh
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
npm run typecheck && npm run build
```
