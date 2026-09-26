diff --git a/KNOWN_ISSUES.md b/KNOWN_ISSUES.md
index c942349..644f0d3 100644
--- a/KNOWN_ISSUES.md
+++ b/KNOWN_ISSUES.md
@@ -60,4 +60,4 @@ vorkommen — die Einstufung „nur Linux" heißt genau das und ist per
 | KI-20 | Doppelte Antwort auf die Cursor-Abfrage `ESC[6n` (`pty.rs`, `CursorReportScanner`): seit W1-01 antwortet der Reader-Thread selbst mit `ESC[1;1R`; öffnet später jemand den Terminal-Tab, spielt xterm.js den Scrollback nach und antwortet ein zweites Mal. Außerdem ist die Antwort immer `1;1`, auch für spätere Abfragen (Resize) | — (bewusst offen) | Gefunden 2026-09-17 unabhängig von zwei Review-Pools (PR #49: kimi-k2.7-code, glm-5.2; PR #50: kimi-k3). Risiko gering: die TUI hat ihre Antwort längst verarbeitet, Eingabe-Parser verwerfen unerwartete Sequenzen. Fix-Optionen: nur die erste Abfrage je Session beantworten, auf „kein Tab gemountet" gaten, oder die beantwortete Sequenz vor dem Emit an die UI entfernen. Berührt die Naht Frontend ↔ `pty.rs`, braucht eine eigene Entscheidung. Disposition `.pa/review_kimi_delivery_disposition.md`. PR #49 führte den Punkt als „KI-15"; die Nummer ist auf `main` anders belegt. |
 | KI-21 | Das Nutzer-Plugin ruflo-core (Claude Code, `PreToolUse`/`PostToolUse Bash`: `modify-bash`/`post-command`) überschreibt eine per Shell-Redirect geschriebene Datei eines Claude-Workers mit seiner eigenen Ausgabe („Recording command outcome") | — (Umgebung, nicht ProjectA) | Übernommen 2026-09-17 aus dem Claude-Adapter-Smoke (PR #49, `.pa/report_provider_adapter_smoke_claude.md`): in Lauf 2 und im Roh-Capture reproduziert, gleiche sha256 `ab6f6f6c…` außerhalb der App. ProjectA reicht dem Worker nur eigene Hooks (`--settings`), Home-Plugins lädt Claude Code selbst. Nutzerentscheidung 17.09.: der Nutzer deaktiviert den Hook. KI-20 führt PR #50 (W1-01: Doppelantwort auf `ESC[6n`). |
 | KI-22 | Der Claude-API-Pfad (Review-Subagenten über API-Key) hat kein Guthaben (400 „credit balance too low", 14.09.) | — (extern) | Übernommen 2026-09-17 aus PR #49. Belegt ist nur der CLI-Pfad (Claude Max laut `/status`); Reviews laufen über die CLI oder den kontingentfreien Ollama-Cloud-Pool (`docs/PLAN.md` §4). Kein Handlungsbedarf im Code. |
-| KI-23 | Die Attribution in `release_claimed_queue_entries` greift beim echten Start praktisch nie: `main.rs` lässt den Reattach-Pass vorher laufen, und der setzt jeden Worker mit `AwaitExplicitRespawn`/`MarkExited` auf `exited`, die Attribution sucht aber `status = running`. Ein Claim, dessen Worker gestartet war (nur `mark_queue_dispatched` fehlte), fällt so auf `ready` und wird bei Grenze > 0 ein zweites Mal gestartet – zwei Worktrees für eine Aufgabe. Nur Worker mit `SkipDisabledProfile`/`SkipPaused` bleiben `running` und können attribuiert werden (dann `dispatched` ohne lebenden Prozess, läuft erst beim manuellen Respawn). | — (erledigt) | Gefunden 2026-09-23 bei W1-16. **Behoben 2026-09-24 (Paket KI-23, Nutzerentscheidung 24.09.):** Reattach-Pass und Claim-Freigabe stehen in `main.rs::reattach_workers_and_resolve_claims`, in drei Schritten: erst `MarkExited` anwenden (Worktree weg → Claim auf `ready`, neuer Start ist richtig), dann `release_claimed_queue_entries`, solange die `AwaitExplicitRespawn`-Worker noch `running` sind (Claim bleibt `dispatched` bei diesem Worker, kein Doppelstart), erst danach diese Worker auf `exited`. `SkipDisabledProfile`/`SkipPaused` unverändert: Worker bleibt `running`, Claim `dispatched` ohne lebenden Prozess bis zum Respawn. Belege: `queue::tests::a_claim_whose_worker_started_stays_with_it_after_the_reattach_pass` rot → grün (fährt die echte Sequenz, nicht eine Kopie), Wächter `…_worktree_is_gone_goes_back_to_ready_…`, `…_worker_is_skipped_stays_with_it_…` und `orphaned_claims_stay_ready_after_the_restart_while_the_cap_is_zero` grün. Report `.pa/report_ki-23.md`. |
+| KI-23 | Die Attribution in `release_claimed_queue_entries` greift beim echten Start praktisch nie: `main.rs` lässt den Reattach-Pass vorher laufen, und der setzt jeden Worker mit `AwaitExplicitRespawn`/`MarkExited` auf `exited`, die Attribution sucht aber `status = running`. Ein Claim, dessen Worker gestartet war (nur `mark_queue_dispatched` fehlte), fällt so auf `ready` und wird bei Grenze > 0 ein zweites Mal gestartet – zwei Worktrees für eine Aufgabe. Nur Worker mit `SkipDisabledProfile`/`SkipPaused` bleiben `running` und können attribuiert werden (dann `dispatched` ohne lebenden Prozess, läuft erst beim manuellen Respawn). | — (erledigt) | Gefunden 2026-09-23 bei W1-16. **Behoben 2026-09-24 (Paket KI-23, Nutzerentscheidung 24.09.):** Reattach-Pass und Claim-Freigabe stehen in `main.rs::reattach_workers_and_resolve_claims`, in drei Schritten: erst `MarkExited` anwenden (Worktree weg → Claim auf `ready`, neuer Start ist richtig), dann `release_claimed_queue_entries`, solange die `AwaitExplicitRespawn`-Worker noch `running` sind (Claim bleibt `dispatched` bei diesem Worker, kein Doppelstart), erst danach diese Worker auf `exited`. `SkipDisabledProfile`/`SkipPaused` unverändert: Worker bleibt `running`, Claim `dispatched` ohne lebenden Prozess bis zum Respawn. Der Queue-Dispatcher startet erst, wenn diese Freigabe durch ist (Review-Befund B1: ein parallel genommener Claim wäre von einem liegengebliebenen nicht zu unterscheiden); Wächter `tests::the_dispatcher_starts_only_after_the_startup_claims_are_resolved` rot → grün. Belege: `queue::tests::a_claim_whose_worker_started_stays_with_it_after_the_reattach_pass` rot → grün (fährt die echte Sequenz, nicht eine Kopie), Wächter `…_worktree_is_gone_goes_back_to_ready_…`, `…_worker_is_skipped_stays_with_it_…`, `…_worker_is_paused_stays_with_it_…`, `a_start_interrupted_after_the_claim_release_is_repeated_without_harm` und `orphaned_claims_stay_ready_after_the_restart_while_the_cap_is_zero` grün. Report `.pa/report_ki-23.md`. |
diff --git a/src-tauri/src/main.rs b/src-tauri/src/main.rs
index b8ebea7..9139c95 100644
--- a/src-tauri/src/main.rs
+++ b/src-tauri/src/main.rs
@@ -3381,17 +3381,13 @@ fn main() {
                 Err(err) => eprintln!("projecta: {err}; the pa CLI will not be able to connect"),
             }
 
-            queue::start(
-                handle.clone(),
-                store.clone(),
-                Arc::clone(&quota),
-                Arc::clone(&engine),
-                receiver.port(),
-            );
+            // The queue dispatcher starts on the reattach thread below, once
+            // the claims the last process left behind are resolved (KI-23).
 
             // The budget watcher needs the quota tracker `init_quota` just
-            // built, so it starts after it - and after the dispatcher, whose
-            // skip list is the whole point of writing a block. Its own agent
+            // built, so it starts after it. The dispatcher's skip list is the
+            // whole point of writing a block; the dispatcher reads it on every
+            // sweep, so starting a little later changes nothing here. Its own agent
             // control exists only to stop sessions; it never spawns one.
             budget::start(
                 store.clone(),
@@ -3429,6 +3425,10 @@ fn main() {
             // rather than coming back as if they were still live. Coordinators
             // are deliberately left for the user to open by hand.
             let reattach_store = store.clone();
+            let dispatcher_handle = handle.clone();
+            let dispatcher_quota = Arc::clone(&quota);
+            let dispatcher_engine = Arc::clone(&engine);
+            let dispatcher_port = receiver.port();
             thread::spawn(move || {
                 tauri::async_runtime::block_on(async {
                     // A test gate may run for ten minutes, and closing the
@@ -3472,6 +3472,19 @@ fn main() {
                     )
                     .await;
                 });
+                // KI-23: the dispatcher starts only now. Every `dispatching`
+                // row the release above saw was left by the last process; a
+                // dispatcher already sweeping would add claims of its own that
+                // the release cannot tell apart, and hand them back to `ready`
+                // or to a worker that is about to be retired. `queue::start`
+                // spawns its own thread, outside this `block_on`.
+                queue::start(
+                    dispatcher_handle,
+                    reattach_store,
+                    dispatcher_quota,
+                    dispatcher_engine,
+                    dispatcher_port,
+                );
             });
 
             app.manage(store);
@@ -4029,6 +4042,35 @@ mod tests {
     /// closure would additionally sit behind the process, opener and updater
     /// plugins. So the order is asserted on the source, the same way the
     /// manage table below is.
+    /// KI-23, review finding B1 (kimi-k3): the startup claim release must not
+    /// race the dispatcher. A claim the dispatcher takes while the release
+    /// runs is `dispatching` too, and the release cannot tell it from a claim
+    /// the last process left behind - it would hand it back to `ready` or
+    /// attribute it to a worker about to be retired. So the dispatcher starts
+    /// only once `reattach_workers_and_resolve_claims` has returned. Startup
+    /// needs a Tauri app, so the order is asserted on the source, like the
+    /// single-instance guard below.
+    #[test]
+    fn the_dispatcher_starts_only_after_the_startup_claims_are_resolved() {
+        const SOURCE: &str = include_str!("main.rs");
+        let code = &SOURCE[..SOURCE.find("mod tests").expect("this module exists")];
+        let setup = code
+            .find(".setup(|app| {")
+            .expect("main() no longer builds the app with a setup closure");
+        let resolved = setup
+            + code[setup..]
+                .find("reattach_workers_and_resolve_claims(")
+                .expect("setup no longer resolves the startup claims");
+        let dispatcher = code
+            .find("queue::start(")
+            .expect("`queue::start(` moved or was renamed - fix the needle");
+        assert!(
+            resolved < dispatcher,
+            "the queue dispatcher starts before the startup claim release; a claim \
+             it takes meanwhile is indistinguishable from a leftover one"
+        );
+    }
+
     #[test]
     fn the_single_instance_guard_is_the_first_plugin_on_the_builder() {
         const SOURCE: &str = include_str!("main.rs");
diff --git a/src-tauri/src/queue.rs b/src-tauri/src/queue.rs
index 08add92..89c0473 100644
--- a/src-tauri/src/queue.rs
+++ b/src-tauri/src/queue.rs
@@ -1111,6 +1111,31 @@ mod tests {
             "the claim belongs to the worker that was started for it"
         );
         assert_eq!(rows[0].worker_id.as_deref(), Some("wk-started"));
+        // The second half of the sequence: the worker still waits for the
+        // board afterwards, it is not left `running` with no process.
+        let worker = store.get_worker("wk-started").await.unwrap().unwrap();
+        assert_eq!(worker.status, STATUS_EXITED);
+    }
+
+    /// KI-23, review finding B3.1: the app dies between the claim release
+    /// and retiring the waiting workers (claim `dispatched`, worker still
+    /// `running`). The next start must end in the same state as an
+    /// uninterrupted one - the claim stays put, the worker is retired.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn a_start_interrupted_after_the_claim_release_is_repeated_without_harm() {
+        let (_dir, store, project) = fixture().await;
+        claim_with_started_worker(&store, &project).await;
+        // Step 3 landed, step 4 did not.
+        assert_eq!(store.release_claimed_queue_entries().await.unwrap(), 1);
+
+        crate::reattach_workers_and_resolve_claims(&store, |_| true, |_| true).await;
+
+        let rows = store.list_queue(Some(&project)).await.unwrap();
+        assert_eq!(rows.len(), 1);
+        assert_eq!(rows[0].status, QUEUE_DISPATCHED);
+        assert_eq!(rows[0].worker_id.as_deref(), Some("wk-started"));
+        let worker = store.get_worker("wk-started").await.unwrap().unwrap();
+        assert_eq!(worker.status, STATUS_EXITED);
     }
 
     /// KI-23, the other half: the worker's worktree is gone (`MarkExited`),
@@ -1142,6 +1167,39 @@ mod tests {
         let rows = store.list_queue(Some(&project)).await.unwrap();
         assert_eq!(rows[0].status, QUEUE_DISPATCHED);
         assert_eq!(rows[0].worker_id.as_deref(), Some("wk-started"));
+        let worker = store.get_worker("wk-started").await.unwrap().unwrap();
+        assert_eq!(worker.status, STATUS_RUNNING);
+    }
+
+    /// The budget-pause branch of the same guard (review, deepseek-v4-flash).
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn a_claim_whose_worker_is_paused_stays_with_it_after_the_reattach_pass() {
+        let (_dir, store, project) = fixture().await;
+        let entry = enqueue_with_enhancer(
+            &store,
+            &project,
+            "exactly once",
+            None,
+            false,
+            None,
+            None,
+            |_, _| unreachable!(),
+        )
+        .await
+        .unwrap();
+        assert!(store.claim_queue_entry(&entry.id).await.unwrap());
+        let mut worker = running_worker(&project, "wk-paused", KIND_WORKER);
+        worker.task = "exactly once".into();
+        worker.paused_reason = Some("budget ceiling".into());
+        store.insert_worker(&worker).await.unwrap();
+
+        crate::reattach_workers_and_resolve_claims(&store, |_| true, |_| true).await;
+
+        let rows = store.list_queue(Some(&project)).await.unwrap();
+        assert_eq!(rows[0].status, QUEUE_DISPATCHED);
+        assert_eq!(rows[0].worker_id.as_deref(), Some("wk-paused"));
+        let worker = store.get_worker("wk-paused").await.unwrap().unwrap();
+        assert_eq!(worker.status, STATUS_RUNNING);
     }
 
     #[tokio::test]
```
