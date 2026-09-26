# Code-Review: Paket W1-16 (Claim-Recovery bei max_workers = 0 + queue cancel 404/409/500)

Du bist unabhängiger Reviewer (anderer Anbieter als Autor/Implementierer). Repo ProjectA: Tauri 2, Rust-Kern (`src-tauri/src/`), SQLite via sqlx. Du hast KEINEN Repo-Zugriff; alles Nötige steht unten. Zitiere Stellen mit Datei + Ausschnitt.

## Auftrag des Pakets (docs/PLAN.md)
„W1-16 Claim-Recovery bei `max_workers = 0` · Lane store.rs · verwaiste Claims werden beim App-Start nicht gespawnt, wenn die Grenze 0 ist. Zusatz aus #58: queue cancel muss unbekannte ID, nicht abbrechbaren Zustand und Storefehler unterscheiden (404/409/500).“
Herkunft (KNOWN_ISSUES KI-13, beobachtet 31.08. beim Updater-E2E): „4 Queue-Worker spawnen nach Neustart, obwohl der Dispatcher für das Projekt aus war“.
Semantik von 0 (UI-Hinweis SettingsView.tsx): „0 hält den Dispatcher für dieses Projekt an; eingereihte Aufgaben bleiben bereit, bis das Limit wieder erhöht oder geleert wird.“ Platzhalter: „leer = Standard, 0 = aus“.

## Befund des Autors zu Teil 1 (bitte kritisch prüfen!)
Der Autor behauptet: KI-13 ist im heutigen Code bereits geschlossen; es gibt keinen Fix, nur einen Regressionswächter-Test (an der Basis grün, daher `No-Test:`-Trailer statt Test-First). Begründung:
(a) Startup (main.rs) läuft: Reattach-Pass -> `release_claimed_queue_entries`. Reattach startet nie einen Agenten (`Reattach::spawns_an_agent() == false`; AwaitExplicitRespawn setzt Worker auf `exited`).
(b) `release_claimed_queue_entries` setzt verwaiste Claims nur auf `ready` (oder attribuiert sie an einen laufenden Worker) — spawnt nichts.
(c) Der einzige Spawner ist `queue::dispatch_project`, und der kehrt bei `Some(0)` vor jedem Claim zurück.
Die Git-Historie vor dem 07.09. ist zusammengedrückt; der 31.08.-Zustand ist nicht rekonstruierbar.

## Nebenbefund des Autors (NICHT gefixt, nur gemeldet)
Weil der Reattach-Pass VOR der Claim-Release alle `running`-Worker auf `exited` setzt, findet die Attributions-Abfrage in `release_claimed_queue_entries` (sucht `w.status = running`) beim echten Start nie einen Worker. Ein Claim, dessen Worker tatsächlich gestartet war (nur Buchhaltung fehlte), geht daher auf `ready` und wird bei Grenze > 0 ein ZWEITES Mal gestartet. Lokal mit einem Probe-Test belegt (rot: left "ready", right "dispatched"). Nicht in diesem PR gefixt, weil es eine main.rs-Reihenfolge/Designfrage ist (MarkExited = Worktree weg -> dort wäre ready richtig).

