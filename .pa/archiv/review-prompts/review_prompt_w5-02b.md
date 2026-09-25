# Review-Auftrag W5-02b: Allowlist-Umgebung fuer Agenten (ProjectA, Tauri 2, Rust)

Du bist ein unabhaengiger Sicherheits-Reviewer. Pruefe den folgenden Diff gegen den Auftrag. Nenne Befunde mit Schwere (hoch/mittel/niedrig), Datei/Zeile und konkretem Fix. Sage ausdruecklich, wenn du etwas NICHT pruefen konntest. Kein Lob, nur Befunde und ein Gesamturteil (freigeben / freigeben mit Auflagen / nicht freigeben).

## Auftrag
- Heute erben PTY-Kinder (Coding-Agenten: claude, codex, kimi, opencode, ollama) die volle Umgebung der App; der Spawn fuegt nur Variablen hinzu. gh und der Git Credential Manager erreichen die Nutzer-Credentials auch ohne Umgebungsvariable.
- Ziel: Allowlist statt Denylist; Token/Key/Secret-Variablen und SSH_AUTH_SOCK entfernt; GH_CONFIG_DIR auf leeres app-eigenes Verzeichnis; Git-Credential-Helper aus, GIT_TERMINAL_PROMPT=0; lokale Commits im Worktree muessen weiter gehen.
- Rueckwaertskompatibilitaet: Aufgabentexte weisen Worker heute an, selbst zu pushen und PRs zu oeffnen (die App selbst pusht in gh.rs::create_pr aus dem App-Prozess, nicht aus dem PTY). Deshalb liegt die Filterung hinter einer Profil-Option env_policy {isolation: inherit|allowlist|strict, passthrough: [...]} mit Voreinstellung inherit (unveraendert). allowlist laesst den Push ueber GCM weiter zu, strict nicht.
- Grenze: verhindert beilaeufigen Zugriff, nicht gezielten Zugriff eines Prozesses unter demselben OS-Benutzer (Folgepaket W5-02e).
- Rote Abnahme: gh auth status und git push scheitern ohne Rueckfrage; eingeschleustes Write-Token erreicht den Worker nicht; SSH_AUTH_SOCK, *_TOKEN, *_KEY, *_SECRET fehlen; die Anbieter-CLI startet trotzdem.
- Nicht beruehrt werden duerfen main.rs, api.rs, bin/pa.rs, store.rs (Nahtstellen); pty.rs ist keine Nahtstelle.

## Belege des Autors (lokal, Windows 11, git 2.55, gh 2.97)
- Vier Test-First-Tests rot vor dem Fix (GH_TOKEN erreichte das Kind; ein Credential-Helper antwortete; gh auth status war eingeloggt), gruen danach; Windows-PTY-Test (Kind gibt `set` aus) gruen.
- Manueller Lauf (ignored test): claude 2.1.280, kimi 2.0.0, codex-cli 0.154.0, opencode 1.18.32, ollama 0.34.3 starten mit --version unter strict; `git push --dry-run origin` gelingt unter allowlist, scheitert unter strict mit "could not read Username ... terminal prompts disabled".

## Fragen, die du besonders pruefen sollst
1. Umgehungen des strict-Modus ohne gezielte Absicht (z. B. GIT_CONFIG_*-Reihenfolge, URL-spezifische credential.<url>.helper, askpass, insteadOf nach ssh, gh-Token aus Keyring).
2. Fehlt in der Allowlist etwas, das eine der CLIs zum Start braucht, oder ist etwas zu breit (Praefixe)?
3. Ist die Voreinstellung inherit ehrlich begruendet?
4. Fehlerpfade (hosts.yml nicht loeschbar, nicht-UTF-8-Namen).

