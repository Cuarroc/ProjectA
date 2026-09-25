//! Project statistics: what one project's rows actually add up to.
//!
//! Every number here is read out of tables the app already writes - workers,
//! `task_queue`, `status_events`, `messages`, `diff_comments`, `learnings`,
//! `sessions` and the OmniRoute ledger `usage_events`. Nothing is estimated
//! from terminal text, and nothing is invented: the one derived figure, the
//! completion estimate, ships its own arithmetic beside it so the screen can
//! show *how* it got there rather than a bare percentage.
//!
//! Three honesty rules run through the module and are worth stating once:
//!
//! * **A gap is a value.** [`token_usage`] answers `None` when the ledger has
//!   nothing for the window, and the tab prints "nicht gemessen". Zero tokens
//!   would be a lie - an agent that never went through OmniRoute burned
//!   tokens that this app has no way of counting.
//! * **A snapshot is not a window.** The board columns, the queue and the
//!   pending learnings are counted as they are *now*, whatever range is
//!   selected; messages, events, sessions and tokens are counted *within* the
//!   range. [`Overview::range_scoped`] says which is which, in one place, so
//!   the UI does not have to guess.
//! * **The estimate is an estimate.** [`completion_estimate`] returns its
//!   components and their weights, and `None` for a project there is nothing
//!   to estimate from. It never returns 100 % because a project is empty.
//!
//! One side effect to know about: [`crate::retention`] deletes `status_events`
//! and `usage_events` past their deadline and archives `messages` out of the
//! database. Historical windows therefore change *retroactively* - an
//! "All"-range total can only go down over time, and a day bar from six
//! months ago may shrink long after it was first shown.
//!
//! The aggregation functions are pure in the sense that matters for testing:
//! they take a store, a project id, a window and the current time, and they
//! read. No clock, no filesystem, no agent runs. [`crate::digest`] reads the
//! same tables for its daily page and this module borrows its calendar -
//! [`crate::digest::day_start`] and [`crate::digest::utc_date`] are the only
//! date arithmetic in the app, and a second copy of it here would be a second
//! chance to get leap years wrong.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::digest;
use crate::status::{
    StatusEngine, COLUMNS, COL_DONE, COL_IN_REVIEW, COL_NEEDS_YOU, COL_READY_TO_MERGE, COL_WORKING,
};
use crate::store::{
    DayCount, Store, UsageTotals, Worker, LEARNING_PENDING, QUEUE_DISPATCHED, QUEUE_FAILED,
    STATUS_ARCHIVED, TEST_PASS,
};

/// Seconds in a day, and the width of one bar on the activity timeline.
const DAY: i64 = 24 * 60 * 60;

/// The ledger table, named once so the "does it exist" check and the queries
/// cannot drift apart.
const USAGE_TABLE: &str = "usage_events";

// -- the window ------------------------------------------------------------

/// How far back a statistic looks.
///
/// Four fixed choices rather than a free date range: this is a dashboard, and
/// every one of them answers a question somebody actually asks ("was heute?",
/// "diese Woche?", "dieser Monat?", "überhaupt?").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StatsRange {
    /// Since 00:00 UTC of the current day. UTC, not local, because that is the
    /// boundary the daily digest already uses.
    Today,
    /// The last seven days, counted back from now rather than snapped to a
    /// week boundary: "die letzten sieben Tage" is the question.
    Week,
    /// The last thirty days.
    Month,
    /// Everything the database still holds.
    All,
}

impl StatsRange {
    /// The wire name, which is also what the API and the CLI accept.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Today => "today",
            Self::Week => "week",
            Self::Month => "month",
            Self::All => "all",
        }
    }

    /// Parse a wire name. `None` is not an error anywhere it is used - the
    /// callers fall back to [`StatsRange::All`] - but an unknown *given* name
    /// is, because silently widening a window the user asked to narrow would
    /// put wrong numbers on screen under a label that says otherwise.
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "today" => Some(Self::Today),
            "week" | "7d" => Some(Self::Week),
            "month" | "30d" => Some(Self::Month),
            "all" => Some(Self::All),
            _ => None,
        }
    }

    /// The first second that is inside the window, or `None` for [`Self::All`].
    ///
    /// `None` is passed straight through to the store, where it means "no
    /// lower bound" - not "since the epoch", which would quietly drop a row
    /// with a negative timestamp instead of counting it.
    pub fn since(self, now: i64) -> Option<i64> {
        match self {
            Self::Today => digest::day_start(&digest::utc_date(now)),
            Self::Week => Some(now - 7 * DAY),
            Self::Month => Some(now - 30 * DAY),
            Self::All => None,
        }
    }
}

// -- overview --------------------------------------------------------------

/// One label and its count, so the frontend can render a row without knowing
/// the vocabulary of columns, kinds or queue states.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelCount {
    pub key: String,
    pub count: i64,
}

/// The project as it stands, plus the few counts that do respect the window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    /// Every worker row the project has, archived ones included.
    pub workers_total: i64,
    /// Workers that are not archived - the ones still on the board.
    pub workers_active: i64,
    pub workers_archived: i64,
    /// Non-archived workers per board column, in board order. A column with
    /// nothing in it is present with `0`; a missing row would make the tile
    /// jump around as work moves.
    pub by_column: Vec<LabelCount>,
    /// Non-archived workers per kind: worker, orchestrator, scout, queen.
    pub by_kind: Vec<LabelCount>,
    /// Cards the board is asking the user about right now.
    pub needs_attention: i64,
    /// Queue entries per status, over every state the queue has.
    pub queue: Vec<LabelCount>,
    /// Queue entries in total, which is the denominator of the queue quota in
    /// [`completion_estimate`].
    pub queue_total: i64,
    pub learnings_pending: i64,
    /// Messages inside the window.
    pub messages: i64,
    /// Status events inside the window.
    pub status_events: i64,
    /// Review comments inside the window.
    pub diff_comments: i64,
    /// Workers created inside the window.
    pub workers_created: i64,
    /// Which of the fields above are counted over the window and which are a
    /// snapshot of right now. Sent to the frontend so the tooltip that says so
    /// cannot drift away from what the code does.
    pub range_scoped: Vec<String>,
}

/// Which [`Overview`] fields respect the selected window. Everything not named
/// here is "as of now" whatever range was asked for.
const RANGE_SCOPED: [&str; 4] = ["messages", "statusEvents", "diffComments", "workersCreated"];

