# Review request PR #16 (DF-15b / KI-27): release reservation and delivery after a proven undelivered exit

You are an independent reviewer (not the author; the author is a Kimi model).
Review the COMPLETE final candidate below for correctness bugs, gaps against
the requirements and safety regressions. Be concrete: cite file and line, say
what breaks and when. Rate each finding high/medium/low. Do not restate the
diff. If something is fine, say nothing about it. Answer in English or German.
This is a READ-ONLY review: do not modify any files, do not run builds.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal" (Rust backend in src-tauri/,
SQLite ledger, public GitHub repo). A native provider process that provably
ends before it read its task input reaches the terminal launch state
`exited_undelivered` (DF-15a). Until now the token reservation
(`development_token_reservations.state='started'`, holds the root budget) and
the delivery row (`development_deliveries.state='started'`) stayed open forever
(KNOWN_ISSUES KI-27). Package DF-15b (user decision): release reservation and
delivery after PROVEN process end. Fail-closed, no new migration if avoidable.
Seam: store/ (needs two foreign-vendor reviews).

## What the candidate does

- New writer `release_undelivered_run_tokens(tx, run)` in
  `store/development_budget.rs`: sets the implementation reservation
  `started -> cancelled` (budget freed) only if, in the same writer, a launch
  row `exited_undelivered` with an exit code exists and the delivery row is
  still `started`. Idempotent (0 rows = no change); journal event via the
  existing `event()`.
- Called in `commit_native_undelivered_exit` (`store/native_completion.rs`)
  after the launch UPDATE, in both branches (first commit and validated
  replay; the replay releases rows from the DF-15a era retroactively). On an
  actual release a `development_delivery_released` event is written to
  `continuous_events`. All in the same transaction as the exit commit.
- `run_receipt` (`development_usage_receipt.rs`): `cancelled` + launch
  `exited_undelivered` gets the honest reason "provider exited before its
  input was delivered; reservation released unused".
- `agent_run_context` (`development_runs.rs`): delivery JSON gets derived
  `effectiveState: "released_undelivered"` (only when launch is
  `exited_undelivered` and raw delivery state is `started`); raw row stays
  `started`. No schema migration.
- Tests: red-first (af20f63 red, exit 101; then 9d22347 green), guard test in
  development_budget.rs, ledger test in native_completion.rs (incl. legacy
  replay), receipt test, integration assertion in workers.rs.
- One extra commit ab3af5a: rustfmt-1.98.1 wrap of a foreign test assertion in
  src/skills.rs (main is fmt-red there; the same repair runs in another PR).

## Rules to check against

- Fail-closed: without the proven exit (ledger, process identity, exit code)
  nothing may be released. `exited` readers (usage settlement) must stay
  untouched; no settlement without a receipt.
- Atomicity/crash safety: crash before commit keeps the reservation held.
  Replay idempotent, no duplicate event.
- `cancelled` frees the budget (`balance()` counts only `reserved`/`started`):
  is "released unused" truthful here, or does it mask something (e.g. can an
  `exited_undelivered` run still be settled afterwards)?
- SQL correctness of guards (EXISTS join, bindings, CHECK constraints:
  reservation allows ('reserved','started','settled','cancelled'), delivery
  allows only ('started','enqueued')).
- The unique index `development_implementation_budget ON
  development_token_reservations(run_id) WHERE purpose='implementation' AND
  state != 'cancelled'` permits a new reservation for the same run_id after
  `cancelled` - a problem here?
- No secrets, no costs, no new dependencies.

## Review history (already addressed - verify, do not just re-report)

Earlier reviewers (glm-5.2, qwen2.5-coder) reviewed the candidate. Fixed: G2
(derived effectiveState only when delivery.state='started'), G3 (comment on
the partial-index invariant). Rejected with reasons: G1 (settled_at on cancel
follows the existing convention of cancel_development_tokens), Q1 (EXISTS
performance: primary-key join, single rows), Q2 (race: single writer, state
guard, idempotent), Q3 (reason text is display only), Q4 (only call site is
after ledger/identity/exit-code validation, SQL guard repeats the proof),
Q5-Q20 (commit failure => rollback of the release as well). Challenge these
if you disagree; hunt for NEW problems.

## Output format

Per finding: ID (running), severity (high/medium/low), file:line, reasoning.
At the end a verdict: `approve` / `approve with conditions` / `reject`.
No findings = verdict with one sentence.

## Candidate

Branch `claude/df-15b`, head `fd14dec`, merge base with origin/main `c60f267`.
Complete diff (`git diff origin/main...HEAD`; note: origin/main has since
moved on but unrelated files):

