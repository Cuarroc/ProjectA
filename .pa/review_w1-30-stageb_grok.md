I'll review the test-only diff against the actual `omniroute` fixtures and the timeout path, and check whether any assertion or the 20 ms case got weaker.No findings.

Checked `src-tauri/src/omniroute.rs` at `c871af0` (diff matches the prompt; production code is untouched — `mod tests` starts at line 1003 and the diff starts at line 1115).

- The four status assertions are still exact `assert_eq!` to `Unauthorized` or `BusyRateLimited`. The 20 ms `Timeout` assertion and the 20 ms `Offline` assertion are unchanged. Nothing was removed, branched, or widened to more than one error variant. `STATUS_BUDGET` (5 s) is only the wait for a server that does answer; `classify_usage_response` still maps 401/403 and 429/503 by status alone.
- `a_slow_answer_keeps_its_http_class` sleeps 300 ms after the request is read, inside the client’s separate 5 s read timeout. A late answer stays in its HTTP class.
- `serve_stalled` no longer closes after 200 ms. It reads until the client drops the socket, with a 10 s read timeout so the fixture thread cannot outlive a connected client. Both callers connect and drop the socket (`fetch_usage_from` on return, the new test when `stream` goes out of scope), so the thread and the listening port end with the test.
- `a_stalled_server_stays_silent_until_the_client_hangs_up` is deterministic: the server sends nothing, the 600 ms pause plus the 50 ms read sit well inside the 10 s server read, and `is_timeout` accepts `TimedOut` and `WouldBlock` (the same predicate the client uses). Load cannot invent response bytes or a FIN inside that window.
- The 20 ms case still includes `connect_timeout`. The listener is already bound, so the handshake completes without waiting for `accept`. A silent peer with a 20 ms read timeout is `UsageError::Timeout`. `dead_addr()` (port 0) still fails in the connect call as `Offline`.
- New comments are English. The added `.pa` files contain no secrets.

VERDICT: approve
