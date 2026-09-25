# Review W5-02b2: built-in agent profiles default to the allowlist environment

Repo Cuarroc/ProjectA (Tauri 2, Rust). Author: Claude Code. You are an independent cross-vendor reviewer.
Answer in German or English. Give: verdict (freigeben / freigeben mit Auflagen / ablehnen), findings with severity
(hoch/mittel/niedrig) and file:line, and anything you could not check.

## Task
User decision 2026-09-24: switch the BUILT-IN default agent profiles (src-tauri/resources/agent-defaults.json,
embedded via include_str! and parsed in src-tauri/src/profiles.rs::default_profiles) to env_policy.isolation =
allowlist - ALL EXCEPT Kimi, which stays `inherit` until it is clear whether Kimi authenticates via
MOONSHOT_API_KEY (env) or a file. `strict` is NOT used yet (workers still push their own branches).
A user agents.json entry must still be able to override the default. Tests red first.

## Facts checked on this machine (names only, never values)
- Persistent user env: MOONSHOT_API_KEY (-> Kimi stays inherit), CLAUDE_CODE_MAX_CONTEXT_TOKENS (non-secret Claude
  CLI setting; dropped by allowlist because CLAUDE_CODE_ is no allowed prefix and TOKEN is a secret marker ->
  claude passthrough), OLLAMA_CONTEXT_LENGTH (allowed via OLLAMA_ prefix), RUSTC_WRAPPER (allowed), others unrelated
  (HERMES_*, OMNIROUTE_CHAT_MAX_HEAVY_IN_FLIGHT, CLAUDE_MEM_CHROMA_UVX_PATH, OneDrive, ChocolateyLastPathUpdate).
- No ANTHROPIC_API_KEY / OPENAI_API_KEY / CLAUDE_CODE_OAUTH_TOKEN in the persistent env.
- File-based logins exist: ~/.claude/.credentials.json, ~/.codex/auth.json, ~/.local/share/opencode/auth.json,
  ~/.ollama/id_ed25519. HOME/USERPROFILE/APPDATA/LOCALAPPDATA are allowlisted, so those CLIs find them.
- HQ (scripts/lib/hq-live-lib.mjs parseBuiltinProfiles) tolerates the new envPolicy key; its node tests pass.
- Merge semantics unchanged: a same-id agents.json entry replaces the whole profile (env, fallback, env_policy);
  omitting envPolicy there reads as inherit (pre-existing behaviour, now documented).
- Red: at origin/main both new tests fail (built-in claude reads Inherit); green after the manifest change.

## Allowlist implementation (context, unchanged by this diff: src-tauri/src/pty/agent_env.rs)
```rust
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
    "PSMODULEPATH",
    // Home and temp: where every CLI finds its own login and config
    // (~/.claude, ~/.codex, ~/.kimi, opencode's data dir, ~/.gitconfig).
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "TMPDIR",
    // Unix session and locale.
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LANGUAGE",
    "TZ",
    // Terminal.
    "COLORTERM",
    "FORCE_COLOR",
    "NO_COLOR",
    // Commits: identity and editor.
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
    "EDITOR",
    "VISUAL",
    "GIT_EDITOR",
    // Network behind a proxy or a private CA.
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    // Node and Python runtimes the npm/uv shims start.
    "BUN_INSTALL",
    "PYTHONUTF8",
    "PYTHONIOENCODING",
    // Provider CLIs: Claude Code's git-bash and config location, timeouts.
    "CLAUDE_CODE_GIT_BASH_PATH",
    "CLAUDE_CONFIG_DIR",
    "API_TIMEOUT_MS",
    "MCP_TIMEOUT",
    "MCP_TOOL_TIMEOUT",
    "DISABLE_AUTOUPDATER",
];

/// Inherited families an agent keeps, minus whatever [`looks_secret`].
const ALLOWED_PREFIXES: &[&str] = &[
    "LC_",
    "XDG_",
    // Build toolchains the gates in a worktree run (cargo, sccache, node).
    "CARGO_",
    "RUSTUP_",
    "RUSTC_",
    "RUST_",
    "SCCACHE_",
    "NODE_",
    "NPM_CONFIG_",
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
/// likewise drops an `AUTHORIZATION` header a checkout left in a config file.
/// Set twice: `GIT_CONFIG_COUNT` (git >= 2.31) and `GIT_CONFIG_PARAMETERS`,
/// which older git reads too.
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
    for (key, value) in explicit {
        cmd.env(key, value);
    }
    if policy.isolation == EnvIsolation::Strict {
        let dir = gh_config_dir
            .ok_or("refusing to start the agent: no app-owned directory for its gh config")?;
        lock_credentials(cmd, dir)?;
    }
    Ok(())
}

fn is_allowed(upper: &str) -> bool {
    ALLOWED.contains(&upper) || ALLOWED_PREFIXES.iter().any(|p| upper.starts_with(p))
}

/// Whether a name looks like it holds a credential. Deliberately broad: a
/// false positive costs a `passthrough` entry, a false negative a leak.
fn looks_secret(upper: &str) -> bool {
    [
        "TOKEN",
        "SECRET",
        "PASSWORD",
        "PASSWD",
        "PASSPHRASE",
        "CREDENTIAL",
        "KEY",
        "COOKIE",
        "PRIVATE",
        "BEARER",
    ]
    .iter()
    .any(|marker| upper.contains(marker))
        // `PAT` and `AUTH` only as a suffix: PATHEXT and GIT_AUTHOR_NAME stay.
        || upper.ends_with("_PAT")
        || upper.ends_with("_AUTH")
}

```

