# Code-Review: Paket KI-23 (Claim-Attribution nach dem Reattach-Pass)

Du bist unabhängiger Reviewer (anderer Anbieter als der Autor, Claude Code / Anthropic). Repo ProjectA: Tauri 2, Rust-Kern (`src-tauri/src/`), SQLite via sqlx. Du hast KEINEN Repo-Zugriff; alles Nötige steht unten. Zitiere Stellen mit Datei + Ausschnitt. Ordne jeden Befund einer Schwere zu (hoch/mittel/niedrig/info) und sage am Ende klar: freigeben / freigeben mit Auflagen / nicht freigeben.

## Problem (KNOWN_ISSUES KI-23)
Beim App-Start lief in `main.rs` erst der Reattach-Pass, dann `Store::release_claimed_queue_entries`. Der Reattach-Pass setzt jeden Worker mit `AwaitExplicitRespawn`/`MarkExited` auf `exited`; die Attribution in `release_claimed_queue_entries` sucht aber `status = running`. Ein Claim (`task_queue.status = 'dispatching'`), dessen Worker schon gestartet war (nur `mark_queue_dispatched` fehlte, weil die App starb), fiel so auf `ready` und konnte bei einer Projektgrenze > 0 ein zweites Mal gestartet werden: zwei Worktrees für eine Aufgabe.

## Gewolltes Verhalten (Nutzerentscheidung 24.09.)
- Worktree weg (`MarkExited`) → Claim geht auf `ready`, ein neuer Start ist richtig.
- Worker wartet auf Respawn (`AwaitExplicitRespawn`) → der Claim bleibt bei diesem Worker (`dispatched`), kein Doppelstart.
- `SkipDisabledProfile`/`SkipPaused`: bestehendes Verhalten nicht verschlechtern (Worker bleibt `running`, Claim wird wie bisher attribuiert).
- Lane ist `main.rs` (Reihenfolge und Übergabe); Store-Änderungen nur, wenn unvermeidlich.

## Design des Fixes
Der Startblock steht jetzt in `main.rs::reattach_workers_and_resolve_claims(store, worktree_exists, profile_enabled)` (Commit 1: reiner Umzug mit alter Reihenfolge + roter Test; Commit 2: neue Reihenfolge):
1. Plan berechnen (`workers::plan_reattach`, unverändert).
2. Skips loggen; nur `MarkExited` anwenden.
3. `release_claimed_queue_entries` — die `AwaitExplicitRespawn`-Worker sind hier noch `running` und können den Claim bekommen.
4. Erst dann `AwaitExplicitRespawn` anwenden (Worker → `exited`, Systemnachricht „respawn from the board“).
Kein SQL geändert, nur der Docstring von `release_claimed_queue_entries`.

## Bitte besonders prüfen
- Ist die Reihenfolge korrekt und vollständig? Gibt es einen Worker-/Claim-Zustand, bei dem der neue Ablauf schlechter ist als der alte (Verlust einer Aufgabe, Doppelstart, Claim bei einem Worker, der nie wieder laufen kann)?
- Absturz zwischen Schritt 3 und 4 (Claim attribuiert, Worker noch `running`): ist der nächste Start idempotent?
- `apply_reattach` kann für einen Continuous-Worker (`development_launch_for_worker` gesetzt) mit Err abbrechen, nachdem es `reconcile_development_worker` gerufen hat — ändert die neue Reihenfolge daran etwas?
- Belegen die Tests das, was sie behaupten? Der rote Test fährt die echte Funktion aus `main.rs`, nicht eine Kopie ihrer Reihenfolge.
- Mehrere Claims / mehrere Worker: die Attribution verbraucht einen Worker je Claim (`NOT EXISTS (SELECT 1 FROM task_queue d WHERE d.worker_id = w.id)`) und verlangt gleiche Aufgabe (`w.task = sharpened_text ?? raw_text`).

