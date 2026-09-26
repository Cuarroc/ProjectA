# Review: w1-30 — kimi-k3

- Autor des Artefakts: Claude Sonnet 5
- Reviewer: kimi-k3 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `kimi-k3:cloud`, bedient `kimi-k3`
- Datum: 2026-09-25 09:37 UTC, Dauer 150 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_w1-30.md` (9994 Zeichen)

## Roh-Urteil des Reviewers

## Review: W1-30 — W1-30 test-only change

### Answers to the explicit checks

**Original assertions weakened?** No. All four `assert_eq!(fetch_usage_from(addr, _), Err(...))` expectations are byte-identical (same statuses, same `UsageError` classes). Only the *budget argument* changed (100 ms → `STATUS_BUDGET`), which is test environment, not assertion content: classification of an answered request is status-based and budget-independent once the answer arrives. The unchanged region between the two hunks retains the `Timeout` (20 ms, silent server) and `Offline` (port 0) cases with their tight budgets — the network-class coverage the test name promises is intact. The client's per-read timeout semantics mean the wider budget only ever converts false `Timeout` failures into the real status class; it cannot mask a misclassification regression.

**Fixture hygiene (Windows + Linux).** The reworked `serve_stalled` is strictly better than the old fixed-sleep version: it terminates on client hang-up (both clients drop their socket deterministically) and has a 10 s read-timeout backstop, so no unbounded reads after accept. `set_read_timeout` uses a non-zero duration, which is the Windows-safe form. `sleep(Duration::ZERO)` in `serve_status_after` is a harmless no-op/yield. Residual items are listed as findings below.

**Is `a_stalled_server_stays_silent_until_the_client_hangs_up` deterministic?** Yes. The asserted outcome (read timeout) can only be altered by the server writing (it never does) or the server socket closing (requires server-thread exit, which requires client EOF/hang-up or a 10 s server-side timeout). Neither occurs within the test in any scheduling interleaving short of >10 s starvation of the *test* thread itself (finding L3). The 600 ms sleep + 50 ms read timeout are load-immune because "silence" is the server's steady state.

**Is the 20 ms Timeout case deterministic under load?** Yes, and more so than before. `connect_timeout` to a bound loopback listener completes in-kernel via the backlog regardless of server-thread scheduling, so a starved fixture can't turn connect into an error. The client's 20 ms read necessarily times out because the fixture is now genuinely silent until hang-up — the old flake mode (EOF/`Unreadable` from the 200 ms server-side close) is eliminated by construction. The ~300-byte request always fits the loopback send buffer, so the 20 ms write timeout can't fire either.

**Rules.** Diff is confined to `mod tests`; `get_authorized_classified`/`classify_io_error` untouched → no production behavior change. Comments are English and accurately describe the mechanism and the measured evidence. No secrets introduced (fixtures are pre-existing).

### Findings

- **L1 — low — src-tauri/src/omniroute.rs:~1145-1149 (serve_stalled), also ~1126 (serve_status_after).** Fixture threads still block in `listener.accept()` with no timeout: a test whose client never connected would leak the thread (and the listener) for the process lifetime. Pre-existing pattern shared by all fixtures in this module, not introduced here; every current caller connects, and the new 10 s read timeout correctly bounds the post-accept phase. Optional follow-up: an accept deadline would make the hygiene claim complete.

- **L2 — low — src-tauri/src/omniroute.rs:~1162 (STATUS_BUDGET), used at ~1657, ~1664, ~1694.** The 5 s budget is finite: a fixture thread starved >5 s would still surface `Timeout` instead of the status class. This is an irreducible property of any finite budget, not a defect — the margin is 50× the budget that failed at 24 burners, and the evidence (0/450 across levels; 12/12 all-pass of the 44-test module at 48 burners) shows ample headroom. Noting it so the choice is consciously accepted rather than read as "provably immune."

- **L3 — low — src-tauri/src/omniroute.rs:~1709-1727 (a_stalled_server_stays_silent_until_the_client_hangs_up).** One theoretical interleaving flips this test: if the *test thread* itself is descheduled >10 s between its `write_all` and its read, the server's read-timeout backstop fires, the fixture drops the socket, and the client sees EOF (`Ok(0)`) instead of timeout. That requires starving a runnable thread for 10 s — far beyond any load in the measured matrix — and is the same accepted finite-budget tradeoff as L2. No change requested; if ever desired, looping on timeout errors in the fixture would eliminate it at the cost of unbounded thread lifetime.

- **L4 — low — src-tauri/src/omniroute.rs:~1687-1693 (a_slow_answer_keeps_its_http_class).** The new test sends body `"{}"` for the 401/403 cases, whereas the original test uses `ERROR_401_FIXTURE`. Classification of non-2xx statuses is status-based (body parsing is only reached for success), and the original 401/403-with-fixture assertions are untouched in the sibling test, so no coverage is lost. Mentioning only for fidelity-of-reproduction completeness.

### Summary

The fix targets the measured root cause on both sides: status cases can no longer be starved into `Timeout` (budget ≫ observed starvation; client-side starvation is absorbed by the kernel receive buffer), and the stalled fixture can no longer silently convert silence into EOF. The two added tests encode both failure mechanisms deterministically and are red on the base for exactly the right reasons. Nothing is removed, loosened, or made load-conditional.

VERDICT: approve