/// The project's shape: who is where, what is queued, what is waiting.
///
/// The board columns come from [`StatusEngine::board`], the same call the
/// board view and the daily digest make, so a card that says `in_review` on
/// screen is counted as `in_review` here. Archived workers are off the board
/// by definition and are counted separately rather than dropped: "12 Worker,
/// davon 9 archiviert" is a different project from "3 Worker".
pub async fn project_overview(
    store: &Store,
    engine: &StatusEngine,
    project_id: &str,
    range: StatsRange,
    now: i64,
) -> Result<Overview, String> {
    let since = range.since(now);
    let workers = store.list_workers(Some(project_id)).await?;
    let live: Vec<Worker> = workers
        .iter()
        .filter(|worker| worker.status != STATUS_ARCHIVED)
        .cloned()
        .collect();

    let board = engine.board(&live);
    let mut columns: BTreeMap<&str, i64> = COLUMNS.iter().map(|name| (*name, 0)).collect();
    let mut needs_attention = 0;
    for state in &board {
        *columns.entry(column_key(&state.column)).or_insert(0) += 1;
        if state.attention_reason.is_some() {
            needs_attention += 1;
        }
    }

    let mut kinds: BTreeMap<String, i64> = BTreeMap::new();
    for worker in &live {
        *kinds.entry(worker.kind.clone()).or_insert(0) += 1;
    }

    let queue = store.list_queue(Some(project_id)).await?;
    let mut queue_counts: BTreeMap<String, i64> = BTreeMap::new();
    for entry in &queue {
        *queue_counts.entry(entry.status.clone()).or_insert(0) += 1;
    }

    let learnings = store
        .list_learnings(Some(project_id), Some(LEARNING_PENDING))
        .await?;

    let messages = sum_days(&store.count_messages_per_day(project_id, since).await?);
    let status_events = sum_days(&store.count_status_events_per_day(project_id, since).await?);

    Ok(Overview {
        workers_total: workers.len() as i64,
        workers_active: live.len() as i64,
        workers_archived: (workers.len() - live.len()) as i64,
        // In board order, not alphabetically: this list is rendered as the
        // board is read, left to right.
        by_column: COLUMNS
            .iter()
            .map(|name| LabelCount {
                key: (*name).to_string(),
                count: columns.get(name).copied().unwrap_or(0),
            })
            .collect(),
        by_kind: kinds
            .into_iter()
            .map(|(key, count)| LabelCount { key, count })
            .collect(),
        needs_attention,
        queue: queue_counts
            .into_iter()
            .map(|(key, count)| LabelCount { key, count })
            .collect(),
        queue_total: queue.len() as i64,
        learnings_pending: learnings.len() as i64,
        messages,
        status_events,
        diff_comments: store.count_diff_comments(project_id, since).await?,
        workers_created: workers
            .iter()
            .filter(|worker| since.is_none_or(|from| worker.created_at >= from))
            .count() as i64,
        range_scoped: RANGE_SCOPED
            .iter()
            .map(|name| (*name).to_string())
            .collect(),
    })
}

/// A column name as one of the five the board knows.
///
/// The engine's own verdicts are always one of them; this only matters for a
/// column that arrived from somewhere else, and the answer there is to count
/// it as `working` rather than to invent a sixth bar.
fn column_key(column: &str) -> &'static str {
    COLUMNS
        .iter()
        .copied()
        .find(|name| *name == column)
        .unwrap_or(COL_WORKING)
}

fn sum_days(days: &[DayCount]) -> i64 {
    days.iter().map(|day| day.count).sum()
}

// -- tokens ----------------------------------------------------------------

/// What one profile cost inside the window.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileTokens {
    /// `None` is the ledger's own "could not attribute", and it is the common
    /// case - see [`TokenUsage`].
    pub profile_id: Option<String>,
    pub requests: i64,
    pub tokens_in: i64,
    pub tokens_out: i64,
    /// Whether one of this project's workers ever ran under this profile.
    /// The only link between the fleet-wide ledger and a single project there
    /// is, and it is a weak one: two projects using `claude` share every row.
    pub used_by_project: bool,
}

/// The OmniRoute ledger over one window.
///
/// **This is not per project and cannot be.** OmniRoute's request log is keyed
/// by provider account; it carries a model and a provider and, where a profile
/// pins a model, a profile id - but no session, no client and therefore no
/// worker. The totals here are the whole fleet's, `by_profile` splits them as
/// far as they can honestly be split, and `used_by_project` marks the profiles
/// this project's workers actually ran under. Multiplying that out into a
/// per-project number would be arithmetic on an assumption, so it is not done.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub requests: i64,
    pub tokens_in: i64,
    pub tokens_out: i64,
    /// Summed over the rows that carried a price at all; `priced` says how
    /// many those were. OmniRoute's per-request log usually prices none.
    pub cost_usd: f64,
    pub priced: i64,
    pub by_profile: Vec<ProfileTokens>,
    /// The profiles this project's workers were spawned with, whether or not
    /// the ledger has a row for them.
    pub project_profiles: Vec<String>,
}

/// The ledger for this window, or `None` when there is nothing measured.
///
/// `None` covers two situations that look the same from the outside and should
/// read the same on screen: the `usage_events` table is not in the schema at
/// all (a database from before the OmniRoute ledger shipped), or it is there
/// and holds no row inside the window. Both mean "niemand hat das gemessen",
/// and both must produce that sentence rather than a row of zeroes - an agent
/// that talks to its vendor directly spends real tokens that never reach this
/// table, so `0` would be the one number that is certainly wrong.
///
/// A missing table is not an error. Failing here would take the whole
/// statistics tab down over an optional ledger.
pub async fn token_usage(
    store: &Store,
    project_id: &str,
    range: StatsRange,
    now: i64,
) -> Result<Option<TokenUsage>, String> {
    if !store.table_exists(USAGE_TABLE).await? {
        return Ok(None);
    }
    let since = range.since(now);
    let totals: UsageTotals = store.usage_totals(since).await?;
    if totals.requests == 0 {
        return Ok(None);
    }

    let workers = store.list_workers(Some(project_id)).await?;
    let mut project_profiles: Vec<String> = workers
        .iter()
        .map(|worker| worker.profile_id.clone())
        .collect();
    project_profiles.sort();
    project_profiles.dedup();

    let by_profile = store
        .usage_totals_by_profile(since)
        .await?
        .into_iter()
        .map(|row| ProfileTokens {
            used_by_project: row
                .profile_id
                .as_ref()
                .is_some_and(|id| project_profiles.contains(id)),
            profile_id: row.profile_id,
            requests: row.requests,
            tokens_in: row.tokens_in,
            tokens_out: row.tokens_out,
        })
        .collect();

    Ok(Some(TokenUsage {
        requests: totals.requests,
        tokens_in: totals.tokens_in,
        tokens_out: totals.tokens_out,
        cost_usd: totals.cost_usd,
        priced: totals.priced,
        by_profile,
        project_profiles,
    }))
}