## Full diff vs origin/main
```diff
diff --git a/src-tauri/resources/agent-defaults.json b/src-tauri/resources/agent-defaults.json
index 0721a6f..ee31154 100644
--- a/src-tauri/resources/agent-defaults.json
+++ b/src-tauri/resources/agent-defaults.json
@@ -14,7 +14,8 @@
         },
         "readinessMarker": "❯ Try \""
       },
-      "env": {}, "fallback": null, "enabled": true
+      "env": {}, "fallback": null, "enabled": true,
+      "envPolicy": { "isolation": "allowlist", "passthrough": ["CLAUDE_CODE_MAX_CONTEXT_TOKENS"] }
     },
     {
       "id": "kimi", "name": "Kimi CLI", "command": "kimi", "args": ["--auto"],
@@ -28,7 +29,8 @@
         },
         "readinessMarker": null
       },
-      "env": {}, "fallback": null, "enabled": true
+      "env": {}, "fallback": null, "enabled": true,
+      "envPolicy": { "isolation": "inherit", "passthrough": [] }
     },
     {
       "id": "codex", "name": "Codex CLI", "command": "codex", "args": [],
@@ -37,7 +39,8 @@
         "lifecycle": { "mode": "heuristic" },
         "dialect": { "permission": [], "quota": [], "contextLabels": [] }, "readinessMarker": "Ask Codex to do anything"
       },
-      "env": {}, "fallback": null, "enabled": true
+      "env": {}, "fallback": null, "enabled": true,
+      "envPolicy": { "isolation": "allowlist", "passthrough": [] }
     },
     {
       "id": "opencode", "name": "OpenCode", "command": "opencode", "args": [],
@@ -46,7 +49,8 @@
         "lifecycle": { "mode": "heuristic" },
         "dialect": { "permission": [], "quota": [], "contextLabels": [] }, "readinessMarker": "Ask anything"
       },
-      "env": {}, "fallback": null, "enabled": true
+      "env": {}, "fallback": null, "enabled": true,
+      "envPolicy": { "isolation": "allowlist", "passthrough": [] }
     },
     {
       "id": "opencode-glm-53-flash", "name": "OpenCode GLM 5.3 Flash", "command": "opencode", "args": ["-m", "opencode-go/glm-5.3-flash"],
@@ -55,7 +59,8 @@
         "lifecycle": { "mode": "heuristic" },
         "dialect": { "permission": [], "quota": [], "contextLabels": [] }, "readinessMarker": "Ask anything"
       },
-      "env": {}, "fallback": null, "enabled": true
+      "env": {}, "fallback": null, "enabled": true,
+      "envPolicy": { "isolation": "allowlist", "passthrough": [] }
     },
     {
       "id": "ollama", "name": "Ollama", "command": "ollama", "args": ["run", "llama3.2"],
@@ -64,7 +69,8 @@
         "lifecycle": { "mode": "heuristic" },
         "dialect": { "permission": [], "quota": [], "contextLabels": [] }, "readinessMarker": null
       },
-      "env": {}, "fallback": null, "enabled": true
+      "env": {}, "fallback": null, "enabled": true,
+      "envPolicy": { "isolation": "allowlist", "passthrough": [] }
     },
     {
       "id": "ollama-coder", "name": "Ollama Cloud Coder (deepseek-v4-flash)", "command": "ollama", "args": ["run", "deepseek-v4-flash:cloud"],
@@ -73,7 +79,8 @@
         "lifecycle": { "mode": "heuristic" },
         "dialect": { "permission": [], "quota": [], "contextLabels": [] }, "readinessMarker": null
       },
-      "env": {}, "fallback": null, "enabled": true
+      "env": {}, "fallback": null, "enabled": true,
+      "envPolicy": { "isolation": "allowlist", "passthrough": [] }
     }
   ]
 }
diff --git a/src-tauri/src/profiles.rs b/src-tauri/src/profiles.rs
index 7bf2d36..12af030 100644
--- a/src-tauri/src/profiles.rs
+++ b/src-tauri/src/profiles.rs
@@ -66,8 +66,12 @@ pub struct EnvPolicy {
     pub passthrough: Vec<String>,
 }
 
-/// The three isolation levels. The default is `inherit` because workers push
-/// their own branches today; see `.pa/report_w5-02b.md`.
+/// The three isolation levels. The serde default is `inherit` because workers
+/// push their own branches today; see `.pa/report_w5-02b.md`. The built-in
+/// profiles in `resources/agent-defaults.json` name `allowlist` explicitly -
+/// all but Kimi, which may authenticate through `MOONSHOT_API_KEY` (W5-02b2,
+/// user decision 2026-09-24). An `agents.json` entry that omits the field
+/// replaces the whole profile and therefore reads as `inherit`.
 #[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
 #[serde(rename_all = "lowercase")]
 pub enum EnvIsolation {
@@ -585,11 +589,61 @@ mod tests {
         );
     }
 
+    /// W5-02b2 (user decision 2026-09-24): every built-in runs under
+    /// `allowlist` except Kimi, which stays `inherit` until it is settled
+    /// whether it authenticates through `MOONSHOT_API_KEY` (the secret filter
+    /// would drop it) or a file. `strict` is not a default yet: workers still
+    /// push their own branches. The other CLIs keep their login in files
+    /// under the user's home, so no built-in passes a secret through. Claude
+    /// keeps `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, a non-secret CLI setting the
+    /// user sets machine-wide that the `TOKEN` marker would otherwise drop.
     #[test]