## Relevanter Bestandscode (unverändert)
```rust
// queue.rs dispatch_project (Anfang)
pub async fn dispatch_project(
    store: &Store,
    quota: &QuotaTracker,
    preflight: &PreflightCache,
    profiles: &[AgentProfile],
    project_id: &str,
    launcher: &dyn TaskLauncher,
) -> Result<Option<QueueEntry>, String> {
    // Capacity is counted in employees only: coordinators steer, they do not
    // hold a worktree, so a running orchestrator or queen must never block the
    // workers it is about to order. No project cap means the queue default;
    // zero deliberately pauses dispatch for this project. Return before the
    // worker scan because a paused project has no capacity to calculate.
    let limit = match store
        .get_project(project_id)
        .await?
        .and_then(|project| project.max_workers)
    {
        None => DEFAULT_MAX_CONCURRENT,
        Some(0) => return Ok(None),
        Some(limit) => usize::try_from(limit).unwrap_or(DEFAULT_MAX_CONCURRENT),
    };
    let running = store
        .list_workers(Some(project_id))
        .await?
        .into_iter()
        .filter(|worker| worker.status == STATUS_RUNNING && worker.kind == KIND_WORKER)
        .count();
    if running >= limit {
        return Ok(None);
```
```rust
// store.rs release_claimed_queue_entries
    /// Resolve every claim left behind by a process that is no longer running.
    ///
    /// Called once at startup, for the same reason
    /// [`crate::testgate::clear_stale_test_runs`] is: nothing is dispatching
    /// yet at that moment, so every `dispatching` row is a claim whose owner
    /// died somewhere between taking it and marking it dispatched. What
    /// happens to it depends on what the work left behind:
    ///
    /// - A running employee no dispatched entry accounts for is the proof the
    ///   claim bore fruit: the worker was started, only the bookkeeping never
    ///   landed. The entry is marked `dispatched` under that worker rather
    ///   than handed out a second time.
    /// - Without one the claim is an orphan and goes back to `ready`, so the
    ///   next sweep starts the task for real.
    ///
    /// Returns how many claims were resolved. Each attribution consumes its
    /// worker, so two leftover claims can never point at the same one.
    pub async fn release_claimed_queue_entries(&self) -> Result<usize, String> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| format!("failed to begin claim release: {e}"))?;
        let claimed: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
            "SELECT id, project_id, raw_text, sharpened_text FROM task_queue WHERE status = ?1 ORDER BY created_at, id",
        )
        .bind(QUEUE_DISPATCHING)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| format!("failed to read claimed tasks: {e}"))?;
        let mut resolved = 0;
        for (id, project_id, raw_text, sharpened_text) in claimed {
            // Attribution needs evidence beyond "some worker is running": the
            // candidate must carry *this* task. A hand-started or respawned
            // worker with an unrelated task would otherwise swallow the claim
            // (marked dispatched, never run) — silent work loss, the same
            // failure class as the double spawn this function prevents. The
            // text a queue-spawned worker carries is the sharpened one when
            // sharpening ran, else the raw one.
            let task_text = sharpened_text.as_deref().unwrap_or(&raw_text);
            let worker: Option<(String,)> = sqlx::query_as(
                "SELECT id FROM workers w \
                 WHERE w.project_id = ?1 AND w.status = ?2 AND w.kind = ?3 \
                 AND w.task = ?4 \
                 AND NOT EXISTS (SELECT 1 FROM task_queue d WHERE d.worker_id = w.id) \
                 ORDER BY w.created_at, w.id LIMIT 1",
            )
            .bind(&project_id)
            .bind(STATUS_RUNNING)
            .bind(KIND_WORKER)
            .bind(task_text)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| format!("failed to look for the claim's worker: {e}"))?;
            match worker {
                Some((worker_id,)) => {
                    sqlx::query(
                        "UPDATE task_queue SET status = ?1, worker_id = ?2, error = NULL \
                         WHERE id = ?3 AND status = ?4",
                    )
                    .bind(QUEUE_DISPATCHED)
                    .bind(&worker_id)
                    .bind(&id)
                    .bind(QUEUE_DISPATCHING)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| format!("failed to attribute claimed task: {e}"))?;
                }
                None => {
                    sqlx::query("UPDATE task_queue SET status = ?1 WHERE id = ?2 AND status = ?3")
                        .bind(QUEUE_READY)
                        .bind(&id)
                        .bind(QUEUE_DISPATCHING)
                        .execute(&mut *tx)
                        .await
                        .map_err(|e| format!("failed to release claimed task: {e}"))?;
                }
            }
            resolved += 1;
        }
        tx.commit()
            .await
            .map_err(|e| format!("failed to finish claim release: {e}"))?;
        Ok(resolved)
    }

    /// Mark a claimed entry dispatched under the worker that was started for
```
```rust
// main.rs Startup (Auszug, Reihenfolge)

                    let workers = match reattach_store.list_workers(None).await {
                        Ok(workers) => workers,
                        Err(err) => {
                            eprintln!("projecta: reattach failed to list workers: {err}");
                            return;
                        }
                    };
                    // One read of the profile switches for the whole pass: a
                    // worker whose profile is off cannot be respawned, and
                    // finding that out here keeps it from taking a respawn slot
                    // away from a worker that can. A profile that has vanished
                    // from the registry is left to `respawn_worker`, which is
                    // where "unknown agent profile" is worded.
                    let enabled: std::collections::HashSet<String> =
                        learnings::profiles_with_enabled(&reattach_store)
                            .await
                            .into_iter()
                            .filter(|profile| profile.enabled)
                            .map(|profile| profile.id)
                            .collect();
                    let known: std::collections::HashSet<String> = profiles::load_profiles()
                        .into_iter()
                        .map(|profile| profile.id)
                        .collect();
                    let plan = workers::plan_reattach(
                        &workers,
                        |path| Path::new(path).is_dir(),
                        |profile_id| {
                            enabled.contains(profile_id) || !known.contains(profile_id)
                        },
                    );
                    for (worker, action) in plan {
                        match action {
                            workers::Reattach::SkipDisabledProfile => eprintln!(
                                "projecta: worker {} not reattached: agent profile '{}' is disabled in settings",
                                worker.id, worker.profile_id
                            ),
                            workers::Reattach::SkipPaused => eprintln!(
                                "projecta: worker {} not reattached: {}",
                                worker.id,
                                worker.paused_reason.as_deref().unwrap_or("paused")
                            ),
                            workers::Reattach::MarkExited
                            | workers::Reattach::AwaitExplicitRespawn => {
                                match workers::apply_reattach(&reattach_store, worker, action).await
                                {
                                    Ok(()) => match action {
                                        workers::Reattach::AwaitExplicitRespawn => eprintln!(
                                            "projecta: worker {} waiting for explicit respawn after app restart",
                                            worker.id
                                        ),
                                        workers::Reattach::MarkExited => eprintln!(
                                            "projecta: worker {} marked exited; worktree is gone",
                                            worker.id
                                        ),
                                        _ => {}
                                    },
                                    Err(err) => eprintln!(
                                        "projecta: could not retire worker {}: {err}",
                                        worker.id
                                    ),
                                }
                            }
                        }
                    }

                    // Only now that the plan above has decided which persisted
                    // `running` workers survived: resolve the claims the last
                    // process left mid-dispatch. A claim whose worker came back
                    // (or never left) is attributed to it rather than handed
                    // out a second time; a claim with no worker behind it goes
                    // back to `ready`. Running this before the plan would
                    // attribute claims to workers the plan was about to retire.
                    match reattach_store.release_claimed_queue_entries().await {
                        Ok(0) => {}
                        Ok(done) => {
                            eprintln!("projecta: resolved {done} interrupted queue claim(s)")
                        }
                        Err(err) => {
                            eprintln!("projecta: could not resolve queue claims: {err}")
                        }
                    }
                });
            });

            app.manage(store);
            app.manage(engine);
            app.manage(quota);
            // Restored: 25a2053 dropped this line in a merge, and from that
```
```rust
// workers.rs Reattach
impl Reattach {
    /// Startup never starts an agent. The board's Respawn button does.
    pub fn spawns_an_agent(self) -> bool {
        false
    }
}
        Reattach::AwaitExplicitRespawn => {
            store.set_worker_status(&worker.id, STATUS_EXITED).await?;
            crate::sessionpersist::confirm(&worker.id, crate::sessionpersist::CONFIRMED_APP_CRASH);
            let _ = store
                .insert_message(
                    &worker.id,
                    MSG_SYSTEM,
                    "Session ended with the app; respawn from the board",
                )
                .await;
            Ok(())
        }
```
```rust
// api.rs core_status
fn core_status(err: &str) -> u16 {
    if err.starts_with(crate::workers::ERR_UNKNOWN) {
        404
    } else if err.starts_with(crate::workers::ERR_REFUSED) {
        409
    } else {
        500
    }
}
```

