# Task: Phase 16 Queen — Gründliches Multi-Agenten-Review + Debuggen

Status: historisch

Du bist die **Queen/Koordinatorin** fuer Phase 16 von ProjectA. Repo:
`<repo-root>`, Branch `main`, HEAD `526c60c`. Phasen 9–15 sind
committed. Dein Memory (`~/.claude/projects/C--Users-<user>-Desktop-ProjectA/memory/`)
lesen — Dispatch-Regeln gelten (/fast on via PowerShell + Erneuerung, Terminals
schliessen + per `terminal list` verifizieren, kein Commit/Push, Gates seriell).

## Ziel von Phase 16

Sehr gründliches Review und adversariales Debuggen von allem, was in den Phasen
9–15 gebaut wurde, plus Regressionssicht auf den Rest. **Reviewer aendern nichts** —
sie liefern Befunde. Du triagst (echter Bug / kein Bug / Verbesserung), dispatchest
Fix-Worker pro Befund-Cluster und faehrst am Ende alle Gates.

## Bekannte offene Punkte (gehoeren in den Scope, als Fix-Tasks)

1. **Respawn-Konsistenz**: `respawn_worker` stellt weder den Playbook-Block (Phase 14)
   noch die Rollen-Variante (Phase 15) wieder her. Braucht `workers.role_variant_id`
   Spalte + Playbook-Injection im Respawn-Pfad. Fix in workers.rs/store.rs.
2. **build_tree-Zyklus** (api.rs): ein spawned_by-Zyklus A↔B macht beide Knoten im
   Tree unsichtbar, obwohl der Doc-Kommentar "never drops one" verspricht.
   Fix: Zyklus erkennen, Zyklus-Knoten als eigene Wurzel ausgeben.
3. **max_workers ohne Writer**: Dispatcher liest `projects.max_workers`, aber nichts
   setzt es. Fix: Tauri-Command `set_project_max_workers` + Feld in den Projekt-
   Settings (SettingsView), neben dem Test-Kommando.

## Review-Panel (4 Reviewer + 1 adversarialer Tester)

- **R1 (claude, hoher Effort)**: Rust-Kern `store.rs`, `learnings.rs`, `critic.rs`,
  `roles.rs`, `workers.rs`, `queue.rs` — Invarianten, Migrationen (Up/Down-Tests),
  SQL-Korrektheit, Races, still verschluckte Fehler, Timeout-/Kill-Pfade in
  testgate.rs/oneshot.rs.
- **R2 (claude, hoher Effort)**: Frontend + IPC-Vertraege — `types.ts` ↔ serde
  camelCase-Abgleich ueber ALLE neuen Typen (Worker, BoardCard, BoardState,
  Learning, RoleVariant, QueueEntry), `App.tsx`-State, `CommandChat.tsx`,
  `BoardView.tsx`, `LearningsPanel.tsx`, `NewWorkerDialog.tsx`, `SettingsView.tsx`.
- **R3 (codex)**: API + CLI — `api.rs` (Routen, Token-Pruefung, Fehler-Pfade),
  `bin/pa.rs` (Parsing, Usage-Texte, Fehlerausgaben). Fremdes Modell bewusst:
  andere Blickweise.
- **R4 (kimi)**: Sicherheit — Prompt-Injection-Pfade (Playbook-Inhalt → Worker-Prompt;
  Learning-Text → PLAYBOOK.md), Markdown-Renderer (XSS-Allow-List aus dem Fix
  `365b75d` regressionssicher?), API-Token-Handling, SQL ueberall nur gebunden.
- **D1 (claude)**: adversariales Testen — schreibt neue Rust-Tests, die die neuen
  Features gezielt BRECHEN sollen: spawned_by-Zyklen, pattern_label-Sonderzeichen,
  Playbook-Kappung an Grenzfaellen, Merge-Guards (falsche Spalte, roter Test,
  laufende Session), Testgate-Timeout/Exit-Codes, Critic-Parser gegen kaputtes
  Skill-Output, Rollen-Spawn mit Unsupported-Profil. Was haelt: Tests bleiben
  als Regressionsschutz. Was bricht: Befund an dich.

## Ablauf (verbindlich)

1. Zuerst die 3 Fix-Tasks (oben) dispatchen — datei-getrennt, sie kleben an
   workers.rs/store.rs/api.rs bzw. SettingsView.
2. Parallel die 4 Reviewer + D1 (review-only bzw. nur-neue-Tests; D1 fasst nur
   Test-Dateien an bzw. ergaenzt `#[cfg(test)]`-Bloecke, keine Logik-Aenderungen).
3. Befunde triagen, Fix-Worker dispatch, Integration durch dich.
4. Erst dann Gates.

## Befund-Format fuer Reviewer (in ihren Specs verlangen)

Pro Befund: Datei:Zeile, Schweregrad (kritisch/schwer/mittel/niedrig), Beweis
(Code-Ausschnitt oder reproduzierbarer Ablauf), Vorschlag. Keine Vorschlaege ohne
Befund. Als Datei unter `.pa/review_p16_<rolle>.md` ablegen UND als Prose melden.

## Gates (alle gruen, mit Cache-Busting wie in Phase 15)

```sh
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
npm run typecheck && npm run build
```
