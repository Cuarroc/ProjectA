# Review-Auftrag W1-15b (vergiftete Mutexe in status.rs, dazu pty kill_all)

Du bist unabhängiger Code-Reviewer (nicht der Autor). Antworte auf Deutsch. Repo: ProjectA (Tauri 2 / Rust).

Kontext: PR #76 (W1-15) hat in pty/quota/hooks/providers/omniroute/main Ausdrücke wie `.lock().ok()?`,
`if let Ok(x) = m.lock()` ohne else und `Err(_) => return` ersetzt durch
`.lock().unwrap_or_else(|p| p.into_inner())` (Poison recovern, wo sinnvoll einmal loggen). `status.rs`
(24 Stellen) wurde dort bewusst ausgespart. Dieses Paket W1-15b holt das nach. Priorität laut Report:
`update` (zentraler Schreibweg) → `provider_usage` (speist den Budget-Stop) → `note_statusline_at` →
`tick_at` (Idle-/Stuck-Timer) → `forget_worker` (Reaper) → `board`; dazu `pty.rs::kill_all`
(beim Shutdown lief unter Poison kein einziger Kill). Bewusst unverändert aus #76: `install_when_idle`
und `live_session_ids` bleiben Fehler („; restart ProjectA“).

Beweismaßstab: Fünf Tests vergiften die Mutex (Thread panict mit gehaltenem Lock) und rufen dann den Pfad
auf. Sie waren gegen den unveränderten Code rot und sind jetzt grün.

Prüfe insbesondere:
- Ist Recovern an jeder Stelle korrekt? Kann ein halb angewandtes `edit` in `update` zu einem Zustand
  führen, der Schaden anrichtet (z. B. falsches Budget-Gate, Endlosschleife, wiederholte Panik)?
- Deadlocks oder neue Lock-Reihenfolgen? Guards, die länger leben als vorher (z. B. `let … else`,
  temporäre Guards in Ausdrücken, `board`)?
- Logging: einmal pro Prozess über AtomicBool. Angemessen?
- `kill_all`: Wird die Registry vor den Kills freigegeben? Reicht der Test als Beleg?
- Fehlende Stellen, Tests, die nicht belegen, was sie behaupten.

Gib jeden Befund mit ID (R1, R2, …), Schwere (blocker/major/minor/nit), Fundstelle und Begründung an.
Wenn nichts zu beanstanden ist, sag das ausdrücklich.

## Diff (gegen den Branch von PR #76)

