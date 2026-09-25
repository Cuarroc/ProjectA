• Store rule confirmed. Now let me read the api.rs pieces the diff touches or depends on: `core_status`, `boot`, `call`, the cancel route handler, `FakeBackend`, and `mark_session_exited`'s side effects.

• One last check — the `Response::error` body shape the test asserts on:

• The review is complete. All evidence is in; writing the plan file (the only write plan mode allows) and exiting plan mode so I can deliver the verdict.

• # Review: PR #19 (W1-05b, api half) — cancel route over the dispatched rule

  I reviewed the complete candidate diff in `src-tauri/src/api.rs` against the store rule in `src-tauri/src/store/queue_cancel.rs` and everything the new test depends on. I found **no high or medium findings** — no correctness bugs, no gaps against the package requirement, no safety regressions. Details of what I verified, then two low notes.

  ## Verified against the actual sources (not just the diff)

  **The five fixtures really are the five branches of the rule.** `proven_process_end` (`queue_cancel.rs:50-83`) refuses in the order bound-in-memory → `running` → no session → open sessions, and each fixture lands exactly where the test expects:
  - `tq-live`: `bind_session` leaves the worker bound → "still has a live session". ✓
  - `tq-crashed`: `take_session` (`store.rs:3831`) unbinds only in memory, the `sessions` row stays open → "1 session(s) … never reported an exit". ✓
  - `tq-bare`: no row, status exited → "has no recorded session". ✓
  - `tq-running`: unbound, no session, still `running` → "is still running". ✓ (the earlier review's first low point is correct as written)
  - `tq-proven`: `mark_session_exited` (`store.rs:3552-3598`) closes the row, unbinds, *and* flips the worker RUNNING→EXITED — so the fixture is genuinely proven without an explicit `set_worker_status`, matching the store's own test at `queue_cancel.rs:251-283`.

  Every asserted substring exists verbatim in the rule's format string, including the "process end is proven" suffix the test pins at `api.rs:7463`. The 404 sentence matches `store.rs:2788` ("unknown queued task: {id}"), and the 500 pin at `api.rs:~7805` matches the pinned-delete failure text at `queue_cancel.rs:169-172` exactly.

  **The mapping cannot mis-classify.** The route (`api.rs:1808-1812`) → `core_response` → `core_status` (`api.rs:2381-2389`); the prefixes "unknown " and "refused: " (`workers.rs:77,81`) are disjoint, and `Response::error` wraps the store sentence verbatim in `{"error": …}` (`api.rs:1116-1118`), so the pass-through is real, not paraphrased.

  **The fake mirrors production exactly.** `main.rs:2852-2853` uses the identical `tauri::async_runtime::block_on(store.cancel_queue_entry(id))`. The server is thread-per-connection on plain `std::thread`s (`api.rs:1019-1033`), so `block_on` never runs inside a tokio runtime — no panic risk in either the fake or `queue_status`.

  **The test would not stay green if something regressed.** Removing the `queue_store` delegation would hit the canned arm (whose sentences don't contain the rule's reasons), a broken `core_status` is caught by every status assertion, a non-passthrough body is caught by the `refused: ` prefix and reason substrings, and row survival is re-checked after every refusal *and* after the success.

  **No flakiness sources.** Ephemeral port (`boot` binds `127.0.0.1:0`, `api.rs:974`), unique `TempDir` per process + `new_id` with best-effort removal (`testutil.rs:15-35`), descriptor written before `boot` returns, no sleeps. The `_dir`-last drop-order comment (`api.rs:7326-7331`) is accurate — fields drop in declaration order.

  **Docs do not contradict the rule.** The module doc and the `cancel_queued_task` trait doc describe the rule's sentences, the untouched-row guarantee, and the 500-never-409 distinction faithfully.

  ## Findings (both low)

  1. **Low (known, unchanged from the earlier review):** re-reading all four refused rows after the 200 (`api.rs:7476-7482`) is redundant — each was already checked dispatched inside the refusal loop. Harmless; not worth a change.
  2. **Low / informational:** the accept-loop thread holds `Arc<Inner>` → backend → the `queue_store` `Store` clone for the life of the process, so the sqlite pool is never closed at test end and on Windows the `TempDir` removal can silently leave the directory behind. `TempDir::drop` deliberately ignores this (`testutil.rs:31-35`), so nothing fails — and the pre-existing `native_store` tests share the pattern. Worst case is orphaned temp dirs, cosmetic only.

  mergebar: ja

