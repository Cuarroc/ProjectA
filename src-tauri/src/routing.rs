//! The routing funnel: the environment one agent spawn carries.
//!
//! Every spawn in ProjectA used to take its environment straight from
//! [`crate::ruflo::agent_env`] - the shared memory store and the session id,
//! and nothing else. Phase 19 needs one more thing in that environment: the
//! variables that point a CLI at a router instead of at its vendor
//! (`ANTHROPIC_BASE_URL` for Claude Code, `CODEX_HOME` for Codex). Those are
//! configuration, not code, so they live on the profile
//! ([`AgentProfile::env`], filled from `agents.json`) and are merged here.
//!
//! Two rules make this safe to put in front of every spawn:
//!
//! 1. **A profile without `env` changes nothing.** The result is then byte for
//!    byte what `ruflo::agent_env` returned, so an unconfigured ProjectA
//!    spawns exactly the process it did before.
//! 2. **The profile wins.** A key set on the profile replaces the same key
//!    from the funnel, because the person who wrote `agents.json` knows more
//!    about their setup than this module does.
//!
//! Codex is the one agent that cannot be routed by environment alone: it reads
//! its provider from a `config.toml` inside `CODEX_HOME`. That file is
//! generated here, at spawn time, from the same profile env - see
//! [`prepare_codex_home`].

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::profiles::AgentProfile;

/// Codex's own variable: the directory it reads `config.toml` from.
pub const CODEX_HOME_ENV: &str = "CODEX_HOME";

/// ProjectA's variables, read off the profile env when generating Codex's
/// config. They are plain configuration - no CLI reads them itself.
pub const BASE_URL_ENV: &str = "OMNIROUTE_BASE_URL";
pub const MODEL_ENV: &str = "OMNIROUTE_MODEL";
pub const API_KEY_ENV: &str = "OMNIROUTE_API_KEY";

/// The virtual model a routed Codex asks for when the profile names none.
const DEFAULT_MODEL: &str = "auto/cheap";

/// ProjectA product modes. These are contracts, not OmniRoute combo names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProductMode {
    Reliable,
    Cheap,
    Review,
}

impl ProductMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Reliable => "reliable",
            Self::Cheap => "cheap",
            Self::Review => "review",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        match name.trim() {
            "reliable" => Some(Self::Reliable),
            "cheap" => Some(Self::Cheap),
            "review" => Some(Self::Review),
            _ => None,
        }
    }

    /// OmniRoute virtual model this product mode asks for today.
    ///
    /// `reliable` → `auto/coding` (tool-capable, proven).
    /// `cheap` → `auto/cheap`.
    /// `review` → `auto/review`; if the daemon has no such combo the probe
    /// is a visible 4xx, not a silent fallback onto the author's route.
    pub fn omniroute_model(self) -> &'static str {
        match self {
            Self::Reliable => "auto/coding",
            Self::Cheap => "auto/cheap",
            Self::Review => "auto/review",
        }
    }
}

/// Settings key for the product mode. Existing `get_setting` / `set_setting`.
pub const SETTING_PRODUCT_MODE: &str = "routing.product_mode";

/// How a chat HTTP response is classified. This is product code, not the
/// OmniRoute management probe (`UsageError` on GET `/api/usage/*`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChatFailure {
    /// 503 body names `chat_admission_busy`. Not a model failure.
    AdmissionBusy,
    /// Any other 4xx, including the live `auto/review` unknown-combo 400.
    Client { status: u16 },
    /// 5xx other than admission-busy.
    Server { status: u16 },
}

/// Classify a completed chat HTTP response. 2xx is `Ok`.
pub fn classify_chat_http(status: u16, body: &str) -> Result<(), ChatFailure> {
    if (200..300).contains(&status) {
        return Ok(());
    }
    let lower = body.to_ascii_lowercase();
    if status == 503 && lower.contains("chat_admission_busy") {
        return Err(ChatFailure::AdmissionBusy);
    }
    if (400..500).contains(&status) {
        return Err(ChatFailure::Client { status });
    }
    Err(ChatFailure::Server { status })
}

/// Transport-level class used by the 20-run suite. HTTP 100–599 always map
/// onto [`classify_chat_http`]; missing or non-HTTP codes stay unclassified
/// so a dead probe cannot be counted as a classified 5xx.
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)] // used by the 20-run suite and its tests
pub enum ChatTransport {
    Ok,
    Failed(ChatFailure),
    Unclassified { detail: String },
}