## Diff des PRs (origin/claude/w1-25-sqlite-load..HEAD)
```diff
diff --git a/src-tauri/src/api.rs b/src-tauri/src/api.rs
index 019ba48..c0fb6b7 100644
--- a/src-tauri/src/api.rs
+++ b/src-tauri/src/api.rs
@@ -130,13 +130,14 @@
 //! claim, so there is no wrong moment for it to arrive at - unlike `accept`,
 //! which does claim and does answer 409.
 //!
-//! One member of that same class is still open, twelve lines up in the same
-//! `match`: `POST /api/queue/<id>/cancel` answers 400 for every failure,
-//! including a store that fell over. It is not fixed here because it cannot be:
-//! `store::cancel_queue_entry` mixes "no such task" and "not in a cancellable
-//! state" into one sentence, and telling those apart is a change in `store.rs` -
-//! a different lane. The audit card that found this class named both routes in
-//! one breath (`docs/audits/2026-09-03-analyse-claude-web/karten/services.md`).
+//! `POST /api/queue/<id>/cancel` was the last member of that class still
+//! open: it answered 400 for every failure, including a store that fell over.
+//! It reads [`core_status`] now - 404 for an id that names nothing, 409 for
+//! an entry that is no longer queued or ready, 500 for the store - because
+//! `store::cancel_queue_entry` opens those two cases with `unknown ` and
+//! `refused: ` like the rest of the core. The audit card that found this
+//! class named both routes in one breath
+//! (`docs/audits/2026-09-03-analyse-claude-web/karten/services.md`).
 //!
 //! The routes that *list* something for one project - `/api/workers`,
 //! `/api/queue`, `/api/projects/<id>/tree` and their neighbours - answered an
@@ -1646,10 +1647,11 @@ fn route(inner: &Inner, request: &Request, proof: VerdictProof) -> Response {
             into_response(backend.list_queue(project_id))
         }
 
-        ("POST", ["api", "queue", id, "cancel"]) => match backend.cancel_queued_task(id) {
-            Ok(()) => Response::ok(json!({ "ok": true })),
-            Err(err) => Response::error(400, err),
-        },
+        ("POST", ["api", "queue", id, "cancel"]) => core_response(
+            backend
+                .cancel_queued_task(id)
+                .map(|()| json!({ "ok": true })),
+        ),
 
         // -- scout and recommendations (Phase 7.1) -------------------------
         ("POST", ["api", "scout"]) => {
@@ -3111,8 +3113,22 @@ pub(crate) mod tests {
             Ok(Vec::new())
         }
 
-        fn cancel_queued_task(&self, _id: &str) -> Result<(), String> {
-            Ok(())
+        fn cancel_queued_task(&self, id: &str) -> Result<(), String> {
+            // The three answers `store::cancel_queue_entry` can give, in its
+            // own words: an id that names nothing, an entry a claim has
+            // already taken past queued or ready, and a store that fell over.
+            match id {
+                "tq-nope" => Err(format!(
+                    "{}queued task: tq-nope",
+                    crate::workers::ERR_UNKNOWN
+                )),
+                "tq-busy" => Err(format!(
+                    "{}task tq-busy is dispatching, not queued or ready",
+                    crate::workers::ERR_REFUSED
+                )),
+                "tq-boom" => Err("failed to cancel queued task: database is locked".into()),
+                _ => Ok(()),
+            }
         }
 
         fn create_scout(&self, project_id: &str) -> Result<Worker, String> {
@@ -6526,6 +6542,28 @@ pub(crate) mod tests {
         }
     }
 
+    /// The cancel route answered 400 for every failure too - the member of
+    /// the class the rounds above could not reach, because telling a wrong id
+    /// from a wrong moment had to happen in `store.rs` first (see the module
+    /// head). It reads the core's vocabulary now, like `accept` above.
+    #[test]
+    fn cancelling_a_queued_task_says_whose_fault_the_failure_was() {
+        let fx = fixture("api-queue-cancel");
+        let stored = fx.token();
+        let token = Some(stored.as_str());
+        let port = fx.server.port();
+
+        for (id, expected) in [
+            ("tq-nope", 404),
+            ("tq-busy", 409),
+            ("tq-boom", 500),
+            ("tq-1", 200),
+        ] {
+            let (status, body) = call(port, "POST", &format!("/api/queue/{id}/cancel"), token, "");
+            assert_eq!(status, expected, "{id}: {body}");
+        }
+    }
+
     #[test]
     fn a_landing_page_round_trips_through_the_api() {
         let fx = fixture("api-landing-page");
diff --git a/src-tauri/src/queue.rs b/src-tauri/src/queue.rs
index 96a779e..8037b4b 100644
--- a/src-tauri/src/queue.rs
+++ b/src-tauri/src/queue.rs
@@ -1257,6 +1257,78 @@ mod tests {
         );
     }
 
+    /// KI-13 / W1-16: a project whose cap is 0 is switched off, and a restart
+    /// must not switch it back on. Orphaned claims (the updater E2E left four)
+    /// go back to `ready` at startup and stay there until the cap is raised -
+    /// the recovery path is held to the same limit as a normal sweep.
+    #[tokio::test]
+    async fn orphaned_claims_stay_ready_after_the_restart_while_the_cap_is_zero() {
+        let (_dir, store, project) = fixture().await;
+        let mut ids = Vec::new();
+        for text in ["orphan-1", "orphan-2", "orphan-3", "orphan-4"] {
+            let entry = enqueue_with_enhancer(
+                &store,
+                &project,
+                text,
+                None,
+                false,
+                None,
+                None,
+                |_, _| unreachable!(),
+            )
+            .await
+            .unwrap();
+            assert!(store.claim_queue_entry(&entry.id).await.unwrap());
+            ids.push(entry.id);
+        }
+        store
+            .set_project_max_workers(&project, Some(0))
+            .await
+            .unwrap();
+        // The app died here: four claims, no worker behind any of them.
+
+        assert_eq!(store.release_claimed_queue_entries().await.unwrap(), 4);
+        let launcher = FakeLauncher::new();
+        for _ in 0..ids.len() + 1 {
+            let taken = dispatch_project(
+                &store,
+                &QuotaTracker::default(),
+                &PreflightCache::default(),
+                &registry(),
+                &project,
+                &launcher,
+            )
+            .await
+            .unwrap();
+            assert!(taken.is_none(), "a cap of 0 dispatches nothing");
+        }
+        assert!(
+            launcher.calls.lock().unwrap().is_empty(),
+            "the restart must not spawn orphaned claims of a paused project"
+        );
+        let rows = store.list_queue(Some(&project)).await.unwrap();
+        assert_eq!(rows.len(), 4, "no orphan may be lost either");
+        assert!(rows.iter().all(|row| row.status == QUEUE_READY));
+
+        // Raising the cap is what lets them run - one sweep, one task.
+        store
+            .set_project_max_workers(&project, Some(1))
+            .await
+            .unwrap();
+        assert!(dispatch_project(
+            &store,
+            &QuotaTracker::default(),
+            &PreflightCache::default(),
+            &registry(),
+            &project,
+            &launcher,
+        )
+        .await
+        .unwrap()
+        .is_some());
+        assert_eq!(launcher.calls.lock().unwrap().len(), 1);
+    }
+
     #[tokio::test]
     async fn a_claim_is_taken_once_and_released_intact() {
         let (_dir, store, project) = fixture().await;
diff --git a/src-tauri/src/store.rs b/src-tauri/src/store.rs
index c31c4f9..3ef518c 100644
--- a/src-tauri/src/store.rs
+++ b/src-tauri/src/store.rs
@@ -2714,6 +2714,13 @@ impl Store {
         Ok(())
     }
 
+    /// Delete an entry that is still queued or ready.
+    ///
+    /// Three outcomes: `Ok(())` once the row is gone, an error opening with
+    /// [`crate::workers::ERR_UNKNOWN`] when no such entry exists, and one
+    /// opening with [`crate::workers::ERR_REFUSED`] when it exists but has
+    /// moved past queued/ready - claimed, dispatched or failed. A store
+    /// failure keeps its `failed to` opening and reaches the caller as is.
     pub async fn cancel_queue_entry(&self, id: &str) -> Result<(), String> {
         let result = sqlx::query("DELETE FROM task_queue WHERE id = ?1 AND status IN (?2, ?3)")
             .bind(id)
@@ -2723,7 +2730,14 @@ impl Store {
             .await
             .map_err(|e| format!("failed to cancel queued task: {e}"))?;
         if result.rows_affected() == 0 {
-            return Err(format!("task {id} is not queued or ready"));
+            return match self.get_queue_entry(id).await? {
+                None => Err(format!("{}queued task: {id}", crate::workers::ERR_UNKNOWN)),
+                Some(entry) => Err(format!(
+                    "{}task {id} is {}, not queued or ready",
+                    crate::workers::ERR_REFUSED,
+                    entry.status
+                )),
+            };
         }
         Ok(())
     }
@@ -6858,4 +6872,50 @@ pub(crate) mod tests {
         assert_eq!(ids(&exact), vec!["qs-due"]);
         assert!(store.list_expired_questions(999).await.unwrap().is_empty());
     }
+
+    // -- task queue (Phase 7) ---------------------------------------------
+
+    #[tokio::test]
+    async fn cancelling_says_whether_the_task_is_unknown_or_past_cancelling() {
+        let (_dir, store) = store().await;
+        let project = store.create_project("one", "C:/repos/one").await.unwrap();
+        let entry = QueueEntry {
+            id: "tq-1".to_string(),
+            project_id: project.id.clone(),
+            raw_text: "do it".to_string(),
+            sharpened_text: None,
+            profile_id: "claude".to_string(),
+            status: QUEUE_READY.to_string(),
+            priority: 0,
+            worker_id: None,
+            error: None,
+            spawned_by: None,
+            created_at: 42,
+        };
+        store.insert_queue_entry(&entry).await.unwrap();
+
+        // A claim has the entry, so the cancel is refused and the row stays.
+        assert!(store.claim_queue_entry("tq-1").await.unwrap());
+        let err = store.cancel_queue_entry("tq-1").await.unwrap_err();
+        assert!(err.starts_with(crate::workers::ERR_REFUSED), "{err}");
+        assert_eq!(
+            store.list_queue(Some(&project.id)).await.unwrap()[0].status,
+            QUEUE_DISPATCHING
+        );
+
+        let err = store.cancel_queue_entry("tq-nope").await.unwrap_err();
+        assert!(err.starts_with(crate::workers::ERR_UNKNOWN), "{err}");
+
+        // A ready entry goes; a second cancel finds no row left to name.
+        store
+            .insert_queue_entry(&QueueEntry {
+                id: "tq-2".to_string(),
+                ..entry
+            })
+            .await
+            .unwrap();
+        store.cancel_queue_entry("tq-2").await.unwrap();
+        let err = store.cancel_queue_entry("tq-2").await.unwrap_err();
+        assert!(err.starts_with(crate::workers::ERR_UNKNOWN), "{err}");
+    }
 }
```

