//! The daily digest: one Markdown page per project per day, for the vault.
//!
//! ProjectA already records everything a day was made of - the board's
//! columns, the status events, the workers' message logs, the quota rows - but
//! all of it is read one screen at a time, in an app that has to be open. The
//! digest is the same facts written down once a day into
//! `<repo>/.pa/memory/digests/YYYY-MM-DD.md`, which is where the user's
//! Obsidian vault already looks: `.pa/` is the shared agent memory (see
//! [`crate::ruflo`]) and it is gitignored, so a digest is reading material and
//! never a repository artefact. The artefacts that *do* belong to the
//! repository are `PLAYBOOK.md` and `MEMORY.md`, and the page links to both.
//!
//! Two things are deliberate about how it is produced:
//!
//! * **No agent runs.** Every line is templated from rows this app already
//!   has. A digest costs no tokens, cannot fail because a CLI is missing, and
//!   says nothing that was not observed.
//! * **Yesterday, not today.** The hourly thread writes the most recent day
//!   that is actually over. A digest of a day still in progress would be
//!   rewritten all day or, worse, be wrong and final at 00:30.
//!
//! Writing is `tmp` + rename, so a reader either sees the whole page or no
//! page at all - which is also what makes the file its own marker: the
//! scheduler skips a date whose file exists, and a half-written file can never
//! exist under that name.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::budget::{self, BudgetLimits};
use crate::quota::QuotaTracker;
use crate::status::StatusEngine;
use crate::store::{
    now_unix_secs, Message, Project, StatusEvent, Store, MSG_SYSTEM, STATUS_ARCHIVED,
};

/// The digest thread wakes once an hour. The work is one file per project per
/// day, so anything faster would be almost entirely "already written".
pub const POLL_INTERVAL: Duration = Duration::from_secs(60 * 60);

/// Settings key for the on/off switch. Absent means on.
pub const SETTING_ENABLED: &str = "digest.enabled";

/// Seconds in a day, which is also the length of one digest's window.
const DAY: i64 = 24 * 60 * 60;

/// A project with no activity in this many seconds gets no digest: an idle
/// repository does not need a page a day saying so. Slightly more than a day,
/// so an hourly tick cannot fall through the gap between two of them.
const ACTIVE_WITHIN: i64 = 26 * 60 * 60;

/// How many of a worker's most recent messages `store::list_messages` caps
/// at - the window the day query replaced, kept for the test that names what
/// used to fall out of it.
#[cfg(test)]
const MESSAGE_LIMIT: usize = 200;

/// Where a project's digests live.
pub fn digest_dir(repo_path: &str) -> PathBuf {
    Path::new(repo_path)
        .join(".pa")
        .join("memory")
        .join("digests")
}

/// The file one date's digest is written to.
pub fn digest_path(repo_path: &str, date: &str) -> PathBuf {
    digest_dir(repo_path).join(format!("{date}.md"))
}

/// Is this exactly `YYYY-MM-DD`, and a date that exists?
///
/// Load-bearing beyond tidiness: the date arrives from an HTTP path and from a
/// CLI argument and becomes a file name. Anything that is not four digits, a
/// dash, two digits, a dash and two digits is refused before it can be joined
/// to a path, which is what keeps `..` and absolute paths out.
pub fn is_valid_date(date: &str) -> bool {
    let bytes = date.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
    {
        return false;
    }
    // A shape that parses but names no day - 2026-02-31 - is still not a date.
    day_start(date).is_some()
}

/// Civil date from a day count since 1970-01-01, after Howard Hinnant's
/// `civil_from_days`. Written out rather than pulled in: this is the only date
/// arithmetic in the app, and a calendar crate would be a dependency for it.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// The inverse, `days_from_civil`. Returns `None` for a date that does not
/// exist, which is how [`is_valid_date`] rejects 2026-02-31.
///
/// Every multiplication on the year is checked: the year arrives as a string
/// from a foreign timestamp (a router log line, a usage row) and parses into
/// any `i64`, but `era * 146_097` overflows long before that. A date this
/// function cannot represent is not a date, exactly like 2026-02-31 - never a
/// reason to panic the thread that asked.
fn days_from_civil(y: i64, m: u32, d: u32) -> Option<i64> {
    if !(1..=12).contains(&m) || d == 0 || d > 31 {
        return None;
    }
    let y_adj = if m <= 2 { y.checked_sub(1)? } else { y };
    let era = if y_adj >= 0 {
        y_adj
    } else {
        y_adj.checked_sub(399)?
    } / 400;
    let yoe = (y_adj - era.checked_mul(400)?) as u64; // [0, 399]
    let mp = if m > 2 { m - 3 } else { m + 9 } as u64; // [0, 11]
    let doy = (153 * mp + 2) / 5 + u64::from(d) - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    let days = era
        .checked_mul(146_097)?
        .checked_add(doe as i64)?
        .checked_sub(719_468)?;
    // Round-tripping is what rejects a day the month does not have.
    let (ry, rm, rd) = civil_from_days(days);
    (ry == y && rm == m && rd == d).then_some(days)
}

