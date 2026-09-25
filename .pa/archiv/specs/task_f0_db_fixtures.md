# F0-Abnahme: Alt-Datenbanken öffnen ohne Datenverlust

Status: historisch

Repo: `<repo-root>`. **Nicht committen, nicht pushen, nicht
mergen.** Ein Mensch fährt die Gates und committet.

Plan: `docs/SANIERUNGSPLAN.md` Rev 9, F0-Abnahme. Herleitung und alle Belege:
`.pa/report_f0.md` §5.

## Warum

Der Plan behauptet, Migrationen seien „versioniert, transaktional und durch
Pre-Migration-Backups abgesichert". Das stimmt — aber **kein Test öffnet je eine
alte Datenbankdatei.** Der Adoptionstest (`store.rs:3530-3601`) sieht so aus, baut
sich aber im Test einen zweispaltigen Stub. Der einzige Test gegen eine echte
Datei ist `#[ignore]`, hängt an der Env-Variable `PA_PROD_DB_COPY` und läuft in
keinem Gate (`store.rs:3713-3773`). Die einzige `.db` im Repo ist gitignored.

Die Migrationsmechanik ist also unbelegt, obwohl sie den Bestand des Nutzers trägt.

## Zuschnitt-Entscheidung (wichtig, nicht wegoptimieren)

Eine v1.2.4-DB steht bereits auf `user_version = 2` — dem aktuellen Ziel.
`migrate` nimmt für sie den Frühausstieg bei `pending.is_empty()`
(`store.rs:884-886`): es läuft **keine** Migration und es entsteht **kein**
Backup. Ein Test gegen nur eine v1.2.4-Fixture beweist „liest zurück", nicht
„migriert verlustfrei".

Deshalb drei Generationen. Die Versionsstände sind über die Tags unterscheidbar:

| Fixture | Tag | `user_version` beim Öffnen | Beweist |
|---|---|---|---|
| `v1.0.0-projecta.db` | `v1.0.0` (pre-contract) | 0 → 2 | Adoption auf echtem Schema + Schritt 2 |
| `v1.1.1-projecta.db` | `v1.1.1` (`MIGRATIONS = &[]`) | 1 → 2 | reiner Schritt-2-Lauf, Backup entsteht |
| `v1.2.4-projecta.db` | `v1.2.4` | 2 → 2 | wörtliche Abnahme; kein Backup, keine Änderung |

## Deine Dateien (EXKLUSIV)

- `src-tauri/src/store.rs` — **nur** innerhalb `mod tests` (ab Zeile 3514)
- `src-tauri/testdata/db/**` — neu
- `src-tauri/src/testutil.rs` — falls du den Fixture-Helper dort ablegst

**Nicht anfassen:** Produktivcode in `store.rs` (außerhalb `mod tests`),
`api.rs`, `main.rs`, `bin/pa.rs`, alles unter `src/`. Dieser Auftrag braucht
**keine** Produktivänderung — wenn du glaubst, doch eine zu brauchen, ist das ein
Befund und kein Freibrief: melde ihn, statt ihn zu bauen.

## Auftrag

1. **Fixtures erzeugen, reproduzierbar und ohne Echtdaten.** Ein
   `#[ignore]`-Generator-Test neben den Migrationstests, der auf dem jeweils
   ausgecheckten Tag läuft: `Store::open` in ein Temp-Verzeichnis, dann über die
   normalen Store-Methoden ein bekanntes synthetisches Inventar anlegen —
   2 Projekte, 3 Worker (davon je einer mit `pr_url`, `test_status`,
   `paused_reason`), 2 Queue-Einträge, 1 Session, 1 Question, 1 Recommendation,
   und ein `landing_page_markdown` **mit Umlauten, Em-Dash und Zeilenumbrüchen**.
   Danach `PRAGMA wal_checkpoint(TRUNCATE)`, Datei nach `testdata/db/` kopieren.
   Erwartete Werte als `.json`-Sidecar daneben, damit die Assertions nicht im
   Testcode versteinern.
   `.pa/audit-2026-09-01/backup/projecta.db` taugt **nicht** als Fixture —
   gitignored und voll echter Repo-Pfade.
2. **Aufhänger ist `std::fs::copy` vor `Store::open`** — dieselbe Zeile, die der
   Helper `store()` (`store.rs:3506-3512`) heute leer lässt. Der
   Produktionskopie-Test (`store.rs:3726-3737`) macht es inklusive
   WAL-Seitendateien bereits vor. Fixture-Ablage nach dem Muster
   `src-tauri/testdata/` (Präzedenz: `omniroute.rs:1142`).
3. **Tabellentest über die drei Fixtures**, direkt hinter
   `a_version_bump_inside_a_transaction_rolls_back_with_it` (nach `store.rs:3711`).

## Abnahme — „ohne Datenverlust" muss zählbar sein, nicht „öffnet"

Je Fixture:

1. `user_version() == target_schema_version()`.
2. Zeilenzahlen je Tabelle **exakt** wie im Sidecar: `projects`, `workers`,
   `task_queue`, `sessions`, `questions`, `messages`, `usage_events`,
   `recommendations`, `diff_comments`, `status_events`.
3. Feldweiser Vergleich mindestens eines vollständigen Worker-Datensatzes **und**
   des `landing_page_markdown` — Umlaute, Em-Dash und Zeilenumbrüche unverändert.
   Der Deprecation-Pfad aus F0 §4 hängt daran.
4. `merge_state` in `PRAGMA table_info(workers)` vorhanden und `NULL`.
5. `PRAGMA integrity_check == "ok"`.
6. **Backup-Erwartung richtungsscharf:** für 0→2 und 1→2 liegt genau **eine**
   `.pre-migration-*.bak` neben der DB und liefert beim Öffnen dieselben
   Zeilenzahlen wie vorher; für 2→2 gibt es **null** Backups. Das ist der Beweis
   für den Frühausstieg bei `store.rs:884`.
7. Zweites `Store::open` auf derselben Datei ändert nichts (Idempotenz, analog
   `store.rs:3603`).

## Zwei Befunde, die du mitentscheiden sollst

- Der `#[ignore]`-Produktionskopie-Test (`store.rs:3713-3773`) ist nach diesem
  Auftrag entweder redundant oder gehört in ein dokumentiertes Release-Ritual
  neben `scripts/restore-probe.sh`. Entscheide und begründe im Report.
- Die `.pre-migration-*.bak`-Dateien haben **keinen Rückweg**: `restore-probe.sh`
  sieht nur `backups/projecta-*.db` an, das CLI hat kein `restore`. Ein
  `pa db restore` ist außerhalb deiner Dateigrenze — melde es als Befund.

## Gates

```text
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cargo build
```

Exit-Codes ungemaskiert lesen; ein `| tail` verschluckt den Status.

## Report

`.pa/report_f0_db_fixtures.md`: was die drei Fixtures belegen, die beiden
Entscheidungen oben, und jeder Punkt, an dem die Migrationsmechanik anders lief
als in `.pa/report_f0.md` §5 beschrieben.
