# Review request PR #19 (W1-05b, api half): cancel route over the dispatched rule

You are an independent reviewer (not the author; the author is a Claude model).
Review the COMPLETE candidate below for correctness bugs, gaps against the
requirements, and safety regressions. Be concrete: cite file and line, say what
breaks and when. Rate each finding high/medium/low. Do not restate the diff. If
something is fine, say nothing about it. Answer in English or German. This is a
READ-ONLY review: do not modify any files.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal" (Rust backend in src-tauri/, public
GitHub repo). A local control api (src-tauri/src/api.rs, `ControlBackend` trait,
HTTP on 127.0.0.1 with a token) exposes `POST /api/queue/<id>/cancel`. It calls
`Store::cancel_queue_entry` and maps the store's error sentence to a status via
`core_status`: opening `unknown ` -> 404, `refused: ` -> 409, anything else -> 500.
The store rule (already on main, src-tauri/src/store/queue_cancel.rs, read it) lets
a `dispatched` queue entry be cancelled only when the end of its agent's process is
proven (`proven_process_end`): a live session, a session that never reported an
exit, no session row, or a worker still `running` all refuse; a pinned delete that
matches nothing is a store failure (`failed to ...`, 500), never a 409.

## Package requirement

W1-05b (api half): the cancel route must hand a `dispatched` task to the store's
rule and say what the rule said (200 `{ok: true}` only on a proven process end,
else 409 with the store's reason and the row left untouched, 404 for an unknown
id, 500 for a store failure). A task must never vanish from the queue while an
agent behind it may still be alive. No production change is intended: the route
already passes the rule through; the diff adds the end-to-end proof (real HTTP
server, real SQLite database, fake backend that delegates cancel to the real
store exactly as main.rs does), docs, and a `core_status` pin.

## Review history

An earlier review of the identical api.rs diff in the predecessor repo (Grok, Kimi K3) found two low
points, both already in the diff: the fifth task `tq-running` (worker still
`running`, no session, no binding) and re-reading all refused rows after the 200.
Check those are correct, and hunt for NEW problems: wrong or weak assertions, test
flakiness (ports, drop order, temp dirs), docs that contradict the store rule, a
branch of the rule the route could mis-map, a test that would stay green if the
route or the fake were broken.

## Diff (git diff origin/main...HEAD -- src-tauri/src/api.rs, candidate e91c3db)

```diff
diff --git a/src-tauri/src/api.rs b/src-tauri/src/api.rs
index d6728b9..4649156 100644
--- a/src-tauri/src/api.rs
+++ b/src-tauri/src/api.rs
@@ -139,6 +139,18 @@
 //! class named both routes in one breath
 //! (`docs/audits/2026-09-03-analyse-claude-web/karten/services.md`).
 //!
+//! An entry that is already `dispatched` is a 409 too, unless the store can
+//! prove the end of its agent's process (W1-05b): then the row goes and the
+//! answer is the plain `{ok: true}`. The route does not judge that itself -
+//! it reads the opening of the store's sentence like every other refusal and
+//! passes the rest through, so the 409 body names what is missing (`worker
+//! wk-1 still has a live session`, `1 session(s) of worker wk-1 never reported
+//! an exit`, `worker wk-1 has no recorded session`, ...). A refused entry stays
+//! in the queue untouched; the second cancel of a removed one is a 404. A store
+//! anomaly during the delete keeps its `failed to` opening and is a 500, never
+//! a refusal dressed as a 409. The reasons are the store's, in
+//! `store/queue_cancel.rs`.
+//!
 //! The routes that *list* something for one project - `/api/workers`,
 //! `/api/queue`, `/api/projects/<id>/tree` and their neighbours - answered an
 //! empty collection for a project id that names nothing, because the store
