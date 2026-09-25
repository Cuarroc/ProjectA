# Review disposition: W1-05b api (seam `api.rs`)

Stage A, two reviewers of other model families than the author (Claude): **Grok** (xAI, `grok -p`, plan mode) and **Kimi K3** (`kimi -p -m kimi-code/k3`). Ollama and OpenCode were not used (weekly limit). The review prompt (a copy of the diff plus six questions) is not carried over; answers unchanged in `.pa/review_w1-05b-api_grok.md` and `.pa/review_w1-05b-api_kimi.md`. Ported from the internal predecessor repo; the reviewed diff of `src-tauri/src/api.rs` is identical to the ported one.

Verdicts: both "mergebar: ja".

| ID | Reviewer | Severity | Finding | Disposition |
|---|---|---|---|---|
| G-0 | Grok | - | No findings. One remark: the assert text "must stay queued" names the wrong status (the row must stay `dispatched`). | **Accepted (wording).** Message now reads "must stay dispatched after a refusal". |
| K-X1 | Kimi | low | Over HTTP only four of the rule's branches are exercised; `worker is still running` (running, no binding, no session), the one branch that rests on the status column alone, is missing. | **Accepted.** Fifth task `tq-running` (worker row still `running`, no session, no binding) expects 409 `worker wk-running is still running`. `Unnamed`/`Missing` stay out: they need raw SQL and the store tests already cover them; the route maps by opening only. The dispatch limit in the setup went from 4 to 8, because the fifth `mark_queue_dispatched` would otherwise fail the capacity check. |
| K-X2 | Kimi | low | After the 200 only `tq-live` is re-read, yet the comment says "the refused ones are untouched". | **Accepted.** All four refused rows are re-read after the success. |

Red evidence for the accepted change (mutation, not committed): `store/queue_cancel.rs` with the `STATUS_RUNNING` arm switched off (`else if false && ...`), then `cargo test --bin projecta a_dispatched_task_is_cancelled_over_http` -> **Exit 101**, `tq-running: ... worker wk-running has no recorded session`. Mutation reverted; same command and `cargo test --bin projecta api::tests::` on the fix -> **Exit 0** (102 passed).

Verified by both reviewers and confirmed by me: the fake delegates exactly like `main.rs` (`block_on(store.cancel_queue_entry(id))`), the four original states are what they claim, drop order and ports are deterministic, the doc sentences match `proven_process_end`.