// -- sessions --------------------------------------------------------------

/// One session as the statistics table lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub session_id: String,
    pub worker_id: String,
    /// The worker's task, so the table can name a row without a second lookup.
    /// Empty for a session whose worker row is gone.
    pub task: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    /// Seconds between start and end, or `None` while the session is open.
    /// Never filled in from `now` for a running session: that would be a
    /// number that changes every time the page polls.
    pub duration: Option<i64>,
    pub exit_code: Option<i64>,
}

/// How this project's agent sessions went.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStats {
    pub total: i64,
    /// Sessions with no end recorded. Either still attached, or ended in a way
    /// the app never saw - a crash, a kill, a machine that went away.
    pub open: i64,
    pub ended: i64,
    /// Summed duration of the ended sessions, in seconds.
    pub total_seconds: i64,
    /// Median duration of the ended sessions. The median rather than the mean
    /// because one forgotten orchestrator that ran for three days would put
    /// the average somewhere no session ever was.
    pub median_seconds: Option<i64>,
    /// Ended sessions whose child reported a non-zero code.
    pub failed: i64,
    /// Ended sessions with no code at all - the platform did not say.
    pub unknown_exit: i64,
    /// `failed / ended`, or `None` when nothing has ended yet.
    pub failure_ratio: Option<f64>,
    /// The newest sessions first, capped at [`SESSION_ROWS`].
    pub recent: Vec<SessionRow>,
}

/// How many session rows travel to the frontend. The rest stay in the table;
/// the aggregates above are computed over all of them either way.
pub const SESSION_ROWS: usize = 25;

/// Count, duration and exits of one project's sessions in the window.
pub async fn session_stats(
    store: &Store,
    project_id: &str,
    range: StatsRange,
    now: i64,
) -> Result<SessionStats, String> {
    let sessions = store.list_sessions(project_id, range.since(now)).await?;
    let tasks: BTreeMap<String, String> = store
        .list_workers(Some(project_id))
        .await?
        .into_iter()
        .map(|worker| (worker.id, worker.task))
        .collect();

    let mut durations: Vec<i64> = Vec::new();
    let mut failed = 0;
    let mut unknown_exit = 0;
    let mut open = 0;
    for session in &sessions {
        match session.ended_at {
            None => open += 1,
            Some(ended) => {
                // A clock that went backwards between start and end would
                // otherwise contribute a negative duration to the sum.
                durations.push((ended - session.started_at).max(0));
                match session.exit_code {
                    None => unknown_exit += 1,
                    Some(0) => {}
                    Some(_) => failed += 1,
                }
            }
        }
    }
    durations.sort_unstable();
    let ended = durations.len() as i64;

    let mut recent: Vec<SessionRow> = sessions
        .iter()
        .rev()
        .take(SESSION_ROWS)
        .map(|session| SessionRow {
            session_id: session.id.clone(),
            worker_id: session.worker_id.clone(),
            task: tasks.get(&session.worker_id).cloned().unwrap_or_default(),
            started_at: session.started_at,
            ended_at: session.ended_at,
            duration: session
                .ended_at
                .map(|ended| (ended - session.started_at).max(0)),
            exit_code: session.exit_code,
        })
        .collect();
    recent.sort_by(|a, b| {
        b.started_at
            .cmp(&a.started_at)
            .then_with(|| b.session_id.cmp(&a.session_id))
    });

    Ok(SessionStats {
        total: sessions.len() as i64,
        open,
        ended,
        total_seconds: durations.iter().sum(),
        median_seconds: median(&durations),
        failed,
        unknown_exit,
        failure_ratio: (ended > 0).then(|| failed as f64 / ended as f64),
        recent,
    })
}

/// The middle value of a sorted slice; the lower of the two middles for an
/// even count, so the answer is always a duration that was really measured.
fn median(sorted: &[i64]) -> Option<i64> {
    if sorted.is_empty() {
        return None;
    }
    Some(sorted[(sorted.len() - 1) / 2])
}

// -- activity timeline -----------------------------------------------------

/// One day of the timeline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityDay {
    /// `YYYY-MM-DD` in UTC, the same date format the daily digest files use.
    pub date: String,
    /// Midnight UTC of that day, for a frontend that would rather format it
    /// itself than parse the string back.
    pub day: i64,
    pub messages: i64,
    pub status_events: i64,
}

/// Messages and status events per day, oldest day first.
///
/// Every day between the first and the last is present, including the quiet
/// ones: a bar chart that skips empty days shows a week of constant work where
/// there were two busy days and five of nothing. For [`StatsRange::All`] the
/// series starts at the first day that has anything, so a project whose first
/// worker is from last year does not produce four hundred empty bars.
pub async fn activity_timeline(
    store: &Store,
    project_id: &str,
    range: StatsRange,
    now: i64,
) -> Result<Vec<ActivityDay>, String> {
    let since = range.since(now);
    let messages = store.count_messages_per_day(project_id, since).await?;
    let events = store.count_status_events_per_day(project_id, since).await?;

    let mut per_day: BTreeMap<i64, (i64, i64)> = BTreeMap::new();
    for row in &messages {
        per_day.entry(row.day).or_insert((0, 0)).0 += row.count;
    }
    for row in &events {
        per_day.entry(row.day).or_insert((0, 0)).1 += row.count;
    }

    let today = day_of(now);
    let Some(first) = per_day.keys().copied().next() else {
        // Nothing at all in the window. One bar for today, at zero, rather
        // than an empty list: "keine Aktivität" is a shape the chart can draw.
        return Ok(vec![ActivityDay {
            date: digest::utc_date(today),
            day: today,
            messages: 0,
            status_events: 0,
        }]);
    };
    // The window's own start, when it has one, so a chosen range keeps its
    // width even if its first days were quiet.
    let start = since.map_or(first, |from| day_of(from).min(first));

    let mut out = Vec::new();
    let mut day = start;
    while day <= today.max(*per_day.keys().next_back().unwrap_or(&today)) {
        let (messages, status_events) = per_day.get(&day).copied().unwrap_or((0, 0));
        out.push(ActivityDay {
            date: digest::utc_date(day),
            day,
            messages,
            status_events,
        });
        day += DAY;
    }
    Ok(out)
}

