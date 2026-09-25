//! Live status engine: which board column a worker belongs in, right now.
//!
//! Three sources describe a worker, and they disagree constantly. The engine
//! keeps the latest word from each and folds them into one verdict:
//!
//! 1. **Agent hooks** - what the agent itself reported (see [`crate::hooks`]).
//!    Highest priority: the agent knows why it stopped, we only guess.
//! 2. **PTY output heuristics** - pattern matching on what scrolled past, plus
//!    a quiet-for-too-long timer.
//! 3. **GitHub facts** - what `gh pr list` says about the worker's branch
//!    (see [`crate::gh`]).
//!
//! Heuristics come in two strengths. A permission prompt or a quota error is
//! *strong*: it describes something only the user can clear, so it outranks the
//! pull request. Plain activity and going quiet are *weak*: once a PR exists it
//! describes the branch better than "the terminal is printing things", so the
//! GitHub verdict wins. That is the one wrinkle in the otherwise flat
//! hook > heuristic > gh order.
//!
//! Every visible column or attention change is published through a
//! [`StatusSink`]; the app wires that to the `worker:status` Tauri event, tests
//! wire it to a Vec.
//!
//! Phase 3.6 reads two more things out of the same output stream, neither of
//! which changes a column: the quota line that blocked a profile, forwarded to
//! the [`QuotaTracker`], and the context-window figure the agents print in
//! their status line, kept per worker and handed to the board.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::capabilities::Dialect;
use crate::quota::QuotaTracker;
use crate::store::{
    now_unix_secs, Store, Worker, KIND_ORCHESTRATOR, KIND_QUEEN, KIND_SCOUT, STATUS_ARCHIVED,
    STATUS_EXITED, STATUS_RUNNING,
};

/// The agent is making progress on its own.
pub const COL_WORKING: &str = "working";
/// Something is blocked on the user: a prompt, a quota, a quiet terminal.
pub const COL_NEEDS_YOU: &str = "needs_you";
/// A pull request is open for the worker's branch.
pub const COL_IN_REVIEW: &str = "in_review";
/// Approved, not a draft, and every check is green.
pub const COL_READY_TO_MERGE: &str = "ready_to_merge";
/// Archived, or merged. Off the board.
pub const COL_DONE: &str = "done";

/// Every column, in board order.
pub const COLUMNS: [&str; 5] = [
    COL_WORKING,
    COL_NEEDS_YOU,
    COL_IN_REVIEW,
    COL_READY_TO_MERGE,
    COL_DONE,
];

/// How long a `running` worker may stay silent before it counts as idle.
pub const IDLE_AFTER: Duration = Duration::from_secs(45);

/// How long a `running` worker may print nothing *and* change nothing on disk
/// before it counts as stuck rather than merely idle.
///
/// Deliberately far above [`IDLE_AFTER`]: idle is "waiting at the prompt",
/// which is a normal thing to be for a minute, while this is "nothing has
/// happened at all for ten minutes", which is not. The user can raise or lower
/// it with the `stuck.after_minutes` setting; see [`crate::stuck`].
pub const STUCK_AFTER: Duration = Duration::from_secs(10 * 60);

/// How much recent output the classifier looks at, in characters.
const TAIL_CAPACITY: usize = 2048;

/// Resolve a column name coming from the frontend to its constant.
pub fn column_const(name: &str) -> Option<&'static str> {
    COLUMNS.iter().copied().find(|c| *c == name)
}

/// Wie hart ein Grund den Menschen blockiert.
///
/// Die Varianten stehen in Sortierreihenfolge: `Blocking` zuerst. F1 legt den
/// Grad fest, F3 sortiert die Attention-Liste danach, und F4 nimmt spaeter
/// alles mit [`Grade::Blocking`] als `blockers[]`. Ein Code ohne Grad waere
/// fuer alle drei unbrauchbar.
///
/// Serialisiert als `"blocking" | "attention" | "info"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Grade {
    /// Ohne eine Handlung des Menschen bleibt die Arbeit stehen.
    Blocking,
    /// Der Mensch sollte hinsehen, aber es steht deswegen nichts still.
    Attention,
    /// Reine Nachricht: es gibt nichts zu tun.
    Info,
}

/// Warum ein Worker Aufmerksamkeit verlangt - die geschlossene Menge.
///
/// Benannt nach der **Ursache**, nicht nach der Spalte und nicht nach der
/// Quelle: eine Spalte ist eine Anzeigeentscheidung, und welcher Slot den Grund
/// gerade haelt, ist ein Zufall der Verdrahtung. Beides muesste F4 wieder
/// wegwerfen.
///
/// Der Namensraum ist der von [`crate::preflight`], und `quota_blocked` ist
/// woertlich dessen [`crate::preflight::CODE_QUOTA_BLOCKED`]: dieselbe Ursache
/// darf am Worker nicht anders heissen als am Profil, sonst sortiert F3 zwei
/// Namen fuer eine Sache nebeneinander. `message`/`repair` heissen hier wie
/// dort dasselbe - Ursache und naechster Schritt.
///
/// Bewusst *ohne* `Serialize`: auf die Leitung geht [`ReasonCode::code`], damit
/// der Name dort derselbe ist wie in `preflight` und nicht das, was serde
/// gerade aus dem Variantennamen macht.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReasonCode {
    /// Der Agent steht an einer Freigabe-Rueckfrage.
    ApprovalRequired,
    /// Kontingent oder Rate-Limit ist erschoepft.
    QuotaBlocked,
    /// Die Eingabe wurde ins Terminal geschrieben, aber nie abgeschickt.
    DeliveryFailed,
    /// Der Prozess ist beendet, ohne dass ein Nachfolger da waere.
    AgentExited,
    /// Weder Output noch Dateiaenderung, laenger als die Schwelle.
    AgentStalled,
    /// Eine Entscheidung wartet auf den Menschen (Phase 21).
    DecisionPending,
    /// Der Agent hat sich selbst gemeldet.
    AgentReported,
    /// Der Agent steht am Prompt und tut nichts.
    IdleAtPrompt,
    /// Im Pull Request wurden Aenderungen angefordert.
    ChangesRequested,
    /// Der Pull Request wartet auf ein Review.
    ReviewPending,
    /// Freigegeben, und jeder Check ist gruen.
    ReviewApproved,
    /// Freigegeben, aber noch ein Entwurf.
    ApprovedButDraft,
    /// Freigegeben, die Checks laufen noch.
    ChecksPending,
    /// Der Pull Request ist ein Entwurf.
    ReviewDraft,
    /// Der Pull Request ist gemerged.
    PullRequestMerged,
}

impl ReasonCode {
    /// Der stabile maschinenlesbare Name. Die Woerter unten duerfen umformuliert
    /// werden, dieser nicht - genau wie bei [`crate::preflight::Blocker::code`].
    pub fn code(self) -> &'static str {
        match self {
            ReasonCode::ApprovalRequired => "approval_required",
            ReasonCode::QuotaBlocked => crate::preflight::CODE_QUOTA_BLOCKED,
            ReasonCode::DeliveryFailed => "delivery_failed",
            ReasonCode::AgentExited => "agent_exited",
            ReasonCode::AgentStalled => "agent_stalled",
            ReasonCode::DecisionPending => "decision_pending",
            ReasonCode::AgentReported => "agent_reported",
            ReasonCode::IdleAtPrompt => "idle_at_prompt",
            ReasonCode::ChangesRequested => "changes_requested",
            ReasonCode::ReviewPending => "review_pending",
            ReasonCode::ReviewApproved => "review_approved",
            ReasonCode::ApprovedButDraft => "approved_but_draft",
            ReasonCode::ChecksPending => "checks_pending",
            ReasonCode::ReviewDraft => "review_draft",
            ReasonCode::PullRequestMerged => "pull_request_merged",
        }
    }

    /// Der Blockadegrad. Fest am Code, nicht an der Fundstelle: derselbe Grund
    /// blockiert nicht mal so und mal anders.
    pub fn grade(self) -> Grade {
        match self {
            // Ohne den Menschen geht hier nichts weiter.
            ReasonCode::ApprovalRequired
            | ReasonCode::QuotaBlocked
            | ReasonCode::DeliveryFailed
            | ReasonCode::AgentExited
            | ReasonCode::AgentStalled
            | ReasonCode::DecisionPending
            | ReasonCode::AgentReported
            | ReasonCode::ChangesRequested => Grade::Blocking,
            // Hinsehen lohnt, aber der Agent koennte von selbst weiterlaufen -
            // und die Stille am Prompt ist die schwaechste Beobachtung, die die
            // Engine ueberhaupt hat.
            ReasonCode::IdleAtPrompt | ReasonCode::ReviewPending | ReasonCode::ReviewApproved => {
                Grade::Attention
            }
            // Es laeuft oder ist vorbei; zu tun ist nichts.
            ReasonCode::ApprovedButDraft
            | ReasonCode::ChecksPending
            | ReasonCode::ReviewDraft
            | ReasonCode::PullRequestMerged => Grade::Info,
        }
    }

    /// Was los ist, fuer einen Menschen. Ein konkreter Beleg aus dem Terminal
    /// ersetzt ihn - siehe [`Signal::detail`].
    fn message(self) -> &'static str {
        match self {
            ReasonCode::ApprovalRequired => "Der Agent wartet auf deine Freigabe",
            ReasonCode::QuotaBlocked => "Kontingent oder Rate-Limit erreicht",
            ReasonCode::DeliveryFailed => "Die Eingabe wurde nicht abgeschickt",
            ReasonCode::AgentExited => "Der Agent ist beendet",
            ReasonCode::AgentStalled => "Kein Output und keine Dateiänderung",
            ReasonCode::DecisionPending => "Eine Entscheidung wartet",
            ReasonCode::AgentReported => "Der Agent meldet sich",
            ReasonCode::IdleAtPrompt => "Der Agent wartet am Prompt",
            ReasonCode::ChangesRequested => "Im Pull Request wurden Änderungen angefordert",
            ReasonCode::ReviewPending => "Der Pull Request wartet auf ein Review",
            ReasonCode::ReviewApproved => "Freigegeben, und jeder Check ist grün",
            ReasonCode::ApprovedButDraft => "Freigegeben, aber noch ein Entwurf",
            ReasonCode::ChecksPending => "Freigegeben, die Checks laufen noch",
            ReasonCode::ReviewDraft => "Der Pull Request ist ein Entwurf",
            ReasonCode::PullRequestMerged => "Der Pull Request ist gemerged",
        }
    }

    /// Was der Mensch tun kann. Gehoert zum Code, nicht zur Anzeige: eine
    /// Oberflaeche, die sich den naechsten Schritt selbst ausdenkt, haengt ihn
    /// an jeden Grund - auch an die, fuer die er falsch ist.
    fn repair(self) -> &'static str {
        match self {
            ReasonCode::ApprovalRequired => "bestätige die Rückfrage im Terminal",
            ReasonCode::QuotaBlocked => {
                "warte auf das nächste Zeitfenster oder wechsle das Agentenprofil"
            }
            ReasonCode::DeliveryFailed => "drücke im Terminal von Hand Enter",
            ReasonCode::AgentExited => "prüfe sein Ergebnis, dann neu starten oder archivieren",
            ReasonCode::AgentStalled => "sieh im Terminal nach oder starte den Agenten neu",
            ReasonCode::DecisionPending => "beantworte sie im Fragen-Tab",
            ReasonCode::AgentReported => "sieh im Terminal nach",
            ReasonCode::IdleAtPrompt => "gib ihm im Terminal den nächsten Schritt",
            ReasonCode::ChangesRequested => "arbeite die Kommentare ein",
            ReasonCode::ReviewPending => "sieh ihn dir an oder hol ein Review ein",
            ReasonCode::ReviewApproved => "merge den Pull Request",
            ReasonCode::ApprovedButDraft => "nimm ihn aus dem Entwurfsstatus, wenn er fertig ist",
            ReasonCode::ChecksPending => "warte, bis die Checks durch sind",
            ReasonCode::ReviewDraft => "nimm ihn aus dem Entwurfsstatus, wenn er fertig ist",
            ReasonCode::PullRequestMerged => "nichts weiter zu tun",
        }
    }
}

/// Ein anliegender Grund: der Code und, wo es einen gibt, der Beleg dazu.
///
/// Bewusst ohne Spalte. In welcher Spalte ein Worker landet, entscheidet
/// [`WorkerState::derive`] aus allen Signalen zusammen; ein einzelnes Signal
/// bleibt gueltig, auch wenn ein Handpin oder das Archiv die Spalte
/// ueberschreibt. Genau darauf setzt [`WorkerState::signals`] auf - und F4
/// spaeter mit `signals().filter(Grade::Blocking)` als `blockers[]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Signal {
    pub code: ReasonCode,
    /// Der agentengeschriebene Beleg, wo es einen gibt: der Wortlaut der Frage
    /// aus [`crate::questions`], die Meldung aus einem Hook, die Quota-Zeile
    /// aus dem Terminal, die gemessene Stille.
    ///
    /// Die eine Ausnahme von "Text folgt aus dem Code": dieser Text ist nicht
    /// ableitbar, er ist beobachtet. Er ersetzt die allgemeine Ursache, nie den
    /// naechsten Schritt - was zu tun ist, haengt am Code und nicht daran, wie
    /// ausfuehrlich der Agent sich gerade ausgedrueckt hat.
    pub detail: Option<String>,
}

impl Signal {
    pub fn new(code: ReasonCode) -> Self {
        Self { code, detail: None }
    }

    pub fn with_detail(code: ReasonCode, detail: &str) -> Self {
        let detail = detail.trim();
        Self {
            code,
            detail: (!detail.is_empty()).then(|| detail.to_string()),
        }
    }

    pub fn grade(&self) -> Grade {
        self.code.grade()
    }

    /// Der sichtbare Satz: `Ursache — nächster Schritt`, nach dem Vorbild von
    /// [`crate::preflight::Blocker::line`].
    ///
    /// Wo ein Beleg vorliegt, ist er die ganze Anzeige - ohne angehaengten
    /// naechsten Schritt. Zwei Gruende: der Wortlaut einer Frage oder einer
    /// Agentenmeldung ist schon ein ganzer Satz, und der naechste Schritt geht
    /// ohnehin als Code mit auf die Leitung ([`StatusPayload::attention_code`]),
    /// wo eine Oberflaeche ihn per [`ReasonCode::repair`] holen kann. Ihn hier
    /// anzuhaengen wuerde nur den fremden Satz verlaengern.
    pub fn line(&self) -> String {
        match self.detail.as_deref() {
            Some(detail) => detail.to_string(),
            None => format!("{} — {}", self.code.message(), self.code.repair()),
        }
    }
}

/// A column plus, when there is one, the reason the user should care.
///
/// `signal` ist die Wahrheit; `reason` ist der daraus gerenderte Text. Der Text
/// bleibt ein eigenes Feld, weil ausserhalb dieser Engine genau er gelesen wird:
/// `digest.rs`, `web_interface.rs` und `stats.rs` kennen keinen Code. Der Code
/// kommt daneben, er ersetzt nichts.
///
/// `signal: None` heisst: freier Text ohne Code. Das gibt es nur noch bei
/// Verdicts, die ausserhalb dieses Moduls und ausserhalb von [`crate::gh`]
/// entstehen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verdict {
    pub column: &'static str,
    pub signal: Option<Signal>,
    pub reason: Option<String>,
}

impl Verdict {
    pub fn plain(column: &'static str) -> Self {
        Self {
            column,
            signal: None,
            reason: None,
        }
    }

    /// Ein Verdict aus der geschlossenen Code-Menge. Der Text folgt aus dem
    /// Code, nicht umgekehrt.
    pub fn coded(column: &'static str, code: ReasonCode) -> Self {
        Self::from_signal(column, Signal::new(code))
    }

    /// Wie [`Verdict::coded`], mit dem beobachteten Beleg statt der allgemeinen
    /// Ursache.
    pub fn coded_with(column: &'static str, code: ReasonCode, detail: &str) -> Self {
        Self::from_signal(column, Signal::with_detail(code, detail))
    }

    fn from_signal(column: &'static str, signal: Signal) -> Self {
        Self {
            column,
            reason: Some(signal.line()),
            signal: Some(signal),
        }
    }

    /// Freier Text ohne Code.
    ///
    /// `#[cfg(test)]`, und das ist der Beleg: seit [`crate::gh`] Codes praegt,
    /// gibt es im Produktivpfad keinen einzigen Verdict ohne Code mehr. Was
    /// bleibt, sind Testhelfer, die eine Spalte erzwingen wollen
    /// (`workers.rs`, `park_in_ready_to_merge`). Faellt der Konstruktor hier
    /// weg, faellt die Luecke sofort auf.
    #[cfg(test)]
    pub fn with_reason(column: &'static str, reason: impl Into<String>) -> Self {
        Self {
            column,
            signal: None,
            reason: Some(reason.into()),
        }
    }
}

/// One worker's row on the board.
///
/// Serialized as `{ "worker", "column", "attentionReason", "attentionCode",
/// "attentionGrade", "prUrl", "contextUsage", "controlledBy" }`.
///
/// `attentionReason` bleibt der Satz der Karte. Code und Grad kommen daneben
/// und beschreiben das Signal mit dem höchsten Grad — dieselbe Regel wie
/// [`StatusPayload`], damit F3 die Inbox nicht aus einem Satz zurückrechnen
/// muss.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerBoardState {
    pub worker: Worker,
    pub column: String,
    pub attention_reason: Option<String>,
    pub attention_code: Option<&'static str>,
    pub attention_grade: Option<Grade>,
    /// Unix seconds when the current highest-grade signal first appeared.
    pub attention_observed_at: Option<i64>,
    pub pr_url: Option<String>,
    /// Last context-window figure seen in this worker's terminal, or `None`
    /// when its agent never printed one.
    pub context_usage: Option<ContextUsage>,
    /// The coordinator that ordered this worker. `None` means a human started
    /// it - see [`controlled_by`] for the two ways that happens.
    pub controlled_by: Option<ControlledBy>,
    /// The worker's last test-gate verdict, copied off the worker so a card can
    /// show it without reading the row a second time. `None` means the gate has
    /// never run; see [`crate::testgate`].
    pub test_status: Option<String>,
    /// Unix seconds at which `test_status` was written.
    pub tested_at: Option<i64>,
}