## Belege
- Teil 1: Wächter-Test `orphaned_claims_stay_ready_after_the_restart_while_the_cap_is_zero` gegen unveränderten Code grün.
- Teil 2 rot (Produktions-Hunks zurückgedreht, Tests drin): api: `tq-nope: {"error":"unknown queued task: tq-nope"} left: 400 right: 404`; store: panic `task tq-1 is not queued or ready`. Nach Fix: beide grün, cargo clippy -D warnings grün, prepush-Bahn grün (Linux).

## Prüfe bitte
1. Stimmt die Schlussfolgerung zu Teil 1? Gibt es einen Pfad im gezeigten Code, über den bei max_workers = 0 beim Start doch ein Agent gestartet wird? Ist ein Wächtertest ohne Fix hier die richtige Antwort, und testet er das Richtige?
2. Nebenbefund: korrekt? Richtige Einordnung (separates Paket) oder gehört er in W1-16?
3. Teil 2: Korrektheit (Rennen zwischen DELETE und nachgelagertem SELECT, Statuswerte, Fehlertexte, core_status-Kollisionen, Kompatibilität für Aufrufer: Tauri-Command `cancel_queued_task` gibt den String an die UI, CLI `pa queue cancel` postet an die Route; ein Bestandstest prüft `contains("not queued or ready")`).
4. Tests: prüfen sie das Behauptete? Lücken?
Format: Liste von Befunden mit Schwere (hoch/mittel/niedrig/info), je Befund: Stelle, Problem, Vorschlag. Am Ende Urteil: ACCEPT / ACCEPT mit Auflagen / REJECT.