## Relevanter Bestandscode (unverändert)
```rust
// workers.rs
pub fn plan_reattach(workers: &[Worker], worktree_exists: impl Fn(&str) -> bool, profile_enabled: impl Fn(&str) -> bool) -> Vec<(&Worker, Reattach)> {
    let mut candidates: Vec<&Worker> = workers.iter()
        .filter(|w| w.kind == KIND_WORKER && w.status == STATUS_RUNNING).collect();
    candidates.sort_by(|a, b| a.created_at.cmp(&b.created_at).then_with(|| a.id.cmp(&b.id)));
    let mut plan = Vec::new();
    for worker in candidates {
        if !worktree_exists(&worker.worktree_path) { plan.push((worker, Reattach::MarkExited)); continue; }
        if !profile_enabled(&worker.profile_id) { plan.push((worker, Reattach::SkipDisabledProfile)); continue; }
        if worker.paused_reason.is_some() { plan.push((worker, Reattach::SkipPaused)); continue; }
        plan.push((worker, Reattach::AwaitExplicitRespawn));
    }
    plan
}

pub async fn apply_reattach(store: &Store, worker: &Worker, action: Reattach) -> Result<(), String> {
    debug_assert!(!action.spawns_an_agent());
    if store.development_launch_for_worker(&worker.id).await?.is_some() {
        store.reconcile_development_worker(&worker.id).await?;
        return Err(format!("{ERR_REFUSED}continuous worker requires launch reconciliation: {}", worker.id));
    }
    match action {
        Reattach::SkipDisabledProfile | Reattach::SkipPaused => Ok(()),
        Reattach::MarkExited => { store.set_worker_status(&worker.id, STATUS_EXITED).await?; /* confirm + system message */ Ok(()) }
        Reattach::AwaitExplicitRespawn => { store.set_worker_status(&worker.id, STATUS_EXITED).await?; /* confirm + system message */ Ok(()) }
    }
}

// store.rs, release_claimed_queue_entries (BEGIN IMMEDIATE, dann je Claim in task_queue mit status = 'dispatching'):
//   SELECT id FROM workers w
//    WHERE w.project_id = ?1 AND w.status = 'running' AND w.kind = 'worker'
//      AND w.task = ?4                                   -- sharpened_text ?? raw_text
//      AND NOT EXISTS (SELECT 1 FROM task_queue d WHERE d.worker_id = w.id)
//    ORDER BY w.created_at, w.id LIMIT 1
//   Treffer  -> UPDATE task_queue SET status='dispatched', worker_id=?, error=NULL WHERE id=? AND status='dispatching'
//   kein Treffer -> UPDATE task_queue SET status='ready' WHERE id=? AND status='dispatching'

// store.rs, mark_queue_dispatched: Belegung zählt nur dispatched-Einträge, deren Worker running ist.
// queue.rs dispatch_project: bei max_workers = Some(0) Rückkehr vor jedem Claim; ein 'dispatching'-Claim ist für den Dispatcher nicht 'ready'.
// Der Dispatcher-Thread startet parallel zum Reattach-Thread und wartet nicht auf ihn.
```

