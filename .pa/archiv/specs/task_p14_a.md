# Phase 14 / Worker A — Datenmodell, Playbook-Kern, Injection, API, CLI

Status: historisch

Repo: `<repo-root>`, Branch `main`. Du arbeitest **im Repo-Root**,
nicht in einem Worktree. **Nicht committen, nicht pushen, nicht mergen.**

## Deine Dateien (EXKLUSIV — fasse keine anderen an)

- `src-tauri/src/store.rs`
- `src-tauri/src/learnings.rs` (NEU)
- `src-tauri/src/profiles.rs`
- `src-tauri/src/workers.rs`
- `src-tauri/src/queue.rs`
- `src-tauri/src/scout.rs`
- `src-tauri/src/api.rs`
- `src-tauri/src/bin/pa.rs`

**`main.rs` gehoert Worker B.** Du darfst `mod learnings;` NICHT selbst in `main.rs`
eintragen — die Koordinatorin macht das, sobald deine Datei existiert. Sag ihr per
`orca orchestration ask` Bescheid, sobald `learnings.rs` kompilierbar dasteht; bis
dahin kannst du `store.rs` und `profiles.rs` isoliert testen.

Andere Rust-Dateien (`status.rs`, `enhance.rs`, `critic.rs`, `oneshot.rs`, `main.rs`)
werden **parallel von Worker B** bearbeitet. Wenn `cargo test` Fehler in Dateien
meldet, die dir nicht gehoeren: nicht anfassen, kurz warten, erneut bauen, und im
Zweifel bei der Koordinatorin nachfragen.

## Konventionen

Kommentare/Doc-Comments **Englisch**, UI-Strings Deutsch, **keine neuen Dependencies**,
Rust-Tests inline (`#[cfg(test)] mod tests`), Stil wie die Nachbarschaft
(`recommendations` in `store.rs` ist dein Vorbild). Kein `npm run tauri dev`.

---

## 1. `store.rs` — Tabellen + CRUD

Neue Statements im `STATEMENTS`-Block (dort wo `recommendations` steht):

    CREATE TABLE IF NOT EXISTS learnings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        pattern_label TEXT,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL
    )

    CREATE INDEX IF NOT EXISTS learnings_project_id ON learnings (project_id, created_at, id)

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )

Struct analog zu `Recommendation`:

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
    #[serde(rename_all = "camelCase")]
    pub struct Learning {
        pub id: String,
        pub project_id: String,
        pub worker_id: String,
        pub profile_id: String,
        pub pattern_label: Option<String>,
        pub content: String,
        pub status: String,
        pub created_at: i64,
    }

    pub const LEARNING_PENDING: &str = "pending";
    pub const LEARNING_APPROVED: &str = "approved";
    pub const LEARNING_REJECTED: &str = "rejected";

Methoden auf `Store`:

- `insert_learning(&self, learning: &Learning) -> Result<(), String>`
- `list_learnings(&self, project_id: Option<&str>, status: Option<&str>) -> Result<Vec<Learning>, String>`
  (sortiert `ORDER BY created_at, rowid`)
- `get_learning(&self, id: &str) -> Result<Option<Learning>, String>`
- `set_learning_status(&self, id: &str, status: &str) -> Result<(), String>`
  (unbekannte id => `Err("unknown learning: {id}")`, wie `set_recommendation_status`)
- `set_learning_content(&self, id: &str, content: &str) -> Result<(), String>`
- `get_setting(&self, key: &str) -> Result<Option<String>, String>`
- `set_setting(&self, key: &str, value: &str) -> Result<(), String>` (UPSERT)

Ids via `new_id("lr")`, Zeitstempel via `now_unix_secs()`.

Tests: Round-Trip + Projekt-Scoping + Status-Filter fuer `learnings`; Setting
Insert / Overwrite / Miss.

## 2. `learnings.rs` (NEU) — Playbook + Settings-Helfer