/// Who ordered this worker, resolved from `spawned_by` for the board badge.
///
/// The card already carries `spawnedBy`, but an id is not something a person
/// reads: this is the same fact with a name on it, resolved once here so that
/// no card has to search the rest of the board for its own coordinator.
///
/// Serialized as `{ "workerId", "kind", "label" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlledBy {
    pub worker_id: String,
    pub kind: String,
    pub label: String,
}

/// One coordinator of a project, for the board's banner row.
///
/// `status` and `session_id` come along because the banner also says whether a
/// coordinator can still be talked to: without a live session there is nothing
/// to send a message into.
///
/// Serialized as `{ "workerId", "kind", "label", "status", "sessionId" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinatorInfo {
    pub worker_id: String,
    pub kind: String,
    pub label: String,
    pub status: String,
    pub session_id: Option<String>,
}

/// The board: the cards plus the coordinators steering them.
///
/// Both halves are resolved from one and the same worker list, so a badge can
/// never name a coordinator that the banner in the same response disagrees
/// about.
///
/// Serialized as `{ "cards", "coordinators" }`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardState {
    pub cards: Vec<WorkerBoardState>,
    pub coordinators: Vec<CoordinatorInfo>,
}

/// How many characters of a task text a label may carry.
///
/// A badge sits inline on a card beside the worker's own title, so it has to
/// stay on one line. The cut is by characters rather than by words: the opening
/// words are what tells two coordinators apart, and the full text is still one
/// click away on the coordinator's own card.
const LABEL_MAX_CHARS: usize = 40;

/// The name a worker goes by: on a coordinator badge, in the board banner, and
/// on the remote board's cards alike.
///
/// One function, so that a queen is never called by its domain in one place and
/// by `Queen: <domain>` in the other - and so the phone shows an orchestrator
/// by its role rather than by the first line of its role prompt.
pub(crate) fn worker_label(worker: &Worker) -> String {
    match worker.kind.as_str() {
        // A project has exactly one orchestrator, and its task text is the whole
        // role prompt - the role is the only name worth showing.
        KIND_ORCHESTRATOR => "Orchestrator".to_string(),
        // A queen is known by its domain. `workers::queen_task` writes the
        // prefix; a task without one predates it and is taken whole.
        KIND_QUEEN => short_label(worker.task.strip_prefix("Queen: ").unwrap_or(&worker.task)),
        // Scouts and everything else have no role name to fall back on.
        _ => short_label(&worker.task),
    }
}

/// The first line of `task`, cut to [`LABEL_MAX_CHARS`].
///
/// Only the first line, because a task may be a whole briefing while a label is
/// a name.
fn short_label(task: &str) -> String {
    let line = task.lines().next().unwrap_or("").trim();
    if line.chars().count() <= LABEL_MAX_CHARS {
        return line.to_string();
    }
    let mut label: String = line.chars().take(LABEL_MAX_CHARS).collect();
    label.push('\u{2026}');
    label
}

/// Who ordered `worker`, looked up in `all`.
///
/// `None` means a human started it: either there is no `spawned_by` at all, or
/// it names a worker that is not in `all` - one from another project, or one
/// that has been deleted outright.
///
/// The lookup deliberately ignores status. A queen that has finished still
/// explains where its employees came from, so the badge must not disappear the
/// moment its coordinator is archived or exits.
pub fn controlled_by(worker: &Worker, all: &[Worker]) -> Option<ControlledBy> {
    let spawned_by = worker.spawned_by.as_deref()?;
    let controller = all.iter().find(|candidate| candidate.id == spawned_by)?;
    Some(ControlledBy {
        worker_id: controller.id.clone(),
        kind: controller.kind.clone(),
        label: worker_label(controller),
    })
}

/// Every coordinator in `all` that is still on the board.
///
/// Archived ones are dropped: the banner says who is steering *now*, while
/// [`controlled_by`] keeps resolving against them so the badges survive.
///
/// The result keeps the caller's order. `Store::list_workers` sorts by
/// `created_at, id`, so the banner does not reshuffle itself between polls -
/// that ordering is relied upon here rather than established again.
pub fn coordinators(all: &[Worker]) -> Vec<CoordinatorInfo> {
    all.iter()
        .filter(|worker| {
            matches!(
                worker.kind.as_str(),
                KIND_ORCHESTRATOR | KIND_QUEEN | KIND_SCOUT
            ) && worker.status != STATUS_ARCHIVED
        })
        .map(|worker| CoordinatorInfo {
            worker_id: worker.id.clone(),
            kind: worker.kind.clone(),
            label: worker_label(worker),
            status: worker.status.clone(),
            session_id: worker.session_id.clone(),
        })
        .collect()
}

/// How much of an agent's context window is spoken for.
///
/// Serialized as `{ "used", "total" }`, both in tokens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ContextUsage {
    pub used: u64,
    pub total: u64,
}

/// A usage snapshot scraped from a Claude Code `statusLine` hook payload.
///
/// Kept in the worker state so the provider overview can read the latest
/// observation across all workers running the same provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusLineUsage {
    /// The headline percentage: the five-hour window where the payload has
    /// one, the seven-day window otherwise. This is what the provider overview
    /// shows, and it is deliberately one number.
    pub percent: Option<u8>,
    pub used: Option<String>,
    pub limit: Option<String>,
    pub window_label: String,
    pub resets_at: Option<i64>,
    /// The two rate-limit windows kept apart, because a budget threshold is
    /// set per window: a profile at 30 % of its five hours and 95 % of its
    /// seven days has to trip the seven-day limit and only that one.
    /// `None` means the payload said nothing about that window.
    pub five_hour: Option<RateWindowUsage>,
    pub seven_day: Option<RateWindowUsage>,
    /// When this snapshot was parsed; used to pick the freshest observation.
    pub observed_at: i64,
}

/// One rate-limit window as the `statusLine` payload reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RateWindowUsage {
    pub percent: Option<u8>,
    /// Unix seconds at which the window rolls over, when the provider said.
    pub resets_at: Option<i64>,
}

/// Payload of the `worker:status` event.
///
/// Serialized as `{ "workerId", "column", "attentionReason", "attentionCode",
/// "attentionGrade" }`.
///
/// `attentionReason` bleibt, was es war: der Satz, den die Karte zeigt, aus dem
/// Verdict, der die Spalte gewonnen hat. Code und Grad kommen **daneben** und
/// ersetzen nichts - eine Liste, die nach Blockadegrad sortiert (F3), kann ihn
/// aus einem Satz nicht zurueckrechnen.
///
/// Die beiden neuen Felder beschreiben das Signal mit dem hoechsten Grad, nicht
/// das spaltengewinnende. Meist ist das dasselbe; auseinander laufen sie genau
/// dort, wo ein Handpin oder das Archiv die Spalte setzt, waehrend ein Blocker
/// weiter anliegt - und dass der dann nicht verschwindet, ist der Zweck
/// (`.pa/report_f0.md` §2, Befund B-6).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusPayload {
    pub worker_id: String,
    pub column: String,
    pub attention_reason: Option<String>,
    /// Stabiler Code aus [`ReasonCode::code`], im Namensraum von
    /// [`crate::preflight`].
    pub attention_code: Option<&'static str>,
    pub attention_grade: Option<Grade>,
    pub attention_observed_at: Option<i64>,
}

/// Where column changes go. The app emits a Tauri event; tests record.
pub trait StatusSink: Send + Sync {
    fn publish(&self, payload: StatusPayload);
}

// -- heuristics ------------------------------------------------------------

/// What the last few kilobytes of terminal output suggest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Heuristic {
    /// Output is flowing and none of the patterns matched.
    Activity,
    /// An approval / permission prompt is on screen.
    Permission,
    /// A quota or rate limit error is on screen.
    Quota,
    /// Nothing has been printed for [`IDLE_AFTER`] while the agent is running.
    Idle,
}

impl Heuristic {
    /// Verdicts that outrank a pull request: only the user can clear these.
    fn strong(&self) -> Option<Verdict> {
        match self {
            Heuristic::Permission => {
                Some(Verdict::coded(COL_NEEDS_YOU, ReasonCode::ApprovalRequired))
            }
            Heuristic::Quota => Some(Verdict::coded(COL_NEEDS_YOU, ReasonCode::QuotaBlocked)),
            _ => None,
        }
    }

    /// Verdicts a known pull request describes better.
    fn weak(&self) -> Option<Verdict> {
        match self {
            Heuristic::Idle => Some(Verdict::coded(COL_NEEDS_YOU, ReasonCode::IdleAtPrompt)),
            Heuristic::Activity => Some(Verdict::plain(COL_WORKING)),
            _ => None,
        }
    }

    /// A strong heuristic is a definitive signal: it clears a manual override.
    fn is_definitive(&self) -> bool {
        self.strong().is_some()
    }

    /// Der Grund, den diese Beobachtung nennt - unabhaengig davon, ob er die
    /// Spalte gewinnt. `strong`/`weak` beantworten, wer die Spalte bekommt;
    /// das hier beantwortet, was anliegt.
    fn signal(&self) -> Option<Signal> {
        match self {
            Heuristic::Permission => Some(Signal::new(ReasonCode::ApprovalRequired)),
            Heuristic::Quota => Some(Signal::new(ReasonCode::QuotaBlocked)),
            Heuristic::Idle => Some(Signal::new(ReasonCode::IdleAtPrompt)),
            // Ein Agent, der arbeitet, verlangt nichts.
            Heuristic::Activity => None,
        }
    }
}

/// Lowercase substrings that mark a prompt, checked for every profile. The
/// agent-specific shapes are data now: each profile carries them in its
/// [`Dialect`], and they extend this set, never replace it.
const GENERIC_PERMISSION: &[&str] = &[
    "do you want to proceed",
    "do you want to continue",
    "press enter to continue",
    "(y/n)",
    "[y/n]",
    "y/n]",
    "do you approve",
    "waiting for approval",
];

/// Lowercase substrings that mark a quota or rate-limit error, checked for
/// every profile.
// A bare "429" is deliberately absent: it matches a token count, a byte
// offset and a line number just as happily as an HTTP status.
const GENERIC_QUOTA: &[&str] = &[
    "rate limit",
    "rate_limit",
    "quota exceeded",
    "insufficient_quota",
    "insufficient quota",
    "too many requests",
    "status 429",
    "error 429",
    "http 429",
    "429 too many",
];

/// Drop ANSI escape sequences so patterns match the text a human would read.
///
/// Carriage returns become newlines: agents redraw progress lines with `\r`,
/// and without this a redraw would glue two unrelated words together.
pub fn strip_ansi(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\u{1b}' => match chars.peek() {
                // CSI: parameters, then one final byte in 0x40..=0x7E.
                Some('[') => {
                    chars.next();
                    for c in chars.by_ref() {
                        if ('\u{40}'..='\u{7e}').contains(&c) {
                            break;
                        }
                    }
                }
                // OSC: runs until BEL or ST.
                Some(']') => {
                    chars.next();
                    while let Some(c) = chars.next() {
                        if c == '\u{7}' {
                            break;
                        }
                        if c == '\u{1b}' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                }
                // Two-character escape.
                Some(_) => {
                    chars.next();
                }
                None => {}
            },
            '\r' => out.push('\n'),
            _ => out.push(ch),
        }
    }
    out
}

/// Classify the recent output of a worker, given its profile's dialect.
///
/// The errors win over the prompts: a quota error is what actually stopped the
/// agent, even when a half-drawn prompt is still on screen above it.
pub fn classify_output(dialect: &Dialect, tail: &str) -> Option<Heuristic> {
    let text = strip_ansi(tail).to_lowercase();
    if text.trim().is_empty() {
        return None;
    }

    let has = |generic: &[&str], own: &[String]| {
        generic.iter().any(|p| text.contains(p)) || own.iter().any(|p| text.contains(p.as_str()))
    };
    if has(GENERIC_QUOTA, &dialect.quota) {
        return Some(Heuristic::Quota);
    }
    if has(GENERIC_PERMISSION, &dialect.permission) {
        return Some(Heuristic::Permission);
    }
    Some(Heuristic::Activity)
}

