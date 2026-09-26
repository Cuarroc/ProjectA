## Review: PR #32 (W1-30) deterministic omniroute test fixtures

### High

1. **`serve_stalled` and `serve_status_after` fixture threads leak if test never connects**  
   Both functions spawn a thread that blocks on `listener.accept()` before the test connects. If a test using these fixtures fails to connect (e.g., early assertion failure, panic before connect), the spawned thread blocks forever on `accept()`, leaking a thread and holding the port.  
   **File:** `src-tauri/src/omniroute.rs:63, 84` (in `mod tests`)

2. **`a_stalled_server_stays_silent_until_the_client_hangs_up` leaves server thread alive for ~10s after test passes**  
   The server thread has a 10s read timeout set at line 89. The test sleeps 600ms, then reads with 50ms timeout. When the test's read times out (expected), the test passes and ends, but the server thread remains blocked in its `read()` for ~9.4s more before its 10s timeout expires. Accumulated across test runs, this wastes resources.  
   **File:** `src-tauri/src/omniroute.rs:154-171`

### Medium

3. **`is_timeout` cross-platform behavior unverified**  
   The new test at line 168 uses `is_timeout(error)` to assert a read timeout. This helper must correctly identify timeout errors on both Unix (`WouldBlock`/`TimedOut`) and Windows (`ERROR_SEM_TIMEOUT`/`WSAETIMEDOUT`). The diff doesn't show its definition; if it's Unix-only, the test will fail or misbehave on Windows.  
   **File:** `src-tauri/src/omniroute.rs:168`

4. **600ms descheduling window may be insufficient under extreme load**  
   The test simulates client descheduling with `std::thread::sleep(600ms)`. On a heavily oversubscribed CI runner, the test thread itself could be descheduled *before* reaching that sleep, making the effective delay longer. While unlikely, this reintroduces a timing dependency the fix aims to eliminate. Consider a longer margin (e.g., 2s) or a deterministic synchronization primitive.  
   **File:** `src-tauri/src/omniroute.rs:161`

### Low

5. **`serve_status_after` ignores read result**  
   Line 66: `let _ = stream.read(&mut request);` discards errors/EOF. If the client disconnects before sending, the fixture still sleeps and writes a response to a closed socket. Harmless for current tests but fragile.  
   **File:** `src-tauri/src/omniroute.rs:66`

6. **`serve_stalled` reads request in a loop but doesn't handle partial reads explicitly**  
   Line 91 loops on `read()` until EOF. With a 2048-byte buffer and tiny test requests this works, but it's not robust to fragmented packets. Acceptable for a test fixture.

### Clean (no findings)

- **No production code touched** — all changes are inside `mod tests {}`.
- **Assertions not weakened** — existing tests still assert exact `UsageError` variants; only the timeout budget increased from 100ms to 5s.
- **Red-first validity holds** — both new tests fail with the old fixtures:
  - `a_slow_answer_keeps_its_http_class`: 300ms delay > old 100ms budget → `Timeout` instead of status class.
  - `a_stalled_server_stays_silent_until_the_client_hangs_up`: old fixture closed after 200ms → client sees EOF (`Unreadable`), not silence (`Timeout`).
- **5s STATUS_BUDGET is safe** — local loopback HTTP status classification takes microseconds; 5s only masks a regression if the classification path itself hangs for >5s, which would be a separate bug.

### Summary

| Rating | Count |
|--------|-------|
| High   | 2     |
| Medium | 2     |
| Low    | 2     |

**Recommendation:** Fix the two high-severity leaks (add a connection timeout to `accept()` or join the fixture threads) and verify `is_timeout` on Windows before merge. The medium items are defensive improvements.
