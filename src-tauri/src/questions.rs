//! Blocking decisions: what an agent hands back to the human, and how it
//! comes back.
//!
//! Phase 21 gives the fleet a way to say "I do not know, and guessing would be
//! expensive". An agent asks with `pa ask`, the question becomes a
//! [`crate::store::Question`] row, its worker goes to `needs_you` with the
//! question on the card, and the answer is delivered into the agent's
//! terminal through the submit guard.
//!
//! ## Why the CLI is the load-bearing path
//!
//! Not every agent has hooks - kimi and codex have none - so a hook event
//! would only reach a third of the fleet. `pa ask` reaches all of it: every
//! agent this app spawns can run a command, and the CLI is already how they
//! are told to do everything else.
//!
//! ## Ask, wait, resume
//!
//! `pa ask` does *not* block. The agent asks, says it is waiting for a
//! decision, and ends its turn; the answer arrives later through the submit
//! guard (echo-verified, like every task delivery - F-CORE-3), the same way a
//! person typing into the worker's terminal would send it. That is why an
//! expired question writes its auto-answer into the terminal too: without it
//! an agent that ended its turn waiting for an answer would wait forever.
//!
//! The one exception is the budget refusal below. It is answered *during* the
//! ask, so the answer travels back as the exit output of `pa ask` itself -
//! writing into the terminal there would be typing at an agent that is in the
//! middle of its own turn.
//!
//! ## The guardrails, and why they are not configurable
//!
//! A fleet that may ask questions will ask them. Three rules keep the decision
//! tab something a person can actually work through, and all three are
//! compiled in - a limit the user can raise is a limit the user will raise at
//! the wrong moment:
//!
//! * **[`MAX_OPEN_PER_WORKER`] open questions per worker.** The fourth is
//!   answered on the spot with [`ANSWER_TOO_MANY`]. An agent that has three
//!   decisions outstanding is not blocked on a fourth, it is asking instead of
//!   working.
//! * **[`TTL_SECS`] to answer.** After that the sweep answers with
//!   [`ANSWER_EXPIRED`]. A question nobody answered in four hours is a
//!   question whose answer stopped mattering.
//! * **Only blocking decisions.** This one cannot be enforced from here, so it
//!   is written into the prompts instead - see
//!   [`crate::workers::ASK_GUIDANCE`].
//!
//! Every automatic answer is stored under its own status, so the log can be
//! read back: [`QUESTION_ANSWERED`] means a person decided,
//! [`QUESTION_EXPIRED`] means the clock did, [`QUESTION_REFUSED`] means the
//! budget rule did. Folding all three into "answered" would leave nobody able
//! to tell a decision from a timeout.

use crate::status::StatusEngine;
use crate::store::{
    self, Question, Store, MSG_SYSTEM, MSG_USER, QUESTION_ANSWERED, QUESTION_EXPIRED,
    QUESTION_OPEN, QUESTION_PREFLIGHT, QUESTION_REFUSED, QUESTION_WORKER, SRC_QUESTION,
};
use crate::workers::{AgentControl, DeliveryCallback, ERR_REFUSED, ERR_UNKNOWN};

/// How many decisions one worker may have outstanding at the same time.
pub const MAX_OPEN_PER_WORKER: i64 = 3;

/// How long a question waits for a human before the clock answers it: four
/// hours.
pub const TTL_SECS: i64 = 4 * 60 * 60;

/// What the worker beyond [`MAX_OPEN_PER_WORKER`] is told, immediately.
pub const ANSWER_TOO_MANY: &str =
    "zu viele offene Fragen \u{2014} entscheide selbst und dokumentiere die Annahme";

/// What a question that nobody answered within [`TTL_SECS`] is answered with.
pub const ANSWER_EXPIRED: &str = "abgelaufen \u{2014} entscheide selbst";

/// How the board card opens when a decision is waiting. The rest of the line
/// is the beginning of the question itself.
pub const REASON_PREFIX: &str = "Entscheidung wartet: ";

/// How much of the question fits on a board card before it is cut.
const EXCERPT_CHARS: usize = 80;

/// Status event kinds, so the activity feed can name the two halves of a
/// decision.
pub const EVENT_ASKED: &str = "question_asked";
pub const EVENT_ANSWERED: &str = "question_answered";

