# Review request PR #32 (W1-30): deterministic omniroute test fixtures

You are an independent reviewer (not the author; the author is a Claude model).
Review the COMPLETE candidate below for correctness bugs, weakened assertions,
tests that pass for the wrong reason, and remaining flakiness. Be concrete: cite
file and line, say what breaks and when. Rate each finding high/medium/low. Do
not restate the diff. If something is fine, say nothing about it. If there are no
findings, say "No findings." Answer in English or German. This is a READ-ONLY
review: do not modify any files.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal" (Rust backend in src-tauri/). The
module `src-tauri/src/omniroute.rs` has an HTTP client for a local management
API and inline tests with tiny TCP fixture servers. The test
`management_failures_keep_their_http_and_network_classes` was flaky under CPU
oversubscription: its status cases (401/403/429/503) gave the fixture thread
100 ms to connect, wake up and answer; a late answer was reported as
`Err(Timeout)` instead of `Unauthorized` / `BusyRateLimited`. `serve_stalled`
also closed the socket after a fixed 200 ms sleep, so a descheduled client could
read EOF (`Unreadable`) instead of silence (`Timeout`). Measured: 0/150 failures
at 12 burner threads, 149/150 at 24, 150/150 at 32 and 48.

## Package requirement

W1-30: make the flake deterministic by changing test fixtures only.
1. Status cases use a 5 s budget (only spent when the answer is late); the
   `Timeout` (20 ms, silent server) and `Offline` cases keep their tight budgets.
2. `serve_stalled` stays silent until the client hangs up (10 s safety bound)
   instead of a fixed sleep.
3. Two red-first tests: `a_slow_answer_keeps_its_http_class` and
   `a_stalled_server_stays_silent_until_the_client_hangs_up`.
4. No production code change; no assertion weakened or removed.

Hunt for: production code touched by accident; assertions that got weaker or
broader; a fixture thread that can outlive/hang a test or leak; a test that
would not fail without the fix (red-first validity); remaining timing
dependence (e.g. the 600 ms / 50 ms values in the stalled test, `is_timeout`
handling on Windows vs Unix); the 5 s budget being large enough to hide a real
regression in the classification path.

## Diff (git diff origin/main...HEAD, src-tauri/src/omniroute.rs; the other
changed files are only .pa/review records)

