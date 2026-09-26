# Phase 16 / Fix 1 — Respawn-Konsistenz: Playbook und Rollen-Variante wiederherstellen

Status: historisch

Repo: `<repo-root>`, Branch `main`, HEAD `526c60c`. Im Repo-Root,
kein Worktree. **Nicht committen, nicht pushen, nicht mergen.**

## Deine Dateien (EXKLUSIV)

- `src-tauri/src/store.rs`
- `src-tauri/src/workers.rs`
- `src-tauri/src/diff.rs` — **nur** die `WorkerRow`-Fixture
- `src-tauri/src/gh.rs` — **nur** die `WorkerRow`-Fixture
- `src-tauri/src/queue.rs` — **nur** die `WorkerRow`-Fixtures
- `src-tauri/src/scout.rs` — **nur** die `WorkerRow`-Konstruktion
- `src-tauri/src/testgate.rs` — **nur** die `WorkerRow`-Fixture

Die letzten fuenf gehoeren dir **ausschliesslich** wegen des Feld-Ripples unten.
Aendere dort sonst nichts.

**Nicht anfassen:** `api.rs` (Fix 2), `main.rs`, `roles.rs`, `learnings.rs`,
`critic.rs`, `oneshot.rs`, alles unter `src/` (Frontend, Fix 3).

## Das Problem

`respawn_worker` baut den Agenten neu auf, stellt aber zwei Dinge nicht wieder her,
die ein frisch erstellter Worker bekommt:

1. Den **Playbook-Block** aus Phase 14 (`learnings::inject` bzw. bei Queens der
   angehaengte Playbook-Block).
2. Die **Rollen-Variante** aus Phase 15 — die Worker-Zeile traegt gar keine
   `role_variant_id`, die Spezialisierung ist nach einem Respawn schlicht weg.

Ein respawnter Worker ist damit still ein anderer Agent als vorher. Das ist der Bug.

## Achtung: Feld-Ripple (der Grund fuer deine ungewoehnliche Dateiliste)

`WorkerRow` wird an **13 Stellen in 7 Dateien** als Literal konstruiert:
`store.rs` (4), `workers.rs` (3), `queue.rs` (2), `diff.rs`, `gh.rs`, `scout.rs`,
`testgate.rs` (je 1). Ein neues Feld bricht sie alle. Genau daran hat Phase 14 Zeit
verloren, weil die Ripple-Dateien niemandem gehoerten.

Geh so vor: Feld hinzufuegen, dann `cargo check` laufen lassen und **jede** gemeldete
Stelle mechanisch mit `role_variant_id: None,` ergaenzen. Erwarte 12 Fehler.

## 1. `store.rs`

- Spalte: `self.add_missing_column("workers", "role_variant_id", "TEXT").await?`
  bei den anderen `workers`-Spalten. Auch im `CREATE TABLE IF NOT EXISTS workers`
  ergaenzen, damit eine frische Datenbank dieselbe Form hat.
- `pub role_variant_id: Option<String>,` in `WorkerRow` **und** in `Worker`, falls
  `Worker` das Feld fuer die Rueckgabe braucht (pruefe `into_worker`).
- Die `WORKER_COLUMNS`-Selectliste bzw. jedes handgeschriebene `SELECT`/`INSERT`
  ueber `workers` mitziehen. **Zaehl die Platzhalter nach** — ein `INSERT` mit
  falscher Bindungszahl faellt erst zur Laufzeit auf, nicht im Compiler.
- Falls es eine `[&str; N]`-Laengenangabe gibt, mitwachsen lassen.
- Test: Round-Trip eines Workers mit gesetzter und mit leerer `role_variant_id`.

## 2. `workers.rs`

- `create_worker_as_role` und `create_queen_as_role` schreiben die verwendete
  `role_variant_id` in die Zeile (bisher wird sie nur fuer den Prompt benutzt und
  dann weggeworfen).
- `respawn_worker`:
  - Playbook wie beim Erstellen injizieren — Worker ueber
    `learnings::inject(..., "worker", task)`, Queen ueber denselben Weg wie
    `create_queen_as_role` (Marschbefehl → Rolle → Playbook).
  - Traegt die Zeile eine `role_variant_id`, die Variante laden und ihren
    `system_prompt_addition` genauso injizieren wie beim Erstellen. Ist die Variante
    inzwischen **nicht mehr approved** oder geloescht: **nicht** hart scheitern —
    ohne den Rollen-Zusatz respawnen und das im Message-Log des Workers vermerken.
    Begruende das im Kommentar: ein Respawn ist eine Rettungsaktion, und eine
    zurueckgezogene Rolle darf einen laufenden Auftrag nicht unrettbar machen.
  - Der rohe Task in der Zeile bleibt roh (kein Playbook in der DB), genau wie beim
    Erstellen.
- Tests: Respawn mit Playbook injiziert den Block; Respawn mit Variante injiziert den
  Rollen-Zusatz; Respawn mit inzwischen zurueckgezogener Variante laeuft durch und
  loggt; Respawn ohne beides verhaelt sich **byte-identisch** wie heute.

## Konventionen

Kommentare/Doc-Comments **Englisch**, UI-Strings Deutsch, keine neuen Dependencies,
Rust-Tests inline. Kein `npm run tauri dev`.

## Gates

    cd src-tauri && CARGO_BUILD_JOBS=2 cargo test
    cd src-tauri && CARGO_BUILD_JOBS=2 cargo clippy --all-targets -- -D warnings

**Immer** `CARGO_BUILD_JOBS=2`. **Niemals `CARGO_PROFILE_*`**. **Frag mich vor jedem
cargo-Lauf per `orca orchestration send --type escalation` um das GO** — es baut nur
ein Rust-Worker gleichzeitig. Kein blockierendes `ask`, das kommt bei mir nicht an;
poll auch nicht `orca orchestration check`, die Delivery haengt. Ich erreiche dich
ueber dein Terminal.

Fehler aus fremden Dateien wortgetreu an mich, nicht selbst reparieren.

## Abschluss

Kein Commit. `worker_done` mit 3 Saetzen: was gebaut, Gates, was offen.
