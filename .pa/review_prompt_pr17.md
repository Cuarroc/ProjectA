# Code review (stage B): PR #17, package W5-02b5 (ProjectA)

You are an independent reviewer for the public ProjectA repository (Tauri 2
agentic terminal). The author is a Kimi agent; you must not be one. Give a
verdict on the candidate commit `60f0f6a5cfa230216d3d67224138d7a119e7da0b` (branch claude/w5-02b5, base
origin/main).

## Task

W5-02b5 (from docs/PLAN.md / MASTERPLAN, follow-up of report W5-02b):
"Test for the http.extraHeader reset with a local HTTP server; GPG under the
strict env level (user decision: as described in the PLAN). Only tests and
minimal fixes."

Background: the `strict` agent environment (src-tauri/src/pty/agent_env.rs)
locks git credentials via GIT_CONFIG_COUNT/GIT_CONFIG_PARAMETERS with an empty
`credential.helper`, an empty `http.extraHeader` and `protocol.ssh.allow=never`.
The extraHeader reset was untested (review K-B2/G-2 of W5-02b). The GPG user
decision (W5-02b review K6): strict must NOT force commit.gpgsign=false - a
signing key is no push right; the package pins that decision by test.

## What the candidate does

- Adds a std-only loopback HTTP server helper and three tests to
  src-tauri/src/pty/agent_env.rs:
  1. `strict_agent_env_resets_a_generic_http_extra_header`: generic
     http.extraHeader in repo config reaches the server under inherit but not
     under strict.
  2. `strict_agent_env_url_scoped_extra_header_is_a_known_leak`: with a
     matching http.<url>.extraHeader section BOTH headers reach the server
     even under strict - a pinned known boundary (git urlmatch best-match
     layer drops the generic command-line reset; verified on git 2.55).
  3. `strict_agent_env_keeps_the_users_signing_mandate`: STRICT_GIT_CONFIG
     names no signing key; with commit.gpgsign=true and gpg.program=git a
     commit under strict fails loudly (signing attempted, no hang, no
     unsigned commit).
- Updates module doc comments accordingly (test-backed reset, pinned
  boundary, signing decision).
- One unrelated formatting normalization in skills.rs (pre-existing rustfmt
  drift from the public-release squash, blocked the precommit fmt gate).

## Rules to check against (excerpt from AGENTS.md)

- Evidence standard: claims need tests; test-only packages need red-first
  trailers (present in the commit messages).
- Tests must be deterministic and portable (Windows + Linux CI), must not
  hang, must not depend on machine state (proxies, user gitconfig, real
  credentials), and must never print or use real secrets.
- No new dependencies without an allowed license; no GPL-family code.
- The pinned-leak test asserts current (leaky) git behavior on purpose: it
  documents the boundary and must turn red if git changes. Judge whether the
  comments/doc make that unmistakable.
- Public repo: no personal data, no local paths, no secrets in code.

## Output format

Findings with: ID, severity (high/medium/low), file:line, explanation.
Then a verdict line: `freigeben` / `freigeben mit Auflagen` / `ablehnen`,
plus one sentence of rationale.

## Note on context

The diff below uses 40 lines of context so that module-level imports are visible.
Only the code files are included (docs/report files are omitted). A first reviewer
(GLM) already saw the candidate; do not assume its findings, check independently.

## Full diff of the code (origin/main...60f0f6a5cfa230216d3d67224138d7a119e7da0b)

