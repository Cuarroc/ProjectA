//! The research scout: an agent that reads the repository, reads the internet,
//! and writes down what ProjectA should adopt next.
//!
//! A scout is shaped like the Phase 4 orchestrator - one agent per project, no
//! branch, no worktree, running in the repository root - but it steers nothing.
//! Its whole output is a list of [`Recommendation`]s: a library, a repository
//! or a tool, why it would help here, and roughly what adopting it would cost.
//! [`accept_recommendation`] turns one of those into a queued task, which the
//! Phase 7.0 dispatcher then hands to an ordinary worker.
//!
//! # How a recommendation reaches the database
//!
//! Two routes were on the table: have the scout POST to the control API, or
//! have it append JSON lines to a file the app ingests. **The file wins**, and
//! it is what the scout's system prompt tells it to use:
//!
//! * The agent has to get one thing right - append a line to
//!   [`SCOUT_FILE`] in its own working directory - instead of finding
//!   `projecta-api.json`, reading a port and a token out of it, and building a
//!   correct HTTP request with a custom header. Appending to a file is a tool
//!   call it already makes all day.
//! * The file is durable on its own. A scout that keeps working while the app
//!   is closed loses nothing; a POST into a dead port loses the finding.
//! * Ingest is a plain read of a plain file, so it is testable without a PTY,
//!   an agent, or a socket - which is what the tests at the bottom do.
//!
//! Ingest re-reads the whole file every pass and derives each row's id from the
//! content of its line ([`recommendation_id`]), so re-reading is idempotent: a
//! line that is already in the database inserts nothing, and a recommendation
//! the user has dismissed stays dismissed. A half-written trailing line simply
//! fails to parse and is picked up on the next pass.
//!
//! The control API keeps `POST /api/recommendations` all the same (see
//! [`crate::api`]) - it is the route for anything that is *not* a coding agent
//! in a terminal.
//!
//! ## The line format
//!
//! One JSON object per line, in [`SCOUT_FILE`]:
//!
//! ```text
//! {"title":"ratatui","url":"https://github.com/ratatui/ratatui","rationale":"...","effort":"M"}
//! ```
//!
//! `title` and `rationale` are required; `url` and `effort` are optional.
//! Anything else on the line is ignored, and a line that is not a JSON object
//! with those two fields is skipped rather than fatal.

use std::path::Path;
use std::thread;
use std::time::Duration;

use serde_json::Value;

use crate::profiles::{self, AgentProfile};
use crate::store::{
    self, Project, QueueEntry, Recommendation, Store, Worker, WorkerRow, KIND_SCOUT, QUEUE_READY,
    REC_ACCEPTED, REC_DISMISSED, REC_NEW, STATUS_RUNNING,
};
use crate::workers::{AgentControl, ERR_REFUSED, ERR_UNKNOWN};

/// The agent a scout runs. `--append-system-prompt` is a Claude Code flag, and
/// `WebSearch`/`WebFetch` are Claude Code tools, so the role is that profile's.
pub const SCOUT_PROFILE: &str = "claude";

/// Where a scout writes its findings, relative to the repository root.
pub const SCOUT_FILE: &str = ".pa-scout.jsonl";

/// Profile a queued integration task runs under.
const INTEGRATION_PROFILE: &str = "claude";

/// How often the background ingest re-reads every project's scout file. Slow
/// on purpose: a research agent produces a line every few minutes at best.
pub const INGEST_INTERVAL: Duration = Duration::from_secs(20);

// -- creating scouts -------------------------------------------------------

/// Start a project's scout: a row, no worktree, and a Claude agent in the
/// repository root that has been told to go looking.
///
/// Cheap to make and cheap to lose, exactly like an orchestrator: there is no
/// branch and no checkout, so a failed spawn has only the row to roll back.
///
/// `spawned_by` is the hierarchy bookkeeping of [`crate::workers::create_worker`];
/// a scout is normally started by the user and passes `None`.
pub async fn create_scout(
    store: &Store,
    agents: &dyn AgentControl,
    project_id: &str,
    spawned_by: Option<&str>,
) -> Result<Worker, String> {
    let project = require_project(store, project_id).await?;
    let task = scout_task(&project.name);
    spawn_scout(store, agents, &project, task, spawned_by).await
}

/// Start a scout whose assignment is a fixed list of repositories: fetch each
/// one, judge whether it is worth anything to ProjectA, and write down one
/// recommendation per URL - including the ones it advises against.
pub async fn triage_repos(
    store: &Store,
    agents: &dyn AgentControl,
    project_id: &str,
    urls: &[String],
    spawned_by: Option<&str>,
) -> Result<Worker, String> {
    let urls: Vec<String> = urls
        .iter()
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty())
        .collect();
    if urls.is_empty() {
        return Err("at least one repository url is required".to_string());
    }
    let project = require_project(store, project_id).await?;
    let task = triage_task(&urls);
    spawn_scout(store, agents, &project, task, spawned_by).await
}