/// Midnight UTC of the day a timestamp falls in.
fn day_of(unix: i64) -> i64 {
    unix.div_euclid(DAY) * DAY
}

// -- completion estimate ---------------------------------------------------

/// How much of a project one worker in a given column stands for.
///
/// **This matrix is the estimate.** It is a judgement, written down once so it
/// can be argued with, and it is shipped to the UI so a reader can see the
/// number's source instead of trusting it:
///
/// | Spalte | Gewicht | Warum |
/// |---|---|---|
/// | `done` | 1.0 | Archiviert oder gemerged - die Arbeit ist vom Board. |
/// | `ready_to_merge` | 0.8 | Fertig und grün; es fehlt eine menschliche Entscheidung. |
/// | `in_review` | 0.6 | Ein Pull Request steht; Review und Nacharbeit fehlen. |
/// | `working` | 0.3 | Läuft. Wie weit, weiß niemand - deshalb bewusst niedrig. |
/// | `needs_you` | 0.2 | Blockiert. Angefangen, aber ohne den Menschen geht es nicht weiter. |
///
/// `needs_you` sits *below* `working` on purpose: a blocked card is not
/// further along than a running one, it is a running one that stopped.
pub const COLUMN_WEIGHTS: [(&str, f64); 5] = [
    (COL_DONE, 1.0),
    (COL_READY_TO_MERGE, 0.8),
    (COL_IN_REVIEW, 0.6),
    (COL_WORKING, 0.3),
    (COL_NEEDS_YOU, 0.2),
];

/// What an archived worker contributes. Archiving is what ProjectA does when a
/// card is merged or cleaned up, so the work is off the board either way.
const ARCHIVED_WEIGHT: f64 = 1.0;

/// How the three components are blended, before renormalisation.
///
/// The workers dominate because they are the work. The queue is a third of
/// their weight - it says what is still waiting, which matters, but a long
/// queue is a plan, not progress. The test gates are the smallest: they are a
/// quality signal on work that is already counted elsewhere, and only some
/// projects have a test command at all.
const WEIGHT_WORKERS: f64 = 0.6;
const WEIGHT_QUEUE: f64 = 0.3;
const WEIGHT_TESTS: f64 = 0.1;

/// One term of the estimate, with everything needed to explain it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionComponent {
    /// `workers`, `queue` or `tests`.
    pub key: String,
    /// Its share of the blend *after* renormalisation, so the shares of the
    /// components that had data always add up to 1.
    pub weight: f64,
    /// Between 0 and 1.
    pub score: f64,
    /// The arithmetic in words, for the tooltip: "7,4 von 11 Workern".
    pub detail: String,
}

/// One worker's contribution, so the breakdown can be read card by card.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerContribution {
    pub worker_id: String,
    pub task: String,
    /// The board column, or `archived` for a worker that is off the board.
    pub column: String,
    pub weight: f64,
}

/// A derived percentage and the whole of its arithmetic.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionEstimate {
    /// 0 to 100, or `None` for a project with no workers and no queue - there
    /// is nothing to estimate from, and 0 % would read as "nichts geschafft"
    /// rather than "nichts angefangen".
    pub percent: Option<f64>,
    pub components: Vec<CompletionComponent>,
    pub workers: Vec<WorkerContribution>,
    /// The matrix above, sent along so the tooltip shows the weights the core
    /// really used rather than a copy that may have drifted.
    pub column_weights: Vec<(String, f64)>,
}