@@ -524,6 +536,10 @@ pub trait ControlBackend: Send + Sync {
 
     fn list_queue(&self, project_id: Option<&str>) -> Result<Vec<QueueEntry>, String>;
 
+    /// Drop a queue entry: `unknown ` for an id that names nothing, `refused: `
+    /// for an entry the store may not drop (claimed, failed, or `dispatched`
+    /// without a proven process end - see `store/queue_cancel.rs`), anything
+    /// else for a store that fell over.
     fn cancel_queued_task(&self, id: &str) -> Result<(), String>;
 
     // -- scout and recommendations (Phase 7.1) -----------------------------
@@ -2758,6 +2774,10 @@ pub(crate) mod tests {
         plan_imports: Mutex<Vec<PlanImportRecord>>,
         native_claim: Option<(String, String, i64)>,
         native_store: Option<crate::store::Store>,
+        /// W1-05b: when set, `cancel_queued_task` is the real store rule
+        /// instead of the canned answers, so a test can watch the route and
+        /// the rule agree end to end.
+        queue_store: Option<crate::store::Store>,
         checkpoints: Mutex<HashMap<String, Value>>,
         reject_agent_run: std::sync::atomic::AtomicBool,
         created: Mutex<Vec<SpawnRecord>>,
@@ -3537,6 +3557,10 @@ pub(crate) mod tests {
         }
 
         fn cancel_queued_task(&self, id: &str) -> Result<(), String> {
+            if let Some(store) = &self.queue_store {
+                // What `main.rs` does: the store's rule, nothing in between.
+                return tauri::async_runtime::block_on(store.cancel_queue_entry(id));
+            }
             // The three answers `store::cancel_queue_entry` can give, in its
             // own words: an id that names nothing, an entry a claim has
             // already taken past queued or ready, and a store that fell over.
@@ -7294,6 +7318,181 @@ pub(crate) mod tests {
         }
     }
 
+    /// A server whose cancel route runs the real store rule over a real
+    /// database, with the five dispatched tasks a PC can be left with.
+    struct DispatchedRoute {
+        server: ApiServer,
+        store: crate::store::Store,
+        /// Last, so the directory outlives the server and the pool on drop.
+        _dir: TempDir,
+    }
+
+    impl DispatchedRoute {
+        fn token(&self) -> String {
+            let raw =
+                std::fs::read_to_string(self.server.descriptor_path()).expect("read descriptor");
+            let descriptor: Value = serde_json::from_str(&raw).expect("parse descriptor");
+            descriptor["token"].as_str().expect("token").to_string()
+        }
+
+        /// The queue row's status, or `None` once it is gone.
+        fn queue_status(&self, id: &str) -> Option<String> {
+            tauri::async_runtime::block_on(self.store.list_queue(None))
+                .unwrap()
+                .into_iter()
+                .find(|entry| entry.id == id)
+                .map(|entry| entry.status)
+        }
+    }
+
+    /// `tq-proven` ended and was seen to end. `tq-crashed` has a session the
+    /// app never saw end, `tq-live` is bound to a running agent, `tq-bare`
+    /// has no session row at all, `tq-running` is nothing but a worker row
+    /// still marked running: four ways to be `dispatched` without proof.
+    fn dispatched_route() -> DispatchedRoute {
+        use crate::store::{WorkerRow, QUEUE_READY, STATUS_EXITED};
+        let dir = TempDir::new("api-dispatched-cancel");
+        let store = tauri::async_runtime::block_on(async {
+            let store = crate::store::Store::open(&dir.path().join("projecta.db"))
+                .await
+                .unwrap();
+            let project = store.create_project("one", "C:/repos/one").await.unwrap();
+            for (tq, wk) in [
+                ("tq-proven", "wk-proven"),
+                ("tq-crashed", "wk-crashed"),
+                ("tq-live", "wk-live"),
+                ("tq-bare", "wk-bare"),
+                ("tq-running", "wk-running"),
+            ] {
+                store
+                    .insert_queue_entry(&QueueEntry {
+                        id: tq.into(),
+                        project_id: project.id.clone(),
+                        raw_text: "do it".into(),
+                        sharpened_text: None,
+                        profile_id: "claude".into(),
+                        status: QUEUE_READY.into(),
+                        priority: 0,
+                        worker_id: None,
+                        error: None,
+                        spawned_by: None,
+                        created_at: 42,
+                    })
+                    .await
+                    .unwrap();
+                store
+                    .insert_worker(&WorkerRow {
+                        id: wk.into(),
+                        project_id: project.id.clone(),
+                        task: "do it".into(),
+                        profile_id: "claude".into(),
+                        branch: String::new(),
+                        worktree_path: String::new(),
+                        status: STATUS_RUNNING.into(),
+                        kind: KIND_WORKER.into(),
+                        pr_url: None,
+                        spawned_by: None,
+                        test_status: None,
+                        tested_at: None,
+                        role_variant_id: None,
+                        paused_reason: None,
+                        created_at: 1,
+                    })
+                    .await
+                    .unwrap();
+                assert!(store.claim_queue_entry(tq).await.unwrap());
+                store.mark_queue_dispatched(tq, wk, 8).await.unwrap();
+            }
+            store.bind_session("wk-proven", "s-proven").await;
+            store
+                .mark_session_exited("s-proven", Some(0))
+                .await
+                .unwrap();
+            store.bind_session("wk-crashed", "s-crashed").await;
+            store.take_session("wk-crashed");
+            store
+                .set_worker_status("wk-crashed", STATUS_EXITED)
+                .await
+                .unwrap();
+            store.bind_session("wk-live", "s-live").await;
+            store
+                .set_worker_status("wk-bare", STATUS_EXITED)
+                .await
+                .unwrap();
+            store
+        });
+        let backend = FakeBackend {
+            queue_store: Some(store.clone()),
+            ..Default::default()
+        };
+        let server = boot(Arc::new(backend), &dir.path().join("api"), false).unwrap();
+        DispatchedRoute {
+            server,
+            store,
+            _dir: dir,
+        }
+    }
+
+    /// W1-05b, api half: the cancel route hands a `dispatched` task to the
+    /// store's rule and says what the rule said. A proven process end is a
+    /// plain 200; everything else is a 409 that names what is missing and
+    /// leaves the row exactly where it was - a task must never vanish from
+    /// the queue while an agent behind it may still be alive.
+    #[test]
+    fn a_dispatched_task_is_cancelled_over_http_only_on_a_proven_process_end() {
+        let route = dispatched_route();
+        let stored = route.token();
+        let token = Some(stored.as_str());
+        let port = route.server.port();
+        let cancel = |id: &str| call(port, "POST", &format!("/api/queue/{id}/cancel"), token, "");
+
+        for (id, why) in [
+            ("tq-live", "worker wk-live still has a live session"),
+            (
+                "tq-crashed",
+                "1 session(s) of worker wk-crashed never reported an exit",
+            ),
+            ("tq-bare", "worker wk-bare has no recorded session"),
+            ("tq-running", "worker wk-running is still running"),
+        ] {
+            let (status, body) = cancel(id);
+            assert_eq!(status, 409, "{id}: {body}");
+            let error = body["error"].as_str().unwrap_or_default();
+            assert!(error.starts_with("refused: "), "{id}: {body}");
+            assert!(error.contains(why), "{id}: {body}");
+            assert!(error.contains("process end is proven"), "{id}: {body}");
+            assert_eq!(
+                route.queue_status(id).as_deref(),
+                Some("dispatched"),
+                "{id} must stay dispatched after a refusal"
+            );
+        }
+
+        let (status, body) = cancel("tq-proven");
+        assert_eq!(status, 200, "{body}");
+        assert_eq!(body["ok"], true, "{body}");
+        assert_eq!(route.queue_status("tq-proven"), None);
+        // Only that row went: the refused ones are untouched by the success.
+        for id in ["tq-live", "tq-crashed", "tq-bare", "tq-running"] {
+            assert_eq!(
+                route.queue_status(id).as_deref(),
+                Some("dispatched"),
+                "{id} must survive the cancel of tq-proven"
+            );
+        }
+
+        // Cancelling again is not a refusal but an id that names nothing.
+        let (status, body) = cancel("tq-proven");
+        assert_eq!(status, 404, "{body}");
+        assert!(
+            body["error"]
+                .as_str()
+                .unwrap_or_default()
+                .starts_with("unknown queued task: tq-proven"),
+            "{body}"
+        );
+    }
+
     #[test]
     fn a_landing_page_round_trips_through_the_api() {
         let fx = fixture("api-landing-page");
@@ -7596,6 +7795,19 @@ pub(crate) mod tests {
             core_status("failed to add the worktree: git exited 128"),
             500
         );
+        // W1-05b: a dispatched task without a proven process end is a refusal,
+        // a pinned delete that matched nothing is the store's own failure.
+        assert_eq!(
+            core_status(
+                "refused: task tq-1 is dispatched and worker wk-1 is still running; it can be \
+                 cancelled only once its process end is proven"
+            ),
+            409
+        );
+        assert_eq!(
+            core_status("failed to cancel dispatched task tq-1: the pinned delete matched 0 rows"),
+            500
+        );
         // The prefix has to open the message. A sentence that merely mentions
         // it somewhere is the app talking about itself, not about the caller.
         assert_eq!(core_status("the store is unknown territory"), 500);
```
