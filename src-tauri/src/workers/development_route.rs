//! Bind an economical route to the existing profile and immutable root policy.
//! Supplied provider observations still require a trusted collector; command-line
//! translation is not evidence of authentication, billing or an executed model.
use crate::development_policy::{
    self as policy, DevelopmentPolicy, ModelCandidate, Provider, RouteDecision, RouteRequest,
};
use crate::profiles::AgentProfile;
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Transport {
    InteractivePty,
    NativeCodexJson,
}
impl Transport {
    fn name(self) -> &'static str {
        match self {
            Self::InteractivePty => "interactive_pty",
            Self::NativeCodexJson => "native_codex_exec_json",
        }
    }
}

pub struct PreparedRoute {
    transport: Transport,
    original: Value,
    profile: AgentProfile,
    policy: DevelopmentPolicy,
    candidate: ModelCandidate,
    decision: RouteDecision,
}

#[cfg(test)]
#[path = "development_route_effort_tests.rs"]
mod effort_tests;

#[path = "native_route.rs"]
mod native;

impl PreparedRoute {
    pub fn select(
        policy: &DevelopmentPolicy,
        request: RouteRequest,
        candidates: &[ModelCandidate],
        profiles: &[AgentProfile],
    ) -> Result<Self, String> {
        Self::select_transport(
            policy,
            request,
            candidates,
            profiles,
            Transport::InteractivePty,
        )
    }

    pub fn select_native_codex(
        policy: &DevelopmentPolicy,
        request: RouteRequest,
        candidates: &[ModelCandidate],
        profiles: &[AgentProfile],
    ) -> Result<Self, String> {
        Self::select_transport(
            policy,
            request,
            candidates,
            profiles,
            Transport::NativeCodexJson,
        )
    }

    fn select_transport(
        policy: &DevelopmentPolicy,
        request: RouteRequest,
        candidates: &[ModelCandidate],
        profiles: &[AgentProfile],
        transport: Transport,
    ) -> Result<Self, String> {
        let prepare = |profile: &AgentProfile, candidate: &ModelCandidate| {
            let translated = translate(profile, candidate, &request)?;
            match transport {
                Transport::InteractivePty => Ok(translated),
                Transport::NativeCodexJson => native::translate(translated, candidate),
            }
        };
        let mut identities = std::collections::BTreeSet::new();
        if candidates
            .iter()
            .any(|candidate| !identities.insert((&candidate.profile_id, &candidate.evidence_id)))
        {
            return Err("duplicate route evidence identity".into());
        }
        let mut profile_ids = std::collections::BTreeSet::new();
        if profiles
            .iter()
            .any(|profile| !profile_ids.insert(&profile.id))
        {
            return Err("duplicate profile identity".into());
        }
        // A cheap candidate with unsupported invocation settings must not hide a
        // usable candidate. Retain the ordinary eligibility checks as well.
        let usable: Vec<_> = candidates
            .iter()
            .filter(|candidate| {
                profiles
                    .iter()
                    .find(|profile| profile.id == candidate.profile_id)
                    .is_some_and(|profile| prepare(profile, candidate).is_ok())
            })
            .cloned()
            .collect();
        if usable.is_empty() {
            let reasons: Vec<_> = candidates
                .iter()
                .map(|candidate| {
                    let reason = profiles
                        .iter()
                        .find(|profile| profile.id == candidate.profile_id)
                        .map_or_else(
                            || "profile unavailable".into(),
                            |profile| prepare(profile, candidate).err().unwrap_or_default(),
                        );
                    format!("{}: {reason}", candidate.profile_id)
                })
                .collect();
            return Err(format!(
                "no translatable development route: {}",
                reasons.join("; ")
            ));
        }
        let decision = policy::select_candidate(policy, request.clone(), &usable);
        let selected = decision.resolved.as_ref().ok_or_else(|| {
            format!(
                "no eligible translatable development route: {:?}",
                decision.failure
            )
        })?;
        let candidate = usable
            .iter()
            .find(|candidate| {
                candidate.profile_id == selected.profile_id
                    && candidate.evidence_id == selected.evidence_id
            })
            .ok_or("selected route evidence missing")?
            .clone();
        let original = profiles
            .iter()
            .find(|profile| profile.id == selected.profile_id)
            .ok_or("selected profile missing")?;
        Ok(Self {
            transport,
            original: serde_json::to_value(original).map_err(|e| e.to_string())?,
            profile: prepare(original, &candidate)?,
            policy: policy.clone(),
            candidate,
            decision,
        })
    }