Modul-Doc-Comment im Stil der anderen Module: warum das Playbook existiert, dass es
git-versioniert im Projekt-Root liegt, dass der Mensch reviewt, und dass jede
Injection best effort ist und niemals einen Spawn verhindern darf.

### Reine String-Logik (separat getestet!)

    /// Insert `bullet` into the `## <heading>` section of `markdown`, creating
    /// the section at the end when it is missing. Returns the new document.
    pub fn insert_into_section(markdown: &str, heading: &str, bullet: &str) -> String

Regeln: Der Abschnitt wird an einer Zeile `## <heading>` erkannt (getrimmt, exakt).
Der Bullet wird als `- <content>` **ans Ende des Abschnitts** gehaengt, also
unmittelbar vor die naechste `## `-Zeile bzw. ans Dateiende. Mehrzeiliger Content wird
zu einer Zeile normalisiert (Zeilenumbrueche/Mehrfach-Whitespace -> ein Leerzeichen).
Fehlt der Abschnitt, wird er unten angehaengt. Leere Datei -> nur der Abschnitt.
Genau eine Leerzeile zwischen Abschnitten, keine doppelten Leerzeilen, Datei endet mit
genau einem `\n`.

    /// Keep `## Allgemein` and the `## Profil: <id>` section of a PLAYBOOK,
    /// trimmed to `max_chars` by dropping the OLDEST bullets first.
    pub fn excerpt_from(markdown: &str, profile_id: &str, max_chars: usize) -> Option<String>

Liefert `None`, wenn beide Abschnitte fehlen oder keine Bullets haben. Reihenfolge:
`## Allgemein` zuerst, dann `## Profil: <id>`. Beim Kuerzen werden die **obersten**
(aeltesten) Bullets entfernt, bis das Ergebnis <= `max_chars` ist; ein Abschnitt ohne
verbleibende Bullets faellt ganz raus. Bleibt nichts uebrig -> `None`.

Konstanten:

    pub const PLAYBOOK_FILE: &str = "PLAYBOOK.md";
    pub const GENERAL_HEADING: &str = "Allgemein";
    pub const EXCERPT_MAX_CHARS: usize = 4000;
    pub fn profile_heading(profile_id: &str) -> String   // "Profil: <id>"

### Dateizugriff

    pub fn playbook_append(repo_path: &str, profile_id: Option<&str>, content: &str) -> Result<(), String>
    pub fn playbook_excerpt(repo_path: &str, profile_id: &str) -> Option<String>

`playbook_append`: liest `<repo_path>/PLAYBOOK.md` (fehlend = leerer String), waehlt
`GENERAL_HEADING` bei `None` bzw. `profile_heading(id)`, ruft `insert_into_section`,
schreibt zurueck. IO-Fehler -> `Err(String)`.

`playbook_excerpt`: liest die Datei, ruft `excerpt_from(..., EXCERPT_MAX_CHARS)`; jeder
Fehler -> `None`.

### Injection

    pub const PLAYBOOK_MARKER: &str = "--- PROJEKT-PLAYBOOK ---";
    pub const TASK_MARKER: &str = "--- TASK ---";

    /// Prefix `task` with the playbook excerpt. Pure, tested.
    pub fn with_playbook(excerpt: Option<&str>, task: &str) -> String

Ergebnis bei vorhandenem Excerpt **exakt**:

    --- PROJEKT-PLAYBOOK ---
    <excerpt>
    --- TASK ---
    <task>

Ohne Excerpt: unveraendert `task`.

    /// The task text a spawn should actually deliver: `task`, prefixed with the
    /// project playbook when learning is on for `category` and an excerpt exists.
    pub async fn inject(
        store: &Store,
        repo_path: &str,
        profile_id: &str,
        category: &str,
        task: &str,
    ) -> String

Best effort: jeder Fehler -> `task` pur.