/// The half [`create_scout`] and [`triage_repos`] have in common: the row, the
/// agent, and the task typed into it.
async fn spawn_scout(
    store: &Store,
    agents: &dyn AgentControl,
    project: &Project,
    task: String,
    spawned_by: Option<&str>,
) -> Result<Worker, String> {
    let profile = profiles::find_profile(SCOUT_PROFILE)
        .ok_or_else(|| format!("{ERR_UNKNOWN}agent profile: {SCOUT_PROFILE}"))?;
    // Same guard as every other spawn path: a profile the user switched off
    // does not start, whichever role asked for it. No playbook is injected
    // here - a scout researches the outside world, and this project's own
    // lessons are not what it is looking at.
    crate::learnings::ensure_profile_enabled(store, SCOUT_PROFILE).await?;
    crate::routing::ensure_spawnable(store).await?;

    let worker_id = store::new_id("wk");
    let row = WorkerRow {
        id: worker_id.clone(),
        project_id: project.id.clone(),
        task,
        profile_id: profile.id.clone(),
        // No branch: a scout never writes code, and the GitHub poller skips
        // empty branches, which is exactly right here.
        branch: String::new(),
        worktree_path: project.repo_path.clone(),
        status: STATUS_RUNNING.to_string(),
        kind: KIND_SCOUT.to_string(),
        pr_url: None,
        spawned_by: spawned_by.map(str::to_string),
        test_status: None,
        tested_at: None,
        // A scout has no role variants: there is one shape of scout.
        role_variant_id: None,
        paused_reason: None,
        created_at: store::now_unix_secs(),
    };
    store.insert_worker(&row).await?;

    let launch = scout_profile(&profile, project);
    // Through the same funnel as every other spawn, so a routed scout profile
    // reaches the router too instead of silently landing at the vendor.
    let routed = crate::routing::spawn_routing(
        store,
        &profile,
        Some(Path::new(&project.repo_path)),
        &worker_id,
    )
    .await?;
    let env = routed.env;
    // Bound before the child starts, like every spawn path: an agent that
    // exits at once must still be found by the exit hook.
    let session_id = match agents.spawn_bound(
        &worker_id,
        &launch,
        Path::new(&project.repo_path),
        &env,
        &|session_id| store.bind_session_in_memory(&worker_id, session_id),
    ) {
        Ok(session_id) => session_id,
        Err(err) => {
            let _ = store.take_session(&worker_id);
            let _ = store.delete_worker(&worker_id).await;
            return Err(err);
        }
    };

    store.record_session_start(&worker_id, &session_id).await;
    // Unlike an orchestrator - which waits for the user to talk to it - a scout
    // is meant to start researching on its own, so the assignment is typed in.
    // NT-17: the guard gets the profile's readiness marker when it knows one.
    let marker =
        profiles::find_profile(&row.profile_id).and_then(|profile| profile.caps.readiness_marker);
    if let Err(err) =
        agents.start_task_delivery(&worker_id, &session_id, &row.task, marker.as_deref(), None)
    {
        let _ = store.take_session(&worker_id);
        agents.kill(&session_id);
        let _ = store.delete_worker(&worker_id).await;
        return Err(err);
    }
    Ok(row.into_worker(Some(session_id)))
}

async fn require_project(store: &Store, project_id: &str) -> Result<Project, String> {
    store
        .get_project(project_id)
        .await?
        .ok_or_else(|| format!("{ERR_UNKNOWN}project: {project_id}"))
}

/// `profile`, plus the system prompt that turns it into a scout.
///
/// Public because [`crate::workers::respawn_worker`] has to put the prompt back
/// on: a scout without it would be an ordinary agent loose in the repository
/// root, which is the one thing it must not be.
pub fn scout_profile(profile: &AgentProfile, project: &Project) -> AgentProfile {
    let mut profile = profile.clone();
    profile.args.push("--append-system-prompt".to_string());
    profile
        .args
        .push(scout_system_prompt(&project.name, &project.id));
    profile
}

/// The assignment a general-purpose scout is started with.
pub fn scout_task(project_name: &str) -> String {
    format!("Scout for {project_name}: Repo analysieren und Verbesserungen recherchieren")
}

/// The assignment a triage scout is started with: the list of URLs to judge.
pub fn triage_task(urls: &[String]) -> String {
    let mut task = format!(
        "Repo-Triage: Bewerte die folgenden {} Repositories fuer ProjectA.\n",
        urls.len()
    );
    for url in urls {
        task.push_str(&format!("- {url}\n"));
    }
    task.push_str(
        "\nGehe sie der Reihe nach durch. Hole zu jedem Repository das README (WebFetch) und, \
         wenn noetig, weitere Seiten. Beurteile zwei Dinge getrennt: (1) Nutzen - was koennte \
         ProjectA damit, das es heute nicht kann? (2) Machbarkeit - passt es zu Tauri 2, Rust \
         und TypeScript, wie gross waere der Eingriff, wie aktiv ist das Projekt, welche Lizenz? \
         Schreibe fuer JEDES Repository genau einen Eintrag in ",
    );
    task.push_str(SCOUT_FILE);
    task.push_str(
        " - auch fuer die, von denen du abraetst; dann beginnt die rationale mit \"Abraten:\" \
         und nennt den Grund. Wenn du fertig bist, fasse dein Urteil kurz zusammen.",
    );
    task
}