    pub fn validate(
        &self,
        policy: &DevelopmentPolicy,
        profile: &AgentProfile,
    ) -> Result<(), String> {
        if policy != &self.policy
            || serde_json::to_value(profile).map_err(|e| e.to_string())? != self.original
        {
            return Err("development route policy/profile changed; select again".into());
        }
        let decision = policy::select_candidate(
            policy,
            self.decision.requested.clone(),
            std::slice::from_ref(&self.candidate),
        );
        if decision.resolved.is_none() {
            return Err(format!(
                "development route expired or ineligible: {:?}",
                decision.failure
            ));
        }
        Ok(())
    }

    pub fn profile(&self) -> &AgentProfile {
        &self.profile
    }

    pub fn transport(&self) -> Transport {
        self.transport
    }

    pub fn require_interactive_transport(&self) -> Result<(), String> {
        if self.transport != Transport::InteractivePty {
            return Err(
                "native development route requires its native launch adapter; PTY fallback refused"
                    .into(),
            );
        }
        Ok(())
    }

    pub fn prepare_home(&self, cwd: &std::path::Path) -> Result<(), String> {
        let requires_config = self.candidate.provider == Provider::Codex
            && self
                .profile
                .env
                .get("CODEX_HOME")
                .is_some_and(|home| !std::path::Path::new(home).is_absolute());
        if requires_config {
            use std::path::Component;
            let home = &self.profile.env["CODEX_HOME"];
            if home.trim().is_empty()
                || std::path::Path::new(home).components().any(|component| {
                    matches!(
                        component,
                        Component::Prefix(_) | Component::RootDir | Component::ParentDir
                    )
                })
            {
                return Err("continuous Codex home must stay within the worker checkout".into());
            }
            let root = cwd.canonicalize().map_err(|error| error.to_string())?;
            let target = cwd.join(home).join("config.toml");
            for ancestor in target.ancestors() {
                match std::fs::symlink_metadata(ancestor) {
                    Ok(_) => {
                        let resolved =
                            ancestor.canonicalize().map_err(|error| error.to_string())?;
                        if !resolved.starts_with(&root) {
                            return Err(
                                "continuous Codex home resolves outside the worker checkout".into(),
                            );
                        }
                        break;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error.to_string()),
                }
            }
        }
        let prepared = crate::routing::prepare_codex_home(&self.profile, cwd);
        if requires_config && prepared.is_none() {
            return Err("continuous Codex router config could not be created; default-provider fallback refused".into());
        }
        Ok(())
    }

    pub fn receipt(&self) -> Value {
        use sha2::{Digest, Sha256};
        // Hash the prepared profile, including argv, environment and capabilities,
        // without publishing any credentials those fields may contain. Late
        // worktree/descriptor overlays and native executable identity are separate.
        let profile_sha256 = format!(
            "{:x}",
            Sha256::digest(json!(&self.profile).to_string().as_bytes())
        );
        json!({"schemaVersion":1,"selection":self.decision,"expiresAt":self.candidate.expires_at,
            "preparedInvocation":{"transport":self.transport.name(),"profileSha256":profile_sha256,
                "scope":"selected_profile_before_worktree_and_session_overlays"},
            "invocationModel":self.candidate.configured_model.as_ref().or(self.candidate.observed_model.as_ref()),
            "executionObservation":{"state":"unavailable","reason":"selection uses prior provider evidence; this run has not attested its model or effort"}})
    }