## Vollständiger Diff gegen origin/main
```diff
diff --git a/KNOWN_ISSUES.md b/KNOWN_ISSUES.md
index 3041bf0..c942349 100644
--- a/KNOWN_ISSUES.md
+++ b/KNOWN_ISSUES.md
@@ -60,4 +60,4 @@ vorkommen — die Einstufung „nur Linux" heißt genau das und ist per
 | KI-20 | Doppelte Antwort auf die Cursor-Abfrage `ESC[6n` (`pty.rs`, `CursorReportScanner`): seit W1-01 antwortet der Reader-Thread selbst mit `ESC[1;1R`; öffnet später jemand den Terminal-Tab, spielt xterm.js den Scrollback nach und antwortet ein zweites Mal. Außerdem ist die Antwort immer `1;1`, auch für spätere Abfragen (Resize) | — (bewusst offen) | Gefunden 2026-09-17 unabhängig von zwei Review-Pools (PR #49: kimi-k2.7-code, glm-5.2; PR #50: kimi-k3). Risiko gering: die TUI hat ihre Antwort längst verarbeitet, Eingabe-Parser verwerfen unerwartete Sequenzen. Fix-Optionen: nur die erste Abfrage je Session beantworten, auf „kein Tab gemountet" gaten, oder die beantwortete Sequenz vor dem Emit an die UI entfernen. Berührt die Naht Frontend ↔ `pty.rs`, braucht eine eigene Entscheidung. Disposition `.pa/review_kimi_delivery_disposition.md`. PR #49 führte den Punkt als „KI-15"; die Nummer ist auf `main` anders belegt. |
 | KI-21 | Das Nutzer-Plugin ruflo-core (Claude Code, `PreToolUse`/`PostToolUse Bash`: `modify-bash`/`post-command`) überschreibt eine per Shell-Redirect geschriebene Datei eines Claude-Workers mit seiner eigenen Ausgabe („Recording command outcome") | — (Umgebung, nicht ProjectA) | Übernommen 2026-09-17 aus dem Claude-Adapter-Smoke (PR #49, `.pa/report_provider_adapter_smoke_claude.md`): in Lauf 2 und im Roh-Capture reproduziert, gleiche sha256 `ab6f6f6c…` außerhalb der App. ProjectA reicht dem Worker nur eigene Hooks (`--settings`), Home-Plugins lädt Claude Code selbst. Nutzerentscheidung 17.09.: der Nutzer deaktiviert den Hook. KI-20 führt PR #50 (W1-01: Doppelantwort auf `ESC[6n`). |
 | KI-22 | Der Claude-API-Pfad (Review-Subagenten über API-Key) hat kein Guthaben (400 „credit balance too low", 14.09.) | — (extern) | Übernommen 2026-09-17 aus PR #49. Belegt ist nur der CLI-Pfad (Claude Max laut `/status`); Reviews laufen über die CLI oder den kontingentfreien Ollama-Cloud-Pool (`docs/PLAN.md` §4). Kein Handlungsbedarf im Code. |
-| KI-23 | Die Attribution in `release_claimed_queue_entries` greift beim echten Start praktisch nie: `main.rs` lässt den Reattach-Pass vorher laufen, und der setzt jeden Worker mit `AwaitExplicitRespawn`/`MarkExited` auf `exited`, die Attribution sucht aber `status = running`. Ein Claim, dessen Worker gestartet war (nur `mark_queue_dispatched` fehlte), fällt so auf `ready` und wird bei Grenze > 0 ein zweites Mal gestartet – zwei Worktrees für eine Aufgabe. Nur Worker mit `SkipDisabledProfile`/`SkipPaused` bleiben `running` und können attribuiert werden (dann `dispatched` ohne lebenden Prozess, läuft erst beim manuellen Respawn). | mittel | Gefunden 2026-09-23 bei W1-16, lokal rot belegt (`left: "ready", right: "dispatched"`); als `#[ignore]`-Test `queue::tests::a_claim_whose_worker_started_stays_with_it_after_the_reattach_pass` im Repo. Offen, weil es eine Reihenfolge-/Designfrage in `main.rs` ist (andere Nahtstelle): `MarkExited` (Worktree weg) → `ready` ist richtig, `AwaitExplicitRespawn` → Attribution an den wartenden Worker wäre es. Braucht ein eigenes Paket in `docs/PLAN.md`. |
+| KI-23 | Die Attribution in `release_claimed_queue_entries` greift beim echten Start praktisch nie: `main.rs` lässt den Reattach-Pass vorher laufen, und der setzt jeden Worker mit `AwaitExplicitRespawn`/`MarkExited` auf `exited`, die Attribution sucht aber `status = running`. Ein Claim, dessen Worker gestartet war (nur `mark_queue_dispatched` fehlte), fällt so auf `ready` und wird bei Grenze > 0 ein zweites Mal gestartet – zwei Worktrees für eine Aufgabe. Nur Worker mit `SkipDisabledProfile`/`SkipPaused` bleiben `running` und können attribuiert werden (dann `dispatched` ohne lebenden Prozess, läuft erst beim manuellen Respawn). | — (erledigt) | Gefunden 2026-09-23 bei W1-16. **Behoben 2026-09-24 (Paket KI-23, Nutzerentscheidung 24.09.):** Reattach-Pass und Claim-Freigabe stehen in `main.rs::reattach_workers_and_resolve_claims`, in drei Schritten: erst `MarkExited` anwenden (Worktree weg → Claim auf `ready`, neuer Start ist richtig), dann `release_claimed_queue_entries`, solange die `AwaitExplicitRespawn`-Worker noch `running` sind (Claim bleibt `dispatched` bei diesem Worker, kein Doppelstart), erst danach diese Worker auf `exited`. `SkipDisabledProfile`/`SkipPaused` unverändert: Worker bleibt `running`, Claim `dispatched` ohne lebenden Prozess bis zum Respawn. Belege: `queue::tests::a_claim_whose_worker_started_stays_with_it_after_the_reattach_pass` rot → grün (fährt die echte Sequenz, nicht eine Kopie), Wächter `…_worktree_is_gone_goes_back_to_ready_…`, `…_worker_is_skipped_stays_with_it_…` und `orphaned_claims_stay_ready_after_the_restart_while_the_cap_is_zero` grün. Report `.pa/report_ki-23.md`. |
diff --git a/src-tauri/src/main.rs b/src-tauri/src/main.rs
index 75ed079..b8ebea7 100644
--- a/src-tauri/src/main.rs
+++ b/src-tauri/src/main.rs
@@ -200,6 +200,86 @@ impl<'a> PtyAgents<'a> {
     }
 }
 
+/// The startup reattach pass over every persisted `running` worker, with the
+/// release of the queue claims the last process left mid-dispatch placed
+/// inside it (KI-23; the order is explained in the body).
+///
+/// A free function rather than inline in `setup` so the order of the two -
+/// which decides whether a claim is attributed or handed out again - is
+/// testable without a Tauri app (`queue::tests`).
+async fn reattach_workers_and_resolve_claims(
+    store: &Store,
+    worktree_exists: impl Fn(&str) -> bool,
+    profile_enabled: impl Fn(&str) -> bool,
+) {
+    let workers = match store.list_workers(None).await {
+        Ok(workers) => workers,
+        Err(err) => {
+            eprintln!("projecta: reattach failed to list workers: {err}");
+            return;
+        }
+    };
+    let plan = workers::plan_reattach(&workers, worktree_exists, profile_enabled);
+
+    // KI-23: the claim release attributes a claim only to a worker that is
+    // still `running`, so the order of the three steps below is the design.
+    //
+    // 1. Workers whose worktree is gone are retired first. They can never
+    //    run their task, so a claim pointing at one goes back to `ready` and
+    //    the next sweep starts it for real.
+    // 2. The claims are resolved while the workers that wait for a respawn
+    //    are still `running`: a claim whose worker did start stays with it
+    //    (`dispatched`) instead of being started a second time.
+    // 3. Only then are those workers marked `exited` to wait for the board.
+    //
+    // Skipped workers (profile switched off, budget pause) are never
+    // rewritten and stay `running` throughout, so a claim of theirs is
+    // attributed as before: `dispatched` with no live process until someone
+    // respawns the worker.
+    for (worker, action) in &plan {
+        match action {
+            workers::Reattach::SkipDisabledProfile => eprintln!(
+                "projecta: worker {} not reattached: agent profile '{}' is disabled in settings",
+                worker.id, worker.profile_id
+            ),
+            workers::Reattach::SkipPaused => eprintln!(
+                "projecta: worker {} not reattached: {}",
+                worker.id,
+                worker.paused_reason.as_deref().unwrap_or("paused")
+            ),
+            workers::Reattach::MarkExited => {
+                match workers::apply_reattach(store, worker, *action).await {
+                    Ok(()) => eprintln!(
+                        "projecta: worker {} marked exited; worktree is gone",
+                        worker.id
+                    ),
+                    Err(err) => eprintln!("projecta: could not retire worker {}: {err}", worker.id),
+                }
+            }
+            workers::Reattach::AwaitExplicitRespawn => {}
+        }
+    }
+
+    match store.release_claimed_queue_entries().await {
+        Ok(0) => {}
+        Ok(done) => eprintln!("projecta: resolved {done} interrupted queue claim(s)"),
+        Err(err) => eprintln!("projecta: could not resolve queue claims: {err}"),
+    }
+
+    for (worker, action) in &plan {
+        if *action != workers::Reattach::AwaitExplicitRespawn {
+            continue;
+        }
+        match workers::apply_reattach(store, worker, *action).await {
+            Ok(()) => eprintln!(
+                "projecta: worker {} waiting for explicit respawn after app restart",
+                worker.id
+            ),
+            Err(err) => eprintln!("projecta: could not retire worker {}: {err}", worker.id),
+        }
+    }
+}
+
 /// A short-lived `AgentControl` used only by the startup reattach pass. It owns
 /// an `AppHandle`, so it can reach the shared `PtyManager` state without
 /// holding a reference to it across an async spawn boundary.
@@ -3366,13 +3446,6 @@ fn main() {
                         Err(err) => eprintln!("projecta: could not clear stale test gates: {err}"),
                     }
 
-                    let workers = match reattach_store.list_workers(None).await {
-                        Ok(workers) => workers,
-                        Err(err) => {
-                            eprintln!("projecta: reattach failed to list workers: {err}");
-                            return;
-                        }
-                    };
                     // One read of the profile switches for the whole pass: a
                     // worker whose profile is off cannot be respawned, and
                     // finding that out here keeps it from taking a respawn slot
@@ -3390,64 +3463,14 @@ fn main() {
                         .into_iter()
                         .map(|profile| profile.id)
                         .collect();
-                    let plan = workers::plan_reattach(
-                        &workers,
+                    reattach_workers_and_resolve_claims(
+                        &reattach_store,
                         |path| Path::new(path).is_dir(),
                         |profile_id| {
                             enabled.contains(profile_id) || !known.contains(profile_id)
                         },
-                    );
-                    for (worker, action) in plan {
-                        match action {
-                            workers::Reattach::SkipDisabledProfile => eprintln!(
-                                "projecta: worker {} not reattached: agent profile '{}' is disabled in settings",
-                                worker.id, worker.profile_id
-                            ),
-                            workers::Reattach::SkipPaused => eprintln!(
-                                "projecta: worker {} not reattached: {}",
-                                worker.id,
-                                worker.paused_reason.as_deref().unwrap_or("paused")
-                            ),
-                            workers::Reattach::MarkExited
-                            | workers::Reattach::AwaitExplicitRespawn => {
-                                match workers::apply_reattach(&reattach_store, worker, action).await
-                                {
-                                    Ok(()) => match action {
-                                        workers::Reattach::AwaitExplicitRespawn => eprintln!(
-                                            "projecta: worker {} waiting for explicit respawn after app restart",
-                                            worker.id
-                                        ),
-                                        workers::Reattach::MarkExited => eprintln!(
-                                            "projecta: worker {} marked exited; worktree is gone",
-                                            worker.id
-                                        ),
-                                        _ => {}
-                                    },
-                                    Err(err) => eprintln!(
-                                        "projecta: could not retire worker {}: {err}",
-                                        worker.id
-                                    ),
-                                }
-                            }
-                        }
-                    }
-
-                    // Only now that the plan above has decided which persisted
-                    // `running` workers survived: resolve the claims the last
-                    // process left mid-dispatch. A claim whose worker came back
-                    // (or never left) is attributed to it rather than handed
-                    // out a second time; a claim with no worker behind it goes
-                    // back to `ready`. Running this before the plan would
-                    // attribute claims to workers the plan was about to retire.
-                    match reattach_store.release_claimed_queue_entries().await {
-                        Ok(0) => {}
-                        Ok(done) => {
-                            eprintln!("projecta: resolved {done} interrupted queue claim(s)")
-                        }
-                        Err(err) => {
-                            eprintln!("projecta: could not resolve queue claims: {err}")
-                        }
-                    }
+                    )
+                    .await;
                 });
             });
 