/// The UTC date `unix` falls on, as `YYYY-MM-DD`.
///
/// UTC and not local time, so a digest names the same day whatever machine or
/// season reads it back. The day boundary is therefore not everybody's
/// midnight; the file says which convention it used in its front matter.
pub fn utc_date(unix: i64) -> String {
    let days = unix.div_euclid(DAY);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Midnight UTC of a `YYYY-MM-DD` date, or `None` when it is not one.
pub fn day_start(date: &str) -> Option<i64> {
    let (y, rest) = date.split_once('-')?;
    let (m, d) = rest.split_once('-')?;
    // A date far enough out that its midnight no longer fits an `i64` is not
    // a timestamp this app can file anything under - refused, not wrapped.
    days_from_civil(y.parse().ok()?, m.parse().ok()?, d.parse().ok()?)?.checked_mul(DAY)
}

/// The most recent day that is actually over, at `now`.
pub fn due_date(now: i64) -> String {
    utc_date(now - DAY)
}

/// Should this project get a digest right now?
///
/// Pure so the scheduling rule can be read and tested on its own: the project
/// has to have done something recently, and the page must not already be
/// there. Whether it is there is the caller's observation - the file system in
/// the app, a value in the tests.
pub fn is_due(now: i64, last_activity: Option<i64>, already_written: bool) -> bool {
    if already_written {
        return false;
    }
    last_activity.is_some_and(|last| now - last <= ACTIVE_WITHIN)
}

// -- what one page is made of ----------------------------------------------

/// One worker as the board had it when the digest was written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DigestBoardRow {
    pub worker_id: String,
    pub column: String,
    pub task: String,
    pub attention_reason: Option<String>,
}

/// One quota row, flattened to what the page prints.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DigestQuota {
    pub profile_id: String,
    pub state: String,
    pub reason: Option<String>,
    pub blocked_until: Option<i64>,
}

/// Everything one page is rendered from. Assembled by [`collect`] from the
/// store, the engine and the quota tracker; built by hand in the tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DigestInput {
    pub project_name: String,
    pub project_id: String,
    /// The day this page is about, `YYYY-MM-DD` in UTC.
    pub date: String,
    /// When the page was written, for the front matter.
    pub generated_at: i64,
    pub board: Vec<DigestBoardRow>,
    pub events: Vec<StatusEvent>,
    /// The day's messages, oldest first, across every worker of the project.
    pub messages: Vec<Message>,
    /// Worker id to a short label, so events and messages can name their
    /// worker without the reader having to look an id up.
    pub labels: BTreeMap<String, String>,
    pub quota: Vec<DigestQuota>,
    pub budgets: Vec<BudgetLimits>,
}

/// `hh:mm` UTC of a unix timestamp.
fn hhmm(unix: i64) -> String {
    let secs = unix.rem_euclid(DAY);
    format!("{:02}:{:02}", secs / 3600, (secs % 3600) / 60)
}

/// A worker id as a name a person can read.
fn label_of(labels: &BTreeMap<String, String>, worker_id: &str) -> String {
    match labels.get(worker_id) {
        Some(label) => format!("{label} ({worker_id})"),
        None => worker_id.to_string(),
    }
}