/// The scout's marching orders.
///
/// German, like the orchestrator's, and blunt about the two rules that matter:
/// a scout does not write code, and everything it finds goes into
/// [`SCOUT_FILE`] - one JSON object per line - or it never reaches the app.
pub fn scout_system_prompt(project_name: &str, project_id: &str) -> String {
    format!(
        "Du bist der Research-Scout des Projekts \"{project_name}\" in ProjectA.\n\
         Projekt-ID: {project_id}\n\
         \n\
         DEINE ROLLE\n\
         - Du durchsuchst dieses Repository und das Internet nach Bibliotheken, Repositories\n\
         \x20 und Werkzeugen, die dem Projekt neue Faehigkeiten geben oder es messbar\n\
         \x20 verbessern (Performance, Stabilitaet, Entwicklungstempo, Bedienbarkeit).\n\
         - Fuer die Recherche nutzt du WebSearch und WebFetch. Lies zuerst das Repository\n\
         \x20 (README.md, STATUS.md, src-tauri/src/, src/), damit deine Vorschlaege zum\n\
         \x20 tatsaechlichen Stand passen und nicht zu einem geratenen.\n\
         - Du implementierst NIEMALS selbst Code: keine Quelldatei anlegen, aendern oder\n\
         \x20 loeschen, keine Abhaengigkeit installieren, keine Builds, keine Commits.\n\
         \x20 Die einzige Datei, die du schreibst, ist {SCOUT_FILE}.\n\
         - Du antwortest kurz und auf Deutsch.\n\
         \n\
         SO MELDEST DU EINEN FUND\n\
         Haenge im Projektwurzelverzeichnis an die Datei {SCOUT_FILE} pro Fund GENAU EINE\n\
         Zeile an - ein JSON-Objekt, einzeilig, kein Array, keine Kommentare, kein Markdown:\n\
         \x20 {{\"title\":\"<Name>\",\"url\":\"<Link oder weglassen>\",\"rationale\":\"<warum es hier hilft, 1-3 Saetze>\",\"effort\":\"S|M|L\"}}\n\
         - title und rationale sind Pflicht, url und effort sind optional.\n\
         - Anhaengen, niemals ueberschreiben: die Datei ist ein Protokoll.\n\
         - ProjectA liest die Datei regelmaessig ein. Gleiche Zeilen werden zu einem Eintrag\n\
         \x20 zusammengefasst, doppeltes Melden schadet also nicht - hilft aber auch nicht.\n\
         - Kein Fund ist auch ein Ergebnis. Erfinde nichts, nenne nichts, das du nicht\n\
         \x20 tatsaechlich nachgelesen hast, und schreibe in die rationale, was du geprueft hast.\n\
         \n\
         MASSSTAB\n\
         - Konkret statt allgemein: \"ratatui fuer die Board-Ansicht im Terminal\" ist ein\n\
         \x20 Vorschlag, \"bessere UI-Bibliothek nutzen\" ist keiner.\n\
         - Passend zum Stack: Tauri 2, Rust, TypeScript. Was nicht dazu passt, gehoert nur\n\
         \x20 dann in die Liste, wenn der Gewinn den Bruch rechtfertigt - dann sag das dazu.\n\
         - Nenne Lizenz und Aktivitaet, wenn beides fuer die Entscheidung zaehlt.\n\
         - Der Nutzer entscheidet, nicht du: jeder Eintrag wird angenommen oder verworfen."
    )
}

// -- ingest ----------------------------------------------------------------

/// Read one project's scout file and store everything new in it.
///
/// Returns how many recommendations this pass added. A missing file is zero,
/// not an error: most projects never have a scout.
pub async fn ingest_project(store: &Store, project: &Project) -> Result<usize, String> {
    let path = Path::new(&project.repo_path).join(SCOUT_FILE);
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Ok(0);
    };

    let mut added = 0;
    for line in raw.lines() {
        let Some(rec) = parse_recommendation_line(&project.id, line) else {
            continue;
        };
        if store.insert_recommendation(&rec).await? {
            added += 1;
        }
    }
    Ok(added)
}

/// One ingest pass over every project.
pub async fn ingest_all(store: &Store) -> Result<usize, String> {
    let mut added = 0;
    for project in store.list_projects().await? {
        added += ingest_project(store, &project).await?;
    }
    Ok(added)
}

/// Turn one line of [`SCOUT_FILE`] into a recommendation, or `None` when the
/// line is blank, is not a JSON object, or is missing `title`/`rationale`.
fn parse_recommendation_line(project_id: &str, line: &str) -> Option<Recommendation> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let value: Value = serde_json::from_str(line).ok()?;

    let title = trimmed_field(&value, "title")?;
    let rationale = trimmed_field(&value, "rationale")?;
    Some(Recommendation {
        id: recommendation_id(project_id, line),
        project_id: project_id.to_string(),
        title,
        url: trimmed_field(&value, "url"),
        rationale,
        effort: trimmed_field(&value, "effort"),
        status: REC_NEW.to_string(),
        created_at: store::now_unix_secs(),
    })
}

/// A string field with something in it, or `None`.
fn trimmed_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// An id derived from the line itself, which is what makes re-reading the file
/// harmless: the same line always lands on the same row.
///
/// FNV-1a rather than `DefaultHasher`, because this id is written to disk and
/// has to mean the same thing after a Rust upgrade - which `DefaultHasher`
/// explicitly does not promise.
fn recommendation_id(project_id: &str, line: &str) -> String {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;

    let mut hash = OFFSET;
    for byte in project_id
        .bytes()
        // A separator no id and no JSON line contains, so a project id ending
        // where the next one begins cannot collide.
        .chain(std::iter::once(0x1f))
        .chain(line.trim().bytes())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(PRIME);
    }
    format!("rc-{hash:016x}")
}

/// Start the always-on ingest at application startup.
pub fn start(store: Store) {
    thread::spawn(move || loop {
        if let Err(err) = tauri::async_runtime::block_on(ingest_all(&store)) {
            eprintln!("projecta: {err}");
        }
        thread::sleep(INGEST_INTERVAL);
    });
}

// -- reading and acting on recommendations ---------------------------------

/// A project's recommendations, freshest first-hand: the project's scout file
/// is ingested before the list is read, so a finding written a second ago is
/// already in it rather than up to [`INGEST_INTERVAL`] away.
///
/// An unreadable repository costs the freshness, not the list.
pub async fn list_recommendations(
    store: &Store,
    project_id: Option<&str>,
) -> Result<Vec<Recommendation>, String> {
    match project_id {
        Some(project_id) => {
            if let Some(project) = store.get_project(project_id).await? {
                let _ = ingest_project(store, &project).await;
            }
        }
        None => {
            let _ = ingest_all(store).await;
        }
    }
    store.list_recommendations(project_id).await
}

