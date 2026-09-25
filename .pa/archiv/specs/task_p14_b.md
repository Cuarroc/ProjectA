# Phase 14 / Worker B — One-Shot-Engine, Critic-Agent, Trigger, Tauri-Commands

Status: historisch

Repo: `<repo-root>`, Branch `main`. Du arbeitest **im Repo-Root**,
nicht in einem Worktree. **Nicht committen, nicht pushen, nicht mergen.**

## Deine Dateien (EXKLUSIV — fasse keine anderen an)

- `src-tauri/src/oneshot.rs` (NEU)
- `src-tauri/src/critic.rs` (NEU)
- `src-tauri/src/enhance.rs`
- `src-tauri/src/status.rs`
- `src-tauri/src/main.rs`
- `src-tauri/resources/learning-critic/SKILL.md` (NEU)
- `src-tauri/tauri.conf.json` (nur der Resources-Eintrag fuer den neuen Skill)

**Nicht anfassen:** `store.rs`, `learnings.rs`, `profiles.rs`, `workers.rs`, `queue.rs`,
`scout.rs`, `api.rs`, `bin/pa.rs` — die gehoeren **Worker A**, der parallel arbeitet.
`diff.rs` liest du nur.

## Abhaengigkeit auf Worker A

`learnings.rs` und die neuen `store.rs`-Methoden entstehen **parallel**. Du schreibst
gegen die unten fixierten Signaturen. Solange Worker A nicht fertig ist, kann
`cargo test` mit "unresolved import" / "no method named ..." fehlschlagen — das ist
erwartet, **nicht deine Baustelle**, und du reparierst es NICHT durch eigene Stubs in
fremden Dateien. Reihenfolge deiner Arbeit deshalb: erst `oneshot.rs`, `enhance.rs` und
`resources/learning-critic/SKILL.md` (voellig unabhaengig), dann `critic.rs`,
`status.rs`, `main.rs`. Wenn du blockiert bist: `orca orchestration ask` an die
Koordinatorin.

### Von Worker A garantierte API (`crate::learnings`)

    pub async fn learning_enabled(store: &Store, category: &str) -> bool
    pub async fn profile_enabled(store: &Store, profile_id: &str) -> bool
    pub async fn set_learning_enabled(store: &Store, category: &str, enabled: bool) -> Result<(), String>
    pub async fn set_profile_enabled(store: &Store, profile_id: &str, enabled: bool) -> Result<(), String>
    pub async fn learning_settings(store: &Store) -> std::collections::BTreeMap<String, bool>
    pub async fn profiles_with_enabled(store: &Store) -> Vec<crate::profiles::AgentProfile>
    pub async fn approve_learning(store: &Store, learning_id: &str, final_text: &str) -> Result<(), String>
    pub async fn reject_learning(store: &Store, learning_id: &str) -> Result<(), String>
    pub const CATEGORIES: [&str; 4] = ["worker", "queen", "orchestrator", "scout"];

### Von Worker A garantierte `Store`-API

    pub struct Learning {
        pub id: String, pub project_id: String, pub worker_id: String,
        pub profile_id: String, pub pattern_label: Option<String>,
        pub content: String, pub status: String, pub created_at: i64,
    }
    pub const LEARNING_PENDING: &str = "pending";

    store.insert_learning(&Learning) -> Result<(), String>
    store.list_learnings(project_id: Option<&str>, status: Option<&str>) -> Result<Vec<Learning>, String>

Ids via `store::new_id("lr")`, Zeit via `store::now_unix_secs()`.

## Konventionen

Kommentare/Doc-Comments **Englisch**, UI-Strings Deutsch, **keine neuen Dependencies**,
Rust-Tests inline. `SKILL.md` ist **Englisch**. Kein `npm run tauri dev`.

---

## 1. `oneshot.rs` (NEU) — verallgemeinerte Headless-Engine