## Vollstaendiger Diff (origin/main..HEAD)
```diff
diff --git a/src-tauri/src/hooks.rs b/src-tauri/src/hooks.rs
index da10511..e989451 100644
--- a/src-tauri/src/hooks.rs
+++ b/src-tauri/src/hooks.rs
@@ -1463,6 +1463,7 @@ mod tests {
             env: Default::default(),
             fallback: None,
             enabled: true,
+            env_policy: Default::default(),
         };
         let wired = with_hook_settings(&profile, "wk-cap-1", 4711);
         assert_eq!(wired.args[0], "--settings");
@@ -1485,6 +1486,7 @@ mod tests {
             env: Default::default(),
             fallback: None,
             enabled: true,
+            env_policy: Default::default(),
         };
         let with = with_hook_settings(&profile, "wk-cap-2", 4711);
         assert_eq!(
@@ -1535,6 +1537,7 @@ mod tests {
             env: Default::default(),
             fallback: None,
             enabled: true,
+            env_policy: Default::default(),
         };
         let other = AgentProfile {
             id: "kimi".into(),
@@ -1545,6 +1548,7 @@ mod tests {
             env: Default::default(),
             fallback: None,
             enabled: true,
+            env_policy: Default::default(),
         };
 
         let wired = with_hook_settings(&claude, "wk-8", 51234);
diff --git a/src-tauri/src/profiles.rs b/src-tauri/src/profiles.rs
index 18f1065..7bf2d36 100644
--- a/src-tauri/src/profiles.rs
+++ b/src-tauri/src/profiles.rs
@@ -47,6 +47,40 @@ pub struct AgentProfile {
     /// enabled.
     #[serde(default = "default_enabled")]
     pub enabled: bool,
+    /// Which part of ProjectA's own environment a spawn of this profile gets
+    /// (W5-02b); see [`crate::pty::agent_env`] for what each level does.
+    #[serde(default, alias = "envPolicy")]
+    pub env_policy: EnvPolicy,
+}
+
+/// How much of the app's environment reaches an agent process (W5-02b).
+#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
+pub struct EnvPolicy {
+    #[serde(default)]
+    pub isolation: EnvIsolation,
+    /// Inherited variables this profile needs although the allowlist or the
+    /// secret filter would drop them - e.g. `MOONSHOT_API_KEY` for a Kimi
+    /// that authenticates through the environment. Named here, the value
+    /// still comes from the app's environment and never from a file.
+    #[serde(default)]
+    pub passthrough: Vec<String>,
+}
+
+/// The three isolation levels. The default is `inherit` because workers push
+/// their own branches today; see `.pa/report_w5-02b.md`.
+#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
+#[serde(rename_all = "lowercase")]
+pub enum EnvIsolation {
+    /// The full app environment, exactly as before W5-02b.
+    #[default]
+    Inherit,
+    /// Only allowlisted variables, secrets and `SSH_AUTH_SOCK` removed. Git
+    /// and `gh` still find the user's stored credentials.
+    Allowlist,
+    /// `allowlist`, plus `gh` pointed at an empty config and git's
+    /// credential helpers, prompts and ssh transport switched off. Local
+    /// commits keep working; pushes and `gh` calls fail without asking.
+    Strict,
 }
 
 /// A profile nobody has switched off is on.
@@ -68,6 +102,7 @@ impl AgentProfile {
             env: BTreeMap::new(),
             fallback: None,
             enabled: true,
+            env_policy: EnvPolicy::default(),
         }
     }
 }
@@ -88,6 +123,8 @@ struct ProfileOverride {
     env: BTreeMap<String, String>,
     #[serde(default)]
     fallback: Option<String>,
+    #[serde(default, alias = "envPolicy")]
+    env_policy: EnvPolicy,
 }
 
 /// `agents.json` may be either a bare array of profiles or `{ "profiles": [...] }`.
@@ -278,6 +315,7 @@ fn merge_profiles(
             env: profile_override.env,
             fallback: profile_override.fallback,
             enabled: true,
+            env_policy: profile_override.env_policy,
         };
         match profiles
             .iter_mut()
@@ -547,6 +585,21 @@ mod tests {
         );
     }
 
+    #[test]
+    fn env_policy_defaults_to_inherit_and_is_read_from_agents_json() {
+        assert!(default_profiles()
+            .iter()
+            .all(|p| p.env_policy == EnvPolicy::default()));
+        let raw = r#"[{ "id": "kimi", "name": "Kimi", "command": "kimi",
+                        "envPolicy": { "isolation": "strict",
+                                       "passthrough": ["MOONSHOT_API_KEY"] } }]"#;
+        let overrides: ProfilesFile = serde_json::from_str(raw).expect("parse");
+        let merged = merge_profiles(default_profiles(), overrides.into_vec());
+        let kimi = merged.iter().find(|p| p.id == "kimi").expect("kimi");
+        assert_eq!(kimi.env_policy.isolation, EnvIsolation::Strict);
+        assert_eq!(kimi.env_policy.passthrough, vec!["MOONSHOT_API_KEY"]);
+    }
+
     #[test]
     fn override_without_caps_inherits_same_id_defaults() {
         let raw = r#"[{ "id": "claude", "name": "My Claude", "command": "claude-canary" }]"#;
diff --git a/src-tauri/src/pty.rs b/src-tauri/src/pty.rs
index 9b73d34..2dec6d0 100644
--- a/src-tauri/src/pty.rs
+++ b/src-tauri/src/pty.rs
@@ -475,6 +475,9 @@ impl SessionTrace {
     }
 }
 
+#[path = "pty/agent_env.rs"]
+pub(crate) mod agent_env;
+
 #[cfg(test)]
 #[path = "pty/native_tests.rs"]
 mod native_tests;
@@ -810,10 +813,7 @@ impl PtyManager {
                 cmd.cwd(dir);
             }
         }
-        cmd.env("TERM", "xterm-256color");
-        for (key, value) in env {
-            cmd.env(key, value);
-        }
+        agent_env::apply(&mut cmd, profile, env, &agent_env::gh_config_dir(app))?;
 
         let mut child = pair
             .slave
@@ -3567,6 +3567,11 @@ mod tests {
 
     #[cfg(all(test, windows))]
     fn run_in_pty_with_ack(profile: &AgentProfile, expected: Option<&str>) -> String {
+        run_command_in_pty(build_command(profile), expected)
+    }
+
+    #[cfg(all(test, windows))]
+    fn run_command_in_pty(command: CommandBuilder, expected: Option<&str>) -> String {
         use std::sync::mpsc::{self, RecvTimeoutError};
         use std::time::{Duration, Instant};
 
@@ -3578,10 +3583,7 @@ mod tests {
                 pixel_height: 0,
             })
             .expect("openpty");
-        let mut child = pair
-            .slave
-            .spawn_command(build_command(profile))
-            .expect("spawn");
+        let mut child = pair.slave.spawn_command(command).expect("spawn");
         drop(pair.slave);
 
         let mut reader = pair.master.try_clone_reader().expect("reader");
@@ -3661,6 +3663,140 @@ mod tests {
         String::from_utf8_lossy(&out).into_owned()
     }
 
+    /// W5-02b manual run against the real machine: every built-in provider
+    /// CLI that is installed still starts under `strict`, and a real push to
+    /// this repository's `origin` fails without asking. Ignored because it
+    /// needs the installed CLIs and the user's real credentials; it prints
+    /// only versions and git's refusal, never a credential.
+    /// `cargo test --bin projecta -- --ignored manual_strict_env_ -- --nocapture`
+    #[cfg(windows)]
+    #[test]
+    #[ignore]
+    fn manual_strict_env_starts_provider_clis_and_blocks_a_real_push() {
+        let strict = crate::profiles::EnvPolicy {
+            isolation: crate::profiles::EnvIsolation::Strict,
+            passthrough: Vec::new(),
+        };
+        let gh = crate::testutil::TempDir::new("w5-02b-manual");
+        for base in crate::profiles::default_profiles() {
+            if resolve_windows_program(&base.command).is_none() {
+                eprintln!("{}: not installed, skipped", base.id);
+                continue;
+            }
+            let profile = AgentProfile {
+                args: vec!["--version".into()],
+                env_policy: strict.clone(),
+                ..base
+            };
+            let mut cmd = build_command(&profile);
+            agent_env::apply(&mut cmd, &profile, &[], gh.path()).expect("apply");
+            let out = crate::status::strip_ansi(&run_command_in_pty(cmd, None));
+            let version = out
+                .lines()
+                .map(|line| line.trim_matches(|c: char| c.is_control() || c == ' '))
+                .rfind(|line| line.chars().any(|c| c.is_ascii_digit()) && line.contains('.'))
+                .unwrap_or("");
+            eprintln!(
+                "{}: {:?}",
+                profile.id,
+                version.chars().take(80).collect::<String>()
+            );
+            assert!(
+                !version.is_empty(),
+                "{} did not start under strict",
+                profile.id
+            );
+        }
+
+        // allowlist keeps today's push path (GCM via the credential store);
+        // strict must refuse it. --dry-run: nothing is ever written.
+        for (isolation, may_push) in [
+            (crate::profiles::EnvIsolation::Allowlist, true),
+            (crate::profiles::EnvIsolation::Strict, false),
+        ] {
+            let profile = AgentProfile {
+                command: "git".into(),
+                env_policy: crate::profiles::EnvPolicy {
+                    isolation,
+                    passthrough: Vec::new(),
+                },
+                ..crate::profiles::default_profiles().remove(0)
+            };
+            let mut cmd = build_command(&profile);
+            agent_env::apply(&mut cmd, &profile, &[], gh.path()).expect("apply");
+            let env: Vec<(String, String)> = cmd
+                .iter_full_env_as_str()
+                .map(|(k, v)| (k.to_string(), v.to_string()))
+                .collect();
+            let output = std::process::Command::new("git")
+                // The probe must not start this repository's pre-push gate lane.
+                .arg("-c")
+                .arg(format!("core.hooksPath={}", gh.path().display()))
+                .args(["-C", env!("CARGO_MANIFEST_DIR"), "push", "--dry-run"])
+                .args(["origin", "HEAD:refs/heads/w5-02b-probe-never-created"])
+                .env_clear()
+                .envs(env)
+                .stdin(std::process::Stdio::null())
+                .output()
+                .expect("git push");
+            let stderr = String::from_utf8_lossy(&output.stderr);
+            eprintln!(
+                "{isolation:?} git push --dry-run: success={} stderr={}",
+                output.status.success(),
+                stderr.trim()
+            );
+            assert_eq!(output.status.success(), may_push, "{isolation:?}");
+        }
+    }
+
+    /// W5-02b end to end: the PTY child itself prints what it inherited.
+    #[cfg(windows)]
+    #[test]
+    fn pty_child_sees_only_the_allowlisted_environment() {
+        const SENTINEL: &str = "w5-02b-sentinel-not-a-real-token";
+        let profile = AgentProfile {
+            id: "test".into(),
+            name: "test".into(),
+            command: "cmd".into(),
+            args: vec!["/C".into(), "set".into()],
+            caps: Default::default(),
+            env: Default::default(),
+            fallback: None,
+            enabled: true,
+            env_policy: crate::profiles::EnvPolicy {
+                isolation: crate::profiles::EnvIsolation::Allowlist,
+                passthrough: Vec::new(),
+            },
+        };
+        let mut cmd = build_command(&profile);
+        // What ProjectA's own environment could carry.
+        for name in [
+            "GH_TOKEN",
+            "GITHUB_TOKEN",
+            "OPENAI_API_KEY",
+            "SSH_AUTH_SOCK",
+        ] {
+            cmd.env(name, SENTINEL);
+        }
+        let gh = crate::testutil::TempDir::new("w5-02b-pty");
+        agent_env::apply(&mut cmd, &profile, &[], gh.path()).expect("apply");
+        let out = run_command_in_pty(cmd, None).to_ascii_uppercase();
+        assert!(out.contains("PATH="), "the child printed no PATH");
+        assert!(out.contains("SYSTEMROOT="), "the child lost SystemRoot");
+        assert!(
+            !out.contains(&SENTINEL.to_ascii_uppercase()),
+            "a planted secret reached the PTY child"
+        );
+        for name in [
+            "GH_TOKEN=",
+            "GITHUB_TOKEN=",
+            "OPENAI_API_KEY=",
+            "SSH_AUTH_SOCK=",
+        ] {
+            assert!(!out.contains(name), "{name} reached the PTY child");
+        }
+    }
+
     #[cfg(windows)]
     #[test]
     fn spawns_a_path_resolved_exe_in_a_pty() {
@@ -3673,6 +3809,7 @@ mod tests {
             env: Default::default(),
             fallback: None,
             enabled: true,
+            env_policy: Default::default(),
         };
         assert!(run_in_pty(&profile).contains("projecta-pty-ok"));
     }
@@ -3828,6 +3965,7 @@ mod tests {
             env: Default::default(),
             fallback: None,
             enabled: true,
+            env_policy: Default::default(),
         };
         let argv: Vec<String> = build_command(&profile)
             .get_argv()
@@ -3923,6 +4061,7 @@ mod tests {
             env: Default::default(),
             fallback: None,
             enabled: true,
+            env_policy: Default::default(),
         };
         let expected = format!("ARGV<--append-system-prompt|{text}>");
         let out = run_in_pty_with_ack(&profile, Some(&expected));
@@ -3982,6 +4121,7 @@ mod tests {
             env: Default::default(),
             fallback: None,
             enabled: true,
+            env_policy: Default::default(),
         };
         let out = run_in_pty(&profile);
         let _ = std::fs::remove_file(&shim);
diff --git a/src-tauri/src/pty/agent_env.rs b/src-tauri/src/pty/agent_env.rs
new file mode 100644
index 0000000..7fdf908
--- /dev/null
+++ b/src-tauri/src/pty/agent_env.rs
@@ -0,0 +1,576 @@
+//! The environment an agent process starts with (W5-02b).
+//!
+//! Until W5-02b every PTY child inherited ProjectA's complete environment and
+//! the spawn only ever added variables. The profile's [`crate::profiles::EnvPolicy`] now picks
+//! one of three levels:
+//!
+//! * `inherit` (default): exactly that, unchanged. It stays the default
+//!   because task texts tell workers to push their own branches and open
+//!   their own pull requests, and `strict` would break that silently.
+//! * `allowlist`: the child gets only [`ALLOWED`] names and [`ALLOWED_PREFIXES`]
+//!   families, and of those nothing that [`looks_secret`]; `SSH_AUTH_SOCK` is
+//!   not on the list. What the app and the profile set explicitly is added
+//!   on top, and so is every inherited name the profile lists under
+//!   `passthrough`. A name that is not UTF-8 is dropped, never guessed at.
+//! * `strict`: `allowlist`, then [`lock_credentials`]: `gh` looks at an empty
+//!   app-owned config directory, git has no credential helper, no askpass
+//!   program, no terminal prompt and no ssh transport. Commits in the
+//!   worker's own worktree keep working; a push or a `gh` call fails at once
+//!   instead of asking.
+//!
+//! # The boundary
+//!
+//! This stops *casual* access - an agent that runs `gh` or `git push` and
+//! finds the user's credentials. It does not stop a *deliberate* one: the
+//! agent runs as the same OS user, so it can still read
+//! `%APPDATA%\GitHub CLI`, `~/.ssh`, the Windows Credential Manager, or run
+//! `git -c credential.helper=manager push`. It only filters variable *names*;
+//! a secret inside an allowed value (a proxy URL with a password in it) goes
+//! through. The hard boundary is a separate OS user for agent processes
+//! (W5-02e).
+
+use std::path::{Path, PathBuf};
+
+use portable_pty::CommandBuilder;
+use tauri::{AppHandle, Manager};
+
+use crate::profiles::{AgentProfile, EnvIsolation};
+
+/// Inherited names an agent keeps, compared upper-case (Windows names are
+/// case-insensitive). Each group is here because something the provider CLIs
+/// or the tools they call cannot start without, or would behave differently
+/// without.
+const ALLOWED: &[&str] = &[
+    // Windows: process start, crypto (Node needs SYSTEMROOT), shells, paths.
+    "PATH",
+    "PATHEXT",
+    "SYSTEMROOT",
+    "SYSTEMDRIVE",
+    "WINDIR",
+    "COMSPEC",
+    "OS",
+    "NUMBER_OF_PROCESSORS",
+    "PROCESSOR_ARCHITECTURE",
+    "PROCESSOR_IDENTIFIER",
+    "PROCESSOR_LEVEL",
+    "PROCESSOR_REVISION",
+    "PROGRAMFILES",
+    "PROGRAMFILES(X86)",
+    "PROGRAMW6432",
+    "COMMONPROGRAMFILES",
+    "COMMONPROGRAMFILES(X86)",
+    "COMMONPROGRAMW6432",
+    "PROGRAMDATA",
+    "ALLUSERSPROFILE",
+    "PUBLIC",
+    "COMPUTERNAME",
+    "USERNAME",
+    "USERDOMAIN",
+    "USERDOMAIN_ROAMINGPROFILE",
+    "LOGONSERVER",
+    "PSMODULEPATH",
+    // Home and temp: where every CLI finds its own login and config
+    // (~/.claude, ~/.codex, ~/.kimi, opencode's data dir, ~/.gitconfig).
+    "HOME",
+    "USERPROFILE",
+    "HOMEDRIVE",
+    "HOMEPATH",
+    "APPDATA",
+    "LOCALAPPDATA",
+    "TEMP",
+    "TMP",
+    "TMPDIR",
+    // Unix session and locale.
+    "USER",
+    "LOGNAME",
+    "SHELL",
+    "LANG",
+    "LANGUAGE",
+    "TZ",
+    // Terminal.
+    "COLORTERM",
+    "FORCE_COLOR",
+    "NO_COLOR",
+    // Commits: identity and editor.
+    "GIT_AUTHOR_NAME",
+    "GIT_AUTHOR_EMAIL",
+    "GIT_COMMITTER_NAME",
+    "GIT_COMMITTER_EMAIL",
+    "EDITOR",
+    "VISUAL",
+    "GIT_EDITOR",
+    // Network behind a proxy or a private CA.
+    "HTTP_PROXY",
+    "HTTPS_PROXY",
+    "NO_PROXY",
+    "ALL_PROXY",
+    "SSL_CERT_FILE",
+    "SSL_CERT_DIR",
+    "REQUESTS_CA_BUNDLE",
+    "CURL_CA_BUNDLE",
+    // Node and Python runtimes the npm/uv shims start.
+    "BUN_INSTALL",
+    "PYTHONUTF8",
+    "PYTHONIOENCODING",
+    // Provider CLIs: Claude Code's git-bash and config location, timeouts.
+    "CLAUDE_CODE_GIT_BASH_PATH",
+    "CLAUDE_CONFIG_DIR",
+    "API_TIMEOUT_MS",
+    "MCP_TIMEOUT",
+    "MCP_TOOL_TIMEOUT",
+    "DISABLE_AUTOUPDATER",
+];
+
+/// Inherited families an agent keeps, minus whatever [`looks_secret`].
+const ALLOWED_PREFIXES: &[&str] = &[
+    "LC_",
+    "XDG_",
+    // Build toolchains the gates in a worktree run (cargo, sccache, node).
+    "CARGO_",
+    "RUSTUP_",
+    "RUSTC_",
+    "RUST_",
+    "SCCACHE_",
+    "NODE_",
+    "NPM_CONFIG_",
+    "COREPACK_",
+    "VOLTA_",
+    "NVM_",
+    "FNM_",
+    // Provider routing and config: base URLs, homes, models - the keys
+    // among them fall to looks_secret.
+    "ANTHROPIC_",
+    "OPENAI_",
+    "CODEX_",
+    "KIMI_",
+    "MOONSHOT_",
+    "OPENCODE_",
+    "OLLAMA_",
+    // Shared memory and ProjectA's own wiring (`pa` inside the worker).
+    "CLAUDE_FLOW_",
+    "RUFLO_",
+    "PROJECTA_",
+];
+
+/// Removed under `strict` even when explicitly set or passed through: with
+/// any of these the credential lock below would not hold.
+const STRICT_REMOVED: &[&str] = &[
+    "GH_TOKEN",
+    "GITHUB_TOKEN",
+    "GH_ENTERPRISE_TOKEN",
+    "GITHUB_ENTERPRISE_TOKEN",
+    "SSH_AUTH_SOCK",
+    "SSH_ASKPASS",
+    "GIT_SSH",
+    "GIT_SSH_COMMAND",
+    "GIT_CONFIG_PARAMETERS",
+    "GIT_CONFIG_GLOBAL",
+    "GIT_CONFIG_SYSTEM",
+];
+
+/// Git configuration that wins over every file (`GIT_CONFIG_COUNT`, git ≥ 2.31).
+/// An empty `credential.helper` empties the helper list, URL-scoped helpers
+/// included, so the Git Credential Manager is never asked.
+const STRICT_GIT_CONFIG: &[(&str, &str)] =
+    &[("credential.helper", ""), ("protocol.ssh.allow", "never")];
+
+/// Give `cmd` the environment `profile` is allowed to see: what it inherits
+/// from ProjectA under its isolation level, `TERM`, and `explicit` - the
+/// app's and the profile's own variables, which always win over inherited
+/// ones. `gh_config_dir` is only touched under `strict`.
+pub(crate) fn apply(
+    cmd: &mut CommandBuilder,
+    profile: &AgentProfile,
+    explicit: &[(String, String)],
+    gh_config_dir: &Path,
+) -> Result<(), String> {
+    let policy = &profile.env_policy;
+    if policy.isolation != EnvIsolation::Inherit {
+        // `CommandBuilder` starts from the app's environment (on Windows plus
+        // the registry's), so it is emptied and refilled from what it held.
+        let inherited: Vec<(String, String)> = cmd
+            .iter_full_env_as_str()
+            .map(|(key, value)| (key.to_string(), value.to_string()))
+            .collect();
+        cmd.env_clear();
+        for (key, value) in inherited {
+            let upper = key.to_ascii_uppercase();
+            let named = policy
+                .passthrough
+                .iter()
+                .any(|name| name.eq_ignore_ascii_case(&key));
+            if named || (is_allowed(&upper) && !looks_secret(&upper)) {
+                cmd.env(key, value);
+            }
+        }
+    }
+    cmd.env("TERM", "xterm-256color");
+    for (key, value) in explicit {
+        cmd.env(key, value);
+    }
+    if policy.isolation == EnvIsolation::Strict {
+        lock_credentials(cmd, gh_config_dir)?;
+    }
+    Ok(())
+}
+
+fn is_allowed(upper: &str) -> bool {
+    ALLOWED.contains(&upper) || ALLOWED_PREFIXES.iter().any(|p| upper.starts_with(p))
+}
+
+/// Whether a name looks like it holds a credential. Deliberately broad: a
+/// false positive costs a `passthrough` entry, a false negative a leak.
+fn looks_secret(upper: &str) -> bool {
+    [
+        "TOKEN",
+        "SECRET",
+        "PASSWORD",
+        "PASSWD",
+        "PASSPHRASE",
+        "CREDENTIAL",
+        "KEY",
+        "COOKIE",
+        "PRIVATE",
+    ]
+    .iter()
+    .any(|marker| upper.contains(marker))
+}
+
+/// The `strict` part: no route from the agent to the user's GitHub or git
+/// credentials that works without a deliberate detour.
+fn lock_credentials(cmd: &mut CommandBuilder, gh_config_dir: &Path) -> Result<(), String> {
+    for name in STRICT_REMOVED {
+        cmd.env_remove(name);
+    }
+    // An earlier agent may have logged in there; the next one starts out
+    // logged out. The directory itself need not exist - gh reads a missing
+    // one as empty.
+    let hosts = gh_config_dir.join("hosts.yml");
+    match std::fs::remove_file(&hosts) {
+        Ok(()) => {}
+        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
+        Err(error) => {
+            return Err(format!(
+                "refusing to start the agent: cannot clear {}: {error}",
+                hosts.display()
+            ))
+        }
+    }
+    cmd.env("GH_CONFIG_DIR", gh_config_dir);
+    cmd.env("GH_PROMPT_DISABLED", "1");
+    cmd.env("GIT_TERMINAL_PROMPT", "0");
+    // Empty, not absent: git skips `core.askPass` and `SSH_ASKPASS` only
+    // when this is set.
+    cmd.env("GIT_ASKPASS", "");
+    cmd.env("GCM_INTERACTIVE", "never");
+    cmd.env("GIT_CONFIG_COUNT", STRICT_GIT_CONFIG.len().to_string());
+    for (index, (key, value)) in STRICT_GIT_CONFIG.iter().enumerate() {
+        cmd.env(format!("GIT_CONFIG_KEY_{index}"), key);
+        cmd.env(format!("GIT_CONFIG_VALUE_{index}"), value);
+    }
+    Ok(())
+}
+
+/// The app-owned directory `gh` is pointed at under `strict`.
+pub(crate) fn gh_config_dir(app: &AppHandle) -> PathBuf {
+    app.path()
+        .app_local_data_dir()
+        .unwrap_or_else(|_| std::env::temp_dir().join("projecta"))
+        .join("agent-gh-config")
+}
+
+#[cfg(test)]
+mod tests {
+    use std::collections::BTreeMap;
+    use std::io::Write as _;
+    use std::process::{Command, Stdio};
+
+    use super::*;
+    use crate::profiles::{EnvIsolation, EnvPolicy};
+    use crate::testutil::{init_repo, TempDir};
+
+    /// Stand-in for a credential. Only this string is ever planted, so no
+    /// assertion message can print a real token.
+    const SENTINEL: &str = "w5-02b-sentinel-not-a-real-token";
+
+    /// What ProjectA's own environment may carry and no agent may inherit.
+    const PLANTED: &[&str] = &[
+        "GH_TOKEN",
+        "GITHUB_TOKEN",
+        "GH_ENTERPRISE_TOKEN",
+        "NPM_TOKEN",
+        "ANTHROPIC_AUTH_TOKEN",
+        "OPENAI_API_KEY",
+        "DEPLOY_KEY",
+        "AWS_SECRET_ACCESS_KEY",
+        "CLIENT_SECRET",
+        "DB_PASSWORD",
+        "SSH_AUTH_SOCK",
+        "W5_02B_NOT_ON_THE_ALLOWLIST",
+    ];
+
+    fn profile(isolation: EnvIsolation, passthrough: &[&str]) -> AgentProfile {
+        AgentProfile {
+            id: "w5-02b".into(),
+            name: "w5-02b".into(),
+            command: "git".into(),
+            args: Vec::new(),
+            caps: Default::default(),
+            env: Default::default(),
+            fallback: None,
+            enabled: true,
+            env_policy: EnvPolicy {
+                isolation,
+                passthrough: passthrough.iter().map(|name| (*name).to_string()).collect(),
+            },
+        }
+    }
+
+    fn explicit() -> Vec<(String, String)> {
+        vec![("PROJECTA_API_FILE".into(), "api.json".into())]
+    }
+
+    /// The environment a spawn would start with, keyed by upper-case name.
+    ///
+    /// The planted variables go into the builder the way the parent
+    /// environment does - `CommandBuilder::new` copies it in - so `apply` sees
+    /// them exactly as it would see a `GH_TOKEN` ProjectA was started with.
+    fn environment(profile: &AgentProfile, gh: &Path) -> BTreeMap<String, String> {
+        environment_with(profile, gh, PLANTED)
+    }
+
+    fn environment_with(
+        profile: &AgentProfile,
+        gh: &Path,
+        planted: &[&str],
+    ) -> BTreeMap<String, String> {
+        let mut cmd = CommandBuilder::new(&profile.command);
+        for name in planted {
+            cmd.env(name, SENTINEL);
+        }
+        apply(&mut cmd, profile, &explicit(), gh).expect("apply");
+        cmd.iter_full_env_as_str()
+            .map(|(key, value)| (key.to_ascii_uppercase(), value.to_string()))
+            .collect()
+    }
+
+    /// Run `program` with exactly `env` - the environment the PTY child gets.
+    fn run(
+        program: &str,
+        args: &[&str],
+        env: &BTreeMap<String, String>,
+        stdin: &str,
+    ) -> (bool, String, String) {
+        let mut child = Command::new(program)
+            .args(args)
+            .env_clear()
+            .envs(env)
+            .stdin(Stdio::piped())
+            .stdout(Stdio::piped())
+            .stderr(Stdio::piped())
+            .spawn()
+            .unwrap_or_else(|error| panic!("start {program}: {error}"));
+        child
+            .stdin
+            .take()
+            .expect("stdin")
+            .write_all(stdin.as_bytes())
+            .expect("write stdin");
+        let output = child.wait_with_output().expect("wait");
+        (
+            output.status.success(),
+            String::from_utf8_lossy(&output.stdout).into_owned(),
+            String::from_utf8_lossy(&output.stderr).into_owned(),
+        )
+    }
+
+    #[test]
+    fn allowlisted_agent_env_drops_planted_secrets_and_keeps_the_basics() {
+        let gh = TempDir::new("w5-02b-gh");
+        for isolation in [EnvIsolation::Allowlist, EnvIsolation::Strict] {
+            let env = environment(&profile(isolation, &[]), gh.path());
+            for name in PLANTED {
+                assert!(
+                    !env.contains_key(*name),
+                    "{isolation:?}: {name} reached the agent"
+                );
+            }
+            assert!(
+                env.values().all(|value| !value.contains(SENTINEL)),
+                "{isolation:?}: a planted value reached the agent under another name"
+            );
+            assert!(env.contains_key("PATH"), "{isolation:?}: PATH was dropped");
+            #[cfg(windows)]
+            for name in [
+                "SYSTEMROOT",
+                "USERPROFILE",
+                "APPDATA",
+                "LOCALAPPDATA",
+                "TEMP",
+            ] {
+                if std::env::var_os(name).is_some() {
+                    assert!(env.contains_key(name), "{isolation:?}: {name} was dropped");
+                }
+            }
+            #[cfg(not(windows))]
+            if std::env::var_os("HOME").is_some() {
+                assert!(env.contains_key("HOME"), "{isolation:?}: HOME was dropped");
+            }
+            assert_eq!(env.get("TERM").map(String::as_str), Some("xterm-256color"));
+            assert_eq!(
+                env.get("PROJECTA_API_FILE").map(String::as_str),
+                Some("api.json"),
+                "{isolation:?}: the app's own variable was dropped"
+            );
+        }
+
+        // A profile that names a variable gets it, and only that one.
+        let env = environment(
+            &profile(EnvIsolation::Allowlist, &["OPENAI_API_KEY"]),
+            gh.path(),
+        );
+        assert!(env.contains_key("OPENAI_API_KEY"));
+        assert!(!env.contains_key("GH_TOKEN"));
+    }
+
+    #[test]
+    fn inherit_keeps_the_environment_exactly_as_before() {
+        let gh = TempDir::new("w5-02b-gh");
+        let env = environment(&profile(EnvIsolation::Inherit, &[]), gh.path());
+        for name in PLANTED {
+            assert!(env.contains_key(*name), "inherit dropped {name}");
+        }
+        assert_eq!(env.get("TERM").map(String::as_str), Some("xterm-256color"));
+    }
+
+    #[test]
+    fn strict_agent_env_points_gh_at_an_empty_config() {
+        let gh = TempDir::new("w5-02b-gh");
+        // An earlier agent logged in there; the next spawn must not inherit it.
+        std::fs::write(gh.path().join("hosts.yml"), "github.com:\n    user: w5\n")
+            .expect("plant hosts.yml");
+        let env = environment(&profile(EnvIsolation::Strict, &["GH_TOKEN"]), gh.path());
+        assert_eq!(
+            env.get("GH_CONFIG_DIR").map(String::as_str),
+            Some(gh.path().to_string_lossy().as_ref())
+        );
+        assert!(
+            !gh.path().join("hosts.yml").exists(),
+            "a stale gh login survived"
+        );
+        assert!(
+            !env.contains_key("GH_TOKEN"),
+            "strict let a gh token through even though the profile named it"
+        );
+        assert_eq!(
+            env.get("GIT_TERMINAL_PROMPT").map(String::as_str),
+            Some("0")
+        );
+    }
+
+    #[test]
+    fn strict_agent_env_stops_git_credentials_but_not_local_commits() {
+        let root = TempDir::new("w5-02b-git");
+        let repo = init_repo(&root.path().join("repo"));
+        let repo_arg = repo.to_string_lossy().into_owned();
+        // A stand-in for the Git Credential Manager: a helper that hands out a
+        // password. The empty entry first drops the machine's real helpers,
+        // so this fixture never asks the real credential store.
+        let helper = format!("!f() {{ echo username=w5; echo password={SENTINEL}; }}; f");
+        for (key, value) in [
+            ("credential.helper", ""),
+            ("credential.helper", helper.as_str()),
+            ("credential.https://example.invalid.helper", helper.as_str()),
+        ] {
+            let (ok, _, stderr) = run(
+                "git",
+                &["-C", &repo_arg, "config", "--add", key, value],
+                &std::env::vars().collect(),
+                "",
+            );
+            assert!(ok, "git config {key}: {stderr}");
+        }
+        let fill = "protocol=https\nhost=example.invalid\n\n";
+        let gh = TempDir::new("w5-02b-gh");
+
+        // The fixture works: without isolation the helper answers.
+        let inherit = environment(&profile(EnvIsolation::Inherit, &[]), gh.path());
+        let (ok, stdout, _) = run(
+            "git",
+            &["-C", &repo_arg, "credential", "fill"],
+            &inherit,
+            fill,
+        );
+        assert!(
+            ok && stdout.contains(SENTINEL),
+            "the fake helper did not answer"
+        );
+
+        let strict = environment(&profile(EnvIsolation::Strict, &[]), gh.path());
+        let (ok, stdout, stderr) = run(
+            "git",
+            &["-C", &repo_arg, "credential", "fill"],
+            &strict,
+            fill,
+        );
+        assert!(
+            !ok && !stdout.contains(SENTINEL),
+            "strict: a credential helper answered (stderr: {stderr})"
+        );
+
+        // No ssh transport either: an ssh remote is refused before any
+        // connection, so neither an agent socket nor a key file is used.
+        let (ok, _, stderr) = run(
+            "git",
+            &[
+                "-C",
+                &repo_arg,
+                "ls-remote",
+                "ssh://git@example.invalid/w5.git",
+            ],
+            &strict,
+            "",
+        );
+        assert!(
+            !ok && stderr.contains("not allowed"),
+            "strict: ssh transport ran: {stderr}"
+        );
+
+        // Local work is untouched: the worker can still commit.
+        std::fs::write(repo.join("w5.txt"), "w5-02b\n").expect("write file");
+        for args in [
+            vec!["-C", repo_arg.as_str(), "add", "w5.txt"],
+            vec![
+                "-C",
+                repo_arg.as_str(),
+                "commit",
+                "--no-gpg-sign",
+                "-m",
+                "w5-02b",
+            ],
+        ] {
+            let (ok, _, stderr) = run("git", &args, &strict, "");
+            assert!(ok, "strict: git {args:?} failed: {stderr}");
+        }
+    }
+
+    #[test]
+    fn strict_agent_env_leaves_gh_logged_out() {
+        let probe = Command::new("gh").arg("--version").output();
+        if !probe.is_ok_and(|output| output.status.success()) {
+            eprintln!("gh fehlt auf dieser Maschine: plattformbedingt uebersprungen");
+            return;
+        }
+        let gh = TempDir::new("w5-02b-gh");
+        // Nothing planted: a planted GH_TOKEN would fail the check for the
+        // wrong reason. What must not work is the user's own stored login.
+        let strict = environment_with(&profile(EnvIsolation::Strict, &[]), gh.path(), &[]);
+        let (ok, _, _) = run("gh", &["auth", "status"], &strict, "");
+        // The output is never printed: with a real login it would name the
+        // account and a masked token.
+        assert!(
+            !ok,
+            "strict: gh auth status succeeded - the agent is logged in"
+        );
+    }
+}
diff --git a/src-tauri/src/workers.rs b/src-tauri/src/workers.rs
index 63f385e..65f05f1 100644
--- a/src-tauri/src/workers.rs
+++ b/src-tauri/src/workers.rs
@@ -5810,6 +5810,7 @@ mod tests {
             env: Default::default(),
             fallback: None,
             enabled: true,
+            env_policy: Default::default(),
         }
     }
 
diff --git a/src-tauri/src/workers/development_route.rs b/src-tauri/src/workers/development_route.rs
index 8202d4c..c6f1e88 100644
--- a/src-tauri/src/workers/development_route.rs
+++ b/src-tauri/src/workers/development_route.rs
@@ -604,6 +604,7 @@ mod tests {
             env: Default::default(),
             fallback: None,
             enabled: true,
+            env_policy: Default::default(),
         };
         let now = crate::store::now_unix_secs() as u64;
         let candidate = ModelCandidate {
```
