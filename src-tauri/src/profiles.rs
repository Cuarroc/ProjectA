//! Agent profiles: the CLI coding agents ProjectA knows how to spawn.
//!
//! A small set of defaults is embedded in the binary. They can be overridden or
//! extended by dropping an `agents.json` next to the executable.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::capabilities::AgentCapabilities;
#[cfg(test)]
use crate::capabilities::{Dialect, Lifecycle, SkillsDiscovery, SystemPrompt};

/// A launchable CLI coding agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentProfile {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// What this CLI can do and how ProjectA should drive it.
    #[serde(default)]
    pub caps: AgentCapabilities,
    /// Extra environment variables every spawn of this profile carries, on top
    /// of what [`crate::ruflo::agent_env`] contributes. This is how a profile
    /// is pointed at a router (`ANTHROPIC_BASE_URL`, `CODEX_HOME`) without any
    /// module having to know an agent by name; the merge happens in
    /// [`crate::routing::spawn_env`]. Sorted, so a spawn is reproducible.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// The profile to try when this one is blocked - out of quota, or over the
    /// budget ceiling the user set. Empty for every built-in: a ProjectA that
    /// was never configured stops at a block exactly as it did before, and
    /// nothing is ever rerouted onto somebody else's bill silently.
    ///
    /// The dispatcher walks this at most [`crate::queue::MAX_FALLBACK_DEPTH`]
    /// hops and refuses a chain that loops back on itself; see
    /// [`crate::queue::dispatch_project`].
    #[serde(default)]
    pub fallback: Option<String>,
    /// Whether the user lets this profile be spawned at all. Not part of the
    /// profile definition: it is filled in from the settings table by
    /// [`crate::learnings::profiles_with_enabled`], so a profile loaded on its
    /// own - and an `agents.json` written before this field existed - reads as
    /// enabled.
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Which part of ProjectA's own environment a spawn of this profile gets
    /// (W5-02b); see [`crate::pty::agent_env`] for what each level does.
    #[serde(default, alias = "envPolicy")]
    pub env_policy: EnvPolicy,
}

/// How much of the app's environment reaches an agent process (W5-02b).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnvPolicy {
    #[serde(default)]
    pub isolation: EnvIsolation,
    /// Inherited variables this profile needs although the allowlist or the
    /// secret filter would drop them - e.g. `MOONSHOT_API_KEY` for a Kimi
    /// that authenticates through the environment, or the home variables a
    /// CLI must keep whatever the base list says. Named here, the value
    /// still comes from the app's environment and never from a file.
    #[serde(default)]
    pub passthrough: Vec<String>,
}

/// The three isolation levels. The default is `allowlist` (W5-02b6, user
/// decision 2026-09-24): an `agents.json` entry - or an `envPolicy` in it -
/// that names no level runs under `allowlist`, whether it adds a new id or
/// replaces a built-in. `inherit` must be asked for explicitly. `strict` is
/// not the default because workers push their own branches today; see
/// `.pa/report_w5-02b.md`. The built-ins in `resources/agent-defaults.json`
/// name `allowlist` explicitly anyway (W5-02b2), Kimi included since W5-02b6.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnvIsolation {
    /// The full app environment, exactly as before W5-02b. Opt-in only.
    Inherit,
    /// Only allowlisted variables, secrets and `SSH_AUTH_SOCK` removed. Git
    /// and `gh` still find the user's stored credentials.
    #[default]
    Allowlist,
    /// `allowlist`, plus `gh` pointed at an empty config and git's
    /// credential helpers, prompts and ssh transport switched off. Local
    /// commits keep working; pushes and `gh` calls fail without asking.
    Strict,
}

/// A profile nobody has switched off is on.
fn default_enabled() -> bool {
    true
}

#[cfg(test)]
impl AgentProfile {
    fn new(id: &str, name: &str, command: &str, args: &[&str], caps: AgentCapabilities) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            command: command.to_string(),
            args: args.iter().map(|a| (*a).to_string()).collect(),
            caps,
            // Built-ins route nothing: an unconfigured ProjectA spawns exactly
            // the environment it did before phase 19.
            env: BTreeMap::new(),
            fallback: None,
            enabled: true,
            env_policy: EnvPolicy::default(),
        }
    }
}

/// One `agents.json` entry. Missing capabilities inherit from a same-id
/// built-in profile or, failing that, from the `<base>-<suffix>` profile the id
/// is a variant of; an unrelated new id receives the cautious defaults.
#[derive(Debug, Deserialize)]
struct ProfileOverride {
    id: String,
    name: String,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    caps: Option<AgentCapabilities>,
    #[serde(default)]
    env: BTreeMap<String, String>,
    #[serde(default)]
    fallback: Option<String>,
    #[serde(default, alias = "envPolicy")]
    env_policy: EnvPolicy,
}

/// `agents.json` may be either a bare array of profiles or `{ "profiles": [...] }`.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ProfilesFile {
    List(Vec<ProfileOverride>),
    Wrapped { profiles: Vec<ProfileOverride> },
}

impl ProfilesFile {
    fn into_vec(self) -> Vec<ProfileOverride> {
        match self {
            ProfilesFile::List(v) => v,
            ProfilesFile::Wrapped { profiles } => profiles,
        }
    }
}