Ziehe den Throwaway-Workspace- und Headless-Run-Mechanismus aus `enhance.rs` heraus.
Was heute dort steht — `SkillWorkspace`, `copy_dir_all`, `bundled_skill_dir`,
`dev_skill_dir`, das `claude -p --add-dir <workspace> --output-format text`-Spawnen,
das Timeout-Polling, das Einsammeln von stdout/stderr — wird generisch:

    /// The CLI that runs a bundled skill headlessly.
    pub const CLAUDE_BIN: &str = "claude";

    /// One throwaway workspace holding a copy of a bundled skill.
    pub struct SkillWorkspace { /* ... */ }
    impl SkillWorkspace {
        pub fn create(skill_name: &str, skill_src: &Path) -> Result<Self, String>;
        pub fn path(&self) -> &Path;
        pub fn skill_path(&self) -> PathBuf;
    }

    /// Locate a bundled skill: the installed copy first, the checkout second.
    pub fn bundled_skill_dir(app: &AppHandle, skill_name: &str) -> Result<PathBuf, String>;
    pub fn dev_skill_dir(skill_name: &str) -> PathBuf;

    /// Run `instruction` through a headless Claude with `skill_name` available,
    /// and return its stdout. Every failure is an error string a UI can show.
    pub fn run(
        skill_src: &Path,
        skill_name: &str,
        instruction: &str,
        timeout: Duration,
    ) -> Result<String, String>;

Der Workspace-Praefix wird generisch (`projecta-oneshot-<pid>-<n>` statt
`projecta-pm-...`) — das ist reine Temp-Ordner-Benennung und aendert kein Verhalten.

`enhance.rs` behaelt seine **oeffentliche API unveraendert** (`enhance_prompt`,
`EnhanceResult`, `SKILL_NAME`, `ENHANCE_TIMEOUT`, alles was `main.rs` heute benutzt) und
ruft intern `oneshot`. **Am Prompt-Master-Instruktionstext aendert sich nichts** — der
String, der heute an das CLI geht, muss byte-identisch bleiben. Bestehende
`enhance.rs`-Tests muessen unveraendert weiterlaufen; verschiebe die Tests der
ausgelagerten Bausteine mit nach `oneshot.rs`.

## 2. `resources/learning-critic/SKILL.md` (NEU)

Neuer gebuendelter Skill, Skill-Name `learning-critic`. Englisch, Frontmatter im
gleichen Format wie `resources/prompt-master/SKILL.md` (schau es dir an und halte dich
an dessen Aufbau).

Der Skill bekommt als Input:

- den Task-Text des Workers,
- `git diff --stat` plus ein gekuerztes Diff,
- das Ende der `messages`-Historie des Workers.

Er liefert **0 bis 3** Learnings in genau diesem Format, ein Block pro Kandidat,
Bloecke durch eine Leerzeile getrennt, **kein** weiterer Text davor oder danach:

    PATTERN: <short label>
    LEARNING: <one or two sentences, actionable>

Regeln, die im SKILL.md stehen muessen:

- Only durable, reusable insight: something that would help a *future* agent on a
  *different* task in this repository.
- No project banalities ("the project uses Rust"), no restating the task, no praise.
- No raw logs, no file dumps, no diff excerpts.
- Nothing is better than something: emitting zero blocks is a correct and expected
  answer when the run taught nothing general.
- Each LEARNING is imperative and concrete ("Run the test gate before ...", not
  "It might be good to consider ...").
- `PATTERN` is a short kebab-or-space label, at most ~40 characters.
- Never output anything except these blocks.

Registriere den Ordner in `tauri.conf.json` neben `resources/prompt-master/**/*`.

## 3. `critic.rs` (NEU)

    /// Distil 0-3 durable learnings out of one finished worker's run.
    /// Returns how many learnings were stored as `pending`.
    pub async fn run_critic(
        app: &AppHandle,
        store: &Store,
        worker_id: &str,
    ) -> Result<usize, String>

(Nimm `AppHandle` mit, weil `bundled_skill_dir` ihn braucht — falls du ohne auskommst,
umso besser, aber halte die Signatur dann konsistent zu dem, was `main.rs` aufruft.)