/// One line of text, safe to put inside a Markdown table cell and short enough
/// to read: anything that looks like a secret is masked, newlines become
/// spaces, pipes are escaped, and the rest is cut.
///
/// The redaction is first and is deliberately not optional. This is the one
/// place in the app that copies message and event text out of the database
/// into a file on disk, and a task somebody pasted a key into would otherwise
/// leave that key sitting in the vault. Cutting before masking would be worse
/// than not masking at all - it would store a *recognisable prefix* of the
/// key and no warning that anything was removed. See [`crate::redact`].
fn cell(text: &str, max: usize) -> String {
    let flat: String = crate::redact::redact(text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .replace('|', "\\|");
    if flat.chars().count() <= max {
        return flat;
    }
    let mut cut: String = flat.chars().take(max).collect();
    cut.push('\u{2026}');
    cut
}

/// Render one day's page. Pure: same input, same Markdown, no clock and no
/// filesystem. Everything the scheduler does is around this function.
pub fn render_digest(input: &DigestInput) -> String {
    let mut out = String::new();

    // Obsidian front matter. `project` is the name a human gave the repo; the
    // id is beside it because two projects may share a name.
    out.push_str("---\n");
    out.push_str(&format!("date: {}\n", input.date));
    out.push_str(&format!(
        "project: \"{}\"\n",
        input.project_name.replace('"', "'")
    ));
    out.push_str(&format!("project_id: {}\n", input.project_id));
    out.push_str("timezone: UTC\n");
    out.push_str(&format!("generated: {}\n", input.generated_at));
    out.push_str("generator: ProjectA\n");
    out.push_str("---\n\n");

    out.push_str(&format!("# {} - {}\n\n", input.date, input.project_name));
    out.push_str("Verwandt: [[PLAYBOOK]] - [[MEMORY]]\n\n");

    // -- board ------------------------------------------------------------
    out.push_str("## Board bei Erstellung\n\n");
    if input.board.is_empty() {
        out.push_str("Keine Worker.\n\n");
    } else {
        let mut by_column: BTreeMap<&str, Vec<&DigestBoardRow>> = BTreeMap::new();
        for row in &input.board {
            by_column.entry(row.column.as_str()).or_default().push(row);
        }
        for (column, rows) in &by_column {
            out.push_str(&format!("- **{column}** ({})\n", rows.len()));
            for row in rows {
                let reason = row
                    .attention_reason
                    .as_deref()
                    .map(|reason| format!(" - {}", cell(reason, 120)))
                    .unwrap_or_default();
                out.push_str(&format!(
                    "  - {} `{}`{reason}\n",
                    cell(&row.task, 80),
                    row.worker_id
                ));
            }
        }
        out.push('\n');
        // The board is a live view, not a record of the day: it says where the
        // cards stand when the page is written, which is the morning after.
        out.push_str(
            "_Der Board-Stand ist der zum Zeitpunkt der Erstellung, nicht der um Mitternacht._\n\n",
        );
    }

    // -- the day's events --------------------------------------------------
    out.push_str("## Tagesverlauf\n\n");
    if input.events.is_empty() {
        out.push_str("Keine Ereignisse.\n\n");
    } else {
        out.push_str("| Zeit | Worker | Ereignis | Quelle | Detail |\n");
        out.push_str("| --- | --- | --- | --- | --- |\n");
        for event in &input.events {
            out.push_str(&format!(
                "| {} | {} | {} | {} | {} |\n",
                hhmm(event.created_at),
                cell(&label_of(&input.labels, &event.worker_id), 40),
                cell(&event.kind, 24),
                cell(&event.source, 12),
                cell(&event.detail, 100),
            ));
        }
        out.push('\n');
    }

    // -- messages ----------------------------------------------------------
    out.push_str("## Worker-Aktivitaet\n\n");
    if input.messages.is_empty() {
        out.push_str("Keine Nachrichten.\n\n");
    } else {
        let mut per_role: BTreeMap<&str, usize> = BTreeMap::new();
        let mut per_worker: BTreeMap<&str, usize> = BTreeMap::new();
        for message in &input.messages {
            *per_role.entry(message.role.as_str()).or_default() += 1;
            *per_worker.entry(message.worker_id.as_str()).or_default() += 1;
        }
        out.push_str(&format!(
            "{} Nachrichten insgesamt:\n\n",
            input.messages.len()
        ));
        for (role, count) in &per_role {
            out.push_str(&format!("- {role}: {count}\n"));
        }
        out.push('\n');
        for (worker_id, count) in &per_worker {
            out.push_str(&format!(
                "- {} - {count}\n",
                label_of(&input.labels, worker_id)
            ));
        }
        out.push('\n');

        // The system lines are the ones worth quoting: they are what the app
        // itself recorded - spawns, pauses, exits, budget stops - rather than
        // the task text a human already knows.
        let system: Vec<&Message> = input
            .messages
            .iter()
            .filter(|message| message.role == MSG_SYSTEM)
            .collect();
        if !system.is_empty() {
            out.push_str("### System-Notizen\n\n");
            for message in system {
                out.push_str(&format!(
                    "- {} {} - {}\n",
                    hhmm(message.created_at),
                    label_of(&input.labels, &message.worker_id),
                    cell(&message.content, 200)
                ));
            }
            out.push('\n');
        }
    }

    // -- quota and budget --------------------------------------------------
    out.push_str("## Quota und Budget\n\n");
    if input.quota.is_empty() && input.budgets.is_empty() {
        out.push_str("Nichts bekannt.\n\n");
    } else {
        let ceilings: BTreeMap<&str, &BudgetLimits> = input
            .budgets
            .iter()
            .map(|limits| (limits.profile_id.as_str(), limits))
            .collect();
        out.push_str("| Profil | Zustand | Budget 5h | Budget 7d | Grund |\n");
        out.push_str("| --- | --- | --- | --- | --- |\n");
        let pct = |value: Option<u8>| value.map_or("-".to_string(), |p| format!("{p} %"));
        for row in &input.quota {
            let limits = ceilings.get(row.profile_id.as_str());
            let until = row
                .blocked_until
                .map(|until| format!(" (frei ab {} UTC)", hhmm(until)))
                .unwrap_or_default();
            let reason = match &row.reason {
                Some(reason) => format!("{}{until}", cell(reason, 100)),
                None => String::new(),
            };
            out.push_str(&format!(
                "| {} | {} | {} | {} | {reason} |\n",
                cell(&row.profile_id, 24),
                cell(&row.state, 12),
                pct(limits.and_then(|l| l.five_hour_pct)),
                pct(limits.and_then(|l| l.seven_day_pct)),
            ));
        }
        out.push('\n');
    }

    out
}

// -- collecting and writing -------------------------------------------------

/// Whether the digest is on. Absent means on, and only a literal `"0"` turns
/// it off - the same convention the learning switches use.
pub async fn enabled(store: &Store) -> bool {
    !matches!(store.get_setting(SETTING_ENABLED).await, Ok(Some(value)) if value == "0")
}

pub async fn set_enabled(store: &Store, enabled: bool) -> Result<(), String> {
    store
        .set_setting(SETTING_ENABLED, if enabled { "1" } else { "0" })
        .await
}

/// Gather one project's day.
pub async fn collect(
    store: &Store,
    engine: &StatusEngine,
    quota: &QuotaTracker,
    project: &Project,
    date: &str,
    now: i64,
) -> Result<DigestInput, String> {
    let from = day_start(date).ok_or_else(|| format!("not a date: {date}"))?;
    let until = from + DAY;

    let workers = store.list_workers(Some(&project.id)).await?;
    let labels: BTreeMap<String, String> = workers
        .iter()
        .map(|worker| (worker.id.clone(), cell(&worker.task, 60)))
        .collect();

    let board = engine
        .board(&workers)
        .into_iter()
        // An archived worker is off the board by definition; listing every one
        // of them would bury the day's actual cards under the whole history.
        .filter(|state| state.worker.status != STATUS_ARCHIVED)
        .map(|state| DigestBoardRow {
            worker_id: state.worker.id.clone(),
            column: state.column.clone(),
            task: state.worker.task.clone(),
            attention_reason: state.attention_reason.clone(),
        })
        .collect();

    let events = store.list_status_events(&project.id, from, until).await?;

    // The day is filtered in SQL, per worker: `list_messages` answers
    // newest-first-capped, and once later activity outnumbers the cap the
    // day's own rows fall outside it - the digest would lose the day it is
    // about to the days after it.
    let mut messages: Vec<Message> = Vec::new();
    for worker in &workers {
        messages.extend(store.list_messages_between(&worker.id, from, until).await?);
    }
    messages.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });

    let profile_ids: Vec<String> = crate::profiles::load_profiles()
        .into_iter()
        .map(|profile| profile.id)
        .collect();
    let quota = quota
        .snapshot(&profile_ids)
        .into_iter()
        .map(|row| DigestQuota {
            profile_id: row.profile_id,
            state: row.state,
            reason: row.reason,
            blocked_until: row.blocked_until,
        })
        .collect();

    Ok(DigestInput {
        project_name: project.name.clone(),
        project_id: project.id.clone(),
        date: date.to_string(),
        generated_at: now,
        board,
        events,
        messages,
        labels,
        quota,
        budgets: budget::list_limits(store).await?,
    })
}