const BUILTIN_PROFILES_JSON: &str = include_str!("../resources/agent-defaults.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BuiltinProfileManifest {
    schema_version: u32,
    profiles: Vec<AgentProfile>,
}

/// Shared with HQ; compiled data, not editable runtime overrides.
/// Kimi dialect is from the 0.38.0 capture; quota/context stay unavailable.
/// OpenCode's Ask anything marker preserves the NT-17 input-readiness guard.
pub fn default_profiles() -> Vec<AgentProfile> {
    let manifest: BuiltinProfileManifest =
        serde_json::from_str(BUILTIN_PROFILES_JSON).expect("embedded agent defaults must be valid");
    assert_eq!(
        manifest.schema_version, 1,
        "unsupported embedded profile schema"
    );
    manifest.profiles
}

/// Allows HQ to distinguish matching compiled defaults from a checkout preview.
/// Hash only the shipped manifest, never credentials or machine overrides.
pub fn builtin_manifest_sha256() -> String {
    use sha2::{Digest, Sha256};
    format!(
        "{:x}",
        Sha256::digest(BUILTIN_PROFILES_JSON.replace("\r\n", "\n").as_bytes())
    )
}

/// The same explicit path contract used by the HQ. Never resolve a relative
/// override against an arbitrary worker's current directory.
pub fn resolve_override_path(
    exe: &std::path::Path,
    configured: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(configured) = configured {
        let path = PathBuf::from(configured);
        if configured.trim().is_empty() || !path.is_absolute() {
            return Err("PROJECTA_AGENTS_FILE must be an absolute file path".into());
        }
        return Ok(path);
    }
    exe.parent()
        .map(|parent| parent.join("agents.json"))
        .ok_or_else(|| "ProjectA executable has no parent directory".into())
}

pub fn override_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    resolve_override_path(&exe, std::env::var("PROJECTA_AGENTS_FILE").ok().as_deref()).ok()
}