/// A weighted guess at how far along a project is, with its own workings.
///
/// Not a window: "wie weit ist das Projekt" is a question about now, and a
/// seven-day filter would answer "wie weit war es letzte Woche schon" instead.
///
/// Three components, each `None` when the project has no data for it, blended
/// over the ones that remain:
///
/// * **Workers** - every worker weighted by [`COLUMN_WEIGHTS`], divided by the
///   number of workers.
/// * **Queue** - dispatched entries over all entries. A `failed` entry counts
///   in the denominator and not in the numerator: it was asked for and did not
///   happen.
/// * **Tests** - workers whose gate is green, over the workers that have a
///   verdict at all. Workers that were never gated are outside both.
///
/// The word for the result is "geschätzt". It is never "fertig zu X %".
pub async fn completion_estimate(
    store: &Store,
    engine: &StatusEngine,
    project_id: &str,
) -> Result<CompletionEstimate, String> {
    let workers = store.list_workers(Some(project_id)).await?;
    let live: Vec<Worker> = workers
        .iter()
        .filter(|worker| worker.status != STATUS_ARCHIVED)
        .cloned()
        .collect();
    let board = engine.board(&live);
    let columns: BTreeMap<&str, &str> = board
        .iter()
        .map(|state| (state.worker.id.as_str(), column_key(&state.column)))
        .collect();

    let contributions: Vec<WorkerContribution> = workers
        .iter()
        .map(|worker| match columns.get(worker.id.as_str()) {
            Some(column) => WorkerContribution {
                worker_id: worker.id.clone(),
                task: worker.task.clone(),
                column: (*column).to_string(),
                weight: column_weight(column),
            },
            None => WorkerContribution {
                worker_id: worker.id.clone(),
                task: worker.task.clone(),
                column: STATUS_ARCHIVED.to_string(),
                weight: ARCHIVED_WEIGHT,
            },
        })
        .collect();

    let mut components: Vec<(f64, CompletionComponent)> = Vec::new();
    if !contributions.is_empty() {
        let earned: f64 = contributions.iter().map(|row| row.weight).sum();
        let total = contributions.len() as f64;
        components.push((
            WEIGHT_WORKERS,
            CompletionComponent {
                key: "workers".to_string(),
                weight: WEIGHT_WORKERS,
                score: earned / total,
                detail: format!("{earned:.1} von {total:.0} Workern (Spalten-Gewichte)"),
            },
        ));
    }

    let queue = store.list_queue(Some(project_id)).await?;
    if !queue.is_empty() {
        let dispatched = queue
            .iter()
            .filter(|entry| entry.status == QUEUE_DISPATCHED)
            .count();
        let failed = queue
            .iter()
            .filter(|entry| entry.status == QUEUE_FAILED)
            .count();
        components.push((
            WEIGHT_QUEUE,
            CompletionComponent {
                key: "queue".to_string(),
                weight: WEIGHT_QUEUE,
                score: dispatched as f64 / queue.len() as f64,
                detail: format!(
                    "{dispatched} von {} Queue-Einträgen dispatched ({failed} fehlgeschlagen)",
                    queue.len()
                ),
            },
        ));
    }

    let gated: Vec<&Worker> = workers
        .iter()
        .filter(|worker| worker.test_status.is_some())
        .collect();
    if !gated.is_empty() {
        let green = gated
            .iter()
            .filter(|worker| worker.test_status.as_deref() == Some(TEST_PASS))
            .count();
        components.push((
            WEIGHT_TESTS,
            CompletionComponent {
                key: "tests".to_string(),
                weight: WEIGHT_TESTS,
                score: green as f64 / gated.len() as f64,
                detail: format!("{green} von {} Test-Gates grün", gated.len()),
            },
        ));
    }

    // Renormalise over the components that exist, so a project without a queue
    // is not capped at 70 % for not having one.
    let weight_sum: f64 = components.iter().map(|(weight, _)| weight).sum();
    let percent = (weight_sum > 0.0).then(|| {
        let blended: f64 = components
            .iter()
            .map(|(weight, part)| weight * part.score)
            .sum();
        (blended / weight_sum * 100.0).clamp(0.0, 100.0)
    });

    Ok(CompletionEstimate {
        percent,
        components: components
            .into_iter()
            .map(|(weight, mut part)| {
                part.weight = weight / weight_sum;
                part
            })
            .collect(),
        workers: contributions,
        column_weights: COLUMN_WEIGHTS
            .iter()
            .map(|(name, weight)| ((*name).to_string(), *weight))
            .collect(),
    })
}

/// The matrix, looked up. An unknown column contributes nothing rather than
/// guessing a weight for it.
fn column_weight(column: &str) -> f64 {
    COLUMN_WEIGHTS
        .iter()
        .find(|(name, _)| *name == column)
        .map_or(0.0, |(_, weight)| *weight)
}

// -- the whole tab ---------------------------------------------------------

/// Everything the statistics tab shows, in one document.
///
/// One command, one HTTP call, one CLI invocation: the sections are read
/// together and polled together, and five round trips for one screen would
/// only give the tiles five different clocks.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    pub project_id: String,
    pub project_name: String,
    /// The window, as [`StatsRange::as_str`] names it.
    pub range: String,
    /// The window's first second, or `null` for `all`.
    pub since: Option<i64>,
    /// When this document was assembled.
    pub generated_at: i64,
    pub overview: Overview,
    /// `None` means "nicht gemessen" - see [`token_usage`].
    pub tokens: Option<TokenUsage>,
    pub sessions: SessionStats,
    pub timeline: Vec<ActivityDay>,
    pub completion: CompletionEstimate,
}