```diff
diff --git a/src-tauri/src/pty/agent_env.rs b/src-tauri/src/pty/agent_env.rs
index 536b4e6..06376cc 100644
--- a/src-tauri/src/pty/agent_env.rs
+++ b/src-tauri/src/pty/agent_env.rs
@@ -1,71 +1,80 @@
 //! The environment an agent process starts with (W5-02b).
 //!
 //! Until W5-02b every PTY child inherited ProjectA's complete environment and
 //! the spawn only ever added variables. The profile's [`crate::profiles::EnvPolicy`] now picks
 //! one of three levels:
 //!
 //! * `inherit`: exactly that, unchanged. Opt-in only since W5-02b6.
 //! * `allowlist` (default since W5-02b6, and what every built-in names):
 //!   the child gets only [`ALLOWED`] names and [`ALLOWED_PREFIXES`]
 //!   families, and of those nothing that [`looks_secret`]; `SSH_AUTH_SOCK` is
 //!   not on the list. What the app and the profile set explicitly is added
 //!   on top, and so is every inherited name the profile lists under
 //!   `passthrough`. A name that is not UTF-8 is dropped, never guessed at.
 //! * `strict`: `allowlist`, then [`lock_credentials`]: `gh` looks at an empty
 //!   app-owned config directory, git has no credential helper, no askpass
-//!   program, no terminal prompt and no ssh transport. Commits in the
-//!   worker's own worktree keep working; a push or a `gh` call fails at once
-//!   instead of asking. Not the default: task texts tell workers to push
-//!   their own branches and open their own pull requests, and `strict`
-//!   would break that silently.
+//!   program, no terminal prompt, no ssh transport and no generic extra
+//!   headers from configuration files (`http.extraHeader=`, test-backed in
+//!   W5-02b5). Commits in the worker's own worktree keep working; a push or
+//!   a `gh` call fails at once instead of asking. Signing is deliberately
+//!   untouched (user decision, W5-02b review K6): a signing key is no push
+//!   right, and forcing `commit.gpgsign=false` would override a mandate of
+//!   the user's - a `commit.gpgsign=true` the worker inherits still invokes
+//!   gpg, whose pinentry can block the session; unsigned commits are
+//!   unaffected. Not the default: task texts tell workers to push their own
+//!   branches and open their own pull requests, and `strict` would break
+//!   that silently.
 //!
 //! # The boundary
 //!
 //! This stops *casual* access - an agent that runs `gh` or `git push` and
 //! finds the user's credentials. It does not stop a *deliberate* one: the
 //! agent runs as the same OS user, so it can still read
 //! `%APPDATA%\GitHub CLI`, `~/.ssh`, the Windows Credential Manager, or run
 //! `git -c credential.helper=manager push`. It only filters variable *names*;
 //! a secret inside an allowed value (a proxy URL with a password in it) goes
-//! through. The hard boundary is a separate OS user for agent processes
-//! (W5-02e).
+//! through. And the extra-header reset has a hole, test-pinned in W5-02b5:
+//! when a config file scopes the header to the remote's URL
+//! (`http.<url>.extraHeader`), git's urlmatch best-match layer drops the
+//! generic reset and both headers go out. The hard boundary is a separate
+//! OS user for agent processes (W5-02e).
 
 use std::path::{Path, PathBuf};
 
 use portable_pty::CommandBuilder;
 use tauri::{AppHandle, Manager};
 
 use crate::profiles::{AgentProfile, EnvIsolation};
 
 /// Inherited names an agent keeps, compared upper-case (Windows names are
 /// case-insensitive). Each group is here because something the provider CLIs
 /// or the tools they call cannot start without, or would behave differently
 /// without.
 const ALLOWED: &[&str] = &[
     // Windows: process start, crypto (Node needs SYSTEMROOT), shells, paths.
     "PATH",
     "PATHEXT",
     "SYSTEMROOT",
     "SYSTEMDRIVE",
     "WINDIR",
     "COMSPEC",
     "OS",
     "NUMBER_OF_PROCESSORS",
     "PROCESSOR_ARCHITECTURE",
     "PROCESSOR_IDENTIFIER",
     "PROCESSOR_LEVEL",
     "PROCESSOR_REVISION",
     "PROGRAMFILES",
     "PROGRAMFILES(X86)",
     "PROGRAMW6432",
     "COMMONPROGRAMFILES",
     "COMMONPROGRAMFILES(X86)",
     "COMMONPROGRAMW6432",
     "PROGRAMDATA",
     "ALLUSERSPROFILE",
     "PUBLIC",
     "COMPUTERNAME",
     "USERNAME",
     "USERDOMAIN",
     "USERDOMAIN_ROAMINGPROFILE",
     "LOGONSERVER",
@@ -137,83 +146,87 @@ const ALLOWED_PREFIXES: &[&str] = &[
     "COREPACK_",
     "VOLTA_",
     "NVM_",
     "FNM_",
     // Provider routing and config: base URLs, homes, models - the keys
     // among them fall to looks_secret.
     "ANTHROPIC_",
     "OPENAI_",
     "CODEX_",
     "KIMI_",
     "MOONSHOT_",
     "OPENCODE_",
     "OLLAMA_",
     // Shared memory and ProjectA's own wiring (`pa` inside the worker).
     "CLAUDE_FLOW_",
     "RUFLO_",
     "PROJECTA_",
 ];
 
 /// Removed under `strict` even when explicitly set or passed through: with
 /// any of these the credential lock below would not hold.
 const STRICT_REMOVED: &[&str] = &[
     "GH_TOKEN",
     "GITHUB_TOKEN",
     "GH_ENTERPRISE_TOKEN",
     "GITHUB_ENTERPRISE_TOKEN",
     "SSH_AUTH_SOCK",
     "SSH_ASKPASS",
     "GIT_SSH",
     "GIT_SSH_COMMAND",
     "GIT_CONFIG_PARAMETERS",
     "GIT_CONFIG_GLOBAL",
     "GIT_CONFIG_SYSTEM",
     "GIT_PROXY_COMMAND",
     "GIT_SSL_NO_VERIFY",
 ];
 
 /// Git configuration that wins over every file. An empty `credential.helper`
 /// empties the helper list, URL-scoped `credential.<url>.helper` included, so
 /// the Git Credential Manager is never asked; an empty `http.extraHeader`
-/// likewise drops an `AUTHORIZATION` header a checkout left in a config file.
+/// likewise drops an `AUTHORIZATION` header a checkout left in a config file -
+/// but only while no `http.<url>.extraHeader` in the file matches the remote:
+/// git's urlmatch best-match layer then drops this generic reset and both
+/// headers go out (test-pinned boundary, see the module doc).
 /// Set twice: `GIT_CONFIG_COUNT` (git >= 2.31) and `GIT_CONFIG_PARAMETERS`,
-/// which older git reads too.
+/// which older git reads too. No signing key is named here on purpose: a
+/// signing mandate is the user's (W5-02b review K6).
 const STRICT_GIT_CONFIG: &[(&str, &str)] = &[
     ("credential.helper", ""),
     ("http.extraHeader", ""),
     ("protocol.ssh.allow", "never"),
 ];
 
 /// Give `cmd` the environment `profile` is allowed to see: what it inherits
 /// from ProjectA under its isolation level, `TERM`, and `explicit` - the
 /// app's and the profile's own variables, which always win over inherited
 /// ones. `gh_config_dir` is only used under `strict`, which refuses to start
 /// without one.
 pub(crate) fn apply(
     cmd: &mut CommandBuilder,
     profile: &AgentProfile,
     explicit: &[(String, String)],
     gh_config_dir: Option<&Path>,
 ) -> Result<(), String> {
     let policy = &profile.env_policy;
     if policy.isolation != EnvIsolation::Inherit {
         // `CommandBuilder` starts from the app's environment (on Windows plus
         // the registry's), so it is emptied and refilled from what it held.
         // `iter_full_env_as_str` skips every name or value that is not
         // UTF-8, so such a variable is dropped, never guessed at.
         let inherited: Vec<(String, String)> = cmd
             .iter_full_env_as_str()
             .map(|(key, value)| (key.to_string(), value.to_string()))
             .collect();
         cmd.env_clear();
         for (key, value) in inherited {
             let upper = key.to_ascii_uppercase();
             let named = policy
                 .passthrough
                 .iter()
                 .any(|name| name.eq_ignore_ascii_case(&key));
             if named || (is_allowed(&upper) && !looks_secret(&upper)) {
                 cmd.env(key, value);
             }
         }
     }
     cmd.env("TERM", "xterm-256color");
@@ -730,41 +743,331 @@ mod tests {
             "strict: ssh transport ran: {stderr}"
         );
 
         // Local work is untouched: the worker can still commit.
         std::fs::write(repo.join("w5.txt"), "w5-02b\n").expect("write file");
         for args in [
             vec!["-C", repo_arg.as_str(), "add", "w5.txt"],
             vec![
                 "-C",
                 repo_arg.as_str(),
                 "commit",
                 "--no-gpg-sign",
                 "-m",
                 "w5-02b",
             ],
         ] {
             let (ok, _, stderr) = run("git", &args, &strict, "");
             assert!(ok, "strict: git {args:?} failed: {stderr}");
         }
     }
 
     #[test]
     fn strict_agent_env_leaves_gh_logged_out() {
         let probe = Command::new("gh").arg("--version").output();
         if !probe.is_ok_and(|output| output.status.success()) {
             eprintln!("gh fehlt auf dieser Maschine: plattformbedingt uebersprungen");
             return;
         }
         let gh = TempDir::new("w5-02b-gh");
         // Nothing planted: a planted GH_TOKEN would fail the check for the
         // wrong reason. What must not work is the user's own stored login.
         let strict = environment_with(&profile(EnvIsolation::Strict, &[]), gh.path(), &[]);
         let (ok, _, _) = run("gh", &["auth", "status"], &strict, "");
         // The output is never printed: with a real login it would name the
         // account and a masked token.
         assert!(
             !ok,
             "strict: gh auth status succeeded - the agent is logged in"
         );
     }
+
+    /// W5-02b5: a recording HTTP server on loopback for the `http.extraHeader`
+    /// tests. No crate: a `std` listener is enough - git sends its extra
+    /// headers with the first request already, so any response (here an
+    /// empty 200) ends the exchange after the headers were captured.
+    struct HeaderServer {
+        port: u16,
+        requests: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
+        stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
+        thread: Option<std::thread::JoinHandle<()>>,
+    }
+
+    impl HeaderServer {
+        fn start() -> Self {
+            use std::io::Read as _;
+            use std::sync::atomic::{AtomicBool, Ordering};
+            use std::sync::{Arc, Mutex};
+            use std::time::Duration;
+
+            let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind local server");
+            listener
+                .set_nonblocking(true)
+                .expect("nonblocking listener");
+            let port = listener.local_addr().expect("local address").port();
+            let stop = Arc::new(AtomicBool::new(false));
+            let requests: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
+            let thread = {
+                let stop = Arc::clone(&stop);
+                let requests = Arc::clone(&requests);
+                std::thread::spawn(move || {
+                    while !stop.load(Ordering::SeqCst) {
+                        let (mut stream, _) = match listener.accept() {
+                            Ok(accepted) => accepted,
+                            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
+                                std::thread::sleep(Duration::from_millis(10));
+                                continue;
+                            }
+                            Err(_) => break,
+                        };
+                        // Accepted sockets inherit the nonblocking mode on
+                        // Windows; the read below must wait, not spin.
+                        stream.set_nonblocking(false).expect("blocking stream");
+                        stream
+                            .set_read_timeout(Some(Duration::from_secs(5)))
+                            .expect("read timeout");
+                        // Request line and headers end at the first empty
+                        // line; a GET carries no body.
+                        let mut text = String::new();
+                        let mut chunk = [0u8; 4096];
+                        loop {
+                            match stream.read(&mut chunk) {
+                                Ok(0) => break,
+                                Ok(n) => {
+                                    text.push_str(&String::from_utf8_lossy(&chunk[..n]));
+                                    if text.contains("\r\n\r\n") {
+                                        break;
+                                    }
+                                }
+                                Err(_) => break,
+                            }
+                        }
+                        requests.lock().expect("requests").push(text);
+                        let _ = stream.write_all(
+                            b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
+                        );
+                    }
+                })
+            };
+            Self {
+                port,
+                requests,
+                stop,
+                thread: Some(thread),
+            }
+        }
+
+        /// Run `ls-remote` against this server in `repo` and return the
+        /// requests that arrived. git fails or reports an empty remote on
+        /// the empty response either way; what matters is which headers the
+        /// requests carried.
+        fn probe(&self, repo: &Path, env: &BTreeMap<String, String>) -> Vec<String> {
+            use std::time::{Duration, Instant};
+
+            let repo_arg = repo.to_string_lossy().into_owned();
+            let url = format!("http://127.0.0.1:{}/w5.git", self.port);
+            self.requests.lock().expect("requests").clear();
+            let _ = run("git", &["-C", &repo_arg, "ls-remote", &url], env, "");
+            let deadline = Instant::now() + Duration::from_secs(2);
+            loop {
+                let captured = self.requests.lock().expect("requests").clone();
+                if !captured.is_empty() || Instant::now() >= deadline {
+                    return captured;
+                }
+                std::thread::sleep(Duration::from_millis(20));
+            }
+        }
+    }
+
+    impl Drop for HeaderServer {
+        fn drop(&mut self) {
+            self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
+            if let Some(thread) = self.thread.take() {
+                let _ = thread.join();
+            }
+        }
+    }
+
+    /// Strip proxy variables so a loopback URL always reaches the local
+    /// listener, even on a machine behind a proxy.
+    fn without_proxy(env: &BTreeMap<String, String>) -> BTreeMap<String, String> {
+        let mut env = env.clone();
+        for name in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"] {
+            env.remove(name);
+        }
+        env.insert("NO_PROXY".to_string(), "127.0.0.1,localhost".to_string());
+        env
+    }
+
+    /// Set `key=value` in the repo's config; shared by the header tests.
+    fn git_config_set(repo: &Path, key: &str, value: &str) {
+        let repo_arg = repo.to_string_lossy().into_owned();
+        let (ok, _, stderr) = run(
+            "git",
+            &["-C", &repo_arg, "config", key, value],
+            &std::env::vars().collect(),
+            "",
+        );
+        assert!(ok, "git config {key}: {stderr}");
+    }
+
+    /// W5-02b5: the empty `http.extraHeader` in [`STRICT_GIT_CONFIG`] really
+    /// resets a generic `http.extraHeader` a config file carries - proven
+    /// against a local HTTP server that records what arrives (W5-02b review
+    /// round 2, K-B2/G-2: the reset was untested). git sees the reset
+    /// entries in the command-line scope after the file entries, and the
+    /// empty value clears the accumulated list (`http.c` `http_options`).
+    #[test]
+    fn strict_agent_env_resets_a_generic_http_extra_header() {
+        const MARK: &str = "w5-02b5-generic-not-a-real-token";
+
+        let server = HeaderServer::start();
+        let root = TempDir::new("w5-02b5-http");
+        let repo = init_repo(&root.path().join("repo"));
+        git_config_set(
+            &repo,
+            "http.extraHeader",
+            &format!("Authorization: Bearer {MARK}"),
+        );
+
+        let gh = TempDir::new("w5-02b5-gh");
+        let inherit = without_proxy(&environment(
+            &profile(EnvIsolation::Inherit, &[]),
+            gh.path(),
+        ));
+        let strict = without_proxy(&environment(&profile(EnvIsolation::Strict, &[]), gh.path()));
+
+        let seen = server.probe(&repo, &inherit);
+        assert!(
+            seen.iter().any(|request| request.contains(MARK)),
+            "inherit: the configured extraHeader did not reach the server"
+        );
+
+        let seen = server.probe(&repo, &strict);
+        assert!(
+            !seen.is_empty(),
+            "strict: git never reached the local server"
+        );
+        assert!(
+            !seen.iter().any(|request| request.contains(MARK)),
+            "strict: a configured extraHeader reached the server"
+        );
+    }
+
+    /// W5-02b5 KNOWN BOUNDARY, pinned: when the config also carries a
+    /// `http.<url>.extraHeader` whose URL matches the remote, the reset no
+    /// longer holds - under `strict` BOTH the scoped and the generic header
+    /// reach the server (observed on git 2.55). Mechanism, from git's
+    /// `urlmatch.c` `urlmatch_config_entry`: per key only the best URL match
+    /// is kept (`string_list_insert` + `cmp_matches`), and the generic
+    /// command-line reset counts as the worse match than the file's scoped
+    /// entry, so it is dropped before `http.c` ever sees it. There is no
+    /// environment-level fix - the URL is part of the config key - so this
+    /// stays open until agents get their own OS user (W5-02e). If a git
+    /// upgrade turns this test red, re-check the boundary note in the module
+    /// doc: a fixed git lets the reset win again.
+    #[test]
+    fn strict_agent_env_url_scoped_extra_header_is_a_known_leak() {
+        const GENERIC_MARK: &str = "w5-02b5-generic-not-a-real-token";
+        const SCOPED_MARK: &str = "w5-02b5-scoped-not-a-real-token";
+
+        let server = HeaderServer::start();
+        let root = TempDir::new("w5-02b5-http-scoped");
+        let repo = init_repo(&root.path().join("repo"));
+        git_config_set(
+            &repo,
+            "http.extraHeader",
+            &format!("Authorization: Bearer {GENERIC_MARK}"),
+        );
+        git_config_set(
+            &repo,
+            &format!("http.http://127.0.0.1:{}.extraHeader", server.port),
+            &format!("X-W5-02b5: {SCOPED_MARK}"),
+        );
+
+        let gh = TempDir::new("w5-02b5-gh");
+        let inherit = without_proxy(&environment(
+            &profile(EnvIsolation::Inherit, &[]),
+            gh.path(),
+        ));
+        let strict = without_proxy(&environment(&profile(EnvIsolation::Strict, &[]), gh.path()));
+
+        let seen = server.probe(&repo, &inherit);
+        for mark in [GENERIC_MARK, SCOPED_MARK] {
+            assert!(
+                seen.iter().any(|request| request.contains(mark)),
+                "inherit: a configured extraHeader did not reach the server: {mark}"
+            );
+        }
+
+        // The pinned boundary: the scoped entry defeats the reset, and the
+        // generic header goes out with it.
+        let seen = server.probe(&repo, &strict);
+        assert!(
+            !seen.is_empty(),
+            "strict: git never reached the local server"
+        );
+        for mark in [GENERIC_MARK, SCOPED_MARK] {
+            assert!(
+                seen.iter().any(|request| request.contains(mark)),
+                "boundary changed: under strict {mark} no longer reaches the server - \
+                 see the comment above and the module doc"
+            );
+        }
+    }
+
+    /// W5-02b5: the user decision from the W5-02b review (K6) - a signing
+    /// key is no push or write right, so `strict` does not touch the signing
+    /// configuration; forcing `commit.gpgsign=false` would override a
+    /// signing mandate of the user's. Pinned here: no strict config key
+    /// names signing, and a configured mandate is still honored - a commit
+    /// whose signer fails fails loudly instead of hanging or landing
+    /// unsigned. `git` itself serves as the stand-in signer: it is
+    /// guaranteed present (this test just ran it) and rejects the gpg
+    /// arguments at once, on every platform, without a pinentry.
+    #[test]
+    fn strict_agent_env_keeps_the_users_signing_mandate() {
+        for (key, _) in STRICT_GIT_CONFIG {
+            assert!(
+                !key.contains("gpg") && !key.contains("sign"),
+                "strict touches the signing configuration: {key}"
+            );
+        }
+
+        let root = TempDir::new("w5-02b5-gpg");
+        let repo = init_repo(&root.path().join("repo"));
+        git_config_set(&repo, "commit.gpgsign", "true");
+        git_config_set(&repo, "user.signingkey", "w5-02b5");
+        git_config_set(&repo, "gpg.program", "git");
+
+        let gh = TempDir::new("w5-02b5-gh");
+        let strict = environment(&profile(EnvIsolation::Strict, &[]), gh.path());
+        let repo_arg = repo.to_string_lossy().into_owned();
+        let head = || {
+            let (ok, stdout, stderr) =
+                run("git", &["-C", &repo_arg, "rev-parse", "HEAD"], &strict, "");
+            assert!(ok, "rev-parse HEAD: {stderr}");
+            stdout.trim().to_string()
+        };
+        std::fs::write(repo.join("w5.txt"), "w5-02b5\n").expect("write file");
+        let (ok, _, stderr) = run("git", &["-C", &repo_arg, "add", "w5.txt"], &strict, "");
+        assert!(ok, "strict: git add failed: {stderr}");
+
+        let before = head();
+        let (ok, _, stderr) = run(
+            "git",
+            &["-C", &repo_arg, "commit", "-m", "w5-02b5"],
+            &strict,
+            "",
+        );
+        assert!(
+            !ok,
+            "strict: a commit signed by a stand-in gpg succeeded - the mandate was dropped"
+        );
+        let lower = stderr.to_lowercase();
+        assert!(
+            lower.contains("gpg") || lower.contains("sign"),
+            "strict: the commit failed for an unrelated reason: {stderr}"
+        );
+        assert_eq!(before, head(), "strict: the failed signing left a commit");
+    }
 }
```