    pub fn validate_bound_receipt(&self, receipt: &Value) -> Result<(), String> {
        if receipt != &self.receipt() {
            return Err("prepared development route differs from its durable binding; reconcile without launch".into());
        }
        Ok(())
    }
}

fn translate(
    profile: &AgentProfile,
    candidate: &ModelCandidate,
    request: &RouteRequest,
) -> Result<AgentProfile, String> {
    use crate::capabilities::{Lifecycle, SkillsDiscovery};
    let skills_flag = match &profile.caps.skills {
        SkillsDiscovery::Flag { flag } => Some(flag),
        _ => None,
    };
    let hook_flag = match &profile.caps.lifecycle {
        Lifecycle::SettingsHooks { flag } => Some(flag),
        _ => None,
    };
    for flag in [skills_flag, hook_flag].into_iter().flatten() {
        let selector = flag.split('=').next().unwrap_or("");
        if [
            "--model",
            "-m",
            "--effort",
            "--fallback-model",
            "--variant",
            "--config",
            "-c",
            "--profile",
            "-p",
            "--oss",
            "--local-provider",
        ]
        .contains(&selector)
            || (selector.starts_with("-m") && !selector.starts_with("--"))
        {
            return Err("late capability flag conflicts with route-owned settings".into());
        }
    }
    if profile.args.iter().any(|arg| {
        arg == "--fallback-model"
            || arg.starts_with("--fallback-model=")
            || (arg.starts_with("-m") && arg != "-m" && !arg.starts_with("--"))
    }) {
        return Err("automatic model fallback or ambiguous compact selector is not allowed".into());
    }
    if !profile.enabled || profile.id != candidate.profile_id {
        return Err("disabled or mismatched profile".into());
    }
    let executable = profile
        .command
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let executable = executable
        .trim_end_matches(".exe")
        .trim_end_matches(".cmd")
        .trim_end_matches(".ps1");
    let expected = match candidate.provider {
        Provider::Claude => "claude",
        Provider::Codex => "codex",
        Provider::Kimi => "kimi",
        Provider::Opencode => "opencode",
        Provider::Ollama => {
            return Err("Ollama remains a helper: no verified worker tool adapter".into())
        }
    };
    if executable != expected {
        return Err("provider adapter does not match profile executable".into());
    }
    let model = candidate
        .configured_model
        .as_ref()
        .or(candidate.observed_model.as_ref())
        .filter(|v| !v.trim().is_empty())
        .ok_or("missing invocation model")?;
    if model.starts_with('-') || model.chars().any(char::is_control) {
        return Err("invalid invocation model".into());
    }
    if candidate.provider == Provider::Opencode && !model.contains('/') {
        return Err("OpenCode requires provider/model".into());
    }
    let mut result = profile.clone();
    // Preserve custom profile settings; replace only the model selector that this
    // adapter owns. Arguments remain argv elements, never shell expressions.
    result.args = replace_option(&result.args, &["--model", "-m"], "--model", model)?;
    if let Some(effort) = &request.effort {
        match candidate.provider {
            Provider::Claude
                if ["low", "medium", "high", "xhigh", "max"].contains(&effort.as_str()) =>
            {
                result.args = replace_option(&result.args, &["--effort"], "--effort", effort)?;
            }
            Provider::Codex if effort == "low" => {
                // Only this effort has a recorded native CLI tool smoke. Keep
                // other efforts unavailable until their translation is proven.
                validate_codex_effort_overlays(&result.args)?;
                result
                    .args
                    .extend(["-c".into(), "model_reasoning_effort=\"low\"".into()]);
            }
            _ => return Err("requested effort has no verified CLI translation".into()),
        }
    }
    // Avoid a profile-local model environment contradicting the explicit Claude
    // selection. Global product-mode overlays are not applied to this launch.
    if candidate.provider == Provider::Claude {
        result.env.insert("ANTHROPIC_MODEL".into(), model.clone());
    }
    Ok(result)
}