/// Accept or dismiss a recommendation without queueing anything.
///
/// Accepting through this door is the deliberate "yes, but I will schedule it
/// myself" - [`accept_recommendation`] is the one that also creates the task.
pub async fn set_recommendation_status(
    store: &Store,
    id: &str,
    status: &str,
) -> Result<(), String> {
    if status != REC_ACCEPTED && status != REC_DISMISSED {
        return Err(format!(
            "unknown recommendation status: {status} (expected {REC_ACCEPTED} or {REC_DISMISSED})"
        ));
    }
    store.set_recommendation_status(id, status).await
}

/// Record a recommendation that did not come out of a scout file.
///
/// This is what `POST /api/recommendations` is for: a caller that speaks HTTP
/// anyway - a script, another tool, a frontend - rather than a coding agent in
/// a terminal, which is told to append to [`SCOUT_FILE`] instead.
///
/// The id is derived the same way ingest derives it, so posting the same
/// finding twice updates nothing and, like ingest, cannot undo a dismissal.
/// Returns the stored row, which for a repeat post is the one already there.
pub async fn add_recommendation(
    store: &Store,
    project_id: &str,
    title: &str,
    rationale: &str,
    url: Option<String>,
    effort: Option<String>,
) -> Result<Recommendation, String> {
    let title = title.trim();
    let rationale = rationale.trim();
    if title.is_empty() || rationale.is_empty() {
        return Err("title and rationale are required".to_string());
    }
    if store.get_project(project_id).await?.is_none() {
        return Err(format!("{ERR_UNKNOWN}project: {project_id}"));
    }

    // Hashing the same canonical line an ingested finding would produce keeps
    // the two doors on one id scheme.
    let line = canonical_line(title, rationale, url.as_deref(), effort.as_deref());
    let rec = Recommendation {
        id: recommendation_id(project_id, &line),
        project_id: project_id.to_string(),
        title: title.to_string(),
        url: url
            .map(|url| url.trim().to_string())
            .filter(|url| !url.is_empty()),
        rationale: rationale.to_string(),
        effort: effort
            .map(|effort| effort.trim().to_string())
            .filter(|effort| !effort.is_empty()),
        status: REC_NEW.to_string(),
        created_at: store::now_unix_secs(),
    };
    if store.insert_recommendation(&rec).await? {
        return Ok(rec);
    }
    // Already known: hand back what is actually stored, dismissal and all.
    store
        .get_recommendation(&rec.id)
        .await?
        .ok_or_else(|| format!("failed to store recommendation: {}", rec.id))
}

/// The scout-file line a recommendation would have been written as. Field
/// order is fixed so the same finding always hashes to the same id.
fn canonical_line(title: &str, rationale: &str, url: Option<&str>, effort: Option<&str>) -> String {
    let mut line = serde_json::Map::new();
    line.insert("title".to_string(), Value::String(title.trim().to_string()));
    if let Some(url) = url.map(str::trim).filter(|url| !url.is_empty()) {
        line.insert("url".to_string(), Value::String(url.to_string()));
    }
    line.insert(
        "rationale".to_string(),
        Value::String(rationale.trim().to_string()),
    );
    if let Some(effort) = effort.map(str::trim).filter(|effort| !effort.is_empty()) {
        line.insert("effort".to_string(), Value::String(effort.to_string()));
    }
    Value::Object(line).to_string()
}

/// Take a recommendation up: queue the integration work and mark it accepted.
///
/// The queue entry is created `ready`, so the Phase 7.0 dispatcher picks it up
/// on its next sweep and gives it a worker with a worktree of its own - which
/// is where the code finally gets written.
pub async fn accept_recommendation(store: &Store, id: &str) -> Result<QueueEntry, String> {
    let rec = store
        .get_recommendation(id)
        .await?
        .ok_or_else(|| format!("{ERR_UNKNOWN}recommendation: {id}"))?;

    // Claim first, atomically: of two concurrent accepts only one flips the
    // row to `accepted`, so only one gets to enqueue. Enqueue-then-mark reads
    // nicer but lets both callers pass the status check and dispatch the same
    // work twice.
    if !store.claim_recommendation(id).await? {
        return Err(format!(
            "{ERR_REFUSED}recommendation {id} has already been accepted"
        ));
    }

    let entry = QueueEntry {
        id: store::new_id("tq"),
        project_id: rec.project_id.clone(),
        raw_text: integration_task(&rec),
        sharpened_text: None,
        profile_id: INTEGRATION_PROFILE.to_string(),
        status: QUEUE_READY.to_string(),
        priority: 0,
        worker_id: None,
        error: None,
        spawned_by: None,
        created_at: store::now_unix_secs(),
    };
    if let Err(err) = store.insert_queue_entry(&entry).await {
        // Give the claim back so the recommendation stays retryable. If even
        // this write fails the recommendation is stuck on `accepted` with no
        // task behind it - rarer and more visible than dispatching twice.
        if let Err(rollback) = store.set_recommendation_status(&rec.id, &rec.status).await {
            eprintln!("projecta: {rollback}");
        }
        return Err(err);
    }
    Ok(entry)
}