diff --git a/src-tauri/src/queue.rs b/src-tauri/src/queue.rs
index 66d7b6e..08add92 100644
--- a/src-tauri/src/queue.rs
+++ b/src-tauri/src/queue.rs
@@ -1069,19 +1069,13 @@ mod tests {
         );
     }
 
-    /// KI-23, open: the startup order in `main.rs` runs the reattach pass
-    /// before the claim release, and the pass marks every worker it would
-    /// wait on `exited`. The release only attributes to `running` workers, so
-    /// a claim whose worker did start falls back to `ready` and would be
-    /// started a second time under a cap above 0. Ignored until the order is
-    /// decided; it states the behaviour the recovery documents.
-    #[tokio::test]
-    #[ignore = "KI-23: attribution after the reattach pass is not implemented yet"]
-    async fn a_claim_whose_worker_started_stays_with_it_after_the_reattach_pass() {
-        let (_dir, store, project) = fixture().await;
+    /// A claim whose worker was started (only `mark_queue_dispatched` never
+    /// landed) plus that worker, left behind by a process that died - the
+    /// state the startup recovery in `main.rs` meets.
+    async fn claim_with_started_worker(store: &Store, project: &str) -> String {
         let entry = enqueue_with_enhancer(
-            &store,
-            &project,
+            store,
+            project,
             "exactly once",
             None,
             false,
@@ -1092,26 +1086,62 @@ mod tests {
         .await
         .unwrap();
         assert!(store.claim_queue_entry(&entry.id).await.unwrap());
-        let mut worker = running_worker(&project, "wk-started", KIND_WORKER);
+        let mut worker = running_worker(project, "wk-started", KIND_WORKER);
         worker.task = "exactly once".into();
         store.insert_worker(&worker).await.unwrap();
+        entry.id
+    }
+
+    /// KI-23: the worker waits for an explicit respawn, so the claim stays
+    /// with it. Handing it back to `ready` would start the task a second
+    /// time under a cap above 0 - two worktrees for one task. Runs the real
+    /// startup sequence from `main.rs`, not a copy of its order.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn a_claim_whose_worker_started_stays_with_it_after_the_reattach_pass() {
+        let (_dir, store, project) = fixture().await;
+        let entry = claim_with_started_worker(&store, &project).await;
+
+        // Worktree on disk, profile enabled: `AwaitExplicitRespawn`.
+        crate::reattach_workers_and_resolve_claims(&store, |_| true, |_| true).await;
 
-        // `main.rs`: reattach pass first, then the claim release.
-        for worker in store.list_workers(None).await.unwrap() {
-            crate::workers::apply_reattach(
-                &store,
-                &worker,
-                crate::workers::Reattach::AwaitExplicitRespawn,
-            )
-            .await
-            .unwrap();
-        }
-        assert_eq!(store.release_claimed_queue_entries().await.unwrap(), 1);
         let rows = store.list_queue(Some(&project)).await.unwrap();
+        assert_eq!(rows[0].id, entry);
         assert_eq!(
             rows[0].status, QUEUE_DISPATCHED,
             "the claim belongs to the worker that was started for it"
         );
+        assert_eq!(rows[0].worker_id.as_deref(), Some("wk-started"));
+    }
+
+    /// KI-23, the other half: the worker's worktree is gone (`MarkExited`),
+    /// so it can never run the task. The claim goes back to `ready` and the
+    /// next sweep starts it for real - attributing it would lose the task.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn a_claim_whose_worktree_is_gone_goes_back_to_ready_after_the_reattach_pass() {
+        let (_dir, store, project) = fixture().await;
+        claim_with_started_worker(&store, &project).await;
+
+        crate::reattach_workers_and_resolve_claims(&store, |_| false, |_| true).await;
+
+        let rows = store.list_queue(Some(&project)).await.unwrap();
+        assert_eq!(rows[0].status, QUEUE_READY);
+        assert_eq!(rows[0].worker_id, None);
+    }
+
+    /// KI-23, unchanged by the fix: a worker the pass skips (profile switched
+    /// off; a budget pause takes the same branch) stays `running`, and its
+    /// claim stays with it - `dispatched` without a live process until the
+    /// board respawns it, never a second start.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn a_claim_whose_worker_is_skipped_stays_with_it_after_the_reattach_pass() {
+        let (_dir, store, project) = fixture().await;
+        claim_with_started_worker(&store, &project).await;
+
+        crate::reattach_workers_and_resolve_claims(&store, |_| true, |_| false).await;
+
+        let rows = store.list_queue(Some(&project)).await.unwrap();
+        assert_eq!(rows[0].status, QUEUE_DISPATCHED);
+        assert_eq!(rows[0].worker_id.as_deref(), Some("wk-started"));
     }
 
     #[tokio::test]