fn validate_codex_effort_overlays(args: &[String]) -> Result<(), String> {
    let mut index = 0;
    while index < args.len() {
        let arg = args[index].as_str();
        if arg == "--profile"
            || arg.starts_with("--profile=")
            || (arg.starts_with("-p") && !arg.starts_with("--"))
        {
            return Err("Codex effort cannot attest a layered configuration profile".into());
        }
        let assignment = if arg == "-c" || arg == "--config" {
            index += 1;
            Some(
                args.get(index)
                    .ok_or("missing Codex config assignment")?
                    .as_str(),
            )
        } else {
            arg.strip_prefix("--config=")
                .or_else(|| arg.strip_prefix("-c"))
        };
        if let Some(assignment) = assignment {
            let (key, _) = assignment
                .split_once('=')
                .ok_or("malformed Codex config assignment")?;
            let key = key.trim().trim_matches(['\'', '"']);
            if key.starts_with("model_reasoning_effort") {
                return Err("profile config conflicts with route-owned Codex effort".into());
            }
        }
        index += 1;
    }
    Ok(())
}

fn replace_option(
    args: &[String],
    flags: &[&str],
    flag: &str,
    value: &str,
) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--" {
            return Err("positional boundary prevents unambiguous route settings".into());
        }
        if flags.contains(&arg.as_str()) {
            if index + 1 >= args.len() || args[index + 1].starts_with('-') {
                return Err("malformed existing model/effort option".into());
            }
            index += 2;
        } else if flags
            .iter()
            .any(|flag| arg.starts_with(&format!("{flag}=")))
        {
            index += 1;
        } else {
            result.push(arg.clone());
            index += 1;
        }
    }
    result.extend([flag.into(), value.into()]);
    Ok(result)
}

/// How long a route built by the test fixtures stays valid. It must outlast a
/// full `cargo test` run on a loaded machine: the expiry is wall-clock, so a
/// short window turns an unrelated slow run into a red route test.
#[cfg(test)]
const FIXTURE_ROUTE_TTL_SECS: u64 = 3600;

#[cfg(test)]
pub(super) fn test_native_route() -> PreparedRoute {
    let (_, mut candidate, request) = tests::fixture(Provider::Codex);
    // Same reason as `test_route()`: the worker fixtures rebuild this route
    // several times inside one binary, and each reconstruction stands for the
    // SAME observation. A per-call timestamp with a 60 s window let a loaded
    // run cross the expiry between fixture and check (BUGS.md 2026-09-17).
    static OBSERVED: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    candidate.observed_at = *OBSERVED.get_or_init(|| candidate.observed_at);
    candidate.expires_at = candidate.observed_at + FIXTURE_ROUTE_TTL_SECS;
    let profile = crate::profiles::find_profile("codex").unwrap();
    PreparedRoute::select_native_codex(
        &DevelopmentPolicy::defaults(),
        request,
        &[candidate],
        &[profile],
    )
    .unwrap()
}