/// The task text a worker gets when a recommendation is accepted.
fn integration_task(rec: &Recommendation) -> String {
    let mut task = format!("Integriere die Empfehlung \"{}\" in ProjectA.\n", rec.title);
    if let Some(url) = &rec.url {
        task.push_str(&format!("Quelle: {url}\n"));
    }
    task.push_str(&format!("Begruendung des Scouts: {}\n", rec.rationale));
    if let Some(effort) = &rec.effort {
        task.push_str(&format!("Geschaetzter Aufwand: {effort}\n"));
    }
    task.push_str(
        "\nPruefe zuerst selbst, ob die Empfehlung traegt: lies die Quelle, sieh dir an, wie \
         ProjectA die Stelle heute loest, und entscheide, ob der Eingriff sich lohnt. Wenn ja, \
         setze ihn vollstaendig um - inklusive Tests - und halte dich an die bestehenden \
         Konventionen des Repositories. Wenn nein, aendere nichts und schreibe kurz auf, was \
         dagegen spricht.",
    );
    task
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{QUEUE_DISPATCHED, REC_DISMISSED};
    use crate::testutil::{init_repo, TempDir};
    use std::sync::Mutex;

    /// Records what it was asked to do and hands out predictable session ids.
    #[derive(Default)]
    struct FakeAgents {
        spawned: Mutex<Vec<(String, String)>>,
        args: Mutex<Vec<Vec<String>>>,
        killed: Mutex<Vec<String>>,
        deliveries: Mutex<Vec<(String, String)>>,
        fail: bool,
    }

    impl FakeAgents {
        fn failing() -> Self {
            Self {
                fail: true,
                ..Self::default()
            }
        }
    }

    impl AgentControl for FakeAgents {
        fn spawn(
            &self,
            _worker_id: &str,
            profile: &AgentProfile,
            cwd: &Path,
            _env: &[(String, String)],
        ) -> Result<String, String> {
            if self.fail {
                return Err("failed to spawn 'claude': boom".to_string());
            }
            self.args.lock().unwrap().push(profile.args.clone());
            let mut spawned = self.spawned.lock().unwrap();
            spawned.push((profile.id.clone(), cwd.to_string_lossy().into_owned()));
            Ok(format!("pty-fake-{}", spawned.len()))
        }

        fn kill(&self, session_id: &str) {
            self.killed.lock().unwrap().push(session_id.to_string());
        }

        fn start_task_delivery(
            &self,
            worker_id: &str,
            _session_id: &str,
            task: &str,
            _readiness_marker: Option<&str>,
            _on_outcome: Option<crate::workers::DeliveryCallback>,
        ) -> Result<(), String> {
            self.deliveries
                .lock()
                .unwrap()
                .push((worker_id.to_string(), task.to_string()));
            Ok(())
        }
    }

    struct Fixture {
        _dir: TempDir,
        store: Store,
        project: Project,
    }

    impl Fixture {
        /// Append `lines` to the project's scout file, as an agent would.
        fn write_scout_file(&self, lines: &[&str]) {
            let path = Path::new(&self.project.repo_path).join(SCOUT_FILE);
            let mut body = std::fs::read_to_string(&path).unwrap_or_default();
            for line in lines {
                body.push_str(line);
                body.push('\n');
            }
            std::fs::write(&path, body).expect("write scout file");
        }
    }

    async fn fixture(label: &str) -> Fixture {
        let dir = TempDir::new(label);
        let repo = init_repo(&dir.path().join("repo"))
            .to_string_lossy()
            .into_owned();
        let store = Store::open(&dir.path().join("projecta.db"))
            .await
            .expect("open store");
        let project = store
            .create_project("ProjectA", &repo)
            .await
            .expect("create project");
        Fixture {
            _dir: dir,
            store,
            project,
        }
    }

    fn line(title: &str, rationale: &str) -> String {
        serde_json::json!({ "title": title, "rationale": rationale }).to_string()
    }

    // -- creating scouts ---------------------------------------------------

    #[tokio::test]
    async fn a_scout_gets_no_worktree_and_its_own_kind() {
        let fx = fixture("scout-create").await;
        let agents = FakeAgents::default();

        let worker = create_scout(&fx.store, &agents, &fx.project.id, None)
            .await
            .expect("create scout");

        assert_eq!(worker.kind, KIND_SCOUT);
        assert_eq!(worker.profile_id, SCOUT_PROFILE);
        assert_eq!(worker.status, STATUS_RUNNING);
        assert_eq!(worker.session_id.as_deref(), Some("pty-fake-1"));
        assert_eq!(worker.task, scout_task("ProjectA"));

        // No branch, no checkout: the agent reads the repository itself.
        assert!(worker.branch.is_empty(), "{}", worker.branch);
        assert_eq!(worker.worktree_path, fx.project.repo_path);
        assert_eq!(agents.spawned.lock().unwrap()[0].1, fx.project.repo_path);
        let worktrees = fx._dir.path().join(crate::worktree::WORKTREES_DIR);
        assert!(
            !worktrees.exists(),
            "{} should not exist",
            worktrees.display()
        );

        // Persisted like any other worker, so the board shows it.
        let stored = fx.store.get_worker(&worker.id).await.unwrap().unwrap();
        assert_eq!(stored, worker);
        assert_eq!(stored.kind, KIND_SCOUT);

        // A scout starts researching on its own, so the assignment is typed in.
        assert_eq!(
            *agents.deliveries.lock().unwrap(),
            vec![(worker.id.clone(), worker.task.clone())]
        );
    }

    #[tokio::test]
    async fn a_scout_is_launched_with_its_marching_orders() {
        let fx = fixture("scout-prompt").await;
        let agents = FakeAgents::default();

        create_scout(&fx.store, &agents, &fx.project.id, None)
            .await
            .unwrap();

        let args = agents.args.lock().unwrap()[0].clone();
        let flag = args
            .iter()
            .position(|arg| arg == "--append-system-prompt")
            .expect("the scout carries a system prompt");
        let prompt = &args[flag + 1];

        assert!(prompt.contains("Research-Scout"), "{prompt}");
        assert!(prompt.contains(&fx.project.id), "{prompt}");
        assert!(prompt.contains("NIEMALS selbst Code"), "{prompt}");
        assert!(prompt.contains("WebSearch"), "{prompt}");
        assert!(prompt.contains("WebFetch"), "{prompt}");
        // The output contract is the part it cannot be allowed to improvise.
        assert!(prompt.contains(SCOUT_FILE), "{prompt}");
        assert!(prompt.contains("\"rationale\""), "{prompt}");
    }

    #[tokio::test]
    async fn triage_names_every_repository_in_the_task() {
        let fx = fixture("scout-triage").await;
        let agents = FakeAgents::default();
        let urls = vec![
            "https://github.com/ratatui/ratatui".to_string(),
            "  https://github.com/tokio-rs/tokio  ".to_string(),
            "   ".to_string(),
        ];

        let worker = triage_repos(&fx.store, &agents, &fx.project.id, &urls, None)
            .await
            .expect("triage");

        assert_eq!(worker.kind, KIND_SCOUT);
        assert!(worker.branch.is_empty(), "{}", worker.branch);
        assert_eq!(worker.worktree_path, fx.project.repo_path);
        assert!(worker.task.contains("ratatui"), "{}", worker.task);
        assert!(worker.task.contains("tokio"), "{}", worker.task);
        // The blank url is dropped rather than triaged.
        assert!(
            worker.task.contains("folgenden 2 Repositories"),
            "{}",
            worker.task
        );
        assert!(worker.task.contains(SCOUT_FILE), "{}", worker.task);
        // Including a verdict for the ones it advises against.
        assert!(worker.task.contains("Abraten:"), "{}", worker.task);

        // The assignment is what gets typed into the terminal.
        assert_eq!(agents.deliveries.lock().unwrap()[0].1, worker.task);
    }

    #[tokio::test]
    async fn triage_needs_a_url_and_a_known_project() {
        let fx = fixture("scout-triage-invalid").await;
        let agents = FakeAgents::default();

        let err = triage_repos(&fx.store, &agents, &fx.project.id, &[], None)
            .await
            .expect_err("no urls");
        assert!(err.contains("at least one repository url"), "{err}");

        let err = triage_repos(
            &fx.store,
            &agents,
            &fx.project.id,
            &["  ".to_string()],
            None,
        )
        .await
        .expect_err("blank url");
        assert!(err.contains("at least one repository url"), "{err}");

        let err = triage_repos(
            &fx.store,
            &agents,
            "pj-nope",
            &["https://x".to_string()],
            None,
        )
        .await
        .expect_err("unknown project");
        assert!(err.contains("unknown project"), "{err}");

        let err = create_scout(&fx.store, &agents, "pj-nope", None)
            .await
            .expect_err("unknown project");
        assert!(err.contains("unknown project"), "{err}");

        assert!(fx.store.list_workers(None).await.unwrap().is_empty());
        assert!(agents.spawned.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_failed_scout_spawn_leaves_no_row_behind() {
        let fx = fixture("scout-rollback").await;
        let agents = FakeAgents::failing();

        let err = create_scout(&fx.store, &agents, &fx.project.id, None)
            .await
            .expect_err("spawn must fail");
        assert!(err.contains("failed to spawn"), "{err}");
        assert!(fx.store.list_workers(None).await.unwrap().is_empty());
    }

    // -- ingest ------------------------------------------------------------

    #[tokio::test]
    async fn ingest_reads_the_scout_file_and_is_idempotent() {
        let fx = fixture("scout-ingest").await;
        assert_eq!(ingest_project(&fx.store, &fx.project).await.unwrap(), 0);

        fx.write_scout_file(&[
            &serde_json::json!({
                "title": "ratatui",
                "url": "https://github.com/ratatui/ratatui",
                "rationale": "Board im Terminal",
                "effort": "M",
            })
            .to_string(),
            &line("notify", "Dateiwaechter statt Polling"),
        ]);

        assert_eq!(ingest_project(&fx.store, &fx.project).await.unwrap(), 2);
        let recs = fx
            .store
            .list_recommendations(Some(&fx.project.id))
            .await
            .unwrap();
        assert_eq!(recs.len(), 2);
        assert_eq!(recs[0].title, "ratatui");
        assert_eq!(
            recs[0].url.as_deref(),
            Some("https://github.com/ratatui/ratatui")
        );
        assert_eq!(recs[0].rationale, "Board im Terminal");
        assert_eq!(recs[0].effort.as_deref(), Some("M"));
        assert_eq!(recs[0].status, REC_NEW);
        assert_eq!(recs[0].project_id, fx.project.id);
        // Optional fields really are optional.
        assert_eq!(recs[1].url, None);
        assert_eq!(recs[1].effort, None);

        // Reading the same file again adds nothing; only the new line counts.
        assert_eq!(ingest_project(&fx.store, &fx.project).await.unwrap(), 0);
        fx.write_scout_file(&[&line("sqlx", "schon drin, nur als drittes")]);
        assert_eq!(ingest_project(&fx.store, &fx.project).await.unwrap(), 1);
        assert_eq!(
            fx.store
                .list_recommendations(Some(&fx.project.id))
                .await
                .unwrap()
                .len(),
            3
        );
    }

    #[tokio::test]
    async fn ingest_never_resurrects_a_dismissed_recommendation() {
        let fx = fixture("scout-ingest-dismissed").await;
        fx.write_scout_file(&[&line("ratatui", "Board im Terminal")]);
        ingest_project(&fx.store, &fx.project).await.unwrap();

        let id = fx.store.list_recommendations(None).await.unwrap()[0]
            .id
            .clone();
        set_recommendation_status(&fx.store, &id, REC_DISMISSED)
            .await
            .unwrap();

        // The line is still in the file, and every pass reads it again.
        assert_eq!(ingest_project(&fx.store, &fx.project).await.unwrap(), 0);
        let recs = fx.store.list_recommendations(None).await.unwrap();
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].status, REC_DISMISSED);
    }

    #[test]
    fn broken_lines_are_skipped_rather_than_fatal() {
        for bad in [
            "",
            "   ",
            "not json",
            "[1, 2, 3]",
            r#"{"title":"nur ein Titel"}"#,
            r#"{"rationale":"nur eine Begruendung"}"#,
            r#"{"title":"  ","rationale":"leer"}"#,
            // A line the agent is still in the middle of writing.
            r#"{"title":"halb","rationale":"abgeschn"#,
        ] {
            assert!(
                parse_recommendation_line("pj-1", bad).is_none(),
                "{bad} should not parse"
            );
        }

        let good = parse_recommendation_line("pj-1", r#"  {"title":" a ","rationale":"b"}  "#)
            .expect("parses");
        assert_eq!(good.title, "a");
        assert_eq!(good.rationale, "b");
        assert_eq!(good.status, REC_NEW);
    }

    #[test]
    fn ids_follow_the_content_not_the_clock() {
        let raw = r#"{"title":"a","rationale":"b"}"#;
        assert_eq!(
            recommendation_id("pj-1", raw),
            recommendation_id("pj-1", raw)
        );
        // Whitespace around the line is not content.
        assert_eq!(
            recommendation_id("pj-1", raw),
            recommendation_id("pj-1", &format!("  {raw}  "))
        );
        // The same finding in two projects is two recommendations.
        assert_ne!(
            recommendation_id("pj-1", raw),
            recommendation_id("pj-2", raw)
        );
        assert_ne!(
            recommendation_id("pj-1", raw),
            recommendation_id("pj-1", r#"{"title":"a","rationale":"c"}"#)
        );
        assert!(recommendation_id("pj-1", raw).starts_with("rc-"));
    }

    #[tokio::test]
    async fn ingest_sweeps_every_project_and_survives_a_missing_repository() {
        let fx = fixture("scout-ingest-all").await;
        fx.write_scout_file(&[&line("ratatui", "Board im Terminal")]);
        // A project whose repository is not there at all.
        fx.store
            .create_project("gone", "C:/repos/definitely-not-here")
            .await
            .unwrap();

        assert_eq!(ingest_all(&fx.store).await.unwrap(), 1);
        assert_eq!(fx.store.list_recommendations(None).await.unwrap().len(), 1);
    }

    // -- reading and acting ------------------------------------------------

    #[tokio::test]
    async fn listing_ingests_first_so_a_fresh_finding_is_already_there() {
        let fx = fixture("scout-list").await;
        fx.write_scout_file(&[&line("ratatui", "Board im Terminal")]);

        // No explicit ingest: the read does it.
        let recs = list_recommendations(&fx.store, Some(&fx.project.id))
            .await
            .unwrap();
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].title, "ratatui");

        // Unfiltered, and for a project that does not exist.
        assert_eq!(
            list_recommendations(&fx.store, None).await.unwrap().len(),
            1
        );
        assert!(list_recommendations(&fx.store, Some("pj-nope"))
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn accepting_queues_the_integration_and_flips_the_status() {
        let fx = fixture("scout-accept").await;
        fx.write_scout_file(&[&serde_json::json!({
            "title": "ratatui",
            "url": "https://github.com/ratatui/ratatui",
            "rationale": "Board im Terminal",
            "effort": "M",
        })
        .to_string()]);
        ingest_project(&fx.store, &fx.project).await.unwrap();
        let rec = fx.store.list_recommendations(None).await.unwrap().remove(0);

        let entry = accept_recommendation(&fx.store, &rec.id).await.unwrap();

        assert_eq!(entry.project_id, fx.project.id);
        assert_eq!(entry.status, QUEUE_READY);
        assert_eq!(entry.profile_id, "claude");
        assert!(entry.worker_id.is_none());
        assert!(entry.raw_text.contains("ratatui"), "{}", entry.raw_text);
        assert!(
            entry
                .raw_text
                .contains("https://github.com/ratatui/ratatui"),
            "{}",
            entry.raw_text
        );
        assert!(
            entry.raw_text.contains("Board im Terminal"),
            "{}",
            entry.raw_text
        );
        assert!(entry.raw_text.contains("Aufwand: M"), "{}", entry.raw_text);

        // The entry is really in the queue, ready for the dispatcher.
        let queued = fx.store.list_queue(Some(&fx.project.id)).await.unwrap();
        assert_eq!(queued, vec![entry.clone()]);
        assert_ne!(queued[0].status, QUEUE_DISPATCHED);

        // And the recommendation has moved.
        let stored = fx.store.get_recommendation(&rec.id).await.unwrap().unwrap();
        assert_eq!(stored.status, REC_ACCEPTED);

        // Accepting twice would queue the same work twice, so it is refused.
        let err = accept_recommendation(&fx.store, &rec.id)
            .await
            .expect_err("already accepted");
        assert!(err.contains("already been accepted"), "{err}");
        // A recommendation that is already accepted exists and the request is
        // well formed - it only arrives too late, which is what the `refused: `
        // opening says to the API route reading it.
        assert!(err.starts_with(crate::workers::ERR_REFUSED), "{err}");
        assert_eq!(fx.store.list_queue(None).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_failed_enqueue_rolls_the_claim_back_and_keeps_it_retryable() {
        let fx = fixture("scout-accept-rollback").await;
        let rec = add_recommendation(
            &fx.store,
            &fx.project.id,
            "retry me",
            "the queue is temporarily unavailable",
            None,
            None,
        )
        .await
        .unwrap();
        crate::store::tests::break_queue_inserts_for_test(&fx.store).await;

        let err = accept_recommendation(&fx.store, &rec.id)
            .await
            .expect_err("enqueue must fail without its table");
        assert!(err.contains("failed to enqueue task"), "{err}");
        assert_eq!(
            fx.store
                .get_recommendation(&rec.id)
                .await
                .unwrap()
                .unwrap()
                .status,
            REC_NEW
        );
        assert!(
            fx.store.claim_recommendation(&rec.id).await.unwrap(),
            "the rolled-back recommendation was not retryable"
        );
    }

    #[tokio::test]
    async fn a_failed_enqueue_restores_a_dismissed_recommendation_too() {
        let fx = fixture("scout-dismissed-rollback").await;
        let rec = add_recommendation(
            &fx.store,
            &fx.project.id,
            "retry dismissed",
            "status must round-trip",
            None,
            None,
        )
        .await
        .unwrap();
        set_recommendation_status(&fx.store, &rec.id, REC_DISMISSED)
            .await
            .unwrap();
        crate::store::tests::break_queue_inserts_for_test(&fx.store).await;

        accept_recommendation(&fx.store, &rec.id)
            .await
            .expect_err("enqueue must fail without its table");
        assert_eq!(
            fx.store
                .get_recommendation(&rec.id)
                .await
                .unwrap()
                .unwrap()
                .status,
            REC_DISMISSED
        );
        assert!(fx.store.claim_recommendation(&rec.id).await.unwrap());
    }

    #[tokio::test]
    async fn statuses_are_checked_and_unknown_ids_are_named() {
        let fx = fixture("scout-status").await;
        fx.write_scout_file(&[&line("ratatui", "Board im Terminal")]);
        ingest_project(&fx.store, &fx.project).await.unwrap();
        let id = fx.store.list_recommendations(None).await.unwrap()[0]
            .id
            .clone();

        set_recommendation_status(&fx.store, &id, REC_DISMISSED)
            .await
            .unwrap();
        assert_eq!(
            fx.store
                .get_recommendation(&id)
                .await
                .unwrap()
                .unwrap()
                .status,
            REC_DISMISSED
        );
        set_recommendation_status(&fx.store, &id, REC_ACCEPTED)
            .await
            .unwrap();

        let err = set_recommendation_status(&fx.store, &id, "maybe")
            .await
            .expect_err("unknown status");
        assert!(err.contains("unknown recommendation status"), "{err}");

        let err = set_recommendation_status(&fx.store, "rc-nope", REC_DISMISSED)
            .await
            .expect_err("unknown id");
        assert!(err.contains("unknown recommendation"), "{err}");

        let err = accept_recommendation(&fx.store, "rc-nope")
            .await
            .expect_err("unknown id");
        assert!(err.contains("unknown recommendation"), "{err}");
    }

    /// A dismissed recommendation the user changes their mind about still
    /// queues its work.
    #[tokio::test]
    async fn the_claim_is_atomic_and_single_winner() {
        let fx = fixture("scout-claim").await;
        let rec = add_recommendation(
            &fx.store,
            &fx.project.id,
            "einmalig",
            "weil einmal reicht",
            None,
            None,
        )
        .await
        .unwrap();

        // Exactly one caller wins the claim; every later one loses it without
        // an error - which is what lets two racing accepts stay serialised.
        assert!(fx.store.claim_recommendation(&rec.id).await.unwrap());
        assert!(!fx.store.claim_recommendation(&rec.id).await.unwrap());
        assert!(!fx.store.claim_recommendation(&rec.id).await.unwrap());
    }

    #[tokio::test]
    async fn a_dismissed_recommendation_can_still_be_accepted() {
        let fx = fixture("scout-undismiss").await;
        fx.write_scout_file(&[&line("ratatui", "Board im Terminal")]);
        ingest_project(&fx.store, &fx.project).await.unwrap();
        let id = fx.store.list_recommendations(None).await.unwrap()[0]
            .id
            .clone();

        set_recommendation_status(&fx.store, &id, REC_DISMISSED)
            .await
            .unwrap();
        let entry = accept_recommendation(&fx.store, &id).await.unwrap();

        assert_eq!(entry.status, QUEUE_READY);
        assert_eq!(
            fx.store
                .get_recommendation(&id)
                .await
                .unwrap()
                .unwrap()
                .status,
            REC_ACCEPTED
        );
    }

    // -- recommendation urls: only http(s) reaches the store ----------------

    /// A `javascript:` or `file:` link in a recommendation is one click away
    /// from script execution in the HQ board, so the API door refuses it
    /// outright instead of storing it for a renderer to find.
    #[tokio::test]
    async fn add_recommendation_refuses_non_http_urls() {
        let fx = fixture("scout-url-scheme").await;
        for bad in [
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,<script>alert(1)</script>",
            "ftp://example.com/x",
        ] {
            let err = add_recommendation(
                &fx.store,
                &fx.project.id,
                "a finding",
                "why it helps",
                Some(bad.to_string()),
                None,
            )
            .await
            .expect_err("non-http url must be refused");
            assert!(err.contains("http"), "{err}");
        }

        for good in ["https://example.com/spec", "http://example.com/lan"] {
            let rec = add_recommendation(
                &fx.store,
                &fx.project.id,
                "a finding",
                "why it helps",
                Some(good.to_string()),
                None,
            )
            .await
            .expect("http(s) url");
            assert_eq!(rec.url.as_deref(), Some(good));
        }
    }

    /// The scout-file door cannot answer with an error - the agent that wrote
    /// the line is long gone - so ingest keeps the finding but drops the link
    /// no renderer may show.
    #[tokio::test]
    async fn ingest_drops_non_http_urls_but_keeps_the_finding() {
        let fx = fixture("scout-url-ingest").await;
        fx.write_scout_file(&[
            r#"{"title":"shady","url":"javascript:alert(1)","rationale":"looks useful"}"#,
        ]);

        let added = ingest_project(&fx.store, &fx.project).await.unwrap();
        assert_eq!(added, 1);
        let recs = fx.store.list_recommendations(None).await.unwrap();
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].title, "shady");
        assert_eq!(recs[0].url, None, "a non-http url must not be stored");
    }
}