/// Ask a blocking question.
///
/// `worker_id` decides the scope and nothing else: given, this is a
/// [`QUESTION_WORKER`] question whose answer goes back into that worker's
/// terminal; absent, it is a [`QUESTION_PREFLIGHT`] question asked while a
/// prompt is being sharpened, before there is a worker at all. Deriving it
/// rather than taking it from the caller is deliberate - a row whose `scope`
/// and `worker_id` disagree is a row nothing downstream can interpret.
///
/// `options` is the raw `"A,B,C"` the caller typed; it is stored as a JSON
/// array so the decision tab can offer buttons.
///
/// The returned question is **not always open**: a worker that already has
/// [`MAX_OPEN_PER_WORKER`] waiting gets one back that is already
/// [`QUESTION_REFUSED`] and carries [`ANSWER_TOO_MANY`] as its answer. Callers
/// check `status` rather than assuming.
pub async fn ask(
    store: &Store,
    engine: &StatusEngine,
    project_id: &str,
    worker_id: Option<&str>,
    question: &str,
    options: Option<&str>,
) -> Result<Question, String> {
    let text = question.trim();
    if text.is_empty() {
        return Err(format!("{ERR_REFUSED}a question needs text"));
    }
    if store.get_project(project_id).await?.is_none() {
        return Err(format!("{ERR_UNKNOWN}project: {project_id}"));
    }
    // A worker is checked against the project it was asked under. Letting the
    // two drift would file the decision in a tab the person watching this
    // project never opens.
    if let Some(worker_id) = worker_id {
        let worker = store
            .get_worker(worker_id)
            .await?
            .ok_or_else(|| format!("{ERR_UNKNOWN}worker: {worker_id}"))?;
        if worker.project_id != project_id {
            return Err(format!(
                "{ERR_REFUSED}worker {worker_id} belongs to project {}, not {project_id}",
                worker.project_id
            ));
        }
    }

    let now = store::now_unix_secs();
    let mut row = Question {
        id: store::new_id("qs"),
        project_id: project_id.to_string(),
        worker_id: worker_id.map(str::to_string),
        scope: match worker_id {
            Some(_) => QUESTION_WORKER.to_string(),
            None => QUESTION_PREFLIGHT.to_string(),
        },
        question: text.to_string(),
        options_json: options_json(options),
        status: QUESTION_OPEN.to_string(),
        answer: None,
        created_at: now,
        answered_at: None,
        // Stays empty even on the refusal path below: the budget rule closed
        // that row, and no caller answered it. `status` is what names the
        // rule; this column only ever names a caller.
        answered_by: None,
        expires_at: Some(now + TTL_SECS),
    };

    // The budget rule. Only worker questions are counted: a preflight question
    // belongs to a person sharpening a prompt, who is already waiting for the
    // answer and cannot flood anybody.
    if let Some(worker_id) = worker_id {
        if store.count_open_questions(worker_id).await? >= MAX_OPEN_PER_WORKER {
            row.status = QUESTION_REFUSED.to_string();
            row.answer = Some(ANSWER_TOO_MANY.to_string());
            row.answered_at = Some(now);
            // No deadline: this row never waited for anybody, and a deadline
            // on it would only make the expiry sweep look at it forever.
            row.expires_at = None;
            store.insert_question(&row).await?;
            // Recorded, not shown: the refusal is the agent's own business and
            // travels back as the output of its `pa ask`. Raising the board
            // for it would put the person in front of a card whose decision
            // has already been made.
            log(
                store,
                worker_id,
                MSG_SYSTEM,
                &format!("Frage abgewiesen ({ANSWER_TOO_MANY}): {text}"),
            )
            .await;
            return Ok(row);
        }
    }

    store.insert_question(&row).await?;

    if let Some(worker_id) = worker_id {
        let reason = card_reason(text);
        engine.note_question(worker_id, &reason);
        if let Err(err) = store
            .record_status_event(worker_id, EVENT_ASKED, &reason, SRC_QUESTION)
            .await
        {
            eprintln!("projecta: {err}");
        }
        log(store, worker_id, MSG_SYSTEM, &format!("Frage: {text}")).await;
    }
    Ok(row)
}

/// Answer a question, and put the answer where the agent will read it.
///
/// The write into the terminal is the point of the whole feature, so it
/// happens on the same path as the record: the row is closed first - a single
/// conditional UPDATE, so two people answering at once cannot both win - and
/// only the caller that closed it types.
///
/// A worker whose agent has exited is answered all the same. The decision is
/// still worth recording, and refusing here would leave the question open
/// until the clock ran out on it; that the answer reached nobody is written
/// into the worker's log instead of being swallowed.
///
/// `answered_by` is [`crate::store::ANSWERED_BY_HUMAN`] when the caller proved
/// it with the verdict token and [`crate::store::ANSWERED_BY_UNVERIFIED`] when
/// it did not. This function does not decide which: proof is a property of how
/// the call arrived, and only the caller's own doorway can see it. It is
/// recorded rather than enforced - an agent answering its own question changes
/// nothing outside its terminal, unlike approving a learning, which writes
/// itself into every later prompt.
pub async fn answer(
    store: &Store,
    agents: &dyn AgentControl,
    engine: &StatusEngine,
    id: &str,
    answer: &str,
    answered_by: &str,
) -> Result<Question, String> {
    let question = store
        .get_question(id)
        .await?
        .ok_or_else(|| format!("{ERR_UNKNOWN}question: {id}"))?;
    if question.status != QUESTION_OPEN {
        return Err(already_answered(&question));
    }
    let answered_at = store::now_unix_secs();
    if !store
        .close_question(
            id,
            QUESTION_ANSWERED,
            answer,
            answered_at,
            Some(answered_by),
        )
        .await?
    {
        // Somebody - the window, another `pa answer`, the expiry sweep - got
        // there between the read and the write.
        let current = store
            .get_question(id)
            .await?
            .ok_or_else(|| format!("{ERR_UNKNOWN}question: {id}"))?;
        return Err(already_answered(&current));
    }

    let closed = Question {
        status: QUESTION_ANSWERED.to_string(),
        answer: Some(answer.to_string()),
        answered_at: Some(answered_at),
        answered_by: Some(answered_by.to_string()),
        ..question
    };
    deliver(store, agents, engine, &closed).await;
    Ok(closed)
}

/// Answer every question whose deadline has passed, and tell the agents.
///
/// Called on a timer. `now` is passed in rather than read here so a test can
/// move the clock instead of waiting four hours.
///
/// Returns the questions this sweep closed. A row another caller closed in the
/// meantime is simply not among them - the conditional UPDATE decides, and a
/// human answer that lands in the same second is the one that counts.
pub async fn expire_due(
    store: &Store,
    agents: &dyn AgentControl,
    engine: &StatusEngine,
    now: i64,
) -> Result<Vec<Question>, String> {
    let mut expired = Vec::new();
    for question in store.list_expired_questions(now).await? {
        if !store
            .close_question(&question.id, QUESTION_EXPIRED, ANSWER_EXPIRED, now, None)
            .await?
        {
            continue;
        }
        let closed = Question {
            status: QUESTION_EXPIRED.to_string(),
            answer: Some(ANSWER_EXPIRED.to_string()),
            answered_at: Some(now),
            ..question
        };
        deliver(store, agents, engine, &closed).await;
        expired.push(closed);
    }
    Ok(expired)
}