### Settings-Helfer

    pub const CATEGORIES: [&str; 4] = ["worker", "queen", "orchestrator", "scout"];

    pub fn learning_key(category: &str) -> String    // "learning.<category>"
    pub fn profile_key(profile_id: &str) -> String   // "profile.<id>.enabled"

    /// Default on: only the literal "0" turns something off.
    pub async fn learning_enabled(store: &Store, category: &str) -> bool
    pub async fn profile_enabled(store: &Store, profile_id: &str) -> bool
    pub async fn set_learning_enabled(store: &Store, category: &str, enabled: bool) -> Result<(), String>
    pub async fn set_profile_enabled(store: &Store, profile_id: &str, enabled: bool) -> Result<(), String>

    /// All learning toggles as `{ "<category>": bool }` for the settings screen.
    pub async fn learning_settings(store: &Store) -> std::collections::BTreeMap<String, bool>

    /// `profiles::load_profiles()` with `enabled` filled in from the settings table.
    pub async fn profiles_with_enabled(store: &Store) -> Vec<crate::profiles::AgentProfile>

    /// Guard for every spawn path.
    pub async fn ensure_profile_enabled(store: &Store, profile_id: &str) -> Result<(), String>

`ensure_profile_enabled`-Fehlertext **exakt**:

    format!("agent profile '{profile_id}' is disabled in settings")

### Review-Aktionen

    pub async fn approve_learning(store: &Store, learning_id: &str, final_text: &str) -> Result<(), String>
    pub async fn reject_learning(store: &Store, learning_id: &str) -> Result<(), String>

`approve_learning`: Learning laden (unbekannt -> Err), `final_text` trimmen (leer ->
`Err("a learning needs text")`), `set_learning_content`, `set_learning_status(APPROVED)`,
Projekt fuer `repo_path` laden, `playbook_append(repo, Some(&learning.profile_id), final_text)`.
Ein fehlgeschlagener Playbook-Write ist ein echter Fehler (der Mensch hat aktiv
zugestimmt) — Status bleibt gesetzt, der Fehler wird zurueckgegeben.

`reject_learning`: nur `set_learning_status(REJECTED)`.

Tests: `insert_into_section` (fehlender Abschnitt, vorhandener Abschnitt, Abschnitt in
der Mitte, leere Datei, mehrzeiliger Content), `excerpt_from` (beide Abschnitte, nur
Allgemein, nur Profil, keiner, Kuerzung wirft aelteste zuerst weg), `with_playbook`
(mit/ohne Excerpt, exakte Marker), Settings-Defaults + Toggle-Round-Trip,
`approve_learning` / `reject_learning` gegen einen Temp-Store.

## 3. `profiles.rs` — `enabled`

`AgentProfile` bekommt

    #[serde(default = "default_enabled")]
    pub enabled: bool,

mit `fn default_enabled() -> bool { true }`. Alle Konstruktionsstellen
(`AgentProfile::new`, `agents.json`-Overrides) setzen `true`. Bestehende
`agents.json`-Dateien ohne das Feld muessen weiter laden.

## 4. Injection + Profil-Guard in den Spawn-Pfaden

- `workers.rs::create_worker`: direkt nach dem Aufloesen von `profile`
  `learnings::ensure_profile_enabled(store, profile_id).await?`. Der an
  `agents.start_task_delivery` uebergebene Text (und das `Task: {task}`-Log) wird zu
  `learnings::inject(store, &project.repo_path, profile_id, "worker", task).await`.
  Die Spalte `workers.task` speichert weiterhin den **rohen** Task — nur die
  Auslieferung an den Agenten wird angereichert.
- `workers.rs::create_queen`: gleiches Muster, Kategorie `"queen"`. Der
  System-Prompt der Queen bleibt unveraendert; injiziert wird in den Task-/
  Domaenen-Text, den sie zugestellt bekommt.