/// Write one page atomically: a temporary file beside it, then a rename.
///
/// The rename is what lets the finished file double as the "already written"
/// marker - a half-written page can never exist under the final name, so its
/// presence always means a complete digest.
pub fn write_digest(repo_path: &str, date: &str, markdown: &str) -> Result<PathBuf, String> {
    let dir = digest_dir(repo_path);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create {}: {e}", dir.display()))?;
    let path = digest_path(repo_path, date);
    // The process id keeps two ProjectA instances on the same repository from
    // writing the same temporary file at the same moment.
    let tmp = dir.join(format!(".{date}.{}.tmp", std::process::id()));
    std::fs::write(&tmp, markdown)
        .map_err(|e| format!("failed to write {}: {e}", tmp.display()))?;
    match std::fs::rename(&tmp, &path) {
        Ok(()) => Ok(path),
        Err(err) => {
            let _ = std::fs::remove_file(&tmp);
            Err(format!("failed to place {}: {err}", path.display()))
        }
    }
}

/// The dates a project has digests for, newest first.
pub fn list_digests(repo_path: &str) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(digest_dir(repo_path)) else {
        return Vec::new();
    };
    let mut dates: Vec<String> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let date = name.strip_suffix(".md")?.to_string();
            is_valid_date(&date).then_some(date)
        })
        .collect();
    // Lexical order is chronological order for `YYYY-MM-DD`.
    dates.sort_unstable_by(|a, b| b.cmp(a));
    dates
}