Ablauf:

1. Worker laden (`store.get_worker`), unbekannt -> `Err`.
2. Projekt laden fuer `repo_path`.
3. Diff via `crate::diff::worker_diff(&repo_path, &worktree_path)` bzw.
   `crate::diff::worktree_of(&worker)`. Diff auf ein Zeichenbudget kuerzen
   (`const DIFF_BUDGET: usize = 12_000;`) — vorne behalten, Rest mit einer
   `[truncated]`-Marke abschneiden.
4. Messages-Tail via `store.list_messages(...)`, die letzten N Eintraege
   (`const MESSAGE_TAIL: usize = 40;`), auf ein Budget gekuerzt
   (`const MESSAGES_BUDGET: usize = 8_000;`) — hier die **neuesten** behalten.
5. Instruktion bauen (rein und getestet):

       /// Assemble the critic's input document. Pure, tested.
       pub fn build_instruction(task: &str, diff_stat: &str, diff: &str, messages: &str) -> String

   Klar abgegrenzte Abschnitte mit englischen Ueberschriften.
6. `oneshot::run(skill_src, "learning-critic", &instruction, CRITIC_TIMEOUT)` mit
   `pub const CRITIC_TIMEOUT: Duration = Duration::from_secs(180);`
7. Ausgabe parsen — **rein und getestet**:

       /// One candidate the critic produced.
       #[derive(Debug, Clone, PartialEq, Eq)]
       pub struct Candidate { pub pattern: Option<String>, pub content: String }

       /// Parse the critic's strict output. Unparseable noise is skipped, not
       /// an error; a document with no blocks at all yields an empty vector.
       pub fn parse_candidates(raw: &str) -> Vec<Candidate>

   Parser-Regeln: `PATTERN:` und `LEARNING:` case-insensitive am Zeilenanfang,
   fuehrende Aufzaehlungszeichen (`- `, `* `, `1. `) tolerieren, Werte trimmen, leere
   `LEARNING` verwerfen, ein `LEARNING` ohne vorheriges `PATTERN` bekommt
   `pattern: None`, hoechstens 3 Kandidaten (`const MAX_CANDIDATES: usize = 3;`),
   Fortsetzungszeilen eines `LEARNING` bis zur naechsten Marke/Leerzeile anhaengen.
8. Jeden Kandidaten als `Learning` mit `status = LEARNING_PENDING`,
   `profile_id = worker.profile_id` (der Critic erbt die Dialekt-Erfahrung des
   Workers), `worker_id`, `project_id` einfuegen. Rueckgabe: Anzahl.

Fehlerbehandlung: fehlendes CLI, Timeout, IO, Parse -> `Err(String)`. **Niemals
panicken.** Kein `unwrap`/`expect` auf Fremddaten.

Tests: `parse_candidates` (sauberer Fall, 0 Bloecke, >3 Bloecke, Bullet-Praefixe,
Grossschreibung, `LEARNING` ohne `PATTERN`, mehrzeiliges `LEARNING`, Muell drumherum),
`build_instruction` (enthaelt alle vier Teile), die Kuerzungs-Helfer.

## 4. Trigger in `status.rs`

In `StatusEngine::update` gibt es bereits das Muster fuer den Test-Gate-Trigger:

    if verdict.column == COL_IN_REVIEW {
        self.start_test_gate(worker_id);
    }

Ergaenze daneben:

    if verdict.column == COL_DONE {
        self.start_learning_critic(worker_id);
    }

und eine `fn start_learning_critic(&self, worker_id: &str)` nach dem Vorbild von
`start_test_gate`: Store aus dem `Mutex` holen (sonst still zurueck), dann
`tauri::async_runtime::spawn` mit best-effort-Aufruf von `critic::run_critic`.
Vorher pruefen: `learnings::learning_enabled(&store, "worker").await` — aus ist aus.
Jeder Fehler wird nur mit `eprintln!("projecta: learning critic for {worker_id}: {err}")`
geloggt. **Ein Critic-Ausfall darf das Board nie stoeren**; kommentiere das genau so,
wie `start_test_gate` seine Fire-and-forget-Entscheidung dokumentiert.