@@ -1307,10 +1337,10 @@ mod tests {
     /// go back to `ready` at startup and stay there until the cap is raised -
     /// the recovery path is held to the same limit as a normal sweep.
     ///
-    /// This covers the store and dispatcher halves; the order in `main.rs`
-    /// (reattach pass, then claim release, then the dispatcher thread) is not
-    /// exercised here - startup needs a Tauri app. What makes that order safe
-    /// for a cap of 0 is that neither of the first two ever starts an agent.
+    /// This covers the store and dispatcher halves; the reattach order itself
+    /// is covered by the KI-23 tests above, and the dispatcher thread's start
+    /// needs a Tauri app. What makes startup safe for a cap of 0 is that
+    /// neither the reattach pass nor the claim release ever starts an agent.
     #[tokio::test]
     async fn orphaned_claims_stay_ready_after_the_restart_while_the_cap_is_zero() {
         let (_dir, store, project) = fixture().await;
diff --git a/src-tauri/src/store.rs b/src-tauri/src/store.rs
index e971505..690e7e9 100644
--- a/src-tauri/src/store.rs
+++ b/src-tauri/src/store.rs
@@ -2589,11 +2589,14 @@ impl Store {
     /// Returns how many claims were resolved. Each attribution consumes its
     /// worker, so two leftover claims can never point at the same one.
     ///
-    /// Caveat (KI-23, open): at a real startup `main.rs` runs the reattach
-    /// pass first, and it marks every worker it will wait on `exited`. Only
-    /// workers it skips (profile switched off, budget pause) are still
-    /// `running` here, so the first branch above rarely fires - a claim whose
-    /// worker did start goes back to `ready` instead.
+    /// Only `running` workers count, so the caller decides the outcome by
+    /// what it has retired beforehand. At startup that is
+    /// `main.rs::reattach_workers_and_resolve_claims` (KI-23): it retires the
+    /// workers whose worktree is gone first (their claims go back to
+    /// `ready`), calls this while the workers that wait for a respawn are
+    /// still `running` (their claims stay with them), and marks those
+    /// `exited` afterwards. Workers the reattach pass skips (profile switched
+    /// off, budget pause) stay `running` and keep their claim as well.
     pub async fn release_claimed_queue_entries(&self) -> Result<usize, String> {
         // Take the writer lock first: a deferred BEGIN would read, and SQLite
         // skips the busy handler on the later read-to-write upgrade, failing
```
```