/// One project's digest for one date, or `None` when there is none.
pub fn read_digest(repo_path: &str, date: &str) -> Option<String> {
    if !is_valid_date(date) {
        return None;
    }
    std::fs::read_to_string(digest_path(repo_path, date)).ok()
}

/// One sweep: write yesterday's page for every project that needs one.
///
/// Returns the projects it wrote for, which is what the thread logs and what a
/// test asserts on.
pub async fn write_due(
    store: &Store,
    engine: &StatusEngine,
    quota: &QuotaTracker,
    now: i64,
) -> Vec<String> {
    if !enabled(store).await {
        return Vec::new();
    }
    let date = due_date(now);
    let Ok(projects) = store.list_projects().await else {
        return Vec::new();
    };

    let mut written = Vec::new();
    for project in projects {
        let already = digest_path(&project.repo_path, &date).exists();
        let last_activity = last_activity(store, &project.id).await;
        if !is_due(now, last_activity, already) {
            continue;
        }
        let input = match collect(store, engine, quota, &project, &date, now).await {
            Ok(input) => input,
            Err(err) => {
                eprintln!("projecta: digest for {} failed: {err}", project.id);
                continue;
            }
        };
        match write_digest(&project.repo_path, &date, &render_digest(&input)) {
            Ok(path) => {
                println!("projecta: digest written to {}", path.display());
                written.push(project.id);
            }
            // A repository that is not on disk right now - an unplugged drive,
            // a renamed folder - costs this one page and nothing else.
            Err(err) => eprintln!("projecta: digest for {} not written: {err}", project.id),
        }
    }
    written
}

/// When this project last did anything the digest would have written about.
///
/// The activity feed is exactly that question already answered, over every
/// table at once, so it is what gets asked rather than a new query per table.
async fn last_activity(store: &Store, project_id: &str) -> Option<i64> {
    store
        .get_activity(Some(project_id), 1)
        .await
        .ok()?
        .first()
        .map(|entry| entry.created_at)
}