/// The common tail of every close: the answer into the terminal, into the log,
/// and the card released when nothing is left waiting.
///
/// Best effort by design. The row is already closed at this point, and none of
/// these three is a reason to tell the caller their answer did not land: a
/// terminal that has gone away is a fact to write down, not an error to raise.
///
/// F-CORE-3 B.1: the answer travels through the submit guard
/// (`start_task_delivery` - echo after the write baseline, readiness marker
/// from the worker's profile), never as a blind `write("{answer}\r")`. The
/// `MSG_USER` log line is written only once the guard *proves* the delivery
/// (C-2): `start_task_delivery` is asynchronous, so its `Ok(())` means no more
/// than "the guard thread is running" - the verdict arrives through the
/// outcome callback, and only it turns the answer into a user turn. The log
/// is the conversation the UI replays; an answer that was never delivered is
/// not a user turn, so an escalation is written down as `MSG_SYSTEM` instead.
async fn deliver(
    store: &Store,
    agents: &dyn AgentControl,
    engine: &StatusEngine,
    question: &Question,
) {
    let answer = question.answer.as_deref().unwrap_or_default();
    let Some(worker_id) = question.worker_id.as_deref() else {
        // A preflight question has no terminal. Its answer is read back out of
        // the row by whoever asked - see the enhance dialogue in Phase 21 P1.
        return;
    };

    match store.session_for_worker(worker_id) {
        Some(session_id) => {
            // The guard's readiness marker comes from the worker's profile
            // (OpenCode: "Ask anything", NT-17); without one the silence
            // heuristic stands, exactly as for task delivery.
            //
            // A failed read is not the same as a profile without a marker:
            // it degrades the guard to that heuristic, so it gets said out
            // loud instead of vanishing. Delivery still goes ahead - dropping
            // the answer over a transient store error would cost more than
            // the weaker guard does. The sibling in main.rs
            // (`send_to_worker`) propagates instead, because its caller has a
            // `Result` to carry the failure.
            let worker = match store.get_worker(worker_id).await {
                Ok(worker) => worker,
                Err(err) => {
                    log(
                        store,
                        worker_id,
                        MSG_SYSTEM,
                        &format!(
                            "Bereitschaftsmarker nicht lesbar ({err}) - die Antwort wird ohne \
                             Marker zugestellt, der Wächter fällt auf die Stille-Heuristik zurück"
                        ),
                    )
                    .await;
                    None
                }
            };
            let readiness_marker = worker
                .and_then(|worker| crate::profiles::find_profile(&worker.profile_id))
                .and_then(|profile| profile.caps.readiness_marker);
            // The guard writes the text and sends Enter as its own write once
            // the echo proves the TUI accepted it. The log follows the
            // verdict, never the start (C-2).
            let log_store = store.clone();
            let log_worker = worker_id.to_string();
            let log_answer = answer.to_string();
            let on_outcome: DeliveryCallback = Box::new(move |outcome| {
                let (role, content) = match outcome {
                    crate::workers::DeliveryOutcome::Delivered => (MSG_USER, log_answer),
                    crate::workers::DeliveryOutcome::Escalated => (
                        MSG_SYSTEM,
                        format!(
                            "Antwort wurde nicht zugestellt (submit guard eskaliert): {log_answer}"
                        ),
                    ),
                };
                crate::workers::log_message(&log_store, &log_worker, role, &content);
            });
            if let Err(err) = agents.start_task_delivery(
                worker_id,
                &session_id,
                answer,
                readiness_marker.as_deref(),
                Some(on_outcome),
            ) {
                log(
                    store,
                    worker_id,
                    MSG_SYSTEM,
                    &format!("Antwort konnte nicht ins Terminal geschrieben werden: {err}"),
                )
                .await;
            }
        }
        None => {
            log(
                store,
                worker_id,
                MSG_SYSTEM,
                "Antwort notiert, aber dieser Worker hat keinen laufenden Agenten mehr.",
            )
            .await;
        }
    }

    if let Err(err) = store
        .record_status_event(
            worker_id,
            EVENT_ANSWERED,
            &format!("{}: {answer}", question.status),
            SRC_QUESTION,
        )
        .await
    {
        eprintln!("projecta: {err}");
    }

    // Only when this was the last one. A worker may hold up to
    // [`MAX_OPEN_PER_WORKER`] decisions, and answering one of three must not
    // take the card off the board while two are still waiting.
    match store.count_open_questions(worker_id).await {
        Ok(0) => engine.clear_question(worker_id),
        Ok(_) => {}
        Err(err) => eprintln!("projecta: {err}"),
    }
}

/// The sentence a card carries while a decision is waiting.
fn card_reason(question: &str) -> String {
    format!("{REASON_PREFIX}{}", excerpt(question))
}

/// The beginning of the question, on one line and cut to card width.
///
/// Counted in characters rather than bytes - the questions are German and a
/// byte cut would split an umlaut - and cut on a character boundary, never in
/// the middle of the ellipsis it appends.
fn excerpt(question: &str) -> String {
    let single_line: String = question.split_whitespace().collect::<Vec<_>>().join(" ");
    if single_line.chars().count() <= EXCERPT_CHARS {
        return single_line;
    }
    let head: String = single_line.chars().take(EXCERPT_CHARS).collect();
    format!("{}\u{2026}", head.trim_end())
}

/// `"A, B ,C"` as the JSON array the decision tab renders buttons from.
///
/// Empty entries are dropped and a list that is nothing but separators is
/// `None`: an options array with no options in it would make the view offer a
/// choice between nothing and nothing.
fn options_json(options: Option<&str>) -> Option<String> {
    let values: Vec<&str> = options?
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect();
    if values.is_empty() {
        return None;
    }
    serde_json::to_string(&values).ok()
}

/// The refusal a caller gets for a question somebody already closed. Named
/// once so the wording cannot drift between the two places that raise it.
fn already_answered(question: &Question) -> String {
    format!(
        "{ERR_REFUSED}question {} is already {}",
        question.id, question.status
    )
}

