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
//!   program, no terminal prompt and no ssh transport. Commits in the
//!   worker's own worktree keep working; a push or a `gh` call fails at once
//!   instead of asking. Not the default: task texts tell workers to push
//!   their own branches and open their own pull requests, and `strict`
//!   would break that silently.
//!
//! # The boundary
//!
//! This stops *casual* access - an agent that runs `gh` or `git push` and
//! finds the user's credentials. It does not stop a *deliberate* one: the
//! agent runs as the same OS user, so it can still read
//! `%APPDATA%\GitHub CLI`, `~/.ssh`, the Windows Credential Manager, or run
//! `git -c credential.helper=manager push`. It only filters variable *names*;
//! a secret inside an allowed value (a proxy URL with a password in it) goes
//! through. The hard boundary is a separate OS user for agent processes
//! (W5-02e).

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
    "PSMODULEPATH",
    // Home and temp: where every CLI finds its own login and config
    // (~/.claude, ~/.codex, ~/.kimi-code, opencode's data dir, ~/.gitconfig).
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

/// The `strict` part: no route from the agent to the user's GitHub or git
/// credentials that works without a deliberate detour.
fn lock_credentials(cmd: &mut CommandBuilder, gh_config_dir: &Path) -> Result<(), String> {
    for name in STRICT_REMOVED {
        cmd.env_remove(name);
    }
    // Each session has its own directory, so no agent sees another one's
    // login; clearing a leftover is belt and braces. The directory itself
    // need not exist - gh reads a missing one as empty.
    let hosts = gh_config_dir.join("hosts.yml");
    match std::fs::remove_file(&hosts) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "refusing to start the agent: cannot clear {}: {error}",
                hosts.display()
            ))
        }
    }
    cmd.env("GH_CONFIG_DIR", gh_config_dir);
    cmd.env("GH_PROMPT_DISABLED", "1");
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    // Empty, not absent: git skips `core.askPass` and `SSH_ASKPASS` only
    // when this is set.
    cmd.env("GIT_ASKPASS", "");
    cmd.env("GCM_INTERACTIVE", "never");
    cmd.env("GIT_CONFIG_COUNT", STRICT_GIT_CONFIG.len().to_string());
    let mut parameters = Vec::new();
    for (index, (key, value)) in STRICT_GIT_CONFIG.iter().enumerate() {
        cmd.env(format!("GIT_CONFIG_KEY_{index}"), key);
        cmd.env(format!("GIT_CONFIG_VALUE_{index}"), value);
        parameters.push(format!("'{key}={value}'"));
    }
    cmd.env("GIT_CONFIG_PARAMETERS", parameters.join(" "));
    Ok(())
}

