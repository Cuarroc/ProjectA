# Review-Auftrag — W1-03c, Endstand nach Codex-Nacharbeit (PR #81)

Du bist unabhängiger Code-Reviewer (Autor: Claude Code). Die ersten zwei Reviews (DeepSeek V4 Pro, GLM 5.3) haben
den Stand `cd6e34f` gesehen. Danach kamen funktionale Änderungen; dieser Review gilt dem ENDSTAND. Der Diff unten
ist `cd6e34f..HEAD` (nur Produkt- und Testcode), also genau das, was noch niemand anbieterfremd geprüft hat.

## Kontext
Submit-Guards (ein Thread je Zustellung) tippen Aufträge in die TUI eines CLI-Agenten in einer PTY. Eine FIFO je
Sitzung (`DeliveryTurns`) serialisiert sie. Bleibt Text eines eskalierten Guards in der Eingabezeile stehen
(`input_pending`), markiert der Drop seines `DeliveryTurn` die Sitzung als `input_dirty`; jede spätere Zustellung
eskaliert dann ohne zu schreiben, bis eine Nutzereingabe die Zeile leert (`write_user_input`; die Verdrahtung des
Tauri-Commands `write_pty` folgt im nächsten PR).

Änderungen seit `cd6e34f`:
- nur zeilenleerende Nutzereingaben räumen (`leaves_line_empty`: ganzer Chunk; letztes Enter/Ctrl-U/Ctrl-C nach
  dem letzten Text; Bracketed-Paste-Inhalt ist Text; CSI/SS3/Backspace kein Text);
- `input_pending` fällt nur bei `Delivered` (ohne Answer-Marker: Output nach dem Enter; mit Marker: erst der Marker);
- `TurnState::clear_epoch` zählt die Leerungen durch den Nutzer; ein Turn markiert beim Drop nur, wenn sein Task nach der
  letzten Leerung in die Zeile kam;
- `DeliveryTurn::type_task` (Task-Write + Epoche) und `DeliveryTurns::user_write` (Nutzer-Write + Leerung) laufen
  beide unter dem TurnState-Lock, Lock-Reihenfolge turns → PTY-Writer.

## Worauf achten
1. Nebenläufigkeit: Deadlock (turns-Lock während des PTY-Writes; Condvar-Wartende; Drop), verlorene oder falsche
   Markierung zwischen Guard, Nutzer und Drop, Poisoning.
2. `leaves_line_empty`: Fehlklassifikationen (UTF-8, unvollständige Escape-Sequenzen am Chunk-Ende, ESC ohne Folge,
   Paste ohne Ende-Markierung, OSC).
3. Semantik `input_pending` mit/ohne Marker; bleibt der Produktivpfad (ohne Marker) unverändert?
4. Tests: belegen sie ihre Behauptung, sind sie deterministisch?

## Antwortformat
Befunde: ID (X1…), Schwere (hoch/mittel/niedrig), Stelle, konkretes Fehlerszenario, Fix-Vorschlag. Dann geprüfte
und verworfene Punkte je eine Zeile. Urteil: mergebereit / nach Überarbeitung / ablehnen. Deutsch, knapp, keine
erfundenen Befunde.

