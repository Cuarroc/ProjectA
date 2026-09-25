//! Cancelling a queue entry that is already `dispatched` (W1-05b, store half).
//!
//! A dispatched row points at a worker, and dropping it while that worker's
//! agent is still alive leaves a running agent that the queue no longer
//! knows about. So the row may go only once the end of the agent's process
//! is *proven*, and the only proof the store holds is an observed exit:
//!
//! - the worker has at least one `sessions` row, and every one of them
//!   carries `ended_at`. That column is written by the exit hooks alone
//!   ([`Store::mark_session_exited`], the pending-exit fold in
//!   [`Store::record_session_start`], the native finalizer) - each one is a
//!   process end somebody saw, and an archive's kill counts once its exit
//!   report arrives;
//! - this process holds no binding for the worker, neither a live PTY session
//!   nor a native session in the middle of being finalized;
//! - the worker row is no longer [`STATUS_RUNNING`].
//!
//! Anything short of that is refused, fail-closed, with the reason that is
//! missing. In particular a session row left open by a crash or a kill -9 is
//! "ended, we do not know how", and a status column or an expired lease is
//! bookkeeping, not evidence that a process has stopped. Refusals open with
//! [`crate::workers::ERR_REFUSED`], like every other refused cancel.
//!
//! The rule assumes worker ids are never reused: they come from `new_id`, and
//! `sessions` has no foreign key, so a reused id would inherit the closed
//! sessions of the worker that held it before.

use super::*;

/// What the store knows about the worker behind one dispatched entry.
#[derive(Debug, Clone, PartialEq, Eq)]
enum DispatchedWorker {
    /// The entry names no worker at all.
    Unnamed,
    /// The entry names a worker whose row no longer exists.
    Missing(String),
    Known {
        id: String,
        status: String,
        /// A PTY session or a native finalization is bound in this process.
        bound_in_memory: bool,
        sessions: i64,
        /// Session rows without `ended_at`: no exit was ever observed.
        open_sessions: i64,
    },
}

/// The rule itself: `Ok(worker id)` when the process end is proven, otherwise
/// the refusal, already prefixed with [`crate::workers::ERR_REFUSED`].
fn proven_process_end(task: &str, worker: &DispatchedWorker) -> Result<String, String> {
    let refuse = |why: String| {
        Err(format!(
            "{}task {task} is dispatched and {why}; it can be cancelled only once its \
             process end is proven",
            crate::workers::ERR_REFUSED
        ))
    };
    match worker {
        DispatchedWorker::Unnamed => refuse("names no worker".into()),
        DispatchedWorker::Missing(id) => refuse(format!("worker {id} is not on record")),
        DispatchedWorker::Known {
            id,
            status,
            bound_in_memory,
            sessions,
            open_sessions,
        } => {
            if *bound_in_memory {
                refuse(format!("worker {id} still has a live session"))
            } else if status == STATUS_RUNNING {
                refuse(format!("worker {id} is still running"))
            } else if *sessions == 0 {
                refuse(format!("worker {id} has no recorded session"))
            } else if *open_sessions > 0 {
                refuse(format!(
                    "{open_sessions} session(s) of worker {id} never reported an exit"
                ))
            } else {
                Ok(id.clone())
            }
        }
    }
}

impl Store {
    /// Whether this process holds any binding for `worker_id`. A poisoned map
    /// reads as bound: not knowing is not proof.
    ///
    /// Called while the cancel transaction holds SQLite's write lock, so the
    /// lock order is database, then session map. That cannot invert: every
    /// holder of the session map (`bind_session_in_memory`, `take_session`,
    /// `session_for_worker`, `worker_for_session`, the scoped block in the
    /// native finalizer) is synchronous and releases it before its next await
    /// or database call.
    fn worker_bound_in_memory(&self, worker_id: &str) -> bool {
        match self.sessions.lock() {
            Ok(bindings) => {
                bindings.by_worker.contains_key(worker_id)
                    || bindings.native_closing.contains_key(worker_id)
            }
            Err(_) => true,
        }
    }