```diff
diff --git a/src-tauri/src/omniroute.rs b/src-tauri/src/omniroute.rs
index bd92fb5..74cc786 100644
--- a/src-tauri/src/omniroute.rs
+++ b/src-tauri/src/omniroute.rs
@@ -1113,12 +1113,20 @@ mod tests {
     }
 
     fn serve_status(status: u16, body: &'static str) -> SocketAddr {
+        serve_status_after(Duration::ZERO, status, body)
+    }
+
+    /// [`serve_status`], but the answer comes `delay` after the request. That
+    /// is what a starved test thread looks like from the client's side, made
+    /// deterministic instead of depending on how busy the machine is.
+    fn serve_status_after(delay: Duration, status: u16, body: &'static str) -> SocketAddr {
         let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind");
         let addr = listener.local_addr().expect("addr");
         std::thread::spawn(move || {
             let (mut stream, _) = listener.accept().expect("accept");
             let mut request = [0u8; 2048];
             let _ = stream.read(&mut request);
+            std::thread::sleep(delay);
             let response = format!(
                 "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\n\
                  Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
@@ -1129,18 +1137,32 @@ mod tests {
         addr
     }
 
+    /// Reads the request and then says nothing until the client hangs up.
+    ///
+    /// Not a fixed sleep: a client that is descheduled past the sleep would
+    /// find a closed socket (EOF, `Unreadable`) instead of silence. The read
+    /// timeout only keeps the thread from outliving a test that never
+    /// connects or never hangs up.
     fn serve_stalled() -> SocketAddr {
         let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind");
         let addr = listener.local_addr().expect("addr");
         std::thread::spawn(move || {
             let (mut stream, _) = listener.accept().expect("accept");
-            let mut request = [0u8; 2048];
-            let _ = stream.read(&mut request);
-            std::thread::sleep(Duration::from_millis(200));
+            let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
+            let mut buffer = [0u8; 2048];
+            while matches!(stream.read(&mut buffer), Ok(n) if n > 0) {}
         });
         addr
     }
 
+    /// The budget for cases where the server DOES answer and the test is about
+    /// the status class of that answer. The answer normally takes well under a
+    /// millisecond; the budget only has to outlast a starved fixture thread
+    /// (W1-30: 24+ busy threads on 12 cores exhausted 100 ms on every run).
+    /// It costs nothing when the answer comes, and the `Timeout` and `Offline`
+    /// cases keep their own tight budgets because silence is what they test.
+    const STATUS_BUDGET: Duration = Duration::from_secs(5);
+
     fn fetch_usage_from(addr: SocketAddr, budget: Duration) -> Result<Vec<UsageRow>, UsageError> {
         let response = get_authorized_classified(
             addr,
@@ -1632,14 +1654,14 @@ mod tests {
         for status in [401, 403] {
             let addr = serve_status(status, ERROR_401_FIXTURE);
             assert_eq!(
-                fetch_usage_from(addr, Duration::from_millis(100)),
+                fetch_usage_from(addr, STATUS_BUDGET),
                 Err(UsageError::Unauthorized)
             );
         }
         for status in [429, 503] {
             let addr = serve_status(status, "{}");
             assert_eq!(
-                fetch_usage_from(addr, Duration::from_millis(100)),
+                fetch_usage_from(addr, STATUS_BUDGET),
                 Err(UsageError::BusyRateLimited)
             );
         }
@@ -1655,6 +1677,51 @@ mod tests {
         );
     }
 
+    /// W1-30. On a machine with more runnable threads than cores the server
+    /// thread of a fixture can need well over 100 ms to answer. The class of an
+    /// answer that DID arrive must not depend on how long it took, so the
+    /// status cases get a budget that a loaded machine cannot exhaust. The
+    /// 300 ms delay stands in for that load.
+    #[test]
+    fn a_slow_answer_keeps_its_http_class() {
+        for (status, expected) in [
+            (401, UsageError::Unauthorized),
+            (403, UsageError::Unauthorized),
+            (429, UsageError::BusyRateLimited),
+            (503, UsageError::BusyRateLimited),
+        ] {
+            let addr = serve_status_after(Duration::from_millis(300), status, "{}");
+            assert_eq!(
+                fetch_usage_from(addr, STATUS_BUDGET),
+                Err(expected),
+                "status {status}"
+            );
+        }
+    }
+
+    /// W1-30. `Timeout` needs a server that says nothing for as long as the
+    /// client listens. A fixture that closes after a fixed sleep turns a
+    /// client that was descheduled past that sleep into an EOF (`Unreadable`).
+    #[test]
+    fn a_stalled_server_stays_silent_until_the_client_hangs_up() {
+        let addr = serve_stalled();
+        let mut stream = TcpStream::connect(addr).expect("connect");
+        stream
+            .write_all(b"GET / HTTP/1.1\r\n\r\n")
+            .expect("request");
+        // The client is "descheduled" for longer than any fixed hold-open.
+        std::thread::sleep(Duration::from_millis(600));
+        stream
+            .set_read_timeout(Some(Duration::from_millis(50)))
+            .expect("timeout");
+        let mut byte = [0u8; 1];
+        let outcome = stream.read(&mut byte);
+        assert!(
+            matches!(&outcome, Err(error) if is_timeout(error)),
+            "expected silence, got {outcome:?}"
+        );
+    }
+
     #[test]
     fn a_route_that_answers_something_else_is_unreadable() {
         let addr = serve_management("oma_live_good", vec![(USAGE_PATH, "<!doctype html>")]);
```