- `workers.rs::create_orchestrator`: `ensure_profile_enabled`; Injection mit Kategorie
  `"orchestrator"` nur, wenn dort ueberhaupt ein Task-Text zugestellt wird. Gibt es nur
  einen System-Prompt, reicht der Guard.
- `scout.rs::create_scout`: nur `ensure_profile_enabled` (Kategorie `"scout"`).
- `queue.rs`: `LiveLauncher::launch` ruft `create_worker` und erbt die Injection —
  pruefe das und aendere nur, falls noetig. Zusaetzlich soll `dispatch_once` einen Task
  mit deaktiviertem Profil **nicht** endlos retrien: entweder bleibt der Eintrag
  `ready`/`queued` wie bei einem blockierten Profil (siehe den bestehenden Test
  `blocked_profiles_stay_ready_and_only_ready_tasks_cancel`), oder er faellt sauber mit
  `error` aus. Waehle den Weg, der zum vorhandenen Code passt, und decke ihn mit einem
  Test ab.

Bestehende Tests duerfen nicht brechen: mit Default-Settings (Profil aktiv, kein
`PLAYBOOK.md`) muss das Verhalten byte-identisch bleiben.

## 5. `api.rs` — HTTP

Trait `ApiBackend` erweitern und im Router verdrahten:

| Methode | Pfad | Body | Antwort |
|---|---|---|---|
| GET | `/api/learnings` | `?projectId=`, `?status=` (beide optional) | `[Learning]` |
| GET | `/api/projects/<id>/learnings` | `?status=` | `[Learning]` |
| POST | `/api/learnings/<id>/approve` | `{"text": "..."}` | `{"ok": true}` |
| POST | `/api/learnings/<id>/reject` | — | `{"ok": true}` |

Doc-Tabelle im Modulkopf mitpflegen. Muster: die `recommendations`-Routen. Fehlendes
oder leeres `text` bei approve -> 400 mit klarer Meldung. Router-Tests wie die
bestehenden (Fake-Backend).

## 6. `bin/pa.rs` — CLI

    pa learnings list [--project <projectId>] [--status <pending|approved|rejected>]
    pa learnings approve <learningId> [--text "..."]
    pa learnings reject <learningId>

`approve` ohne `--text` sendet den aktuell gespeicherten Text (per `GET /api/learnings`
holen; unbekannte id -> klarer Fehler). Rendering analog `render_recommendation_list`:
eine Zeile pro Learning mit id, Status, Pattern-Label (falls vorhanden) und gekuerztem
Content. Usage-Text im Modulkopf und im `--help`-Block ergaenzen.

**Orchestrator-Prompt**: falls `pa`-Kommandos in einem Orchestrator-System-Prompt
aufgelistet sind (suche nach dem `recommendations list`-Eintrag), nimm dort **nur**
`pa learnings list` auf — NICHT approve/reject. Das Review ist menschlich. Liegt dieser
Prompt in `workers.rs`, gehoert er dir; liegt er woanders, melde es der Koordinatorin
statt die Datei anzufassen.

## Gates (musst du selbst gruen sehen)

    cd src-tauri && cargo test
    cd src-tauri && cargo clippy --all-targets -- -D warnings

Seriell laufen lassen. Bei `.rmeta`-Fehlern oder Exit `0xc000012d`:
`CARGO_BUILD_JOBS=2 cargo test` retryen. **Niemals `CARGO_PROFILE_*` setzen** — das
invalidiert ~400 Dependencies und diese Maschine kann sie nicht neu bauen.

Wenn Fehler ausschliesslich aus `main.rs`, `status.rs`, `critic.rs`, `oneshot.rs` oder
`enhance.rs` kommen: das ist Worker B. Melde es der Koordinatorin und werte deine
eigenen Dateien als gruen.

## Abschluss

Kein Commit. Melde per `worker_done` in 3 Saetzen: was du gebaut hast, wie die Gates
stehen, was offen ist.