/// The most recent line of `tail` that matches a quota pattern.
///
/// [`classify_output`] answers *whether* the agent is blocked; this answers
/// *what it said*, which is the only useful thing to show the user - "quota
/// reached" is not actionable, "your limit resets at 3pm" is. Searched from the
/// end, because a terminal that scrolled past one error into another is showing
/// the second one.
pub fn quota_line(dialect: &Dialect, tail: &str) -> Option<String> {
    let text = strip_ansi(tail);
    text.lines().rev().find_map(|line| {
        let lower = line.to_lowercase();
        let hit = GENERIC_QUOTA.iter().any(|p| lower.contains(p))
            || dialect.quota.iter().any(|p| lower.contains(p.as_str()));
        if !hit {
            return None;
        }
        let trimmed = line.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

// -- context window --------------------------------------------------------

/// Labels an agent puts in front of its context figure, lowercased.
const CONTEXT_LABELS: [&str; 2] = ["ctx:", "context:"];

/// How far past the label the two numbers may sit before this stops looking
/// like a status line and starts looking like a coincidence.
const CONTEXT_FIELD_MAX: usize = 24;

/// Read the context-window figure out of an agent's status line.
///
/// Claude Code draws `Ctx: 137.0k/1000.0k tok (14% used)`; the shape is common
/// enough that the parser only insists on `<label> <used>/<total>`, with `k`
/// and `M` suffixes on either number. Anything else - a missing total, a label
/// with no numbers behind it, a slash that belongs to a path - is `None`, and
/// the board shows nothing rather than a wrong number.
///
/// Pure: the tail goes in, a figure comes out. The last match in `text` wins,
/// since a status line is redrawn and the newest copy is the current one.
pub fn parse_context_usage(text: &str, extra_labels: &[String]) -> Option<ContextUsage> {
    let text = strip_ansi(text);
    // ASCII-only lowercasing so byte offsets still index into `text`.
    let lower = text.to_ascii_lowercase();

    let start = CONTEXT_LABELS
        .iter()
        .copied()
        .chain(extra_labels.iter().map(String::as_str))
        .filter_map(|label| lower.rfind(label).map(|at| at + label.len()))
        .max()?;
    let rest = text.get(start..)?;

    let (used, total) = rest.split_once('/')?;
    if used.trim().len() > CONTEXT_FIELD_MAX {
        return None;
    }
    let used = parse_amount(used)?;
    let total = parse_amount(leading_number(total))?;
    // A window of nothing is not a window; a figure like that is a misread.
    if total == 0 {
        return None;
    }
    Some(ContextUsage { used, total })
}

/// The part of `text` that could still be a number: digits, a decimal point,
/// thousands separators and a unit suffix.
fn leading_number(text: &str) -> &str {
    let text = text.trim_start();
    let end = text
        .find(|c: char| !matches!(c, '0'..='9' | '.' | ',' | 'k' | 'K' | 'm' | 'M'))
        .unwrap_or(text.len());
    &text[..end]
}

/// `137.0k` -> 137000, `1.2M` -> 1200000, `2048` -> 2048.
fn parse_amount(text: &str) -> Option<u64> {
    let text = text.trim();
    if text.contains(char::is_whitespace) {
        return None;
    }
    let (digits, multiplier) = match text.chars().next_back()? {
        'k' | 'K' => (&text[..text.len() - 1], 1_000f64),
        'm' | 'M' => (&text[..text.len() - 1], 1_000_000f64),
        _ => (text, 1f64),
    };
    let digits = digits.replace(',', "");
    let value: f64 = digits.parse().ok()?;
    if !value.is_finite() || value < 0.0 {
        return None;
    }
    let scaled = (value * multiplier).round();
    // Beyond this the figure is not a token count any more.
    if scaled > u64::MAX as f64 {
        return None;
    }
    Some(scaled as u64)
}

// -- the engine ------------------------------------------------------------

/// Everything the engine remembers about one worker.
struct WorkerState {
    profile_id: String,
    /// The profile's output dialect, copied in by `observe_worker`.
    dialect: Dialect,
    status: String,
    /// Latest hook verdict. `Stop` clears it: the agent has nothing to add, so
    /// the lower-priority sources get to speak again.
    hook: Option<Verdict>,
    heuristic: Option<Heuristic>,
    gh: Option<Verdict>,
    pr_url: Option<String>,
    override_column: Option<&'static str>,
    /// A task was pasted but the TUI never accepted it after three Enter
    /// retries. Real output clears this immediately.
    submit_guard: Option<Verdict>,
    /// This worker has a blocking decision waiting for the human (Phase 21).
    ///
    /// Set when the question is asked and cleared when it is closed - by a
    /// person, by the clock or by the budget rule - rather than by the next
    /// chunk of output. Output is the wrong signal here: the agent asks by
    /// running `pa ask` in its own terminal, so its own question would print
    /// the card back to `working` a moment after raising it.
    question: Option<Verdict>,
    tail: String,
    last_output: Option<Instant>,
    /// Hash of the worktree's git state, as the probe in [`crate::stuck`] last
    /// read it. `None` until the first probe.
    git_fingerprint: Option<String>,
    /// The same hash as it stood when this agent started - the first probe
    /// after the worker began running. It is the baseline the exit note
    /// compares against: same fingerprint at the end as at the start means the
    /// agent left nothing behind.
    spawn_fingerprint: Option<String>,
    /// When the fingerprint last changed. `None` while nothing has changed
    /// since the first probe, which is why the stuck timer falls back to the
    /// first probe's own time.
    last_git_change: Option<Instant>,
    /// When the first probe of this agent's run landed. Without it a worker
    /// that never touches a file would look stuck from the moment the engine
    /// heard about it, however long it had been running.
    git_since: Option<Instant>,
    /// Set by the tick when output *and* the worktree have both been quiet for
    /// [`STUCK_AFTER`]. Real output or a real file change clears it.
    stuck: Option<Verdict>,
    /// Last visible projection sent to the UI. Attention is stored beside the
    /// column verdict because a lifecycle override may hold the column steady
    /// while a blocker appears or clears underneath it.
    published: Option<(Verdict, Option<Signal>)>,
    /// Code and first-observed time of the current highest-grade signal.
    attention_since: Option<(ReasonCode, i64)>,
    /// Last context figure this worker printed. Sticky: an agent only redraws
    /// its status line now and then, and the previous number is still the best
    /// answer in between.
    context_usage: Option<ContextUsage>,
    /// Last `statusLine` payload this worker reported.
    statusline: Option<StatusLineUsage>,
}

impl Default for WorkerState {
    fn default() -> Self {
        Self {
            profile_id: String::new(),
            dialect: Dialect::default(),
            status: STATUS_RUNNING.to_string(),
            hook: None,
            heuristic: None,
            gh: None,
            pr_url: None,
            override_column: None,
            submit_guard: None,
            question: None,
            tail: String::new(),
            last_output: None,
            git_fingerprint: None,
            spawn_fingerprint: None,
            last_git_change: None,
            git_since: None,
            stuck: None,
            published: None,
            attention_since: None,
            context_usage: None,
            statusline: None,
        }
    }
}

impl WorkerState {
    /// Fold the sources into one column.
    ///
    /// `archived` first so a put-away worker never flickers - but a manual
    /// override set *after* the archiving still wins: merging requires the
    /// agent archived first, and a card that can never leave `done` again can
    /// never be merged (NT-1 deadlock). Then hook > strong heuristic > gh >
    /// weak heuristic, with `exited` slotted in just above the weak heuristics
    /// - an agent that ended is not "idle at a prompt", it is gone. The hook
    ///   itself is already cleared by [`StatusEngine::observe_worker`] when the
    ///   lifecycle ends, so a stale `SessionStart` cannot reach this point.
    fn derive(&self) -> Verdict {
        if self.status == STATUS_ARCHIVED {
            if let Some(column) = self.override_column {
                return Verdict::plain(column);
            }
            return Verdict::plain(COL_DONE);
        }
        if let Some(verdict) = &self.submit_guard {
            return verdict.clone();
        }
        if let Some(column) = self.override_column {
            return Verdict::plain(column);
        }
        // Above the hook: a `Notification` is the agent saying it would like
        // to be looked at, an open question is the agent saying it cannot go
        // on. The second sentence is the one the card should carry.
        if let Some(verdict) = &self.question {
            return verdict.clone();
        }
        if let Some(verdict) = &self.hook {
            return verdict.clone();
        }
        if let Some(verdict) = self.heuristic.as_ref().and_then(Heuristic::strong) {
            return verdict;
        }
        if let Some(verdict) = &self.gh {
            return verdict.clone();
        }
        if self.status == STATUS_EXITED {
            return Verdict::coded(COL_NEEDS_YOU, ReasonCode::AgentExited);
        }
        // Below the pull request on purpose: a card with an open PR is where
        // it belongs whatever its terminal is doing, and calling that stuck
        // would be noise. Above the weak heuristics for the opposite reason -
        // "quiet for ten minutes and nothing on disk" says more than "waiting
        // at the prompt", and it is the same worker either way.
        if let Some(verdict) = &self.stuck {
            return verdict.clone();
        }
        if let Some(verdict) = self.heuristic.as_ref().and_then(Heuristic::weak) {
            return verdict;
        }
        Verdict::plain(COL_WORKING)
    }

    /// Alles, was gerade an diesem Worker anliegt, nach Blockadegrad sortiert.
    ///
    /// Bewusst blind fuer `override_column` und fuer `archived`: beides sind
    /// Anzeigeentscheidungen, und ein Handpin darf einen Blocker nicht
    /// verschwinden lassen (`.pa/report_f0.md` §2, Befund B-6). [`Self::derive`]
    /// waehlt die *eine* Spalte und wirft dabei jeden weiteren Grund weg - das
    /// hier sammelt sie ein, damit F4 spaeter `signals().filter(Blocking)` als
    /// `blockers[]` nehmen kann, ohne dass etwas nachgereicht werden muss.
    fn signals(&self) -> Vec<Signal> {
        let mut out: Vec<Signal> = [
            self.submit_guard.as_ref(),
            self.question.as_ref(),
            self.hook.as_ref(),
            self.gh.as_ref(),
            self.stuck.as_ref(),
        ]
        .into_iter()
        .flatten()
        .filter_map(|verdict| verdict.signal.clone())
        .collect();
        if let Some(signal) = self.heuristic.as_ref().and_then(Heuristic::signal) {
            out.push(signal);
        }
        if self.status == STATUS_EXITED {
            out.push(Signal::new(ReasonCode::AgentExited));
        }
        // Zwei Quellen koennen denselben Grund melden - der Hook und die
        // Heuristik sehen dieselbe Rueckfrage. Der zuerst eingesammelte
        // gewinnt: die Reihenfolge oben ist die von `derive`, also die von der
        // staerkeren Quelle zur schwaecheren.
        let mut seen: Vec<ReasonCode> = Vec::with_capacity(out.len());
        out.retain(|signal| {
            let first = !seen.contains(&signal.code);
            if first {
                seen.push(signal.code);
            }
            first
        });
        // Stabil, damit die Quellenreihenfolge innerhalb eines Grades haelt.
        out.sort_by_key(Signal::grade);
        out
    }

    /// Das Signal mit dem hoechsten Blockadegrad, oder `None`, wenn nichts
    /// anliegt. Das ist die Attention dieses Workers - nicht der Grund, der
    /// zufaellig die Spalte gewonnen hat.
    fn attention(&self) -> Option<Signal> {
        self.signals().into_iter().next()
    }

    fn push_output(&mut self, chunk: &str) {
        self.tail.push_str(chunk);
        let len = self.tail.chars().count();
        if len > TAIL_CAPACITY {
            self.tail = self.tail.chars().skip(len - TAIL_CAPACITY).collect();
        }
    }
}

/// Der Beleg, den [`ReasonCode::AgentStalled`] mitfuehrt: was genau still
/// war, wie lange, und was zuletzt auf dem Schirm stand.
///
/// Nur die Ursache, nicht der naechste Schritt - der haengt am Code und wird
/// von [`ReasonCode::describe`] angehaengt.
///
/// The duration named is the *threshold*, not the measured silence: the tick
/// runs every few seconds and a reason that counted upwards would publish a
/// new column change on every one of them. "at least" is therefore the honest
/// wording, and it is also the only one the user can act on - the number they
/// set is the number they read back.
fn stuck_reason(after: Duration, tail: &str) -> String {
    let minutes = (after.as_secs() / 60).max(1);
    match last_visible_line(tail) {
        Some(line) => format!(
            "kein Output und keine Dateiänderung seit mindestens {minutes} min — \
             vermutlich festgefahren (zuletzt: {line})"
        ),
        None => format!(
            "kein Output und keine Dateiänderung seit mindestens {minutes} min — \
             vermutlich festgefahren"
        ),
    }
}

/// The last line of terminal output a person could read, or `None` when the
/// tail holds nothing but redraw noise.
///
/// [`strip_ansi`] is the same reader the classifier uses, which is the point:
/// what the heuristics matched against is what the reason quotes. It also
/// turns a carriage return into a newline, so a progress line redrawn in place
/// counts as its own line here rather than as one long smear. Whatever control
/// characters are left go too, and the result is cut to a length a card holds.
fn last_visible_line(tail: &str) -> Option<String> {
    const MAX_LINE: usize = 80;
    let line = strip_ansi(tail)
        .lines()
        .rev()
        .map(|line| {
            line.chars()
                .filter(|c| !c.is_control())
                .collect::<String>()
                .trim()
                .to_string()
        })
        .find(|line| !line.is_empty())?;
    if line.chars().count() <= MAX_LINE {
        return Some(line);
    }
    let mut cut: String = line.chars().take(MAX_LINE).collect();
    cut.push('\u{2026}');
    Some(cut)
}

/// Set after the first poisoned lock in the engine; prevents log spam.
static ENGINE_POISON_LOGGED: AtomicBool = AtomicBool::new(false);

/// Lock one of the engine's slots, taking the state over if a panic poisoned
/// it (W1-15b). The slots hold plain data, so the worst a panicking `edit`
/// leaves behind is one worker with some fields updated and some not; later
/// observations overwrite most of them, but a field only that `edit` writes
/// can stay stale. Dropping out instead - the old behaviour - switched off
/// the budget stop, the idle timer, the reaper and the board for the rest of
/// the process without a word. Logged once: `update` runs on every output
/// chunk. The poison flag itself stays set; only the first hit is reported.
fn recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| {
        if !ENGINE_POISON_LOGGED.swap(true, Ordering::Relaxed) {
            eprintln!(
                "projecta: status engine state was poisoned; recovering (further occurrences are not logged); restart ProjectA if the board looks wrong"
            );
        }
        poison.into_inner()
    })
}

/// The board's memory. Cheap to share: register it once as Tauri state and hand
/// `Arc` clones to the hook receiver, the poller and the idle ticker.
pub struct StatusEngine {
    workers: Mutex<HashMap<String, WorkerState>>,
    sink: Mutex<Option<Arc<dyn StatusSink>>>,
    /// Where quota observations go. Optional: without it the board still works,
    /// it just cannot tell the user which profile ran out.
    quota: Mutex<Option<Arc<QuotaTracker>>>,
    /// Per-profile output dialects, installed once at startup. A profile
    /// without an entry classifies with the generic set alone.
    dialects: Mutex<HashMap<String, Dialect>>,
    /// The database, for the one thing the engine does besides deciding
    /// columns: starting a test gate when a card reaches review. Optional, so
    /// the whole engine still works - and every test here still runs - without
    /// one; see [`StatusEngine::start_test_gate`].
    store: Mutex<Option<Store>>,
    /// The app handle, for the one thing the critic needs and the gate does
    /// not: locating the bundled skill inside the installed resources.
    /// Optional for the same reason as `store`; see
    /// [`StatusEngine::start_learning_critic`].
    app: Mutex<Option<AppHandle>>,
    idle_after: Duration,
    /// How long output *and* the worktree have to be quiet before a worker is
    /// called stuck. Read from the settings by [`crate::stuck`] on every sweep,
    /// so a change takes effect without a restart.
    stuck_after: Mutex<Duration>,
}

impl Default for StatusEngine {
    fn default() -> Self {
        Self::new(IDLE_AFTER)
    }
}

impl StatusEngine {
    pub fn new(idle_after: Duration) -> Self {
        Self {
            workers: Mutex::new(HashMap::new()),
            sink: Mutex::new(None),
            quota: Mutex::new(None),
            dialects: Mutex::new(HashMap::new()),
            store: Mutex::new(None),
            app: Mutex::new(None),
            idle_after,
            stuck_after: Mutex::new(STUCK_AFTER),
        }
    }

    /// Set the stuck threshold. Ignores anything at or below the idle
    /// threshold: a "stuck" verdict that fires before the idle one would only
    /// be a second, more alarming word for the same silence.
    pub fn set_stuck_after(&self, after: Duration) {
        if after <= self.idle_after {
            return;
        }
        *recover(&self.stuck_after) = after;
    }

    /// Install the destination for column changes. Set once at startup.
    pub fn set_sink(&self, sink: Arc<dyn StatusSink>) {
        *recover(&self.sink) = Some(sink);
    }

    /// Install the quota tracker fed by the output heuristics. Set once at
    /// startup, before the first agent is spawned.
    pub fn set_quota_tracker(&self, quota: Arc<QuotaTracker>) {
        *recover(&self.quota) = Some(quota);
    }

    /// Install the per-profile dialects, once at startup. A profile without
    /// an entry classifies with the GENERIC set alone - always safe.
    pub fn set_dialects(&self, dialects: HashMap<String, Dialect>) {
        *recover(&self.dialects) = dialects;
    }

    /// Install the database handle the test gate needs. Set once at startup.
    /// Without it no gate is ever started and nothing else changes.
    pub fn set_store(&self, store: Store) {
        *recover(&self.store) = Some(store);
    }

    /// Install the app handle the learning critic needs. Set once at startup.
    /// Without it no critic is ever started and nothing else changes.
    pub fn set_app(&self, app: AppHandle) {
        *recover(&self.app) = Some(app);
    }

    /// Start the project's test gate for a worker that has just reached review.
    ///
    /// Fire and forget on purpose: `update` runs on whichever thread produced
    /// the observation - the PTY reader, the GitHub poller, a board request -
    /// and none of them may wait on a test suite. Nothing is awaited here, and
    /// the engine's lock is already released by the time this is reached.
    ///
    /// The debounce is the column transition itself. Attention-only updates are
    /// published for the UI but do not start a gate; one parked in `in_review`
    /// therefore produces no further gate edges however often it is polled, and
    /// [`crate::testgate::run_test_gate_if_due`] refuses a second run for a
    /// worker that is already testing or has already passed. Together those are
    /// "once", without the engine having to remember anything of its own.
    fn start_test_gate(&self, worker_id: &str) {
        let Some(store) = recover(&self.store).clone() else {
            return;
        };
        let worker_id = worker_id.to_string();
        tauri::async_runtime::spawn(async move {
            if let Err(err) = crate::testgate::run_test_gate_if_due(&store, &worker_id).await {
                eprintln!("projecta: test gate for {worker_id}: {err}");
            }
        });
    }

    /// Distil learnings from a worker that has just reached `done`.
    ///
    /// Fire and forget for the same reason as [`StatusEngine::start_test_gate`]:
    /// `update` runs on whichever thread produced the observation, and none of
    /// them may wait on a child process that is allowed to take three minutes.
    /// Nothing is awaited here, and the engine's lock is already released by
    /// the time this is reached.
    ///
    /// Every failure is swallowed after a line on stderr. A critic that cannot
    /// find its CLI, times out, or is handed an answer it cannot parse must
    /// never keep a card from reaching `done` - the learnings are a bonus, the
    /// board is the product. Learning is also opt-out per category, so a user
    /// who turned the worker critic off gets no run at all.
    ///
    /// The debounce is the column transition itself: attention-only updates are
    /// published without starting another critic. [`crate::critic::run_critic`]
    /// refuses a second run for a worker that already has learnings, which
    /// covers the paths a transition cannot see - a respawn, a restart, the
    /// manual button.
    fn start_learning_critic(&self, worker_id: &str) {
        let Some(store) = recover(&self.store).clone() else {
            return;
        };
        let Some(app) = recover(&self.app).clone() else {
            return;
        };
        let worker_id = worker_id.to_string();
        tauri::async_runtime::spawn(async move {
            if !crate::learnings::learning_enabled(&store, "worker").await {
                return;
            }
            if let Err(err) = crate::critic::run_critic(&app, &store, &worker_id).await {
                eprintln!("projecta: learning critic for {worker_id}: {err}");
            }
        });
    }

    /// Apply `edit`, then publish if the visible column or attention changed.
    ///
    /// The sink is called outside the lock: an emit that blocks must never
    /// stall the PTY reader thread that is feeding the next chunk in.
    fn update<F>(&self, worker_id: &str, edit: F)
    where
        F: FnOnce(&mut WorkerState),
    {
        let changed = {
            let mut workers = recover(&self.workers);
            let state = workers.entry(worker_id.to_string()).or_default();
            edit(state);
            let verdict = state.derive();
            let attention = state.attention();
            let attention_observed_at = match attention.as_ref() {
                Some(signal) => match state.attention_since {
                    Some((code, observed_at)) if code == signal.code => Some(observed_at),
                    _ => {
                        let observed_at = now_unix_secs();
                        state.attention_since = Some((signal.code, observed_at));
                        Some(observed_at)
                    }
                },
                None => {
                    state.attention_since = None;
                    None
                }
            };
            let projection = (verdict.clone(), attention.clone());
            if state.published.as_ref() == Some(&projection) {
                None
            } else {
                let column_changed = match state.published.as_ref() {
                    Some((previous, _)) => previous.column != verdict.column,
                    None => true,
                };
                state.published = Some(projection);
                // Unter demselben Lock gelesen wie der Verdict, damit Spalte,
                // Satz und Code aus einem Zustand stammen.
                Some((verdict, attention, attention_observed_at, column_changed))
            }
        };

        let Some((verdict, attention, attention_observed_at, column_changed)) = changed else {
            return;
        };
        // Reaching review is the moment the work claims to be finished, which
        // is the one moment a gate is worth running.
        if column_changed && verdict.column == COL_IN_REVIEW {
            self.start_test_gate(worker_id);
        }
        // Reaching done is the moment the run is over, which is the one moment
        // there is a whole run to learn from.
        if column_changed && verdict.column == COL_DONE {
            self.start_learning_critic(worker_id);
        }
        let sink = recover(&self.sink).clone();
        if let Some(sink) = sink {
            sink.publish(StatusPayload {
                worker_id: worker_id.to_string(),
                column: verdict.column.to_string(),
                attention_reason: verdict.reason,
                attention_code: attention.as_ref().map(|signal| signal.code.code()),
                attention_grade: attention.as_ref().map(Signal::grade),
                attention_observed_at,
            });
        }
    }

    /// Take the persisted facts about a worker: its profile, its status and the
    /// pull request URL last written by the poller.
    pub fn observe_worker(&self, worker: &Worker) {
        // One lock after the other, never nested: read and clone the dialect
        // first, then update the worker.
        let dialect = recover(&self.dialects)
            .get(&worker.profile_id)
            .cloned()
            .unwrap_or_default();
        self.update(&worker.id, |state| {
            state.profile_id.clone_from(&worker.profile_id);
            state.dialect = dialect;
            if state.status != worker.status {
                let restarted = state.status != STATUS_RUNNING && worker.status == STATUS_RUNNING;
                state.status.clone_from(&worker.status);
                // Archiving is definitive; so is coming back to life.
                state.override_column = None;
                state.submit_guard = None;
                if worker.status == STATUS_EXITED {
                    // Every hook describes an agent that is still alive; once
                    // the lifecycle says it is gone, a `SessionStart` from
                    // before the end is stale and must not pin the card on
                    // `working`. A normal `Stop` hook clears itself - this is
                    // the crash without one.
                    state.hook = None;
                }
                if restarted {
                    // A respawned agent is a new run, and the baseline the exit
                    // note compares against belongs to the run, not to the
                    // worker: keeping the old one would judge this agent by
                    // what the last one did to the worktree.
                    state.git_fingerprint = None;
                    state.spawn_fingerprint = None;
                    state.last_git_change = None;
                    state.git_since = None;
                    state.stuck = None;
                }
            }
            if worker.pr_url.is_some() {
                state.pr_url.clone_from(&worker.pr_url);
            }
            // Start the idle clock when a worker first shows up running, so a
            // worker that never prints anything still reaches `needs_you`.
            if state.last_output.is_none() && worker.status == STATUS_RUNNING {
                state.last_output = Some(Instant::now());
            }
        });
    }

    /// Drop a worker the app no longer tracks.
    pub fn forget_worker(&self, worker_id: &str) {
        recover(&self.workers).remove(worker_id);
    }

    /// Feed a chunk of terminal output.
    pub fn note_output(&self, worker_id: &str, chunk: &str) {
        self.note_output_at(worker_id, chunk, Instant::now());
    }

    /// [`StatusEngine::note_output`] with an explicit clock, for tests.
    pub fn note_output_at(&self, worker_id: &str, chunk: &str, at: Instant) {
        // Decided under the lock, applied after it: the quota tracker persists,
        // and this runs on the thread that is reading the terminal.
        let mut quota_change: Option<(String, Option<String>)> = None;

        self.update(worker_id, |state| {
            state.push_output(chunk);
            state.last_output = Some(at);
            // Any real terminal output after the guard escalated means the
            // prompt did not stay stuck after all.
            state.submit_guard = None;
            // Same for the stuck verdict: it says nothing has happened, and
            // this is something happening. The tick puts it back if the
            // silence resumes for another full threshold.
            state.stuck = None;
            if let Some(usage) = parse_context_usage(&state.tail, &state.dialect.context_labels) {
                state.context_usage = Some(usage);
            }

            let profile_id = std::mem::take(&mut state.profile_id);
            let dialect = std::mem::take(&mut state.dialect);
            if let Some(heuristic) = classify_output(&dialect, &state.tail) {
                if heuristic.is_definitive() {
                    state.override_column = None;
                }
                // A profile is blocked by the line that says so, and released
                // by the next thing it manages to print. Prompts and silence
                // say nothing either way, so they leave the quota alone.
                if !profile_id.is_empty() {
                    quota_change = match heuristic {
                        Heuristic::Quota => Some((
                            profile_id.clone(),
                            Some(
                                quota_line(&dialect, &state.tail)
                                    .unwrap_or_else(|| "quota or rate limit reached".to_string()),
                            ),
                        )),
                        Heuristic::Activity => Some((profile_id.clone(), None)),
                        _ => None,
                    };
                }
                state.heuristic = Some(heuristic);
            }
            state.profile_id = profile_id;
            state.dialect = dialect;
        });

        let Some((profile_id, reason)) = quota_change else {
            return;
        };
        let tracker = recover(&self.quota).clone();
        if let Some(tracker) = tracker {
            match reason {
                Some(reason) => tracker.note_blocked(&profile_id, &reason, None),
                None => tracker.note_ok(&profile_id),
            }
        }
    }

    /// Feed the worktree fingerprint the git probe just read.
    ///
    /// The fingerprint is opaque here: whatever [`crate::stuck`] hashes out of
    /// `git status` and `git rev-parse HEAD`. All this side cares about is
    /// whether it is the same string as last time. A change is activity, and
    /// activity clears a stuck verdict exactly the way output does - which is
    /// the whole point of probing: an agent that thinks for twenty minutes
    /// while writing files is working, not stuck.
    pub fn note_git_activity(&self, worker_id: &str, fingerprint: &str) {
        self.note_git_activity_at(worker_id, fingerprint, Instant::now());
    }

    /// [`StatusEngine::note_git_activity`] with an explicit clock, for tests.
    pub fn note_git_activity_at(&self, worker_id: &str, fingerprint: &str, at: Instant) {
        self.update(worker_id, |state| {
            let first = state.git_fingerprint.is_none();
            if first {
                // The first probe of a run is the baseline, not a change: the
                // worktree was already whatever it was when the agent started.
                state.spawn_fingerprint = Some(fingerprint.to_string());
                state.git_since = Some(at);
            } else if state.git_fingerprint.as_deref() != Some(fingerprint) {
                state.last_git_change = Some(at);
                state.stuck = None;
            }
            state.git_fingerprint = Some(fingerprint.to_string());
        });
    }

    /// The column this worker is in right now, as a caller outside the engine
    /// sees it. Used by the exit note, which has to know what the agent was
    /// doing before it went away.
    pub fn column_of(&self, worker_id: &str) -> Option<String> {
        let workers = recover(&self.workers);
        let state = workers.get(worker_id)?;
        Some(state.derive().column.to_string())
    }

    /// This worker's git fingerprints as `(at spawn, now)`. Both are `None`
    /// until the probe has run at least once.
    pub fn git_fingerprints(&self, worker_id: &str) -> (Option<String>, Option<String>) {
        let workers = recover(&self.workers);
        let Some(state) = workers.get(worker_id) else {
            return (None, None);
        };
        (
            state.spawn_fingerprint.clone(),
            state.git_fingerprint.clone(),
        )
    }

    /// The task prompt remained silent through all synthetic Enter retries.
    /// This is a stronger and more specific signal than the ordinary idle
    /// heuristic, and stays until output, exit, or archive changes the facts.
    pub fn note_submit_guard_failed(&self, worker_id: &str) {
        self.update(worker_id, |state| {
            if state.status == STATUS_RUNNING {
                state.submit_guard =
                    Some(Verdict::coded(COL_NEEDS_YOU, ReasonCode::DeliveryFailed));
            }
        });
    }

    /// A blocking decision is waiting for the human (Phase 21).
    ///
    /// `reason` ist der Beleg - "Entscheidung wartet: ..." -, gepraegt in
    /// [`crate::questions`], das die Frage kennt. Der Code und damit der
    /// naechste Schritt gehoeren hierher: welche Frage es ist, weiss die
    /// Frage; dass sie im Fragen-Tab beantwortet wird, weiss die Engine.
    pub fn note_question(&self, worker_id: &str, reason: &str) {
        self.update(worker_id, |state| {
            state.question = Some(Verdict::coded_with(
                COL_NEEDS_YOU,
                ReasonCode::DecisionPending,
                reason,
            ));
        });
    }

    /// The decision has been made - by the human, by the clock or by the
    /// budget rule. The card goes back to whatever the other sources say.
    ///
    /// Called once per question that closes, and the last question standing is
    /// what the card shows: [`crate::questions`] only clears the attention
    /// when the worker has no open question left, so answering one of three
    /// does not clear the board.
    pub fn clear_question(&self, worker_id: &str) {
        self.update(worker_id, |state| state.question = None);
    }

    /// Pin a worker's profile without a database row.
    ///
    /// [`StatusEngine::observe_worker`] is how the app fills this in, and it
    /// needs a [`Worker`]; a test that only cares which profile a `statusLine`
    /// payload belongs to should not have to build one.
    #[cfg(test)]
    pub fn set_profile_for_test(&self, worker_id: &str, profile_id: &str) {
        self.update(worker_id, |state| {
            state.profile_id = profile_id.to_string();
        });
    }

    /// Alle Gruende, die an einem Worker anliegen, nach Blockadegrad sortiert.
    ///
    /// `#[cfg(test)]`, weil es heute noch keinen Konsumenten gibt: die Engine
    /// selbst publiziert daraus nur das oberste Signal, und `blockers[]` baut
    /// erst F4. Der Konstruktor steht trotzdem hier und nicht erst dort, weil
    /// sonst jeder Slot bis dahin weiter nur den spaltengewinnenden Grund
    /// aufheben wuerde - und die weggeworfenen waeren nicht nachreichbar.
    #[cfg(test)]
    pub fn signals_for(&self, worker_id: &str) -> Vec<Signal> {
        recover(&self.workers)
            .get(worker_id)
            .map(WorkerState::signals)
            .unwrap_or_default()
    }

    /// The context figure last seen for one worker.
    ///
    /// The app reads it off the board, where it arrives with everything else
    /// about the worker; this is only ever needed to assert on one in isolation.
    #[cfg(test)]
    pub fn context_usage(&self, worker_id: &str) -> Option<ContextUsage> {
        recover(&self.workers).get(worker_id)?.context_usage
    }

    /// Feed a hook event reported by the agent itself.
    ///
    /// `Stop` and `SubagentStop` clear the hook verdict rather than setting one:
    /// the agent finished its turn and has no opinion about what happens next.
    pub fn note_hook(&self, worker_id: &str, event: &str, message: Option<&str>) {
        let message = message.map(str::trim).filter(|m| !m.is_empty());
        let verdict = match event {
            "SessionStart" => Some(Verdict::plain(COL_WORKING)),
            // Die Meldung des Agenten ist der Beleg, nicht der Grund: sie sagt
            // *was* er meldet, der Code sagt, was das fuer den Menschen heisst.
            "Notification" => Some(match message {
                Some(detail) => {
                    Verdict::coded_with(COL_NEEDS_YOU, ReasonCode::AgentReported, detail)
                }
                None => Verdict::coded(COL_NEEDS_YOU, ReasonCode::AgentReported),
            }),
            "PermissionRequest" => Some(match message {
                Some(detail) => {
                    Verdict::coded_with(COL_NEEDS_YOU, ReasonCode::ApprovalRequired, detail)
                }
                None => Verdict::coded(COL_NEEDS_YOU, ReasonCode::ApprovalRequired),
            }),
            "Stop" | "SubagentStop" => None,
            // An event we do not model must not silently reset the board.
            _ => return,
        };
        self.update(worker_id, |state| {
            state.override_column = None;
            state.hook = verdict;
        });
    }

    /// Feed what GitHub says about the worker's branch. `None` means there is
    /// no pull request (any more).
    pub fn note_gh(&self, worker_id: &str, verdict: Option<Verdict>, pr_url: Option<String>) {
        self.update(worker_id, |state| {
            if state.gh != verdict || state.pr_url != pr_url {
                state.override_column = None;
            }
            state.gh = verdict;
            state.pr_url = pr_url;
        });
    }

    /// Pin a worker to a column by hand. `None` clears the pin; so does the
    /// next definitive signal - a hook event, a strong heuristic, a change in
    /// the pull request, or the worker being archived.
    pub fn set_override(&self, worker_id: &str, column: Option<&str>) -> Result<(), String> {
        let column = match column {
            Some(name) => {
                Some(column_const(name).ok_or_else(|| format!("unknown board column: {name}"))?)
            }
            None => None,
        };
        self.update(worker_id, |state| state.override_column = column);
        Ok(())
    }

    /// Mark workers that have gone quiet. Called on a timer by the app.
    pub fn tick(&self) {
        self.tick_at(Instant::now());
    }

    /// [`StatusEngine::tick`] with an explicit clock, for tests.
    pub fn tick_at(&self, now: Instant) {
        let ids: Vec<String> = recover(&self.workers).keys().cloned().collect();
        let idle_after = self.idle_after;
        let stuck_after = *recover(&self.stuck_after);
        for id in ids {
            self.update(&id, |state| {
                if state.status != STATUS_RUNNING {
                    return;
                }
                let quiet_for = |since: Option<Instant>, threshold: Duration| {
                    since.is_some_and(|last| now.saturating_duration_since(last) >= threshold)
                };
                let quiet = quiet_for(state.last_output, idle_after);
                // A prompt that has been sitting there for a minute is still a
                // prompt, and says more than "quiet".
                let strong = state
                    .heuristic
                    .as_ref()
                    .is_some_and(Heuristic::is_definitive);
                if quiet && !strong {
                    state.heuristic = Some(Heuristic::Idle);
                }

                // Stuck is the *conjunction*: the terminal has printed nothing
                // and the worktree has not moved either, both for longer than
                // the threshold. Either one alone is an agent doing something -
                // reading and thinking prints nothing, and a long build prints
                // plenty while touching no file.
                //
                // The worktree clock is the last change, or the first probe of
                // this run where nothing has changed yet: an agent that has
                // been running for two minutes cannot have been quiet for ten,
                // whatever its files look like.
                let git_quiet = quiet_for(state.last_git_change.or(state.git_since), stuck_after);
                if quiet_for(state.last_output, stuck_after) && git_quiet && !strong {
                    state.stuck = Some(Verdict::coded_with(
                        COL_NEEDS_YOU,
                        ReasonCode::AgentStalled,
                        &stuck_reason(stuck_after, &state.tail),
                    ));
                }
            });
        }
    }

    /// The current verdict for one worker, without touching anything.
    ///
    /// The app reads the board through [`StatusEngine::board`] and hears about
    /// changes through the sink, so this is only ever needed to assert on one
    /// worker in isolation.
    #[cfg(test)]
    pub fn verdict_for(&self, worker_id: &str) -> Verdict {
        recover(&self.workers)
            .get(worker_id)
            .map_or_else(|| Verdict::plain(COL_WORKING), WorkerState::derive)
    }

    /// Build the board: refresh every worker from its row, then read back the
    /// verdicts. Refreshing publishes, so a `get_board_state` after a restart
    /// still tells the frontend where everything landed.
    ///
    /// `controlled_by` is resolved against the very same slice. For
    /// `get_board_state` that slice is the whole project list, so every badge
    /// that can be resolved is. `ApiBackend::worker_state` however calls this
    /// with a single worker, and there the badge is always `None` because the
    /// coordinator is simply not in the slice. That is accepted - `pa worker
    /// status` shows no badges - but it should not happen silently.
    pub fn board(&self, workers: &[Worker]) -> Vec<WorkerBoardState> {
        for worker in workers {
            self.observe_worker(worker);
        }
        let states = recover(&self.workers);
        workers
            .iter()
            .map(|worker| {
                let state = states.get(&worker.id);
                let verdict =
                    state.map_or_else(|| Verdict::plain(COL_WORKING), WorkerState::derive);
                let attention = state.and_then(WorkerState::attention);
                let attention_observed_at = attention.as_ref().and_then(|signal| {
                    state.and_then(|state| match state.attention_since {
                        Some((code, observed_at)) if code == signal.code => Some(observed_at),
                        _ => None,
                    })
                });
                let pr_url = state
                    .and_then(|s| s.pr_url.clone())
                    .or_else(|| worker.pr_url.clone());
                WorkerBoardState {
                    column: verdict.column.to_string(),
                    attention_reason: verdict.reason,
                    attention_code: attention.as_ref().map(|signal| signal.code.code()),
                    attention_grade: attention.as_ref().map(Signal::grade),
                    attention_observed_at,
                    pr_url,
                    context_usage: state.and_then(|s| s.context_usage),
                    controlled_by: controlled_by(worker, workers),
                    test_status: worker.test_status.clone(),
                    tested_at: worker.tested_at,
                    worker: worker.clone(),
                }
            })
            .collect()
    }

    /// Record a Claude Code `statusLine` payload for one worker.
    ///
    /// Older Claude builds that do not send `rate_limits` are logged once and
    /// ignored; nothing else here changes a board column.
    pub fn note_statusline(&self, worker_id: &str, payload: &str) {
        self.note_statusline_at(worker_id, payload, statusline_now());
    }

    /// [`StatusEngine::note_statusline`] with an explicit observation time.
    ///
    /// The stamp is what [`crate::budget`] compares one measurement against the
    /// next with, and `statusLine` payloads arrive far more often than once a
    /// second - so a test that needs two distinguishable observations cannot
    /// get them from the clock.
    pub fn note_statusline_at(&self, worker_id: &str, payload: &str, observed_at: i64) {
        let Some(usage) = parse_statusline(payload, observed_at) else {
            return;
        };
        let mut workers = recover(&self.workers);
        let state = workers.entry(worker_id.to_string()).or_default();
        // A newer self-report may lower the number, never the evidence: within
        // one window the percentage is a consumption counter and only goes up,
        // so a drop without a window rollover is the watched agent rewriting
        // the figure its own budget stop reads. Keep the higher one.
        state.statusline = Some(match state.statusline.take() {
            Some(previous) => merge_statusline(previous, usage),
            None => usage,
        });
    }

    /// The freshest `statusLine` usage for a provider across all known workers.
    pub fn provider_usage(&self, provider_id: &str) -> Option<StatusLineUsage> {
        let workers = recover(&self.workers);
        workers
            .values()
            .filter(|state| state.profile_id == provider_id)
            .filter_map(|state| state.statusline.as_ref())
            .max_by_key(|usage| usage.observed_at)
            .cloned()
    }
}

/// Fold a new observation into the previous one.
///
/// Everything but the rate windows is a plain freshest-wins: the context
/// breakdown, the model, the observation time. The windows are the one field
/// the watched agent can use against itself - the budget stop reads them - so
/// they fold by [`merge_window`] instead.
fn merge_statusline(previous: StatusLineUsage, incoming: StatusLineUsage) -> StatusLineUsage {
    let five_hour = merge_window(previous.five_hour, incoming.five_hour);
    let seven_day = merge_window(previous.seven_day, incoming.seven_day);
    let percent = five_hour
        .and_then(|window| window.percent)
        .or_else(|| seven_day.and_then(|window| window.percent));
    let resets_at = five_hour
        .and_then(|window| window.resets_at)
        .or_else(|| seven_day.and_then(|window| window.resets_at));
    let window_label = if five_hour.is_some() {
        "5-Stunden-Fenster".to_string()
    } else if seven_day.is_some() {
        "7-Tage-Fenster".to_string()
    } else {
        "Statusline".to_string()
    };
    StatusLineUsage {
        percent,
        used: incoming.used,
        limit: incoming.limit,
        window_label,
        resets_at,
        five_hour,
        seven_day,
        observed_at: incoming.observed_at,
    }
}

/// One window of two observations, folded.
///
/// `resets_at` names the window. A different one means the window rolled over
/// and the counter legitimately starts from zero, so the new figure wins.
/// The same one means the percentage can only have grown: a smaller report is
/// not a measurement, it is the watched agent talking its budget back down -
/// the higher figure stays. A missing figure never erases a measured one.
fn merge_window(
    previous: Option<RateWindowUsage>,
    incoming: Option<RateWindowUsage>,
) -> Option<RateWindowUsage> {
    match (previous, incoming) {
        (Some(old), Some(new)) if old.resets_at == new.resets_at => Some(RateWindowUsage {
            percent: match (old.percent, new.percent) {
                (Some(a), Some(b)) => Some(a.max(b)),
                (a, b) => a.or(b),
            },
            resets_at: new.resets_at,
        }),
        (_, incoming) => incoming,
    }
}

/// A timestamp the parser can sort by without reaching for `Instant`.
fn statusline_now() -> i64 {
    now_unix_secs()
}

/// The raw shape Claude Code sends on its `statusLine` hook.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
struct StatusLinePayload {
    rate_limits: Option<RateLimits>,
    context_window: Option<ContextWindow>,
    model: Option<ModelInfo>,
}

#[derive(Debug, Default, Deserialize)]
struct RateLimits {
    five_hour: Option<RateWindow>,
    seven_day: Option<RateWindow>,
}

#[derive(Debug, Default, Deserialize)]
struct RateWindow {
    // `f64`, not `u8`: a figure outside the byte range (a 300 % the provider
    // never meant) must cost that figure alone, not the whole payload - serde
    // would reject the document over one out-of-range number otherwise.
    used_percentage: Option<f64>,
    resets_at: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
struct ContextWindow {
    context_window_size: Option<f64>,
    current_usage: Option<CurrentUsage>,
    used_percentage: Option<f64>,
    remaining_percentage: Option<f64>,
}

/// The token breakdown behind `context_window.current_usage`. Every field is
/// optional; a type mismatch in any one of them must not cost the rest of the
/// payload, so the whole struct stays tolerant.
#[derive(Debug, Default, Deserialize)]
struct CurrentUsage {
    input_tokens: Option<f64>,
    cache_creation_input_tokens: Option<f64>,
    cache_read_input_tokens: Option<f64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
struct ModelInfo {
    display_name: Option<String>,
}

/// Set after the first "rate_limits missing" payload; prevents log spam.
static STATUSLINE_NO_RATELIMITS_LOGGED: AtomicBool = AtomicBool::new(false);

/// Parse a `statusLine` JSON payload into an internal usage snapshot.
///
/// Returns `None` when the payload is not readable or when it comes from an
/// older Claude build that omits `rate_limits`. The missing-ratelimits case is
/// logged exactly once per process.
fn parse_statusline(payload: &str, observed_at: i64) -> Option<StatusLineUsage> {
    let payload: StatusLinePayload = serde_json::from_str(payload).ok()?;

    let Some(rate_limits) = payload.rate_limits else {
        if !STATUSLINE_NO_RATELIMITS_LOGGED.swap(true, Ordering::Relaxed) {
            eprintln!(
                "projecta: Claude statusLine payload has no rate_limits; \
                 ignoring usage until the build supports it"
            );
        }
        return None;
    };

    let primary = rate_limits.five_hour.as_ref();
    let fallback = rate_limits.seven_day.as_ref();

    let percent = primary
        .and_then(|w| sane_percent(w.used_percentage))
        .or_else(|| fallback.and_then(|w| sane_percent(w.used_percentage)));
    let resets_at = primary
        .and_then(|w| w.resets_at)
        .or_else(|| fallback.and_then(|w| w.resets_at));

    let window_label = if primary.is_some() {
        "5-Stunden-Fenster".to_string()
    } else if fallback.is_some() {
        "7-Tage-Fenster".to_string()
    } else {
        "Statusline".to_string()
    };

    let (used, limit) = context_window_usage(payload.context_window.as_ref());

    Some(StatusLineUsage {
        percent,
        used,
        limit,
        window_label,
        resets_at,
        five_hour: primary.map(window_usage),
        seven_day: fallback.map(window_usage),
        observed_at,
    })
}

/// A parsed window, with an out-of-range percentage dropped the same way the
/// headline figure drops it: 143 % is a payload this app does not understand,
/// and acting on it would block a profile for a typo.
fn window_usage(window: &RateWindow) -> RateWindowUsage {
    RateWindowUsage {
        percent: sane_percent(window.used_percentage),
        resets_at: window.resets_at,
    }
}

/// A percentage a foreign payload reported, or `None` when it is not one.
///
/// The valid range is 0 to 100 inclusive; anything outside it - a 300 %, a
/// negative, a NaN - is dropped as a figure, while the rest of the payload it
/// rode in on keeps its say.
fn sane_percent(raw: Option<f64>) -> Option<u8> {
    raw.filter(|p| p.is_finite() && (0.0..=100.0).contains(p))
        .map(|p| p as u8)
}

fn context_window_usage(window: Option<&ContextWindow>) -> (Option<String>, Option<String>) {
    let Some(window) = window else {
        return (None, None);
    };
    // Used is the sum over whatever token fields arrived; an object with no
    // usable number at all says nothing rather than reporting a zero.
    let used = window.current_usage.as_ref().and_then(|usage| {
        [
            usage.input_tokens,
            usage.cache_creation_input_tokens,
            usage.cache_read_input_tokens,
        ]
        .into_iter()
        .flatten()
        .filter(|value| value.is_finite() && *value >= 0.0)
        .reduce(|sum, value| sum + value)
        .and_then(format_tokens)
    });
    let limit = window.context_window_size.and_then(format_tokens);
    (used, limit)
}

/// Render a token count for display, e.g. "999 Tokens" or "1,0 M Tokens".
/// `None` if the value is not finite or below -0.5, i.e. would render with
/// a minus sign; anything in `[-0.5, 0]` shows as "0 Tokens", never
/// "-0 Tokens".
fn format_tokens(value: f64) -> Option<String> {
    // `{:.0}` renders -0.0 and every negative down to -0.5 (a tie rounds to
    // even) as "-0"; they are zero, not a negative count.
    let value = if (-0.5..=0.0).contains(&value) {
        0.0
    } else {
        value
    };
    if !value.is_finite() || value < 0.0 {
        return None;
    }
    // The unit is picked *after* rounding, so 999_999.0 cannot render as
    // "1000,0 k Tokens": the first unit whose rounded digits stay below 1000
    // wins. The digits that pass that check are the digits shown, so the
    // check and the display cannot round differently. G is the largest unit
    // and keeps whatever it rounds to.
    const UNITS: [(f64, &str, usize); 4] = [
        (1.0, "", 0),
        (1_000.0, " k", 1),
        (1_000_000.0, " M", 1),
        (1_000_000_000.0, " G", 1),
    ];
    let mut digits = String::new();
    let mut unit = "";
    for (scale, name, precision) in UNITS {
        digits = format!("{:.*}", precision, value / scale);
        unit = name;
        if digits.parse::<f64>().is_ok_and(|rounded| rounded < 1000.0) {
            break;
        }
    }
    Some(format!("{}{} Tokens", digits.replace('.', ","), unit))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::now_unix_secs;

    /// Representative Claude Code output samples.
    mod samples {
        /// A tool call and its result: nothing to see here.
        pub const ACTIVITY: &str = "\u{1b}[32m\u{25cf}\u{1b}[0m Read(src/main.rs)\r\n  \u{2514} Read 264 lines\r\n\u{1b}[2m  Editing store.rs\u{1b}[0m\r\n";

        /// The permission box, drawn with box characters and an arrow cursor.
        pub const PERMISSION: &str = "\u{1b}[1mEdit file\u{1b}[0m\r\n\u{2502} src-tauri/src/status.rs\r\n\u{2502}\r\nDo you want to make this edit to status.rs?\r\n\u{1b}[36m\u{276f} 1. Yes\u{1b}[0m\r\n  2. Yes, and don't ask again\r\n  3. No, and tell Claude what to do differently\r\n";

        /// A generic approval prompt from a non-Claude agent.
        pub const GENERIC_PROMPT: &str =
            "About to run: rm -rf build/\nDo you want to proceed? (y/N) ";

        /// Out of credit.
        pub const QUOTA_CREDIT: &str =
            "API Error: Your credit balance is too low to access the Anthropic API.\r\n";

        /// Weekly limit.
        pub const QUOTA_LIMIT: &str =
            "Claude usage limit reached. Your limit will reset at 3pm (Europe/Berlin).\r\n";

        /// HTTP rate limiting from a generic agent.
        pub const QUOTA_429: &str = "request failed: status 429 (rate limit), retrying in 30s\n";

        /// An OpenAI-shaped error body.
        pub const QUOTA_INSUFFICIENT: &str =
            "{\"error\":{\"code\":\"insufficient_quota\",\"message\":\"exceeded your quota\"}}\n";

        /// The Claude Code status line, redrawn in place with a carriage return.
        pub const STATUS_LINE: &str =
            "\r\u{1b}[2m Ctx: 137.0k/1000.0k tok (14% used)  claude-opus-5\u{1b}[0m";

        /// Kimi Code 0.38.0: the plan-approval prompt, raw as captured by
        /// `testutil::capture_kimi_output`. Kimi starts in plan mode, so this
        /// is the first thing a worker waits on.
        pub const KIMI_PLAN_APPROVAL: &str = "   \u{25b6} Ready to build with this plan?\u{1b}[K\r\n\u{1b}[K\r\n   \u{25b6} 1. Approve\u{1b}[K\r\n     2. Reject\u{1b}[K\r\n     3. Revise\u{1b}[K\r\n\u{1b}[K\u{1b}[120C\r\n   \u{2191}/\u{2193} select \u{b7} 1/2/3 choose \u{b7} \u{21b5} confirm\u{1b}[80C\r\n";

        /// Kimi Code 0.38.0: the write-tool permission prompt, raw as captured
        /// by `testutil::capture_kimi_output` after the plan was approved.
        pub const KIMI_PERMISSION: &str = "   \u{25b6} Write this file?\u{1b}[K\r\n\u{1b}[K\r\n   C:/Users/user1/AppData/Local/Temp/projecta-capture-27488/notes.txt\u{1b}[K\r\n      1  Notizen\u{1b}[K\r\n      2\u{1b}[K\r\n\u{1b}[K\u{1b}[120C\r\n   \u{25b6} 1. Approve once\u{1b}[100C\r\n     2. Approve for this session\u{1b}[88C\r\n     3. Reject\u{1b}[106C\r\n     4. Reject with feedback\u{1b}[92C\r\n\u{1b}[120C\r\n   \u{2191}/\u{2193} select \u{b7} 1/2/3/4 choose \u{b7} \u{21b5} confirm \u{b7} ctrl+e preview\u{1b}[61C\r\n";
    }

    #[derive(Default)]
    struct Recorder {
        published: Mutex<Vec<StatusPayload>>,
    }

    impl Recorder {
        fn columns(&self) -> Vec<String> {
            self.published
                .lock()
                .unwrap()
                .iter()
                .map(|p| p.column.clone())
                .collect()
        }

        fn last(&self) -> Option<StatusPayload> {
            self.published.lock().unwrap().last().cloned()
        }
    }

    impl StatusSink for Recorder {
        fn publish(&self, payload: StatusPayload) {
            self.published.lock().unwrap().push(payload);
        }
    }

    fn worker(id: &str, status: &str) -> Worker {
        Worker {
            id: id.to_string(),
            project_id: "pj-1".to_string(),
            task: "do the thing".to_string(),
            profile_id: "claude".to_string(),
            branch: format!("pa/{id}"),
            worktree_path: format!("C:/tmp/.projecta-worktrees/{id}"),
            session_id: None,
            status: status.to_string(),
            kind: crate::store::KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            paused_reason: None,
            created_at: now_unix_secs(),
        }
    }

    #[test]
    fn an_agents_newer_self_report_cannot_hide_an_exhausted_budget_window() {
        let engine = StatusEngine::default();
        engine.observe_worker(&worker("wk-budget", STATUS_RUNNING));
        engine.note_statusline_at(
            "wk-budget",
            r#"{"rate_limits":{"five_hour":{"used_percentage":93,"resets_at":9000}}}"#,
            100,
        );
        engine.note_statusline_at(
            "wk-budget",
            r#"{"rate_limits":{"five_hour":{"used_percentage":1,"resets_at":9000}}}"#,
            101,
        );

        let usage = engine.provider_usage("claude").expect("provider usage");
        assert_eq!(
            usage.five_hour.and_then(|window| window.percent),
            Some(93),
            "a worker must not be able to replace the budget evidence that governs it"
        );
    }

    /// Panic while holding the worker registry, the way a bug in any `edit`
    /// closure passed to `update` would.
    fn poison_workers(engine: &StatusEngine) {
        std::thread::scope(|scope| {
            let _ = scope
                .spawn(|| {
                    let _guard = engine.workers.lock().unwrap();
                    panic!("poison worker registry fixture");
                })
                .join();
        });
        assert!(engine.workers.is_poisoned());
    }

    /// Under poison the budget stop must still see the usage it gates on:
    /// before W1-15b `update`, `note_statusline_at` and `provider_usage` each
    /// dropped out silently, and a profile past its limit read as "no data".
    #[test]
    fn poisoned_workers_still_record_and_report_budget_usage() {
        let engine = StatusEngine::default();
        poison_workers(&engine);
        engine.observe_worker(&worker("wk-budget", STATUS_RUNNING));
        engine.note_statusline_at(
            "wk-budget",
            r#"{"rate_limits":{"five_hour":{"used_percentage":93,"resets_at":9000}}}"#,
            100,
        );

        // Poison is sticky: every call above and the read below ran on a
        // poisoned lock, not on one the first recovery had cleared.
        assert!(engine.workers.is_poisoned());
        let usage = engine.provider_usage("claude");
        assert_eq!(
            usage
                .and_then(|usage| usage.five_hour)
                .and_then(|window| window.percent),
            Some(93),
            "a poisoned registry must not hide an exhausted budget window"
        );
    }

    /// The idle timer used to skip every worker under poison, so a silent
    /// RUNNING worker never reached `needs_you`.
    #[test]
    fn poisoned_workers_still_go_idle_on_tick() {
        let (engine, _recorder) = engine_with_worker();
        let start = Instant::now();
        engine.note_output_at("wk-1", samples::ACTIVITY, start);
        poison_workers(&engine);

        engine.tick_at(start + IDLE_AFTER);
        assert_eq!(engine.column_of("wk-1").as_deref(), Some(COL_NEEDS_YOU));
    }

    /// Forgetting a worker is the engine's reaper: under poison it used to
    /// leave the row behind for good, like `pty.rs::cancel_reservation` did.
    #[test]
    fn poisoned_workers_still_forget_a_worker() {
        let engine = StatusEngine::default();
        engine.observe_worker(&worker("wk-gone", STATUS_RUNNING));
        poison_workers(&engine);

        engine.forget_worker("wk-gone");
        let workers = engine
            .workers
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        assert!(!workers.contains_key("wk-gone"));
    }

    /// The board reads every column through one lock; under poison it showed
    /// each worker in the default column whatever its real state.
    #[test]
    fn poisoned_workers_still_show_their_column_on_the_board() {
        let (engine, _recorder) = engine_with_worker();
        let start = Instant::now();
        engine.note_output_at("wk-1", samples::ACTIVITY, start);
        engine.tick_at(start + IDLE_AFTER);
        poison_workers(&engine);

        let board = engine.board(&[worker("wk-1", STATUS_RUNNING)]);
        assert_eq!(board[0].column, COL_NEEDS_YOU);
    }

    /// The dialect a default profile ships with - the tests prove the move
    /// from compiled-in constants to data was lossless by running the same
    /// fixtures through the data.
    fn dialect_of(id: &str) -> Dialect {
        crate::profiles::default_profiles()
            .into_iter()
            .find(|p| p.id == id)
            .expect("known default profile")
            .caps
            .dialect
    }

    /// An engine with a worker already registered as a running claude agent,
    /// with the default profiles' dialects installed.
    fn engine_with_worker() -> (StatusEngine, Arc<Recorder>) {
        let engine = StatusEngine::new(IDLE_AFTER);
        engine.set_dialects(
            crate::profiles::default_profiles()
                .into_iter()
                .map(|p| (p.id, p.caps.dialect))
                .collect(),
        );
        let recorder = Arc::new(Recorder::default());
        engine.set_sink(recorder.clone());
        engine.observe_worker(&worker("wk-1", STATUS_RUNNING));
        (engine, recorder)
    }

    // -- the classifier ----------------------------------------------------

    #[test]
    fn normal_activity_is_not_an_alarm() {
        assert_eq!(
            classify_output(&dialect_of("claude"), samples::ACTIVITY),
            Some(Heuristic::Activity)
        );
        assert_eq!(
            classify_output(&Dialect::default(), samples::ACTIVITY),
            Some(Heuristic::Activity)
        );
    }

    #[test]
    fn permission_prompts_are_detected() {
        assert_eq!(
            classify_output(&dialect_of("claude"), samples::PERMISSION),
            Some(Heuristic::Permission)
        );
        // The generic set carries the common shapes for every other profile.
        assert_eq!(
            classify_output(&dialect_of("kimi"), samples::GENERIC_PROMPT),
            Some(Heuristic::Permission)
        );
        assert_eq!(
            classify_output(&dialect_of("claude"), samples::GENERIC_PROMPT),
            Some(Heuristic::Permission)
        );
    }

    #[test]
    fn claude_only_patterns_do_not_fire_for_other_profiles() {
        // "credit balance" is a Claude wording; a generic agent printing it in
        // passing must not be classified as blocked.
        assert_eq!(
            classify_output(&dialect_of("claude"), samples::QUOTA_CREDIT),
            Some(Heuristic::Quota)
        );
        assert_eq!(
            classify_output(&dialect_of("kimi"), samples::QUOTA_CREDIT),
            Some(Heuristic::Activity)
        );
    }

    #[test]
    fn quota_and_rate_limit_errors_are_detected() {
        assert_eq!(
            classify_output(&dialect_of("claude"), samples::QUOTA_LIMIT),
            Some(Heuristic::Quota)
        );
        assert_eq!(
            classify_output(&dialect_of("kimi"), samples::QUOTA_429),
            Some(Heuristic::Quota)
        );
    }

    #[test]
    fn claude_weekly_limit_incident_is_detected_as_quota() {
        let incident = "You've hit your weekly limit · resets Sep 9, 4am (UTC)";
        assert_eq!(
            classify_output(&dialect_of("claude"), incident),
            Some(Heuristic::Quota)
        );
        assert_eq!(
            quota_line(&dialect_of("claude"), incident).as_deref(),
            Some(incident)
        );
    }

    #[test]
    fn an_error_outranks_a_prompt_still_on_screen() {
        let tail = format!("{}{}", samples::PERMISSION, samples::QUOTA_LIMIT);
        assert_eq!(
            classify_output(&dialect_of("claude"), &tail),
            Some(Heuristic::Quota)
        );
    }

    #[test]
    fn empty_output_says_nothing() {
        assert_eq!(classify_output(&dialect_of("claude"), ""), None);
        assert_eq!(
            classify_output(&dialect_of("claude"), "\u{1b}[2J\u{1b}[H  \r\n"),
            None
        );
    }

    #[test]
    fn ansi_sequences_are_stripped_before_matching() {
        // A prompt cut in half by a colour change still reads as one sentence.
        let raw = "Do you want \u{1b}[1;33mto proceed\u{1b}[0m?";
        assert_eq!(strip_ansi(raw), "Do you want to proceed?");
        assert_eq!(
            classify_output(&dialect_of("kimi"), raw),
            Some(Heuristic::Permission),
            "colour codes hid the prompt"
        );
        // OSC title sequences and bare two-character escapes disappear too.
        assert_eq!(strip_ansi("a\u{1b}]0;title\u{7}b\u{1b}=c"), "abc");
    }

    #[test]
    fn an_empty_dialect_is_exactly_the_generic_set() {
        let empty = Dialect::default();
        // GENERIC still catches its own patterns...
        assert_eq!(
            classify_output(&empty, samples::GENERIC_PROMPT),
            Some(Heuristic::Permission)
        );
        // ...but claude-only shapes are plain activity without claude's dialect.
        assert_eq!(
            classify_output(&empty, samples::PERMISSION),
            Some(Heuristic::Activity)
        );
    }

    #[test]
    fn dialects_do_not_bleed_into_each_other() {
        // Claude's permission box through kimi's dialect: GENERIC has no match
        // in it, and kimi's own patterns must not accidentally cover claude's UI.
        assert_eq!(
            classify_output(&dialect_of("kimi"), samples::PERMISSION),
            Some(Heuristic::Activity)
        );
    }

    #[test]
    fn kimi_permission_prompt_is_detected_through_its_dialect() {
        assert_eq!(
            classify_output(&dialect_of("kimi"), samples::KIMI_PERMISSION),
            Some(Heuristic::Permission)
        );
        // Kimi starts in plan mode; its plan-approval prompt is the same
        // question in other words and must classify the same way.
        assert_eq!(
            classify_output(&dialect_of("kimi"), samples::KIMI_PLAN_APPROVAL),
            Some(Heuristic::Permission)
        );
        // And without the dialect it is plain activity - the dialect earns its keep.
        assert_eq!(
            classify_output(&Dialect::default(), samples::KIMI_PERMISSION),
            Some(Heuristic::Activity)
        );
    }

    // -- column derivation -------------------------------------------------

    #[test]
    fn a_fresh_worker_is_working() {
        let (engine, recorder) = engine_with_worker();
        assert_eq!(engine.verdict_for("wk-1"), Verdict::plain(COL_WORKING));
        assert_eq!(recorder.columns(), vec![COL_WORKING]);
    }

    #[test]
    fn a_permission_prompt_moves_the_worker_to_needs_you() {
        let (engine, recorder) = engine_with_worker();
        engine.note_output("wk-1", samples::PERMISSION);

        let verdict = engine.verdict_for("wk-1");
        assert_eq!(verdict.column, COL_NEEDS_YOU);
        assert_eq!(
            verdict.reason.as_deref(),
            Some("Der Agent wartet auf deine Freigabe — bestätige die Rückfrage im Terminal")
        );
        assert_eq!(recorder.columns(), vec![COL_WORKING, COL_NEEDS_YOU]);
    }

    #[test]
    fn an_exhausted_submit_guard_names_the_manual_enter_action() {
        let (engine, _recorder) = engine_with_worker();
        engine.note_submit_guard_failed("wk-1");

        let verdict = engine.verdict_for("wk-1");
        assert_eq!(verdict.column, COL_NEEDS_YOU);
        assert_eq!(
            verdict.reason.as_deref(),
            Some("Die Eingabe wurde nicht abgeschickt — drücke im Terminal von Hand Enter")
        );

        engine.note_output("wk-1", samples::ACTIVITY);
        assert_eq!(engine.verdict_for("wk-1").column, COL_WORKING);
    }

    #[test]
    fn a_quiet_terminal_becomes_needs_you_after_the_idle_window() {
        let (engine, _recorder) = engine_with_worker();
        let start = Instant::now();
        engine.note_output_at("wk-1", samples::ACTIVITY, start);
        assert_eq!(engine.verdict_for("wk-1").column, COL_WORKING);

        // Still inside the window: nothing changes.
        engine.tick_at(start + IDLE_AFTER - Duration::from_secs(1));
        assert_eq!(engine.verdict_for("wk-1").column, COL_WORKING);

        engine.tick_at(start + IDLE_AFTER);
        let verdict = engine.verdict_for("wk-1");
        assert_eq!(verdict.column, COL_NEEDS_YOU);
        assert_eq!(
            verdict.reason.as_deref(),
            Some("Der Agent wartet am Prompt — gib ihm im Terminal den nächsten Schritt")
        );
    }

    #[test]
    fn silence_on_both_channels_becomes_stuck_and_names_the_last_line() {
        let (engine, _recorder) = engine_with_worker();
        let start = Instant::now();
        engine.note_output_at("wk-1", "Reading src/main.rs\n", start);
        engine.note_git_activity_at("wk-1", "fp-1", start);

        // Idle first: that window is much shorter, and stuck has not come due.
        engine.tick_at(start + IDLE_AFTER);
        assert_eq!(
            engine.verdict_for("wk-1").reason.as_deref(),
            Some("Der Agent wartet am Prompt — gib ihm im Terminal den nächsten Schritt")
        );

        engine.tick_at(start + STUCK_AFTER - Duration::from_secs(1));
        assert_eq!(
            engine.verdict_for("wk-1").reason.as_deref(),
            Some("Der Agent wartet am Prompt — gib ihm im Terminal den nächsten Schritt"),
            "one second early is still only idle"
        );

        engine.tick_at(start + STUCK_AFTER);
        let verdict = engine.verdict_for("wk-1");
        assert_eq!(verdict.column, COL_NEEDS_YOU);
        let reason = verdict.reason.expect("a stuck card says why");
        assert!(reason.contains("seit mindestens 10 min"), "{reason}");
        assert!(reason.contains("Reading src/main.rs"), "{reason}");

        // Output ends it, and the clock starts over.
        engine.note_output_at("wk-1", "Writing src/main.rs\n", start + STUCK_AFTER);
        assert_eq!(engine.verdict_for("wk-1").column, COL_WORKING);
    }

    #[test]
    fn a_worker_writing_files_without_printing_is_not_stuck() {
        let (engine, _recorder) = engine_with_worker();
        let start = Instant::now();
        engine.note_output_at("wk-1", samples::ACTIVITY, start);
        engine.note_git_activity_at("wk-1", "fp-1", start);

        // Nine minutes of silence, then a file change: an agent that reads and
        // thinks for a long time is working, and the worktree proves it.
        engine.note_git_activity_at(
            "wk-1",
            "fp-2",
            start + STUCK_AFTER - Duration::from_secs(60),
        );
        engine.tick_at(start + STUCK_AFTER);
        assert_eq!(
            engine.verdict_for("wk-1").reason.as_deref(),
            Some("Der Agent wartet am Prompt — gib ihm im Terminal den nächsten Schritt"),
            "idle, yes - stuck, no"
        );

        // And the other way round: printing without touching a file is work too.
        let (engine, _recorder) = engine_with_worker();
        engine.note_git_activity_at("wk-1", "fp-1", start);
        engine.note_output_at("wk-1", samples::ACTIVITY, start + STUCK_AFTER);
        engine.tick_at(start + STUCK_AFTER + IDLE_AFTER);
        assert_eq!(
            engine.verdict_for("wk-1").reason.as_deref(),
            Some("Der Agent wartet am Prompt — gib ihm im Terminal den nächsten Schritt")
        );
    }

    #[test]
    fn a_worker_nobody_has_probed_yet_is_never_called_stuck() {
        let (engine, _recorder) = engine_with_worker();
        let start = Instant::now();
        engine.note_output_at("wk-1", samples::ACTIVITY, start);

        // No git observation at all: the probe may not be running, the
        // worktree may be gone. Either way there is no second channel to be
        // silent, so the verdict stays the one the terminal supports.
        engine.tick_at(start + STUCK_AFTER * 3);
        assert_eq!(
            engine.verdict_for("wk-1").reason.as_deref(),
            Some("Der Agent wartet am Prompt — gib ihm im Terminal den nächsten Schritt")
        );
    }

    #[test]
    fn a_stuck_card_yields_to_a_prompt_and_to_a_pull_request() {
        let start = Instant::now();

        // A permission prompt is a stronger and more specific answer.
        let (engine, _recorder) = engine_with_worker();
        engine.note_output_at("wk-1", samples::PERMISSION, start);
        engine.note_git_activity_at("wk-1", "fp-1", start);
        engine.tick_at(start + STUCK_AFTER * 2);
        assert_eq!(
            engine.verdict_for("wk-1").reason.as_deref(),
            Some("Der Agent wartet auf deine Freigabe — bestätige die Rückfrage im Terminal")
        );

        // An open pull request describes the branch better than the terminal.
        let (engine, _recorder) = engine_with_worker();
        engine.note_output_at("wk-1", samples::ACTIVITY, start);
        engine.note_git_activity_at("wk-1", "fp-1", start);
        engine.note_gh(
            "wk-1",
            Some(Verdict::with_reason(COL_IN_REVIEW, "pull request open")),
            None,
        );
        engine.tick_at(start + STUCK_AFTER * 2);
        assert_eq!(engine.verdict_for("wk-1").column, COL_IN_REVIEW);
    }

    #[test]
    fn the_stuck_threshold_is_configurable_but_never_below_idle() {
        let (engine, _recorder) = engine_with_worker();
        let start = Instant::now();
        engine.set_stuck_after(Duration::from_secs(120));
        engine.note_output_at("wk-1", samples::ACTIVITY, start);
        engine.note_git_activity_at("wk-1", "fp-1", start);

        engine.tick_at(start + Duration::from_secs(120));
        assert!(engine
            .verdict_for("wk-1")
            .reason
            .expect("reason")
            .contains("seit mindestens 2 min"));

        // A threshold at or below the idle window would only be a louder word
        // for the same silence, so it is ignored.
        let (engine, _recorder) = engine_with_worker();
        engine.set_stuck_after(IDLE_AFTER);
        engine.note_output_at("wk-1", samples::ACTIVITY, start);
        engine.note_git_activity_at("wk-1", "fp-1", start);
        engine.tick_at(start + IDLE_AFTER * 2);
        assert_eq!(
            engine.verdict_for("wk-1").reason.as_deref(),
            Some("Der Agent wartet am Prompt — gib ihm im Terminal den nächsten Schritt")
        );
    }

    #[test]
    fn a_restarted_agent_gets_a_fresh_git_baseline() {
        let (engine, _recorder) = engine_with_worker();
        engine.note_git_activity("wk-1", "fp-before");
        assert_eq!(
            engine.git_fingerprints("wk-1").0.as_deref(),
            Some("fp-before")
        );

        // Exited and respawned: the baseline the exit note compares against
        // belongs to the run, not to the worker.
        engine.observe_worker(&worker("wk-1", STATUS_EXITED));
        engine.observe_worker(&worker("wk-1", STATUS_RUNNING));
        assert_eq!(engine.git_fingerprints("wk-1"), (None, None));

        engine.note_git_activity("wk-1", "fp-after");
        assert_eq!(
            engine.git_fingerprints("wk-1"),
            (Some("fp-after".to_string()), Some("fp-after".to_string()))
        );
    }

    #[test]
    fn the_stuck_reason_reads_the_last_printable_line() {
        // Redraw noise around the real line: the escape sequences are dropped
        // rather than parsed, and the newest readable line wins.
        let tail = "erste Zeile\n\u{1b}[2K\u{1b}[1Gwriting tests\n\u{1b}[?25h\n";
        let reason = stuck_reason(Duration::from_secs(600), tail);
        assert!(reason.contains("(zuletzt: writing tests)"), "{reason}");
        assert!(reason.contains("seit mindestens 10 min"), "{reason}");

        // Nothing readable at all: the sentence stands on its own.
        let bare = stuck_reason(Duration::from_secs(600), "\u{1b}[2K\n  \n");
        assert!(!bare.contains("zuletzt"), "{bare}");

        // A very long line is cut rather than wrapped across the card.
        let long = format!("x{}", "y".repeat(200));
        let cut = stuck_reason(Duration::from_secs(600), &long);
        assert!(cut.contains('\u{2026}'), "{cut}");
        assert!(cut.chars().count() < 200, "{cut}");
    }

    #[test]
    fn going_quiet_does_not_overwrite_a_permission_prompt() {
        let (engine, _recorder) = engine_with_worker();
        let start = Instant::now();
        engine.note_output_at("wk-1", samples::PERMISSION, start);
        engine.tick_at(start + IDLE_AFTER * 4);

        // Still the prompt's reason, not the vaguer "waiting at the prompt".
        assert_eq!(
            engine.verdict_for("wk-1").reason.as_deref(),
            Some("Der Agent wartet auf deine Freigabe — bestätige die Rückfrage im Terminal")
        );
    }

    #[test]
    fn an_idle_worker_that_is_not_running_stays_put() {
        let (engine, _recorder) = engine_with_worker();
        let start = Instant::now();
        engine.note_output_at("wk-1", samples::ACTIVITY, start);
        engine.observe_worker(&worker("wk-1", STATUS_EXITED));

        engine.tick_at(start + IDLE_AFTER * 10);
        // `exited` outranks the weak heuristics, and says why.
        assert_eq!(
            engine.verdict_for("wk-1").reason.as_deref(),
            Some("Der Agent ist beendet — prüfe sein Ergebnis, dann neu starten oder archivieren")
        );
    }

    #[test]
    fn an_exited_worker_cannot_remain_working_because_of_a_stale_start_hook() {
        let (engine, _recorder) = engine_with_worker();
        engine.note_hook("wk-1", "SessionStart", None);
        engine.observe_worker(&worker("wk-1", STATUS_EXITED));

        assert_eq!(
            engine.verdict_for("wk-1"),
            Verdict::coded(COL_NEEDS_YOU, ReasonCode::AgentExited)
        );
    }

    #[test]
    fn archiving_a_worker_is_done() {
        let (engine, recorder) = engine_with_worker();
        engine.note_output("wk-1", samples::PERMISSION);
        engine.observe_worker(&worker("wk-1", STATUS_ARCHIVED));

        assert_eq!(engine.verdict_for("wk-1"), Verdict::plain(COL_DONE));
        assert_eq!(recorder.last().unwrap().column, COL_DONE);
    }

    #[test]
    fn hook_beats_heuristic_beats_gh() {
        let (engine, _recorder) = engine_with_worker();

        // gh alone: the branch is under review.
        engine.note_gh(
            "wk-1",
            Some(Verdict::with_reason(COL_IN_REVIEW, "pull request open")),
            Some("https://github.com/o/r/pull/7".to_string()),
        );
        assert_eq!(engine.verdict_for("wk-1").column, COL_IN_REVIEW);

        // A strong heuristic outranks it: only the user can clear a prompt.
        engine.note_output("wk-1", samples::PERMISSION);
        let verdict = engine.verdict_for("wk-1");
        assert_eq!(verdict.column, COL_NEEDS_YOU);
        assert_eq!(
            verdict.reason.as_deref(),
            Some("Der Agent wartet auf deine Freigabe — bestätige die Rückfrage im Terminal")
        );

        // And a hook outranks the heuristic, reason and all.
        engine.note_hook("wk-1", "Notification", Some("Claude needs your permission"));
        let verdict = engine.verdict_for("wk-1");
        assert_eq!(verdict.column, COL_NEEDS_YOU);
        assert_eq!(
            verdict.reason.as_deref(),
            Some("Claude needs your permission")
        );

        // A SessionStart hook still wins even though the prompt text is in the
        // scrollback: the agent's own word is the most recent truth.
        engine.note_hook("wk-1", "SessionStart", None);
        assert_eq!(engine.verdict_for("wk-1"), Verdict::plain(COL_WORKING));
    }

    #[test]
    fn a_stop_hook_hands_the_decision_back_to_the_other_sources() {
        let (engine, _recorder) = engine_with_worker();
        engine.note_gh(
            "wk-1",
            Some(Verdict::with_reason(COL_READY_TO_MERGE, "approved")),
            Some("https://github.com/o/r/pull/7".to_string()),
        );
        engine.note_hook("wk-1", "SessionStart", None);
        assert_eq!(engine.verdict_for("wk-1").column, COL_WORKING);

        engine.note_hook("wk-1", "Stop", None);
        assert_eq!(engine.verdict_for("wk-1").column, COL_READY_TO_MERGE);
    }

    #[test]
    fn an_unknown_hook_event_changes_nothing() {
        let (engine, _recorder) = engine_with_worker();
        engine.note_hook("wk-1", "Notification", Some("look at me"));
        engine.note_hook("wk-1", "PreToolUse", None);
        assert_eq!(
            engine.verdict_for("wk-1").reason.as_deref(),
            Some("look at me")
        );
    }

    #[test]
    fn a_pull_request_describes_a_quiet_worker_better_than_the_idle_timer() {
        let (engine, _recorder) = engine_with_worker();
        let start = Instant::now();
        engine.note_output_at("wk-1", samples::ACTIVITY, start);
        engine.note_gh(
            "wk-1",
            Some(Verdict::with_reason(COL_IN_REVIEW, "pull request open")),
            Some("https://github.com/o/r/pull/7".to_string()),
        );

        engine.tick_at(start + IDLE_AFTER * 2);
        assert_eq!(engine.verdict_for("wk-1").column, COL_IN_REVIEW);
    }

    // -- manual override ---------------------------------------------------

    #[test]
    fn a_manual_override_wins_until_a_definitive_signal() {
        let (engine, _recorder) = engine_with_worker();
        engine.set_override("wk-1", Some(COL_IN_REVIEW)).unwrap();
        assert_eq!(engine.verdict_for("wk-1"), Verdict::plain(COL_IN_REVIEW));

        // Ordinary activity is noise, and leaves the pin alone.
        engine.note_output("wk-1", samples::ACTIVITY);
        assert_eq!(engine.verdict_for("wk-1").column, COL_IN_REVIEW);

        // A prompt is definitive.
        engine.note_output("wk-1", samples::QUOTA_LIMIT);
        assert_eq!(engine.verdict_for("wk-1").column, COL_NEEDS_YOU);
    }

    #[test]
    fn an_override_can_be_cleared_by_hand_and_rejects_nonsense() {
        let (engine, _recorder) = engine_with_worker();
        engine.set_override("wk-1", Some(COL_DONE)).unwrap();
        assert_eq!(engine.verdict_for("wk-1").column, COL_DONE);

        engine.set_override("wk-1", None).unwrap();
        assert_eq!(engine.verdict_for("wk-1").column, COL_WORKING);

        let err = engine
            .set_override("wk-1", Some("almost_done"))
            .expect_err("unknown column");
        assert!(err.contains("unknown board column"), "{err}");
    }

    #[test]
    fn an_override_beats_archived_so_the_card_can_be_moved_back_to_merge() {
        // NT-1: merging requires the agent archived first ("archive it first"),
        // and a card that can never leave `done` again can never be merged.
        // The human's explicit pin must win over the archived short-circuit.
        let engine = StatusEngine::new(IDLE_AFTER);
        engine.observe_worker(&worker("wk-arch", STATUS_ARCHIVED));
        assert_eq!(engine.verdict_for("wk-arch").column, COL_DONE);

        engine
            .set_override("wk-arch", Some(COL_READY_TO_MERGE))
            .unwrap();
        assert_eq!(
            engine.verdict_for("wk-arch").column,
            COL_READY_TO_MERGE,
            "an archived worker pinned by hand must show ready_to_merge"
        );

        // Without the pin the archived worker still belongs in done.
        engine.set_override("wk-arch", None).unwrap();
        assert_eq!(engine.verdict_for("wk-arch").column, COL_DONE);
    }

    #[test]
    fn archiving_clears_a_preexisting_pin() {
        // Invariant the NT-1 fix relies on (GLM-Review): an override is only
        // ever set *after* the archiving, because the lifecycle transition
        // itself clears any earlier pin. Guard that here, so the new ranking
        // cannot leak a stale pre-archive pin into the column.
        let (engine, _recorder) = engine_with_worker();
        engine.set_override("wk-1", Some(COL_IN_REVIEW)).unwrap();
        assert_eq!(engine.verdict_for("wk-1").column, COL_IN_REVIEW);

        engine.observe_worker(&worker("wk-1", STATUS_ARCHIVED));
        assert_eq!(
            engine.verdict_for("wk-1").column,
            COL_DONE,
            "archiving is definitive and clears the pin"
        );
    }

    #[test]
    fn a_hook_event_clears_a_manual_override() {
        let (engine, _recorder) = engine_with_worker();
        engine.set_override("wk-1", Some(COL_DONE)).unwrap();
        engine.note_hook("wk-1", "SessionStart", None);
        assert_eq!(engine.verdict_for("wk-1").column, COL_WORKING);
    }

    // -- publishing and the board -----------------------------------------

    #[test]
    fn only_changes_are_published() {
        let (engine, recorder) = engine_with_worker();
        engine.note_output("wk-1", samples::ACTIVITY);
        engine.note_output("wk-1", samples::ACTIVITY);
        engine.note_output("wk-1", samples::PERMISSION);
        engine.note_output("wk-1", "\u{276f} 1. Yes\r\n");

        // working (registration), then needs_you. The repeats are silent.
        assert_eq!(recorder.columns(), vec![COL_WORKING, COL_NEEDS_YOU]);
        let payload = recorder.last().unwrap();
        assert_eq!(payload.worker_id, "wk-1");
        assert_eq!(
            payload.attention_reason.as_deref(),
            Some("Der Agent wartet auf deine Freigabe — bestätige die Rückfrage im Terminal")
        );
    }

    #[test]
    fn attention_changes_are_published_when_the_archived_column_stays_the_same() {
        let (engine, recorder) = engine_with_worker();
        engine.observe_worker(&worker("wk-1", STATUS_ARCHIVED));
        assert_eq!(recorder.last().unwrap().column, COL_DONE);
        assert_eq!(recorder.last().unwrap().attention_code, None);

        engine.note_output("wk-1", samples::QUOTA_LIMIT);

        let payload = recorder.last().unwrap();
        assert_eq!(payload.column, COL_DONE);
        assert_eq!(
            payload.attention_code,
            Some(ReasonCode::QuotaBlocked.code())
        );
        assert_eq!(payload.attention_grade, Some(Grade::Blocking));
    }

    #[test]
    fn the_board_reports_a_row_per_worker_with_its_pr_url() {
        let engine = StatusEngine::new(IDLE_AFTER);
        let mut running = worker("wk-1", STATUS_RUNNING);
        running.pr_url = Some("https://github.com/o/r/pull/7".to_string());
        let archived = worker("wk-2", STATUS_ARCHIVED);

        let board = engine.board(&[running.clone(), archived.clone()]);
        assert_eq!(board.len(), 2);
        assert_eq!(board[0].worker.id, running.id);
        assert_eq!(board[0].column, COL_WORKING);
        assert_eq!(board[0].pr_url.as_deref(), running.pr_url.as_deref());
        assert_eq!(board[1].column, COL_DONE);
        assert!(board[1].pr_url.is_none());
    }

    #[test]
    fn the_board_carries_the_highest_grade_attention_code() {
        let (engine, _) = engine_with_worker();
        engine.note_output("wk-1", samples::QUOTA_LIMIT);
        let board = engine.board(&[worker("wk-1", STATUS_RUNNING)]);
        assert_eq!(board[0].attention_code, Some("quota_blocked"));
        assert_eq!(board[0].attention_grade, Some(Grade::Blocking));
        let json = serde_json::to_value(&board[0]).unwrap();
        assert_eq!(json["attentionCode"], "quota_blocked");
        assert_eq!(json["attentionGrade"], "blocking");
        assert!(
            json["attentionObservedAt"]
                .as_i64()
                .is_some_and(|value| value > 0),
            "the board must carry the engine observation time"
        );
    }

    #[test]
    fn the_board_payload_uses_the_camel_case_wire_names() {
        let engine = StatusEngine::new(IDLE_AFTER);
        let board = engine.board(&[worker("wk-1", STATUS_RUNNING)]);
        let json = serde_json::to_value(&board[0]).unwrap();
        assert!(json.get("attentionReason").is_some());
        assert!(json.get("prUrl").is_some());
        assert_eq!(json["worker"]["projectId"], "pj-1");

        let signal = Signal::new(ReasonCode::QuotaBlocked);
        let payload = serde_json::to_value(StatusPayload {
            worker_id: "wk-1".to_string(),
            column: COL_NEEDS_YOU.to_string(),
            attention_reason: Some(signal.line()),
            attention_code: Some(signal.code.code()),
            attention_grade: Some(signal.grade()),
            attention_observed_at: Some(1),
        })
        .unwrap();
        assert_eq!(payload["workerId"], "wk-1");
        // Der Satz bleibt das Feld, das jede alte Oberflaeche liest; Code und
        // Grad kommen daneben.
        assert!(payload["attentionReason"]
            .as_str()
            .unwrap()
            .starts_with("Kontingent oder Rate-Limit erreicht — "));
        assert_eq!(payload["attentionCode"], "quota_blocked");
        assert_eq!(payload["attentionGrade"], "blocking");
    }

    /// Die drei Abnahme-Szenarien aus dem Plan (F1): Quota-Block, Zustellfehler
    /// und Prozessabbruch erzeugen **je einen** Eintrag, jeder mit Code, Grad
    /// und einem naechsten Schritt im Satz.
    #[test]
    fn quota_delivery_and_exit_each_produce_exactly_one_attention_entry() {
        /// Was den Worker in den Zustand bringt, den das Szenario beschreibt.
        type Provoke = fn(&StatusEngine);
        let cases: [(&str, ReasonCode, Provoke); 3] = [
            (
                "Quota-Block",
                ReasonCode::QuotaBlocked,
                |engine: &StatusEngine| engine.note_output("wk-1", samples::QUOTA_LIMIT),
            ),
            (
                "Zustellfehler",
                ReasonCode::DeliveryFailed,
                |engine: &StatusEngine| engine.note_submit_guard_failed("wk-1"),
            ),
            (
                "Prozessabbruch",
                ReasonCode::AgentExited,
                |engine: &StatusEngine| engine.observe_worker(&worker("wk-1", STATUS_EXITED)),
            ),
        ];

        for (label, expected, provoke) in cases {
            let (engine, recorder) = engine_with_worker();
            provoke(&engine);

            let signals = engine.signals_for("wk-1");
            assert_eq!(signals.len(), 1, "{label}: genau ein Eintrag, {signals:?}");
            assert_eq!(signals[0].code, expected, "{label}");
            assert_eq!(signals[0].grade(), Grade::Blocking, "{label}");
            let line = signals[0].line();
            assert!(
                line.contains(" — "),
                "{label}: kein naechster Schritt: {line}"
            );
            assert_eq!(
                engine.verdict_for("wk-1").reason.as_deref(),
                Some(line.as_str()),
                "{label}: die Karte zeigt denselben Satz"
            );

            let published = recorder.last().expect("ein Ereignis");
            assert_eq!(published.column, COL_NEEDS_YOU, "{label}");
            assert_eq!(published.attention_code, Some(expected.code()), "{label}");
            assert_eq!(published.attention_grade, Some(Grade::Blocking), "{label}");

            // F3-Vorgriff: ein Handpin ist eine Anzeigeentscheidung. Er darf die
            // Spalte setzen und den Blocker trotzdem nicht loeschen
            // (`.pa/report_f0.md` §2, Befund B-6).
            engine.set_override("wk-1", Some(COL_DONE)).unwrap();
            assert_eq!(
                engine.signals_for("wk-1"),
                signals,
                "{label}: der Pin hat den Blocker verschluckt"
            );
        }
    }

    /// Der Worker-Code fuer eine erschoepfte Quota heisst wie der Profil-Code
    /// in `preflight`. Zwei Namen fuer eine Ursache waeren fuer F3 zwei Zeilen.
    #[test]
    fn the_quota_code_is_the_one_preflight_already_uses() {
        assert_eq!(
            ReasonCode::QuotaBlocked.code(),
            crate::preflight::CODE_QUOTA_BLOCKED
        );
    }

    /// Jeder Code traegt einen Grad, eine Ursache und einen naechsten Schritt.
    /// Ohne Grad koennte F3 nicht sortieren, ohne naechsten Schritt muesste die
    /// Oberflaeche sich einen ausdenken - genau das soll aufhoeren.
    #[test]
    fn every_reason_code_carries_a_grade_a_cause_and_a_next_step() {
        const ALL: [ReasonCode; 15] = [
            ReasonCode::ApprovalRequired,
            ReasonCode::QuotaBlocked,
            ReasonCode::DeliveryFailed,
            ReasonCode::AgentExited,
            ReasonCode::AgentStalled,
            ReasonCode::DecisionPending,
            ReasonCode::AgentReported,
            ReasonCode::IdleAtPrompt,
            ReasonCode::ChangesRequested,
            ReasonCode::ReviewPending,
            ReasonCode::ReviewApproved,
            ReasonCode::ApprovedButDraft,
            ReasonCode::ChecksPending,
            ReasonCode::ReviewDraft,
            ReasonCode::PullRequestMerged,
        ];
        let mut codes: Vec<&str> = Vec::new();
        for code in ALL {
            let line = Signal::new(code).line();
            assert!(!code.code().is_empty(), "{code:?}");
            assert!(line.contains(" — "), "{code:?}: {line}");
            // Deutsch, und keine der alten englischen Wendungen.
            assert!(!line.contains("the agent"), "{code:?}: {line}");
            assert!(!line.contains("pull request open"), "{code:?}: {line}");
            // Der Grad ist eine Funktion des Codes, nicht der Fundstelle.
            assert_eq!(code.grade(), Signal::new(code).grade());
            codes.push(code.code());
        }
        codes.sort_unstable();
        let before = codes.len();
        codes.dedup();
        assert_eq!(codes.len(), before, "zwei Varianten mit demselben Code");
    }

    #[test]
    fn a_forgotten_worker_starts_over() {
        let (engine, _recorder) = engine_with_worker();
        engine.note_output("wk-1", samples::PERMISSION);
        assert_eq!(engine.verdict_for("wk-1").column, COL_NEEDS_YOU);

        engine.forget_worker("wk-1");
        assert_eq!(engine.verdict_for("wk-1"), Verdict::plain(COL_WORKING));
    }

    // -- quota detection (Phase 3.6) ---------------------------------------

    #[test]
    fn the_openai_shaped_quota_error_is_detected_for_every_profile() {
        assert_eq!(
            classify_output(&dialect_of("kimi"), samples::QUOTA_INSUFFICIENT),
            Some(Heuristic::Quota)
        );
        assert_eq!(
            classify_output(&dialect_of("claude"), samples::QUOTA_INSUFFICIENT),
            Some(Heuristic::Quota)
        );
    }

    #[test]
    fn the_quota_line_itself_is_recoverable() {
        assert_eq!(
            quota_line(&dialect_of("claude"), samples::QUOTA_LIMIT).as_deref(),
            Some("Claude usage limit reached. Your limit will reset at 3pm (Europe/Berlin).")
        );
        // Escape codes are stripped, and the surrounding output is not swept up.
        let tail = format!(
            "{}\u{1b}[31m{}\u{1b}[0m",
            samples::ACTIVITY,
            samples::QUOTA_CREDIT
        );
        assert_eq!(
            quota_line(&dialect_of("claude"), &tail).as_deref(),
            Some("API Error: Your credit balance is too low to access the Anthropic API.")
        );
    }

    #[test]
    fn the_most_recent_quota_line_wins_and_ordinary_output_has_none() {
        let tail = format!("{}{}", samples::QUOTA_CREDIT, samples::QUOTA_429);
        assert!(quota_line(&dialect_of("claude"), &tail)
            .unwrap()
            .contains("429"));

        assert_eq!(quota_line(&dialect_of("claude"), samples::ACTIVITY), None);
        assert_eq!(quota_line(&dialect_of("claude"), ""), None);
        // A Claude-only wording is not a quota line for another agent.
        assert_eq!(quota_line(&dialect_of("kimi"), samples::QUOTA_CREDIT), None);
    }

    #[test]
    fn a_quota_error_blocks_the_profile_and_activity_releases_it() {
        let (engine, _recorder) = engine_with_worker();
        let tracker = Arc::new(QuotaTracker::default());
        engine.set_quota_tracker(Arc::clone(&tracker));

        engine.note_output("wk-1", samples::QUOTA_LIMIT);
        let row = tracker.state_of("claude").expect("quota row");
        assert!(row.is_blocked());
        assert_eq!(
            row.reason.as_deref(),
            Some("Claude usage limit reached. Your limit will reset at 3pm (Europe/Berlin).")
        );
        assert!(row.blocked_until.is_none(), "the reset time is not parsed");

        // Enough ordinary output to push the error out of the tail, which is
        // exactly what "working again" looks like from here.
        engine.note_output("wk-1", &samples::ACTIVITY.repeat(40));
        assert!(!tracker.is_blocked("claude"));
        assert!(tracker.state_of("claude").unwrap().reason.is_none());
    }

    #[test]
    fn a_prompt_leaves_the_quota_alone() {
        let (engine, _recorder) = engine_with_worker();
        let tracker = Arc::new(QuotaTracker::default());
        engine.set_quota_tracker(Arc::clone(&tracker));

        engine.note_output("wk-1", samples::QUOTA_LIMIT);
        assert!(tracker.is_blocked("claude"));

        // A permission prompt says nothing about credit, so the block stands.
        engine.forget_worker("wk-1");
        engine.observe_worker(&worker("wk-1", STATUS_RUNNING));
        engine.note_output("wk-1", samples::PERMISSION);
        assert!(tracker.is_blocked("claude"));
    }

    #[test]
    fn a_worker_with_no_profile_yet_reports_no_quota() {
        let engine = StatusEngine::new(IDLE_AFTER);
        let tracker = Arc::new(QuotaTracker::default());
        engine.set_quota_tracker(Arc::clone(&tracker));

        // Output before `observe_worker` has said which agent this is. The
        // wording has to be one of the generic patterns: a Claude-only phrase
        // says nothing about a worker whose profile is still unknown.
        engine.note_output("wk-unknown", samples::QUOTA_429);

        // The board still reacts - it is the *profile* that cannot be named,
        // and a quota row keyed by nothing would be worse than no row at all.
        assert_eq!(engine.verdict_for("wk-unknown").column, COL_NEEDS_YOU);
        assert_eq!(tracker.state_of(""), None);
        assert_eq!(tracker.snapshot(&[]).len(), 0);
    }

    #[test]
    fn an_engine_without_a_tracker_still_classifies() {
        let (engine, _recorder) = engine_with_worker();
        engine.note_output("wk-1", samples::QUOTA_LIMIT);
        assert_eq!(
            engine.verdict_for("wk-1").reason.as_deref(),
            Some("Kontingent oder Rate-Limit erreicht — warte auf das nächste Zeitfenster oder wechsle das Agentenprofil")
        );
    }

    // -- the context parser (Phase 3.6) ------------------------------------

    #[test]
    fn the_claude_status_line_is_parsed() {
        assert_eq!(
            parse_context_usage(samples::STATUS_LINE, &[]),
            Some(ContextUsage {
                used: 137_000,
                total: 1_000_000
            })
        );
    }

    #[test]
    fn suffixes_scale_and_bare_numbers_are_taken_as_written() {
        let cases = [
            ("Ctx: 512/2048 tok", 512, 2048),
            ("Ctx: 1.2M/2M tok", 1_200_000, 2_000_000),
            ("ctx: 12k/200K tok", 12_000, 200_000),
            ("Context: 1,024/8,192 tokens", 1_024, 8_192),
            ("Ctx:0/200k", 0, 200_000),
            ("Ctx: 137.5k/1000.0k tok (14% used)", 137_500, 1_000_000),
        ];
        for (text, used, total) in cases {
            assert_eq!(
                parse_context_usage(text, &[]),
                Some(ContextUsage { used, total }),
                "{text}"
            );
        }
    }

    #[test]
    fn a_missing_or_nonsensical_figure_is_no_figure() {
        let cases = [
            "",
            "Read(src/main.rs)",
            // No label.
            "137.0k/1000.0k tok",
            // Label, no numbers.
            "Ctx: unknown",
            // Half a figure.
            "Ctx: 137.0k tok",
            "Ctx: /1000.0k tok",
            "Ctx: 137.0k/ tok",
            // A window of zero is a misread, not an empty window.
            "Ctx: 0/0 tok",
            // The numbers are not next to the label.
            "Ctx: reading the file src/a/b.rs",
            // A path is not a fraction.
            "context: see src/lib.rs/mod.rs",
        ];
        for text in cases {
            assert_eq!(parse_context_usage(text, &[]), None, "{text}");
        }
    }

    #[test]
    fn the_newest_status_line_in_the_tail_wins() {
        let tail = "Ctx: 10k/200k tok\r\nCtx: 20k/200k tok\r\n";
        assert_eq!(
            parse_context_usage(tail, &[]),
            Some(ContextUsage {
                used: 20_000,
                total: 200_000
            })
        );
    }

    #[test]
    fn the_context_figure_is_remembered_per_worker_and_reaches_the_board() {
        let (engine, _recorder) = engine_with_worker();
        assert_eq!(engine.context_usage("wk-1"), None);

        engine.note_output("wk-1", samples::STATUS_LINE);
        assert_eq!(
            engine.context_usage("wk-1"),
            Some(ContextUsage {
                used: 137_000,
                total: 1_000_000
            })
        );

        // A later chunk without a status line keeps the last known figure.
        engine.note_output("wk-1", samples::ACTIVITY);
        assert_eq!(engine.context_usage("wk-1").unwrap().used, 137_000);

        let board = engine.board(&[worker("wk-1", STATUS_RUNNING)]);
        let usage = board[0].context_usage.expect("context usage");
        assert_eq!(usage.total, 1_000_000);

        let json = serde_json::to_value(&board[0]).unwrap();
        assert_eq!(json["contextUsage"]["used"], 137_000);
        assert_eq!(json["contextUsage"]["total"], 1_000_000);
    }

    #[test]
    fn a_worker_that_never_printed_a_figure_reports_null() {
        let engine = StatusEngine::new(IDLE_AFTER);
        let board = engine.board(&[worker("wk-1", STATUS_RUNNING)]);
        assert!(board[0].context_usage.is_none());
        let json = serde_json::to_value(&board[0]).unwrap();
        assert!(json["contextUsage"].is_null());
    }

    #[test]
    fn two_workers_keep_their_own_figures() {
        let engine = StatusEngine::new(IDLE_AFTER);
        engine.observe_worker(&worker("wk-1", STATUS_RUNNING));
        engine.observe_worker(&worker("wk-2", STATUS_RUNNING));

        engine.note_output("wk-1", "Ctx: 10k/200k tok");
        engine.note_output("wk-2", "Ctx: 190k/200k tok");

        assert_eq!(engine.context_usage("wk-1").unwrap().used, 10_000);
        assert_eq!(engine.context_usage("wk-2").unwrap().used, 190_000);
    }

    // -- statusLine parsing ------------------------------------------------

    #[test]
    fn parses_the_verified_statusline_payload() {
        let engine = StatusEngine::new(IDLE_AFTER);
        engine.observe_worker(&worker("wk-1", STATUS_RUNNING));
        engine.note_statusline(
            "wk-1",
            r#"{"rate_limits":{"five_hour":{"used_percentage":87,"resets_at":1787793000},"seven_day":{"used_percentage":21,"resets_at":1788336000}},"context_window":{"context_window_size":1000000,"current_usage":null,"used_percentage":null,"remaining_percentage":null},"model":{"display_name":"Opus 5"}}"#,
        );

        let usage = engine.provider_usage("claude").expect("usage");
        assert_eq!(usage.percent, Some(87));
        assert_eq!(usage.window_label, "5-Stunden-Fenster");
        assert_eq!(usage.resets_at, Some(1_787_793_000));
        assert!(usage.used.is_none());
        assert_eq!(usage.limit.as_deref(), Some("1,0 M Tokens"));
    }

    #[test]
    fn statusline_without_rate_limits_is_ignored_once() {
        let engine = StatusEngine::new(IDLE_AFTER);
        engine.observe_worker(&worker("wk-1", STATUS_RUNNING));
        engine.note_statusline(
            "wk-1",
            r#"{"context_window":{"context_window_size":1000000,"current_usage":null}}"#,
        );
        assert!(engine.provider_usage("claude").is_none());
    }

    #[test]
    fn statusline_context_window_formats_used_and_limit() {
        // Live payload shape: current_usage is an object whose fields are
        // individually optional; used is their sum over what is present.
        let usage = parse_statusline(
            r#"{"rate_limits":{"five_hour":{"used_percentage":14}},"context_window":{"context_window_size":200000.0,"current_usage":{"input_tokens":120000.0,"cache_creation_input_tokens":5000.0,"cache_read_input_tokens":12000.0}}}"#,
            1,
        )
        .expect("parses");
        assert_eq!(usage.percent, Some(14));
        assert_eq!(usage.used.as_deref(), Some("137,0 k Tokens"));
        assert_eq!(usage.limit.as_deref(), Some("200,0 k Tokens"));

        // Partial objects sum only what arrived.
        let partial = parse_statusline(
            r#"{"rate_limits":{"five_hour":{"used_percentage":14}},"context_window":{"current_usage":{"input_tokens":1000.0,"cache_read_input_tokens":null}}}"#,
            1,
        )
        .expect("parses");
        assert_eq!(partial.used.as_deref(), Some("1,0 k Tokens"));
    }

    #[test]
    fn a_statusline_without_context_window_still_carries_the_rate_limits() {
        let usage = parse_statusline(
            r#"{"rate_limits":{"five_hour":{"used_percentage":42,"resets_at":1787793000}},"model":{"display_name":"Opus 5"}}"#,
            1,
        )
        .expect("parses");
        assert_eq!(usage.percent, Some(42));
        assert_eq!(usage.resets_at, Some(1_787_793_000));
        assert!(usage.used.is_none());
        assert!(usage.limit.is_none());
    }

    #[test]
    fn seven_day_rate_limits_are_a_fallback() {
        let usage = parse_statusline(
            r#"{"rate_limits":{"seven_day":{"used_percentage":33,"resets_at":1788336000}}}"#,
            1,
        )
        .expect("parses");
        assert_eq!(usage.percent, Some(33));
        assert_eq!(usage.window_label, "7-Tage-Fenster");
        assert_eq!(usage.resets_at, Some(1_788_336_000));
    }

    /// Full `Debug` snapshot of the verified payload from
    /// [`parses_the_verified_statusline_payload`]: a point assertion checks
    /// the fields someone thought to name, this pins every field at once -
    /// `five_hour`/`seven_day` included, which that test does not touch.
    #[test]
    fn parse_statusline_snapshot_verified_payload() {
        let usage = parse_statusline(
            r#"{"rate_limits":{"five_hour":{"used_percentage":87,"resets_at":1787793000},"seven_day":{"used_percentage":21,"resets_at":1788336000}},"context_window":{"context_window_size":1000000,"current_usage":null,"used_percentage":null,"remaining_percentage":null},"model":{"display_name":"Opus 5"}}"#,
            42,
        )
        .expect("parses");
        insta::assert_debug_snapshot!(usage);
    }

    /// Same shape, seven-day-only fallback path (no five-hour window at
    /// all), so the snapshot also exercises `window_label` picking the other
    /// branch and `five_hour: None`.
    #[test]
    fn parse_statusline_snapshot_seven_day_fallback() {
        let usage = parse_statusline(
            r#"{"rate_limits":{"seven_day":{"used_percentage":33,"resets_at":1788336000}}}"#,
            42,
        )
        .expect("parses");
        insta::assert_debug_snapshot!(usage);
    }

    /// Rounding to one decimal must not leave a value in a unit it has
    /// outgrown: 999 999 tokens once read "1000,0 k Tokens". The unit is
    /// chosen after rounding, so the display carries over to the next one.
    #[test]
    fn format_tokens_carries_over_to_the_next_unit_after_rounding() {
        let rendered = |value: f64| format_tokens(value).expect("finite, non-negative");
        // Rust rounds a tie to even: 0.5 shows as 0, 999.5 as 1000.
        assert_eq!(rendered(0.5), "0 Tokens");
        assert_eq!(rendered(999.4), "999 Tokens");
        assert_eq!(rendered(999.5), "1,0 k Tokens");
        assert_eq!(rendered(999_949.0), "999,9 k Tokens");
        assert_eq!(rendered(999_950.0), "1,0 M Tokens");
        assert_eq!(rendered(999_999.0), "1,0 M Tokens");
        assert_eq!(rendered(999_949_999.0), "999,9 M Tokens");
        assert_eq!(rendered(999_999_999.0), "1,0 G Tokens");
        assert_eq!(rendered(999_949_999_999.0), "999,9 G Tokens");
        // G is the largest unit; there is nothing to carry over into.
        assert_eq!(rendered(999_999_999_999.0), "1000,0 G Tokens");
    }

    /// A value that rounds to zero shows as "0 Tokens", never "-0 Tokens":
    /// -0.0 passes the `< 0.0` guard, and a small negative rounds to "-0".
    /// Negatives that do not round to zero stay rejected.
    #[test]
    fn format_tokens_never_renders_negative_zero() {
        assert_eq!(format_tokens(-0.0).as_deref(), Some("0 Tokens"));
        assert_eq!(format_tokens(-0.4).as_deref(), Some("0 Tokens"));
        // -0.5 belongs to the band because `{:.0}` rounds a tie to even,
        // i.e. to "-0"; the clamp, not the formatter, makes it "0 Tokens".
        assert_eq!(format_tokens(-0.5).as_deref(), Some("0 Tokens"));
        // Just below the band a value rounds to "-1": the negative guard,
        // not the clamp, must still reject it.
        assert_eq!(format_tokens(f64::from_bits(0xBFE0_0000_0000_0001)), None);
        assert_eq!(format_tokens(-0.55), None);
        assert_eq!(format_tokens(-0.6), None);
        assert_eq!(format_tokens(-1.0), None);
    }

    /// [`format_tokens`] scales k/M/G and renders the German decimal comma;
    /// a snapshot table is cheaper to extend than a point assertion per
    /// magnitude and shows every boundary in one review.
    #[test]
    fn format_tokens_snapshot() {
        let cases: Vec<(f64, Option<String>)> = [
            0.0,
            1.0,
            999.0,
            1_000.0,
            1_234.0,
            999_999.0,
            1_000_000.0,
            1_234_567.0,
            1_000_000_000.0,
            2_500_000_000.0,
            -1.0,
            f64::NAN,
            f64::INFINITY,
        ]
        .into_iter()
        .map(|v| (v, format_tokens(v)))
        .collect();
        insta::assert_debug_snapshot!(cases);
    }

    #[test]
    fn malformed_statusline_is_ignored() {
        assert!(parse_statusline("not json", 1).is_none());
        assert!(parse_statusline("{}", 1).is_none());
    }

    #[test]
    fn an_out_of_range_rate_percentage_drops_only_that_figure_not_the_payload() {
        // A statusLine whose `used_percentage` is above 100 is, per the
        // `window_usage` contract ("143 % is a payload this app does not
        // understand"), meant to drop the percentage alone and keep the rest -
        // the reset time, the model, the whole context window. That tolerance
        // works up to 255, but one tick higher the `Option<u8>` field makes
        // serde reject the *entire* payload and `parse_statusline` returns
        // `None`: a single odd rate figure now costs us every other fact too.
        let payload = r#"{"rate_limits":{"five_hour":{"used_percentage":300,"resets_at":1787793000}},"model":{"display_name":"Opus 5"}}"#;
        let usage = parse_statusline(payload, 1);
        assert!(
            usage.is_some(),
            "a 300% figure must not discard the model and resets_at of the same payload"
        );
        assert_eq!(usage.and_then(|u| u.resets_at), Some(1_787_793_000));
    }

    // -- hierarchy (Phase 11) ----------------------------------------------

    /// A coordinator of `kind`, whose task text is `task`.
    fn coordinator(id: &str, kind: &str, task: &str, status: &str) -> Worker {
        let mut worker = worker(id, status);
        worker.kind = kind.to_string();
        worker.task = task.to_string();
        worker
    }

    /// An employee `spawned_by` the given coordinator id.
    fn employee(id: &str, spawned_by: Option<&str>) -> Worker {
        let mut worker = worker(id, STATUS_RUNNING);
        worker.spawned_by = spawned_by.map(str::to_string);
        worker
    }

    #[test]
    fn an_employee_of_a_queen_is_badged_with_the_domain() {
        let queen = coordinator("wk-q", KIND_QUEEN, "Queen: Backend-API", STATUS_RUNNING);
        let hand = employee("wk-1", Some("wk-q"));
        let all = vec![queen, hand.clone()];

        let badge = controlled_by(&hand, &all).expect("resolved");
        assert_eq!(badge.worker_id, "wk-q");
        assert_eq!(badge.kind, KIND_QUEEN);
        // The domain, not the task text the queen was started with.
        assert_eq!(badge.label, "Backend-API");
    }

    #[test]
    fn a_worker_without_a_controller_carries_no_badge() {
        let hand = employee("wk-1", None);
        let all = [hand.clone()];
        assert!(controlled_by(&hand, &all).is_none());
    }

    #[test]
    fn a_badge_survives_the_queen_being_archived_or_exited() {
        for status in [STATUS_ARCHIVED, STATUS_EXITED] {
            let queen = coordinator("wk-q", KIND_QUEEN, "Queen: Backend-API", status);
            let hand = employee("wk-1", Some("wk-q"));
            let badge = controlled_by(&hand, &[queen, hand.clone()]).expect("still resolved");
            assert_eq!(badge.label, "Backend-API", "{status}");
        }
    }

    #[test]
    fn an_unknown_controller_id_resolves_to_nothing() {
        let hand = employee("wk-1", Some("wk-gone"));
        let all = [hand.clone()];
        assert!(controlled_by(&hand, &all).is_none());
    }

    #[test]
    fn the_orchestrator_is_named_by_its_role_and_a_bare_queen_task_by_itself() {
        let orchestrator = coordinator(
            "wk-o",
            KIND_ORCHESTRATOR,
            "coordinate everything, at length",
            STATUS_RUNNING,
        );
        let bare_queen = coordinator("wk-q", KIND_QUEEN, "Backend-API", STATUS_RUNNING);
        let hand = employee("wk-1", Some("wk-o"));
        let other = employee("wk-2", Some("wk-q"));
        let all = vec![orchestrator, bare_queen, hand.clone(), other.clone()];

        assert_eq!(controlled_by(&hand, &all).unwrap().label, "Orchestrator");
        // No `Queen: ` prefix to strip, so the task text stands as the label.
        assert_eq!(controlled_by(&other, &all).unwrap().label, "Backend-API");
    }

    #[test]
    fn the_banner_lists_live_coordinators_only() {
        let mut orchestrator = coordinator(
            "wk-o",
            KIND_ORCHESTRATOR,
            "coordinate everything",
            STATUS_RUNNING,
        );
        orchestrator.session_id = Some("sess-o".to_string());
        let queen = coordinator("wk-q", KIND_QUEEN, "Queen: Backend-API", STATUS_RUNNING);
        let scout = coordinator("wk-s", KIND_SCOUT, "scan the repo", STATUS_RUNNING);
        let gone = coordinator("wk-g", KIND_QUEEN, "Queen: Frontend", STATUS_ARCHIVED);
        let hand = employee("wk-1", Some("wk-q"));

        let banner = coordinators(&[orchestrator, queen, scout, gone, hand]);
        let ids: Vec<&str> = banner.iter().map(|c| c.worker_id.as_str()).collect();
        // Input order kept; the archived queen and the plain worker are out.
        assert_eq!(ids, vec!["wk-o", "wk-q", "wk-s"]);
        assert_eq!(banner[0].label, "Orchestrator");
        assert_eq!(banner[0].session_id.as_deref(), Some("sess-o"));
        assert_eq!(banner[1].label, "Backend-API");
        assert_eq!(banner[1].status, STATUS_RUNNING);
        assert!(banner[1].session_id.is_none());
        assert_eq!(banner[2].kind, KIND_SCOUT);
        assert_eq!(banner[2].label, "scan the repo");
    }

    #[test]
    fn a_long_task_label_is_cut_to_one_line() {
        let long = "x".repeat(LABEL_MAX_CHARS + 10);
        let scout = coordinator(
            "wk-s",
            KIND_SCOUT,
            &format!("{long}\nsecond line"),
            STATUS_RUNNING,
        );
        let label = &coordinators(&[scout])[0].label;
        assert_eq!(label.chars().count(), LABEL_MAX_CHARS + 1);
        assert!(label.ends_with('\u{2026}'), "{label}");
    }

    #[test]
    fn the_board_resolves_badges_from_the_slice_it_is_given() {
        let engine = StatusEngine::new(IDLE_AFTER);
        let queen = coordinator("wk-q", KIND_QUEEN, "Queen: Backend-API", STATUS_RUNNING);
        let hand = employee("wk-1", Some("wk-q"));

        let board = engine.board(&[queen, hand.clone()]);
        let badge = board[1].controlled_by.as_ref().expect("resolved");
        assert_eq!(badge.label, "Backend-API");
        let json = serde_json::to_value(&board[1]).unwrap();
        assert_eq!(json["controlledBy"]["workerId"], "wk-q");

        // The single-worker call `ApiBackend::worker_state` makes cannot see the
        // coordinator, so it stays unbadged - documented on `board`.
        let alone = engine.board(&[hand]);
        assert!(alone[0].controlled_by.is_none());
    }

    #[test]
    fn the_board_state_uses_the_camel_case_wire_names() {
        let engine = StatusEngine::new(IDLE_AFTER);
        let all = [coordinator(
            "wk-q",
            KIND_QUEEN,
            "Queen: Backend-API",
            STATUS_RUNNING,
        )];
        let state = BoardState {
            cards: engine.board(&all),
            coordinators: coordinators(&all),
        };
        let json = serde_json::to_value(&state).unwrap();
        assert_eq!(json["cards"][0]["worker"]["id"], "wk-q");
        assert_eq!(json["coordinators"][0]["workerId"], "wk-q");
        assert!(json["coordinators"][0].get("sessionId").is_some());
    }
}