#[allow(dead_code)] // used by the 20-run suite and its tests
pub fn classify_chat_transport(status: Option<u16>, body: &str) -> ChatTransport {
    match status {
        None => ChatTransport::Unclassified {
            detail: "no http status".to_string(),
        },
        Some(code) if !(100..=599).contains(&code) => ChatTransport::Unclassified {
            detail: format!("non-http status {code}"),
        },
        Some(code) => match classify_chat_http(code, body) {
            Ok(()) => ChatTransport::Ok,
            Err(failure) => ChatTransport::Failed(failure),
        },
    }
}

/// What to do after a classified chat failure. Review never falls onto the
/// author model. Cheap may retry once as reliable, visibly. Admission-busy
/// is held, not remapped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Failover {
    Hold,
    RetryVisible { from: ProductMode, to: ProductMode },
    Block { reason: &'static str },
}

pub fn failover_on_chat_failure(mode: ProductMode, failure: &ChatFailure) -> Failover {
    match (mode, failure) {
        (ProductMode::Review, _) => Failover::Block {
            reason: "review cannot fall back to the author model",
        },
        (ProductMode::Cheap, ChatFailure::Client { .. }) => Failover::RetryVisible {
            from: ProductMode::Cheap,
            to: ProductMode::Reliable,
        },
        (_, ChatFailure::AdmissionBusy) => Failover::Hold,
        (ProductMode::Cheap, ChatFailure::Server { .. }) => Failover::Hold,
        (ProductMode::Reliable, _) => Failover::Hold,
    }
}

/// Whether `review` currently resolves to an independent reviewer family.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReviewAvailability {
    /// Constructed when a 2xx review probe names a resolved model.
    #[allow(dead_code)]
    Independent {
        model: String,
    },
    Unresolved {
        detail: String,
    },
}

fn review_slot() -> &'static Mutex<ReviewAvailability> {
    static SLOT: std::sync::OnceLock<Mutex<ReviewAvailability>> = std::sync::OnceLock::new();
    SLOT.get_or_init(|| {
        Mutex::new(ReviewAvailability::Unresolved {
            detail: "auto/review is not a known combo (O-0 400)".to_string(),
        })
    })
}

fn review_lock() -> std::sync::MutexGuard<'static, ReviewAvailability> {
    review_slot()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn review_availability() -> ReviewAvailability {
    review_lock().clone()
}

pub fn set_review_availability(value: ReviewAvailability) {
    *review_lock() = value;
}

/// Record a completed review-mode chat probe. A 2xx with a resolved model
/// marks the family independent; anything else stays unresolved. Never
/// silently maps onto `auto/cheap` or `auto/coding`.
pub fn record_review_probe(status: u16, body: &str, resolved_model: Option<&str>) {
    set_review_availability(availability_from_probe(status, body, resolved_model));
}

pub fn availability_from_probe(
    status: u16,
    body: &str,
    resolved_model: Option<&str>,
) -> ReviewAvailability {
    match classify_chat_http(status, body) {
        Ok(()) => match resolved_model {
            Some(model) if !model.is_empty() => ReviewAvailability::Independent {
                model: model.to_string(),
            },
            _ => ReviewAvailability::Unresolved {
                detail: "review returned 2xx without a resolved model".to_string(),
            },
        },
        Err(_) => ReviewAvailability::Unresolved {
            detail: review_unresolved_detail(status, body),
        },
    }
}

fn review_unresolved_detail(status: u16, body: &str) -> String {
    let lower = body.to_ascii_lowercase();
    if lower.contains("unknown combo") {
        format!("HTTP {status}: auto/review is not a known combo")
    } else {
        format!("HTTP {status}: review did not resolve to an independent family")
    }
}

pub async fn current_product_mode(store: &crate::store::Store) -> ProductMode {
    store
        .get_setting(SETTING_PRODUCT_MODE)
        .await
        .ok()
        .flatten()
        .as_deref()
        .and_then(ProductMode::parse)
        .unwrap_or(ProductMode::Cheap)
}

pub async fn set_product_mode(
    store: &crate::store::Store,
    mode: ProductMode,
) -> Result<(), String> {
    store.set_setting(SETTING_PRODUCT_MODE, mode.as_str()).await
}