-    fn env_policy_defaults_to_inherit_and_is_read_from_agents_json() {
-        assert!(default_profiles()
-            .iter()
-            .all(|p| p.env_policy == EnvPolicy::default()));
+    fn builtin_profiles_default_to_allowlist_except_kimi() {
+        let profiles = default_profiles();
+        assert!(profiles.iter().any(|p| p.id == "kimi"), "kimi built-in");
+        for profile in &profiles {
+            let expected = if profile.id == "kimi" {
+                EnvIsolation::Inherit
+            } else {
+                EnvIsolation::Allowlist
+            };
+            assert_eq!(
+                profile.env_policy.isolation, expected,
+                "built-in {} has the wrong isolation",
+                profile.id
+            );
+            let passthrough: &[&str] = if profile.id == "claude" {
+                &["CLAUDE_CODE_MAX_CONTEXT_TOKENS"]
+            } else {
+                &[]
+            };
+            assert_eq!(
+                profile.env_policy.passthrough, passthrough,
+                "built-in {} has the wrong passthrough",
+                profile.id
+            );
+        }
+    }
+
+    /// The built-in default is only a default: a same-id `agents.json` entry
+    /// sets the level it names, including going back to `inherit`.
+    #[test]
+    fn agents_json_can_put_a_builtin_back_to_inherit() {
+        let builtin = default_profiles()
+            .into_iter()
+            .find(|p| p.id == "claude")
+            .expect("claude");
+        assert_eq!(builtin.env_policy.isolation, EnvIsolation::Allowlist);
+        let raw = r#"[{ "id": "claude", "name": "Claude Code", "command": "claude",
+                        "envPolicy": { "isolation": "inherit" } }]"#;
+        let overrides: ProfilesFile = serde_json::from_str(raw).expect("parse");
+        let merged = merge_profiles(default_profiles(), overrides.into_vec());
+        let claude = merged.iter().find(|p| p.id == "claude").expect("claude");
+        assert_eq!(claude.env_policy.isolation, EnvIsolation::Inherit);
+    }
+
+    #[test]
+    fn env_policy_is_read_from_agents_json() {
         let raw = r#"[{ "id": "kimi", "name": "Kimi", "command": "kimi",
                         "envPolicy": { "isolation": "strict",
                                        "passthrough": ["MOONSHOT_API_KEY"] } }]"#;
```