## Diff `cd6e34f..841e259` (src-tauri)
```diff
diff --git a/src-tauri/src/bin/pa.rs b/src-tauri/src/bin/pa.rs
index 7a09809..7ee0c1c 100644
--- a/src-tauri/src/bin/pa.rs
+++ b/src-tauri/src/bin/pa.rs
@@ -1369,17 +1369,18 @@ fn read_verdict_token(
                 "the verdict token was to come from standard input, which was empty".to_string(),
             );
         }
         return Ok(line);
     }
     if let Some(path) = spec.strip_prefix('@') {
         // A token mistyped with the `@` in front of it must not come back in an
         // error message: 32 hex characters is what this project mints
-        // (`api::new_token`), and `redact` does not mask that shape.
+        // (`api::new_token`), and the CLI's error text does not pass through
+        // `redact` here, so the check below has to catch it itself.
         if path.len() == 32 && path.chars().all(|c| c.is_ascii_hexdigit()) {
             return Err(
                 "--verdict-token @<path> wants a file; that looks like the token itself - \
                  write it without the @"
                     .to_string(),
             );
         }
         let token = read_token_file(path)?;
@@ -4485,17 +4486,18 @@ mod tests {
         // A file that exists but holds nothing is the same kind of error.
         let empty_file = dir.join("empty");
         write_private(&empty_file, "   \n");
         let err =
             verdict_token(Some(format!("@{}", empty_file.display()))).expect_err("empty file");
         assert!(err.contains("empty"), "{err}");
 
         // A token mistyped with an `@` in front does not come back in the
-        // error text: `redact` does not mask this shape.
+        // error text: the CLI's error text does not pass through `redact`
+        // here, so this is verified directly against the raw error string.
         let looks_like_a_token = "0123456789abcdef0123456789abcdef";
         let err = verdict_token(Some(format!("@{looks_like_a_token}"))).expect_err("token as path");
         assert!(!err.contains(looks_like_a_token), "{err}");
         assert!(err.contains("without the @"), "{err}");
 
         // An ordinary value is still itself.
         assert_eq!(
             verdict_token(Some("vt-1".to_string())).expect("literal"),
diff --git a/src-tauri/src/hooks.rs b/src-tauri/src/hooks.rs
index 021b058..da10511 100644
--- a/src-tauri/src/hooks.rs
+++ b/src-tauri/src/hooks.rs
@@ -109,33 +109,47 @@ fn secrets() -> &'static Mutex<HashMap<String, String>> {
 
 /// Mint a fresh secret for `worker_id`, replacing any earlier one.
 ///
 /// Called once per settings file, which means once per spawn and once per
 /// respawn: a new generation of a worker invalidates the previous one's, so a
 /// late hook from a killed session cannot write into its successor's log.
 fn issue_secret(worker_id: &str) -> String {
     let secret = crate::oneshot::random_hex();
-    if let Ok(mut secrets) = secrets().lock() {
-        secrets.insert(worker_id.to_string(), secret.clone());
-    }
+    // A poisoned secrets map used to drop the new secret silently - the
+    // settings file would then hold a token `secret_for` can never see, so
+    // every hook from that worker looks unauthorized (W1-15). Inserting one
+    // key can never leave the map itself inconsistent, so the lock is taken
+    // over and logged instead.
+    secrets()
+        .lock()
+        .unwrap_or_else(|poison| {
+            eprintln!("projecta: worker secret map was poisoned while issuing a secret for {worker_id}; recovering");
+            poison.into_inner()
+        })
+        .insert(worker_id.to_string(), secret.clone());
     secret
 }
 
 /// This worker's current secret, if it has one.
 fn secret_for(worker_id: &str) -> Option<String> {
-    secrets().lock().ok()?.get(worker_id).cloned()
+    secrets()
+        .lock()
+        .unwrap_or_else(|poison| poison.into_inner())
+        .get(worker_id)
+        .cloned()
 }
 
 /// Drop a worker's secret. Runs with the files it belongs to, so an archived
 /// worker's id stops being a valid target the moment its settings are gone.
 fn forget_secret(worker_id: &str) {
-    if let Ok(mut secrets) = secrets().lock() {
-        secrets.remove(worker_id);
-    }
+    secrets()
+        .lock()
+        .unwrap_or_else(|poison| poison.into_inner())
+        .remove(worker_id);
 }
 
 /// Whether this request may act on `worker_id`.
 ///
 /// A worker with no secret on file is refused rather than trusted. The two
 /// ways to get here are a request for a worker this app never started, and a
 /// hook from a generation whose secret has since been replaced - and in both
 /// cases the honest answer is no. Rejecting also costs nothing across an
diff --git a/src-tauri/src/main.rs b/src-tauri/src/main.rs
index acb645a..628c503 100644
--- a/src-tauri/src/main.rs
+++ b/src-tauri/src/main.rs
@@ -874,17 +874,25 @@ fn stop_web_interface(web: State<'_, Mutex<WebInterfaceState>>) -> Result<(), St
         .lock()
         .map_err(|_| "the web interface state was poisoned".to_string())?;
     web_interface::stop_web_interface(&mut running)
 }
 
 /// The port the web interface currently answers on, if any.
 #[tauri::command]
 fn web_interface_status(web: State<'_, Mutex<WebInterfaceState>>) -> Option<u16> {
-    let running = web.lock().ok()?;
+    // A poisoned lock here used to read as "no web interface running", which
+    // is indistinguishable from the ordinary off state (W1-15). Reading the
+    // state is not itself a mutation, so the recovered value is exactly what
+    // the panicked start/stop call left behind - take it over instead of
+    // hiding a running (or crashed-while-stopping) interface as absent.
+    let running = web.lock().unwrap_or_else(|poison| {
+        eprintln!("projecta: web interface state was poisoned; reporting its recovered status");
+        poison.into_inner()
+    });
     web_interface::web_interface_status(&running)
 }
 
 /// Forget a project: its workers are archived and their agents stopped, but
 /// nothing is deleted from disk - the worktrees are still there afterwards.
 #[tauri::command]
 async fn remove_project(
     app: AppHandle,
diff --git a/src-tauri/src/omniroute.rs b/src-tauri/src/omniroute.rs
index 1ad4d65..fc162ce 100644
--- a/src-tauri/src/omniroute.rs
+++ b/src-tauri/src/omniroute.rs
@@ -144,49 +144,57 @@ impl OmniRoute {
     /// The last quota document, if any endpoint ever returned one.
     ///
     /// Nothing in Phase 3.6 renders it: the board only needs to know whether
     /// the router is up. It is collected now so that Phase 4's `GET /api/quota`
     /// has something to serve without a second probe, and so that whatever
     /// shape the local build answers with is visible in the tests today.
     #[allow(dead_code)]
     pub fn quota_json(&self) -> Option<Value> {
-        self.quota.lock().ok().and_then(|slot| slot.clone())
+        self.quota
+            .lock()
+            .unwrap_or_else(|poison| poison.into_inner())
+            .clone()
     }
 
     /// Version reported by the last successful optional version probe.
     #[allow(dead_code)]
     pub fn omniroute_version(&self) -> Option<String> {
         self.omniroute_version
             .lock()
-            .ok()
-            .and_then(|slot| slot.clone())
+            .unwrap_or_else(|poison| poison.into_inner())
+            .clone()
     }
 
     /// Run one probe and record what it found. Returns the new online state.
     ///
     /// A probe that cannot connect clears `online` but *keeps* the last quota
     /// document: it is stale, not wrong, and a restarting router should not
     /// blank the panel.
     pub fn probe_once(&self) -> bool {
         let online = HEALTH_PATHS
             .iter()
             .any(|path| matches!(get(self.addr, path), Some((status, _)) if is_ok(status)));
         self.online.store(online, Ordering::Relaxed);
 
         if online {
+            // Both slots are plain replaces, so a poisoned lock is taken
+            // over rather than dropping a probe result the router just spent
+            // a request producing (W1-15).
             if let Some(version) = self.probe_version() {
-                if let Ok(mut slot) = self.omniroute_version.lock() {
-                    *slot = Some(version);
-                }
+                *self
+                    .omniroute_version
+                    .lock()
+                    .unwrap_or_else(|poison| poison.into_inner()) = Some(version);
             }
             if let Some(value) = self.probe_quota() {
-                if let Ok(mut slot) = self.quota.lock() {
-                    *slot = Some(value);
-                }
+                *self
+                    .quota
+                    .lock()
+                    .unwrap_or_else(|poison| poison.into_inner()) = Some(value);
             }
         }
         online
     }
 
     fn probe_version(&self) -> Option<String> {
         let (status, body) = get(self.addr, VERSION_PATH)?;
         if !is_ok(status) {
@@ -288,38 +296,45 @@ impl OmniRoute {
     ///
     /// Always clears the authorization verdict: a token that just changed has
     /// not been checked, whatever the last one did.
     pub fn set_token(&self, token: Option<&str>) {
         let token = token
             .map(str::trim)
             .filter(|token| !token.is_empty())
             .map(str::to_string);
-        if let Ok(mut slot) = self.token.lock() {
-            *slot = token;
-        }
+        *self
+            .token
+            .lock()
+            .unwrap_or_else(|poison| poison.into_inner()) = token;
         self.authorized.store(false, Ordering::Relaxed);
     }
 
     fn token(&self) -> Option<String> {
-        self.token.lock().ok().and_then(|slot| slot.clone())
+        self.token
+            .lock()
+            .unwrap_or_else(|poison| poison.into_inner())
+            .clone()
     }
 
     /// Did the last management call get through? `false` until one has.
     pub fn is_authorized(&self) -> bool {
         self.authorized.load(Ordering::Relaxed)
     }
 
     /// The last `/api/usage/history` document, if one was ever fetched.
     ///
     /// Kept verbatim and served as-is. This is the only source of real dollars
     /// ProjectA has: the per-request log carries tokens but no price, so the
     /// ledger's own `cost_usd` stays empty and the totals come from here.
     pub fn usage_history(&self) -> Option<Value> {
-        self.history.lock().ok().and_then(|slot| slot.clone())
+        self.history
+            .lock()
+            .unwrap_or_else(|poison| poison.into_inner())
+            .clone()
     }
 
     /// Establish that the held token opens the management API, and cache it.
     ///
     /// There is no JWT to fetch. `POST /api/auth/login` exists, but it is the
     /// dashboard's password form - it wants the human's password and hands
     /// back a browser session. What the management API actually accepts, and
     /// what the plan's env file holds, is a personal `oma_live_…` token
@@ -347,19 +362,20 @@ impl OmniRoute {
             return false;
         };
         if status == 401 || status == 403 {
             self.authorized.store(false, Ordering::Relaxed);
             return false;
         }
         if is_ok(status) {
             if let Ok(value) = serde_json::from_str::<Value>(body.trim()) {
-                if let Ok(mut slot) = self.history.lock() {
-                    *slot = Some(value);
-                }
+                *self
+                    .history
+                    .lock()
+                    .unwrap_or_else(|poison| poison.into_inner()) = Some(value);
             }
         }
         self.authorized.store(true, Ordering::Relaxed);
         true
     }
 
     /// One read of the request log.
     pub fn fetch_usage(&self) -> Result<Vec<UsageRow>, UsageError> {
diff --git a/src-tauri/src/providers.rs b/src-tauri/src/providers.rs
index dac6634..c21e986 100644
--- a/src-tauri/src/providers.rs
+++ b/src-tauri/src/providers.rs
@@ -1130,32 +1130,34 @@ fn local_usage() -> ProviderUsage {
         observed_at: now_unix_secs(),
     }
 }
 
 fn openrouter_usage(vault: &KeyVault) -> Option<ProviderUsage> {
     let key = vault.get("openrouter")?;
     let cache = OPENROUTER_CACHE.get_or_init(|| Mutex::new(None));
     let now = Instant::now();
+    // A stale-but-present cache entry is still a better answer than treating
+    // a poisoned lock as "never fetched" (W1-15): the slot is a plain
+    // replace, never a partial write, so it is taken over rather than
+    // skipped on both the read and the write below.
     {
-        let slot = cache.lock().ok()?;
+        let slot = cache.lock().unwrap_or_else(|poison| poison.into_inner());
         if let Some((cached_key, fetched_at, usage)) = slot.as_ref() {
             if cached_key == &key
                 && now.saturating_duration_since(*fetched_at) < OPENROUTER_CACHE_TTL
             {
                 return Some(usage.clone());
             }
         }
     }
 
     let body = fetch_openrouter(&key)?;
     let usage = parse_openrouter_body(&body)?;
-    if let Ok(mut slot) = cache.lock() {
-        *slot = Some((key, now, usage.clone()));
-    }
+    *cache.lock().unwrap_or_else(|poison| poison.into_inner()) = Some((key, now, usage.clone()));
     Some(usage)
 }
 
 fn fetch_openrouter(key: &str) -> Option<String> {
     let program = if cfg!(windows) { "curl.exe" } else { "curl" };
     // The key goes as a config line on stdin, never as an argv element: a
     // billing key in `/proc/<pid>/cmdline` is readable by every local process
     // for the lifetime of the call. `--config -` is curl's own way to take a
diff --git a/src-tauri/src/pty.rs b/src-tauri/src/pty.rs
index 3d75d9b..a7f2a02 100644
--- a/src-tauri/src/pty.rs
+++ b/src-tauri/src/pty.rs
@@ -230,32 +230,36 @@ struct Session {
 /// No wait here is unbounded: every phase of the guard ahead is capped
 /// (`MARKER_BUSY_CAP`/`READY_MAX_WAIT`, `MAX_WRITES` x `ECHO_BUSY_CAP`,
 /// `ENTER_SETTLE_CAP`, `RETRY_BACKOFF` - about eleven minutes in all), and a
 /// waiting guard re-checks cancellation and the session on every wake-up.
 ///
 /// A delivery that escalates *after* typing its task may leave that text
 /// unsent in the input line. The session keeps an `input_dirty` flag for
 /// this: it is set when a turn leaves the queue while its guard still had
-/// input pending, and stays set until user input into this session clears it
-/// via [`PtyManager::write_user_input`]. Every later delivery escalates
-/// without writing until the user has looked at the session.
+/// input pending, and stays set until the user sends or empties the line
+/// ([`PtyManager::write_user_input`]). Every later delivery escalates
+/// without writing until then.
 #[derive(Default)]
 struct DeliveryTurns {
     state: Mutex<TurnState>,
     changed: Condvar,
 }
 
 #[derive(Default)]
 struct TurnState {
     queue: VecDeque<u64>,
     next_id: u64,
     /// Set when a turn leaves the queue while its task may still sit in the
     /// input line; cleared by user input into this session.
     input_dirty: bool,
+    /// Counts the user's clears of the line. A turn marks the line dirty on
+    /// drop only if its task went in after the latest clear (Codex review,
+    /// PR #81): a line the user emptied mid-delivery stays clean.
+    clear_epoch: u64,
 }
 
 impl DeliveryTurns {
     /// A plain queue of ids stays consistent even if a holder panicked, so a
     /// poisoned lock is taken over instead of wedging every later delivery.
     fn lock(&self) -> MutexGuard<'_, TurnState> {
         self.state
             .lock()
@@ -265,23 +269,46 @@ impl DeliveryTurns {
     fn join(self: &Arc<Self>) -> DeliveryTurn {
         let mut state = self.lock();
         let id = state.next_id;
         state.next_id += 1;
         state.queue.push_back(id);
         DeliveryTurn {
             turns: Arc::clone(self),
             id,
-            input_pending: AtomicBool::new(false),
+            pending_epoch: AtomicU64::new(NOT_PENDING),
         }
     }
 
-    /// Clear the dirty-input flag: the user has typed into this session.
+    /// The user emptied or sent the line: clear the dirty flag, and void the
+    /// pending text of the delivery still running.
+    #[cfg(test)]
     fn clear_input_dirty(&self) {
-        self.lock().input_dirty = false;
+        Self::clear(&mut self.lock());
+    }
+
+    fn clear(state: &mut TurnState) {
+        state.input_dirty = false;
+        state.clear_epoch += 1;
+    }
+
+    /// The user's input: written (`write`) and, if it leaves the line
+    /// empty, recorded as a clear - one step under the turn lock, ordered
+    /// against a guard's task write ([`DeliveryTurn::type_task`]).
+    fn user_write(
+        &self,
+        clears: bool,
+        write: impl FnOnce() -> Result<(), String>,
+    ) -> Result<(), String> {
+        let mut state = self.lock();
+        write()?;
+        if clears {
+            Self::clear(&mut state);
+        }
+        Ok(())
     }
 
     #[cfg(test)]
     fn is_empty(&self) -> bool {
         self.lock().queue.is_empty()
     }
 
     #[cfg(test)]
@@ -289,19 +316,24 @@ impl DeliveryTurns {
         self.lock().input_dirty
     }
 }
 
 /// One guard's place in [`DeliveryTurns`]; dropping it leaves the queue.
 struct DeliveryTurn {
     turns: Arc<DeliveryTurns>,
     id: u64,
-    input_pending: AtomicBool,
+    /// The `clear_epoch` in which this guard's task went into the line, or
+    /// [`NOT_PENDING`].
+    pending_epoch: AtomicU64,
 }
 
+/// [`DeliveryTurn::pending_epoch`] when no text of the guard is in the line.
+const NOT_PENDING: u64 = u64::MAX;
+
 impl DeliveryTurn {
     /// Wait up to `timeout` for this guard to reach the front. Returns
     /// whether it is its turn; the caller re-checks cancellation between
     /// calls.
     fn wait(&self, timeout: Duration) -> bool {
         let state = self.turns.lock();
         if state.queue.front() == Some(&self.id) {
             return true;
@@ -309,32 +341,62 @@ impl DeliveryTurn {
         let (state, _) = self
             .turns
             .changed
             .wait_timeout(state, timeout)
             .unwrap_or_else(|poison| poison.into_inner());
         state.queue.front() == Some(&self.id)
     }
 
+    /// Record whether this guard's task may sit in the line. `typed_now`
+    /// re-arms it in the current epoch: a (re)write after a user's clear
+    /// puts text into the line again.
+    fn note_input(&self, pending: bool, typed_now: bool) {
+        if !pending {
+            self.pending_epoch.store(NOT_PENDING, Ordering::Relaxed);
+        } else if typed_now || self.pending_epoch.load(Ordering::Relaxed) == NOT_PENDING {
+            let epoch = self.turns.lock().clear_epoch;
+            self.pending_epoch.store(epoch, Ordering::Relaxed);
+        }
+    }
+
+    /// Type this guard's task into the line (`write` does the PTY write)
+    /// and record it as pending in the current clear epoch - as one step
+    /// under the turn lock, which the user's input takes as well
+    /// ([`DeliveryTurns::user_write`]). Whichever of the two writes lands
+    /// later decides the line: a clear right after the task voids it, a
+    /// task right after a clear is pending (Codex review, PR #81). Lock
+    /// order in both: turns, then the PTY writer. Recorded before the write,
+    /// so a panic inside it still counts the task as typed.
+    fn type_task<R>(&self, write: impl FnOnce() -> R) -> R {
+        let state = self.turns.lock();
+        self.pending_epoch
+            .store(state.clear_epoch, Ordering::Relaxed);
+        let result = write();
+        drop(state);
+        result
+    }
+
+    #[cfg(test)]
     fn set_input_pending(&self, pending: bool) {
-        self.input_pending.store(pending, Ordering::Relaxed);
+        self.note_input(pending, pending);
     }
 
     /// Whether a delivery before this one left its task in the session's
     /// input line and no user input has cleared it since.
     fn input_dirty(&self) -> bool {
         self.turns.lock().input_dirty
     }
 }
 
 impl Drop for DeliveryTurn {
     fn drop(&mut self) {
         let mut state = self.turns.lock();
         state.queue.retain(|id| *id != self.id);
-        if self.input_pending.load(Ordering::Relaxed) {
+        if self.pending_epoch.load(Ordering::Relaxed) == state.clear_epoch {
             state.input_dirty = true;
         }
         self.turns.changed.notify_all();
     }
 }
 
 /// See [`Session::trace`].
 struct SessionTrace {
@@ -432,20 +494,41 @@ impl StartingSession {
         *entry = SessionEntry::Interactive(session);
         Ok(())
     }
 }
 
 impl Drop for StartingSession {
     fn drop(&mut self) {
         if self.no_process {
-            if let Ok(mut registry) = self.registry.lock() {
-                if matches!(registry.get(&self.id), Some(SessionEntry::Starting)) {
-                    registry.remove(&self.id);
-                }
+            // Removing this entry is a plain `HashMap::remove` - never a
+            // partial insert - so a poisoned registry is taken over instead
+            // of left alone (W1-15). `into_inner()` does NOT clear the
+            // poison: `Mutex::lock` on this registry keeps returning `Err`
+            // afterwards, and `install_when_idle`/`reserve_session` keep
+            // refusing - a poisoned registry blocks installation until
+            // restart either way (`poisoned_registry_never_authorizes_installation`).
+            // What recovering buys here is a *consistent* map (no dead
+            // `Starting` entry sitting in the inventory forever) and the
+            // released PTY resources that dropping this entry's `Session`
+            // triggers - not admission.
+            //
+            // `eprintln!` is avoided on purpose: this runs in `Drop`, which
+            // can run during an unwind, and a write that itself panics
+            // there aborts the process instead of merely losing a log line.
+            let mut registry = self.registry.lock().unwrap_or_else(|poison| {
+                let _ = writeln!(
+                    std::io::stderr(),
+                    "projecta: pty session registry was poisoned while reaping a failed spawn of {}; recovering to remove the stale entry",
+                    self.id
+                );
+                poison.into_inner()
+            });
+            if matches!(registry.get(&self.id), Some(SessionEntry::Starting)) {
+                registry.remove(&self.id);
             }
         }
     }
 }
 
 /// Owns reserved, starting, interactive and retiring sessions in one registry.
 /// Registered as Tauri managed state.
 #[derive(Clone)]
@@ -514,17 +597,17 @@ impl PtyManager {
 
     pub fn install_when_idle(
         &self,
         install: impl FnOnce() -> Result<(), String>,
     ) -> Result<(), String> {
         let registry = self
             .sessions
             .lock()
-            .map_err(|_| "pty session registry is poisoned")?;
+            .map_err(|_| "pty session registry is poisoned; restart ProjectA")?;
         if self.installation_started.load(Ordering::Relaxed) {
             return Err("Installation already started; restart before starting sessions or another installation".into());
         }
         if !registry.is_empty() {
             return Err("Sessions are active or starting; wait for idle before installing".into());
         }
         // Serialized with reserve_session. Keep this latch even if the installer
         // fails or panics: it may already have replaced application files.
@@ -607,33 +690,41 @@ impl PtyManager {
     /// with: reserve, bind worker and session id synchronously, and only
     /// then spawn - an agent that exits milliseconds into its life is still
     /// found by the exit hook, because the binding is older than the process.
     pub fn reserve_session(&self) -> Result<String, String> {
         let session_id = self.new_session_id();
         let mut registry = self
             .sessions
             .lock()
-            .map_err(|_| "pty session registry is poisoned")?;
+            .map_err(|_| "pty session registry is poisoned; restart ProjectA")?;
         if self.installation_started.load(Ordering::Relaxed) {
             return Err("Installation has started; restart before starting sessions".into());
         }
         registry.insert(session_id.clone(), SessionEntry::Reserved);
         Ok(session_id)
     }
 
     /// Cancel only a not-yet-consumed reservation; never touches a live child.
+    ///
+    /// Same recovery as [`StartingSession::drop`] and the same reason: a
+    /// cancellation only ever removes an entry, so a poisoned registry is
+    /// taken over rather than leaving the reservation stuck in inventory.
     pub fn cancel_reservation(&self, session_id: &str) {
-        if let Ok(mut registry) = self.sessions.lock() {
-            if matches!(
-                registry.get(session_id),
-                Some(SessionEntry::Reserved | SessionEntry::CancelledReservation)
-            ) {
-                registry.remove(session_id);
-            }
+        let mut registry = self.sessions.lock().unwrap_or_else(|poison| {
+            eprintln!(
+                "projecta: pty session registry was poisoned while canceling {session_id}; recovering to remove the stale reservation"
+            );
+            poison.into_inner()
+        });
+        if matches!(
+            registry.get(session_id),
+            Some(SessionEntry::Reserved | SessionEntry::CancelledReservation)
+        ) {
+            registry.remove(session_id);
         }
     }
 
     fn begin_spawn(&self, session_id: &str) -> Result<StartingSession, String> {
         let mut registry = self
             .sessions
             .lock()
             .map_err(|_| "pty session registry is poisoned")?;
@@ -795,25 +886,28 @@ impl PtyManager {
 
     pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
         let session = self.get(session_id)?;
         write_session(&session, data)
     }
 
     /// Input typed by the user into this session (the terminal view).
     ///
-    /// This clears the guard's `input_dirty` flag for the session because a
-    /// person has looked at the prompt, then writes the bytes the same way
-    /// [`PtyManager::write`] does. Automatic paths such as worker messages or
-    /// diff comments use `write` and therefore do *not* clear the flag.
+    /// Written like [`PtyManager::write`]; once it has landed, input that
+    /// sends or empties the line - Enter, Ctrl-U, Ctrl-C - clears the
+    /// session's dirty input line, so deliveries may type again. Other keys
+    /// (a letter, a cursor key) leave an earlier task in place and do not
+    /// (reviews GLM-5.3 X3, DeepSeek X2). Automatic paths such as worker
+    /// messages or diff comments use `write` and never clear it.
     #[cfg_attr(not(test), allow(dead_code))] // W1-03d verdrahtet write_pty (main.rs)
     pub fn write_user_input(&self, session_id: &str, data: &str) -> Result<(), String> {
         let session = self.get(session_id)?;
-        session.delivery_turns.clear_input_dirty();
-        write_session(&session, data)
+        session
+            .delivery_turns
+            .user_write(leaves_line_empty(data), || write_session(&session, data))
     }
 
     /// Start the non-blocking task delivery guard, armed with the agent
     /// profile's readiness marker when it knows one.
     ///
     /// The task is written once the TUI proves its input loop is alive -
     /// either by showing the profile's `readiness_marker` (OpenCode's "Ask
     /// anything", see NT-17: silence alone is *not* readiness, because
@@ -832,18 +926,18 @@ impl PtyManager {
     /// A second call waits until the first delivery has ended, and its
     /// clocks and write baseline start only with its own turn. The turn ends
     /// with the previous guard's terminal event - for a delivered task that
     /// is the first output after its Enter, not the end of the agent's work;
     /// from there the next guard's own readiness rules decide when it types.
     /// A guard that gives up while waiting (session killed or gone) reports
     /// `Escalated`, as does one queued behind a delivery that escalated with
     /// its task already typed. The dirty-input flag belongs to the session:
-    /// every later delivery escalates without writing until user input into
-    /// this session clears it via [`PtyManager::write_user_input`].
+    /// every later delivery escalates without writing until the user sends
+    /// or empties the line ([`PtyManager::write_user_input`]).
     pub fn start_submit_guard<F>(
         &self,
         session_id: &str,
         task: String,
         readiness_marker: Option<&str>,
         on_event: F,
     ) -> Result<(), String>
     where
@@ -948,22 +1042,23 @@ impl PtyManager {
                     tail_since_write: &since_normalized,
                     write_window_overflowed: window_overflowed,
                 };
 
                 let action = guard.tick(&obs);
                 // Record whether the task may still be in the input line
                 // *before* performing the action, so a panic or failed write
                 // is covered by the turn's drop.
-                turn.set_input_pending(guard.input_pending());
+                let typing = matches!(action, Some(SubmitAction::WriteTask { .. }));
+                turn.note_input(guard.input_pending(), typing);
 
                 match action {
                     Some(SubmitAction::WriteTask { write }) => {
                         on_event(SubmitGuardEvent::Wrote { write });
-                        if write_session(&session, &task).is_err() {
+                        if turn.type_task(|| write_session(&session, &task)).is_err() {
                             on_event(SubmitGuardEvent::Escalated);
                             return;
                         }
                         // The mark moves past this write: only output after
                         // it can prove the echo.
                         if let Ok(sb) = session.scrollback.lock() {
                             write_mark = Some(sb.position());
                         }
@@ -1149,37 +1244,48 @@ fn remove_exited_session(
 }
 
 fn remove_exited_session_after_reader(
     sessions: &Mutex<HashMap<String, SessionEntry>>,
     session_id: &str,
     persistence: Result<(), String>,
     reader_finished: impl FnOnce() -> Result<(), String>,
 ) -> Result<(), String> {
+    // Both locks below only ever move or remove *this* session's own entry
+    // (mark it `Retiring`, then remove it once retirement is confirmed), so a
+    // poisoned registry is taken over rather than left alone (W1-15).
+    // `into_inner()` does NOT clear the poison - `install_when_idle` and
+    // `reserve_session` keep refusing afterwards
+    // (`poisoned_registry_never_authorizes_installation`), so this does not
+    // unblock installation. What it buys is a consistent map: the exited
+    // session is real and gone, and leaving its entry behind would keep a
+    // dead process's bookkeeping in the inventory (and its PTY resources
+    // unreleased) on top of the poison, instead of just the poison.
     let removed = {
-        let mut registry = sessions
-            .lock()
-            .map_err(|_| "pty session registry is poisoned")?;
+        let mut registry = sessions.lock().unwrap_or_else(|poison| {
+            eprintln!(
+                "projecta: pty session registry was poisoned while reaping exited session {session_id}; recovering to continue the reap"
+            );
+            poison.into_inner()
+        });
         let entry = registry
             .get_mut(session_id)
             .ok_or("exited session missing")?;
         if matches!(entry, SessionEntry::Retiring) {
             return Err("session retirement already consumed; reconcile".into());
         }
         std::mem::replace(entry, SessionEntry::Retiring)
     };
     // Release registry-owned PTY resources outside the mutex while inventory
     // remains nonempty. Closing the master may be necessary to end ConPTY reads.
     drop(removed);
     let reader_result = reader_finished();
     persistence?;
     reader_result?;
-    let mut registry = sessions
-        .lock()
-        .map_err(|_| "pty session registry is poisoned")?;
+    let mut registry = sessions.lock().unwrap_or_else(|poison| poison.into_inner());
     if !matches!(registry.get(session_id), Some(SessionEntry::Retiring)) {
         return Err("session retirement identity changed".into());
     }
     registry.remove(session_id);
     Ok(())
 }
 
 fn dispatch_confirmed_exit(
@@ -1202,16 +1308,62 @@ fn abort_failed_spawn(child: &mut (dyn Child + Send + Sync)) -> bool {
     }
     if let Err(err) = child.wait() {
         eprintln!("projecta: failed to reap a half-started pty child: {err}");
         return false;
     }
     true
 }
 
+/// Whether one chunk of user input ends with an empty input line: the last
+/// Enter, Ctrl-U or Ctrl-C in it comes after the last text. xterm sends a
+/// multi-line paste as one chunk (`first\rsecond`), and a bracketed paste
+/// (`ESC[200~ ... ESC[201~`) is text as a whole, returns included (Codex
+/// review, PR #81). Other escape sequences and Backspace/Delete add no text.
+fn leaves_line_empty(data: &str) -> bool {
+    const PASTE_START: &str = "\u{1b}[200~";
+    const PASTE_END: &str = "\u{1b}[201~";
+    let mut empty = false;
+    let mut rest = data;
+    while let Some(c) = rest.chars().next() {
+        if let Some(after) = rest.strip_prefix(PASTE_START) {
+            let (pasted, tail) = after.split_once(PASTE_END).unwrap_or((after, ""));
+            if !pasted.is_empty() {
+                empty = false;
+            }
+            rest = tail;
+            continue;
+        }
+        match c {
+            '\r' | '\n' | '\u{15}' | '\u{3}' => empty = true,
+            '\u{1b}' => {
+                // CSI/SS3 sequence: skip to its final byte.
+                let seq = &rest[1..];
+                let len = if let Some(csi) = seq.strip_prefix('[') {
+                    1 + csi
+                        .find(|ch: char| ('\u{40}'..='\u{7e}').contains(&ch))
+                        .map_or(csi.len(), |end| end + 1)
+                } else if let Some(ss3) = seq.strip_prefix('O') {
+                    // SS3, e.g. a cursor key in application mode: ESC O A.
+                    1 + ss3.chars().next().map_or(0, char::len_utf8)
+                } else {
+                    seq.chars().next().map_or(0, char::len_utf8)
+                };
+                rest = &seq[len..];
+                continue;
+            }
+            '\u{7f}' | '\u{8}' => {}
+            c if c.is_control() => {}
+            _ => empty = false,
+        }
+        rest = &rest[c.len_utf8()..];
+    }
+    empty
+}
+
 fn write_session(session: &Session, data: &str) -> Result<(), String> {
     write_session_bytes(session, data.as_bytes())
 }
 
 fn write_session_bytes(session: &Session, data: &[u8]) -> Result<(), String> {
     if let Some(trace) = &session.trace {
         trace.note("in", data);
     }
@@ -1716,16 +1868,80 @@ mod tests {
         });
         assert!(result.is_err());
         assert!(!called.get());
         manager.cancel_reservation(&id);
         assert!(manager.install_when_idle(|| Ok(())).is_ok());
         assert!(manager.reserve_session().is_err());
     }
 
+    #[test]
+    fn poisoned_registry_still_reaps_a_cancelled_reservation() {
+        let manager = PtyManager::default();
+        let id = manager.reserve_session().unwrap();
+        let registry = Arc::clone(&manager.sessions);
+        let _ = std::thread::spawn(move || {
+            let _guard = registry.lock().unwrap();
+            panic!("poison registry fixture");
+        })
+        .join();
+        manager.cancel_reservation(&id);
+        let recovered = manager
+            .sessions
+            .lock()
+            .unwrap_or_else(|poison| poison.into_inner());
+        assert!(
+            recovered.is_empty(),
+            "a cancelled reservation must be reaped even under poison"
+        );
+    }
+
+    #[test]
+    fn poisoned_registry_still_reaps_a_failed_spawn() {
+        let manager = PtyManager::default();
+        let id = manager.reserve_session().unwrap();
+        let starting = manager.begin_spawn(&id).unwrap();
+        let registry = Arc::clone(&manager.sessions);
+        let _ = std::thread::spawn(move || {
+            let _guard = registry.lock().unwrap();
+            panic!("poison registry fixture");
+        })
+        .join();
+        drop(starting);
+        let recovered = manager
+            .sessions
+            .lock()
+            .unwrap_or_else(|poison| poison.into_inner());
+        assert!(
+            recovered.is_empty(),
+            "a failed spawn must be reaped even under poison"
+        );
+    }
+
+    #[test]
+    fn poisoned_registry_still_reaps_an_exited_session() {
+        let manager = PtyManager::default();
+        let id = manager.reserve_session().unwrap();
+        let registry = Arc::clone(&manager.sessions);
+        let _ = std::thread::spawn(move || {
+            let _guard = registry.lock().unwrap();
+            panic!("poison registry fixture");
+        })
+        .join();
+        assert!(remove_exited_session(&manager.sessions, &id, Ok(())).is_ok());
+        let recovered = manager
+            .sessions
+            .lock()
+            .unwrap_or_else(|poison| poison.into_inner());
+        assert!(
+            recovered.is_empty(),
+            "an exited session must be reaped even under poison"
+        );
+    }
+
     #[test]
     fn failed_or_panicked_installation_keeps_admission_closed() {
         for panic in [false, true] {
             let manager = PtyManager::default();
             let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                 manager.install_when_idle(|| {
                     // Installer cleanup must be able to take the registry lock.
                     assert!(manager.live_session_ids().unwrap().is_empty());
@@ -2523,16 +2739,154 @@ mod tests {
             second_events
                 .lock()
                 .unwrap()
                 .contains(&SubmitGuardEvent::Wrote { write: 1 }),
             "the second delivery should have typed its task"
         );
     }
 
+    /// Reviews GLM-5.3 X3 / DeepSeek X2: only input that empties or sends the
+    /// line clears the dirty state. A cursor key or a typed letter leaves
+    /// the earlier task in place, and the next delivery would type behind it.
+    #[test]
+    fn only_line_clearing_user_input_clears_the_dirty_line() {
+        let manager = PtyManager::default();
+        let (session, _writer) = resting_guard_session(&manager, "c3-user-keys");
+        let turn = session.delivery_turns.join();
+        turn.set_input_pending(true);
+        drop(turn);
+        assert!(session.delivery_turns.input_dirty());
+
+        for keys in ["\u{1b}[D", "a", "\u{7f}"] {
+            manager.write_user_input("c3-user-keys", keys).unwrap();
+            assert!(
+                session.delivery_turns.input_dirty(),
+                "{keys:?} does not empty the line"
+            );
+        }
+        for keys in ["\r", "\u{15}", "\u{3}"] {
+            let turn = session.delivery_turns.join();
+            turn.set_input_pending(true);
+            drop(turn);
+            manager.write_user_input("c3-user-keys", keys).unwrap();
+            assert!(
+                !session.delivery_turns.input_dirty(),
+                "{keys:?} sends or empties the line"
+            );
+        }
+    }
+
+    /// Codex review (PR #81, P2): the user may empty a visibly stuck line
+    /// while its delivery is still running. When that guard later gives up,
+    /// its drop must not mark the line dirty again - the user already
+    /// cleared it, and every later delivery would escalate for nothing.
+    #[test]
+    fn a_line_the_user_cleared_mid_delivery_stays_clean() {
+        let manager = PtyManager::default();
+        let (session, writer) = resting_guard_session(&manager, "c3-clear-mid");
+        let events = Arc::new(Mutex::new(Vec::new()));
+        let sink = Arc::clone(&events);
+        manager
+            .start_submit_guard(
+                "c3-clear-mid",
+                "alpha task text".into(),
+                Some(GUARD_TEST_MARKER),
+                move |event| sink.lock().unwrap().push(event),
+            )
+            .unwrap();
+        wait_until("the task to be written", || {
+            writer.typed().contains("alpha task text")
+        });
+        manager.write_user_input("c3-clear-mid", "\u{15}").unwrap();
+        writer.refuse_enter();
+        let deadline = Instant::now() + Duration::from_secs(10);
+        while !(events
+            .lock()
+            .unwrap()
+            .contains(&SubmitGuardEvent::Escalated)
+            && session.delivery_turns.is_empty())
+            && Instant::now() < deadline
+        {
+            session.scrollback.lock().unwrap().push(b"alpha task text");
+            std::thread::sleep(Duration::from_millis(200));
+        }
+        assert!(session.delivery_turns.is_empty(), "the guard never ended");
+        manager.kill("c3-clear-mid").unwrap();
+        assert!(
+            !session.delivery_turns.input_dirty(),
+            "the guard's drop undid the user's clear"
+        );
+    }
+
+    /// Codex review (PR #81, second round, P2): a user's clear that lands
+    /// right after the guard's task write must win - the text is gone. The
+    /// write and its bookkeeping must be one step towards the clear, or the
+    /// guard records the clear's new epoch and its drop marks the emptied
+    /// line dirty again.
+    #[test]
+    fn a_clear_right_after_the_task_write_wins() {
+        let turns = Arc::new(DeliveryTurns::default());
+        let turn = turns.join();
+        std::thread::scope(|scope| {
+            turn.type_task(|| {
+                // The task bytes have landed; the user clears at once.
+                let turns = Arc::clone(&turns);
+                scope.spawn(move || turns.clear_input_dirty());
+                std::thread::sleep(Duration::from_millis(100));
+            });
+        });
+        drop(turn);
+        assert!(
+            !turns.input_dirty(),
+            "the guard's bookkeeping overtook the user's clear"
+        );
+    }
+
+    /// Codex review (PR #81, P2): what counts is the line after the whole
+    /// chunk. A multi-line paste arrives as one chunk (`first\rsecond`), and
+    /// a bracketed paste carries its returns as content - both leave text
+    /// in the line and must not clear it.
+    #[test]
+    fn a_paste_that_leaves_text_in_the_line_does_not_clear_it() {
+        let manager = PtyManager::default();
+        let (session, _writer) = resting_guard_session(&manager, "c3-paste");
+        let dirty = || {
+            let turn = session.delivery_turns.join();
+            turn.set_input_pending(true);
+            drop(turn);
+            assert!(session.delivery_turns.input_dirty());
+        };
+        dirty();
+        for keys in [
+            "first\rsecond",
+            "\u{1b}[200~one\rtwo\u{1b}[201~",
+            "\u{15}more text",
+        ] {
+            manager.write_user_input("c3-paste", keys).unwrap();
+            assert!(
+                session.delivery_turns.input_dirty(),
+                "{keys:?} leaves text in the line"
+            );
+        }
+        for keys in [
+            "typed\r",
+            "\u{1b}[200~pasted\u{1b}[201~\r",
+            "junk\u{15}",
+            "\u{15}\u{1b}OA\u{1b}[D",
+        ] {
+            dirty();
+            manager.write_user_input("c3-paste", keys).unwrap();
+            assert!(
+                !session.delivery_turns.input_dirty(),
+                "{keys:?} ends with an empty line"
+            );
+        }
+    }
+
     /// Review Kimi K3 X2: a guard that panics after typing its task leaves
     /// the queue on unwind, but its text may still sit in the input line.
     /// The next guard must escalate instead of typing after it.
     #[test]
     fn a_panicking_delivery_does_not_let_the_next_one_type_behind_it() {
         let manager = PtyManager::default();
         let (session, writer) = resting_guard_session(&manager, "c3-panic");
         let second_events = Arc::new(Mutex::new(Vec::new()));
diff --git a/src-tauri/src/quota.rs b/src-tauri/src/quota.rs
index 0f174d3..3e31931 100644
--- a/src-tauri/src/quota.rs
+++ b/src-tauri/src/quota.rs
@@ -11,16 +11,17 @@
 //! activity from any of its workers clears it again. The in-memory map is the
 //! source of truth; every change is mirrored to the `agent_quota` table through
 //! a [`QuotaSink`] so a restart starts where the last session left off.
 //!
 //! [`QuotaTracker`] is the shared struct Phase 4's control API will read for
 //! `GET /api/quota`; nothing here is Tauri-specific.
 
 use std::collections::HashMap;
+use std::sync::atomic::{AtomicBool, Ordering};
 use std::sync::{Arc, Mutex};
 
 use serde::Serialize;
 
 use crate::omniroute::OmniRoute;
 use crate::store::{now_unix_secs, AgentQuota, QUOTA_BLOCKED, QUOTA_OK};
 
 /// Keep the stored reason readable without letting a redrawn TUI frame turn
@@ -71,29 +72,35 @@ impl QuotaTracker {
         Self {
             rows: Mutex::new(HashMap::new()),
             sink: Mutex::new(None),
             omni,
         }
     }
 
     /// Install the destination for quota changes. Set once at startup.
+    ///
+    /// A slot replace can never leave `sink` half-written, so a poisoned lock
+    /// is taken over rather than silently keeping the tracker mute (W1-15).
     pub fn set_sink(&self, sink: Arc<dyn QuotaSink>) {
-        if let Ok(mut slot) = self.sink.lock() {
-            *slot = Some(sink);
-        }
+        *self
+            .sink
+            .lock()
+            .unwrap_or_else(|poison| poison.into_inner()) = Some(sink);
     }
 
     /// Seed the map from the database at startup. Nothing is persisted back:
     /// these rows came from there.
     pub fn hydrate(&self, rows: Vec<AgentQuota>) {
-        if let Ok(mut map) = self.rows.lock() {
-            for row in rows {
-                map.insert(row.profile_id.clone(), row);
-            }
+        let mut map = self
+            .rows
+            .lock()
+            .unwrap_or_else(|poison| poison.into_inner());
+        for row in rows {
+            map.insert(row.profile_id.clone(), row);
         }
     }
 
     /// The router handle this tracker reports on. [`crate::providers`] pushes
     /// the stored API keys at it once the user has typed one in.
     pub fn omni_route(&self) -> &Arc<OmniRoute> {
         &self.omni
     }
@@ -126,19 +133,30 @@ impl QuotaTracker {
     }
 
     /// Apply `edit` and persist, but only if it actually changed something.
     fn write<F>(&self, profile_id: &str, edit: F)
     where
         F: FnOnce(&mut AgentQuota),
     {
         let changed = {
-            let Ok(mut rows) = self.rows.lock() else {
-                return;
-            };
+            // `note_blocked`/`note_ok` used to be silently dropped on a
+            // poisoned map: the profile would stay `blocked` (or wrongly
+            // `ok`) forever with nothing on stderr to say why (W1-15). The
+            // edit below only ever inserts-or-mutates one row, so a poisoned
+            // map is taken over instead of skipped. `note_ok` runs on every
+            // chunk of ordinary output, so the log fires once per process
+            // rather than once per chunk.
+            static ROWS_POISON_LOGGED: AtomicBool = AtomicBool::new(false);
+            let mut rows = self.rows.lock().unwrap_or_else(|poison| {
+                if !ROWS_POISON_LOGGED.swap(true, Ordering::Relaxed) {
+                    eprintln!("projecta: quota row map was poisoned; recovering (further occurrences are not logged)");
+                }
+                poison.into_inner()
+            });
             let row = rows
                 .entry(profile_id.to_string())
                 .or_insert_with(|| AgentQuota::unknown(profile_id));
             let before = row.clone();
             edit(row);
             // `updated_at` is not part of the comparison, or every chunk of
             // output would count as a change.
             if same_facts(&before, row) {
@@ -147,68 +165,81 @@ impl QuotaTracker {
                 row.updated_at = now_unix_secs();
                 Some(row.clone())
             }
         };
 
         // Outside the lock: the sink writes to SQLite, and the caller is the
         // PTY reader thread.
         let Some(row) = changed else { return };
-        let sink = self.sink.lock().ok().and_then(|slot| slot.clone());
+        let sink = self
+            .sink
+            .lock()
+            .unwrap_or_else(|poison| poison.into_inner())
+            .clone();
         if let Some(sink) = sink {
             sink.persist(row);
         }
     }
 
     /// One profile's row, or `None` if nothing has been observed about it.
     ///
     /// [`QuotaTracker::snapshot`] is how the app asks - it answers for every
     /// profile at once, which is what both the command and Phase 4's endpoint
     /// want. This one is for a caller that has to look at a single profile's
     /// reason before writing to it: [`crate::budget`] releases only the blocks
     /// it wrote itself, and telling those apart means reading the row.
     pub fn state_of(&self, profile_id: &str) -> Option<AgentQuota> {
-        self.rows.lock().ok()?.get(profile_id).cloned()
+        self.rows
+            .lock()
+            .unwrap_or_else(|poison| poison.into_inner())
+            .get(profile_id)
+            .cloned()
     }
 
+    /// A poisoned map is taken over rather than answered as "not blocked"
+    /// (W1-15): the read that used to shortcut through `.ok()` could let a
+    /// genuinely blocked profile straight through the budget gate.
     pub fn is_blocked(&self, profile_id: &str) -> bool {
         self.rows
             .lock()
-            .ok()
-            .and_then(|rows| rows.get(profile_id).cloned())
+            .unwrap_or_else(|poison| poison.into_inner())
+            .get(profile_id)
             .is_some_and(|row| row.state == QUOTA_BLOCKED)
     }
 
     /// The `get_quota_state` payload: one row per profile in `profile_ids`,
     /// defaulting to `unknown`, plus any profile that has a row but is no
     /// longer in the list - a profile dropped from `agents.json` while blocked
     /// is exactly the case the user needs to see.
     pub fn snapshot(&self, profile_ids: &[String]) -> Vec<QuotaStateRow> {
         let online = self.omni.is_online();
-        let rows = self.rows.lock().ok();
+        // A read-only snapshot of the recovered map is still a truthful
+        // answer under poison; reporting every profile as `unknown` instead
+        // (the old `.ok()` shortcut) would hide a real block from the UI.
+        let rows = self
+            .rows
+            .lock()
+            .unwrap_or_else(|poison| poison.into_inner());
         let known = |id: &str| -> AgentQuota {
-            rows.as_ref()
-                .and_then(|map| map.get(id).cloned())
+            rows.get(id)
+                .cloned()
                 .unwrap_or_else(|| AgentQuota::unknown(id))
         };
 
         let mut out: Vec<QuotaStateRow> = profile_ids
             .iter()
             .map(|id| row_of(&known(id), online))
             .collect();
 
         let mut extra: Vec<String> = rows
-            .as_ref()
-            .map(|map| {
-                map.keys()
-                    .filter(|id| !profile_ids.iter().any(|known| known == *id))
-                    .cloned()
-                    .collect()
-            })
-            .unwrap_or_default();
+            .keys()
+            .filter(|id| !profile_ids.iter().any(|known| known == *id))
+            .cloned()
+            .collect();
         extra.sort();
         out.extend(extra.iter().map(|id| row_of(&known(id), online)));
         out
     }
 }
 
 fn row_of(quota: &AgentQuota, omni_route_online: bool) -> QuotaStateRow {
     QuotaStateRow {
@@ -447,9 +478,36 @@ mod tests {
     fn an_unknown_row_serializes_its_empty_fields_as_null() {
         let (tracker, _recorder) = tracker();
         let rows = tracker.snapshot(&["claude".to_string()]);
         let json = serde_json::to_value(&rows[0]).unwrap();
         assert!(json["blockedUntil"].is_null());
         assert!(json["reason"].is_null());
         assert_eq!(json["state"], QUOTA_UNKNOWN);
     }
+
+    /// A poisoned row map must not read as "nothing is blocked" (W1-15): that
+    /// would let a genuinely blocked profile straight through the budget
+    /// gate, and it would also make `note_blocked` a no-op instead of a write
+    /// that is merely logged as recovered.
+    #[test]
+    fn poisoned_rows_still_record_and_report_a_block() {
+        let (tracker, _recorder) = tracker();
+        // Poison the tracker's own `rows` map from a scoped thread: lock it,
+        // then panic while holding it, exactly like the poisoned_* fixtures
+        // in pty.rs.
+        std::thread::scope(|scope| {
+            let _ = scope
+                .spawn(|| {
+                    let _guard = tracker.rows.lock().unwrap();
+                    panic!("poison quota rows fixture");
+                })
+                .join();
+        });
+        assert!(!tracker.is_blocked("claude"));
+        tracker.note_blocked("claude", "usage limit reached", Some(7));
+        assert!(tracker.is_blocked("claude"));
+        assert_eq!(
+            tracker.state_of("claude").map(|row| row.state),
+            Some(QUOTA_BLOCKED.to_string())
+        );
+    }
 }
diff --git a/src-tauri/src/redact.rs b/src-tauri/src/redact.rs
index 8f9a14f..e43f21a 100644
--- a/src-tauri/src/redact.rs
+++ b/src-tauri/src/redact.rs
@@ -11,19 +11,27 @@
 //! redaction was applied per pipe chunk: a key that arrived as `sk-a` in one
 //! read and `nt-...` in the next matched nothing in either half and went
 //! through unredacted. **Chunk on whitespace, then redact, then store.** A
 //! secret has no whitespace in it, so a token that is still growing is a token
 //! that cannot be judged yet - [`Redactor`] holds it back until whitespace (or
 //! [`Redactor::flush`]) says it is complete.
 //!
 //! What counts as a secret is a heuristic and says so: a short list of the
-//! prefixes the providers this app talks to actually mint, plus the shape of a
-//! PEM header. It is a seatbelt on a path that should not be carrying secrets
-//! in the first place, not a scanner.
+//! prefixes the providers this app talks to actually mint, the shape of a PEM
+//! header, and - since W1-26 - the exact shape of this app's own API/verdict
+//! tokens (`api::new_token`) *and* its hook secrets (`oneshot::random_hex`,
+//! used from `hooks.rs`): both mint exactly 32 lowercase hex characters
+//! (`format!("{:032x}", ...)` on 16 random bytes) with no prefix at all. That
+//! shape is deliberately exact and case-sensitive (not "32-ish hex
+//! characters"), so it does not also catch a 40-character git SHA or a
+//! hyphenated UUID; see [`is_token_shaped`] for the false positives that
+//! leaves open, and the segmentation gap it does not close. It is a seatbelt
+//! on a path that should not be carrying secrets in the first place, not a
+//! scanner.
 
 /// What replaces a token that looks like a secret.
 pub const MASK: &str = "[redacted]";
 
 /// Prefixes that mark a provider token. Matched case-sensitively: every one of
 /// these is minted in exactly this case, and matching loosely would redact
 /// ordinary prose that happens to start the same way.
 const SECRET_PREFIXES: [&str; 9] = [
@@ -37,16 +45,76 @@ const SECRET_PREFIXES: [&str; 9] = [
     "AIza",        // Google API key
     "AKIA",        // AWS access key id
 ];
 
 /// Below this length a match is more likely to be prose than a key: `sk-` on
 /// its own, or `AKIA` as a word in a sentence, says nothing.
 const MIN_SECRET_LEN: usize = 12;
 
+/// The exact length of an API/verdict token: `api::new_token` draws 16
+/// random bytes and formats them as `format!("{:032x}", ...)` - always 32
+/// lowercase hex digits, never more, never less, and with no prefix a
+/// `SECRET_PREFIXES` check could ever catch. The hook secrets minted by
+/// [`crate::oneshot::random_hex`] (used from `hooks.rs`) are drawn the same
+/// way and formatted with the same `{:032x}`, so this length and the rule
+/// below cover both.
+const TOKEN_HEX_LEN: usize = 32;
+
+/// Is this segment exactly the shape `api::new_token` (and
+/// `oneshot::random_hex`) mints?
+///
+/// The length has to be exact, not "at least": a 40-character git SHA or a
+/// 36-character hyphenated UUID must not be swept up just for being made of
+/// hex-ish characters. [`redact_token`] only splits on characters outside
+/// [`is_key_char`] (not hex-vs-non-hex), so this check only ever sees the
+/// hex shape cleanly when a token is not itself glued to other key-chars -
+/// see the known gap noted below.
+///
+/// Only ASCII `0`-`9` and lowercase `a`-`f` count, matching `{:032x}`
+/// exactly - the same case-sensitivity `SECRET_PREFIXES` already relies on.
+/// An uppercase or mixed-case 32-character string (an uppercase MD5 digest,
+/// a bare Windows GUID) is therefore not touched.
+///
+/// This does mean a bare *lowercase* 32-hex string that is not one of our
+/// tokens is masked too. Known false positives, none of them minted by this
+/// app today but plausible in adjacent text: a lowercase MD5 digest, a
+/// filename such as `agent-access/<hex>.json` (`api/agent_access.rs`, the
+/// stem is `new_token()`), a W3C trace id, or any other 32-lowercase-hex
+/// value that lands in message text - which `digest.rs` renders into `.pa/`
+/// and `diagnosis.rs` exports; its test fixtures at `diagnosis.rs:430-445`
+/// use exactly this shape to prove such values are *not* torn out. However
+/// the segment ends up in text - after `token=`, `Bearer `, a header name, or
+/// on its own - there is no cheap way to tell these apart from the string
+/// alone, and a token that leaks is worse than one of these getting masked by
+/// mistake.
+///
+/// **Known gap, not fixed by this rule:** [`redact_token`] only splits at
+/// characters *outside* [`is_key_char`] (alphanumeric, `-`, `_`), so a token
+/// that is glued to surrounding letters, digits, `-` or `_` is not isolated
+/// into its own segment and this check never sees it in isolation - it stays
+/// unmasked. For example `tok_<hex>`, `verdict-<hex>`, `<hex>_x`, a
+/// `{:?}`-debug-formatted line where a real newline is written out as the two
+/// literal characters `\` and `n` (`\` splits the segment, but `n` is a key
+/// char, so the token ends up glued as `n<hex>`), an ANSI-colored
+/// `\x1b[32m<hex>` (the same mechanism leaves `m<hex>`), a URL-encoded
+/// `%3D<hex>`, or two tokens written back to back (64 hex characters as one
+/// segment) all pass through unmasked today. No place in this repository
+/// currently embeds a token this way, but the segmentation does not rule it
+/// out. Closing this gap needs run-based detection (scanning for a 32-hex run
+/// anywhere in a segment, not just segment-equality) and is deliberately left
+/// as follow-up work, not part of this fix - see
+/// `a_token_glued_to_a_word_is_a_known_gap` below.
+fn is_token_shaped(segment: &str) -> bool {
+    segment.len() == TOKEN_HEX_LEN
+        && segment
+            .bytes()
+            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
+}
+
 /// Characters a provider token is made of. Everything else - quotes, `=`,
 /// commas, brackets - is punctuation around it, and is where a token is cut
 /// into the segments [`looks_secret`] judges.
 fn is_key_char(c: char) -> bool {
     c.is_ascii_alphanumeric() || c == '-' || c == '_'
 }
 
 /// Does this segment look like a secret?
@@ -59,16 +127,18 @@ pub fn looks_secret(segment: &str) -> bool {
         return false;
     }
     SECRET_PREFIXES
         .iter()
         .any(|prefix| segment.starts_with(prefix))
         // A PEM header never appears alone, but its first line is enough to
         // catch the block it opens.
         || segment.contains("PRIVATE-KEY")
+        // api::new_token has no prefix at all - only its fixed 32-hex shape.
+        || is_token_shaped(segment)
 }
 
 /// Mask the secret-looking segments of one whitespace-delimited token, leaving
 /// everything around them exactly as it was.
 fn redact_token(token: &str) -> String {
     let mut out = String::with_capacity(token.len());
     let mut segment = String::new();
     let flush = |segment: &mut String, out: &mut String| {
@@ -199,16 +269,137 @@ mod tests {
             }
             out.push_str(&redactor.flush());
             assert_eq!(out, whole, "split into {size}-character chunks");
         }
         assert!(!whole.contains("sk-ant"), "{whole}");
         assert!(!whole.contains("ghp_"), "{whole}");
     }
 
+    #[test]
+    fn a_32_hex_token_is_masked() {
+        // api::new_token mints exactly this shape: format!("{:032x}", ...) on
+        // 16 random bytes - 32 lowercase hex characters, no prefix at all.
+        // The app itself sends the token over HTTP headers
+        // (`x-projecta-token` / `x-verdict-token`, see `api.rs:189` and
+        // `api.rs:194`), not embedded in a log line the way this test's
+        // `token=`/`Bearer` forms suggest - no place in the repo logs it
+        // today. These forms are exercised anyway because they are the
+        // shapes a human might type or paste (e.g. a curl command) and
+        // because the CLI accepts a token this way, as `--verdict-token
+        // <hex>` (`pa.rs`) - it does not echo it back, but the value still
+        // passes through whatever might log the invocation.
+        let token = "0123456789abcdef0123456789abcdef";
+        assert_eq!(token.len(), 32, "fixture must be 32 chars: {token}");
+
+        assert_eq!(
+            redact(&format!("token={token}")),
+            "token=[redacted]",
+            "token=<hex> form"
+        );
+        assert_eq!(
+            redact(&format!("Bearer {token}")),
+            "Bearer [redacted]",
+            "Bearer <hex> form"
+        );
+        assert_eq!(redact(token), "[redacted]", "bare token");
+
+        // The header name the app actually uses, and the CLI flag that takes
+        // the same shape of value (`pa.rs`'s `--verdict-token`).
+        assert_eq!(
+            redact(&format!("x-verdict-token: {token}")),
+            "x-verdict-token: [redacted]",
+            "x-verdict-token: <hex> form"
+        );
+        assert_eq!(
+            redact(&format!("--verdict-token {token}")),
+            "--verdict-token [redacted]",
+            "--verdict-token <hex> form"
+        );
+    }
+
+    #[test]
+    fn a_token_glued_to_a_word_is_a_known_gap() {
+        // Documented gap (see is_token_shaped's doc comment): redact_token
+        // only splits at characters outside is_key_char, and '_' and '-' are
+        // both key chars, so a token glued to a word via one of them - or to
+        // another word with no separator at all - is not isolated into its
+        // own segment and slips through unmasked. This test asserts today's
+        // actual (unwanted) behaviour; closing it is follow-up work
+        // (run-based token detection), not part of this fix.
+        let token = "0123456789abcdef0123456789abcdef";
+
+        let glued_prefix = format!("tok_{token}");
+        assert_eq!(
+            redact(&glued_prefix),
+            glued_prefix,
+            "dokumentierte Lücke, Folgeauftrag"
+        );
+
+        let glued_suffix = format!("verdict-{token}");
+        assert_eq!(
+            redact(&glued_suffix),
+            glued_suffix,
+            "dokumentierte Lücke, Folgeauftrag"
+        );
+
+        let glued_trailing = format!("{token}_x");
+        assert_eq!(
+            redact(&glued_trailing),
+            glued_trailing,
+            "dokumentierte Lücke, Folgeauftrag"
+        );
+
+        // Two tokens back to back form one 64-character segment, which is
+        // not the exact 32-length shape either.
+        let doubled = format!("{token}{token}");
+        assert_eq!(
+            redact(&doubled),
+            doubled,
+            "dokumentierte Lücke, Folgeauftrag"
+        );
+    }
+
+    #[test]
+    fn hex_lookalikes_are_not_masked() {
+        // A git SHA-1 is 40 hex characters, eight more than a token.
+        let sha40 = "abcdef0123456789abcdef0123456789abcdef01";
+        assert_eq!(sha40.len(), 40);
+        assert_eq!(redact(sha40), sha40, "40-char sha stays untouched");
+
+        // An abbreviated git SHA is far shorter.
+        assert_eq!(redact("commit abc1234 done"), "commit abc1234 done");
+
+        // A UUID is 32 hex digits too, but with hyphens breaking it up -
+        // still 36 characters as one segment, and not the token shape.
+        let uuid = "550e8400-e29b-41d4-a716-446655440000";
+        assert_eq!(redact(uuid), uuid, "hyphenated uuid stays untouched");
+
+        // 31 and 33 hex characters must not match either - the length has to
+        // be exact, not "roughly 32".
+        let hex31 = "0123456789abcdef0123456789abcde";
+        assert_eq!(hex31.len(), 31);
+        assert_eq!(redact(hex31), hex31);
+        let hex33 = "0123456789abcdef0123456789abcdef0";
+        assert_eq!(hex33.len(), 33);
+        assert_eq!(redact(hex33), hex33);
+
+        // api::new_token is lowercase-only (`{:032x}`); an uppercase 32-hex
+        // string - a Windows-style GUID without braces/hyphens, or an
+        // uppercase MD5 - is not this app's token shape and stays readable.
+        let upper32 = "0123456789ABCDEF0123456789ABCDEF";
+        assert_eq!(upper32.len(), 32);
+        assert_eq!(redact(upper32), upper32, "uppercase hex stays untouched");
+
+        // A mixed-case 32-hex string is not the exact lowercase shape either.
+        let mixed32 = "0123456789abcdef0123456789ABCDEF";
+        assert_eq!(mixed32.len(), 32);
+        assert_eq!(redact(mixed32), mixed32, "mixed-case hex stays untouched");
+    }
+
     #[test]
     fn punctuation_around_a_key_does_not_hide_it_and_survives_it() {
         for (wrapped, expected) in [
             ("\"sk-ant-api03-AAAAAAAAAAAA\"", "\"[redacted]\""),
             ("(sk-ant-api03-AAAAAAAAAAAA)", "([redacted])"),
             ("sk-ant-api03-AAAAAAAAAAAA,", "[redacted],"),
             ("'sk-ant-api03-AAAAAAAAAAAA';", "'[redacted]';"),
             // The name of the variable is not the secret, and keeping it is
diff --git a/src-tauri/src/store.rs b/src-tauri/src/store.rs
index 694ed90..c31c4f9 100644
--- a/src-tauri/src/store.rs
+++ b/src-tauri/src/store.rs
@@ -3943,16 +3943,21 @@ impl Store {
 /// Writes with a timestamp of the caller's choosing, and one schema edit.
 ///
 /// The ordinary writers stamp [`now_unix_secs`], which is exactly right in
 /// production and useless in a test that has to assert "three days ago". These
 /// exist so [`crate::stats`] can build a fixture whose windows are known, and
 /// they are `cfg(test)` so nothing else can reach for them.
 #[cfg(test)]
 impl Store {
+    /// The pool itself, for tests that must control connection checkout.
+    pub(crate) fn pool_for_test(&self) -> &SqlitePool {
+        &self.pool
+    }
+
     pub(crate) async fn insert_message_at(
         &self,
         worker_id: &str,
         id: &str,
         role: &str,
         created_at: i64,
     ) -> Result<(), String> {
         sqlx::query(
diff --git a/src-tauri/src/store/continuous.rs b/src-tauri/src/store/continuous.rs
index 0a5dfd7..b44922d 100644
--- a/src-tauri/src/store/continuous.rs
+++ b/src-tauri/src/store/continuous.rs
@@ -1,17 +1,17 @@
 //! Durable, deliberately non-executing state for the DevHQ continuous-work
 //! contract.  This module owns claims and planning limits; it never starts a
 //! process.  A lease expiry is diagnostic information only, never permission
 //! to start a duplicate agent.
 
 use super::{new_id, now_unix_secs, Sqlite, Store, Transaction};
 use crate::development_policy::{self, DevelopmentPolicy};
 use serde::Serialize;
-use sqlx::FromRow;
+use sqlx::{FromRow, SqliteConnection, SqlitePool};
 
 #[path = "continuous_capacity.rs"]
 mod capacity;
 
 pub const CONTINUOUS_PAUSED: &str = "paused";
 pub const CONTINUOUS_DRAINING: &str = "draining";
 pub const CONTINUOUS_ENABLED: &str = "enabled";
 const TASK_OPEN: &str = "open";
@@ -191,24 +191,21 @@ pub(super) async fn apply_policy_migration(tx: &mut Transaction<'_, Sqlite>) ->
     legacy_policy.tokens = None;
     let policy =
         serde_json::to_string(&legacy_policy).map_err(|e| format!("encode legacy policy: {e}"))?;
     sqlx::query("INSERT INTO continuous_root_policies SELECT DISTINCT root_goal_id, ?1, 'legacy-v4-defaults', ?2 FROM continuous_goals")
         .bind(policy).bind(now_unix_secs()).execute(&mut **tx).await.map_err(db("preserve legacy root policies"))?;
     Ok(())
 }
 
-async fn root_policy(
-    tx: &mut Transaction<'_, Sqlite>,
-    root: &str,
-) -> Result<DevelopmentPolicy, String> {
+async fn root_policy(tx: &mut SqliteConnection, root: &str) -> Result<DevelopmentPolicy, String> {
     let row: (String,) =
         sqlx::query_as("SELECT policy_json FROM continuous_root_policies WHERE root_goal_id = ?")
             .bind(root)
-            .fetch_one(&mut **tx)
+            .fetch_one(&mut *tx)
             .await
             .map_err(db("read immutable root policy"))?;
     development_policy::parse(&row.0)
 }
 
 impl Store {
     pub async fn create_continuous_goal(
         &self,
@@ -226,23 +223,41 @@ impl Store {
                 .await?
                 .ok_or("unknown project")?;
             Some(development_policy::load(std::path::Path::new(
                 &project.repo_path,
             ))?)
         } else {
             None
         };
+        let mut tx = begin_write(&self.pool, "begin continuous goal").await?;
+        let outcome = Self::create_continuous_goal_body(
+            &mut tx,
+            project_id,
+            objective,
+            acceptance_criteria,
+            source_goal_id,
+            admit,
+            loaded,
+        )
+        .await;
+        settle(tx, outcome, "commit continuous goal").await
+    }
+
+    async fn create_continuous_goal_body(
+        tx: &mut SqliteConnection,
+        project_id: &str,
+        objective: String,
+        acceptance_criteria: Option<String>,
+        source_goal_id: Option<String>,
+        admit: bool,
+        loaded: Option<development_policy::LoadedPolicy>,
+    ) -> Result<ContinuousGoal, String> {
         let now = now_unix_secs();
         let id = new_id("cg");
-        let mut tx = self
-            .pool
-            .begin()
-            .await
-            .map_err(db("begin continuous goal"))?;
         let (root_goal_id, deadline_at) = match source_goal_id.as_deref() {
             Some(source_goal_id) => {
                 let source: Option<(String, String, i64)> = sqlx::query_as("SELECT project_id, root_goal_id, deadline_at FROM continuous_goals WHERE id = ?1 AND status = 'open' AND root_goal_id IN (SELECT id FROM continuous_goals WHERE status = 'open')")
                     .bind(source_goal_id).fetch_optional(&mut *tx).await.map_err(db("read continuous source goal"))?;
                 match source {
                     Some((source_project, root, deadline)) if source_project == project_id => {
                         (root, deadline)
                     }
@@ -266,17 +281,17 @@ impl Store {
                     ) * 60
                 } else {
                     0
                 },
             ),
         };
         let policy = match &loaded {
             Some(loaded) => loaded.policy.clone(),
-            None => root_policy(&mut tx, &root_goal_id).await?,
+            None => root_policy(tx, &root_goal_id).await?,
         };
         if admit && policy.continuous.max_autonomous_goals == 0 {
             return Err("continuous goal admission is disabled by its root policy".into());
         }
         if admit && source_goal_id.is_none() {
             let active: Option<(String,)> = sqlx::query_as("SELECT root_goal_id FROM continuous_goals WHERE project_id = ?1 AND admitted = 1 AND status NOT IN ('completed', 'cancelled', 'failed') LIMIT 1")
                 .bind(project_id).fetch_optional(&mut *tx).await.map_err(db("read admitted continuous root"))?;
             if active.is_some() {
@@ -313,18 +328,17 @@ impl Store {
             sqlx::query("INSERT INTO continuous_root_policies(root_goal_id, policy_json, source, observed_at) VALUES(?, ?, ?, ?)")
                 .bind(&root_goal_id).bind(encoded).bind(&loaded.source).bind(now).execute(&mut *tx).await.map_err(db("freeze root policy"))?;
         }
         sqlx::query("INSERT INTO continuous_goal_budget(project_id, root_goal_id) VALUES(?1, ?2) ON CONFLICT(project_id, root_goal_id) DO NOTHING")
             .bind(project_id).bind(&root_goal_id).execute(&mut *tx).await.map_err(db("reserve continuous root ledger"))?;
         sqlx::query("INSERT INTO continuous_goals(id, project_id, source_goal_id, root_goal_id, objective, acceptance_criteria, status, deadline_at, admitted, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
             .bind(&goal.id).bind(project_id).bind(&goal.source_goal_id).bind(&goal.root_goal_id).bind(&goal.objective).bind(&goal.acceptance_criteria).bind(&goal.status).bind(goal.deadline_at).bind(goal.admitted).bind(now).bind(now)
             .execute(&mut *tx).await.map_err(db("create continuous goal"))?;
-        event(&mut tx, project_id, "goal_created", &goal.id, now).await?;
-        tx.commit().await.map_err(db("commit continuous goal"))?;
+        event(tx, project_id, "goal_created", &goal.id, now).await?;
         Ok(goal)
     }
 
     pub async fn list_continuous_goals(
         &self,
         project_id: &str,
     ) -> Result<Vec<ContinuousGoal>, String> {
         self.require_project(project_id).await?;
@@ -338,38 +352,57 @@ impl Store {
         objective: &str,
         profile_id: Option<String>,
         owned_paths: Vec<String>,
         dependencies: Vec<String>,
     ) -> Result<ContinuousTask, String> {
         let objective = required_text(objective, "objective")?;
         let owned_paths = normalize_scopes(owned_paths)?;
         let dependencies = normalize_ids(dependencies, "dependencies")?;
-        let mut tx = self
-            .pool
-            .begin()
-            .await
-            .map_err(db("begin continuous task"))?;
+        let mut tx = begin_write(&self.pool, "begin continuous task").await?;
+        let outcome = Self::create_continuous_task_body(
+            &mut tx,
+            goal_id,
+            objective,
+            profile_id,
+            owned_paths,
+            dependencies,
+        )
+        .await;
+        let id = settle(tx, outcome, "commit continuous task").await?;
+        self.get_continuous_task(&id)
+            .await?
+            .ok_or_else(|| "created continuous task disappeared".to_string())
+    }
+
+    async fn create_continuous_task_body(
+        tx: &mut SqliteConnection,
+        goal_id: &str,
+        objective: String,
+        profile_id: Option<String>,
+        owned_paths: Vec<String>,
+        dependencies: Vec<String>,
+    ) -> Result<String, String> {
         let goal: Option<(String, String, i64, bool)> =
             sqlx::query_as("SELECT project_id, root_goal_id, deadline_at, admitted FROM continuous_goals WHERE id = ?1 AND status = 'open'")
                 .bind(goal_id)
                 .fetch_optional(&mut *tx)
                 .await
                 .map_err(db("read continuous goal"))?;
         let Some((project_id, root_goal_id, deadline_at, _admitted)) = goal else {
             return Err(format!("unknown continuous goal: {goal_id}"));
         };
         if deadline_at > 0 && now_unix_secs() >= deadline_at {
             return Err(
                 "continuous goal deadline has elapsed; task admission is closed".to_string(),
             );
         }
         let (count,): (i64,) = sqlx::query_as("SELECT tasks_created FROM continuous_goal_budget WHERE project_id = ?1 AND root_goal_id = ?2")
             .bind(&project_id).bind(&root_goal_id).fetch_one(&mut *tx).await.map_err(db("read continuous root ledger"))?;
-        let policy = root_policy(&mut tx, &root_goal_id).await?;
+        let policy = root_policy(tx, &root_goal_id).await?;
         if count >= i64::from(policy.continuous.max_tasks_per_goal) {
             return Err(
                 "continuous goal task budget exhausted (including recreated goals)".to_string(),
             );
         }
         for dependency in &dependencies {
             let found: Option<(String,)> = sqlx::query_as("SELECT g.project_id FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE t.id = ?1")
                 .bind(dependency).fetch_optional(&mut *tx).await.map_err(db("read task dependency"))?;
@@ -410,21 +443,18 @@ impl Store {
             .bind(scope)
             .bind(&id)
             .execute(&mut *tx)
             .await
             .map_err(db("claim continuous scope"))?;
         }
         sqlx::query("UPDATE continuous_goal_budget SET tasks_created = tasks_created + 1 WHERE project_id = ?1 AND root_goal_id = ?2")
             .bind(&project_id).bind(&root_goal_id).execute(&mut *tx).await.map_err(db("consume continuous task budget"))?;
-        event(&mut tx, &project_id, "task_created", &id, now).await?;
-        tx.commit().await.map_err(db("commit continuous task"))?;
-        self.get_continuous_task(&id)
-            .await?
-            .ok_or_else(|| "created continuous task disappeared".to_string())
+        event(tx, &project_id, "task_created", &id, now).await?;
+        Ok(id)
     }
 
     pub async fn claim_continuous_task(
         &self,
         task_id: &str,
         owner: &str,
         escalation: bool,
     ) -> Result<ContinuousClaim, String> {
@@ -440,16 +470,29 @@ impl Store {
         observe_capacity: impl FnOnce() -> capacity::Capacity,
     ) -> Result<ContinuousClaim, String> {
         let owner = required_text(owner, "owner")?;
         let mut tx = self
             .pool
             .begin()
             .await
             .map_err(db("begin continuous claim"))?;
+        let outcome =
+            Self::claim_with_capacity_body(&mut tx, task_id, &owner, escalation, observe_capacity)
+                .await;
+        settle(tx, outcome, "commit continuous claim").await
+    }
+
+    async fn claim_with_capacity_body(
+        tx: &mut SqliteConnection,
+        task_id: &str,
+        owner: &str,
+        escalation: bool,
+        observe_capacity: impl FnOnce() -> capacity::Capacity,
+    ) -> Result<ContinuousClaim, String> {
         sqlx::query("UPDATE continuous_tasks SET updated_at=updated_at WHERE id=?")
             .bind(task_id)
             .execute(&mut *tx)
             .await
             .map_err(db("serialize continuous claim"))?;
         let row: Option<ClaimAdmissionRow> = sqlx::query_as("SELECT g.project_id, g.root_goal_id, g.deadline_at, g.admitted, t.attempts, t.escalations, t.claim_owner, t.claim_fence FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE t.id = ?1 AND t.status = ?2 AND g.status = 'open'")
             .bind(task_id).bind(TASK_OPEN).fetch_optional(&mut *tx).await.map_err(db("read continuous claim"))?;
         let Some((
@@ -469,18 +512,18 @@ impl Store {
             return Err(format!("continuous task is already claimed: {task_id}"));
         }
         if !admitted {
             return Err("continuous goal is a draft and is not admitted for execution".to_string());
         }
         if deadline_at == 0 || now_unix_secs() >= deadline_at {
             return Err("continuous goal has no active deadline or its deadline has elapsed; claim is refused".to_string());
         }
-        let policy = root_policy(&mut tx, &root_goal_id).await?;
-        super::team_assignments::check_claim(&mut tx, task_id, &owner, &policy).await?;
+        let policy = root_policy(tx, &root_goal_id).await?;
+        super::team_assignments::check_claim(tx, task_id, owner, &policy).await?;
         if attempts >= i64::from(policy.continuous.max_attempts_per_task) {
             return Err("continuous task attempt budget exhausted".to_string());
         }
         if escalation && escalations >= i64::from(policy.continuous.max_escalations) {
             return Err("continuous task escalation budget exhausted".to_string());
         }
         let (state,): (String,) =
             sqlx::query_as("SELECT status FROM continuous_projects WHERE project_id = ?1")
@@ -533,31 +576,30 @@ impl Store {
             if status.as_ref().map(|row| row.0.as_str()) != Some(TASK_COMPLETED) {
                 return Err(format!("dependency is not completed: {dependency}"));
             }
         }
         let now = now_unix_secs();
         let fence = prior_fence + 1;
         let lease_expires_at = now + CLAIM_LEASE_SECONDS;
         sqlx::query("UPDATE continuous_tasks SET status = ?, claim_owner = ?, claim_fence = ?, claimed_at = ?, lease_expires_at = ?, attempts = attempts + 1, escalations = escalations + ?, updated_at = ? WHERE id = ? AND status = ? AND claim_owner IS NULL")
-            .bind(TASK_RUNNING).bind(&owner).bind(fence).bind(now).bind(lease_expires_at).bind(usize::from(escalation) as i64).bind(now).bind(task_id).bind(TASK_OPEN).execute(&mut *tx).await.map_err(db("write continuous claim"))?;
+            .bind(TASK_RUNNING).bind(owner).bind(fence).bind(now).bind(lease_expires_at).bind(usize::from(escalation) as i64).bind(now).bind(task_id).bind(TASK_OPEN).execute(&mut *tx).await.map_err(db("write continuous claim"))?;
         // Read the conditional write back. Only this owner/fence pair proves
         // that the transaction won the claim.
         let won: Option<(String, i64)> = sqlx::query_as("SELECT claim_owner, claim_fence FROM continuous_tasks WHERE id = ?1 AND claim_owner = ?2 AND claim_fence = ?3")
-            .bind(task_id).bind(&owner).bind(fence).fetch_optional(&mut *tx).await.map_err(db("verify continuous claim fence"))?;
+            .bind(task_id).bind(owner).bind(fence).fetch_optional(&mut *tx).await.map_err(db("verify continuous claim fence"))?;
         if won.is_none() {
             return Err(format!("continuous task claim lost race: {task_id}"));
         }
         sqlx::query("UPDATE continuous_goal_budget SET attempts = attempts + 1, escalations = escalations + ?1 WHERE project_id = ?2 AND root_goal_id = ?3")
             .bind(usize::from(escalation) as i64).bind(&project_id).bind(&root_goal_id).execute(&mut *tx).await.map_err(db("consume continuous attempt budget"))?;
-        event(&mut tx, &project_id, "task_claimed", task_id, now).await?;
-        tx.commit().await.map_err(db("commit continuous claim"))?;
+        event(tx, &project_id, "task_claimed", task_id, now).await?;
         Ok(ContinuousClaim {
             task_id: task_id.to_string(),
-            owner,
+            owner: owner.to_string(),
             fence,
             claimed_at: now,
             lease_expires_at,
         })
     }
 
     pub async fn checkpoint_continuous_task(
         &self,
@@ -565,44 +607,59 @@ impl Store {
         owner: &str,
         fence: i64,
         status: Option<&str>,
         detail: Option<&str>,
     ) -> Result<ContinuousTask, String> {
         let owner = required_text(owner, "owner")?;
         let requested = status.unwrap_or(TASK_RUNNING);
         let retry = requested == "retry";
-        let mut next = if retry { TASK_OPEN } else { requested };
+        let next = if retry { TASK_OPEN } else { requested };
         if requested == TASK_OPEN
             || !matches!(
                 next,
                 TASK_RUNNING | TASK_COMPLETED | TASK_CANCELLED | TASK_FAILED | TASK_OPEN
             )
         {
             return Err(
                 "continuous checkpoint status must be running, completed, cancelled, failed or retry"
                     .to_string(),
             );
         }
-        let mut tx = self
-            .pool
-            .begin()
-            .await
-            .map_err(db("begin continuous checkpoint"))?;
+        let mut tx = begin_write(&self.pool, "begin continuous checkpoint").await?;
+        let outcome = Self::checkpoint_continuous_task_body(
+            &mut tx, task_id, &owner, fence, next, retry, detail,
+        )
+        .await;
+        settle(tx, outcome, "commit continuous checkpoint").await?;
+        self.get_continuous_task(task_id)
+            .await?
+            .ok_or_else(|| "checkpointed continuous task disappeared".to_string())
+    }
+
+    async fn checkpoint_continuous_task_body(
+        tx: &mut SqliteConnection,
+        task_id: &str,
+        owner: &str,
+        fence: i64,
+        mut next: &str,
+        retry: bool,
+        detail: Option<&str>,
+    ) -> Result<(), String> {
         let project: Option<(String,)> = sqlx::query_as("SELECT g.project_id FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE t.id = ?1").bind(task_id).fetch_optional(&mut *tx).await.map_err(db("read continuous checkpoint"))?;
         let Some((project_id,)) = project else {
             return Err(format!("unknown continuous task: {task_id}"));
         };
         let now = now_unix_secs();
         if retry {
             let (root, attempts, deadline): (String, i64, i64) = sqlx::query_as("SELECT g.root_goal_id, t.attempts, g.deadline_at FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE t.id = ?")
                 .bind(task_id).fetch_one(&mut *tx).await.map_err(db("read retry budget"))?;
-            let policy = root_policy(&mut tx, &root).await?;
+            let policy = root_policy(tx, &root).await?;
             let (failed,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM development_runs WHERE task_id = ? AND claim_owner = ? AND claim_fence = ? AND status = 'failed'")
-                .bind(task_id).bind(&owner).bind(fence).fetch_one(&mut *tx).await.map_err(db("verify failed attempt"))?;
+                .bind(task_id).bind(owner).bind(fence).fetch_one(&mut *tx).await.map_err(db("verify failed attempt"))?;
             if failed != 1 {
                 return Err("retry requires a resolved failed run for the current claim".into());
             }
             if attempts >= i64::from(policy.continuous.max_attempts_per_task) || now >= deadline {
                 next = TASK_FAILED;
             }
         }
         let release_claim = is_terminal(next) || retry;
@@ -612,26 +669,26 @@ impl Store {
             if active > 0 {
                 return Err(
                     "continuous task has an unresolved run; reconcile before releasing ownership"
                         .into(),
                 );
             }
         }
         let changed = sqlx::query("UPDATE continuous_tasks SET status = ?1, updated_at = ?2, claim_owner = CASE WHEN ?3 THEN NULL ELSE claim_owner END, claimed_at = CASE WHEN ?3 THEN NULL ELSE claimed_at END, lease_expires_at = CASE WHEN ?3 THEN NULL ELSE lease_expires_at END WHERE id = ?4 AND status = ?5 AND claim_owner = ?6 AND claim_fence = ?7")
-            .bind(next).bind(now).bind(release_claim).bind(task_id).bind(TASK_RUNNING).bind(&owner).bind(fence).execute(&mut *tx).await.map_err(db("write continuous checkpoint"))?;
+            .bind(next).bind(now).bind(release_claim).bind(task_id).bind(TASK_RUNNING).bind(owner).bind(fence).execute(&mut *tx).await.map_err(db("write continuous checkpoint"))?;
         if changed.rows_affected() != 1 {
             return Err(format!(
                 "stale or unauthorized continuous claim fence for task: {task_id}"
             ));
         }
         let verified: Option<(String,)> = if release_claim {
             sqlx::query_as("SELECT status FROM continuous_tasks WHERE id = ?1 AND status = ?2 AND claim_owner IS NULL").bind(task_id).bind(next).fetch_optional(&mut *tx).await.map_err(db("verify terminal checkpoint"))?
         } else {
-            sqlx::query_as("SELECT status FROM continuous_tasks WHERE id = ?1 AND status = ?2 AND claim_owner = ?3 AND claim_fence = ?4").bind(task_id).bind(next).bind(&owner).bind(fence).fetch_optional(&mut *tx).await.map_err(db("verify continuous checkpoint"))?
+            sqlx::query_as("SELECT status FROM continuous_tasks WHERE id = ?1 AND status = ?2 AND claim_owner = ?3 AND claim_fence = ?4").bind(task_id).bind(next).bind(owner).bind(fence).fetch_optional(&mut *tx).await.map_err(db("verify continuous checkpoint"))?
         };
         if verified.is_none() {
             return Err(format!(
                 "stale or unauthorized continuous claim fence for task: {task_id}"
             ));
         }
         if is_terminal(next) {
             sqlx::query("DELETE FROM continuous_scope_locks WHERE task_id = ?1")
@@ -640,30 +697,18 @@ impl Store {
                 .await
                 .map_err(db("release continuous scopes"))?;
         }
         if next == TASK_COMPLETED {
             sqlx::query("UPDATE continuous_goals SET status = 'awaiting_review', updated_at = ?1 WHERE root_goal_id = (SELECT g.root_goal_id FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE t.id = ?2) AND status = 'open' AND NOT EXISTS (SELECT 1 FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE g.root_goal_id = continuous_goals.root_goal_id AND t.status != 'completed')")
                 .bind(now).bind(task_id).execute(&mut *tx).await.map_err(db("advance continuous goal to review"))?;
         }
         let checkpoint_detail = serde_json::json!({"taskId": task_id, "owner": owner, "fence": fence, "status": next, "detail": detail}).to_string();
-        event(
-            &mut tx,
-            &project_id,
-            "task_checkpoint",
-            &checkpoint_detail,
-            now,
-        )
-        .await?;
-        tx.commit()
-            .await
-            .map_err(db("commit continuous checkpoint"))?;
-        self.get_continuous_task(task_id)
-            .await?
-            .ok_or_else(|| "checkpointed continuous task disappeared".to_string())
+        event(tx, &project_id, "task_checkpoint", &checkpoint_detail, now).await?;
+        Ok(())
     }
 
     pub async fn control_continuous(
         &self,
         project_id: &str,
         action: &str,
     ) -> Result<ContinuousControl, String> {
         self.require_project(project_id).await?;
@@ -674,21 +719,33 @@ impl Store {
             "resume" => {
                 return Err(
                     "continuous runtime adapters are unattested; resume is fail-closed".to_string(),
                 )
             }
             _ => return Err("continuous action must be pause, drain, resume or cancel".to_string()),
         };
         let now = now_unix_secs();
-        let mut tx = self
-            .pool
-            .begin()
-            .await
-            .map_err(db("begin continuous control"))?;
+        let mut tx = begin_write(&self.pool, "begin continuous control").await?;
+        let outcome = Self::control_continuous_body(&mut tx, project_id, action, status, now).await;
+        settle(tx, outcome, "commit continuous control").await?;
+        Ok(ContinuousControl {
+            project_id: project_id.to_string(),
+            status: status.to_string(),
+            updated_at: now,
+        })
+    }
+
+    async fn control_continuous_body(
+        tx: &mut SqliteConnection,
+        project_id: &str,
+        action: &str,
+        status: &str,
+        now: i64,
+    ) -> Result<(), String> {
         sqlx::query("INSERT INTO continuous_projects(project_id, status, updated_at) VALUES(?1, ?2, ?3) ON CONFLICT(project_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at").bind(project_id).bind(status).bind(now).execute(&mut *tx).await.map_err(db("write continuous control"))?;
         if action == "cancel" {
             let (active,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id JOIN continuous_goals g ON g.id = t.goal_id WHERE g.project_id = ? AND r.status IN ('intent', 'launched', 'reconciling')")
                 .bind(project_id).fetch_one(&mut *tx).await.map_err(db("check unresolved project runs"))?;
             if active > 0 {
                 return Err(
                     "continuous project has unresolved runs; drain and reconcile before cancelling"
                         .into(),
@@ -697,23 +754,18 @@ impl Store {
             sqlx::query("UPDATE continuous_goals SET status = 'cancelled', updated_at = ?1 WHERE project_id = ?2 AND status NOT IN ('completed', 'cancelled', 'failed')").bind(now).bind(project_id).execute(&mut *tx).await.map_err(db("cancel continuous goals"))?;
             sqlx::query("UPDATE continuous_tasks SET status = ?1, claim_owner = NULL, claimed_at = NULL, lease_expires_at = NULL, updated_at = ?2 WHERE id IN (SELECT t.id FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE g.project_id = ?3 AND t.status IN (?4, ?5))").bind(TASK_CANCELLED).bind(now).bind(project_id).bind(TASK_OPEN).bind(TASK_RUNNING).execute(&mut *tx).await.map_err(db("cancel continuous tasks"))?;
             sqlx::query("DELETE FROM continuous_scope_locks WHERE project_id = ?1")
                 .bind(project_id)
                 .execute(&mut *tx)
                 .await
                 .map_err(db("release cancelled scopes"))?;
         }
-        event(&mut tx, project_id, "control", action, now).await?;
-        tx.commit().await.map_err(db("commit continuous control"))?;
-        Ok(ContinuousControl {
-            project_id: project_id.to_string(),
-            status: status.to_string(),
-            updated_at: now,
-        })
+        event(tx, project_id, "control", action, now).await?;
+        Ok(())
     }
 
     pub async fn continuous_changes(
         &self,
         project_id: &str,
         after_cursor: i64,
     ) -> Result<serde_json::Value, String> {
         if after_cursor < 0 {
@@ -851,30 +903,80 @@ impl Store {
             Ok(())
         } else {
             Err(format!("unknown project: {project_id}"))
         }
     }
 }
 
 async fn event(
-    tx: &mut Transaction<'_, Sqlite>,
+    tx: &mut SqliteConnection,
     project_id: &str,
     kind: &str,
     detail: &str,
     now: i64,
 ) -> Result<(), String> {
-    sqlx::query("INSERT INTO continuous_events(project_id, kind, detail, created_at) VALUES(?1, ?2, ?3, ?4)").bind(project_id).bind(kind).bind(detail).bind(now).execute(&mut **tx).await.map_err(db("write continuous event"))?;
+    sqlx::query("INSERT INTO continuous_events(project_id, kind, detail, created_at) VALUES(?1, ?2, ?3, ?4)").bind(project_id).bind(kind).bind(detail).bind(now).execute(&mut *tx).await.map_err(db("write continuous event"))?;
     sqlx::query("INSERT INTO continuous_context_snapshots(project_id, source_timestamp, commit_sha, run_id) VALUES(?1, ?2, NULL, NULL) ON CONFLICT(project_id) DO UPDATE SET source_timestamp = excluded.source_timestamp")
-        .bind(project_id).bind(now).execute(&mut **tx).await.map_err(db("stamp continuous snapshot"))?;
+        .bind(project_id).bind(now).execute(&mut *tx).await.map_err(db("stamp continuous snapshot"))?;
     Ok(())
 }
 fn db(label: &'static str) -> impl FnOnce(sqlx::Error) -> String {
     move |e| format!("{label}: {e}")
 }
+/// Opens a transaction that holds SQLite's writer lock from its first
+/// statement (`BEGIN IMMEDIATE`). Every writer here reads before it writes;
+/// under a deferred `BEGIN` the first `SELECT` opens a read transaction, and
+/// SQLite runs the busy handler only while *no* transaction is open
+/// (`btreeBeginTrans` in sqlite3.c: the retry loop requires
+/// `inTransaction == TRANS_NONE`). The later read-to-write upgrade then
+/// fails at once with `(code: 5) database is locked` whenever another
+/// connection holds the lock, and `busy_timeout` never engages. Taking the
+/// lock at `BEGIN` puts the wait where the busy handler does run.
+async fn begin_write(
+    pool: &SqlitePool,
+    label: &'static str,
+) -> Result<Transaction<'static, Sqlite>, String> {
+    pool.begin_with("BEGIN IMMEDIATE").await.map_err(db(label))
+}
+/// Commits `tx` on `Ok`, explicitly rolls it back on `Err`; `label` names
+/// the commit in its error.
+///
+/// Dropping an open [`Transaction`] instead only *queues* the ROLLBACK on
+/// the connection's worker thread (`sqlx-core` 0.8.6 `Transaction::drop` ->
+/// `start_rollback`). The connection itself does not re-enter the pool
+/// before that ROLLBACK: `PoolConnection::drop` spawns `return_to_pool`,
+/// which pings the worker first, and the ping queues behind it. But the
+/// caller has already returned, and its next transaction takes a
+/// *different* pooled connection while the old worker thread - under load
+/// not yet scheduled - still holds the writer lock. Settling here releases
+/// the lock before the caller continues, not whenever that thread runs.
+async fn settle<T>(
+    tx: Transaction<'_, Sqlite>,
+    result: Result<T, String>,
+    label: &'static str,
+) -> Result<T, String> {
+    match result {
+        Ok(value) => {
+            tx.commit().await.map_err(db(label))?;
+            Ok(value)
+        }
+        Err(err) => {
+            // If ROLLBACK itself fails, the sqlx worker for this connection
+            // is left with transaction_depth == 1 (worker.rs never sees the
+            // matching decrement). A later BEGIN IMMEDIATE on that same
+            // connection would then fail with InvalidSavePointStatement, so
+            // surface the rollback error instead of swallowing it.
+            if let Err(rollback_err) = tx.rollback().await {
+                return Err(format!("{err}; rollback failed: {rollback_err}"));
+            }
+            Err(err)
+        }
+    }
+}
 fn required_text(value: &str, field: &str) -> Result<String, String> {
     let value = value.trim();
     if value.is_empty() {
         Err(format!("{field} is required"))
     } else {
         Ok(value.to_string())
     }
 }
@@ -1386,16 +1488,132 @@ mod tests {
             .create_continuous_task(&goal.id, "late", None, vec!["late".into()], vec![])
             .await
             .is_err());
         assert!(store
             .create_continuous_goal(&project, "late replan", None, Some(goal.id), true)
             .await
             .is_err());
     }
+    /// The CI symptom of `.pa/report_w1-25.md`, Fall 1, made deterministic.
+    /// Another connection holds SQLite's writer lock - here on purpose, in
+    /// CI a dropped transaction whose queued ROLLBACK had not run yet - and
+    /// releases it after ~200 ms. A checkpoint with a valid fence must wait
+    /// for that through `busy_timeout` (5 s) instead of failing at once
+    /// with `(code: 5) database is locked`. It used to fail at once: a
+    /// deferred `BEGIN` followed by a `SELECT` holds a read transaction, and
+    /// SQLite runs the busy handler only while no transaction is open
+    /// (`btreeBeginTrans`: the retry loop requires
+    /// `inTransaction == TRANS_NONE`), so the later read-to-write upgrade
+    /// returned SQLITE_BUSY without waiting.
+    #[tokio::test]
+    async fn a_checkpoint_waits_for_a_foreign_writer_instead_of_failing_busy() {
+        use sqlx::Connection as _;
+        let (dir, store, project) = store().await;
+        let goal = store
+            .create_continuous_goal(&project, "ship", None, None, true)
+            .await
+            .unwrap();
+        let task = store
+            .create_continuous_task(&goal.id, "implement", None, vec!["src/x.rs".into()], vec![])
+            .await
+            .unwrap();
+        let claim = store
+            .claim_continuous_task(&task.id, "a", false)
+            .await
+            .unwrap();
+        let options = sqlx::sqlite::SqliteConnectOptions::new()
+            .filename(dir.path().join("projecta.db"))
+            .busy_timeout(std::time::Duration::from_secs(5));
+        let (locked_tx, locked_rx) = tokio::sync::oneshot::channel();
+        let task_id = task.id.clone();
+        let holder = tokio::spawn(async move {
+            let mut conn = sqlx::sqlite::SqliteConnection::connect_with(&options)
+                .await
+                .expect("open foreign connection");
+            let mut tx = conn.begin().await.expect("begin foreign transaction");
+            sqlx::query("UPDATE continuous_tasks SET updated_at = updated_at WHERE id = ?1")
+                .bind(&task_id)
+                .execute(&mut *tx)
+                .await
+                .expect("take the writer lock");
+            locked_tx.send(()).expect("signal lock held");
+            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
+            tx.rollback().await.expect("release the writer lock");
+        });
+        locked_rx.await.expect("foreign writer holds the lock");
+        let started = std::time::Instant::now();
+        let result = store
+            .checkpoint_continuous_task(&task.id, "a", claim.fence, Some(TASK_COMPLETED), None)
+            .await;
+        let elapsed = started.elapsed();
+        holder.await.expect("foreign writer task");
+        assert!(
+            result.is_ok(),
+            "checkpoint must wait for the foreign writer, not fail after {elapsed:?}: {result:?}"
+        );
+        assert_eq!(result.unwrap().status, TASK_COMPLETED);
+        assert!(
+            elapsed >= std::time::Duration::from_millis(150),
+            "the checkpoint must have waited for the lock, took {elapsed:?}"
+        );
+    }
+    /// A mechanism pin, not a regression test (see `.pa/report_w1-25.md`):
+    /// a transaction that has written keeps SQLite's writer lock until it is
+    /// settled, so a second connection cannot write meanwhile. That is the
+    /// window `settle()` closes - a dropped transaction's queued ROLLBACK
+    /// runs only when its worker thread is scheduled. The regression test
+    /// for the CI failure is
+    /// `a_checkpoint_waits_for_a_foreign_writer_instead_of_failing_busy`.
+    #[tokio::test]
+    async fn an_unsettled_write_transaction_blocks_a_second_connections_write() {
+        use sqlx::Connection as _;
+        let dir = TempDir::new("continuous-unsettled-tx");
+        let path = dir.path().join("lock.db");
+        let options = sqlx::sqlite::SqliteConnectOptions::new()
+            .filename(&path)
+            .create_if_missing(true)
+            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
+            // A short busy_timeout: the point is that a second connection
+            // cannot make progress at all while the first's write is
+            // unsettled, not how long it is willing to wait.
+            .busy_timeout(std::time::Duration::from_millis(50));
+        let mut holder = sqlx::sqlite::SqliteConnection::connect_with(&options)
+            .await
+            .expect("open holder connection");
+        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER NOT NULL)")
+            .execute(&mut holder)
+            .await
+            .expect("create table");
+        sqlx::query("INSERT INTO t (id, v) VALUES (1, 0)")
+            .execute(&mut holder)
+            .await
+            .expect("seed row");
+        // Begin a write transaction and leave it open - the same state a
+        // dropped-but-not-yet-rolled-back `Transaction` leaves behind for
+        // however long its queued rollback takes to actually run.
+        let mut tx = sqlx::Connection::begin(&mut holder)
+            .await
+            .expect("begin holder transaction");
+        sqlx::query("UPDATE t SET v = v WHERE id = 1")
+            .execute(&mut *tx)
+            .await
+            .expect("write inside the held transaction");
+        let mut second = sqlx::sqlite::SqliteConnection::connect_with(&options)
+            .await
+            .expect("open second connection");
+        let result = sqlx::query("UPDATE t SET v = 1 WHERE id = 1")
+            .execute(&mut second)
+            .await;
+        assert!(
+            result.is_err(),
+            "a second connection must not be able to write while the first's \
+             transaction is still unsettled, committed or not: {result:?}"
+        );
+    }
     #[tokio::test]
     async fn dependency_and_recreated_goal_budgets_are_refused() {
         let (_dir, store, project) = store().await;
         let goal = store
             .create_continuous_goal(&project, "ship", None, None, true)
             .await
             .unwrap();
         let first = store
diff --git a/src-tauri/src/store/team_assignments.rs b/src-tauri/src/store/team_assignments.rs
index d245aca..3f559a1 100644
--- a/src-tauri/src/store/team_assignments.rs
+++ b/src-tauri/src/store/team_assignments.rs
@@ -1,13 +1,13 @@
 //! Durable team coordination; assignments never grant approval authority.
 use super::{now_unix_secs, Store};
 use crate::development_policy::DevelopmentPolicy;
 use serde::{Deserialize, Serialize};
-use sqlx::{FromRow, Sqlite, Transaction};
+use sqlx::{FromRow, Sqlite, SqliteConnection, Transaction};
 type AssignmentAdmissionRow = (String, String, String, i64, String, Option<String>, i64);
 
 #[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
 #[serde(rename_all = "camelCase")]
 pub struct TeamAssignment {
     pub task_id: String,
     pub team_id: String,
     pub role: String,
@@ -114,25 +114,25 @@ impl Store {
 
 pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
     sqlx::query("CREATE TABLE continuous_team_assignments(task_id TEXT PRIMARY KEY,team_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('coordinator','implementer','reviewer','integrator')),assignee TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),policy_version INTEGER NOT NULL,observed_at INTEGER NOT NULL)")
         .execute(&mut **tx).await.map_err(db)?;
     Ok(())
 }
 
 pub(super) async fn read(
-    tx: &mut Transaction<'_, Sqlite>,
+    tx: &mut SqliteConnection,
     task: &str,
 ) -> Result<Option<TeamAssignment>, String> {
     sqlx::query_as("SELECT task_id,team_id,role,assignee,revision,policy_version,observed_at FROM continuous_team_assignments WHERE task_id=?")
-        .bind(task).fetch_optional(&mut **tx).await.map_err(db)
+        .bind(task).fetch_optional(&mut *tx).await.map_err(db)
 }
 
 pub(super) async fn check_claim(
-    tx: &mut Transaction<'_, Sqlite>,
+    tx: &mut SqliteConnection,
     task: &str,
     owner: &str,
     policy: &DevelopmentPolicy,
 ) -> Result<(), String> {
     if let Some(assignment) = read(tx, task).await? {
         if assignment.assignee != owner {
             return Err("continuous task is assigned to another owner".into());
         }
@@ -140,17 +140,17 @@ pub(super) async fn check_claim(
             .teams
             .iter()
             .any(|team| team.id == assignment.team_id && team.roles.contains(&assignment.role))
         {
             return Err("team assignment conflicts with frozen root policy".into());
         }
         if assignment.role == "integrator" {
             let (active,):(i64,)=sqlx::query_as("SELECT COUNT(*) FROM continuous_team_assignments a JOIN continuous_tasks t ON t.id=a.task_id WHERE a.role='integrator' AND t.status='running'")
-                .fetch_one(&mut **tx).await.map_err(db)?;
+                .fetch_one(&mut *tx).await.map_err(db)?;
             if active >= i64::from(policy.continuous.max_integration) {
                 return Err("continuous integration capacity exhausted".into());
             }
         }
     }
     Ok(())
 }
 
diff --git a/src-tauri/src/submit_guard.rs b/src-tauri/src/submit_guard.rs
index 67b7d10..9bfe6bc 100644
--- a/src-tauri/src/submit_guard.rs
+++ b/src-tauri/src/submit_guard.rs
@@ -351,38 +351,39 @@ impl SubmitGuard {
     fn escalate(&mut self, reason: EscalationReason) -> Option<SubmitAction> {
         self.state = StateData::Escalated(reason);
         Some(SubmitAction::Escalate)
     }
 
     /// Whether the task text may still sit unsent in the TUI's input line.
     ///
     /// Set once the guard asks for the task to be typed (`WriteTask`), and
-    /// cleared as soon as output answers the Enter - the same byte-based
-    /// proof that makes a profile without answer marker count the task as
-    /// delivered. An escalation after that point (`AnswerMarkerNeverSeen`)
-    /// leaves it `false`; `EchoNeverSeen` and `EnterUnanswered` leave it
-    /// `true`, and the PTY layer then keeps later deliveries off the line.
+    /// cleared only by proof that the agent took it: without an answer
+    /// marker, output after the Enter (the byte-based delivery proof); with
+    /// one, the marker itself - there a byte bump is just a sign of life,
+    /// and a TUI that folded the Enter and redrew its status line looks the
+    /// same (Codex review, PR #81). Every escalation with the task typed
+    /// (`EchoNeverSeen`, `EnterUnanswered`, `AnswerMarkerNeverSeen`) leaves
+    /// it `true`, and the PTY layer then keeps later deliveries off the
+    /// line.
     pub fn input_pending(&self) -> bool {
         self.input_pending
     }
 
     /// Advance the machine with one observation and return an effect when a
     /// state boundary is crossed.
     pub fn tick(&mut self, obs: &Observation) -> Option<SubmitAction> {
         let action = self.step(obs);
         if matches!(action, Some(SubmitAction::WriteTask { .. })) {
             self.input_pending = true;
         }
-        let answered = if let StateData::AwaitingWork { bytes_at_enter, .. } = self.state {
-            obs.output_bytes > bytes_at_enter
-        } else {
-            matches!(self.state, StateData::Delivered)
-        };
-        if answered {
+        // `Delivered` is the proof in both modes: byte-based without an
+        // answer marker (the step checks the output before any retry cap,
+        // review GLM-5.3 X2), marker-confirmed with one.
+        if matches!(self.state, StateData::Delivered) {
             self.input_pending = false;
         }
         action
     }
 
     fn step(&mut self, obs: &Observation) -> Option<SubmitAction> {
         if self.is_done() {
             return None;
@@ -1812,50 +1813,112 @@ Hooks need review 2 hooks are new or changed. > 1. Review hooks 2. Trust all and
         assert_eq!(guard.state(), SubmitState::Escalated);
         assert_eq!(
             guard.escalation_reason(),
             Some(EscalationReason::AnswerMarkerNeverSeen)
         );
     }
 
     /// W1-03c (review GPT-5.3-Codex X1): the task counts as left in the
-    /// input line from its write until output answers the Enter. A later
-    /// escalation - here the answer marker's cap - must not report the line
-    /// as dirty, or the next delivery to the session escalates for nothing.
+    /// input line from its write until output answers the Enter - without
+    /// an answer marker that output is the delivery proof itself.
     #[test]
     fn input_is_pending_only_until_output_answers_the_enter() {
         let start = Instant::now();
-        let mut guard = SubmitGuard::new(start, TASK).with_answer_marker("⏺");
+        let mut guard = SubmitGuard::new(start, TASK);
         assert!(!guard.input_pending());
         assert_eq!(
             guard.tick(&obs(start, 30, 400, Some(1), "boot")),
             Some(SubmitAction::WriteTask { write: 1 })
         );
         assert!(guard.input_pending(), "typed, not yet echoed");
         let echoed = format!("prompt > {TASK}");
         assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
         assert_eq!(
             guard.tick(&obs(start, 32, 600, Some(31), &echoed)),
             Some(SubmitAction::SendEnter { attempt: 0 })
         );
         assert!(guard.input_pending(), "Enter sent, not yet answered");
 
         let working = format!("{echoed} working");
         assert_eq!(guard.tick(&obs(start, 40, 700, Some(40), &working)), None);
+        assert!(guard.is_delivered());
         assert!(!guard.input_pending(), "output answered the Enter");
+    }
 
+    /// Review GLM-5.3 X2, read for the profile without answer marker: the
+    /// first output after the Enter can land in the tick in which the last
+    /// Enter retry would escalate. The output wins - the line is empty and
+    /// must not be reported as pending.
+    #[test]
+    fn output_in_the_tick_of_the_cap_still_answers_the_enter() {
+        let start = Instant::now();
+        let mut guard = SubmitGuard::new(start, TASK);
+        assert_eq!(
+            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
+            Some(SubmitAction::WriteTask { write: 1 })
+        );
+        let echoed = format!("prompt > {TASK}");
+        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
         assert_eq!(
-            guard.tick(&obs(start, 632, 800, Some(632), &working)),
+            guard.tick(&obs(start, 32, 600, Some(31), &echoed)),
+            Some(SubmitAction::SendEnter { attempt: 0 })
+        );
+        let working = format!("{echoed} working");
+        assert_eq!(
+            guard.tick(&obs(start, 1000, 700, Some(1000), &working)),
+            None,
+            "output after the Enter is delivery, not an escalation"
+        );
+        assert!(guard.is_delivered());
+        assert!(!guard.input_pending(), "output answered the Enter");
+    }
+
+    /// Codex review (PR #81, P2): with an answer marker configured, output
+    /// after the Enter is only a sign of life - a TUI that folded the Enter
+    /// and merely redrew its status line looks the same. The task counts as
+    /// left in the line until the marker proves the agent took it, and an
+    /// escalation at the cap keeps the line dirty.
+    #[test]
+    fn with_an_answer_marker_input_stays_pending_until_the_marker() {
+        let start = Instant::now();
+        let mut guard = SubmitGuard::new(start, TASK).with_answer_marker("⏺");
+        assert_eq!(
+            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
+            Some(SubmitAction::WriteTask { write: 1 })
+        );
+        let echoed = format!("prompt > {TASK}");
+        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
+        assert_eq!(
+            guard.tick(&obs(start, 32, 600, Some(31), &echoed)),
+            Some(SubmitAction::SendEnter { attempt: 0 })
+        );
+        let redraw = format!("{echoed} status");
+        assert_eq!(guard.tick(&obs(start, 40, 700, Some(40), &redraw)), None);
+        assert!(guard.input_pending(), "a redraw proves nothing");
+        assert_eq!(
+            guard.tick(&obs(start, 632, 800, Some(632), &redraw)),
             Some(SubmitAction::Escalate)
         );
         assert_eq!(
             guard.escalation_reason(),
             Some(EscalationReason::AnswerMarkerNeverSeen)
         );
-        assert!(!guard.input_pending());
+        assert!(guard.input_pending(), "the cap leaves the line dirty");
+
+        let mut confirmed = SubmitGuard::new(start, TASK).with_answer_marker("⏺");
+        confirmed.tick(&obs(start, 30, 400, Some(1), "boot"));
+        confirmed.tick(&obs(start, 31, 600, Some(31), &echoed));
+        confirmed.tick(&obs(start, 32, 600, Some(31), &echoed));
+        let answer = format!("{echoed} ⏺ on it");
+        assert_eq!(
+            confirmed.tick(&obs(start, 40, 700, Some(40), &answer)),
+            Some(SubmitAction::ConfirmDelivery)
+        );
+        assert!(!confirmed.input_pending(), "the marker proves the take");
     }
 
     /// The counterpart: Enter retries that no output answers leave the task
     /// on the prompt, and the escalation reports it as still pending.
     #[test]
     fn unanswered_enter_retries_leave_the_input_pending() {
         let start = Instant::now();
         let mut guard = SubmitGuard::new(start, TASK);
diff --git a/src-tauri/src/workers.rs b/src-tauri/src/workers.rs
index 7e5c97b..63f385e 100644
--- a/src-tauri/src/workers.rs
+++ b/src-tauri/src/workers.rs
@@ -4305,31 +4305,34 @@ mod tests {
             vec![worker]
         );
     }
 
     /// The spawn→bind race: an agent whose process exits milliseconds after
     /// starting must not stay `running` on the board. The exit hook used to
     /// lose this race every time, because `bind_session` ran only after the
     /// spawn returned; the binding now exists before the child process does.
-    #[tokio::test]
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
     async fn an_agent_that_exits_during_spawn_does_not_stay_running() {
         let fx = fixture("spawn-bind-race").await;
 
         /// A control whose "child" exits the instant it starts: the exit hook
         /// fires from inside the spawn, exactly where the PTY reaper thread
         /// can run it in production.
         struct ExitAtSpawn {
             store: Store,
         }
 
         impl ExitAtSpawn {
             fn fire_exit(&self, session_id: &str) {
                 // From its own thread, like the real reaper: blocking the
                 // test's runtime thread against the store would deadlock.
+                // The join still blocks the body's thread, hence the
+                // multi-thread runtime (see
+                // `an_exit_hook_joined_during_spawn_still_gets_a_pooled_connection`).
                 let store = self.store.clone();
                 let session_id = session_id.to_string();
                 std::thread::spawn(move || {
                     tauri::async_runtime::block_on(store.mark_session_exited(&session_id, Some(1)))
                 })
                 .join()
                 .expect("exit hook thread")
                 .expect("mark session exited");
@@ -4420,17 +4423,17 @@ mod tests {
             "the late session row must be born closed, not left open forever"
         );
         assert_eq!(session.exit_code, Some(1));
     }
 
     /// The respawn twin of [`an_agent_that_exits_during_spawn_does_not_stay_running`]:
     /// the exit hook flips the row to `exited` mid-spawn, so the status write
     /// after `record_session_start` must not flip it back to `running`.
-    #[tokio::test]
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
     async fn an_agent_that_exits_during_respawn_is_not_revived_as_running() {
         let fx = fixture("respawn-bind-race").await;
 
         struct ExitAtSpawn {
             store: Store,
         }
 
         impl AgentControl for ExitAtSpawn {
@@ -4502,16 +4505,135 @@ mod tests {
             .unwrap()
             .expect("worker row");
         assert_eq!(
             row.status, STATUS_EXITED,
             "a worker whose replacement exited during respawn must not be revived as running"
         );
     }
 
+    /// Fall 2 of `.pa/report_w1-25.md`, made deterministic. The exit-at-spawn
+    /// fakes above join an OS thread that writes to the store, and they do so
+    /// on the thread that runs the test body. A pooled connection dropped on
+    /// that thread goes back to the pool only through a task sqlx spawns onto
+    /// the current runtime (`sqlx-core` `rt::spawn`, `Handle::try_current`);
+    /// on a current-thread runtime that task cannot run while the thread
+    /// blocks in `join`. With every connection in that state the hook waits
+    /// out the pool's 30 s acquire deadline ("pool timed out"). Here the fake
+    /// checks out all four idle connections and drops them just before the
+    /// join, which makes that state deterministic; how CI got there (e.g.
+    /// returns still waiting on their ping) is a thesis, corroborated by the
+    /// CI log also showing `log_message`'s own "pool timed out". Under
+    /// `#[tokio::test]` this test fails after 30 s; the fix is the
+    /// multi-thread flavor, whose workers return the connections while the
+    /// body's thread blocks.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn an_exit_hook_joined_during_spawn_still_gets_a_pooled_connection() {
+        let fx = fixture("exit-hook-pool").await;
+
+        struct DrainThenExit {
+            store: Store,
+        }
+
+        impl DrainThenExit {
+            fn fire_exit(&self, session_id: &str) {
+                let pool = self.store.pool_for_test();
+                assert_eq!(pool.size(), 4, "the pool was filled before the spawn");
+                let idle: Vec<_> = std::iter::from_fn(|| pool.try_acquire()).collect();
+                drop(idle);
+                let store = self.store.clone();
+                let session_id = session_id.to_string();
+                std::thread::spawn(move || {
+                    tauri::async_runtime::block_on(store.mark_session_exited(&session_id, Some(1)))
+                })
+                .join()
+                .expect("exit hook thread")
+                .expect("mark session exited");
+            }
+        }
+
+        impl AgentControl for DrainThenExit {
+            fn spawn(
+                &self,
+                worker_id: &str,
+                _profile: &AgentProfile,
+                _cwd: &Path,
+                _env: &[(String, String)],
+            ) -> Result<String, String> {
+                let session_id = format!("pty-drain-exit-{worker_id}");
+                self.fire_exit(&session_id);
+                Ok(session_id)
+            }
+
+            fn spawn_bound(
+                &self,
+                worker_id: &str,
+                _profile: &AgentProfile,
+                _cwd: &Path,
+                _env: &[(String, String)],
+                bind: &dyn Fn(&str) -> Result<(), String>,
+            ) -> Result<String, String> {
+                let session_id = format!("pty-drain-exit-{worker_id}");
+                bind(&session_id)?;
+                self.fire_exit(&session_id);
+                Ok(session_id)
+            }
+
+            fn kill(&self, _session_id: &str) {}
+
+            fn start_task_delivery(
+                &self,
+                _worker_id: &str,
+                _session_id: &str,
+                _task: &str,
+                _readiness_marker: Option<&str>,
+                _on_outcome: Option<DeliveryCallback>,
+            ) -> Result<(), String> {
+                Ok(())
+            }
+        }
+
+        // Open all four connections and let them return, so the pool is
+        // full and idle when the spawn starts.
+        let pool = fx.store.pool_for_test();
+        let mut opened = Vec::new();
+        for _ in 0..4 {
+            opened.push(pool.acquire().await.expect("open pooled connection"));
+        }
+        drop(opened);
+        tokio::time::timeout(std::time::Duration::from_secs(5), async {
+            while pool.num_idle() < 4 {
+                tokio::task::yield_now().await;
+            }
+        })
+        .await
+        .expect("pool did not return four idle connections within 5s");
+
+        let agents = DrainThenExit {
+            store: fx.store.clone(),
+        };
+        let worker = create_worker(
+            &fx.store,
+            &agents,
+            &fx.project_id,
+            "exit while the pool is drained",
+            "claude",
+            None,
+        )
+        .await
+        .expect("create worker");
+        let row = fx
+            .store
+            .get_worker(&worker.id)
+            .await
+            .unwrap()
+            .expect("worker row");
+        assert_eq!(row.status, STATUS_EXITED);
+    }
+
     /// Installs an `agents.json` next to the test executable - the one place
     /// [`profiles::load_profiles`] looks for overrides - and puts back what was
     /// there when the test ends.
     struct AgentsJson {
         path: PathBuf,
         restore: Option<String>,
     }
 
```