```diff
diff --git a/src-tauri/src/pty.rs b/src-tauri/src/pty.rs
index 5afc041..806ba6a 100644
--- a/src-tauri/src/pty.rs
+++ b/src-tauri/src/pty.rs
@@ -1067,28 +1067,35 @@ impl PtyManager {
 
     /// Kill every session, so app shutdown never orphans an agent process.
     pub fn kill_all(&self) {
-        let sessions: Vec<Arc<Session>> = match self.sessions.lock() {
-            Ok(mut map) => map
-                .values_mut()
-                .filter_map(|entry| {
-                    if matches!(entry, SessionEntry::Reserved) {
-                        *entry = SessionEntry::CancelledReservation;
-                    }
-                    if let SessionEntry::Native(cancelled) = entry {
-                        cancelled.store(true, Ordering::Release);
-                    }
-                    entry.interactive()
-                })
-                .collect(),
-            Err(_) => return,
-        };
+        // Shutdown recovers a poisoned registry (W1-15b): returning here
+        // left every agent process running after the app was gone. The loop
+        // only flags and collects, so a recovered map is safe to walk.
+        let mut map = self.sessions.lock().unwrap_or_else(|poison| {
+            eprintln!("projecta: pty session registry was poisoned during shutdown; killing sessions anyway");
+            poison.into_inner()
+        });
+        let sessions: Vec<Arc<Session>> = map
+            .values_mut()
+            .filter_map(|entry| {
+                if matches!(entry, SessionEntry::Reserved) {
+                    *entry = SessionEntry::CancelledReservation;
+                }
+                if let SessionEntry::Native(cancelled) = entry {
+                    cancelled.store(true, Ordering::Release);
+                }
+                entry.interactive()
+            })
+            .collect();
+        drop(map);
         for session in sessions {
             session
                 .submit_guard_cancelled
                 .store(true, Ordering::Release);
-            if let Ok(mut killer) = session.killer.lock() {
-                let _ = killer.kill();
-            }
+            let _ = session
+                .killer
+                .lock()
+                .unwrap_or_else(|poison| poison.into_inner())
+                .kill();
         }
     }
 
@@ -1729,6 +1736,30 @@ mod tests {
         assert!(manager.reserve_session().is_err());
     }
 
+    /// Shutdown under poison used to return before touching a single session,
+    /// leaving every agent process running after the app was gone. A
+    /// reservation is the one entry a test can check without a real child.
+    #[test]
+    fn poisoned_registry_still_cancels_everything_on_kill_all() {
+        let manager = PtyManager::default();
+        let id = manager.reserve_session().unwrap();
+        let registry = Arc::clone(&manager.sessions);
+        let _ = std::thread::spawn(move || {
+            let _guard = registry.lock().unwrap();
+            panic!("poison registry fixture");
+        })
+        .join();
+        manager.kill_all();
+        let recovered = manager
+            .sessions
+            .lock()
+            .unwrap_or_else(|poison| poison.into_inner());
+        assert!(
+            matches!(recovered.get(&id), Some(SessionEntry::CancelledReservation)),
+            "kill_all must cancel a reservation even under poison"
+        );
+    }
+
     #[test]
     fn poisoned_registry_still_reaps_a_cancelled_reservation() {
         let manager = PtyManager::default();
diff --git a/src-tauri/src/status.rs b/src-tauri/src/status.rs
index 0621904..b6b27a7 100644
--- a/src-tauri/src/status.rs
+++ b/src-tauri/src/status.rs
@@ -28,7 +28,7 @@
 
 use std::collections::HashMap;
 use std::sync::atomic::{AtomicBool, Ordering};
-use std::sync::{Arc, Mutex};
+use std::sync::{Arc, Mutex, MutexGuard};
 use std::time::{Duration, Instant};
 
 use serde::{Deserialize, Serialize};
@@ -1117,6 +1117,26 @@ fn last_visible_line(tail: &str) -> Option<String> {
     Some(cut)
 }
 
+/// Set after the first poisoned lock in the engine; prevents log spam.
+static ENGINE_POISON_LOGGED: AtomicBool = AtomicBool::new(false);
+
+/// Lock one of the engine's slots, taking the state over if a panic poisoned
+/// it (W1-15b). The slots hold plain data: at worst a panicking `edit` left
+/// one worker's state half-updated, and the next observation of that worker
+/// overwrites it. Dropping out instead - the old behaviour - switched off the
+/// budget stop, the idle timer, the reaper and the board for the rest of the
+/// process without a word. Logged once: `update` runs on every output chunk.
+fn recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
+    mutex.lock().unwrap_or_else(|poison| {
+        if !ENGINE_POISON_LOGGED.swap(true, Ordering::Relaxed) {
+            eprintln!(
+                "projecta: status engine state was poisoned; recovering (further occurrences are not logged); restart ProjectA if the board looks wrong"
+            );
+        }
+        poison.into_inner()
+    })
+}
+
 /// The board's memory. Cheap to share: register it once as Tauri state and hand
 /// `Arc` clones to the hook receiver, the poller and the idle ticker.
 pub struct StatusEngine {
@@ -1172,48 +1192,36 @@ impl StatusEngine {
         if after <= self.idle_after {
             return;
         }
-        if let Ok(mut slot) = self.stuck_after.lock() {
-            *slot = after;
-        }
+        *recover(&self.stuck_after) = after;
     }
 
     /// Install the destination for column changes. Set once at startup.
     pub fn set_sink(&self, sink: Arc<dyn StatusSink>) {
-        if let Ok(mut slot) = self.sink.lock() {
-            *slot = Some(sink);
-        }
+        *recover(&self.sink) = Some(sink);
     }
 
     /// Install the quota tracker fed by the output heuristics. Set once at
     /// startup, before the first agent is spawned.
     pub fn set_quota_tracker(&self, quota: Arc<QuotaTracker>) {
-        if let Ok(mut slot) = self.quota.lock() {
-            *slot = Some(quota);
-        }
+        *recover(&self.quota) = Some(quota);
     }
 
     /// Install the per-profile dialects, once at startup. A profile without
     /// an entry classifies with the GENERIC set alone - always safe.
     pub fn set_dialects(&self, dialects: HashMap<String, Dialect>) {
-        if let Ok(mut slot) = self.dialects.lock() {
-            *slot = dialects;
-        }
+        *recover(&self.dialects) = dialects;
     }
 
     /// Install the database handle the test gate needs. Set once at startup.
     /// Without it no gate is ever started and nothing else changes.
     pub fn set_store(&self, store: Store) {
-        if let Ok(mut slot) = self.store.lock() {
-            *slot = Some(store);
-        }
+        *recover(&self.store) = Some(store);
     }
 
     /// Install the app handle the learning critic needs. Set once at startup.
     /// Without it no critic is ever started and nothing else changes.
     pub fn set_app(&self, app: AppHandle) {
-        if let Ok(mut slot) = self.app.lock() {
-            *slot = Some(app);
-        }
+        *recover(&self.app) = Some(app);
     }
 
     /// Start the project's test gate for a worker that has just reached review.
@@ -1230,7 +1238,7 @@ impl StatusEngine {
     /// worker that is already testing or has already passed. Together those are
     /// "once", without the engine having to remember anything of its own.
     fn start_test_gate(&self, worker_id: &str) {
-        let Some(store) = self.store.lock().ok().and_then(|slot| slot.clone()) else {
+        let Some(store) = recover(&self.store).clone() else {
             return;
         };
         let worker_id = worker_id.to_string();
@@ -1261,10 +1269,10 @@ impl StatusEngine {
     /// covers the paths a transition cannot see - a respawn, a restart, the
     /// manual button.
     fn start_learning_critic(&self, worker_id: &str) {
-        let Some(store) = self.store.lock().ok().and_then(|slot| slot.clone()) else {
+        let Some(store) = recover(&self.store).clone() else {
             return;
         };
-        let Some(app) = self.app.lock().ok().and_then(|slot| slot.clone()) else {
+        let Some(app) = recover(&self.app).clone() else {
             return;
         };
         let worker_id = worker_id.to_string();
@@ -1287,9 +1295,7 @@ impl StatusEngine {
         F: FnOnce(&mut WorkerState),
     {
         let changed = {
-            let Ok(mut workers) = self.workers.lock() else {
-                return;
-            };
+            let mut workers = recover(&self.workers);
             let state = workers.entry(worker_id.to_string()).or_default();
             edit(state);
             let verdict = state.derive();
@@ -1336,7 +1342,7 @@ impl StatusEngine {
         if column_changed && verdict.column == COL_DONE {
             self.start_learning_critic(worker_id);
         }
-        let sink = self.sink.lock().ok().and_then(|slot| slot.clone());
+        let sink = recover(&self.sink).clone();
         if let Some(sink) = sink {
             sink.publish(StatusPayload {
                 worker_id: worker_id.to_string(),
@@ -1354,11 +1360,9 @@ impl StatusEngine {
     pub fn observe_worker(&self, worker: &Worker) {
         // One lock after the other, never nested: read and clone the dialect
         // first, then update the worker.
-        let dialect = self
-            .dialects
-            .lock()
-            .ok()
-            .and_then(|map| map.get(&worker.profile_id).cloned())
+        let dialect = recover(&self.dialects)
+            .get(&worker.profile_id)
+            .cloned()
             .unwrap_or_default();
         self.update(&worker.id, |state| {
             state.profile_id.clone_from(&worker.profile_id);
@@ -1402,9 +1406,7 @@ impl StatusEngine {
 
     /// Drop a worker the app no longer tracks.
     pub fn forget_worker(&self, worker_id: &str) {
-        if let Ok(mut workers) = self.workers.lock() {
-            workers.remove(worker_id);
-        }
+        recover(&self.workers).remove(worker_id);
     }
 
     /// Feed a chunk of terminal output.
@@ -1463,7 +1465,7 @@ impl StatusEngine {
         let Some((profile_id, reason)) = quota_change else {
             return;
         };
-        let tracker = self.quota.lock().ok().and_then(|slot| slot.clone());
+        let tracker = recover(&self.quota).clone();
         if let Some(tracker) = tracker {
             match reason {
                 Some(reason) => tracker.note_blocked(&profile_id, &reason, None),
@@ -1505,7 +1507,7 @@ impl StatusEngine {
     /// sees it. Used by the exit note, which has to know what the agent was
     /// doing before it went away.
     pub fn column_of(&self, worker_id: &str) -> Option<String> {
-        let workers = self.workers.lock().ok()?;
+        let workers = recover(&self.workers);
         let state = workers.get(worker_id)?;
         Some(state.derive().column.to_string())
     }
@@ -1513,9 +1515,7 @@ impl StatusEngine {
     /// This worker's git fingerprints as `(at spawn, now)`. Both are `None`
     /// until the probe has run at least once.
     pub fn git_fingerprints(&self, worker_id: &str) -> (Option<String>, Option<String>) {
-        let Ok(workers) = self.workers.lock() else {
-            return (None, None);
-        };
+        let workers = recover(&self.workers);
         let Some(state) = workers.get(worker_id) else {
             return (None, None);
         };
@@ -1585,13 +1585,10 @@ impl StatusEngine {
     /// aufheben wuerde - und die weggeworfenen waeren nicht nachreichbar.
     #[cfg(test)]
     pub fn signals_for(&self, worker_id: &str) -> Vec<Signal> {
-        match self.workers.lock() {
-            Ok(workers) => workers
-                .get(worker_id)
-                .map(WorkerState::signals)
-                .unwrap_or_default(),
-            Err(_) => Vec::new(),
-        }
+        recover(&self.workers)
+            .get(worker_id)
+            .map(WorkerState::signals)
+            .unwrap_or_default()
     }
 
     /// The context figure last seen for one worker.
@@ -1600,7 +1597,7 @@ impl StatusEngine {
     /// about the worker; this is only ever needed to assert on one in isolation.
     #[cfg(test)]
     pub fn context_usage(&self, worker_id: &str) -> Option<ContextUsage> {
-        self.workers.lock().ok()?.get(worker_id)?.context_usage
+        recover(&self.workers).get(worker_id)?.context_usage
     }
 
     /// Feed a hook event reported by the agent itself.
@@ -1668,12 +1665,9 @@ impl StatusEngine {
 
     /// [`StatusEngine::tick`] with an explicit clock, for tests.
     pub fn tick_at(&self, now: Instant) {
-        let ids: Vec<String> = match self.workers.lock() {
-            Ok(workers) => workers.keys().cloned().collect(),
-            Err(_) => return,
-        };
+        let ids: Vec<String> = recover(&self.workers).keys().cloned().collect();
         let idle_after = self.idle_after;
-        let stuck_after = self.stuck_after.lock().map_or(STUCK_AFTER, |after| *after);
+        let stuck_after = *recover(&self.stuck_after);
         for id in ids {
             self.update(&id, |state| {
                 if state.status != STATUS_RUNNING {
@@ -1722,12 +1716,9 @@ impl StatusEngine {
     /// worker in isolation.
     #[cfg(test)]
     pub fn verdict_for(&self, worker_id: &str) -> Verdict {
-        match self.workers.lock() {
-            Ok(workers) => workers
-                .get(worker_id)
-                .map_or_else(|| Verdict::plain(COL_WORKING), WorkerState::derive),
-            Err(_) => Verdict::plain(COL_WORKING),
-        }
+        recover(&self.workers)
+            .get(worker_id)
+            .map_or_else(|| Verdict::plain(COL_WORKING), WorkerState::derive)
     }
 
     /// Build the board: refresh every worker from its row, then read back the
@@ -1744,11 +1735,11 @@ impl StatusEngine {
         for worker in workers {
             self.observe_worker(worker);
         }
-        let states = self.workers.lock().ok();
+        let states = recover(&self.workers);
         workers
             .iter()
             .map(|worker| {
-                let state = states.as_ref().and_then(|map| map.get(&worker.id));
+                let state = states.get(&worker.id);
                 let verdict =
                     state.map_or_else(|| Verdict::plain(COL_WORKING), WorkerState::derive);
                 let attention = state.and_then(WorkerState::attention);
@@ -1796,9 +1787,7 @@ impl StatusEngine {
         let Some(usage) = parse_statusline(payload, observed_at) else {
             return;
         };
-        let Ok(mut workers) = self.workers.lock() else {
-            return;
-        };
+        let mut workers = recover(&self.workers);
         let state = workers.entry(worker_id.to_string()).or_default();
         // A newer self-report may lower the number, never the evidence: within
         // one window the percentage is a consumption counter and only goes up,
@@ -1812,7 +1801,7 @@ impl StatusEngine {
 
     /// The freshest `statusLine` usage for a provider across all known workers.
     pub fn provider_usage(&self, provider_id: &str) -> Option<StatusLineUsage> {
-        let workers = self.workers.lock().ok()?;
+        let workers = recover(&self.workers);
         workers
             .values()
             .filter(|state| state.profile_id == provider_id)
@@ -2167,6 +2156,87 @@ mod tests {
         );
     }
 
+    /// Panic while holding the worker registry, the way a bug in any `edit`
+    /// closure passed to `update` would.
+    fn poison_workers(engine: &StatusEngine) {
+        std::thread::scope(|scope| {
+            let _ = scope
+                .spawn(|| {
+                    let _guard = engine.workers.lock().unwrap();
+                    panic!("poison worker registry fixture");
+                })
+                .join();
+        });
+        assert!(engine.workers.is_poisoned());
+    }
+
+    /// Under poison the budget stop must still see the usage it gates on:
+    /// before W1-15b `update`, `note_statusline_at` and `provider_usage` each
+    /// dropped out silently, and a profile past its limit read as "no data".
+    #[test]
+    fn poisoned_workers_still_record_and_report_budget_usage() {
+        let engine = StatusEngine::default();
+        poison_workers(&engine);
+        engine.observe_worker(&worker("wk-budget", STATUS_RUNNING));
+        engine.note_statusline_at(
+            "wk-budget",
+            r#"{"rate_limits":{"five_hour":{"used_percentage":93,"resets_at":9000}}}"#,
+            100,
+        );
+
+        let usage = engine.provider_usage("claude");
+        assert_eq!(
+            usage
+                .and_then(|usage| usage.five_hour)
+                .and_then(|window| window.percent),
+            Some(93),
+            "a poisoned registry must not hide an exhausted budget window"
+        );
+    }
+
+    /// The idle timer used to skip every worker under poison, so a silent
+    /// RUNNING worker never reached `needs_you`.
+    #[test]
+    fn poisoned_workers_still_go_idle_on_tick() {
+        let (engine, _recorder) = engine_with_worker();
+        let start = Instant::now();
+        engine.note_output_at("wk-1", samples::ACTIVITY, start);
+        poison_workers(&engine);
+
+        engine.tick_at(start + IDLE_AFTER);
+        assert_eq!(engine.column_of("wk-1").as_deref(), Some(COL_NEEDS_YOU));
+    }
+
+    /// Forgetting a worker is the engine's reaper: under poison it used to
+    /// leave the row behind for good, like `pty.rs::cancel_reservation` did.
+    #[test]
+    fn poisoned_workers_still_forget_a_worker() {
+        let engine = StatusEngine::default();
+        engine.observe_worker(&worker("wk-gone", STATUS_RUNNING));
+        poison_workers(&engine);
+
+        engine.forget_worker("wk-gone");
+        let workers = engine
+            .workers
+            .lock()
+            .unwrap_or_else(|poison| poison.into_inner());
+        assert!(!workers.contains_key("wk-gone"));
+    }
+
+    /// The board reads every column through one lock; under poison it showed
+    /// each worker in the default column whatever its real state.
+    #[test]
+    fn poisoned_workers_still_show_their_column_on_the_board() {
+        let (engine, _recorder) = engine_with_worker();
+        let start = Instant::now();
+        engine.note_output_at("wk-1", samples::ACTIVITY, start);
+        engine.tick_at(start + IDLE_AFTER);
+        poison_workers(&engine);
+
+        let board = engine.board(&[worker("wk-1", STATUS_RUNNING)]);
+        assert_eq!(board[0].column, COL_NEEDS_YOU);
+    }
+
     /// The dialect a default profile ships with - the tests prove the move
     /// from compiled-in constants to data was lossless by running the same
     /// fixtures through the data.
```