```diff
diff --git a/KNOWN_ISSUES.md b/KNOWN_ISSUES.md
index 327048d..dd2d054 100644
--- a/KNOWN_ISSUES.md
+++ b/KNOWN_ISSUES.md
@@ -50,7 +50,7 @@ vorkommen — die Einstufung „nur Linux" heißt genau das und ist per
 | KI-24 | SQLite-Lastklasse: einzelne Store-Tests scheiterten unter paralleler Last mit `database is locked (code: 5)` bzw. `pool timed out` — `store::continuous::tests::stale_fence_cannot_complete_claim_and_expiry_does_not_reclaim` (Linux, Run 35288206709 auf `main` @ `4e409d9`, 17.09.) und `workers::tests::an_agent_that_exits_during_respawn_is_not_revived_as_running` (Linux, Run 35025975338, 15.09.) | niedrig (bearbeitet, beobachten) | Aus `STAND.md` übernommen 2026-09-24. **Bearbeitet** mit W1-25 (PR #77: Transaktionen schließen, Pool-Frist) und W1-25b (PR #85: Store-Schreiber gegen fremde Schreiber). Nicht reproduziert ist der ursprüngliche Drop-Wettlauf (`.pa/report_w1-25.md`, „Nicht abgedeckt"). Der frühere `delivery_recovery`-Fall ist mit W1-04 (PR #55, 20/20 unter Last) abgenommen. Tritt einer der Tests wieder auf, ist das ein neuer Befund mit Run-ID, kein „Flake". |
 | KI-25 | Linux-Prozessgruppen-Test `testgate::tests::a_timeout_takes_the_whole_process_group_with_it` scheiterte einmal (Run 35630751744 auf PR #50 @ `c3a035d`, 21.09.; Windows-Gates und `red-first` desselben Laufs grün, PR #50 berührt `testgate.rs` nicht) | niedrig (Fix eingebaut, beobachten) | Aus `STAND.md` übernommen 2026-09-24. **Ursache am 24.09. gemessen (W1-29, Branch `claude/w1-29-linux-testgate-flake`):** `process_is_alive` zählte jeden Zustand außer `Z` als laufend. Wer einen Zombie abholt, setzt ihn zuerst auf `X` (EXIT_DEAD) und hängt ihn danach aus; in diesem Fenster zeigt `/proc/<pid>/stat` ein `X`. Ein C-Probe mit dem Ablauf des Tests las in 136 von 300 Läufen `Z` und in der direkt folgenden Lesung `X`, also „tot“, dann „lebt“. Das passt zum roten Lauf: libtest meldete `finished in 1.00s`, die Schleife endete also bei der ersten Lesung, und der Assert las gleich danach erneut. Den Einzelfall des Tests selbst hat keiner der Läufe nachgestellt (360 nextest-Läufe und 1000 Probe-Läufe mit dem genauen Lesemuster, alle grün), weil das Fenster zwischen den beiden Lesungen nur Mikrosekunden breit ist. Fix: `X`/`x` zählen als tot, und der Test urteilt nach der letzten Lesung seiner Schleife (`.pa/report_w1-29.md`). **Rest:** `setupgate.rs:1735` hat dieselbe Klassifikation im Geschwistertest `children_of_a_trusted_setup_run_are_dead_before_cleanup`; das lag außerhalb des Pakets und ist Paket **W1-29b**. |
 | KI-26 | Windows-PTY-Argumenttest `pty::tests::a_quote_and_a_variable_reach_the_process_unchanged` scheiterte sporadisch (Run 35266952403 auf PR #47, 17.09.; Run 35917374303 Attempt 1 auf PR #70, 23.09.: Marker fehlt, nur 66 Bytes Terminal-Initialisierung, `node.exe` lebt nach 15 s noch) | niedrig (Fix eingebaut, beobachten) | Aus `STAND.md` übernommen 2026-09-24 (dort mit PR #104 dokumentiert). 1200 isolierte Läufe auf gehosteten Windows-Runnern (Node 22.23.2 und 24.20.0, sequentiell sowie 4- und 8-fach parallel, Run 35930829926) waren alle grün. Am 24.09. belegt (Run 35999923714): `node.exe` startete, die DSR-Antwort ging hinaus, aber `cli.js` lief in 15 s nie — der Test ist der erste Start dieser `node.exe` auf der VM. Seitdem startet der Test Node einmal außerhalb des PTY vor; der Lauf auf `a2c89fc` war grün. Wird er trotzdem wieder rot, ist die Kaltstart-Erklärung widerlegt (`.pa/report_ci_native_pty_marker.md`). |
-| KI-27 | Ein nativer Provider, der vor dem Lesen seines Inputs endet, landet seit DF-15a im Endzustand `exited_undelivered` — seine Token-Reservierung und die Delivery-Zeile bleiben aber `started` | — (offene Produktfrage) | Aus `STAND.md` übernommen 2026-09-24. Der eigentliche Befund (Launch blieb `spawning`/unaufgelöst) ist mit DF-15a (PR #103, Migration 22) behoben. Offen laut `.pa/report_df15_early_provider_exit.md` („NICHT ABGEDECKT"): ob und wie die Reservierung ohne Receipt freigegeben wird, und ein Absturz zwischen Host-Ende und Store-Commit bleibt fail-closed `spawning`. Paket **DF-15b**, wartet auf eine Produktentscheidung. |
+| KI-27 | Ein nativer Provider, der vor dem Lesen seines Inputs endet, landet seit DF-15a im Endzustand `exited_undelivered` — seine Token-Reservierung und die Delivery-Zeile bleiben aber `started` | niedrig (bearbeitet, beobachten) | Aus `STAND.md` übernommen 2026-09-24. Der eigentliche Befund (Launch blieb `spawning`/unaufgelöst) ist mit DF-15a (PR #103, Migration 22) behoben. **Freigabe bearbeitet mit DF-15b (Nutzerentscheidung):** der bewiesene Exit-Commit gibt die ungenutzte Reservierung frei (`cancelled`, Budget wieder verfügbar) und journalisiert die Delivery-Freigabe (`development_delivery_released`), atomar in derselben Transaktion; der Replay-Zweig gibt Zeilen aus DF-15a-Zeit nachträglich frei. Die rohe Delivery-Zeile bleibt bewusst `started` (historisch wahr: Intent begann, nie `enqueued`); die Freigabe ist abgeleitet (`effectiveState` im Briefing) statt migriert. Weiterhin fail-closed: ein Absturz zwischen Host-Ende und Store-Commit bleibt `spawning` mit gehaltener Reservierung. |
 | KI-28 | Der Capture-Host (`bin/pa-capture-host.rs`) läuft nur unter Windows | — (dokumentierte Grenze) | Entscheidung 16.09. (W3-05, `docs/decisions.md`; `pa-capture-host.rs:142`). Aus `STAND.md` übernommen 2026-09-24. Die frühere Einschränkung „acht native Tests laufen in CI nie" gilt nicht mehr: W3-06 (PR #75) fährt sie im Gate `native-tests` der Windows-Bahn. Linux-CI prüft nur die Kompilation. |
 | KI-29 | F-SEC-4, Restrisiko des OmniRoute-Key-Syncs: wer den Opt-in einschaltet, schickt die Vault-Keys an den Listener auf dem OmniRoute-Port, ohne dessen Identität zu prüfen | niedrig (bewusst in Kauf genommen) | Default ist seit W1-24 (PR #62) „kein Push"; W1-24b (PR #98) hat daraus ein ausdrückliches Opt-in-Setting gemacht, das im UI das Restrisiko benennt (`.pa/report_w1-24b.md`, „Hinweise und Folgearbeiten"). Eine Listener-Identität gibt es nicht: `/api/version` bräche Builds, die es weglassen, und ein Management-Token als Bearer gäbe es einem Horcher mit (PLAN, frühere Entscheidung Nr. 13). Solange der Sync aus bleibt, besteht kein Risiko. Paket W1-24c. |
 
diff --git a/docs/PLAN.md b/docs/PLAN.md
index c45f273..4306d81 100644
--- a/docs/PLAN.md
+++ b/docs/PLAN.md
@@ -141,7 +141,7 @@ Jede Abnahme gilt zusätzlich zum gemeinsamen Abschlussprotokoll weiter unten.
 | DF-12 | Unabhängigkeitsgate · Backend · CORE · M | DF-08, DF-11 | Kandidatenweite Autor-Familienmenge sperrt eigene Review-/Testbewertung, auch nach Handoff/Alias/Review-Fix; unbekannte Identität blockiert Attestation. Negativtests zwingend. |
 | DF-13 | Berechtigungsteam · Backend · CORE · M | DF-01, DF-11 | Versionierte, vom Nutzer festgelegte Policy auswerten; erlauben/ablehnen/eskalieren mit Gründen. Keine Selbst-Erweiterung, kein gefälschter Human-Verdict; Replay und Scopewechsel testen. |
 | DF-14 | Stationsübergabe · Backend · CORE · M | DF-12, DF-13 | Bestehende Admission/Claims für nächste Station nutzen; atomare Übergabe, Idempotenz, Fencing, Budget aller Nachfahren. Doppelzustellung und Crash vor/nach Spawn testen. |
-| DF-15 | Rücklauf und Recovery · Backend · CORE · M | DF-14 | Review→Fix→neuer Review, Pause/Cancel, Quota/Auth-Ausfall, begrenzte Wiederholung und Wiederaufnahme; Leaseablauf nie als Prozessende werten. Der frühe Provider-Exit vor dem Lesen des Task-Inputs ist als DF-15a erledigt (PR #103, Endzustand `exited_undelivered`, Migration 22); die dabei offen gebliebene Freigabe von Reservierung und Delivery steht in KNOWN_ISSUES KI-27. |
+| DF-15 | Rücklauf und Recovery · Backend · CORE · M | DF-14 | Review→Fix→neuer Review, Pause/Cancel, Quota/Auth-Ausfall, begrenzte Wiederholung und Wiederaufnahme; Leaseablauf nie als Prozessende werten. Der frühe Provider-Exit vor dem Lesen des Task-Inputs ist als DF-15a erledigt (PR #103, Endzustand `exited_undelivered`, Migration 22); die dabei offen gebliebene Freigabe von Reservierung und Delivery ist als DF-15b erledigt (KNOWN_ISSUES KI-27: Reservierung `cancelled` und Delivery-Freigabe journalisiert, atomar im bewiesenen Exit-Commit, ohne neue Migration). |
 | DF-16 | Workflow-API · Integrator · SEAM/HOST · M | DF-15 | Start/Pause/Status/Decision über denselben Kern für App/HQ/CLI; Autorisierung, Konflikt und Event-Replay prüfen, kein Scheduler im Host. |
 | DF-17 | Team-/Stationsgraph · Frontend · HQ · M | DF-02, DF-16 | Ideen→Interview→Plan→Koordination→Architektur→Code/Design→Review→Test→Kritik mit konfigurierbaren Stationen, Rollen, Zuständen und Übergabegründen; native Teams/Lessons erhalten. |
 | DF-18 | Entscheidungs-Inbox · Frontend · HQ/APP · M | DF-16 | Nur echte Nutzerfragen/Freigaben, Kontext/Optionen/Auswirkung, Zielprojekt und Version sichtbar; doppelte/veraltete Entscheidung abweisen und auflösen. |
diff --git a/src-tauri/src/skills.rs b/src-tauri/src/skills.rs
index 59024d0..72cf56e 100644
--- a/src-tauri/src/skills.rs
+++ b/src-tauri/src/skills.rs
@@ -418,7 +418,10 @@ mod tests {
             "ui-ux-pro-max missing from {ids:?}"
         );
         let pack = dev.join("ui-ux-pro-max");
-        assert!(pack.join("SKILL.md").is_file(), "SKILL.md missing from ui-ux-pro-max");
+        assert!(
+            pack.join("SKILL.md").is_file(),
+            "SKILL.md missing from ui-ux-pro-max"
+        );
         let skill = std::fs::read_to_string(pack.join("SKILL.md")).expect("read SKILL.md");
         let (name, description) = parse_front_matter(&skill);
         assert_eq!(name.as_deref(), Some("ui-ux-pro-max"));
diff --git a/src-tauri/src/store/development_budget.rs b/src-tauri/src/store/development_budget.rs
index 4003f9c..18d9833 100644
--- a/src-tauri/src/store/development_budget.rs
+++ b/src-tauri/src/store/development_budget.rs
@@ -1,6 +1,8 @@
 //! Root-wide token accounting. Only trusted services call the writers; agents
 //! cannot settle their own usage or manufacture an allowance through HTTP.
-//! Unknown usage retains the entire reservation across exits and restarts.
+//! Unknown usage retains the entire reservation across exits and restarts; the
+//! one known-zero case, a proven `exited_undelivered` exit before input
+//! delivery (DF-15b / KI-27), releases the reservation unused instead.
 use super::{new_id, now_unix_secs, Store};
 use crate::development_policy::{DevelopmentPolicy, TokenPolicy};
 use serde::{Deserialize, Serialize};
@@ -88,6 +90,9 @@ pub struct TokenBalance {
 pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
     sqlx::query("CREATE TABLE development_token_reservations(id TEXT PRIMARY KEY, root_goal_id TEXT NOT NULL, goal_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('planning','context','discovery','implementation','review','verification')), run_id TEXT, reserved_tokens INTEGER NOT NULL CHECK(reserved_tokens > 0), state TEXT NOT NULL CHECK(state IN ('reserved','started','settled','cancelled')), actual_tokens INTEGER CHECK(actual_tokens >= 0), source TEXT, observed_at INTEGER, created_at INTEGER NOT NULL, started_at INTEGER, settled_at INTEGER, UNIQUE(root_goal_id,idempotency_key))")
         .execute(&mut **tx).await.map_err(db)?;
+    // DF-15b: a reservation cancelled by the undelivered-exit release frees
+    // this index slot for the same run_id. That is safe: a retry never reuses
+    // a terminal run's id, so no second live reservation can appear for it.
     sqlx::query("CREATE UNIQUE INDEX development_implementation_budget ON development_token_reservations(run_id) WHERE purpose = 'implementation' AND state != 'cancelled'")
         .execute(&mut **tx).await.map_err(db)?;
     Ok(())
@@ -402,6 +407,32 @@ pub(super) async fn consume_worker(
     start(tx, &id).await
 }
 
+/// DF-15b / KI-27: releases the implementation reservation of a run whose
+/// provider demonstrably exited before its input was delivered. The
+/// reservation was consumed with the launch, but no token ever reached the
+/// provider, so it is cancelled unused and the budget is freed. The guard
+/// repeats the proof inside the writer transaction: only an
+/// `exited_undelivered` launch with a recorded exit code whose delivery
+/// intent never left `started` qualifies; anything else changes nothing and
+/// keeps the reservation retained. Returns true when this call released.
+pub(super) async fn release_undelivered_run_tokens(
+    tx: &mut Transaction<'_, Sqlite>,
+    run: &str,
+) -> Result<bool, String> {
+    let row: Option<(String, String)> = sqlx::query_as("SELECT id,root_goal_id FROM development_token_reservations WHERE run_id=? AND purpose='implementation' AND state='started'")
+        .bind(run).fetch_optional(&mut **tx).await.map_err(db)?;
+    let Some((id, root)) = row else {
+        return Ok(false);
+    };
+    let changed = sqlx::query("UPDATE development_token_reservations SET state='cancelled',settled_at=? WHERE id=? AND state='started' AND EXISTS(SELECT 1 FROM development_launches l JOIN development_deliveries d ON d.run_id=l.run_id WHERE l.run_id=? AND l.state='exited_undelivered' AND l.exit_code IS NOT NULL AND d.state='started')")
+        .bind(now_unix_secs()).bind(&id).bind(run).execute(&mut **tx).await.map_err(db)?;
+    if changed.rows_affected() != 1 {
+        return Ok(false);
+    }
+    event(tx, &root, &id).await?;
+    Ok(true)
+}
+
 #[cfg(test)]
 #[path = "development_usage_binding_tests.rs"]
 mod usage_binding_tests;
@@ -714,6 +745,111 @@ mod tests {
         assert_eq!(totals(&store, &root).await.measured_tokens, 500);
     }
 
+    /// DF-15b / KI-27: the release guard itself. Without the proven
+    /// `exited_undelivered` constellation nothing is freed; with it, exactly
+    /// once.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn undelivered_release_requires_the_proven_terminal_exit() {
+        let (_dir, store, _project, root) = fixture().await;
+        let task = store
+            .create_continuous_task(
+                &root,
+                "implementation",
+                None,
+                vec!["src/budget.rs".into()],
+                vec![],
+            )
+            .await
+            .unwrap();
+        let claim = store
+            .claim_continuous_task(&task.id, "owner", false)
+            .await
+            .unwrap();
+        let run = store
+            .record_development_run_intent(&task.id, "owner", claim.fence)
+            .await
+            .unwrap();
+        let launch = store
+            .reserve_development_launch(&run.id, "owner", claim.fence, "codex")
+            .await
+            .unwrap();
+        store.bind_development_launch_route(&run.id,"owner",claim.fence,&serde_json::json!({"selection":{"resolved":{"profileId":"codex"}},"expiresAt":now_unix_secs()+600})).await.unwrap();
+        store
+            .bind_development_launch_baseline(&run.id, "owner", claim.fence, &"a".repeat(40))
+            .await
+            .unwrap();
+        store
+            .reserve_development_tokens(
+                &root,
+                "implementation",
+                BudgetPurpose::Implementation,
+                10_000,
+                Some(&run.id),
+            )
+            .await
+            .unwrap();
+        store
+            .consume_development_launch(&run.id, "owner", claim.fence, &launch.worker_id, "session")
+            .await
+            .unwrap();
+        // Started reservation, but the launch is still `spawning` and no
+        // delivery intent exists: nothing qualifies, nothing changes.
+        let mut tx = store.pool.begin().await.unwrap();
+        assert!(!release_undelivered_run_tokens(&mut tx, &run.id)
+            .await
+            .unwrap());
+        assert!(!release_undelivered_run_tokens(&mut tx, "no-such-run")
+            .await
+            .unwrap());
+        tx.commit().await.unwrap();
+        assert_eq!(totals(&store, &root).await.unresolved_operations, 1);
+        // A plain `exited` launch (delivered path) does not qualify either.
+        sqlx::query(
+            "UPDATE development_launches SET state='exited',exit_code=0,exited_at=1 WHERE run_id=?",
+        )
+        .bind(&run.id)
+        .execute(&store.pool)
+        .await
+        .unwrap();
+        let mut tx = store.pool.begin().await.unwrap();
+        assert!(!release_undelivered_run_tokens(&mut tx, &run.id)
+            .await
+            .unwrap());
+        tx.commit().await.unwrap();
+        assert_eq!(totals(&store, &root).await.unresolved_operations, 1);
+        // The proven constellation: terminal undelivered exit with an exit
+        // code and a delivery intent that never left `started`.
+        sqlx::query("INSERT INTO development_deliveries(run_id,session_id,process_instance,route_sha256,input_sha256,input_bytes,state,started_at) SELECT run_id,session_id,process_instance,'r','i',4,'started',1 FROM development_launches WHERE run_id=?")
+            .bind(&run.id)
+            .execute(&store.pool)
+            .await
+            .unwrap();
+        sqlx::query("UPDATE development_launches SET state='exited_undelivered',exit_code=2,exit_reason='provider_exited_before_input_delivery' WHERE run_id=?")
+            .bind(&run.id)
+            .execute(&store.pool)
+            .await
+            .unwrap();
+        let mut tx = store.pool.begin().await.unwrap();
+        assert!(release_undelivered_run_tokens(&mut tx, &run.id)
+            .await
+            .unwrap());
+        // Replay inside the same or a later transaction releases nothing twice.
+        assert!(!release_undelivered_run_tokens(&mut tx, &run.id)
+            .await
+            .unwrap());
+        tx.commit().await.unwrap();
+        let balance = totals(&store, &root).await;
+        assert_eq!(balance.reserved_tokens, 0);
+        assert_eq!(balance.unresolved_operations, 0);
+        let state: String =
+            sqlx::query_scalar("SELECT state FROM development_token_reservations WHERE run_id=?")
+                .bind(&run.id)
+                .fetch_one(&store.pool)
+                .await
+                .unwrap();
+        assert_eq!(state, "cancelled");
+    }
+
     #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
     async fn budget_boundary_exact_exhaustion_is_blocked_not_left_open() {
         let (_dir, store, project, root) = fixture().await;
diff --git a/src-tauri/src/store/development_runs.rs b/src-tauri/src/store/development_runs.rs
index a6ff2e4..4b13638 100644
--- a/src-tauri/src/store/development_runs.rs
+++ b/src-tauri/src/store/development_runs.rs
@@ -321,6 +321,23 @@ impl Store {
                 .fetch_optional(&mut *tx)
                 .await
                 .map_err(db("read delivery intent"))?;
+        // DF-15b / KI-27: the raw row stays as recorded (the intent began,
+        // the transport never confirmed an enqueue); the release after a
+        // proven undelivered exit is derived here, not rewritten.
+        let delivery = delivery
+            .map(|delivery| {
+                let released = delivery.state == "started"
+                    && launch
+                        .as_ref()
+                        .is_some_and(|launch| launch.state == "exited_undelivered");
+                let mut value = serde_json::to_value(&delivery)
+                    .map_err(|error| format!("project delivery intent: {error}"))?;
+                if released {
+                    value["effectiveState"] = "released_undelivered".into();
+                }
+                Ok::<serde_json::Value, String>(value)
+            })
+            .transpose()?;
         let checkpoint = checkpoints::latest(&mut tx, &run.task_id).await?;
         let assignment = super::team_assignments::read(&mut tx, &run.task_id).await?;
         let dispatch = match super::development_launches::run_role(&mut tx, run_id).await {
diff --git a/src-tauri/src/store/development_usage_receipt.rs b/src-tauri/src/store/development_usage_receipt.rs
index 0a823f3..6732eaf 100644
--- a/src-tauri/src/store/development_usage_receipt.rs
+++ b/src-tauri/src/store/development_usage_receipt.rs
@@ -2,7 +2,9 @@
 //! collector and source it came from, when it was observed and whether it is
 //! a live provider report. A run without a trusted collector carries a named
 //! `not_reported` provenance, never a silent gap. Only `measured` receipts
-//! settle the ledger; every other state keeps the whole reservation.
+//! settle the ledger; every other state keeps the whole reservation - except
+//! the proven `exited_undelivered` exit (DF-15b / KI-27), whose reservation
+//! is released unused because no token ever reached the provider.
 use super::TokenReservation;
 use crate::store::development_launches::DevelopmentLaunch;
 use serde_json::{json, Value};
@@ -159,8 +161,16 @@ pub(in crate::store) fn run_receipt(
     };
     let mut receipt = match reservation.state.as_str() {
         "settled" => settled_receipt(reservation),
-        "cancelled" => json!({"state":"cancelled",
-            "reason":"reservation cancelled before work started"}),
+        "cancelled" => match launch {
+            // DF-15b / KI-27: released because the provider exited before its
+            // input was delivered - known-zero usage, not a pre-work cancel.
+            Some(launch) if launch.state == "exited_undelivered" => {
+                json!({"state":"cancelled",
+                    "reason":"provider exited before its input was delivered; reservation released unused"})
+            }
+            _ => json!({"state":"cancelled",
+                "reason":"reservation cancelled before work started"}),
+        },
         "reserved" => json!({"state":"pending",
             "reason":"run has not launched; reservation held"}),
         _ => started_receipt(launch, capture_usage),
diff --git a/src-tauri/src/store/development_usage_receipt_tests.rs b/src-tauri/src/store/development_usage_receipt_tests.rs
index 47afbdb..acf29b2 100644
--- a/src-tauri/src/store/development_usage_receipt_tests.rs
+++ b/src-tauri/src/store/development_usage_receipt_tests.rs
@@ -266,6 +266,33 @@ fn every_run_cost_receipt_names_its_state_and_provenance() {
     }
 }
 
+/// DF-15b / KI-27: a reservation released because the provider exited before
+/// its input was delivered is named as exactly that - never misread as a
+/// cancellation before work started.
+#[test]
+fn a_released_undelivered_reservation_is_named_not_misread_as_unstarted() {
+    let released = run_receipt(
+        Some(&reservation("cancelled")),
+        Some(&launch("exited_undelivered", "codex")),
+        None,
+    );
+    assert_eq!(released["state"], "cancelled");
+    assert_eq!(released["ledgerState"], "cancelled");
+    let reason = released["reason"].as_str().unwrap();
+    assert!(
+        reason.contains("exited before its input was delivered"),
+        "{reason}"
+    );
+    assert!(!reason.contains("before work started"), "{reason}");
+    assert_never_unavailable(&released);
+    // A plain pre-work cancellation keeps its own reason.
+    let plain = run_receipt(Some(&reservation("cancelled")), None, None);
+    assert!(plain["reason"]
+        .as_str()
+        .unwrap()
+        .contains("before work started"));
+}
+
 /// Review round 1 (kimi-k3 K1/K2/K4, glm-5.2 G1-G3): provenance is never
 /// stated stronger than the stored evidence.
 #[test]
diff --git a/src-tauri/src/store/native_completion.rs b/src-tauri/src/store/native_completion.rs
index 7da2bb0..d8dceb6 100644
--- a/src-tauri/src/store/native_completion.rs
+++ b/src-tauri/src/store/native_completion.rs
@@ -365,6 +365,21 @@ impl Store {
             sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) SELECT project_id,'development_capture_exited_undelivered',json_object('version',1,'runId',run_id,'exitCode',?,'reason',?),unixepoch() FROM development_launches WHERE run_id=?")
                 .bind(exit_code).bind(reason).bind(&owner.binding.run_id).execute(&mut *tx).await.map_err(db)?;
         }
+        // DF-15b / KI-27: the proof above (checkpoint ledger, process
+        // identity, exit code) also releases the unused reservation and
+        // journals the delivery release, atomically with the exit. The
+        // release is guarded and idempotent, so the replay branch frees rows
+        // committed before the release existed. Without a commit nothing is
+        // freed: a crash before it keeps the reservation held (fail-closed).
+        if crate::store::development_budget::release_undelivered_run_tokens(
+            &mut tx,
+            &owner.binding.run_id,
+        )
+        .await?
+        {
+            sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) SELECT project_id,'development_delivery_released',json_object('version',1,'runId',run_id,'exitCode',?,'reason',?),unixepoch() FROM development_launches WHERE run_id=?")
+                .bind(exit_code).bind(reason).bind(&owner.binding.run_id).execute(&mut *tx).await.map_err(db)?;
+        }
         tx.commit().await.map_err(db)
     }
 }
@@ -1275,6 +1290,129 @@ mod tests {
         assert_eq!(status, crate::store::STATUS_EXITED);
     }
 
+    // DF-15b / KI-27: the proven undelivered exit releases the run's token
+    // reservation (unused: the input never reached the provider) and journals
+    // the delivery release - atomically, in the same transaction as the exit.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn undelivered_exit_releases_its_reservation_and_delivery_exactly_once() {
+        let (_dir, store, owner, exit, now) =
+            undelivered_fixture(&[Stage::Launch, Stage::Process]).await;
+        let run = owner.binding.run_id.clone();
+        let reservation: String =
+            sqlx::query_scalar("SELECT id FROM development_token_reservations WHERE run_id=?")
+                .bind(&run)
+                .fetch_one(&store.pool)
+                .await
+                .unwrap();
+        let before = {
+            let mut tx = store.pool.begin().await.unwrap();
+            let balance = crate::store::development_budget::balance(&mut tx, "goal")
+                .await
+                .unwrap();
+            tx.commit().await.unwrap();
+            balance
+        };
+        assert_eq!(before.reserved_tokens, 1000);
+        assert_eq!(before.unresolved_operations, 1);
+        undeliver(&store, &owner, &exit, now).await.unwrap();
+        undeliver(&store, &owner, &exit, now).await.unwrap(); // crash-safe replay
+        let (state, settled_at): (String, Option<i64>) = sqlx::query_as(
+            "SELECT state,settled_at FROM development_token_reservations WHERE id=?",
+        )
+        .bind(&reservation)
+        .fetch_one(&store.pool)
+        .await
+        .unwrap();
+        assert_eq!(
+            state, "cancelled",
+            "the unused reservation is released after the proven exit"
+        );
+        assert!(settled_at.is_some());
+        let events: i64 = sqlx::query_scalar(
+            "SELECT count(*) FROM continuous_events WHERE kind='development_delivery_released'",
+        )
+        .fetch_one(&store.pool)
+        .await
+        .unwrap();
+        assert_eq!(events, 1, "the delivery release is journaled exactly once");
+        // The raw delivery row stays truthful: the intent began and the
+        // transport never confirmed an enqueue; the release lives in the
+        // journal and the terminal launch state, not in rewritten history.
+        let delivery: String =
+            sqlx::query_scalar("SELECT state FROM development_deliveries WHERE run_id=?")
+                .bind(&run)
+                .fetch_one(&store.pool)
+                .await
+                .unwrap();
+        assert_eq!(delivery, "started");
+        // A row committed before the release existed (DF-15a era: exit
+        // committed, reservation still held) is freed on the next validated
+        // replay - again exactly once.
+        sqlx::query(
+            "UPDATE development_token_reservations SET state='started',settled_at=NULL WHERE id=?",
+        )
+        .bind(&reservation)
+        .execute(&store.pool)
+        .await
+        .unwrap();
+        sqlx::query("DELETE FROM continuous_events WHERE kind='development_delivery_released'")
+            .execute(&store.pool)
+            .await
+            .unwrap();
+        undeliver(&store, &owner, &exit, now).await.unwrap();
+        undeliver(&store, &owner, &exit, now).await.unwrap();
+        let (state, events): (String, i64) = sqlx::query_as(
+            "SELECT (SELECT state FROM development_token_reservations WHERE id=?),(SELECT count(*) FROM continuous_events WHERE kind='development_delivery_released')",
+        )
+        .bind(&reservation)
+        .fetch_one(&store.pool)
+        .await
+        .unwrap();
+        assert_eq!(state, "cancelled", "the replay frees the legacy row");
+        assert_eq!(events, 1, "the legacy release is journaled exactly once");
+        let after = {
+            let mut tx = store.pool.begin().await.unwrap();
+            let balance = crate::store::development_budget::balance(&mut tx, "goal")
+                .await
+                .unwrap();
+            tx.commit().await.unwrap();
+            balance
+        };
+        assert_eq!(
+            after.reserved_tokens, 0,
+            "the released budget is free again"
+        );
+        assert_eq!(after.unresolved_operations, 0);
+        assert_eq!(after.available_tokens, before.available_tokens + 1000);
+        // The cost receipt names the release instead of the generic
+        // "cancelled before work started", and the briefing carries the
+        // derived delivery release.
+        let launch = store.development_launch(&run).await.unwrap().unwrap();
+        let receipt = {
+            let mut tx = store.pool.begin().await.unwrap();
+            let receipt = crate::store::development_budget::usage_receipt::for_run(
+                &mut tx,
+                &run,
+                Some(&launch),
+            )
+            .await
+            .unwrap();
+            tx.commit().await.unwrap();
+            receipt
+        };
+        assert_eq!(receipt["state"], "cancelled");
+        assert!(receipt["reason"]
+            .as_str()
+            .unwrap()
+            .contains("before its input was delivered"));
+        let context = store.agent_run_context(&run, "owner", 1).await.unwrap();
+        assert_eq!(context["delivery"]["state"], "started");
+        assert_eq!(
+            context["delivery"]["effectiveState"],
+            "released_undelivered"
+        );
+    }
+
     #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
     async fn undelivered_exit_without_exact_ledger_process_or_fence_stays_unresolved() {
         let both = [Stage::Launch, Stage::Process];
diff --git a/src-tauri/src/workers.rs b/src-tauri/src/workers.rs
index c0e5b12..1173f0b 100644
--- a/src-tauri/src/workers.rs
+++ b/src-tauri/src/workers.rs
@@ -4035,7 +4035,16 @@ mod tests {
         assert_eq!(result["exitCode"], 2);
         assert!(result.get("usage").is_none() && result.get("receipt").is_none());
         assert_eq!(delivery, "started", "delivery must not be recorded");
-        assert_eq!(budget, "started", "no usage may be settled");
+        // DF-15b / KI-27: after the proven exit the unused reservation is
+        // released (never settled - there is no usage receipt).
+        assert_eq!(budget, "cancelled", "no usage may be settled");
+        let released: i64 = sqlx::query_scalar(
+            "SELECT count(*) FROM continuous_events WHERE kind='development_delivery_released'",
+        )
+        .fetch_one(&pool)
+        .await
+        .unwrap();
+        assert_eq!(released, 1, "the delivery release is journaled");
         // Credentials revoked and session/worker closed like a normal finalize.
         assert_eq!(crate::api::tests::native_context_status(&descriptor), 401);
         assert_eq!(
```