/// No launch arguments or environment values are exposed by diagnostics.
pub fn profile_diagnostics() -> serde_json::Value {
    let result = std::env::current_exe()
        .map_err(|_| "cannot locate ProjectA executable".to_string())
        .and_then(|exe| {
            resolve_override_path(&exe, std::env::var("PROJECTA_AGENTS_FILE").ok().as_deref())
        });
    let mut warnings = Vec::<String>::new();
    let path = match result {
        Ok(path) => Some(path),
        Err(error) => {
            warnings.push(error);
            None
        }
    };
    if let Some(path) = &path {
        match std::fs::read_to_string(path) {
            Ok(raw) => {
                if serde_json::from_str::<ProfilesFile>(&raw).is_err() {
                    warnings.push("profile file is invalid; built-in profiles are active".into());
                } else if has_unsupported_fields(&raw) {
                    warnings.push("profile file contains unsupported fields; those fields do not change runtime behavior".into());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => {
                warnings.push("profile file cannot be read; built-in profiles are active".into())
            }
        }
    }
    serde_json::json!({"profilesPath": path, "warnings": warnings, "builtinManifestSha256": builtin_manifest_sha256()})
}

/// Whether an `agents.json` entry carries a key the runtime ignores. `team`
/// and `briefing` are HQ-only; `envPolicy` (and its serde name) is read by
/// [`ProfileOverride`] and must not be reported as ignored.
fn has_unsupported_fields(raw: &str) -> bool {
    const KNOWN: &[&str] = &[
        "id",
        "name",
        "command",
        "args",
        "caps",
        "env",
        "fallback",
        "envPolicy",
        "env_policy",
        "team",
        "briefing",
    ];
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return false;
    };
    let entries = value
        .as_array()
        .or_else(|| value.get("profiles").and_then(|v| v.as_array()));
    entries.into_iter().flatten().any(|entry| {
        entry
            .as_object()
            .is_some_and(|entry| entry.keys().any(|key| !KNOWN.contains(&key.as_str())))
    })
}

/// Read `agents.json` if it exists and parses. Failures are non-fatal: a broken
/// override file must never stop the app from starting.
fn load_overrides() -> Vec<ProfileOverride> {
    let Some(path) = override_path() else {
        return Vec::new();
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    match serde_json::from_str::<ProfilesFile>(&raw) {
        Ok(parsed) => parsed.into_vec(),
        Err(err) => {
            eprintln!("projecta: ignoring {}: {err}", path.display());
            Vec::new()
        }
    }
}

/// Defaults, with same-id entries from `agents.json` replacing them and new ids
/// appended in file order.
pub fn load_profiles() -> Vec<AgentProfile> {
    merge_profiles(default_profiles(), load_overrides())
}

/// Capabilities an override inherits when it declares none: the same id if it
/// exists, otherwise the profile this id is a dash-suffixed variant of.
///
/// The second rule is what makes a routed profile usable. `claude-omni` runs
/// the same CLI as `claude` - only through a different base URL - but it is a
/// new id, so the same-id rule cannot reach it and it would launch with the
/// cautious defaults: no hooks, no skills, no system prompt. Matching on the
/// `<base>-<suffix>` shape keeps that opt-in and readable (`claudeomni` is not
/// a Claude variant), and the longest base wins so a variant of a variant
/// inherits from the nearest one.
fn inherited_caps(profiles: &[AgentProfile], id: &str) -> Option<AgentCapabilities> {
    if let Some(same) = profiles.iter().find(|profile| profile.id == id) {
        return Some(same.caps.clone());
    }
    profiles
        .iter()
        .filter(|profile| {
            id.strip_prefix(&profile.id)
                .is_some_and(|rest| rest.starts_with('-'))
        })
        .max_by_key(|profile| profile.id.len())
        .map(|profile| profile.caps.clone())
}

/// Replace built-in profile launch details while preserving capabilities when
/// the override omitted them. Explicit capabilities replace the whole set.
fn merge_profiles(
    mut profiles: Vec<AgentProfile>,
    overrides: Vec<ProfileOverride>,
) -> Vec<AgentProfile> {
    for profile_override in overrides {
        let inherited = inherited_caps(&profiles, &profile_override.id);
        let profile = AgentProfile {
            id: profile_override.id,
            name: profile_override.name,
            command: profile_override.command,
            args: profile_override.args,
            caps: profile_override.caps.or(inherited).unwrap_or_default(),
            env: profile_override.env,
            fallback: profile_override.fallback,
            enabled: true,
            env_policy: profile_override.env_policy,
        };
        match profiles
            .iter_mut()
            .find(|existing| existing.id == profile.id)
        {
            Some(existing) => *existing = profile,
            None => profiles.push(profile),
        }
    }
    profiles
}

/// Look up a single profile by id.
pub fn find_profile(id: &str) -> Option<AgentProfile> {
    load_profiles().into_iter().find(|p| p.id == id)
}

/// F-CORE-3 A.2: the profile's answer marker - the output text that proves
/// the agent picked up the task and started answering. The submit guard
/// searches it only in output *after* the write baseline; `None` keeps the
/// byte-based delivery signal, bit-exact. Only markers seen in real captures
/// are listed - an invented marker is the NT-17 failure mode in new clothes.
///
/// Rev 3 führt den Marker als `caps`-Feld; `AgentCapabilities` liegt aber in
/// `capabilities.rs` außerhalb der Baustein-A-Dateigrenze (und ein neues
/// `AgentProfile`-Feld bräche Struct-Literale in `hooks.rs`/`workers.rs`),
/// deshalb vorerst eine Tabelle hier. Der Umzug nach `caps` gehört in ein
/// `capabilities.rs`-Fenster.
#[cfg_attr(not(test), allow(dead_code))] // Baustein B verdrahtet sie in die Zustellpfade
pub fn answer_marker(profile: &AgentProfile) -> Option<&'static str> {
    // Claude Code prefixes its own answer/tool lines with "⏺"
    // (docs/audits/2026-09-03-analyse-claude-web/befunde/kern-nebenlaeufigkeit.md:81).
    const ANSWER_MARKERS: &[(&str, &str)] = &[("claude", "⏺")];
    let id = profile.id.as_str();
    ANSWER_MARKERS
        .iter()
        .find(|(base, _)| {
            // A `<base>-<suffix>` variant runs the same CLI, so it inherits
            // the base's marker like `inherited_caps` inherits capabilities.
            id == *base
                || id
                    .strip_prefix(base)
                    .is_some_and(|rest| rest.starts_with('-'))
        })
        .map(|(_, marker)| *marker)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_profile_path_is_independent_of_executable_directory() {
        let root = std::env::temp_dir();
        let exe = root.join("build").join("projecta.exe");
        let configured = root.join("config").join("agents.json");
        assert_eq!(
            resolve_override_path(&exe, configured.to_str()).unwrap(),
            configured
        );
        assert_eq!(
            resolve_override_path(&exe, None).unwrap(),
            root.join("build").join("agents.json")
        );
    }

    #[test]
    fn relative_or_empty_profile_override_is_never_silently_used() {
        let exe = std::env::temp_dir().join("projecta.exe");
        for configured in ["", "  ", "agents.json", "../agents.json"] {
            assert!(resolve_override_path(&exe, Some(configured)).is_err());
        }
    }

    #[test]
    fn claude_and_kimi_defaults_carry_their_capabilities() {
        let profiles = default_profiles();
        let claude = profiles.iter().find(|p| p.id == "claude").expect("claude");
        assert_eq!(
            claude.caps.system_prompt,
            SystemPrompt::Arg {
                flag: "--append-system-prompt".into()
            }
        );
        assert_eq!(claude.caps.skills, SkillsDiscovery::Convention);
        assert_eq!(
            claude.caps.lifecycle,
            Lifecycle::SettingsHooks {
                flag: "--settings".into()
            }
        );
        assert!(claude
            .caps
            .dialect
            .permission
            .contains(&"do you want to make this edit".to_string()));
        assert!(claude
            .caps
            .dialect
            .quota
            .contains(&"usage limit".to_string()));

        let kimi = profiles.iter().find(|p| p.id == "kimi").expect("kimi");
        assert_eq!(
            kimi.caps.system_prompt,
            SystemPrompt::File {
                flag: "--agent-file".into(),
                ext: "md".into()
            }
        );
        assert_eq!(
            kimi.caps.skills,
            SkillsDiscovery::Flag {
                flag: "--skills-dir".into()
            }
        );
        assert_eq!(kimi.caps.lifecycle, Lifecycle::Heuristic);
    }

    #[test]
    fn other_defaults_stay_cautious() {
        let ollama = default_profiles()
            .into_iter()
            .find(|profile| profile.id == "ollama")
            .expect("ollama");
        assert_eq!(ollama.caps, AgentCapabilities::default());
        // Codex carries a captured readiness marker; everything else about
        // it stays the cautious default.
        let codex = default_profiles()
            .into_iter()
            .find(|profile| profile.id == "codex")
            .expect("codex");
        assert_eq!(
            codex.caps,
            AgentCapabilities {
                readiness_marker: Some("Ask Codex to do anything".into()),
                ..AgentCapabilities::default()
            }
        );
    }

    /// W1-01 (user decision 2026-09-17): Kimi Code starts in plan mode
    /// (`default_plan_mode = true` in the user's config) and its plan
    /// approval ("Ready to build with this plan? 1. Approve") is a
    /// `needs_you` verdict by design - the last manual assist in the Kimi
    /// smoke. Workers run Kimi in "Never Ask" mode (`--auto`): plans and
    /// tool approvals are decided by Kimi, decisions go through `pa ask`.
    #[test]
    fn the_kimi_profile_runs_workers_in_never_ask_mode() {
        let kimi = default_profiles()
            .into_iter()
            .find(|profile| profile.id == "kimi")
            .expect("kimi");
        assert_eq!(kimi.args, vec!["--auto"]);
        // Still no readiness marker: Kimi's empty composer has no stable
        // placeholder, and a boot-only marker would time out on reused
        // sessions (.pa/report_kimi_raw_stream_2026-09-16.md §1).
        assert_eq!(kimi.caps.readiness_marker, None);
    }

    /// NT-17: OpenCode's TUI flushes input written before its loop runs, so
    /// its profiles are the ones that carry the readiness marker.
    #[test]
    fn opencode_profiles_carry_the_readiness_marker() {
        for id in ["opencode", "opencode-glm-53-flash"] {
            let profile = default_profiles()
                .into_iter()
                .find(|profile| profile.id == id)
                .expect(id);
            assert_eq!(
                profile.caps.readiness_marker.as_deref(),
                Some("Ask anything"),
                "{id}"
            );
        }
    }

    /// W1-18b (probe 2026-09-25): the
    /// installed OpenCode 1.18.32 lists a canary living in the probe
    /// workspace's `.agents/skills` from `debug skill --pure` - an
    /// observation, not a configuration guess - so both opencode profiles
    /// declare `ConventionAt`. The model flag does not change discovery, so
    /// the glm variant is covered by the same probe. Codex stays
    /// `Unsupported`: its re-probe waits out the rate limit (2026-09-30),
    /// and this assert keeps anyone from lifting it along by accident.
    #[test]
    fn opencode_profiles_read_repo_skills_at_agents_skills() {
        for id in ["opencode", "opencode-glm-53-flash"] {
            let profile = default_profiles()
                .into_iter()
                .find(|profile| profile.id == id)
                .expect(id);
            assert_eq!(
                profile.caps.skills,
                SkillsDiscovery::ConventionAt {
                    dir: ".agents/skills".into()
                },
                "{id}"
            );
        }
        let codex = default_profiles()
            .into_iter()
            .find(|profile| profile.id == "codex")
            .expect("codex");
        assert_eq!(
            codex.caps.skills,
            SkillsDiscovery::Unsupported,
            "codex is not re-probed yet (W1-18b, rate limit until 2026-09-30)"
        );
    }

    /// The codex composer prompt "Ask Codex to do anything" and its echo of
    /// typed input were captured on a real TUI on 2026-09-14; its startup
    /// dialog chain (trust, hooks review) swallows blind writes, so the
    /// profile carries the captured readiness marker.
    #[test]
    fn the_codex_profile_carries_its_captured_readiness_marker() {
        let profile = default_profiles()
            .into_iter()
            .find(|profile| profile.id == "codex")
            .expect("codex");
        assert_eq!(
            profile.caps.readiness_marker.as_deref(),
            Some("Ask Codex to do anything")
        );
    }

    /// Claude Code 2.1.266 rests its empty composer on a rotating placeholder
    /// that always opens with `Try "`, behind the prompt glyph (captured
    /// 2026-09-16 via `testutil::capture_claude_output`:
    /// `❯ Try "how does <filepath> work?"`). The glyph anchors the marker so
    /// agent prose that happens to say `Try "` cannot arm a write (review
    /// finding, `.pa/review_claude_smoke_disposition.md`).
    /// Its startup chain (cursor query, trust dialog, plugin/MCP boot) takes
    /// tens of seconds and swallows blind writes: the 2026-09-16 smoke saw the
    /// silence heuristic type into the pre-raw-mode console and take the
    /// line-discipline echo for the composer's. The placeholder is the only
    /// captured proof that the input loop is up.
    #[test]
    fn the_claude_profile_carries_its_captured_readiness_marker() {
        let profile = default_profiles()
            .into_iter()
            .find(|profile| profile.id == "claude")
            .expect("claude");
        assert_eq!(profile.caps.readiness_marker.as_deref(), Some("❯ Try \""));
    }

    /// F-CORE-3 A.2: answer markers come from real captures or not at all -
    /// every profile without one keeps the byte-based delivery signal.
    #[test]
    fn answer_markers_come_from_real_captures_only() {
        let profiles = default_profiles();
        let claude = profiles.iter().find(|p| p.id == "claude").expect("claude");
        // Claude Code prefixes its own answer/tool lines with "⏺"
        // (docs/audits/2026-09-03-analyse-claude-web/befunde/kern-nebenlaeufigkeit.md:81).
        assert_eq!(answer_marker(claude), Some("⏺"));
        for profile in &profiles {
            if profile.id == "claude" {
                continue;
            }
            assert_eq!(
                answer_marker(profile),
                None,
                "{}: kein Antwort-Marker ohne Capture-Beleg",
                profile.id
            );
        }
    }

    /// A routed variant runs the same CLI as its base, so it inherits the
    /// base's answer marker exactly like it inherits capabilities.
    #[test]
    fn a_dash_suffixed_variant_inherits_the_base_answer_marker() {
        let omni = AgentProfile::new(
            "claude-omni",
            "Claude routed",
            "claude",
            &[],
            Default::default(),
        );
        assert_eq!(answer_marker(&omni), Some("⏺"));
        let unrelated = AgentProfile::new("claudeomni", "Not Claude", "x", &[], Default::default());
        assert_eq!(answer_marker(&unrelated), None);
    }

    #[test]
    fn opencode_glm_53_flash_profile_is_available() {
        let profile = default_profiles()
            .into_iter()
            .find(|p| p.id == "opencode-glm-53-flash")
            .expect("opencode-glm-53-flash profile exists");
        assert_eq!(profile.command, "opencode");
        assert_eq!(profile.args, vec!["-m", "opencode-go/glm-5.3-flash"]);
        // Cautious defaults except the readiness marker (NT-17) and the
        // probed skill discovery (W1-18b, same binary as `opencode`).
        assert_eq!(
            profile.caps,
            AgentCapabilities {
                skills: SkillsDiscovery::ConventionAt {
                    dir: ".agents/skills".into()
                },
                readiness_marker: Some("Ask anything".into()),
                ..AgentCapabilities::default()
            }
        );
    }

    /// W5-02b2 and W5-02b6 (user decisions 2026-09-24): every built-in runs
    /// under `allowlist`; `strict` is not a default yet, workers still push
    /// their own branches. The CLIs keep their login in files under the
    /// user's home, so no built-in passes a secret through. Claude keeps
    /// `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, a non-secret CLI setting the user
    /// sets machine-wide that the `TOKEN` marker would otherwise drop. Kimi
    /// (`~/.kimi-code`, OAuth login in a file, not `MOONSHOT_API_KEY`) names
    /// the four variables it finds that home through: they are on the base
    /// allowlist today, and the profile keeps them even if that list shrinks.
    #[test]
    fn builtin_profiles_all_default_to_allowlist() {
        let profiles = default_profiles();
        assert!(profiles.iter().any(|p| p.id == "kimi"), "kimi built-in");
        for profile in &profiles {
            assert_eq!(
                profile.env_policy.isolation,
                EnvIsolation::Allowlist,
                "built-in {} has the wrong isolation",
                profile.id
            );
            let passthrough: &[&str] = match profile.id.as_str() {
                "claude" => &["CLAUDE_CODE_MAX_CONTEXT_TOKENS"],
                "kimi" => &["USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA"],
                _ => &[],
            };
            assert_eq!(
                profile.env_policy.passthrough, passthrough,
                "built-in {} has the wrong passthrough",
                profile.id
            );
        }
    }

    /// The built-in default is only a default: a same-id `agents.json` entry
    /// sets the level it names, including going back to `inherit`.
    #[test]
    fn agents_json_can_put_a_builtin_back_to_inherit() {
        let builtin = default_profiles()
            .into_iter()
            .find(|p| p.id == "claude")
            .expect("claude");
        assert_eq!(builtin.env_policy.isolation, EnvIsolation::Allowlist);
        let raw = r#"[{ "id": "claude", "name": "Claude Code", "command": "claude",
                        "envPolicy": { "isolation": "inherit" } }]"#;
        let overrides: ProfilesFile = serde_json::from_str(raw).expect("parse");
        let merged = merge_profiles(default_profiles(), overrides.into_vec());
        let claude = merged.iter().find(|p| p.id == "claude").expect("claude");
        assert_eq!(claude.env_policy.isolation, EnvIsolation::Inherit);
    }

    /// W5-02b6 (user decision 2026-09-24): an `agents.json` entry that does
    /// not name a level runs under `allowlist`, not `inherit` - a new id, a
    /// same-id replacement of a built-in, and an `envPolicy` that only lists
    /// `passthrough` alike. Going back to `inherit` takes an explicit entry.
    #[test]
    fn agents_json_entry_without_env_policy_reads_as_allowlist() {
        assert_eq!(EnvPolicy::default().isolation, EnvIsolation::Allowlist);
        let raw = r#"[{ "id": "my-agent", "name": "Mine", "command": "mine" },
                      { "id": "claude", "name": "Claude Code", "command": "claude" },
                      { "id": "kimi", "name": "Kimi", "command": "kimi",
                        "envPolicy": { "passthrough": ["KIMI_EXTRA"] } }]"#;
        let overrides: ProfilesFile = serde_json::from_str(raw).expect("parse");
        let merged = merge_profiles(default_profiles(), overrides.into_vec());
        for id in ["my-agent", "claude", "kimi"] {
            let profile = merged.iter().find(|p| p.id == id).expect(id);
            assert_eq!(
                profile.env_policy.isolation,
                EnvIsolation::Allowlist,
                "{id} without an isolation level"
            );
        }
        // The profile as a whole, e.g. a stored one without the field.
        let stored: AgentProfile =
            serde_json::from_str(r#"{ "id": "x", "name": "x", "command": "x" }"#).expect("parse");
        assert_eq!(stored.env_policy.isolation, EnvIsolation::Allowlist);
    }

    /// W5-02b6: `envPolicy` is how an entry goes back to `inherit` now that
    /// the default is `allowlist`, so the diagnostics must not call it an
    /// ignored field. A really unknown key still warns.
    #[test]
    fn diagnostics_accept_env_policy_as_a_runtime_field() {
        let with_policy = r#"[{ "id": "claude", "name": "Claude Code", "command": "claude",
                                "envPolicy": { "isolation": "inherit" } }]"#;
        assert!(!has_unsupported_fields(with_policy));
        let snake = r#"{ "profiles": [{ "id": "x", "name": "x", "command": "x",
                                         "env_policy": { "isolation": "strict" } }] }"#;
        assert!(!has_unsupported_fields(snake));
        // Review W5-02b6: the snake-case key really is read, not only
        // tolerated - the Rust field name is `env_policy`, `envPolicy` its
        // alias.
        let overrides: ProfilesFile = serde_json::from_str(snake).expect("parse");
        let merged = merge_profiles(default_profiles(), overrides.into_vec());
        let x = merged.iter().find(|p| p.id == "x").expect("x");
        assert_eq!(x.env_policy.isolation, EnvIsolation::Strict);
        let unknown = r#"[{ "id": "x", "name": "x", "command": "x", "sandbox": true }]"#;
        assert!(has_unsupported_fields(unknown));
    }

    #[test]
    fn env_policy_is_read_from_agents_json() {
        let raw = r#"[{ "id": "kimi", "name": "Kimi", "command": "kimi",
                        "envPolicy": { "isolation": "strict",
                                       "passthrough": ["MOONSHOT_API_KEY"] } }]"#;
        let overrides: ProfilesFile = serde_json::from_str(raw).expect("parse");
        let merged = merge_profiles(default_profiles(), overrides.into_vec());
        let kimi = merged.iter().find(|p| p.id == "kimi").expect("kimi");
        assert_eq!(kimi.env_policy.isolation, EnvIsolation::Strict);
        assert_eq!(kimi.env_policy.passthrough, vec!["MOONSHOT_API_KEY"]);
    }

    #[test]
    fn override_without_caps_inherits_same_id_defaults() {
        let raw = r#"[{ "id": "claude", "name": "My Claude", "command": "claude-canary" }]"#;
        let overrides: ProfilesFile = serde_json::from_str(raw).expect("parse");
        let merged = merge_profiles(default_profiles(), overrides.into_vec());
        let claude = merged.iter().find(|p| p.id == "claude").expect("claude");
        assert_eq!(claude.command, "claude-canary");
        assert_eq!(
            claude.caps.lifecycle,
            Lifecycle::SettingsHooks {
                flag: "--settings".into()
            }
        );
    }

    #[test]
    fn explicit_caps_replace_the_whole_default() {
        let raw = r#"[{ "id": "claude", "name": "Bare Claude", "command": "claude",
                        "caps": { "lifecycle": { "mode": "heuristic" } } }]"#;
        let overrides: ProfilesFile = serde_json::from_str(raw).expect("parse");
        let merged = merge_profiles(default_profiles(), overrides.into_vec());
        let claude = merged.iter().find(|p| p.id == "claude").expect("claude");
        assert_eq!(claude.caps.lifecycle, Lifecycle::Heuristic);
        assert_eq!(claude.caps.system_prompt, SystemPrompt::Unsupported);
    }

    /// Phase 14: `enabled` is a settings fact, not a profile fact. Every
    /// profile that comes out of this module is on; switching one off happens
    /// in the settings table, and an `agents.json` written before the field
    /// existed still parses.
    #[test]
    fn profiles_start_enabled_and_an_older_agents_json_still_loads() {
        assert!(default_profiles().iter().all(|profile| profile.enabled));
        let raw = r#"[{ "id": "claude", "name": "My Claude", "command": "claude-canary" }]"#;
        let overrides: ProfilesFile = serde_json::from_str(raw).expect("parse");
        let merged = merge_profiles(default_profiles(), overrides.into_vec());
        assert!(merged.iter().all(|profile| profile.enabled));
    }

    #[test]
    fn new_id_without_caps_gets_cautious_defaults() {
        let raw = r#"[{ "id": "aider", "name": "Aider", "command": "aider" }]"#;
        let overrides: ProfilesFile = serde_json::from_str(raw).expect("parse");
        let merged = merge_profiles(default_profiles(), overrides.into_vec());
        let aider = merged.iter().find(|p| p.id == "aider").expect("appended");
        assert_eq!(aider.caps, AgentCapabilities::default());
    }

    // -- env (phase 19 T1) -------------------------------------------------

    #[test]
    fn defaults_carry_no_env_and_an_override_can_add_one() {
        assert!(default_profiles()
            .iter()
            .all(|profile| profile.env.is_empty()));

        let raw = r#"[{ "id": "claude-omni", "name": "Claude via OmniRoute",
                        "command": "claude", "args": ["--model", "auto/coding"],
                        "env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:20128",
                                 "ANTHROPIC_AUTH_TOKEN": "projecta-local" } }]"#;
        let overrides: ProfilesFile = serde_json::from_str(raw).expect("parse");
        let merged = merge_profiles(default_profiles(), overrides.into_vec());
        let omni = merged
            .iter()
            .find(|p| p.id == "claude-omni")
            .expect("appended");
        assert_eq!(
            omni.env.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("http://127.0.0.1:20128")
        );
        assert_eq!(
            omni.env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("projecta-local")
        );
        // Everything the override did not mention stays as it was.
        assert!(merged
            .iter()
            .find(|p| p.id == "claude")
            .expect("claude")
            .env
            .is_empty());
    }

    /// `docs/agents-json.md` carries the example a user copies into place. A
    /// documented profile that no longer parses is worse than no doc at all -
    /// it still looks authoritative. One value, two carriers, like the CSP.
    #[test]
    fn the_documented_openinterpreter_profile_parses() {
        let doc = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("docs")
                .join("agents-json.md"),
        )
        .expect("docs/agents-json.md");
        // The block that carries the profile, not merely the first one: a
        // later edit may well put a smaller example above it (reviewer A).
        let json = doc
            .split("```json")
            .skip(1)
            .filter_map(|rest| rest.split("```").next())
            .find(|block| block.contains("conventionAt"))
            .expect("a json block naming conventionAt in docs/agents-json.md");

        let overrides: ProfilesFile = serde_json::from_str(json).expect("parse");
        let merged = merge_profiles(default_profiles(), overrides.into_vec());
        let profile = merged
            .iter()
            .find(|p| p.id == "interpreter")
            .expect("the documented profile");

        assert_eq!(profile.command, "interpreter");
        // The one thing the doc claims from openinterpreter's own source:
        // it reads repo skills from `.agents/skills`, not `.claude/skills`.
        assert_eq!(
            profile.caps.skills,
            SkillsDiscovery::ConventionAt {
                dir: ".agents/skills".into()
            }
        );
        // And everything the doc says stays cautious really does stay there -
        // nothing about this agent is measured yet.
        assert_eq!(profile.caps.system_prompt, SystemPrompt::Unsupported);
        assert_eq!(profile.caps.lifecycle, Lifecycle::Heuristic);
        assert_eq!(profile.caps.dialect, Dialect::default());
        assert!(profile.caps.readiness_marker.is_none());
        assert!(profile.env.is_empty());
        assert_eq!(profile.fallback, None, "nobody is rerouted silently");
        // A new id is appended, it does not displace a built-in.
        assert!(merged.iter().any(|p| p.id == "claude"));
    }

    // -- fallback (phase 19 T4) --------------------------------------------

    /// Nothing built in reroutes anything: a ProjectA that was never
    /// configured stops at a quota block exactly as it did before.
    #[test]
    fn defaults_name_no_fallback_and_an_override_can_name_one() {
        assert!(default_profiles()
            .iter()
            .all(|profile| profile.fallback.is_none()));

        let raw = r#"[{ "id": "claude", "name": "My Claude", "command": "claude",
                        "fallback": "opencode-free" },
                      { "id": "opencode-free", "name": "Free", "command": "opencode" }]"#;
        let overrides: ProfilesFile = serde_json::from_str(raw).expect("parse");
        let merged = merge_profiles(default_profiles(), overrides.into_vec());
        let claude = merged.iter().find(|p| p.id == "claude").expect("claude");
        assert_eq!(claude.fallback.as_deref(), Some("opencode-free"));
        // The target the chain ends on, and every profile the file never
        // mentioned, keep no fallback at all.
        assert_eq!(
            merged
                .iter()
                .find(|p| p.id == "opencode-free")
                .expect("free")
                .fallback,
            None
        );
        assert_eq!(
            merged
                .iter()
                .find(|p| p.id == "kimi")
                .expect("kimi")
                .fallback,
            None
        );
    }

    /// An `agents.json` written before the field existed still parses, and an
    /// override that omits `env` clears nothing it never set.
    #[test]
    fn an_override_without_env_keeps_the_profile_env_free() {
        let raw = r#"[{ "id": "claude", "name": "My Claude", "command": "claude-canary" }]"#;
        let overrides: ProfilesFile = serde_json::from_str(raw).expect("parse");
        let merged = merge_profiles(default_profiles(), overrides.into_vec());
        let claude = merged.iter().find(|p| p.id == "claude").expect("claude");
        assert_eq!(claude.command, "claude-canary");
        assert!(claude.env.is_empty());
    }

    /// Phase 19 T2: `claude-omni` is a new id, so the same-id rule cannot help
    /// it. Without inheritance it would drive Claude Code with the cautious
    /// defaults - no hooks, no skills, no system prompt - which is exactly the
    /// capability set the built-in `claude` profile exists to avoid.
    #[test]
    fn a_dash_suffixed_id_inherits_the_base_profile_capabilities() {
        let raw = r#"[{ "id": "claude-omni", "name": "Claude via OmniRoute",
                        "command": "claude", "args": ["--model", "auto/coding"] }]"#;
        let overrides: ProfilesFile = serde_json::from_str(raw).expect("parse");
        let merged = merge_profiles(default_profiles(), overrides.into_vec());
        let omni = merged
            .iter()
            .find(|p| p.id == "claude-omni")
            .expect("appended");
        let claude = merged.iter().find(|p| p.id == "claude").expect("claude");
        assert_eq!(omni.caps, claude.caps);
        assert_eq!(
            omni.caps.lifecycle,
            Lifecycle::SettingsHooks {
                flag: "--settings".into()
            }
        );
    }

    /// The longest matching base wins, and explicit caps still replace
    /// everything - inheritance is a fallback, never an override.
    #[test]
    fn the_longest_base_wins_and_explicit_caps_still_replace_it() {
        let raw = r#"[{ "id": "kimi-omni", "name": "Kimi routed", "command": "kimi",
                        "caps": { "lifecycle": { "mode": "heuristic" } } },
                      { "id": "opencode-glm-53-flash-omni", "name": "GLM routed",
                        "command": "opencode" }]"#;
        let overrides: ProfilesFile = serde_json::from_str(raw).expect("parse");
        let merged = merge_profiles(default_profiles(), overrides.into_vec());
        let kimi_omni = merged
            .iter()
            .find(|p| p.id == "kimi-omni")
            .expect("kimi-omni");
        assert_eq!(kimi_omni.caps.system_prompt, SystemPrompt::Unsupported);
        assert_eq!(kimi_omni.caps.lifecycle, Lifecycle::Heuristic);

        let glm = merged
            .iter()
            .find(|p| p.id == "opencode-glm-53-flash-omni")
            .expect("glm-omni");
        assert_eq!(
            glm.caps,
            AgentCapabilities {
                skills: SkillsDiscovery::ConventionAt {
                    dir: ".agents/skills".into()
                },
                readiness_marker: Some("Ask anything".into()),
                ..AgentCapabilities::default()
            },
            "an opencode-* variant inherits the base's readiness marker and its probed skill discovery"
        );
    }

    /// An id that is not a `<base>-<suffix>` of anything keeps the cautious
    /// defaults: "claudeomni" is not a Claude variant, and neither is "aider".
    #[test]
    fn an_unrelated_id_still_gets_cautious_defaults() {
        let raw = r#"[{ "id": "claudeomni", "name": "Not Claude", "command": "x" }]"#;
        let overrides: ProfilesFile = serde_json::from_str(raw).expect("parse");
        let merged = merge_profiles(default_profiles(), overrides.into_vec());
        let odd = merged
            .iter()
            .find(|p| p.id == "claudeomni")
            .expect("appended");
        assert_eq!(odd.caps, AgentCapabilities::default());
    }

    /// Phase 19 T2: the template shipped in `resources/` is an `agents.json`
    /// like any other, so it has to survive this module's parser and come out
    /// with capabilities its routed CLIs can actually use.
    #[test]
    fn the_shipped_omniroute_template_merges_into_usable_profiles() {
        let raw = include_str!("../resources/agents-omniroute.json");
        let parsed: ProfilesFile = serde_json::from_str(raw).expect("template parses");
        let merged = merge_profiles(default_profiles(), parsed.into_vec());

        let claude = merged.iter().find(|p| p.id == "claude").expect("claude");
        let omni = merged
            .iter()
            .find(|p| p.id == "claude-omni")
            .expect("claude-omni");
        assert_eq!(omni.command, "claude");
        assert_eq!(omni.args, vec!["--model", "auto/coding"]);
        assert_eq!(omni.caps, claude.caps, "a routed Claude is still Claude");
        assert_eq!(
            omni.env.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("http://127.0.0.1:20128")
        );
        assert!(omni.env.contains_key("ANTHROPIC_AUTH_TOKEN"));

        let codex_base = merged.iter().find(|p| p.id == "codex").expect("codex");
        let codex = merged
            .iter()
            .find(|p| p.id == "codex-omni")
            .expect("codex-omni");
        assert_eq!(codex.command, "codex");
        assert_eq!(
            codex
                .env
                .get(crate::routing::CODEX_HOME_ENV)
                .map(String::as_str),
            Some(".pa/codex-home"),
            "the generated config has to land inside the worktree"
        );
        assert_eq!(codex.caps, codex_base.caps, "a routed Codex is still Codex");

        let free = merged
            .iter()
            .find(|p| p.id == "opencode-free")
            .expect("opencode-free");
        assert_eq!(free.command, "opencode");
        assert_eq!(free.args, vec!["-m", "opencode/big-pickle"]);
        assert!(free.env.is_empty(), "the free profile needs no key at all");

        // Phase 19 T4: both routed profiles fall back onto the keyless one,
        // which ends the chain rather than pointing back into it.
        assert_eq!(omni.fallback.as_deref(), Some("opencode-free"));
        assert_eq!(codex.fallback.as_deref(), Some("opencode-free"));
        assert_eq!(free.fallback, None);

        // The template adds profiles; it takes none away and reroutes none of
        // the built-ins, so an unrouted spawn stays unrouted.
        for id in ["claude", "codex", "opencode", "kimi", "ollama"] {
            let built_in = merged.iter().find(|p| p.id == id).expect(id);
            assert!(built_in.env.is_empty(), "{id} must stay unrouted");
        }
    }
}