/// Assemble one project's statistics.
pub async fn project_stats(
    store: &Store,
    engine: &StatusEngine,
    project_id: &str,
    range: StatsRange,
    now: i64,
) -> Result<ProjectStats, String> {
    let project = store
        .get_project(project_id)
        .await?
        .ok_or_else(|| format!("{}project: {project_id}", crate::workers::ERR_UNKNOWN))?;
    Ok(ProjectStats {
        project_id: project.id.clone(),
        project_name: project.name,
        range: range.as_str().to_string(),
        since: range.since(now),
        generated_at: now,
        overview: project_overview(store, engine, project_id, range, now).await?,
        tokens: token_usage(store, project_id, range, now).await?,
        sessions: session_stats(store, project_id, range, now).await?,
        timeline: activity_timeline(store, project_id, range, now).await?,
        completion: completion_estimate(store, engine, project_id).await?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::status::IDLE_AFTER;
    use crate::store::{
        new_id, Learning, Project, QueueEntry, UsageEvent, WorkerRow, MSG_USER, QUEUE_QUEUED,
        STATUS_RUNNING, TEST_FAIL,
    };
    use crate::testutil::TempDir;

    /// A fixed "now" so every window in these tests is a known set of days.
    /// 2026-08-27 12:00:00 UTC.
    const NOW: i64 = 1_787_745_600;

    async fn fixture() -> (TempDir, Store, StatusEngine, Project) {
        let dir = TempDir::new("stats");
        let store = Store::open(&dir.path().join("projecta.db"))
            .await
            .expect("open store");
        let project = store
            .create_project("one", dir.path().to_string_lossy().as_ref())
            .await
            .expect("create project");
        let engine = StatusEngine::new(IDLE_AFTER);
        (dir, store, engine, project)
    }

    fn worker_row(project_id: &str, id: &str) -> WorkerRow {
        WorkerRow {
            id: id.to_string(),
            project_id: project_id.to_string(),
            task: format!("task for {id}"),
            profile_id: "claude".to_string(),
            branch: format!("pa/{id}"),
            worktree_path: format!("/tmp/{id}"),
            status: STATUS_RUNNING.to_string(),
            kind: "worker".to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            role_variant_id: None,
            paused_reason: None,
            created_at: NOW - 3600,
        }
    }

    async fn add_worker(store: &Store, project_id: &str, id: &str) -> WorkerRow {
        let row = worker_row(project_id, id);
        store.insert_worker(&row).await.expect("insert worker");
        row
    }

    // -- the window --------------------------------------------------------

    #[test]
    fn a_range_round_trips_through_its_wire_name() {
        for range in [
            StatsRange::Today,
            StatsRange::Week,
            StatsRange::Month,
            StatsRange::All,
        ] {
            assert_eq!(StatsRange::parse(range.as_str()), Some(range));
        }
        assert_eq!(StatsRange::parse("7d"), Some(StatsRange::Week));
        assert_eq!(StatsRange::parse("30d"), Some(StatsRange::Month));
        assert_eq!(StatsRange::parse("gestern"), None);
    }

    #[test]
    fn today_starts_at_midnight_utc_and_all_has_no_floor() {
        assert_eq!(StatsRange::Today.since(NOW), Some(NOW - 12 * 3600));
        assert_eq!(StatsRange::Week.since(NOW), Some(NOW - 7 * DAY));
        assert_eq!(StatsRange::Month.since(NOW), Some(NOW - 30 * DAY));
        assert_eq!(StatsRange::All.since(NOW), None);
    }

    // -- overview ----------------------------------------------------------

    #[tokio::test]
    async fn the_overview_counts_columns_kinds_queue_and_the_archive() {
        let (_dir, store, engine, project) = fixture().await;
        add_worker(&store, &project.id, "wk-1").await;
        add_worker(&store, &project.id, "wk-2").await;
        let mut archived = worker_row(&project.id, "wk-3");
        archived.status = STATUS_ARCHIVED.to_string();
        store.insert_worker(&archived).await.unwrap();
        let mut scout = worker_row(&project.id, "wk-4");
        scout.kind = "scout".to_string();
        store.insert_worker(&scout).await.unwrap();

        store
            .insert_queue_entry(&QueueEntry {
                id: new_id("tq"),
                project_id: project.id.clone(),
                raw_text: "later".to_string(),
                sharpened_text: None,
                profile_id: "claude".to_string(),
                status: QUEUE_QUEUED.to_string(),
                priority: 0,
                worker_id: None,
                error: None,
                spawned_by: None,
                created_at: NOW - 600,
            })
            .await
            .unwrap();
        store
            .insert_learning(&Learning {
                id: new_id("lr"),
                project_id: project.id.clone(),
                worker_id: "wk-1".to_string(),
                profile_id: "claude".to_string(),
                pattern_label: None,
                content: "always read the plan".to_string(),
                status: LEARNING_PENDING.to_string(),
                created_at: NOW - 600,
            })
            .await
            .unwrap();

        let overview = project_overview(&store, &engine, &project.id, StatsRange::All, NOW)
            .await
            .expect("overview");

        assert_eq!(overview.workers_total, 4);
        assert_eq!(overview.workers_active, 3);
        assert_eq!(overview.workers_archived, 1);
        // Every column is present, even the empty ones, and in board order.
        assert_eq!(
            overview
                .by_column
                .iter()
                .map(|row| row.key.as_str())
                .collect::<Vec<_>>(),
            COLUMNS.to_vec()
        );
        assert_eq!(
            overview.by_column.iter().map(|row| row.count).sum::<i64>(),
            3
        );
        assert_eq!(
            overview
                .by_kind
                .iter()
                .find(|row| row.key == "scout")
                .map(|row| row.count),
            Some(1)
        );
        assert_eq!(overview.queue_total, 1);
        assert_eq!(overview.learnings_pending, 1);
        assert_eq!(overview.queue[0].key, QUEUE_QUEUED);
    }

    #[tokio::test]
    async fn the_window_moves_the_counted_rows_and_not_the_snapshot() {
        let (_dir, store, engine, project) = fixture().await;
        add_worker(&store, &project.id, "wk-1").await;
        // One message today, one five days ago.
        for (id, at) in [("ms-now", NOW - 60), ("ms-old", NOW - 5 * DAY)] {
            store
                .insert_message_at("wk-1", id, MSG_USER, at)
                .await
                .unwrap();
        }

        let today = project_overview(&store, &engine, &project.id, StatsRange::Today, NOW)
            .await
            .unwrap();
        let week = project_overview(&store, &engine, &project.id, StatsRange::Week, NOW)
            .await
            .unwrap();

        assert_eq!(today.messages, 1);
        assert_eq!(week.messages, 2);
        // The worker itself is a snapshot: both windows see it.
        assert_eq!(today.workers_active, week.workers_active);
        assert!(today.range_scoped.contains(&"messages".to_string()));
        assert!(!today.range_scoped.contains(&"workersActive".to_string()));
    }

    // -- tokens ------------------------------------------------------------

    #[tokio::test]
    async fn an_empty_ledger_is_not_measured_rather_than_zero() {
        let (_dir, store, _engine, project) = fixture().await;
        add_worker(&store, &project.id, "wk-1").await;
        assert_eq!(
            token_usage(&store, &project.id, StatsRange::All, NOW)
                .await
                .expect("no error for an empty ledger"),
            None
        );
    }

    #[tokio::test]
    async fn a_database_without_the_ledger_table_is_not_an_error() {
        let (_dir, store, _engine, project) = fixture().await;
        add_worker(&store, &project.id, "wk-1").await;
        store.drop_table(USAGE_TABLE).await.unwrap();
        assert!(!store.table_exists(USAGE_TABLE).await.unwrap());
        assert_eq!(
            token_usage(&store, &project.id, StatsRange::All, NOW)
                .await
                .expect("a missing table is not an error"),
            None
        );
    }

    #[tokio::test]
    async fn the_ledger_totals_the_window_and_marks_this_project_s_profiles() {
        let (_dir, store, _engine, project) = fixture().await;
        add_worker(&store, &project.id, "wk-1").await;
        for (id, ts, profile, tokens) in [
            ("ue-1", NOW - 60, Some("claude"), 100),
            ("ue-2", NOW - 5 * DAY, Some("claude"), 200),
            ("ue-3", NOW - 60, Some("codex"), 400),
            ("ue-4", NOW - 60, None, 800),
        ] {
            store
                .insert_usage_event(&UsageEvent {
                    id: id.to_string(),
                    ts,
                    profile_id: profile.map(str::to_string),
                    model: "sonnet".to_string(),
                    provider: "anthropic".to_string(),
                    tokens_in: tokens,
                    tokens_out: 1,
                    cost_usd: None,
                    raw_json: "{}".to_string(),
                })
                .await
                .unwrap();
        }

        let today = token_usage(&store, &project.id, StatsRange::Today, NOW)
            .await
            .unwrap()
            .expect("rows today");
        assert_eq!(today.requests, 3);
        assert_eq!(today.tokens_in, 100 + 400 + 800);
        // Nothing was priced, so the dollars stay at zero *and* say so.
        assert_eq!(today.priced, 0);

        let all = token_usage(&store, &project.id, StatsRange::All, NOW)
            .await
            .unwrap()
            .expect("rows overall");
        assert_eq!(all.requests, 4);
        assert_eq!(all.project_profiles, vec!["claude".to_string()]);
        let claude = all
            .by_profile
            .iter()
            .find(|row| row.profile_id.as_deref() == Some("claude"))
            .expect("claude group");
        assert!(claude.used_by_project);
        assert_eq!(claude.requests, 2);
        let codex = all
            .by_profile
            .iter()
            .find(|row| row.profile_id.as_deref() == Some("codex"))
            .expect("codex group");
        assert!(
            !codex.used_by_project,
            "no worker of this project ran codex"
        );
        // The rows the ledger could not attribute are their own group, not
        // silently folded into somebody's total.
        assert!(all
            .by_profile
            .iter()
            .any(|row| row.profile_id.is_none() && row.requests == 1));
    }

    // -- sessions ----------------------------------------------------------

    #[tokio::test]
    async fn sessions_survive_the_database_being_closed_and_reopened() {
        let dir = TempDir::new("stats-restart");
        let path = dir.path().join("projecta.db");
        let project_id;
        {
            let store = Store::open(&path).await.unwrap();
            let project = store.create_project("one", "/tmp/one").await.unwrap();
            project_id = project.id.clone();
            add_worker(&store, &project.id, "wk-1").await;
            store.bind_session("wk-1", "pty-1").await;
            store.mark_session_exited("pty-1", Some(0)).await.unwrap();
            store.bind_session("wk-1", "pty-2").await;
        }
        // A second `open` on the same file is what an app restart looks like:
        // the in-memory map is gone, the rows are not.
        let store = Store::open(&path).await.unwrap();
        assert_eq!(store.session_for_worker("wk-1"), None);
        let stats = session_stats(&store, &project_id, StatsRange::All, NOW)
            .await
            .unwrap();
        assert_eq!(stats.total, 2);
        assert_eq!(stats.ended, 1);
        assert_eq!(stats.open, 1, "the session nobody closed is still open");
    }

    #[tokio::test]
    async fn session_durations_are_summed_and_the_median_is_a_real_one() {
        let (_dir, store, _engine, project) = fixture().await;
        add_worker(&store, &project.id, "wk-1").await;
        // Written straight to the table: `bind_session` stamps the wall clock,
        // and these durations have to be exact to assert on.
        for (id, start, end, code) in [
            ("s-1", NOW - 900, Some(NOW - 800), Some(0)),
            ("s-2", NOW - 700, Some(NOW - 400), Some(1)),
            ("s-3", NOW - 300, Some(NOW - 100), None),
            ("s-4", NOW - 50, None, None),
        ] {
            store
                .insert_session_at("wk-1", id, start, end, code)
                .await
                .unwrap();
        }

        let stats = session_stats(&store, &project.id, StatsRange::All, NOW)
            .await
            .unwrap();
        assert_eq!(stats.total, 4);
        assert_eq!(stats.ended, 3);
        assert_eq!(stats.open, 1);
        assert_eq!(stats.total_seconds, 100 + 300 + 200);
        // Sorted durations are 100, 200, 300 - the middle one.
        assert_eq!(stats.median_seconds, Some(200));
        assert_eq!(stats.failed, 1);
        assert_eq!(stats.unknown_exit, 1, "no code is not the same as code 0");
        assert_eq!(stats.failure_ratio, Some(1.0 / 3.0));
        // Newest first, and the open one carries no duration.
        assert_eq!(stats.recent[0].session_id, "s-4");
        assert_eq!(stats.recent[0].duration, None);
        assert_eq!(stats.recent[0].task, "task for wk-1");
    }

    #[tokio::test]
    async fn a_project_with_no_sessions_reports_nothing_rather_than_failing() {
        let (_dir, store, _engine, project) = fixture().await;
        let stats = session_stats(&store, &project.id, StatsRange::Today, NOW)
            .await
            .unwrap();
        assert_eq!(stats.total, 0);
        assert_eq!(stats.median_seconds, None);
        assert_eq!(stats.failure_ratio, None);
        assert!(stats.recent.is_empty());
    }

    // -- timeline ----------------------------------------------------------

    #[tokio::test]
    async fn the_timeline_keeps_the_quiet_days_in_the_series() {
        let (_dir, store, _engine, project) = fixture().await;
        add_worker(&store, &project.id, "wk-1").await;
        store
            .insert_message_at("wk-1", "ms-1", MSG_USER, NOW - 3 * DAY)
            .await
            .unwrap();
        store
            .insert_status_event_at("wk-1", "se-1", NOW - 60)
            .await
            .unwrap();

        let days = activity_timeline(&store, &project.id, StatsRange::Week, NOW)
            .await
            .unwrap();
        // Seven days back plus today, inclusive.
        assert_eq!(days.len(), 8, "{days:?}");
        assert_eq!(days[0].date, digest::utc_date(NOW - 7 * DAY));
        assert_eq!(days.last().unwrap().date, digest::utc_date(NOW));
        assert_eq!(days.last().unwrap().status_events, 1);
        let busy = days
            .iter()
            .find(|day| day.date == digest::utc_date(NOW - 3 * DAY))
            .expect("the day the message landed on");
        assert_eq!(busy.messages, 1);
        // The days in between are present and empty, not missing.
        assert!(days
            .iter()
            .any(|day| day.messages == 0 && day.status_events == 0));
    }

    #[tokio::test]
    async fn a_silent_project_still_gets_one_bar() {
        let (_dir, store, _engine, project) = fixture().await;
        let days = activity_timeline(&store, &project.id, StatsRange::All, NOW)
            .await
            .unwrap();
        assert_eq!(days.len(), 1);
        assert_eq!(days[0].messages, 0);
        assert_eq!(days[0].date, digest::utc_date(NOW));
    }

    // -- completion --------------------------------------------------------

    #[test]
    fn the_weighting_matrix_is_ordered_and_puts_a_blocked_card_below_a_running_one() {
        assert_eq!(column_weight(COL_DONE), 1.0);
        assert_eq!(column_weight(COL_READY_TO_MERGE), 0.8);
        assert_eq!(column_weight(COL_IN_REVIEW), 0.6);
        assert_eq!(column_weight(COL_WORKING), 0.3);
        assert_eq!(column_weight(COL_NEEDS_YOU), 0.2);
        assert!(column_weight(COL_NEEDS_YOU) < column_weight(COL_WORKING));
        // Every board column has a weight; a new column would fail here rather
        // than silently contribute nothing.
        for column in COLUMNS {
            assert!(column_weight(column) > 0.0, "no weight for {column}");
        }
        assert_eq!(column_weight("erfunden"), 0.0);
    }

    #[tokio::test]
    async fn an_empty_project_has_no_estimate_at_all() {
        let (_dir, store, engine, project) = fixture().await;
        let estimate = completion_estimate(&store, &engine, &project.id)
            .await
            .unwrap();
        assert_eq!(
            estimate.percent, None,
            "0 % would read as 'nichts geschafft'"
        );
        assert!(estimate.components.is_empty());
    }

    #[tokio::test]
    async fn the_estimate_blends_only_the_components_that_have_data() {
        let (_dir, store, engine, project) = fixture().await;
        // Two workers, both `working` (0.3) - nothing else exists, so the
        // whole estimate is the worker component and renormalises to it.
        add_worker(&store, &project.id, "wk-1").await;
        add_worker(&store, &project.id, "wk-2").await;

        let estimate = completion_estimate(&store, &engine, &project.id)
            .await
            .unwrap();
        assert_eq!(estimate.components.len(), 1);
        assert_eq!(estimate.components[0].key, "workers");
        assert!((estimate.components[0].weight - 1.0).abs() < 1e-9);
        assert!(
            (estimate.percent.unwrap() - 30.0).abs() < 1e-9,
            "{estimate:?}"
        );
    }

    #[tokio::test]
    async fn an_archived_worker_counts_as_done_and_a_failed_gate_pulls_the_estimate_down() {
        let (_dir, store, engine, project) = fixture().await;
        let mut archived = worker_row(&project.id, "wk-1");
        archived.status = STATUS_ARCHIVED.to_string();
        archived.test_status = Some(TEST_PASS.to_string());
        store.insert_worker(&archived).await.unwrap();
        let mut failing = worker_row(&project.id, "wk-2");
        failing.test_status = Some(TEST_FAIL.to_string());
        store.insert_worker(&failing).await.unwrap();

        let estimate = completion_estimate(&store, &engine, &project.id)
            .await
            .unwrap();
        let by_key: BTreeMap<&str, &CompletionComponent> = estimate
            .components
            .iter()
            .map(|part| (part.key.as_str(), part))
            .collect();
        // Workers: archived 1.0 + working 0.3, over two = 0.65.
        assert!((by_key["workers"].score - 0.65).abs() < 1e-9);
        // Gates: one of two green.
        assert!((by_key["tests"].score - 0.5).abs() < 1e-9);
        assert!(
            !by_key.contains_key("queue"),
            "an empty queue is not a term"
        );
        // 0.6/0.7 * 0.65 + 0.1/0.7 * 0.5, as a percentage.
        let expected = (0.6 * 0.65 + 0.1 * 0.5) / 0.7 * 100.0;
        assert!(
            (estimate.percent.unwrap() - expected).abs() < 1e-9,
            "{estimate:?}"
        );
        assert_eq!(
            estimate
                .workers
                .iter()
                .find(|row| row.worker_id == "wk-1")
                .map(|row| row.column.as_str()),
            Some(STATUS_ARCHIVED)
        );
    }

    #[tokio::test]
    async fn a_failed_queue_entry_counts_against_the_quota_and_never_for_it() {
        let (_dir, store, engine, project) = fixture().await;
        for (id, status) in [
            ("tq-1", QUEUE_DISPATCHED),
            ("tq-2", QUEUE_FAILED),
            ("tq-3", QUEUE_QUEUED),
            ("tq-4", QUEUE_DISPATCHED),
        ] {
            store
                .insert_queue_entry(&QueueEntry {
                    id: id.to_string(),
                    project_id: project.id.clone(),
                    raw_text: "work".to_string(),
                    sharpened_text: None,
                    profile_id: "claude".to_string(),
                    status: status.to_string(),
                    priority: 0,
                    worker_id: None,
                    error: None,
                    spawned_by: None,
                    created_at: NOW - 600,
                })
                .await
                .unwrap();
        }

        let estimate = completion_estimate(&store, &engine, &project.id)
            .await
            .unwrap();
        let queue = estimate
            .components
            .iter()
            .find(|part| part.key == "queue")
            .expect("a queue term");
        assert!((queue.score - 0.5).abs() < 1e-9, "2 of 4, failure included");
        assert!(queue.detail.contains("1 fehlgeschlagen"));
    }

    // -- the whole document ------------------------------------------------

    #[tokio::test]
    async fn one_document_carries_every_section_and_names_its_window() {
        let (_dir, store, engine, project) = fixture().await;
        add_worker(&store, &project.id, "wk-1").await;
        store.bind_session("wk-1", "pty-1").await;

        let stats = project_stats(&store, &engine, &project.id, StatsRange::Week, NOW)
            .await
            .unwrap();
        assert_eq!(stats.project_id, project.id);
        assert_eq!(stats.project_name, "one");
        assert_eq!(stats.range, "week");
        assert_eq!(stats.since, Some(NOW - 7 * DAY));
        assert_eq!(stats.generated_at, NOW);
        assert_eq!(stats.overview.workers_active, 1);
        assert_eq!(stats.tokens, None);
        assert_eq!(stats.sessions.total, 1);
        assert!(!stats.timeline.is_empty());
        assert!(stats.completion.percent.is_some());

        // The frontend reads camelCase; a rename that broke it would show
        // empty tiles rather than fail.
        let json = serde_json::to_value(&stats).unwrap();
        assert!(json.get("projectName").is_some());
        assert!(json["overview"].get("workersActive").is_some());
        assert!(json["completion"].get("columnWeights").is_some());
    }

    #[tokio::test]
    async fn an_unknown_project_is_an_unknown_project() {
        let (_dir, store, engine, _project) = fixture().await;
        let err = project_stats(&store, &engine, "pj-nope", StatsRange::All, NOW)
            .await
            .expect_err("no such project");
        assert!(err.starts_with(crate::workers::ERR_UNKNOWN), "{err}");
    }
}
