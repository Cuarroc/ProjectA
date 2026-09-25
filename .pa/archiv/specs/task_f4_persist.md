# F4-Persist: Evidence, Disposition und Trust auf der Platte

Status: historisch

Repo: `<repo-root>`. **Nicht committen, nicht pushen, nicht
mergen.** Ein Mensch fährt die Gates und committet.

Plan: `docs/SANIERUNGSPLAN.md` Rev 9, F4 und F0-Migrationsansatz
(`.pa/report_f0.md` §2 Punkt 5). Ultragoal: `G007-f4`.

## Nahtstellen-Lane

Dieses Paket besitzt **`store.rs`** und läuft **nach**
`.pa/task_f4_readiness.md`. Nicht gleichzeitig mit einem anderen Owner von
`api.rs`, `main.rs` oder `bin/pa.rs`.

Erlaubte Ein-Zeilen-Folge außerhalb: `src-tauri/src/diagnosis.rs`
`SCHEMA_USER_VERSION` auf den neuen `MIGRATIONS`-Höchststand — F1-Diag pinnt
genau das (`reported_schema_version_matches_store_migrations`). Kein anderer
Eingriff in `diagnosis.rs`.

## Warum

Von den fünf Evidence-Bestandteilen ist heute null persistiert. Nach einem
Neustart ist Readiness weg. `test_status`/`tested_at` ohne SHA ist F0-3.
Kommentare haben keinen offen/erledigt-Zustand. Setup-Trust existiert nicht.

Unbekannte Legacy-Werte werden zu `unknown` migriert, **nie** zu `ready`.
Insbesondere `test_status='pass'` ohne SHA und `merge_state`/`pr_url` sind kein
Evidence.

## Deine Dateien (EXKLUSIV)

- `src-tauri/src/store.rs` — Migration, Queries, Tests im `mod tests` dieses
  Moduls
- `src-tauri/src/diagnosis.rs` — nur `SCHEMA_USER_VERSION`

**Nicht anfassen:** `api.rs`, `main.rs` (außer sie rührt F4-Readiness schon an),
`bin/pa.rs`, `workers.rs`, `readiness.rs` (lesen ja, schreiben nein), alles
unter `src/`.

**Achtung Bauumgebung:** Setze **kein** `CARGO_PROFILE_*`.

## Auftrag

1. Neuer Eintrag in `MIGRATIONS` plus `match`-Arm in `apply_migration_step`.
   **Nicht** in die eingefrorene Baseline, **nicht** in `add_missing_column`.

2. Persistenz für Code-/Test-/Approval-Evidence (SHA-Trio, Policy-Hash,
   Akzeptanz-Hash, `reviewed_by`, `approval_source`). Separate Tabelle ist
   erlaubt und bevorzugt, damit `WorkerRow` und alle Insert-Stellen nicht
   mitwandern. Default nach Open: keine Zeile = unbekannt, nicht ready.

3. `diff_comments`: Disposition `open | done`. Bestehende Zeilen `open`.
   Offene zählen für `comments_open`.

4. Setup-Command pro Projekt (neben `test_command`, nicht stattdessen): Log-
   Pfad-Konvention, Timeout und Prozessbaum-Kill **dürfen** `testgate.rs`
   spiegeln, aber `testgate.rs` nicht umbauen, wenn ein eigener schmaler
   Helfer in `store.rs`/einem von dir angelegten `setupgate.rs` reicht. Trust-
   Grant persistieren (Repo-Identität, normalisierter Befehl, Base-SHA,
   Inputs-Hash). Ausführung ohne Grant ist `setup_failed` aus Sicht der Engine.

5. Drei-Generationen-Fixtures (`testdata/db/`) müssen weiter ohne Datenverlust
   öffnen. Additive Spalten/Tabellen, kein Rewrite der Fixtures nötig, wenn
   `Store::open` migriert. Bestehende F0-Tests bleiben grün.

6. Worktree-Prune nach Merge: nur ein **Angebot** persistieren (Flag/Absicht),
   nie automatisch löschen. Das automatische Löschen bleibt aus.

## Beweismaßstab

- Migration 2→3 (und 0/1→Ziel) öffnet ohne Verlust; Legacy-Pass ohne SHA wird
  nicht als Test-Evidence gelesen.
- Comment-Disposition round-trip; Count offener Kommentare.
- Trust-Grant speichern und bei geändertem Script als nicht treffend lesen.
- `cargo test` der betroffenen `store::tests` plus
  `three_generation_fixtures_open_without_data_loss`.

## Gates

```text
cargo test store::
cargo test three_generation_fixtures_open_without_data_loss
cargo test diagnosis::tests::reported_schema_version_matches_store_migrations
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

## Report

`.pa/report_f4_persist.md`: Schema, Migration, Fixture-Lauf, was bewusst nicht
in `WorkerRow` landete.