/// Refuse a spawn that would silently run `review` on the author model.
pub async fn ensure_spawnable(store: &crate::store::Store) -> Result<(), String> {
    let mode = current_product_mode(store).await;
    ensure_mode_spawnable(mode)
}

pub fn ensure_mode_spawnable(mode: ProductMode) -> Result<(), String> {
    if mode != ProductMode::Review {
        return Ok(());
    }
    match review_availability() {
        ReviewAvailability::Independent { .. } => Ok(()),
        ReviewAvailability::Unresolved { detail } => Err(format!(
            "refused: review is blocked until an independent reviewer family is available ({detail})"
        )),
    }
}

/// Requested product mode vs actually resolved model. Spawn logs this with
/// `resolved` empty; a later chat probe fills it.
pub fn attribution_line(requested: ProductMode, resolved_model: Option<&str>) -> String {
    format!(
        "Routing: requested {} ({}); resolved {}",
        requested.as_str(),
        requested.omniroute_model(),
        resolved_model.unwrap_or("unresolved")
    )
}

/// Env + profile overlay for one spawn, after the review guard.
pub struct SpawnRouting {
    pub env: Vec<(String, String)>,
    pub profile: AgentProfile,
    pub attribution: String,
}

pub async fn spawn_routing(
    store: &crate::store::Store,
    profile: &AgentProfile,
    repo_path: Option<&Path>,
    worker_id: &str,
) -> Result<SpawnRouting, String> {
    let requested = current_product_mode(store).await;
    let (mode, failover) = spawn_mode_after_failover(requested);
    ensure_mode_spawnable(mode)?;
    let mut env = match repo_path {
        Some(repo) => spawn_env(profile, repo, worker_id),
        None => merge_profile_env(profile, Vec::new()),
    };
    apply_product_mode(&mut env, mode);
    let mut profile = profile.clone();
    profile
        .env
        .insert(MODEL_ENV.to_string(), mode.omniroute_model().to_string());
    let mut attribution = attribution_line(requested, None);
    if let Some(Failover::RetryVisible { from, to }) = failover {
        attribution = format!(
            "{attribution}; failover {} → {}",
            from.as_str(),
            to.as_str()
        );
    }
    Ok(SpawnRouting {
        env,
        profile,
        attribution,
    })
}

fn apply_product_mode(env: &mut Vec<(String, String)>, mode: ProductMode) {
    let model = mode.omniroute_model().to_string();
    match env.iter_mut().find(|(key, _)| key == MODEL_ENV) {
        Some(slot) => slot.1 = model,
        None => env.push((MODEL_ENV.to_string(), model)),
    }
}

fn chat_failure_slot() -> &'static Mutex<Option<ChatFailure>> {
    static SLOT: std::sync::OnceLock<Mutex<Option<ChatFailure>>> = std::sync::OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

fn chat_failure_lock() -> std::sync::MutexGuard<'static, Option<ChatFailure>> {
    chat_failure_slot()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Remember a classified live chat failure for the next spawn.
pub fn record_chat_failure(failure: ChatFailure) {
    *chat_failure_lock() = Some(failure);
}

/// Classify a live chat HTTP outcome and keep failures for spawn failover.
pub fn note_live_chat_outcome(status: Option<u16>, body: &str) {
    if let ChatTransport::Failed(failure) = classify_chat_transport(status, body) {
        record_chat_failure(failure);
    }
}

/// Consume the last live failure and apply [`failover_on_chat_failure`].
/// Only the spawn that actually applies the failover consumes the signal —
/// a reliable or review spawn in between must not eat the one-shot, or the
/// cheap spawn the signal was meant for runs into the same 4xx again.
pub fn spawn_mode_after_failover(requested: ProductMode) -> (ProductMode, Option<Failover>) {
    let mut slot = chat_failure_lock();
    let Some(failure) = slot.clone() else {
        return (requested, None);
    };
    let decision = failover_on_chat_failure(requested, &failure);
    match &decision {
        Failover::RetryVisible { to, .. } => {
            *slot = None;
            (*to, Some(decision))
        }
        _ => (requested, Some(decision)),
    }
}

#[cfg(test)]
fn clear_chat_failure() {
    *chat_failure_lock() = None;
}

/// Snapshot the Settings tab needs. No secrets.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingStatus {
    pub mode: String,
    pub review_independent: bool,
    pub review_detail: String,
}