Die Engine braucht einen `AppHandle`, falls `run_critic` ihn verlangt. Wenn `status.rs`
heute keinen hat, fuege ein `set_app(&self, app: AppHandle)` nach dem Vorbild von
`set_store` hinzu und rufe es in `main.rs` beim Startup — oder entwirf `run_critic` so,
dass es ohne `AppHandle` auskommt (dann faellt `bundled_skill_dir` auf `dev_skill_dir`
plus einen an `run_critic` uebergebenen Pfad zurueck). Waehle **einen** Weg und halte
ihn konsistent.

Die Debounce ist die Transition selbst — `update` publiziert nur bei echtem
Spaltenwechsel. Zusaetzlich soll `run_critic` **nicht** doppelt Learnings anlegen: bevor
du einlaeufst, pruefe `store.list_learnings(Some(project_id), None)` auf bereits
vorhandene Eintraege mit diesem `worker_id`, und brich mit `Ok(0)` ab, wenn schon welche
existieren. Der manuelle Button (Punkt 5) umgeht diese Sperre bewusst **nicht** —
lieber einmal "gibt es schon" als doppelte Karten im Review.

Bestehende `status.rs`-Tests duerfen nicht brechen.

## 5. Tauri-Commands in `main.rs`

`mod learnings;`, `mod critic;`, `mod oneshot;` eintragen (du besitzt `main.rs` allein;
`mod learnings;` gehoert dir, obwohl die Datei von Worker A kommt).

Neue Commands, **exakt diese Namen**, Argumente camelCase:

    #[tauri::command] async fn list_learnings(store, project_id: String) -> Result<Vec<Learning>, String>
    #[tauri::command] async fn approve_learning(store, id: String, text: String) -> Result<(), String>
    #[tauri::command] async fn reject_learning(store, id: String) -> Result<(), String>
    #[tauri::command] async fn run_learning_critic(app, store, worker_id: String) -> Result<usize, String>
    #[tauri::command] async fn set_profile_enabled(store, id: String, enabled: bool) -> Result<(), String>
    #[tauri::command] async fn set_category_learning(store, category: String, enabled: bool) -> Result<(), String>
    #[tauri::command] async fn get_learning_settings(store) -> Result<BTreeMap<String, bool>, String>

`list_learnings` liefert nur `status = "pending"`? **Nein** — es liefert alle, das
Frontend filtert. Aber sortiert wie von `store.list_learnings` geliefert.

Ausserdem: `list_agent_profiles` wird zu

    #[tauri::command]
    async fn list_agent_profiles(store: State<'_, Store>) -> Result<Vec<AgentProfile>, String> {
        Ok(learnings::profiles_with_enabled(&store).await)
    }

Alle neuen Commands in den `invoke_handler`-`generate_handler!`-Block eintragen.

## Gates (musst du selbst gruen sehen)

    cd src-tauri && cargo test
    cd src-tauri && cargo clippy --all-targets -- -D warnings

Seriell laufen lassen. Bei `.rmeta`-Fehlern oder Exit `0xc000012d`:
`CARGO_BUILD_JOBS=2 cargo test` retryen. **Niemals `CARGO_PROFILE_*` setzen** — das
invalidiert ~400 Dependencies und diese Maschine kann sie nicht neu bauen.

Wenn Fehler ausschliesslich aus `store.rs`, `learnings.rs`, `workers.rs`, `queue.rs`,
`api.rs`, `scout.rs` oder `bin/pa.rs` kommen: das ist Worker A. Melde es der
Koordinatorin, repariere es nicht selbst.

## Abschluss

Kein Commit. Melde per `worker_done` in 3 Saetzen: was du gebaut hast, wie die Gates
stehen, was offen ist.