    /// The `dispatched` arm of [`Store::cancel_queue_entry`], inside its
    /// transaction. That transaction's first statement already took SQLite's
    /// write lock, so no session exit, session row or status write can land
    /// between the facts read here and the delete that acts on them.
    ///
    /// The in-memory binding is not under that lock. It is read last, with
    /// nothing but the pure rule between it and the delete, so the remaining
    /// window is inherent: a respawn that binds in exactly that instant starts
    /// a new run by an explicit user action, and the queue row it outlives
    /// belonged to the run that was proven over.
    ///
    /// The outer `Err` is a store failure (`failed to ...`, rolled back by
    /// dropping the transaction); the inner result is the cancel's outcome. The delete is pinned to the status and the
    /// worker that were judged, and removes only the queue row: the worker,
    /// its sessions and its history stay.
    pub(super) async fn cancel_dispatched_in(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
        id: &str,
        worker_id: Option<String>,
    ) -> Result<Result<(), String>, String> {
        let worker = match worker_id {
            None => DispatchedWorker::Unnamed,
            Some(worker_id) => {
                let facts: Option<(String, i64, i64)> = sqlx::query_as(
                    "SELECT w.status, \
                     (SELECT COUNT(*) FROM sessions s WHERE s.worker_id = w.id), \
                     (SELECT COUNT(*) FROM sessions s \
                      WHERE s.worker_id = w.id AND s.ended_at IS NULL) \
                     FROM workers w WHERE w.id = ?1",
                )
                .bind(&worker_id)
                .fetch_optional(&mut **tx)
                .await
                .map_err(|e| format!("failed to read dispatched task's worker: {e}"))?;
                match facts {
                    None => DispatchedWorker::Missing(worker_id),
                    Some((status, sessions, open_sessions)) => DispatchedWorker::Known {
                        bound_in_memory: self.worker_bound_in_memory(&worker_id),
                        id: worker_id,
                        status,
                        sessions,
                        open_sessions,
                    },
                }
            }
        };
        let worker_id = match proven_process_end(id, &worker) {
            Ok(worker_id) => worker_id,
            Err(refusal) => return Ok(Err(refusal)),
        };
        let deleted =
            sqlx::query("DELETE FROM task_queue WHERE id = ?1 AND status = ?2 AND worker_id = ?3")
                .bind(id)
                .bind(QUEUE_DISPATCHED)
                .bind(&worker_id)
                .execute(&mut **tx)
                .await
                .map_err(|e| format!("failed to cancel dispatched task: {e}"))?;
        if deleted.rows_affected() == 1 {
            Ok(Ok(()))
        } else {
            // Unreachable under the write lock, so a store anomaly rather than
            // a refusal: reported as a failure, never dressed up as a 409.
            Err(format!(
                "failed to cancel dispatched task {id}: the pinned delete matched {} rows",
                deleted.rows_affected()
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::testutil::TempDir;

    async fn fixture() -> (TempDir, Store, String) {
        let dir = TempDir::new("store-queue-cancel");
        let store = Store::open(&dir.path().join("projecta.db"))
            .await
            .expect("open store");
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        (dir, store, project.id)
    }

    fn worker(project: &str, id: &str, status: &str) -> WorkerRow {
        WorkerRow {
            id: id.into(),
            project_id: project.into(),
            task: "do it".into(),
            profile_id: "claude".into(),
            branch: String::new(),
            worktree_path: String::new(),
            status: status.into(),
            kind: KIND_WORKER.into(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            role_variant_id: None,
            paused_reason: None,
            created_at: 1,
        }
    }

    /// Puts `tq` into `dispatched` under `worker` - through the real claim
    /// and mark, so the row is exactly what a sweep leaves behind.
    async fn dispatch(store: &Store, project: &str, tq: &str, worker_id: &str) {
        store
            .insert_queue_entry(&QueueEntry {
                id: tq.into(),
                project_id: project.into(),
                raw_text: "do it".into(),
                sharpened_text: None,
                profile_id: "claude".into(),
                status: QUEUE_READY.into(),
                priority: 0,
                worker_id: None,
                error: None,
                spawned_by: None,
                created_at: 42,
            })
            .await
            .unwrap();
        store
            .insert_worker(&worker(project, worker_id, STATUS_RUNNING))
            .await
            .unwrap();
        assert!(store.claim_queue_entry(tq).await.unwrap());
        store.mark_queue_dispatched(tq, worker_id, 4).await.unwrap();
    }

    async fn status_of(store: &Store, tq: &str) -> Option<String> {
        store.get_queue_entry(tq).await.unwrap().map(|e| e.status)
    }

    fn assert_refused(err: &str, reason: &str) {
        assert!(err.starts_with(crate::workers::ERR_REFUSED), "{err}");
        assert!(err.contains(reason), "expected {reason:?} in {err:?}");
    }

    /// The one way out of `dispatched`: every session the worker ever had was
    /// seen to end by an exit hook, nothing is bound to it in memory, and the
    /// worker is no longer `running`. Then the row goes - that row only.
    #[tokio::test]
    async fn a_dispatched_task_whose_process_exit_was_observed_can_be_cancelled() {
        let (_dir, store, project) = fixture().await;
        dispatch(&store, &project, "tq-done", "wk-done").await;
        dispatch(&store, &project, "tq-other", "wk-other").await;
        // Two runs of the same worker (a respawn), both seen to end.
        store.bind_session("wk-done", "s-first").await;
        store.mark_session_exited("s-first", Some(1)).await.unwrap();
        store.bind_session("wk-done", "s-done").await;
        store.mark_session_exited("s-done", Some(0)).await.unwrap();
        assert_eq!(
            store.get_worker("wk-done").await.unwrap().unwrap().status,
            STATUS_EXITED
        );

        store.cancel_queue_entry("tq-done").await.unwrap();

        assert_eq!(status_of(&store, "tq-done").await, None);
        assert_eq!(
            status_of(&store, "tq-other").await.as_deref(),
            Some(QUEUE_DISPATCHED)
        );
        // The worker and its history stay: cancelling drops the queue row,
        // not the evidence that the run happened.
        assert!(store.get_worker("wk-done").await.unwrap().is_some());
        let (sessions,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM sessions WHERE worker_id = 'wk-done'")
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(sessions, 2);
        let err = store.cancel_queue_entry("tq-done").await.unwrap_err();
        assert!(err.starts_with(crate::workers::ERR_UNKNOWN), "{err}");
    }

    /// An archive kills the session, and the kill's own exit report closes the
    /// row: that is the same observed end, so an archived worker qualifies
    /// once - and only once - its exit arrived.
    #[tokio::test]
    async fn an_archived_worker_qualifies_only_after_its_kill_was_seen_to_land() {
        let (_dir, store, project) = fixture().await;
        dispatch(&store, &project, "tq-arch", "wk-arch").await;
        store.bind_session("wk-arch", "s-arch").await;
        // What `archive_worker` does: unbind, kill, write the status.
        store.take_session("wk-arch");
        store
            .set_worker_status("wk-arch", STATUS_ARCHIVED)
            .await
            .unwrap();

        let err = store.cancel_queue_entry("tq-arch").await.unwrap_err();
        assert_refused(
            &err,
            "1 session(s) of worker wk-arch never reported an exit",
        );
        assert_eq!(
            status_of(&store, "tq-arch").await.as_deref(),
            Some(QUEUE_DISPATCHED)
        );

        store.mark_session_exited("s-arch", None).await.unwrap();
        store.cancel_queue_entry("tq-arch").await.unwrap();
        assert_eq!(status_of(&store, "tq-arch").await, None);
    }

    #[tokio::test]
    async fn a_running_worker_keeps_its_dispatched_task() {
        let (_dir, store, project) = fixture().await;
        dispatch(&store, &project, "tq-run", "wk-run").await;
        store.bind_session("wk-run", "s-run").await;

        let err = store.cancel_queue_entry("tq-run").await.unwrap_err();
        assert_refused(&err, "still has a live session");
        assert_eq!(
            status_of(&store, "tq-run").await.as_deref(),
            Some(QUEUE_DISPATCHED)
        );

        // No binding in this process - an app restart forgets them - but the
        // row still says running and nothing saw it end.
        store.take_session("wk-run");
        let err = store.cancel_queue_entry("tq-run").await.unwrap_err();
        assert_refused(&err, "is still running");
        assert_eq!(
            status_of(&store, "tq-run").await.as_deref(),
            Some(QUEUE_DISPATCHED)
        );
    }

    /// A crash or a kill -9 of the app leaves a session row that never got its
    /// `ended_at`. "Ended, we do not know how" is not proof that the agent is
    /// gone, whatever the worker's status column has been set to since.
    #[tokio::test]
    async fn a_session_that_never_reported_an_exit_is_not_proof() {
        let (_dir, store, project) = fixture().await;
        dispatch(&store, &project, "tq-crash", "wk-crash").await;
        store.bind_session("wk-crash", "s-old").await;
        store.mark_session_exited("s-old", Some(0)).await.unwrap();
        // A respawn opened a second session that the app never saw end.
        store.bind_session("wk-crash", "s-lost").await;
        store.take_session("wk-crash");
        store
            .set_worker_status("wk-crash", STATUS_EXITED)
            .await
            .unwrap();

        let err = store.cancel_queue_entry("tq-crash").await.unwrap_err();
        assert_refused(
            &err,
            "1 session(s) of worker wk-crash never reported an exit",
        );
        assert_eq!(
            status_of(&store, "tq-crash").await.as_deref(),
            Some(QUEUE_DISPATCHED)
        );
    }

    /// No session row at all means nothing was ever observed, so nothing can
    /// have been observed to end.
    #[tokio::test]
    async fn a_worker_without_any_recorded_session_is_not_proof() {
        let (_dir, store, project) = fixture().await;
        dispatch(&store, &project, "tq-bare", "wk-bare").await;
        store
            .set_worker_status("wk-bare", STATUS_EXITED)
            .await
            .unwrap();

        let err = store.cancel_queue_entry("tq-bare").await.unwrap_err();
        assert_refused(&err, "wk-bare has no recorded session");
        assert_eq!(
            status_of(&store, "tq-bare").await.as_deref(),
            Some(QUEUE_DISPATCHED)
        );
    }

    /// A worker row that is gone, or a dispatched row that names no worker,
    /// leaves nothing to prove the end with: refused, never guessed.
    #[tokio::test]
    async fn a_dispatched_task_without_its_worker_row_is_refused() {
        let (_dir, store, project) = fixture().await;
        dispatch(&store, &project, "tq-orphan", "wk-orphan").await;
        sqlx::query("DELETE FROM workers WHERE id = 'wk-orphan'")
            .execute(&store.pool)
            .await
            .unwrap();
        let err = store.cancel_queue_entry("tq-orphan").await.unwrap_err();
        assert_refused(&err, "worker wk-orphan is not on record");

        dispatch(&store, &project, "tq-anon", "wk-anon").await;
        sqlx::query("UPDATE task_queue SET worker_id = NULL WHERE id = 'tq-anon'")
            .execute(&store.pool)
            .await
            .unwrap();
        let err = store.cancel_queue_entry("tq-anon").await.unwrap_err();
        assert_refused(&err, "tq-anon is dispatched and names no worker");

        for tq in ["tq-orphan", "tq-anon"] {
            assert_eq!(
                status_of(&store, tq).await.as_deref(),
                Some(QUEUE_DISPATCHED)
            );
        }
    }

    /// A native session that is being finalized is still in the middle of its
    /// end, not past it.
    #[tokio::test]
    async fn a_native_session_being_finalized_is_not_yet_proof() {
        let (_dir, store, project) = fixture().await;
        dispatch(&store, &project, "tq-nat", "wk-nat").await;
        store.bind_session("wk-nat", "s-nat").await;
        store.mark_session_exited("s-nat", Some(0)).await.unwrap();
        store
            .sessions
            .lock()
            .unwrap()
            .native_closing
            .insert("wk-nat".into(), "s-nat".into());

        let err = store.cancel_queue_entry("tq-nat").await.unwrap_err();
        assert_refused(&err, "still has a live session");
        assert_eq!(
            status_of(&store, "tq-nat").await.as_deref(),
            Some(QUEUE_DISPATCHED)
        );
    }

    /// A poisoned session map means the store cannot tell whether the worker
    /// is bound, and not knowing is not proof.
    #[tokio::test]
    async fn a_poisoned_session_map_is_not_proof() {
        let (_dir, store, project) = fixture().await;
        dispatch(&store, &project, "tq-poison", "wk-poison").await;
        store.bind_session("wk-poison", "s-poison").await;
        store
            .mark_session_exited("s-poison", Some(0))
            .await
            .unwrap();
        let sessions = std::sync::Arc::clone(&store.sessions);
        let _ = std::thread::spawn(move || {
            let _guard = sessions.lock().unwrap();
            panic!("poison the session map");
        })
        .join();
        assert!(store.sessions.is_poisoned());

        let err = store.cancel_queue_entry("tq-poison").await.unwrap_err();
        assert_refused(&err, "worker wk-poison still has a live session");
        assert_eq!(
            status_of(&store, "tq-poison").await.as_deref(),
            Some(QUEUE_DISPATCHED)
        );
    }

    /// The pinned delete matching nothing is a store anomaly, not a business
    /// refusal: it must surface as a `failed to` store error (500), and the
    /// row must stay. A trigger that swallows the delete stands in for the
    /// "cannot happen under the write lock" case.
    #[tokio::test]
    async fn a_pinned_delete_that_matches_nothing_is_a_store_failure() {
        let (_dir, store, project) = fixture().await;
        dispatch(&store, &project, "tq-ghost", "wk-ghost").await;
        store.bind_session("wk-ghost", "s-ghost").await;
        store.mark_session_exited("s-ghost", Some(0)).await.unwrap();
        sqlx::query(
            "CREATE TRIGGER swallow_queue_delete BEFORE DELETE ON task_queue \
             BEGIN SELECT RAISE(IGNORE); END",
        )
        .execute(&store.pool)
        .await
        .unwrap();

        let err = store.cancel_queue_entry("tq-ghost").await.unwrap_err();
        assert!(err.starts_with("failed to "), "{err}");
        assert!(!err.starts_with(crate::workers::ERR_REFUSED), "{err}");
        assert_eq!(
            status_of(&store, "tq-ghost").await.as_deref(),
            Some(QUEUE_DISPATCHED)
        );
    }

    /// Failed and claimed entries keep their old refusal: this rule opens
    /// `dispatched` and nothing else.
    #[tokio::test]
    async fn other_states_keep_the_plain_refusal() {
        let (_dir, store, project) = fixture().await;
        dispatch(&store, &project, "tq-fail", "wk-fail").await;
        store.mark_queue_failed("tq-fail", "boom").await.unwrap();
        let err = store.cancel_queue_entry("tq-fail").await.unwrap_err();
        assert_refused(&err, "is failed, not queued or ready");
    }
}