pub async fn routing_status(store: &crate::store::Store) -> RoutingStatus {
    // O-0 live evidence: auto/review is a 400 unknown combo. Classify it in
    // product code so Settings can show the block instead of a silent fallback.
    const O0_REVIEW_BODY: &str = r#"{"error":"unknown combo"}"#;
    let classified = classify_chat_http(400, O0_REVIEW_BODY);
    let failover = classified
        .as_ref()
        .err()
        .map(|failure| failover_on_chat_failure(ProductMode::Review, failure));
    let mode = current_product_mode(store).await;
    let review = review_availability();
    let (review_independent, mut review_detail) = match review {
        ReviewAvailability::Independent { model } => (true, model),
        ReviewAvailability::Unresolved { detail } => (false, detail),
    };
    if let Some(Failover::Block { reason }) = failover {
        if !review_independent && !review_detail.contains(reason) {
            review_detail = format!("{review_detail}; {reason}");
        }
    }
    RoutingStatus {
        mode: mode.as_str().to_string(),
        review_independent,
        review_detail,
    }
}

/// Provider key inside Codex's config; only this module writes the file.
const PROVIDER_ID: &str = "omniroute";

/// Environment for one agent spawn: the shared ruflo memory of the project,
/// plus whatever the profile adds on top.
///
/// `repo_path` is the project's repository - the ruflo store is per project,
/// not per worktree - and `worker_id` becomes the ruflo session.
pub fn spawn_env(
    profile: &AgentProfile,
    repo_path: &Path,
    worker_id: &str,
) -> Vec<(String, String)> {
    merge_profile_env(profile, crate::ruflo::agent_env(repo_path, worker_id))
}

/// [`spawn_env`] without the funnel: lay the profile's own variables over an
/// environment that was assembled elsewhere.
///
/// The respawn path needs this. A worker whose project row has gone still gets
/// restarted, with no shared memory to point at - but a routed profile must
/// keep its router, or the agent would quietly come back up talking to its
/// vendor instead.
pub fn merge_profile_env(
    profile: &AgentProfile,
    mut env: Vec<(String, String)>,
) -> Vec<(String, String)> {
    for (key, value) in &profile.env {
        match env.iter_mut().find(|(existing, _)| existing == key) {
            Some(slot) => slot.1 = value.clone(),
            None => env.push((key.clone(), value.clone())),
        }
    }
    env
}

/// Write Codex's `config.toml` into the worktree, so a `codex-*` profile talks
/// to the router instead of to OpenAI.
///
/// `cwd` is the directory the agent is spawned in, because `CODEX_HOME` is
/// resolved relative to it - the same way Codex itself resolves it.
///
/// Does nothing unless the profile actually runs `codex` and carries a
/// *relative* `CODEX_HOME`. An absolute path is somebody's real Codex home
/// (`~/.codex`), and this function will not write over a config a person
/// maintains by hand.
///
/// Returns the file it wrote. Failures return `None` and are not raised: a
/// missing router config makes Codex fall back to its own defaults, which is a
/// worse spawn but still a spawn.
pub fn prepare_codex_home(profile: &AgentProfile, cwd: &Path) -> Option<PathBuf> {
    if !runs_codex(&profile.command) {
        return None;
    }
    let home = Path::new(profile.env.get(CODEX_HOME_ENV)?);
    if home.is_absolute() {
        return None;
    }
    let dir = cwd.join(home);
    std::fs::create_dir_all(&dir).ok()?;

    let base_url = profile
        .env
        .get(BASE_URL_ENV)
        .cloned()
        .unwrap_or_else(default_base_url);
    let model = profile
        .env
        .get(MODEL_ENV)
        .map_or(DEFAULT_MODEL, String::as_str);
    let path = dir.join("config.toml");
    std::fs::write(&path, codex_config(&base_url, model)).ok()?;
    Some(path)
}

/// Is this profile launching Codex? The command may carry a path or a Windows
/// extension, so the stem decides rather than the whole string.
fn runs_codex(command: &str) -> bool {
    Path::new(command)
        .file_stem()
        .is_some_and(|stem| stem.eq_ignore_ascii_case("codex"))
}

/// Where OmniRoute listens when the profile does not say: the local router,
/// OpenAI-compatible root.
fn default_base_url() -> String {
    format!("http://127.0.0.1:{}/v1", crate::omniroute::DEFAULT_PORT)
}