/// Start the hourly digest writer.
pub fn start(store: Store, engine: Arc<StatusEngine>, quota: Arc<QuotaTracker>) {
    thread::spawn(move || loop {
        let _ = tauri::async_runtime::block_on(write_due(&store, &engine, &quota, now_unix_secs()));
        thread::sleep(POLL_INTERVAL);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{new_id, WorkerRow, KIND_WORKER, SRC_BUDGET, STATUS_RUNNING};
    use crate::testutil::TempDir;

    fn input() -> DigestInput {
        DigestInput {
            project_name: "ProjectA".to_string(),
            project_id: "pj-1".to_string(),
            date: "2026-08-27".to_string(),
            generated_at: 1_787_875_200,
            board: vec![DigestBoardRow {
                worker_id: "wk-1".to_string(),
                column: "needs_you".to_string(),
                task: "make the tests pass".to_string(),
                attention_reason: Some("waiting for your approval".to_string()),
            }],
            events: vec![StatusEvent {
                id: "ev-1".to_string(),
                worker_id: "wk-1".to_string(),
                kind: "budget_paused".to_string(),
                detail: "Budget: 5-Stunden-Fenster bei 93 % (Limit 90 %)".to_string(),
                source: SRC_BUDGET.to_string(),
                created_at: day_start("2026-08-27").unwrap() + 9 * 3600 + 5 * 60,
            }],
            messages: vec![Message {
                id: "msg-1".to_string(),
                worker_id: "wk-1".to_string(),
                role: MSG_SYSTEM.to_string(),
                content: "Worker created with profile claude".to_string(),
                created_at: day_start("2026-08-27").unwrap() + 8 * 3600,
            }],
            labels: BTreeMap::from([("wk-1".to_string(), "make the tests pass".to_string())]),
            quota: vec![DigestQuota {
                profile_id: "claude".to_string(),
                state: "blocked".to_string(),
                reason: Some("Budget: 5-Stunden-Fenster bei 93 % (Limit 90 %)".to_string()),
                blocked_until: Some(day_start("2026-08-27").unwrap() + 14 * 3600),
            }],
            budgets: vec![BudgetLimits {
                profile_id: "claude".to_string(),
                five_hour_pct: Some(90),
                seven_day_pct: None,
            }],
        }
    }

    #[test]
    fn dates_round_trip_through_the_civil_calendar() {
        assert_eq!(utc_date(0), "1970-01-01");
        assert_eq!(utc_date(DAY - 1), "1970-01-01");
        assert_eq!(utc_date(DAY), "1970-01-02");
        assert_eq!(utc_date(1_787_875_200), utc_date(1_787_875_200));
        // A leap day exists; the day after February in a common year does not.
        assert!(is_valid_date("2024-02-29"));
        assert!(!is_valid_date("2026-02-29"));
        assert_eq!(utc_date(day_start("2024-02-29").unwrap()), "2024-02-29");
        assert_eq!(utc_date(day_start("2026-12-31").unwrap()), "2026-12-31");
        assert_eq!(utc_date(day_start("2000-01-01").unwrap()), "2000-01-01");

        for date in ["2026-08-27", "1999-12-31", "2100-03-01"] {
            assert_eq!(utc_date(day_start(date).unwrap()), date, "{date}");
        }
    }

    #[test]
    fn a_date_that_could_be_a_path_is_refused() {
        for bad in [
            "",
            "2026-8-27",
            "2026-08-2",
            "2026-08-277",
            "../../etc/passwd",
            "2026-08-27/..",
            "..\\..\\secret",
            "2026/08/27",
            "abcd-ef-gh",
            "2026-13-01",
            "2026-00-10",
            "2026-01-00",
            "2026-04-31",
        ] {
            assert!(!is_valid_date(bad), "{bad:?} was accepted");
        }
        assert!(is_valid_date("2026-08-27"));
    }

    #[test]
    fn a_huge_year_from_a_foreign_timestamp_is_refused_without_overflowing() {
        // `days_from_civil` computes `era * 146_097` before any bounds check.
        // A year this large (still a valid i64, so the parser accepts it) makes
        // `era` big enough that the multiplication wraps past `i64::MAX` and
        // panics - on the usage-poller thread, exactly like the chunk-length
        // overflow. `parse_rfc3339` feeds foreign router timestamps straight
        // into `day_start`, so this must return `None`, not panic.
        let result = std::panic::catch_unwind(|| day_start("25252734927766801-01-01"));
        assert!(
            result.is_ok(),
            "a huge but parseable year must not panic the usage poller"
        );
    }

    #[test]
    fn the_due_date_is_the_day_that_is_over() {
        let noon = day_start("2026-08-28").unwrap() + 12 * 3600;
        assert_eq!(due_date(noon), "2026-08-27");
        // Half past midnight still writes yesterday, not the half hour of today.
        assert_eq!(
            due_date(day_start("2026-08-28").unwrap() + 1800),
            "2026-08-27"
        );
    }

    #[test]
    fn a_page_is_written_once_and_only_for_a_project_that_did_something() {
        let now = day_start("2026-08-28").unwrap() + 3600;
        assert!(is_due(now, Some(now - 3600), false));
        // Already there: never twice.
        assert!(!is_due(now, Some(now - 3600), true));
        // Quiet for two days, and quiet the whole time.
        assert!(!is_due(now, Some(now - 2 * DAY), false));
        assert!(!is_due(now, None, false));
        // Just inside the window that overlaps a day, so an hourly tick cannot
        // fall through the gap.
        assert!(is_due(now, Some(now - ACTIVE_WITHIN), false));
        assert!(!is_due(now, Some(now - ACTIVE_WITHIN - 1), false));
    }

    #[test]
    fn a_rendered_page_carries_every_section_and_its_front_matter() {
        let page = render_digest(&input());

        assert!(page.starts_with("---\ndate: 2026-08-27\n"), "{page}");
        assert!(page.contains("project: \"ProjectA\"\n"), "{page}");
        assert!(page.contains("timezone: UTC\n"), "{page}");
        assert!(page.contains("# 2026-08-27 - ProjectA"), "{page}");
        assert!(page.contains("[[PLAYBOOK]]"), "{page}");
        assert!(page.contains("[[MEMORY]]"), "{page}");

        assert!(page.contains("- **needs_you** (1)"), "{page}");
        assert!(page.contains("waiting for your approval"), "{page}");

        // The budget stop of feature A arrives here as an event, at its time.
        assert!(page.contains("| 09:05 |"), "{page}");
        assert!(page.contains("budget_paused"), "{page}");
        assert!(
            page.contains("Budget: 5-Stunden-Fenster bei 93 %"),
            "{page}"
        );

        assert!(page.contains("### System-Notizen"), "{page}");
        assert!(page.contains("08:00"), "{page}");

        assert!(page.contains("| claude | blocked | 90 % | - |"), "{page}");
        assert!(page.contains("frei ab 14:00 UTC"), "{page}");
    }

    #[test]
    fn a_key_pasted_into_a_task_does_not_reach_the_vault() {
        let mut leaky = input();
        leaky.messages[0].content =
            "Task: deploy mit sk-ant-api03-AAAAAAAAAAAAAAAAAAAA und dann testen".to_string();
        leaky.board[0].task = "ghp_BBBBBBBBBBBBBBBBBBBB einbauen".to_string();
        leaky.events[0].detail = "key AKIACCCCCCCCCCCCCCCC benutzt".to_string();

        let page = render_digest(&leaky);
        assert!(!page.contains("sk-ant"), "{page}");
        assert!(!page.contains("ghp_"), "{page}");
        assert!(!page.contains("AKIACCCC"), "{page}");
        // The rest of the sentence survives - a redacted line is still a line.
        assert!(
            page.contains("Task: deploy mit [redacted] und dann testen"),
            "{page}"
        );
    }

    #[test]
    fn an_empty_day_still_renders_every_heading() {
        let mut empty = input();
        empty.board.clear();
        empty.events.clear();
        empty.messages.clear();
        empty.quota.clear();
        empty.budgets.clear();

        let page = render_digest(&empty);
        for heading in [
            "## Board bei Erstellung",
            "## Tagesverlauf",
            "## Worker-Aktivitaet",
            "## Quota und Budget",
        ] {
            assert!(page.contains(heading), "{heading} missing:\n{page}");
        }
        assert!(page.contains("Keine Worker."), "{page}");
        assert!(page.contains("Keine Ereignisse."), "{page}");
        assert!(page.contains("Keine Nachrichten."), "{page}");
        assert!(page.contains("Nichts bekannt."), "{page}");
    }

    #[test]
    fn a_pipe_in_a_detail_cannot_break_the_table() {
        let mut piped = input();
        piped.events[0].detail = "a | b\nc".to_string();
        let page = render_digest(&piped);
        assert!(page.contains("a \\| b c"), "{page}");
        // Every table row still has the same number of separators.
        for line in page.lines().filter(|line| line.starts_with("| 09:05")) {
            assert_eq!(line.matches(" | ").count(), 4, "{line}");
        }
    }

    #[test]
    fn writing_is_atomic_and_leaves_no_temporary_file_behind() {
        let dir = TempDir::new("digest-write");
        let repo = dir.path().to_string_lossy().into_owned();
        assert!(list_digests(&repo).is_empty());
        assert_eq!(read_digest(&repo, "2026-08-27"), None);

        let path = write_digest(&repo, "2026-08-27", "# hello\n").expect("write");
        assert!(path.ends_with("2026-08-27.md"));
        assert_eq!(
            read_digest(&repo, "2026-08-27").as_deref(),
            Some("# hello\n")
        );

        write_digest(&repo, "2026-08-26", "# older\n").expect("write");
        assert_eq!(list_digests(&repo), vec!["2026-08-27", "2026-08-26"]);

        // Nothing but the two pages: the temporary files are renamed, never left.
        let files: Vec<String> = std::fs::read_dir(digest_dir(&repo))
            .expect("read dir")
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(files.len(), 2, "{files:?}");

        // A file that is not a digest is not listed as one.
        std::fs::write(digest_dir(&repo).join("notes.md"), "x").expect("write");
        std::fs::write(digest_dir(&repo).join("2026-13-01.md"), "x").expect("write");
        assert_eq!(list_digests(&repo), vec!["2026-08-27", "2026-08-26"]);
        assert_eq!(read_digest(&repo, "../../etc/passwd"), None);
    }

    async fn fixture() -> (TempDir, Store, Project) {
        let dir = TempDir::new("digest");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let repo = dir.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let project = store
            .create_project("one", &repo.to_string_lossy())
            .await
            .unwrap();
        (dir, store, project)
    }

    #[tokio::test]
    async fn a_sweep_writes_one_page_per_active_project_and_never_twice() {
        let (_dir, store, project) = fixture().await;
        let engine = StatusEngine::default();
        let quota = QuotaTracker::default();
        let now = day_start("2026-08-28").unwrap() + 3600;
        let yesterday = day_start("2026-08-27").unwrap() + 9 * 3600;

        let worker_id = new_id("wk");
        store
            .insert_worker(&WorkerRow {
                id: worker_id.clone(),
                project_id: project.id.clone(),
                task: "make the tests pass".to_string(),
                profile_id: "claude".to_string(),
                branch: "pa/wk".to_string(),
                worktree_path: "C:/tmp/wk".to_string(),
                status: STATUS_RUNNING.to_string(),
                kind: KIND_WORKER.to_string(),
                pr_url: None,
                spawned_by: None,
                test_status: None,
                tested_at: None,
                role_variant_id: None,
                paused_reason: None,
                created_at: yesterday,
            })
            .await
            .unwrap();

        // A project whose newest row is old enough gets no page; the worker
        // above is `now`-fresh only because `insert_worker` keeps its own
        // timestamp, which is what the activity feed reads.
        let written = write_due(&store, &engine, &quota, now).await;
        assert_eq!(written, vec![project.id.clone()]);
        let page = read_digest(&project.repo_path, "2026-08-27").expect("page");
        assert!(page.contains("# 2026-08-27 - one"), "{page}");

        // A second sweep in the same hour writes nothing: the file is its own
        // marker.
        assert!(write_due(&store, &engine, &quota, now + 3600)
            .await
            .is_empty());

        // Switched off, nothing happens at all - even with the page gone and
        // the project as active as it was a moment ago.
        std::fs::remove_file(digest_path(&project.repo_path, "2026-08-27")).unwrap();
        set_enabled(&store, false).await.unwrap();
        assert!(write_due(&store, &engine, &quota, now).await.is_empty());
        assert_eq!(read_digest(&project.repo_path, "2026-08-27"), None);

        set_enabled(&store, true).await.unwrap();
        assert_eq!(
            write_due(&store, &engine, &quota, now).await,
            vec![project.id]
        );

        // A day nobody worked gets no page: the newest row in this project is
        // the worker from the 27th, which is more than a day before this tick.
        assert!(write_due(&store, &engine, &quota, now + 2 * DAY)
            .await
            .is_empty());
    }

    #[tokio::test]
    async fn a_day_of_messages_is_not_flushed_out_by_heavier_later_activity() {
        let (_dir, store, project) = fixture().await;
        let engine = StatusEngine::default();
        let quota = QuotaTracker::default();

        let worker_id = new_id("wk");
        store
            .insert_worker(&WorkerRow {
                id: worker_id.clone(),
                project_id: project.id.clone(),
                task: "make the tests pass".to_string(),
                profile_id: "claude".to_string(),
                branch: "pa/wk".to_string(),
                worktree_path: "C:/tmp/wk".to_string(),
                status: STATUS_RUNNING.to_string(),
                kind: KIND_WORKER.to_string(),
                pr_url: None,
                spawned_by: None,
                test_status: None,
                tested_at: None,
                role_variant_id: None,
                paused_reason: None,
                created_at: day_start("2026-08-27").unwrap(),
            })
            .await
            .unwrap();

        // The digest reads the store's own messages table, whose `created_at`
        // is normally stamped by `now_unix_secs`. To force the scenario we
        // write the rows directly with the timestamps the bug depends on.
        let db = _dir.path().join("projecta.db");
        let pool = sqlx::SqlitePool::connect(&format!("sqlite://{}", db.display()))
            .await
            .unwrap();

        let from = day_start("2026-08-27").unwrap();
        let until = from + DAY;

        // The digest's window: three messages from the day being summarised.
        for i in 0..3i64 {
            sqlx::query(
                "INSERT INTO messages (id, worker_id, role, content, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )
            .bind(format!("msg-y-{i}"))
            .bind(&worker_id)
            .bind(MSG_SYSTEM)
            .bind(format!("yesterday activity {i}"))
            .bind(from + i * 60)
            .execute(&pool)
            .await
            .unwrap();
        }
        // Later activity that fills the newest-MESSAGE_LIMIT (200) slots that
        // `list_messages` returns, so the day's own three fall outside it.
        for i in 0..205i64 {
            sqlx::query(
                "INSERT INTO messages (id, worker_id, role, content, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )
            .bind(format!("msg-t-{i}"))
            .bind(&worker_id)
            .bind(MSG_SYSTEM)
            .bind(format!("later activity {i}"))
            .bind(until + i * 60)
            .execute(&pool)
            .await
            .unwrap();
        }
        pool.close().await;

        let digest = collect(&store, &engine, &quota, &project, "2026-08-27", until)
            .await
            .unwrap();

        assert_eq!(
            digest.messages.len(),
            3,
            "the day's three messages must survive into the digest; \
             `list_messages` returned only the newest {} and dropped them",
            MESSAGE_LIMIT
        );
    }
}