/// The app-owned directory `gh` is pointed at under `strict`: one per
/// session, below the app's local data directory. No fallback to a shared
/// temp directory - without the app's own directory a `strict` spawn fails.
pub(crate) fn gh_config_dir(app: &AppHandle, session_id: &str) -> Option<PathBuf> {
    let base = app.path().app_local_data_dir().ok()?;
    Some(base.join("agent-gh-config").join(session_id))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::io::Write as _;
    use std::process::{Command, Stdio};

    use super::*;
    use crate::profiles::{EnvIsolation, EnvPolicy};
    use crate::testutil::{init_repo, TempDir};

    /// Stand-in for a credential. Only this string is ever planted, so no
    /// assertion message can print a real token.
    const SENTINEL: &str = "w5-02b-sentinel-not-a-real-token";

    /// What ProjectA's own environment may carry and no agent may inherit.
    const PLANTED: &[&str] = &[
        "GH_TOKEN",
        "GITHUB_TOKEN",
        "GH_ENTERPRISE_TOKEN",
        "NPM_TOKEN",
        "ANTHROPIC_AUTH_TOKEN",
        "OPENAI_API_KEY",
        "DEPLOY_KEY",
        "AWS_SECRET_ACCESS_KEY",
        "CLIENT_SECRET",
        "DB_PASSWORD",
        "SSH_AUTH_SOCK",
        "W5_02B_NOT_ON_THE_ALLOWLIST",
    ];

    /// Review round 1: credential names under an allowed prefix that carry
    /// none of the first markers.
    const PLANTED_UNDER_ALLOWED_PREFIXES: &[&str] =
        &["OPENAI_BEARER", "ANTHROPIC_PAT", "CODEX_AUTH"];

    fn profile(isolation: EnvIsolation, passthrough: &[&str]) -> AgentProfile {
        AgentProfile {
            id: "w5-02b".into(),
            name: "w5-02b".into(),
            command: "git".into(),
            args: Vec::new(),
            caps: Default::default(),
            env: Default::default(),
            fallback: None,
            enabled: true,
            env_policy: EnvPolicy {
                isolation,
                passthrough: passthrough.iter().map(|name| (*name).to_string()).collect(),
            },
        }
    }

    fn explicit() -> Vec<(String, String)> {
        vec![("PROJECTA_API_FILE".into(), "api.json".into())]
    }

    /// The environment a spawn would start with, keyed by upper-case name.
    ///
    /// The planted variables go into the builder the way the parent
    /// environment does - `CommandBuilder::new` copies it in - so `apply` sees
    /// them exactly as it would see a `GH_TOKEN` ProjectA was started with.
    fn environment(profile: &AgentProfile, gh: &Path) -> BTreeMap<String, String> {
        environment_with(profile, gh, PLANTED)
    }

    fn environment_with(
        profile: &AgentProfile,
        gh: &Path,
        planted: &[&str],
    ) -> BTreeMap<String, String> {
        let mut cmd = CommandBuilder::new(&profile.command);
        for name in planted {
            cmd.env(name, SENTINEL);
        }
        apply(&mut cmd, profile, &explicit(), Some(gh)).expect("apply");
        cmd.iter_full_env_as_str()
            .map(|(key, value)| (key.to_ascii_uppercase(), value.to_string()))
            .collect()
    }

    /// Run `program` with exactly `env` - the environment the PTY child gets.
    fn run(
        program: &str,
        args: &[&str],
        env: &BTreeMap<String, String>,
        stdin: &str,
    ) -> (bool, String, String) {
        let mut child = Command::new(program)
            .args(args)
            .env_clear()
            .envs(env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap_or_else(|error| panic!("start {program}: {error}"));
        child
            .stdin
            .take()
            .expect("stdin")
            .write_all(stdin.as_bytes())
            .expect("write stdin");
        let output = child.wait_with_output().expect("wait");
        (
            output.status.success(),
            String::from_utf8_lossy(&output.stdout).into_owned(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        )
    }

    #[test]
    fn allowlisted_agent_env_drops_planted_secrets_and_keeps_the_basics() {
        let gh = TempDir::new("w5-02b-gh");
        for isolation in [EnvIsolation::Allowlist, EnvIsolation::Strict] {
            let env = environment(&profile(isolation, &[]), gh.path());
            for name in PLANTED {
                assert!(
                    !env.contains_key(*name),
                    "{isolation:?}: {name} reached the agent"
                );
            }
            assert!(
                env.values().all(|value| !value.contains(SENTINEL)),
                "{isolation:?}: a planted value reached the agent under another name"
            );
            assert!(env.contains_key("PATH"), "{isolation:?}: PATH was dropped");
            #[cfg(windows)]
            for name in [
                "SYSTEMROOT",
                "USERPROFILE",
                "APPDATA",
                "LOCALAPPDATA",
                "TEMP",
            ] {
                if std::env::var_os(name).is_some() {
                    assert!(env.contains_key(name), "{isolation:?}: {name} was dropped");
                }
            }
            #[cfg(not(windows))]
            if std::env::var_os("HOME").is_some() {
                assert!(env.contains_key("HOME"), "{isolation:?}: HOME was dropped");
            }
            assert_eq!(env.get("TERM").map(String::as_str), Some("xterm-256color"));
            assert_eq!(
                env.get("PROJECTA_API_FILE").map(String::as_str),
                Some("api.json"),
                "{isolation:?}: the app's own variable was dropped"
            );
        }

        // A profile that names a variable gets it, and only that one.
        let env = environment(
            &profile(EnvIsolation::Allowlist, &["OPENAI_API_KEY"]),
            gh.path(),
        );
        assert!(env.contains_key("OPENAI_API_KEY"));
        assert!(!env.contains_key("GH_TOKEN"));
    }

    /// W5-02b6: the shipped Kimi profile - not a test stand-in - gets the
    /// home variables it finds `~/.kimi-code` and its login file through,
    /// and none of the provider keys ProjectA's environment may carry.
    /// The closing loop is only a regression guard: it checks every name
    /// against the same filter `apply` uses, so it catches a name `apply`
    /// adds on its own, not a bug in the filter itself. The planted names
    /// and the sentinel scan are the independent part.
    #[test]
    fn builtin_kimi_env_keeps_its_home_and_drops_foreign_secrets() {
        const FOREIGN: &[&str] = &[
            "OPENROUTER_API_KEY",
            "ANTHROPIC_API_KEY",
            "OPENAI_API_KEY",
            "MOONSHOT_API_KEY",
            "KIMI_API_KEY",
            "GH_TOKEN",
            "GITHUB_TOKEN",
        ];
        const HOME: &[&str] = &["USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA"];
        let kimi = crate::profiles::default_profiles()
            .into_iter()
            .find(|p| p.id == "kimi")
            .expect("built-in kimi");
        let gh = TempDir::new("w5-02b6-gh");
        let mut cmd = CommandBuilder::new(&kimi.command);
        for name in FOREIGN {
            cmd.env(name, SENTINEL);
        }
        // Set here so the check does not hang on the test machine's own env.
        for name in HOME {
            cmd.env(name, format!("w5-02b6-{name}"));
        }
        apply(&mut cmd, &kimi, &explicit(), Some(gh.path())).expect("apply");
        let env: BTreeMap<String, String> = cmd
            .iter_full_env_as_str()
            .map(|(key, value)| (key.to_ascii_uppercase(), value.to_string()))
            .collect();

        for name in FOREIGN {
            assert!(!env.contains_key(*name), "{name} reached kimi");
        }
        assert!(
            env.values().all(|value| !value.contains(SENTINEL)),
            "a planted value reached kimi under another name"
        );
        for name in HOME {
            assert_eq!(
                env.get(*name).map(String::as_str),
                Some(format!("w5-02b6-{name}").as_str()),
                "kimi lost {name}"
            );
        }
        let explicit_names: Vec<String> = explicit().into_iter().map(|(k, _)| k).collect();
        for key in env.keys() {
            let accounted = (is_allowed(key) && !looks_secret(key))
                || kimi
                    .env_policy
                    .passthrough
                    .iter()
                    .any(|name| name.eq_ignore_ascii_case(key))
                || key == "TERM"
                || explicit_names.iter().any(|name| name == key);
            assert!(accounted, "kimi got {key}, which nothing lets through");
        }
    }

    /// W5-02b6 manual probe on a machine with Kimi Code installed: under the
    /// shipped profile's filtered environment `kimi` starts and still finds
    /// its home. `kimi provider list` reads `~/.kimi-code/config.toml`; with
    /// the filtered environment it must print exactly what it prints with
    /// the full one. (`kimi doctor config` would not tell: it succeeds on an
    /// empty home too.) Both calls are local - no model request, no cost.
    /// Only the version, exit codes and a byte count are printed; the
    /// provider list itself, config and login files never are. The login
    /// needs a real prompt and is left to the manual step in
    /// `docs/agents-json.md` (`kimi -p "ping"`). The comparison run gets the
    /// full environment, so this belongs on the user's own machine, never in
    /// CI with CI secrets set.
    /// `cargo test --bin projecta -- --ignored manual_kimi_starts_under_allowlist -- --nocapture`
    #[test]
    #[ignore]
    fn manual_kimi_starts_under_allowlist() {
        let kimi = crate::profiles::default_profiles()
            .into_iter()
            .find(|p| p.id == "kimi")
            .expect("built-in kimi");
        let gh = TempDir::new("w5-02b6-manual");
        let mut cmd = CommandBuilder::new(&kimi.command);
        apply(&mut cmd, &kimi, &[], Some(gh.path())).expect("apply");
        let filtered: BTreeMap<String, String> = cmd
            .iter_full_env_as_str()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect();
        // Like `iter_full_env_as_str`: a non-UTF-8 variable is skipped, not
        // a panic.
        let full: BTreeMap<String, String> = std::env::vars_os()
            .filter_map(|(key, value)| Some((key.into_string().ok()?, value.into_string().ok()?)))
            .collect();
        let kimi_run = |args: &[&str], env: &BTreeMap<String, String>| {
            let output = Command::new(&kimi.command)
                .args(args)
                .env_clear()
                .envs(env)
                .stdin(Stdio::null())
                .output()
                .unwrap_or_else(|error| panic!("start kimi: {error}"));
            eprintln!("kimi {args:?}: success={}", output.status.success());
            assert!(
                output.status.success(),
                "kimi {args:?} failed under allowlist"
            );
            output.stdout
        };
        let version = kimi_run(&["--version"], &filtered);
        eprintln!(
            "kimi --version: {}",
            String::from_utf8_lossy(&version).trim()
        );
        let seen = kimi_run(&["provider", "list"], &filtered);
        let expected = kimi_run(&["provider", "list"], &full);
        eprintln!("provider list: {} bytes", seen.len());
        assert!(!expected.is_empty(), "kimi lists no providers at all");
        assert!(
            seen == expected,
            "kimi reads a different config under allowlist - its home was lost"
        );
    }

    #[test]
    fn inherit_keeps_the_environment_exactly_as_before() {
        let gh = TempDir::new("w5-02b-gh");
        let env = environment(&profile(EnvIsolation::Inherit, &[]), gh.path());
        for name in PLANTED {
            assert!(env.contains_key(*name), "inherit dropped {name}");
        }
        assert_eq!(env.get("TERM").map(String::as_str), Some("xterm-256color"));
    }

    #[test]
    fn review_round_1_secret_names_and_missing_gh_dir_are_refused() {
        let gh = TempDir::new("w5-02b-gh");
        for isolation in [EnvIsolation::Allowlist, EnvIsolation::Strict] {
            let env = environment_with(
                &profile(isolation, &[]),
                gh.path(),
                PLANTED_UNDER_ALLOWED_PREFIXES,
            );
            for name in PLANTED_UNDER_ALLOWED_PREFIXES {
                assert!(
                    !env.contains_key(*name),
                    "{isolation:?}: {name} reached the agent"
                );
            }
            // The suffix rules must not cost the commit identity or PATHEXT.
            let mut cmd = CommandBuilder::new("git");
            cmd.env("GIT_AUTHOR_NAME", "w5");
            cmd.env("PATHEXT", ".EXE");
            apply(&mut cmd, &profile(isolation, &[]), &[], Some(gh.path())).expect("apply");
            assert!(cmd.get_env("GIT_AUTHOR_NAME").is_some());
            assert!(cmd.get_env("PATHEXT").is_some());
        }
        // Without an app-owned directory, strict does not start at all -
        // no shared temp directory stands in for it.
        let mut cmd = CommandBuilder::new("git");
        let refused = apply(&mut cmd, &profile(EnvIsolation::Strict, &[]), &[], None);
        assert!(
            refused.is_err(),
            "strict started without its own gh directory"
        );
        // Older git reads GIT_CONFIG_PARAMETERS only; it carries the same lock.
        let env = environment(&profile(EnvIsolation::Strict, &[]), gh.path());
        let parameters = env.get("GIT_CONFIG_PARAMETERS").map(String::as_str);
        assert_eq!(
            parameters,
            Some("'credential.helper=' 'http.extraHeader=' 'protocol.ssh.allow=never'")
        );
    }

    #[test]
    fn strict_agent_env_points_gh_at_an_empty_config() {
        let gh = TempDir::new("w5-02b-gh");
        // An earlier agent logged in there; the next spawn must not inherit it.
        std::fs::write(gh.path().join("hosts.yml"), "github.com:\n    user: w5\n")
            .expect("plant hosts.yml");
        let env = environment(&profile(EnvIsolation::Strict, &["GH_TOKEN"]), gh.path());
        assert_eq!(
            env.get("GH_CONFIG_DIR").map(String::as_str),
            Some(gh.path().to_string_lossy().as_ref())
        );
        assert!(
            !gh.path().join("hosts.yml").exists(),
            "a stale gh login survived"
        );
        assert!(
            !env.contains_key("GH_TOKEN"),
            "strict let a gh token through even though the profile named it"
        );
        assert_eq!(
            env.get("GIT_TERMINAL_PROMPT").map(String::as_str),
            Some("0")
        );
    }

    #[test]
    fn strict_agent_env_stops_git_credentials_but_not_local_commits() {
        let root = TempDir::new("w5-02b-git");
        let repo = init_repo(&root.path().join("repo"));
        let repo_arg = repo.to_string_lossy().into_owned();
        // A stand-in for the Git Credential Manager: a helper that hands out a
        // password. The empty entry first drops the machine's real helpers,
        // so this fixture never asks the real credential store.
        let helper = format!("!f() {{ echo username=w5; echo password={SENTINEL}; }}; f");
        for (key, value) in [
            ("credential.helper", ""),
            ("credential.helper", helper.as_str()),
            ("credential.https://example.invalid.helper", helper.as_str()),
        ] {
            let (ok, _, stderr) = run(
                "git",
                &["-C", &repo_arg, "config", "--add", key, value],
                &std::env::vars().collect(),
                "",
            );
            assert!(ok, "git config {key}: {stderr}");
        }
        let fill = "protocol=https\nhost=example.invalid\n\n";
        let gh = TempDir::new("w5-02b-gh");

        // The fixture works: without isolation the helper answers.
        let inherit = environment(&profile(EnvIsolation::Inherit, &[]), gh.path());
        let (ok, stdout, _) = run(
            "git",
            &["-C", &repo_arg, "credential", "fill"],
            &inherit,
            fill,
        );
        assert!(
            ok && stdout.contains(SENTINEL),
            "the fake helper did not answer"
        );

        let strict = environment(&profile(EnvIsolation::Strict, &[]), gh.path());
        let (ok, stdout, stderr) = run(
            "git",
            &["-C", &repo_arg, "credential", "fill"],
            &strict,
            fill,
        );
        assert!(
            !ok && !stdout.contains(SENTINEL),
            "strict: a credential helper answered (stderr: {stderr})"
        );

        // No ssh transport either: an ssh remote is refused before any
        // connection, so neither an agent socket nor a key file is used.
        let (ok, _, stderr) = run(
            "git",
            &[
                "-C",
                &repo_arg,
                "ls-remote",
                "ssh://git@example.invalid/w5.git",
            ],
            &strict,
            "",
        );
        assert!(
            !ok && stderr.contains("not allowed"),
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

    /// W5-02b5: a recording HTTP server on loopback for the `http.extraHeader`
    /// tests. No crate: a `std` listener is enough - git sends its extra
    /// headers with the first request already, so any response (here an
    /// empty 200) ends the exchange after the headers were captured.
    struct HeaderServer {
        port: u16,
        requests: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
        stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl HeaderServer {
        fn start() -> Self {
            use std::io::Read as _;
            use std::sync::atomic::{AtomicBool, Ordering};
            use std::sync::{Arc, Mutex};
            use std::time::Duration;

            let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind local server");
            listener
                .set_nonblocking(true)
                .expect("nonblocking listener");
            let port = listener.local_addr().expect("local address").port();
            let stop = Arc::new(AtomicBool::new(false));
            let requests: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
            let thread = {
                let stop = Arc::clone(&stop);
                let requests = Arc::clone(&requests);
                std::thread::spawn(move || {
                    while !stop.load(Ordering::SeqCst) {
                        let (mut stream, _) = match listener.accept() {
                            Ok(accepted) => accepted,
                            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                                std::thread::sleep(Duration::from_millis(10));
                                continue;
                            }
                            Err(_) => break,
                        };
                        // Accepted sockets inherit the nonblocking mode on
                        // Windows; the read below must wait, not spin.
                        stream.set_nonblocking(false).expect("blocking stream");
                        stream
                            .set_read_timeout(Some(Duration::from_secs(5)))
                            .expect("read timeout");
                        // Request line and headers end at the first empty
                        // line; a GET carries no body.
                        let mut text = String::new();
                        let mut chunk = [0u8; 4096];
                        loop {
                            match stream.read(&mut chunk) {
                                Ok(0) => break,
                                Ok(n) => {
                                    text.push_str(&String::from_utf8_lossy(&chunk[..n]));
                                    if text.contains("\r\n\r\n") {
                                        break;
                                    }
                                }
                                Err(_) => break,
                            }
                        }
                        requests.lock().expect("requests").push(text);
                        let _ = stream.write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        );
                    }
                })
            };
            Self {
                port,
                requests,
                stop,
                thread: Some(thread),
            }
        }

        /// Run `ls-remote` against this server in `repo` and return the
        /// requests that arrived. git fails or reports an empty remote on
        /// the empty response either way; what matters is which headers the
        /// requests carried.
        fn probe(&self, repo: &Path, env: &BTreeMap<String, String>) -> Vec<String> {
            use std::time::{Duration, Instant};

            let repo_arg = repo.to_string_lossy().into_owned();
            let url = format!("http://127.0.0.1:{}/w5.git", self.port);
            self.requests.lock().expect("requests").clear();
            let _ = run("git", &["-C", &repo_arg, "ls-remote", &url], env, "");
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                let captured = self.requests.lock().expect("requests").clone();
                if !captured.is_empty() || Instant::now() >= deadline {
                    return captured;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }
    }

    impl Drop for HeaderServer {
        fn drop(&mut self) {
            self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    /// Strip proxy variables so a loopback URL always reaches the local
    /// listener, even on a machine behind a proxy.
    fn without_proxy(env: &BTreeMap<String, String>) -> BTreeMap<String, String> {
        let mut env = env.clone();
        for name in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"] {
            env.remove(name);
        }
        env.insert("NO_PROXY".to_string(), "127.0.0.1,localhost".to_string());
        env
    }

    /// Set `key=value` in the repo's config; shared by the header tests.
    fn git_config_set(repo: &Path, key: &str, value: &str) {
        let repo_arg = repo.to_string_lossy().into_owned();
        let (ok, _, stderr) = run(
            "git",
            &["-C", &repo_arg, "config", key, value],
            &std::env::vars().collect(),
            "",
        );
        assert!(ok, "git config {key}: {stderr}");
    }

    /// W5-02b5: the empty `http.extraHeader` in [`STRICT_GIT_CONFIG`] really
    /// resets a generic `http.extraHeader` a config file carries - proven
    /// against a local HTTP server that records what arrives (W5-02b review
    /// round 2, K-B2/G-2: the reset was untested). git sees the reset
    /// entries in the command-line scope after the file entries, and the
    /// empty value clears the accumulated list (`http.c` `http_options`).
    #[test]
    fn strict_agent_env_resets_a_generic_http_extra_header() {
        const MARK: &str = "w5-02b5-generic-not-a-real-token";

        let server = HeaderServer::start();
        let root = TempDir::new("w5-02b5-http");
        let repo = init_repo(&root.path().join("repo"));
        git_config_set(
            &repo,
            "http.extraHeader",
            &format!("Authorization: Bearer {MARK}"),
        );

        let gh = TempDir::new("w5-02b5-gh");
        let inherit = without_proxy(&environment(
            &profile(EnvIsolation::Inherit, &[]),
            gh.path(),
        ));
        let strict = without_proxy(&environment(&profile(EnvIsolation::Strict, &[]), gh.path()));

        let seen = server.probe(&repo, &inherit);
        assert!(
            seen.iter().any(|request| request.contains(MARK)),
            "inherit: the configured extraHeader did not reach the server"
        );

        let seen = server.probe(&repo, &strict);
        assert!(
            !seen.is_empty(),
            "strict: git never reached the local server"
        );
        assert!(
            !seen.iter().any(|request| request.contains(MARK)),
            "strict: a configured extraHeader reached the server"
        );
    }

    /// W5-02b5 KNOWN BOUNDARY, pinned: when the config also carries a
    /// `http.<url>.extraHeader` whose URL matches the remote, the reset no
    /// longer holds - under `strict` BOTH the scoped and the generic header
    /// reach the server (observed on git 2.55). Mechanism, from git's
    /// `urlmatch.c` `urlmatch_config_entry`: per key only the best URL match
    /// is kept (`string_list_insert` + `cmp_matches`), and the generic
    /// command-line reset counts as the worse match than the file's scoped
    /// entry, so it is dropped before `http.c` ever sees it. There is no
    /// environment-level fix - the URL is part of the config key - so this
    /// stays open until agents get their own OS user (W5-02e). If a git
    /// upgrade turns this test red, re-check the boundary note in the module
    /// doc: a fixed git lets the reset win again.
    #[test]
    fn strict_agent_env_url_scoped_extra_header_is_a_known_leak() {
        const GENERIC_MARK: &str = "w5-02b5-generic-not-a-real-token";
        const SCOPED_MARK: &str = "w5-02b5-scoped-not-a-real-token";

        let server = HeaderServer::start();
        let root = TempDir::new("w5-02b5-http-scoped");
        let repo = init_repo(&root.path().join("repo"));
        git_config_set(
            &repo,
            "http.extraHeader",
            &format!("Authorization: Bearer {GENERIC_MARK}"),
        );
        git_config_set(
            &repo,
            &format!("http.http://127.0.0.1:{}.extraHeader", server.port),
            &format!("X-W5-02b5: {SCOPED_MARK}"),
        );

        let gh = TempDir::new("w5-02b5-gh");
        let inherit = without_proxy(&environment(
            &profile(EnvIsolation::Inherit, &[]),
            gh.path(),
        ));
        let strict = without_proxy(&environment(&profile(EnvIsolation::Strict, &[]), gh.path()));

        let seen = server.probe(&repo, &inherit);
        for mark in [GENERIC_MARK, SCOPED_MARK] {
            assert!(
                seen.iter().any(|request| request.contains(mark)),
                "inherit: a configured extraHeader did not reach the server: {mark}"
            );
        }

        // The pinned boundary: the scoped entry defeats the reset, and the
        // generic header goes out with it.
        let seen = server.probe(&repo, &strict);
        assert!(
            !seen.is_empty(),
            "strict: git never reached the local server"
        );
        for mark in [GENERIC_MARK, SCOPED_MARK] {
            assert!(
                seen.iter().any(|request| request.contains(mark)),
                "boundary changed: under strict {mark} no longer reaches the server - \
                 see the comment above and the module doc"
            );
        }
    }

    /// W5-02b5: the user decision from the W5-02b review (K6) - a signing
    /// key is no push or write right, so `strict` does not touch the signing
    /// configuration; forcing `commit.gpgsign=false` would override a
    /// signing mandate of the user's. Pinned here: no strict config key
    /// names signing, and a configured mandate is still honored - a commit
    /// whose signer fails fails loudly instead of hanging or landing
    /// unsigned. `git` itself serves as the stand-in signer: it is
    /// guaranteed present (this test just ran it) and rejects the gpg
    /// arguments at once, on every platform, without a pinentry.
    #[test]
    fn strict_agent_env_keeps_the_users_signing_mandate() {
        for (key, _) in STRICT_GIT_CONFIG {
            assert!(
                !key.contains("gpg") && !key.contains("sign"),
                "strict touches the signing configuration: {key}"
            );
        }

        let root = TempDir::new("w5-02b5-gpg");
        let repo = init_repo(&root.path().join("repo"));
        git_config_set(&repo, "commit.gpgsign", "true");
        git_config_set(&repo, "user.signingkey", "w5-02b5");
        git_config_set(&repo, "gpg.program", "git");

        let gh = TempDir::new("w5-02b5-gh");
        let strict = environment(&profile(EnvIsolation::Strict, &[]), gh.path());
        let repo_arg = repo.to_string_lossy().into_owned();
        let head = || {
            let (ok, stdout, stderr) =
                run("git", &["-C", &repo_arg, "rev-parse", "HEAD"], &strict, "");
            assert!(ok, "rev-parse HEAD: {stderr}");
            stdout.trim().to_string()
        };
        std::fs::write(repo.join("w5.txt"), "w5-02b5\n").expect("write file");
        let (ok, _, stderr) = run("git", &["-C", &repo_arg, "add", "w5.txt"], &strict, "");
        assert!(ok, "strict: git add failed: {stderr}");

        let before = head();
        let (ok, _, stderr) = run(
            "git",
            &["-C", &repo_arg, "commit", "-m", "w5-02b5"],
            &strict,
            "",
        );
        assert!(
            !ok,
            "strict: a commit signed by a stand-in gpg succeeded - the mandate was dropped"
        );
        let lower = stderr.to_lowercase();
        assert!(
            lower.contains("gpg") || lower.contains("sign"),
            "strict: the commit failed for an unrelated reason: {stderr}"
        );
        assert_eq!(before, head(), "strict: the failed signing left a commit");
    }
}