/// Codex's `config.toml` for one routed profile.
///
/// `wire_api = "responses"` is what OmniRoute speaks back to Codex, and
/// `env_key` names the variable Codex reads its bearer token from - the router
/// accepts any, but Codex refuses to start a provider without one.
fn codex_config(base_url: &str, model: &str) -> String {
    format!(
        "# Generated by ProjectA at spawn time - edits are overwritten.\n\
         model = \"{model}\"\n\
         model_provider = \"{PROVIDER_ID}\"\n\
         \n\
         [model_providers.{PROVIDER_ID}]\n\
         name = \"OmniRoute\"\n\
         base_url = \"{base_url}\"\n\
         wire_api = \"responses\"\n\
         env_key = \"{API_KEY_ENV}\"\n",
        model = toml_escape(model),
        base_url = toml_escape(base_url),
    )
}

/// The two characters a TOML basic string cannot carry raw. Values come from a
/// hand-written `agents.json`, so a stray quote must not produce a config that
/// silently fails to parse.
fn toml_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capabilities::AgentCapabilities;
    use crate::ruflo::{MEMORY_PATH_ENV, SESSION_ENV};
    use crate::testutil::TempDir;

    fn profile(command: &str, env: &[(&str, &str)]) -> AgentProfile {
        let json = serde_json::json!({
            "id": format!("{command}-omni"),
            "name": "routed",
            "command": command,
            "args": [],
            "caps": AgentCapabilities::default(),
            "env": env.iter().copied().collect::<std::collections::BTreeMap<_, _>>(),
        });
        serde_json::from_value(json).expect("profile")
    }

    fn value<'a>(env: &'a [(String, String)], key: &str) -> Option<&'a str> {
        env.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }

    #[test]
    fn a_profile_without_env_spawns_exactly_what_ruflo_hands_over() {
        let dir = TempDir::new("routing-plain");
        let plain = profile("claude", &[]);
        assert_eq!(
            spawn_env(&plain, dir.path(), "wk-1"),
            crate::ruflo::agent_env(dir.path(), "wk-1")
        );
    }

    #[test]
    fn profile_env_is_appended_to_the_funnel() {
        let dir = TempDir::new("routing-append");
        let routed = profile(
            "claude",
            &[
                ("ANTHROPIC_BASE_URL", "http://127.0.0.1:20128"),
                ("ANTHROPIC_AUTH_TOKEN", "projecta-local"),
            ],
        );
        let env = spawn_env(&routed, dir.path(), "wk-2");

        assert_eq!(
            value(&env, "ANTHROPIC_BASE_URL"),
            Some("http://127.0.0.1:20128")
        );
        assert_eq!(value(&env, "ANTHROPIC_AUTH_TOKEN"), Some("projecta-local"));
        // The shared memory store survives the merge.
        assert_eq!(value(&env, SESSION_ENV), Some("wk-2"));
        assert!(value(&env, MEMORY_PATH_ENV)
            .expect("memory")
            .ends_with("memory"));
    }

    /// Whoever wrote `agents.json` outranks the funnel: the same key appears
    /// once, with the profile's value.
    #[test]
    fn profile_env_overrides_a_key_the_funnel_already_set() {
        let dir = TempDir::new("routing-override");
        let routed = profile("claude", &[(SESSION_ENV, "fixed-session")]);
        let env = spawn_env(&routed, dir.path(), "wk-3");

        assert_eq!(value(&env, SESSION_ENV), Some("fixed-session"));
        assert_eq!(
            env.iter().filter(|(k, _)| k == SESSION_ENV).count(),
            1,
            "{env:?}"
        );
    }

    /// The respawn path with no project row: no funnel, but the routing still
    /// travels with the profile.
    #[test]
    fn merging_onto_an_empty_environment_yields_the_profile_env() {
        let routed = profile(
            "claude",
            &[("ANTHROPIC_BASE_URL", "http://127.0.0.1:20128")],
        );
        assert_eq!(
            merge_profile_env(&routed, Vec::new()),
            vec![(
                "ANTHROPIC_BASE_URL".to_string(),
                "http://127.0.0.1:20128".to_string()
            )]
        );
        assert!(merge_profile_env(&profile("claude", &[]), Vec::new()).is_empty());
    }

    #[test]
    fn a_routed_codex_gets_a_generated_config_toml() {
        let dir = TempDir::new("routing-codex");
        let routed = profile(
            "codex",
            &[
                (CODEX_HOME_ENV, ".pa/codex-home"),
                (BASE_URL_ENV, "http://127.0.0.1:20128/v1"),
                (MODEL_ENV, "auto/cheap"),
            ],
        );

        let written = prepare_codex_home(&routed, dir.path()).expect("config written");
        assert_eq!(
            written,
            dir.path().join(".pa/codex-home").join("config.toml")
        );
        let body = std::fs::read_to_string(&written).expect("read config");
        assert!(
            body.contains("base_url = \"http://127.0.0.1:20128/v1\""),
            "{body}"
        );
        assert!(body.contains("wire_api = \"responses\""), "{body}");
        assert!(body.contains("model = \"auto/cheap\""), "{body}");
        assert!(
            body.contains(&format!("[model_providers.{PROVIDER_ID}]")),
            "{body}"
        );
    }

    /// Without a base URL on the profile the local router is assumed - the
    /// generated file is never half a config.
    #[test]
    fn the_generated_config_falls_back_to_the_local_router() {
        let dir = TempDir::new("routing-codex-default");
        let routed = profile("codex", &[(CODEX_HOME_ENV, "codex-home")]);
        let written = prepare_codex_home(&routed, dir.path()).expect("config written");
        let body = std::fs::read_to_string(&written).expect("read config");
        assert!(
            body.contains(&format!(
                "base_url = \"http://127.0.0.1:{}/v1\"",
                crate::omniroute::DEFAULT_PORT
            )),
            "{body}"
        );
        assert!(
            body.contains(&format!("model = \"{DEFAULT_MODEL}\"")),
            "{body}"
        );
    }

    #[test]
    fn nothing_is_written_for_other_agents_or_without_codex_home() {
        let dir = TempDir::new("routing-codex-skip");
        let claude = profile("claude", &[(CODEX_HOME_ENV, ".pa/codex-home")]);
        assert_eq!(prepare_codex_home(&claude, dir.path()), None);

        let bare_codex = profile("codex", &[]);
        assert_eq!(prepare_codex_home(&bare_codex, dir.path()), None);

        assert!(!dir.path().join(".pa").exists(), "no directory may appear");
    }

    /// An absolute `CODEX_HOME` is a real Codex home. ProjectA reads it, never
    /// writes it.
    #[test]
    fn an_absolute_codex_home_is_left_alone() {
        let dir = TempDir::new("routing-codex-absolute");
        let home = dir.path().join("real-codex-home");
        std::fs::create_dir_all(&home).expect("home");
        std::fs::write(home.join("config.toml"), "# mine\n").expect("existing config");

        let routed = profile("codex", &[(CODEX_HOME_ENV, &home.to_string_lossy())]);
        assert_eq!(prepare_codex_home(&routed, dir.path()), None);
        assert_eq!(
            std::fs::read_to_string(home.join("config.toml")).expect("read"),
            "# mine\n"
        );
    }

    /// The end of the T2 chain: the profile as it is shipped, through the
    /// generator, into a config Codex can read.
    #[test]
    fn the_shipped_codex_profile_generates_its_config() {
        let dir = TempDir::new("routing-template");
        let shipped: Vec<AgentProfile> =
            serde_json::from_str(include_str!("../resources/agents-omniroute.json"))
                .expect("template parses as profiles");
        let codex = shipped
            .iter()
            .find(|profile| profile.id == "codex-omni")
            .expect("codex-omni");

        let written = prepare_codex_home(codex, dir.path()).expect("config written");
        assert_eq!(written, dir.path().join(".pa/codex-home/config.toml"));
        let body = std::fs::read_to_string(&written).expect("read config");
        assert!(body.contains("wire_api = \"responses\""), "{body}");
        assert!(body.contains("model = \"auto/cheap\""), "{body}");

        // The other two profiles route by environment alone.
        for id in ["claude-omni", "opencode-free"] {
            let other = shipped.iter().find(|p| p.id == id).expect(id);
            assert_eq!(prepare_codex_home(other, dir.path()), None, "{id}");
        }
    }

    #[test]
    fn product_modes_are_stable_contracts_not_omniroute_aliases() {
        assert_eq!(ProductMode::parse("reliable").unwrap().as_str(), "reliable");
        assert_eq!(ProductMode::Reliable.omniroute_model(), "auto/coding");
        assert_eq!(ProductMode::Cheap.omniroute_model(), "auto/cheap");
        assert_eq!(ProductMode::Review.omniroute_model(), "auto/review");
        assert!(ProductMode::parse("auto/cheap").is_none());
        assert!(ProductMode::parse("best-coding").is_none());
    }

    #[test]
    fn a_generated_codex_config_does_not_embed_a_secret() {
        let dir = TempDir::new("routing-canary");
        let routed = profile(
            "codex",
            &[
                (CODEX_HOME_ENV, ".pa/codex-home"),
                (BASE_URL_ENV, "http://127.0.0.1:20128/v1"),
                (API_KEY_ENV, "sk-ant-canary-must-not-land-in-argv"),
            ],
        );
        let written = prepare_codex_home(&routed, dir.path()).expect("config");
        let body = std::fs::read_to_string(&written).expect("read");
        assert!(
            !body.contains("sk-ant-canary-must-not-land-in-argv"),
            "{body}"
        );
        assert!(body.contains("env_key = \"OMNIROUTE_API_KEY\""), "{body}");
    }

    #[test]
    fn twenty_transport_runs_leave_non_http_unclassified() {
        // 18 HTTP statuses must classify; two non-HTTP outcomes must not.
        // If someone maps a missing status onto Server, unclassified != 2.
        let runs: [(Option<u16>, &str); 20] = [
            (Some(200), r#"{"content":[{"text":"42"}]}"#),
            (Some(201), "{}"),
            (Some(204), ""),
            (Some(400), r#"{"error":{"message":"unknown combo"}}"#),
            (Some(400), r#"{"error":"bad_request"}"#),
            (Some(401), r#"{"error":"unauthorized"}"#),
            (Some(403), "{}"),
            (Some(404), "missing"),
            (Some(409), "{}"),
            (Some(422), "{}"),
            (Some(429), "rate"),
            (Some(500), "boom"),
            (Some(502), "bad gateway"),
            (
                Some(503),
                r#"{"error":{"code":"chat_admission_busy","message":"retry shortly"}}"#,
            ),
            (Some(503), r#"{"error":"upstream exploded"}"#),
            (Some(504), "timeout"),
            (Some(200), "42"),
            (Some(418), "teapot"),
            (None, ""),
            (Some(99), "bogus"),
        ];
        let mut unclassified = 0;
        let mut classified = 0;
        for (i, (status, body)) in runs.iter().enumerate() {
            match classify_chat_transport(*status, body) {
                ChatTransport::Unclassified { .. } => {
                    unclassified += 1;
                    assert!(
                        status.is_none() || matches!(status, Some(c) if !(100..=599).contains(c)),
                        "run {i}: HTTP status {status:?} must not be unclassified"
                    );
                }
                ChatTransport::Ok => {
                    classified += 1;
                    let code = status.expect("ok needs a status");
                    assert!((200..300).contains(&code), "run {i}: {code}");
                }
                ChatTransport::Failed(ChatFailure::AdmissionBusy) => {
                    classified += 1;
                    assert_eq!(*status, Some(503), "run {i}");
                }
                ChatTransport::Failed(ChatFailure::Client { status: code }) => {
                    classified += 1;
                    assert_eq!(*status, Some(code), "run {i}");
                    assert!((400..500).contains(&code), "run {i}: {code}");
                }
                ChatTransport::Failed(ChatFailure::Server { status: code }) => {
                    classified += 1;
                    assert_eq!(*status, Some(code), "run {i}");
                    assert!(code >= 500, "run {i}: {code}");
                }
            }
        }
        assert_eq!(unclassified, 2, "missing/non-http must stay unclassified");
        assert_eq!(classified, 18);
    }

    #[test]
    fn classify_chat_http_names_admission_busy_apart_from_4xx() {
        let review_400 = r#"{"error":{"message":"unknown combo"}}"#;
        assert_eq!(
            classify_chat_http(400, review_400),
            Err(ChatFailure::Client { status: 400 })
        );
        assert_eq!(
            classify_chat_http(
                503,
                r#"{"error":{"code":"chat_admission_busy","message":"retry shortly"}}"#
            ),
            Err(ChatFailure::AdmissionBusy)
        );
        assert_eq!(
            classify_chat_http(503, r#"{"error":"upstream exploded"}"#),
            Err(ChatFailure::Server { status: 503 })
        );
        assert!(classify_chat_http(200, r#"{"content":[{"text":"42"}]}"#).is_ok());
    }

    #[test]
    fn review_never_fails_over_onto_the_author_model() {
        let failure = ChatFailure::Client { status: 400 };
        assert_eq!(
            failover_on_chat_failure(ProductMode::Review, &failure),
            Failover::Block {
                reason: "review cannot fall back to the author model"
            }
        );
        assert_eq!(
            failover_on_chat_failure(ProductMode::Cheap, &failure),
            Failover::RetryVisible {
                from: ProductMode::Cheap,
                to: ProductMode::Reliable
            }
        );
        assert_eq!(
            failover_on_chat_failure(ProductMode::Cheap, &ChatFailure::AdmissionBusy),
            Failover::Hold
        );
    }

    #[test]
    fn record_review_probe_does_not_invent_an_independent_family() {
        record_review_probe(400, r#"{"error":"unknown combo"}"#, None);
        match review_availability() {
            ReviewAvailability::Unresolved { detail } => {
                assert!(
                    detail.contains("400") && detail.to_ascii_lowercase().contains("combo"),
                    "{detail}"
                );
            }
            other => panic!("expected unresolved, got {other:?}"),
        }
        assert!(ensure_mode_spawnable(ProductMode::Review).is_err());
        assert!(ensure_mode_spawnable(ProductMode::Cheap).is_ok());
        match availability_from_probe(200, "{}", Some("gemini-review-family")) {
            ReviewAvailability::Independent { model } => {
                assert_eq!(model, "gemini-review-family");
            }
            other => panic!("{other:?}"),
        }
        assert!(matches!(
            availability_from_probe(200, "{}", None),
            ReviewAvailability::Unresolved { .. }
        ));
    }

    #[test]
    fn attribution_names_requested_mode_and_resolved_model() {
        assert_eq!(
            attribution_line(ProductMode::Cheap, Some("gemini-3.6-flash")),
            "Routing: requested cheap (auto/cheap); resolved gemini-3.6-flash"
        );
        assert_eq!(
            attribution_line(ProductMode::Review, None),
            "Routing: requested review (auto/review); resolved unresolved"
        );
    }

    #[test]
    fn apply_product_mode_does_not_put_a_secret_in_env_values_beyond_the_model_name() {
        let mut env = vec![
            (MODEL_ENV.to_string(), "auto/cheap".to_string()),
            (
                API_KEY_ENV.to_string(),
                "sk-ant-canary-must-not-land-in-argv".to_string(),
            ),
        ];
        apply_product_mode(&mut env, ProductMode::Reliable);
        assert_eq!(
            env.iter()
                .find(|(k, _)| k == MODEL_ENV)
                .map(|(_, v)| v.as_str()),
            Some("auto/coding")
        );
        assert!(env
            .iter()
            .any(|(k, v)| k == API_KEY_ENV && v.contains("canary")));
        assert!(!attribution_line(ProductMode::Reliable, Some("auto/coding")).contains("sk-ant"));
    }

    #[test]
    fn cheap_client_failure_makes_the_next_spawn_retry_as_reliable() {
        clear_chat_failure();
        note_live_chat_outcome(Some(400), r#"{"error":"bad_request"}"#);
        let (mode, failover) = spawn_mode_after_failover(ProductMode::Cheap);
        assert_eq!(mode, ProductMode::Reliable);
        assert_eq!(
            failover,
            Some(Failover::RetryVisible {
                from: ProductMode::Cheap,
                to: ProductMode::Reliable
            })
        );
        let (again, none) = spawn_mode_after_failover(ProductMode::Cheap);
        assert_eq!(again, ProductMode::Cheap);
        assert_eq!(none, None);
        clear_chat_failure();
    }

    #[test]
    fn a_client_failure_recorded_before_a_non_cheap_spawn_still_steers_the_next_cheap_spawn() {
        clear_chat_failure();
        // The exact call shape the live ingest uses: status only, empty body.
        note_live_chat_outcome(Some(400), "");
        // A reliable (or review) spawn in between must not eat the one-shot.
        let (mode, _) = spawn_mode_after_failover(ProductMode::Reliable);
        assert_eq!(mode, ProductMode::Reliable);
        let (mode, failover) = spawn_mode_after_failover(ProductMode::Cheap);
        assert_eq!(mode, ProductMode::Reliable);
        assert!(matches!(failover, Some(Failover::RetryVisible { .. })));
        clear_chat_failure();
    }
}