#[cfg(test)]
pub(super) fn test_route(profile: AgentProfile) -> PreparedRoute {
    let (_, mut candidate, request) = tests::fixture(Provider::Claude);
    // Each reconstruction in the worker fixtures represents the SAME observed
    // route, not a fresh observation whose timestamp could cross a second.
    static OBSERVED: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    candidate.observed_at = *OBSERVED.get_or_init(|| candidate.observed_at);
    candidate.expires_at = candidate.observed_at + FIXTURE_ROUTE_TTL_SECS;
    candidate.profile_id = profile.id.clone();
    PreparedRoute::select(
        &DevelopmentPolicy::defaults(),
        request,
        &[candidate],
        &[profile],
    )
    .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::development_policy::{Billing, ToolAdapter};

    #[test]
    fn the_native_test_route_outlives_a_full_suite_run_and_stays_one_observation() {
        // Regression: the worker fixtures rebuild this route several times
        // during one test binary. With a 60 s candidate window a loaded run
        // (a second cargo on the same target) crossed the expiry between
        // fixture and route check, and `native_handoff_*` failed with
        // "candidate attestation is stale or lacks provenance" — a clock
        // race, not a product defect. The window must cover a whole suite,
        // and every reconstruction must describe the SAME observation.
        let now = crate::store::now_unix_secs() as u64;
        let first = test_native_route();
        let second = test_native_route();
        let expiry = first.receipt()["expiresAt"].as_u64().unwrap();
        assert_eq!(
            expiry,
            second.receipt()["expiresAt"].as_u64().unwrap(),
            "each reconstruction is the same observed route, not a fresh one"
        );
        assert!(
            expiry >= now + 600,
            "the native test route expires in {}s; a loaded suite run is longer",
            expiry.saturating_sub(now)
        );
    }

    /// `store::development_runs::RunPrincipal` reads the reviewer's and the
    /// implementer's provider from exactly this path of the bound receipt.
    #[test]
    fn receipt_carries_provider_at_the_review_principal_path() {
        let (profile, candidate, request) = fixture(Provider::Codex);
        let route = PreparedRoute::select(
            &DevelopmentPolicy::defaults(),
            request,
            std::slice::from_ref(&candidate),
            std::slice::from_ref(&profile),
        )
        .unwrap();
        assert_eq!(
            route.receipt().pointer("/selection/resolved/provider"),
            Some(&json!("codex"))
        );
    }

    #[test]
    fn bound_route_rejects_changed_prepared_invocation() {
        let (profile, candidate, request) = fixture(Provider::Claude);
        let policy = DevelopmentPolicy::defaults();
        let route = PreparedRoute::select(
            &policy,
            request.clone(),
            std::slice::from_ref(&candidate),
            std::slice::from_ref(&profile),
        )
        .unwrap();
        let receipt = route.receipt();
        route.validate_bound_receipt(&receipt).unwrap();
        for mutation in 0..3 {
            let mut changed = profile.clone();
            match mutation {
                0 => changed.args.push("--verbose".into()),
                1 => {
                    changed.env.insert("ADAPTER_MODE".into(), "changed".into());
                }
                _ => changed.caps.readiness_marker = Some("different readiness".into()),
            }
            let different = PreparedRoute::select(
                &policy,
                request.clone(),
                std::slice::from_ref(&candidate),
                &[changed],
            )
            .unwrap();
            assert!(
                different.validate_bound_receipt(&receipt).is_err(),
                "mutation {mutation}"
            );
        }
    }

    #[test]
    fn bound_route_requires_exact_evidence_without_exposing_profile_secrets() {
        let (mut profile, candidate, request) = fixture(Provider::Claude);
        profile
            .env
            .insert("PRIVATE_KEY".into(), "private-fixture-value".into());
        let route = PreparedRoute::select(
            &DevelopmentPolicy::defaults(),
            request,
            &[candidate],
            &[profile],
        )
        .unwrap();
        let receipt = route.receipt();
        assert!(!receipt.to_string().contains("private-fixture-value"));
        assert!(!receipt.to_string().contains("PRIVATE_KEY"));
        assert_eq!(
            receipt["preparedInvocation"]["transport"],
            "interactive_pty"
        );
        for pointer in [
            "/selection/resolved/evidenceId",
            "/preparedInvocation/profileSha256",
            "/expiresAt",
        ] {
            let mut changed = receipt.clone();
            *changed.pointer_mut(pointer).unwrap() = json!("changed");
            assert!(route.validate_bound_receipt(&changed).is_err(), "{pointer}");
        }
        let mut legacy = receipt.clone();
        legacy.as_object_mut().unwrap().remove("preparedInvocation");
        assert!(route.validate_bound_receipt(&legacy).is_err());
    }
    pub(super) fn fixture(provider: Provider) -> (AgentProfile, ModelCandidate, RouteRequest) {
        let command = match provider {
            Provider::Claude => "claude",
            Provider::Codex => "codex",
            Provider::Kimi => "kimi",
            Provider::Opencode => "opencode",
            Provider::Ollama => "ollama",
        };
        let profile = AgentProfile {
            id: command.into(),
            name: command.into(),
            command: command.into(),
            args: vec![],
            caps: Default::default(),
            env: Default::default(),
            fallback: None,
            enabled: true,
            env_policy: Default::default(),
        };
        let now = crate::store::now_unix_secs() as u64;
        let candidate = ModelCandidate {
            profile_id: command.into(),
            provider,
            configured_model: Some("provider/model".into()),
            observed_model: Some("observed-model".into()),
            attested: true,
            enabled: true,
            billing: Billing::Subscription,
            capabilities: Default::default(),
            efforts: ["high".into()].into(),
            max_context_tokens: Some(100000),
            quota_remaining_percent: Some(80),
            tool_adapter: ToolAdapter::Verified,
            estimated_task_tokens: Some(1000),
            evidence_id: format!("evidence-{command}"),
            observed_at: now,
            expires_at: now + 60,
        };
        let request = RouteRequest {
            requested_model: None,
            required_capabilities: Default::default(),
            effort: None,
            minimum_context_tokens: 1000,
            requires_verified_tool_adapter: true,
        };
        (profile, candidate, request)
    }
    #[test]
    fn model_translation_preserves_custom_profile_and_reports_execution_unknown() {
        for provider in [
            Provider::Claude,
            Provider::Codex,
            Provider::Kimi,
            Provider::Opencode,
        ] {
            let (mut profile, candidate, request) = fixture(provider);
            profile.args = vec!["--model=old".into(), "--custom".into(), "value".into()];
            let route = PreparedRoute::select(
                &DevelopmentPolicy::defaults(),
                request,
                &[candidate],
                std::slice::from_ref(&profile),
            )
            .unwrap();
            assert_eq!(
                route.profile.args,
                vec!["--custom", "value", "--model", "provider/model"]
            );
            assert_eq!(
                route.receipt()["executionObservation"]["state"],
                "unavailable"
            );
            route
                .validate(&DevelopmentPolicy::defaults(), &profile)
                .unwrap();
            profile.env.insert("ROUTER".into(), "changed".into());
            assert!(route
                .validate(&DevelopmentPolicy::defaults(), &profile)
                .is_err());
        }
    }
    #[test]
    fn unsupported_effort_and_helper_do_not_win_economical_selection() {
        let (claude, mut claude_candidate, mut request) = fixture(Provider::Claude);
        let (codex, mut codex_candidate, _) = fixture(Provider::Codex);
        request.effort = Some("high".into());
        claude_candidate.estimated_task_tokens = Some(2000);
        codex_candidate.estimated_task_tokens = Some(100);
        let route = PreparedRoute::select(
            &DevelopmentPolicy::defaults(),
            request,
            &[codex_candidate, claude_candidate],
            &[codex, claude],
        )
        .unwrap();
        assert_eq!(route.profile.id, "claude");
        let (profile, candidate, request) = fixture(Provider::Ollama);
        assert!(PreparedRoute::select(
            &DevelopmentPolicy::defaults(),
            request,
            &[candidate],
            &[profile]
        )
        .is_err());
    }
    #[test]
    fn stale_evidence_and_policy_changes_are_rejected_before_spawn() {
        let (profile, candidate, request) = fixture(Provider::Claude);
        let mut route = PreparedRoute::select(
            &DevelopmentPolicy::defaults(),
            request,
            &[candidate],
            std::slice::from_ref(&profile),
        )
        .unwrap();
        let mut changed_policy = DevelopmentPolicy::defaults();
        changed_policy.continuous.max_workers = 1;
        assert!(route.validate(&changed_policy, &profile).is_err());
        route.candidate.expires_at = 1;
        assert!(route
            .validate(&DevelopmentPolicy::defaults(), &profile)
            .is_err());
    }

    #[test]
    fn ambiguous_evidence_and_automatic_fallback_are_refused() {
        let (mut profile, candidate, request) = fixture(Provider::Claude);
        let mut conflicting = candidate.clone();
        conflicting.configured_model = Some("other-model".into());
        assert!(PreparedRoute::select(
            &DevelopmentPolicy::defaults(),
            request.clone(),
            &[candidate.clone(), conflicting],
            std::slice::from_ref(&profile)
        )
        .err()
        .unwrap()
        .contains("duplicate"));
        profile.args = vec!["--fallback-model=other".into()];
        assert!(PreparedRoute::select(
            &DevelopmentPolicy::defaults(),
            request,
            &[candidate],
            &[profile]
        )
        .is_err());
    }

    #[test]
    fn blocked_codex_router_home_is_not_a_default_provider_fallback() {
        let dir = crate::testutil::TempDir::new("blocked-codex-route");
        std::fs::write(dir.path().join("router-home"), "not a directory").unwrap();
        let (mut profile, candidate, request) = fixture(Provider::Codex);
        profile
            .env
            .insert("CODEX_HOME".into(), "router-home".into());
        let route = PreparedRoute::select(
            &DevelopmentPolicy::defaults(),
            request,
            &[candidate],
            &[profile],
        )
        .unwrap();
        assert!(route.prepare_home(dir.path()).is_err());
    }

    #[test]
    fn traversal_codex_home_cannot_modify_outside_checkout() {
        let dir = crate::testutil::TempDir::new("traversal-codex-route");
        let checkout = dir.path().join("checkout");
        let outside = dir.path().join("outside");
        std::fs::create_dir_all(&checkout).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("config.toml"), "sentinel").unwrap();
        for home in ["../outside", "a/../../outside"] {
            let (mut profile, candidate, request) = fixture(Provider::Codex);
            profile.env.insert("CODEX_HOME".into(), home.into());
            let route = PreparedRoute::select(
                &DevelopmentPolicy::defaults(),
                request,
                &[candidate],
                &[profile],
            )
            .unwrap();
            assert!(route.prepare_home(&checkout).is_err());
            assert_eq!(
                std::fs::read_to_string(outside.join("config.toml")).unwrap(),
                "sentinel"
            );
            assert_eq!(std::fs::read_dir(&checkout).unwrap().count(), 0);
        }
    }

    #[test]
    #[cfg(windows)]
    fn junction_codex_home_cannot_modify_outside_checkout() {
        let dir = crate::testutil::TempDir::new("junction-codex-route");
        let checkout = dir.path().join("checkout");
        let outside = dir.path().join("outside");
        std::fs::create_dir_all(&checkout).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("config.toml"), "sentinel").unwrap();
        let output = std::process::Command::new("cmd.exe")
            .args(["/C", "mklink", "/J"])
            .arg(checkout.join("router-home"))
            .arg(&outside)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let (mut profile, candidate, request) = fixture(Provider::Codex);
        profile
            .env
            .insert("CODEX_HOME".into(), "router-home".into());
        let route = PreparedRoute::select(
            &DevelopmentPolicy::defaults(),
            request,
            &[candidate],
            &[profile],
        )
        .unwrap();
        assert!(route.prepare_home(&checkout).is_err());
        assert_eq!(
            std::fs::read_to_string(outside.join("config.toml")).unwrap(),
            "sentinel"
        );
    }

    #[test]
    fn late_capability_flags_cannot_replace_route_selectors() {
        use crate::capabilities::{Lifecycle, SkillsDiscovery};
        for flag in [
            "--model",
            "--model=other",
            "-m",
            "--effort",
            "--fallback-model",
        ] {
            for lifecycle in [false, true] {
                let (mut profile, candidate, request) = fixture(Provider::Claude);
                if lifecycle {
                    profile.caps.lifecycle = Lifecycle::SettingsHooks { flag: flag.into() };
                } else {
                    profile.caps.skills = SkillsDiscovery::Flag { flag: flag.into() };
                }
                assert!(PreparedRoute::select(
                    &DevelopmentPolicy::defaults(),
                    request,
                    &[candidate],
                    &[profile]
                )
                .is_err());
            }
        }
    }
}
