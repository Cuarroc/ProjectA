**Verdict: approve with conditions.** I found no correctness bug in the release itself. I read only the diff plus the surrounding code (`development_budget.rs`, `native_completion.rs`, `development_delivery.rs`, `development_usage_receipt.rs`, `workers.rs`). I did not build or run anything.

**Points I checked and found sound**
- **SQL guard:** the `EXISTS` join is keyed on `run_id`, which is the primary key of both `development_deliveries` and the launch row. The bindings are in order, and `cancelled` is valid under the reservation `CHECK`.
- **No settlement afterwards:** `settle_bound` requires `state='started'` and a launch in `exited`, and (line 334) it matches only `exited`. An `exited_undelivered` run can therefore never be settled after the release.
- **Partial index:** a second reservation for the same `run_id` is blocked twice over. `reserve_development_tokens` line 204 requires `r.status='intent'`, and this run is `reconciling` after the exit commit. You can cite that line in the G3 comment, since it is the actual guard. The comment's "a retry never reuses a terminal run's id" is currently unproven.
- **Atomicity:** the release and the event share the exit transaction. A crash before commit keeps the reservation held, and replay is idempotent.

**Findings**

**R1 (medium) – `development_budget.rs:427` and `native_completion.rs:374`: freeing the budget removes the implicit brake on a crash-looping provider.**
- A provider that always exits before reading its input (broken auth, bad binary) used to exhaust the root budget after a few attempts.
- Now every attempt costs 0 budget. Nothing in this diff bounds re-spawning.
- The DF-15 row says "begrenzte Wiederholung", so the bound belongs elsewhere. `continuous.rs` has attempt-related code (24 hits) that I did not read.
- **Condition:** name in the report which mechanism caps repeated `exited_undelivered` runs per task or goal, or add a test showing that it does.

**R2 (low–medium) – no backfill for rows already stuck from the DF-15a era.**
- The release happens only in `commit_native_undelivered_exit`, so a legacy row is freed only if a validated replay actually arrives.
- If the run is already terminal and the host never replays, the reservation stays `started` and `unresolved_operations` stays inflated.
- The KI-27 text ("der Replay-Zweig gibt … nachträglich frei") reads as if this were resolved.
- **Condition:** state in KI-27 that existing stuck rows are freed only on replay, or add a one-off sweep.
- Related: the `started_receipt` branch at `development_usage_receipt.rs:216-220` ("reservation":"retained") is now correct only for those un-replayed rows. Add a comment saying so.

**R3 (low) – `native_completion.rs:374-382` and `development_runs.rs:332`: the journal and the derived state can disagree.**
- The `development_delivery_released` event is written only when a reservation was actually released.
- `effectiveState: "released_undelivered"` is derived from launch and delivery state alone.
- If the run had no `started` implementation reservation, the briefing says released but no event exists. Both are defensible, but the event is not a reliable record of "delivery released".
- Either document this coupling or emit the event independently of the reservation.

**R4 (low, currently unreachable) – `development_delivery.rs:99`: a late enqueue is not guarded against a prior release.**
- `record_development_delivery_enqueued` checks only `state='started'`, and its docstring explicitly allows late evidence after exit.
- If it ever ran after the release, you would get delivery `enqueued`, launch `exited_undelivered` and reservation `cancelled`. `effectiveState` would be absent, and budget would be freed even though the transport accepted the input.
- Today the native path (`workers.rs:628-639`) never calls it, and the PTY path (`:641-660`) never produces `exited_undelivered`.
- A one-line comment or a guard on the launch state would keep that from changing silently.

**Challenges to earlier dispositions:** none. I agree with the rejections of G1, Q1, Q2 and Q4.