/// Append to a worker's log and await the write, so a caller that asserts on
/// the log does not race the insert. A failed write is reported and ignored:
/// losing the log is never a reason to fail the decision.
async fn log(store: &Store, worker_id: &str, role: &str, content: &str) {
    if let Err(err) = store.insert_message(worker_id, role, content).await {
        eprintln!("projecta: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::status::COL_NEEDS_YOU;
    use crate::store::{
        WorkerRow, ANSWERED_BY_HUMAN, ANSWERED_BY_UNVERIFIED, KIND_WORKER, STATUS_RUNNING,
    };
    use crate::testutil::TempDir;
    use std::path::Path;
    use std::sync::Mutex;

    /// An `AgentControl` that only records what was typed at it. The lifecycle
    /// fake lives in `workers.rs`; nothing here spawns anything.
    #[derive(Default)]
    struct Typist {
        writes: Mutex<Vec<(String, String)>>,
        deliveries: Mutex<Vec<Delivery>>,
        /// Outcome callbacks a `hold`ing fake keeps back, so the test can
        /// play the guard and fire the verdict itself.
        outcomes: Mutex<Vec<Option<DeliveryCallback>>>,
        fail: bool,
        hold: bool,
    }

    /// A recorded `start_task_delivery` call: (worker, session, text,
    /// readiness marker).
    type Delivery = (String, String, String, Option<String>);

    impl Typist {
        fn writes(&self) -> Vec<(String, String)> {
            self.writes.lock().unwrap().clone()
        }

        fn deliveries(&self) -> Vec<Delivery> {
            self.deliveries.lock().unwrap().clone()
        }

        /// Fire the guard verdict a `hold`ing fake kept back, like the real
        /// guard does from its thread once delivery is proven or gave up.
        fn confirm(&self, index: usize, outcome: crate::workers::DeliveryOutcome) {
            let callback = self.outcomes.lock().unwrap()[index]
                .take()
                .expect("a pending delivery outcome");
            callback(outcome);
        }
    }

    impl AgentControl for Typist {
        fn spawn(
            &self,
            _worker_id: &str,
            _profile: &crate::profiles::AgentProfile,
            _cwd: &Path,
            _env: &[(String, String)],
        ) -> Result<String, String> {
            unreachable!("questions never spawn an agent")
        }

        fn write(&self, session_id: &str, text: &str) -> Result<(), String> {
            if self.fail {
                return Err("the session is gone".to_string());
            }
            self.writes
                .lock()
                .unwrap()
                .push((session_id.to_string(), text.to_string()));
            Ok(())
        }

        fn start_task_delivery(
            &self,
            worker_id: &str,
            session_id: &str,
            task: &str,
            readiness_marker: Option<&str>,
            on_outcome: Option<DeliveryCallback>,
        ) -> Result<(), String> {
            if self.fail {
                return Err("the session is gone".to_string());
            }
            self.deliveries.lock().unwrap().push((
                worker_id.to_string(),
                session_id.to_string(),
                task.to_string(),
                readiness_marker.map(str::to_string),
            ));
            if let Some(callback) = on_outcome {
                if self.hold {
                    self.outcomes.lock().unwrap().push(Some(callback));
                } else {
                    // The fake's guard confirms at once, like a TUI that
                    // echoes right away.
                    callback(crate::workers::DeliveryOutcome::Delivered);
                }
            }
            Ok(())
        }

        fn kill(&self, _session_id: &str) {}
    }

    /// An `AgentControl` that can only type: it does NOT override
    /// `start_task_delivery`. C-01: the expiry sweep's auto-answer must still
    /// reach the terminal through the trait's blind-write fallback - the old
    /// no-op default dropped it (logged as MSG_USER, never typed).
    #[derive(Default)]
    struct BlindTypist {
        writes: Mutex<Vec<(String, String)>>,
    }

    impl AgentControl for BlindTypist {
        fn spawn(
            &self,
            _worker_id: &str,
            _profile: &crate::profiles::AgentProfile,
            _cwd: &Path,
            _env: &[(String, String)],
        ) -> Result<String, String> {
            unreachable!("questions never spawn an agent")
        }

        fn write(&self, session_id: &str, text: &str) -> Result<(), String> {
            self.writes
                .lock()
                .unwrap()
                .push((session_id.to_string(), text.to_string()));
            Ok(())
        }

        fn kill(&self, _session_id: &str) {}
    }

    struct Fixture {
        _dir: TempDir,
        store: Store,
        engine: StatusEngine,
        project_id: String,
    }

    async fn fixture(label: &str) -> Fixture {
        let dir = TempDir::new(label);
        let store = Store::open(&dir.path().join("projecta.db"))
            .await
            .expect("open store");
        let project = store
            .create_project("ProjectA", "/tmp/projecta")
            .await
            .expect("create project");
        Fixture {
            _dir: dir,
            store,
            engine: StatusEngine::default(),
            project_id: project.id,
        }
    }

    impl Fixture {
        /// A running worker with a live session, which is what an agent that
        /// can be answered looks like.
        async fn worker(&self, id: &str) -> String {
            self.worker_with_profile(id, "claude").await
        }

        /// Wie `worker`, aber mit wählbarem Profil - der Zustellpfad liest
        /// den Readiness-Marker aus ihm.
        async fn worker_with_profile(&self, id: &str, profile_id: &str) -> String {
            let row = WorkerRow {
                id: id.to_string(),
                project_id: self.project_id.clone(),
                task: "eine Aufgabe".to_string(),
                profile_id: profile_id.to_string(),
                branch: format!("pa/{id}"),
                worktree_path: "/tmp/projecta-wt".to_string(),
                status: STATUS_RUNNING.to_string(),
                kind: KIND_WORKER.to_string(),
                pr_url: None,
                spawned_by: None,
                test_status: None,
                tested_at: None,
                role_variant_id: None,
                paused_reason: None,
                created_at: store::now_unix_secs(),
            };
            self.store.insert_worker(&row).await.expect("insert worker");
            self.store.bind_session(id, &format!("pty-{id}")).await;
            let worker = self
                .store
                .get_worker(id)
                .await
                .expect("read worker")
                .expect("worker");
            self.engine.observe_worker(&worker);
            id.to_string()
        }

        async fn roles(&self, worker_id: &str) -> Vec<(String, String)> {
            self.store
                .list_messages(worker_id, None)
                .await
                .expect("messages")
                .into_iter()
                .map(|m| (m.role, m.content))
                .collect()
        }
    }

    /// Poll the log until `found` holds: the guard's outcome callback logs
    /// fire-and-forget through `workers::log_message`, the same way the
    /// round-trip test in workers.rs waits for it.
    async fn wait_for_log(
        fx: &Fixture,
        worker_id: &str,
        what: &str,
        found: impl Fn(&[(String, String)]) -> bool,
    ) -> Vec<(String, String)> {
        for _ in 0..200 {
            let log = fx.roles(worker_id).await;
            if found(&log) {
                return log;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        panic!("{worker_id} never logged {what}");
    }

    #[tokio::test]
    async fn asking_records_the_question_and_raises_the_card() {
        let fx = fixture("ask-raises").await;
        let worker_id = fx.worker("wk-1").await;

        let question = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "  Postgres oder SQLite?  ",
            Some(" Postgres , SQLite "),
        )
        .await
        .expect("ask");

        assert_eq!(question.status, QUESTION_OPEN);
        assert_eq!(question.scope, QUESTION_WORKER);
        assert_eq!(question.question, "Postgres oder SQLite?", "trimmed");
        assert_eq!(
            question.options_json.as_deref(),
            Some(r#"["Postgres","SQLite"]"#)
        );
        assert_eq!(
            question.expires_at,
            Some(question.created_at + TTL_SECS),
            "four hours, from the moment it was asked"
        );

        // The card says what is waiting, in the words the plan asks for.
        let verdict = fx.engine.verdict_for(&worker_id);
        assert_eq!(verdict.column, COL_NEEDS_YOU);
        assert_eq!(
            verdict.reason.as_deref(),
            Some("Entscheidung wartet: Postgres oder SQLite?")
        );

        // And the worker's own log carries the question.
        assert_eq!(
            fx.roles(&worker_id).await,
            vec![(
                MSG_SYSTEM.to_string(),
                "Frage: Postgres oder SQLite?".to_string()
            )]
        );
    }

    #[tokio::test]
    async fn a_preflight_question_has_no_worker_and_no_card() {
        let fx = fixture("ask-preflight").await;

        let question = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            None,
            "Welche Datenbank?",
            None,
        )
        .await
        .expect("ask");

        assert_eq!(question.scope, QUESTION_PREFLIGHT);
        assert_eq!(question.worker_id, None);
        assert_eq!(question.options_json, None, "no options were offered");
        assert_eq!(question.status, QUESTION_OPEN);
    }

    #[tokio::test]
    async fn asking_refuses_what_it_cannot_file() {
        let fx = fixture("ask-refuses").await;
        let worker_id = fx.worker("wk-1").await;

        let empty = ask(&fx.store, &fx.engine, &fx.project_id, None, "   ", None)
            .await
            .expect_err("an empty question");
        assert!(empty.starts_with(ERR_REFUSED), "{empty}");

        let no_project = ask(&fx.store, &fx.engine, "pj-nope", None, "was?", None)
            .await
            .expect_err("an unknown project");
        assert_eq!(no_project, "unknown project: pj-nope");

        let no_worker = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some("wk-nope"),
            "was?",
            None,
        )
        .await
        .expect_err("an unknown worker");
        assert_eq!(no_worker, "unknown worker: wk-nope");

        // A worker that exists, under a project it does not belong to.
        let other = fx
            .store
            .create_project("Zweitprojekt", "/tmp/other")
            .await
            .expect("second project");
        let wrong_project = ask(
            &fx.store,
            &fx.engine,
            &other.id,
            Some(&worker_id),
            "was?",
            None,
        )
        .await
        .expect_err("a worker of another project");
        assert!(wrong_project.starts_with(ERR_REFUSED), "{wrong_project}");

        assert!(
            fx.store
                .list_questions(None, None)
                .await
                .unwrap()
                .is_empty(),
            "a refused ask leaves no row behind"
        );
    }

    #[tokio::test]
    async fn the_fourth_open_question_is_answered_on_the_spot() {
        let fx = fixture("ask-budget").await;
        let worker_id = fx.worker("wk-1").await;

        for i in 0..MAX_OPEN_PER_WORKER {
            let question = ask(
                &fx.store,
                &fx.engine,
                &fx.project_id,
                Some(&worker_id),
                &format!("Frage {i}?"),
                None,
            )
            .await
            .expect("ask");
            assert_eq!(question.status, QUESTION_OPEN);
        }

        let fourth = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "Und noch eine?",
            None,
        )
        .await
        .expect("the fourth ask still answers");

        assert_eq!(fourth.status, QUESTION_REFUSED);
        assert_eq!(fourth.answer.as_deref(), Some(ANSWER_TOO_MANY));
        assert_eq!(fourth.answered_at, Some(fourth.created_at));
        assert_eq!(fourth.expires_at, None, "it never waited for anybody");
        assert_eq!(
            fx.store.count_open_questions(&worker_id).await.unwrap(),
            MAX_OPEN_PER_WORKER,
            "the refused one does not count against the budget either"
        );

        // Answering one makes room again: the budget is about what is open,
        // not about how much was ever asked.
        let open = fx
            .store
            .list_questions(None, Some(QUESTION_OPEN))
            .await
            .unwrap();
        let agents = Typist::default();
        answer(
            &fx.store,
            &agents,
            &fx.engine,
            &open[0].id,
            "Postgres",
            ANSWERED_BY_HUMAN,
        )
        .await
        .expect("answer");
        let fifth = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "Jetzt wieder?",
            None,
        )
        .await
        .expect("ask");
        assert_eq!(fifth.status, QUESTION_OPEN);
    }

    #[tokio::test]
    async fn the_budget_is_counted_per_worker() {
        let fx = fixture("ask-budget-per-worker").await;
        let busy = fx.worker("wk-busy").await;
        let quiet = fx.worker("wk-quiet").await;

        for i in 0..MAX_OPEN_PER_WORKER {
            ask(
                &fx.store,
                &fx.engine,
                &fx.project_id,
                Some(&busy),
                &format!("Frage {i}?"),
                None,
            )
            .await
            .expect("ask");
        }

        let other = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&quiet),
            "Und bei mir?",
            None,
        )
        .await
        .expect("ask");
        assert_eq!(
            other.status, QUESTION_OPEN,
            "another worker has its own budget"
        );
    }

    #[tokio::test]
    async fn answering_types_into_the_terminal_and_clears_the_card() {
        let fx = fixture("answer-delivers").await;
        let worker_id = fx.worker("wk-1").await;
        let agents = Typist::default();

        let question = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "Postgres oder SQLite?",
            None,
        )
        .await
        .expect("ask");
        assert_eq!(fx.engine.verdict_for(&worker_id).column, COL_NEEDS_YOU);

        let answered = answer(
            &fx.store,
            &agents,
            &fx.engine,
            &question.id,
            "SQLite",
            ANSWERED_BY_HUMAN,
        )
        .await
        .expect("answer");

        assert_eq!(answered.status, QUESTION_ANSWERED);
        assert_eq!(answered.answer.as_deref(), Some("SQLite"));
        assert!(answered.answered_at.is_some());
        assert_eq!(
            answered.question, "Postgres oder SQLite?",
            "the answer never overwrites the question"
        );

        // Into the terminal - through the guard (F-CORE-3 B.1), which writes
        // the text and sends Enter itself once the echo proves delivery;
        // claude's captured readiness marker travels along (2026-09-16).
        assert_eq!(
            agents.deliveries(),
            vec![(
                "wk-1".to_string(),
                "pty-wk-1".to_string(),
                "SQLite".to_string(),
                Some("❯ Try \"".to_string())
            )]
        );
        assert!(
            agents.writes().is_empty(),
            "no blind write any more: {:?}",
            agents.writes()
        );
        // And into the log, as the user's turn - once the guard confirms the
        // delivery (C-2). The fake's guard confirms at once; the log write
        // itself is fire-and-forget, so it is polled like in workers.rs.
        let log = wait_for_log(&fx, &worker_id, "the user turn", |log| {
            log.iter().any(|(role, _)| role == MSG_USER)
        })
        .await;
        assert_eq!(
            log,
            vec![
                (
                    MSG_SYSTEM.to_string(),
                    "Frage: Postgres oder SQLite?".to_string()
                ),
                (MSG_USER.to_string(), "SQLite".to_string()),
            ]
        );
        assert_ne!(
            fx.engine.verdict_for(&worker_id).column,
            COL_NEEDS_YOU,
            "nothing is waiting any more"
        );
    }

    #[tokio::test]
    async fn an_answer_is_delivered_through_the_guard() {
        // F-CORE-3 T7 (B.1): die Antwort geht ueber start_task_delivery -
        // den Guard mit Write-Baseline und Marker (Baustein A) - und nicht
        // mehr als blinder `write("{answer}\r")` ins Terminal.
        let fx = fixture("answer-through-guard").await;
        let worker_id = fx.worker_with_profile("wk-1", "opencode").await;
        let agents = Typist::default();

        let question = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "Postgres oder SQLite?",
            None,
        )
        .await
        .expect("ask");
        answer(
            &fx.store,
            &agents,
            &fx.engine,
            &question.id,
            "SQLite",
            ANSWERED_BY_HUMAN,
        )
        .await
        .expect("answer");

        // Der Guard wird mit dem Profil-Marker gerufen (OpenCode: "Ask
        // anything", NT-17) ...
        assert_eq!(
            agents.deliveries(),
            vec![(
                worker_id.clone(),
                "pty-wk-1".to_string(),
                "SQLite".to_string(),
                Some("Ask anything".to_string()),
            )]
        );
        // ... und kein roher Write erreicht den Typist mehr.
        assert!(
            agents.writes().is_empty(),
            "blinder Write statt Guard: {:?}",
            agents.writes()
        );
    }

    #[tokio::test]
    async fn the_card_stays_up_while_another_question_waits() {
        let fx = fixture("answer-partial").await;
        let worker_id = fx.worker("wk-1").await;
        let agents = Typist::default();

        let first = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "Erste?",
            None,
        )
        .await
        .expect("ask");
        ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "Zweite?",
            None,
        )
        .await
        .expect("ask");

        answer(
            &fx.store,
            &agents,
            &fx.engine,
            &first.id,
            "ja",
            ANSWERED_BY_HUMAN,
        )
        .await
        .expect("answer");

        let verdict = fx.engine.verdict_for(&worker_id);
        assert_eq!(verdict.column, COL_NEEDS_YOU);
        assert_eq!(
            verdict.reason.as_deref(),
            Some("Entscheidung wartet: Zweite?"),
            "the card now names what is still open"
        );
    }

    #[tokio::test]
    async fn a_question_is_answered_once() {
        let fx = fixture("answer-once").await;
        let worker_id = fx.worker("wk-1").await;
        let agents = Typist::default();

        let question = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "Wie?",
            None,
        )
        .await
        .expect("ask");
        answer(
            &fx.store,
            &agents,
            &fx.engine,
            &question.id,
            "so",
            ANSWERED_BY_HUMAN,
        )
        .await
        .expect("answer");

        let again = answer(
            &fx.store,
            &agents,
            &fx.engine,
            &question.id,
            "anders",
            ANSWERED_BY_HUMAN,
        )
        .await
        .expect_err("a second answer");
        assert!(again.starts_with(ERR_REFUSED), "{again}");
        assert!(again.contains(QUESTION_ANSWERED), "{again}");

        let unknown = answer(
            &fx.store,
            &agents,
            &fx.engine,
            "qs-nope",
            "so",
            ANSWERED_BY_HUMAN,
        )
        .await
        .expect_err("an unknown id");
        assert_eq!(unknown, "unknown question: qs-nope");

        let stored = fx.store.get_question(&question.id).await.unwrap().unwrap();
        assert_eq!(
            stored.answer.as_deref(),
            Some("so"),
            "the first answer stands"
        );
    }

    #[tokio::test]
    async fn a_worker_without_an_agent_is_still_answered() {
        let fx = fixture("answer-no-session").await;
        let worker_id = fx.worker("wk-1").await;
        let agents = Typist::default();

        let question = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "Wie?",
            None,
        )
        .await
        .expect("ask");
        // The agent exited between the question and the answer.
        fx.store.take_session(&worker_id);

        let answered = answer(
            &fx.store,
            &agents,
            &fx.engine,
            &question.id,
            "so",
            ANSWERED_BY_HUMAN,
        )
        .await
        .expect("the record is still worth having");

        assert_eq!(answered.status, QUESTION_ANSWERED);
        assert!(
            agents.deliveries().is_empty() && agents.writes().is_empty(),
            "there was nothing to type at"
        );
        let log = fx.roles(&worker_id).await;
        assert!(
            log.iter().any(|(role, content)| role == MSG_SYSTEM
                && content.contains("keinen laufenden Agenten")),
            "the undelivered answer is written down: {log:?}"
        );
    }

    #[tokio::test]
    async fn a_terminal_that_refuses_the_write_is_written_down() {
        let fx = fixture("answer-write-fails").await;
        let worker_id = fx.worker("wk-1").await;
        let agents = Typist {
            fail: true,
            ..Typist::default()
        };

        let question = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "Wie?",
            None,
        )
        .await
        .expect("ask");
        answer(
            &fx.store,
            &agents,
            &fx.engine,
            &question.id,
            "so",
            ANSWERED_BY_HUMAN,
        )
        .await
        .expect("the row is closed either way");

        let log = fx.roles(&worker_id).await;
        assert!(
            log.iter().any(|(role, content)| role == MSG_SYSTEM
                && content.contains("nicht ins Terminal")),
            "{log:?}"
        );
    }

    #[tokio::test]
    async fn a_preflight_answer_touches_no_terminal() {
        let fx = fixture("answer-preflight").await;
        let agents = Typist::default();

        let question = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            None,
            "Welche DB?",
            None,
        )
        .await
        .expect("ask");
        let answered = answer(
            &fx.store,
            &agents,
            &fx.engine,
            &question.id,
            "SQLite",
            ANSWERED_BY_HUMAN,
        )
        .await
        .expect("answer");

        assert_eq!(answered.status, QUESTION_ANSWERED);
        assert!(agents.writes().is_empty());
    }

    /// `status` says what happened to a question; `answered_by` says who made
    /// it happen, and only a caller can be one. The clock is not a who.
    #[tokio::test]
    async fn the_row_records_who_answered_and_leaves_it_empty_when_nobody_did() {
        let fx = fixture("questions-answered-by").await;
        let worker_id = fx.worker("wk-1").await;
        let agents = Typist::default();

        let proven = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "A?",
            None,
        )
        .await
        .expect("ask");
        let closed = answer(
            &fx.store,
            &agents,
            &fx.engine,
            &proven.id,
            "ja",
            ANSWERED_BY_HUMAN,
        )
        .await
        .expect("answer");
        assert_eq!(closed.answered_by.as_deref(), Some(ANSWERED_BY_HUMAN));
        // And it survives the round trip through the column, not just the
        // struct this function happened to build.
        let read = fx
            .store
            .get_question(&proven.id)
            .await
            .unwrap()
            .expect("stored");
        assert_eq!(read.answered_by.as_deref(), Some(ANSWERED_BY_HUMAN));

        let unproven = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "B?",
            None,
        )
        .await
        .expect("ask");
        let closed = answer(
            &fx.store,
            &agents,
            &fx.engine,
            &unproven.id,
            "ja",
            ANSWERED_BY_UNVERIFIED,
        )
        .await
        .expect("answer");
        assert_eq!(closed.answered_by.as_deref(), Some(ANSWERED_BY_UNVERIFIED));

        // The clock closes a row without answering it. Filing that as
        // "unverified" would put the expiry sweep in the same box as a person
        // who did not carry a token, and they are not the same thing - which
        // is the whole reason `status` keeps `expired` separate.
        let stale = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "C?",
            None,
        )
        .await
        .expect("ask");
        let swept = expire_due(
            &fx.store,
            &agents,
            &fx.engine,
            stale.expires_at.expect("deadline") + 1,
        )
        .await
        .expect("sweep");
        let swept = swept.iter().find(|q| q.id == stale.id).expect("swept");
        assert_eq!(swept.status, QUESTION_EXPIRED);
        assert_eq!(swept.answered_by, None);
    }

    #[tokio::test]
    async fn a_question_nobody_answered_expires_into_an_auto_answer() {
        let fx = fixture("expire").await;
        let worker_id = fx.worker("wk-1").await;
        let agents = Typist::default();

        let question = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "Wie?",
            None,
        )
        .await
        .expect("ask");
        let deadline = question.expires_at.expect("a deadline");

        // A minute before: nothing is due yet.
        assert!(expire_due(&fx.store, &agents, &fx.engine, deadline - 60)
            .await
            .expect("sweep")
            .is_empty());
        assert_eq!(fx.engine.verdict_for(&worker_id).column, COL_NEEDS_YOU);

        let expired = expire_due(&fx.store, &agents, &fx.engine, deadline)
            .await
            .expect("sweep");

        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].status, QUESTION_EXPIRED);
        assert_eq!(expired[0].answer.as_deref(), Some(ANSWER_EXPIRED));
        // The agent ended its turn waiting for an answer, so the auto-answer
        // has to reach the terminal or it waits forever - delivered through
        // the guard like a human answer (F-CORE-3 B.1).
        assert_eq!(
            agents.deliveries(),
            vec![(
                "wk-1".to_string(),
                "pty-wk-1".to_string(),
                ANSWER_EXPIRED.to_string(),
                Some("❯ Try \"".to_string())
            )]
        );
        assert!(agents.writes().is_empty(), "no blind write any more");
        assert_ne!(fx.engine.verdict_for(&worker_id).column, COL_NEEDS_YOU);

        // And the sweep does not answer the same row twice.
        assert!(
            expire_due(&fx.store, &agents, &fx.engine, deadline + 10_000)
                .await
                .expect("sweep")
                .is_empty()
        );
    }

    #[tokio::test]
    async fn an_answer_reaches_a_write_only_control_via_the_blind_fallback() {
        // C-01 (Review DeepSeek, hoch): ein Control, das nur `write`
        // implementiert (kein Guard), muss die Antwort trotzdem zustellen -
        // der Trait-Default faellt auf den blinden Write zurueck statt den
        // Text still zu verwerfen. Vor B.1 tippte PtyWriter::write die
        // Auto-Antwort real; danach traf der Sweep den No-op-Default und die
        // ANSWER_EXPIRED-Antwort erreichte das PTY nie.
        let fx = fixture("expire-blind-fallback").await;
        let worker_id = fx.worker("wk-1").await;
        let agents = BlindTypist::default();

        let question = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "Wie?",
            None,
        )
        .await
        .expect("ask");
        let deadline = question.expires_at.expect("a deadline");

        let expired = expire_due(&fx.store, &agents, &fx.engine, deadline)
            .await
            .expect("sweep");
        assert_eq!(expired.len(), 1);

        let writes = agents.writes.lock().unwrap().clone();
        assert_eq!(
            writes,
            vec![("pty-wk-1".to_string(), format!("{ANSWER_EXPIRED}\r"),)],
            "die Auto-Antwort muss das Terminal erreichen, notfalls blind"
        );
    }

    #[tokio::test]
    async fn the_user_turn_is_logged_only_after_proven_delivery() {
        // C-2 (Review Claude, hoch): MSG_USER stand hinter dem Guard-*Start* -
        // Ok(()) heisst nur "Guard-Thread laeuft" -, nicht hinter der
        // bewiesenen Zustellung, und der Doc-Kommentar behauptete das
        // Gegenteil. Spec B.1: die Logzeile wandert hinter die *bewiesene*
        // Zustellung. Jetzt folgt sie dem Guard-Ergebnis (on_outcome).
        let fx = fixture("log-after-delivery").await;
        let worker_id = fx.worker("wk-1").await;
        let agents = Typist {
            hold: true,
            ..Typist::default()
        };

        let question = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "Wie?",
            None,
        )
        .await
        .expect("ask");
        answer(
            &fx.store,
            &agents,
            &fx.engine,
            &question.id,
            "so",
            ANSWERED_BY_HUMAN,
        )
        .await
        .expect("answer");

        // Der Guard hat noch nichts bestaetigt: keine Nutzerwende im Log.
        let log = fx.roles(&worker_id).await;
        assert!(
            !log.iter().any(|(role, _)| role == MSG_USER),
            "MSG_USER vor der bewiesenen Zustellung: {log:?}"
        );

        // Der Guard bestaetigt die Zustellung: erst jetzt wird die Antwort
        // zur Nutzerwende.
        agents.confirm(0, crate::workers::DeliveryOutcome::Delivered);
        let log = wait_for_log(&fx, &worker_id, "the confirmed user turn", |log| {
            log.iter().any(|(role, _)| role == MSG_USER)
        })
        .await;
        assert!(
            log.iter()
                .any(|(role, content)| role == MSG_USER && content == "so"),
            "{log:?}"
        );

        // Eine Eskalation wird aufgeschrieben als das, was sie ist: die
        // Antwort wurde nicht zugestellt - sie ist keine Nutzerwende.
        let second = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "Noch was?",
            None,
        )
        .await
        .expect("ask 2");
        answer(
            &fx.store,
            &agents,
            &fx.engine,
            &second.id,
            "anders",
            ANSWERED_BY_HUMAN,
        )
        .await
        .expect("answer 2");
        agents.confirm(1, crate::workers::DeliveryOutcome::Escalated);
        let log = wait_for_log(&fx, &worker_id, "the escalation note", |log| {
            log.iter()
                .any(|(role, content)| role == MSG_SYSTEM && content.contains("nicht zugestellt"))
        })
        .await;
        assert!(
            !log.iter()
                .any(|(role, content)| role == MSG_USER && content == "anders"),
            "eine eskalierte Antwort ist keine Nutzerwende: {log:?}"
        );
    }

    #[tokio::test]
    async fn an_answered_question_never_expires() {
        let fx = fixture("expire-answered").await;
        let worker_id = fx.worker("wk-1").await;
        let agents = Typist::default();

        let question = ask(
            &fx.store,
            &fx.engine,
            &fx.project_id,
            Some(&worker_id),
            "Wie?",
            None,
        )
        .await
        .expect("ask");
        answer(
            &fx.store,
            &agents,
            &fx.engine,
            &question.id,
            "so",
            ANSWERED_BY_HUMAN,
        )
        .await
        .expect("answer");

        let swept = expire_due(
            &fx.store,
            &agents,
            &fx.engine,
            question.expires_at.unwrap() + 1,
        )
        .await
        .expect("sweep");

        assert!(swept.is_empty());
        let stored = fx.store.get_question(&question.id).await.unwrap().unwrap();
        assert_eq!(stored.status, QUESTION_ANSWERED);
        assert_eq!(stored.answer.as_deref(), Some("so"));
    }

    #[test]
    fn a_long_question_is_cut_to_card_width() {
        let short = card_reason("Postgres\n  oder   SQLite?");
        assert_eq!(short, "Entscheidung wartet: Postgres oder SQLite?");

        let long = "\u{e4}".repeat(200);
        let reason = card_reason(&long);
        let text = reason.strip_prefix(REASON_PREFIX).expect("the prefix");
        assert_eq!(text.chars().count(), EXCERPT_CHARS + 1, "cut plus ellipsis");
        assert!(text.ends_with('\u{2026}'));
    }

    #[test]
    fn options_become_a_json_array_or_nothing() {
        assert_eq!(
            options_json(Some("A, B ,C")).as_deref(),
            Some(r#"["A","B","C"]"#)
        );
        assert_eq!(options_json(None), None);
        assert_eq!(
            options_json(Some("   ")),
            None,
            "no options is not an empty list"
        );
        assert_eq!(options_json(Some(",,,")), None);
    }
}
