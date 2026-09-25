//! Versioned, fail-closed policy for the still-disabled continuous-development
//! runtime.
//!
//! This module deliberately does not discover executables, credentials, or
//! models. Callers supply observations from the existing profile/provider
//! runtime; an observation that is absent is ineligible rather than guessed.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const POLICY_FILE: &str = "projecta.dev.json";
pub const SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_MAX_WORKERS: u8 = 2;
pub const DEFAULT_MAX_INTEGRATION: u8 = 1;
pub const DEFAULT_GOAL_MINUTES: u16 = 90;
pub const DEFAULT_MAX_TASKS_PER_GOAL: u8 = 8;
pub const DEFAULT_MAX_ATTEMPTS_PER_TASK: u8 = 3;
pub const DEFAULT_MAX_ESCALATIONS: u8 = 1;
pub const DEFAULT_DISCOVERY_RUNS_PER_DAY: u8 = 2;
pub const DEFAULT_MAX_AUTONOMOUS_GOALS: u8 = 1;
pub const MIN_QUOTA_RESERVE_PERCENT: u8 = 20;

/// The complete, machine-readable policy. It is intentionally a closed
/// schema: a typo must not look like a safely applied limit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DevelopmentPolicy {
    pub schema_version: u32,
    pub continuous: ContinuousPolicy,
    pub routing: RoutingPolicy,
    pub providers: Vec<Provider>,
    pub teams: Vec<TeamPolicy>,
    /// Missing in old frozen policies: never infer a spend allowance for them.
    #[serde(default)]
    pub tokens: Option<TokenPolicy>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TokenPolicy {
    pub max_per_goal: i64,
    pub verification_reserve: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContinuousPolicy {
    pub enabled: bool,
    pub max_workers: u8,
    pub max_integration: u8,
    pub goal_minutes: u16,
    pub max_tasks_per_goal: u8,
    pub max_attempts_per_task: u8,
    pub max_escalations: u8,
    pub discovery_runs_per_day: u8,
    pub max_autonomous_goals: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoutingPolicy {
    pub additional_paid_api: bool,
    pub quota_reserve_percent: u8,
    pub billing: Vec<Billing>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamPolicy {
    pub id: String,
    pub roles: Vec<String>,
}

/// Provider identifiers deliberately align with `profiles::AgentProfile::id`.
/// This enum creates no parallel profile registry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Codex,
    Kimi,
    Opencode,
    Ollama,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Billing {
    Subscription,
    Free,
    Local,
    /// Records with these values are never eligible. They are represented so
    /// runtime observations can state why a candidate was rejected.
    Paid,
    Unknown,
}

impl DevelopmentPolicy {
    /// Convenience entry point for consumers that keep policy access on the
    /// type rather than importing the module-level parser.
    pub fn parse(raw: &str) -> Result<Self, String> {
        parse(raw)
    }

    pub fn load(project_root: &Path) -> Result<LoadedPolicy, String> {
        load(project_root)
    }

    pub fn defaults() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            tokens: Some(TokenPolicy {
                max_per_goal: 200_000,
                verification_reserve: 40_000,
            }),
            continuous: ContinuousPolicy {
                enabled: false,
                max_workers: DEFAULT_MAX_WORKERS,
                max_integration: DEFAULT_MAX_INTEGRATION,
                goal_minutes: DEFAULT_GOAL_MINUTES,
                max_tasks_per_goal: DEFAULT_MAX_TASKS_PER_GOAL,
                max_attempts_per_task: DEFAULT_MAX_ATTEMPTS_PER_TASK,
                max_escalations: DEFAULT_MAX_ESCALATIONS,
                discovery_runs_per_day: DEFAULT_DISCOVERY_RUNS_PER_DAY,
                max_autonomous_goals: DEFAULT_MAX_AUTONOMOUS_GOALS,
            },
            routing: RoutingPolicy {
                additional_paid_api: false,
                quota_reserve_percent: MIN_QUOTA_RESERVE_PERCENT,
                billing: vec![Billing::Subscription, Billing::Free, Billing::Local],
            },
            providers: vec![
                Provider::Claude,
                Provider::Codex,
                Provider::Kimi,
                Provider::Opencode,
                Provider::Ollama,
            ],
            teams: vec![TeamPolicy {
                id: "development".to_string(),
                roles: vec![
                    "coordinator".to_string(),
                    "implementer".to_string(),
                    "reviewer".to_string(),
                    "integrator".to_string(),
                ],
            }],
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if let Some(tokens) = &self.tokens {
            if tokens.max_per_goal < 1
                || tokens.max_per_goal > 200_000
                || tokens.verification_reserve < 1
                || tokens.verification_reserve > tokens.max_per_goal
            {
                return Err(
                    "tokens requires maxPerGoal 1..200000 and verificationReserve 1..maxPerGoal"
                        .into(),
                );
            }
        }
        if self.schema_version != SCHEMA_VERSION {
            return Err(format!(
                "unsupported development policy schemaVersion {}; expected {SCHEMA_VERSION}",
                self.schema_version
            ));
        }
        let continuous = &self.continuous;
        bounded(
            "continuous.maxWorkers",
            continuous.max_workers,
            1,
            DEFAULT_MAX_WORKERS,
        )?;
        bounded(
            "continuous.maxIntegration",
            continuous.max_integration,
            1,
            DEFAULT_MAX_INTEGRATION,
        )?;
        bounded_u16(
            "continuous.goalMinutes",
            continuous.goal_minutes,
            1,
            DEFAULT_GOAL_MINUTES,
        )?;
        bounded(
            "continuous.maxTasksPerGoal",
            continuous.max_tasks_per_goal,
            1,
            DEFAULT_MAX_TASKS_PER_GOAL,
        )?;
        bounded(
            "continuous.maxAttemptsPerTask",
            continuous.max_attempts_per_task,
            1,
            DEFAULT_MAX_ATTEMPTS_PER_TASK,
        )?;
        // Escalation and discovery are optional; zero is the explicit
        // tighter setting, not a missing value interpreted as permission.
        bounded(
            "continuous.maxEscalations",
            continuous.max_escalations,
            0,
            DEFAULT_MAX_ESCALATIONS,
        )?;
        bounded(
            "continuous.discoveryRunsPerDay",
            continuous.discovery_runs_per_day,
            0,
            DEFAULT_DISCOVERY_RUNS_PER_DAY,
        )?;
        bounded(
            "continuous.maxAutonomousGoals",
            continuous.max_autonomous_goals,
            0,
            DEFAULT_MAX_AUTONOMOUS_GOALS,
        )?;
        if continuous.enabled {
            return Err(
                "continuous.enabled must remain false until runtime acceptance evidence enables it"
                    .into(),
            );
        }

        if self.routing.additional_paid_api {
            return Err(
                "routing.additionalPaidApi cannot be enabled by this bounded policy".into(),
            );
        }
        bounded(
            "routing.quotaReservePercent",
            self.routing.quota_reserve_percent,
            MIN_QUOTA_RESERVE_PERCENT,
            100,
        )?;
        unique_nonempty("routing.billing", &self.routing.billing)?;
        if self
            .routing
            .billing
            .iter()
            .any(|billing| matches!(billing, Billing::Paid | Billing::Unknown))
        {
            return Err(
                "routing.billing may only permit subscription, free, or local billing".into(),
            );
        }
        unique_nonempty("providers", &self.providers)?;
        if self.teams.is_empty() {
            return Err("teams must contain at least one team".into());
        }
        let mut team_ids = BTreeSet::new();
        for team in &self.teams {
            if !valid_team_id(&team.id) || !team_ids.insert(team.id.as_str()) {
                return Err("teams must have unique ids matching ^[a-z][a-z0-9-]*$".into());
            }
            if team.roles.is_empty()
                || team.roles.iter().any(|role| !valid_role(role))
                || team.roles.iter().collect::<BTreeSet<_>>().len() != team.roles.len()
            {
                return Err(format!(
                    "team '{}' roles must be unique and one of coordinator, implementer, reviewer, integrator",
                    team.id
                ));
            }
        }
        Ok(())
    }
}

fn bounded(name: &str, actual: u8, minimum: u8, maximum: u8) -> Result<(), String> {
    if (minimum..=maximum).contains(&actual) {
        Ok(())
    } else {
        Err(format!(
            "{name} must be between {minimum} and {maximum}, got {actual}"
        ))
    }
}

fn bounded_u16(name: &str, actual: u16, minimum: u16, maximum: u16) -> Result<(), String> {
    if (minimum..=maximum).contains(&actual) {
        Ok(())
    } else {
        Err(format!(
            "{name} must be between {minimum} and {maximum}, got {actual}"
        ))
    }
}

fn unique_nonempty<T: Ord>(name: &str, values: &[T]) -> Result<(), String> {
    if values.is_empty() || values.iter().collect::<BTreeSet<_>>().len() != values.len() {
        Err(format!(
            "{name} must be non-empty and contain no duplicates"
        ))
    } else {
        Ok(())
    }
}

fn valid_team_id(id: &str) -> bool {
    let mut chars = id.bytes();
    matches!(chars.next(), Some(b'a'..=b'z'))
        && chars.all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'-'))
}

fn valid_role(role: &str) -> bool {
    matches!(
        role,
        "coordinator" | "implementer" | "reviewer" | "integrator"
    )
}

/// Parse a policy string without touching the filesystem.
pub fn parse(raw: &str) -> Result<DevelopmentPolicy, String> {
    let policy: DevelopmentPolicy =
        serde_json::from_str(raw).map_err(|error| format!("invalid {POLICY_FILE}: {error}"))?;
    policy.validate()?;
    Ok(policy)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedPolicy {
    pub policy: DevelopmentPolicy,
    /// Human-readable provenance, always present even for the default.
    pub source: String,
    pub path: PathBuf,
}

/// Read the repository-local policy. Missing, unreadable and malformed files
/// fail closed, matching the setup doctor's configuration contract.
pub fn load(project_root: &Path) -> Result<LoadedPolicy, String> {
    let path = project_root.join(POLICY_FILE);
    match fs::read_to_string(&path) {
        Ok(raw) => Ok(LoadedPolicy {
            policy: parse(&raw).map_err(|error| format!("{}: {error}", path.display()))?,
            source: format!("file:{}", path.display()),
            path,
        }),
        Err(error) => Err(format!("cannot read {}: {error}", path.display())),
    }
}

/// Runtime evidence for one existing `AgentProfile`. `profile_id` is passed
/// through unchanged so selection feeds the existing spawn path instead of a
/// second profile system.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelCandidate {
    pub profile_id: String,
    pub provider: Provider,
    pub configured_model: Option<String>,
    /// The model observed in an actual provider attestation. It is never
    /// synthesized from `configured_model`.
    pub observed_model: Option<String>,
    pub attested: bool,
    pub enabled: bool,
    pub billing: Billing,
    #[serde(default)]
    pub capabilities: BTreeSet<String>,
    #[serde(default)]
    pub efforts: BTreeSet<String>,
    pub max_context_tokens: Option<u32>,
    /// Remaining quota as observed by the relevant provider, not a guessed
    /// usage percentage. `None` is unavailable and cannot route work.
    pub quota_remaining_percent: Option<u8>,
    pub tool_adapter: ToolAdapter,
    /// Comparable token estimates derived from the same accepted-task suite.
    /// Missing estimates cannot win an economical route by accident.
    pub estimated_task_tokens: Option<u64>,
    pub evidence_id: String,
    pub observed_at: u64,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolAdapter {
    None,
    /// A local helper can assist a prompt but is not evidence that the model
    /// has a verified tool-execution adapter.
    Helper,
    Verified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RouteRequest {
    pub requested_model: Option<String>,
    #[serde(default)]
    pub required_capabilities: BTreeSet<String>,
    pub effort: Option<String>,
    pub minimum_context_tokens: u32,
    #[serde(default)]
    pub requires_verified_tool_adapter: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteDecision {
    pub requested: RouteRequest,
    pub resolved: Option<ResolvedRoute>,
    pub failure: Option<RouteFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRoute {
    pub profile_id: String,
    pub provider: Provider,
    pub configured_model: Observation<String>,
    pub resolved_model: Observation<String>,
    pub effort: Observation<String>,
    pub context_tokens: Observation<u32>,
    pub quota_remaining_percent: Observation<u8>,
    pub estimated_task_tokens: Observation<u64>,
    pub evidence_id: String,
    pub observed_at: u64,
    /// Resolves the candidate's prior `observed_model`, not the configured-first
    /// invocation model. It never attests this run's executed identity.
    pub candidate_family: FamilyResolution,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdentityTuple {
    pub provider: Option<Provider>,
    pub model: Option<String>,
    pub family: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterIdentity {
    pub adapter_id: String,
    pub version: String,
}

/// A future trusted, run-bound writer must create this. Shape alone is not proof.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionIdentity {
    pub id: String,
    pub run_id: String,
    pub requested: IdentityTuple,
    pub configured: IdentityTuple,
    pub observed: Option<IdentityObservation>,
    pub adapter: Option<AdapterIdentity>,
    pub ui_profile_id: Option<String>,
}

impl ExecutionIdentity {
    pub fn validate_shape(&self) -> Result<(), &'static str> {
        if self.id.trim().is_empty() || self.run_id.trim().is_empty() {
            return Err("identity and run ids are required");
        }
        if self.adapter.as_ref().is_some_and(|adapter| {
            adapter.adapter_id.trim().is_empty() || adapter.version.trim().is_empty()
        }) {
            return Err("adapter id and version must both be present");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IdentityStatus {
    Observed,
    Unknown,
    Stale,
    Conflicting,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegistryRef {
    pub source: String,
    pub revision: String,
    pub digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdentityObservation {
    pub identity: IdentityTuple,
    pub status: IdentityStatus,
    pub source: Option<String>,
    pub evidence_id: Option<String>,
    pub observed_at: Option<u64>,
    pub expires_at: Option<u64>,
    pub registry: Option<RegistryRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyResolution {
    pub status: IdentityStatus,
    pub family: Option<String>,
    pub registry: Option<RegistryRef>,
}

impl FamilyResolution {
    fn status(status: IdentityStatus) -> Self {
        Self {
            status,
            family: None,
            registry: None,
        }
    }
}

/// Only this checked-in empty snapshot is admitted by production route selection.
/// Fixture mappings cannot be supplied through profiles, agents or JSON.
#[derive(Debug, Clone)]
pub struct FamilyRegistry {
    reference: RegistryRef,
    revoked: bool,
    entries: BTreeMap<(Provider, String), String>,
}

impl FamilyRegistry {
    pub fn production() -> Self {
        Self::checked("projecta-checked-in", "empty-v1", false, &[], None)
            .expect("empty registry is valid")
    }

    fn checked(
        source: &str,
        revision: &str,
        revoked: bool,
        entries: &[(Provider, &str, &str)],
        expected_digest: Option<&str>,
    ) -> Result<Self, &'static str> {
        if source.trim().is_empty() || revision.trim().is_empty() {
            return Err("registry source and revision are required");
        }
        let mut canonical = BTreeMap::new();
        for (provider, alias, family) in entries {
            if alias.trim().is_empty() || family.trim().is_empty() {
                return Err("model alias and family are required");
            }
            let key = (*provider, (*alias).to_string());
            if let Some(previous) = canonical.insert(key, (*family).to_string()) {
                return Err(if previous == *family {
                    "duplicate family alias"
                } else {
                    "conflicting family aliases"
                });
            }
        }
        let bytes = serde_json::to_vec(
            &canonical
                .iter()
                .map(|((provider, alias), family)| (provider, alias, family))
                .collect::<Vec<_>>(),
        )
        .expect("canonical entries serialize");
        let digest = format!("{:x}", Sha256::digest(bytes));
        if expected_digest.is_some_and(|expected| {
            expected.len() != 64
                || !expected.bytes().all(|b| b.is_ascii_hexdigit())
                || expected != digest
        }) {
            return Err("registry digest is malformed or differs from entries");
        }
        Ok(Self {
            reference: RegistryRef {
                source: source.into(),
                revision: revision.into(),
                digest,
            },
            revoked,
            entries: canonical,
        })
    }

    #[cfg(test)]
    fn fixture(
        source: &str,
        revision: &str,
        revoked: bool,
        entries: &[(Provider, &str, &str)],
    ) -> Result<Self, &'static str> {
        Self::checked(source, revision, revoked, entries, None)
    }

    fn resolve(&self, provider: Provider, model: &str) -> FamilyResolution {
        if self.revoked {
            return FamilyResolution {
                status: IdentityStatus::Stale,
                family: None,
                registry: Some(self.reference.clone()),
            };
        }
        if model.trim().is_empty() {
            return FamilyResolution::status(IdentityStatus::Unknown);
        }
        self.entries
            .get(&(provider, model.to_string()))
            .map_or_else(
                || FamilyResolution::status(IdentityStatus::Unknown),
                |family| FamilyResolution {
                    status: IdentityStatus::Observed,
                    family: Some(family.clone()),
                    registry: Some(self.reference.clone()),
                },
            )
    }
}

/// Resolves only an alias in a controlled snapshot. It does not attest execution.
/// Registry entries have no temporal validity; revocation is checked separately.
pub fn resolve_family(
    registry: &FamilyRegistry,
    provider: Provider,
    model: &str,
) -> FamilyResolution {
    registry.resolve(provider, model)
}

/// Consistency check for a future trusted producer; never authenticates a caller.
/// Non-Observed statuses are producer-attributed and remain ineligible; only an
/// Observed claim receives the provenance, freshness, and registry checks below.
pub fn assess_identity_observation(
    observation: &IdentityObservation,
    registry: &FamilyRegistry,
    now: u64,
) -> IdentityStatus {
    if observation.status != IdentityStatus::Observed {
        return observation.status;
    }
    let (Some(source), Some(evidence), Some(start), Some(end)) = (
        &observation.source,
        &observation.evidence_id,
        observation.observed_at,
        observation.expires_at,
    ) else {
        return IdentityStatus::Unknown;
    };
    if source.trim().is_empty()
        || evidence.trim().is_empty()
        || start == 0
        || end <= start
        || start > now
    {
        return IdentityStatus::Unknown;
    }
    if end <= now || registry.revoked {
        return IdentityStatus::Stale;
    }
    let (Some(provider), Some(model), Some(family), Some(reference)) = (
        observation.identity.provider,
        observation.identity.model.as_deref(),
        observation.identity.family.as_deref(),
        observation.registry.as_ref(),
    ) else {
        return IdentityStatus::Unknown;
    };
    // Without the pinned historical snapshot, a newer/different reference
    // cannot establish whether the old attestation expired or was revoked.
    if reference != &registry.reference {
        return IdentityStatus::Unknown;
    }
    let resolution = resolve_family(registry, provider, model);
    match resolution.family.as_deref() {
        Some(expected) if expected == family => IdentityStatus::Observed,
        Some(_) => IdentityStatus::Conflicting,
        None => IdentityStatus::Unknown,
    }
}

/// Measurements cannot be represented as a plausible-looking zero or a
/// configured model name. A caller can serialize this distinction verbatim.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Observation<T> {
    Measured { value: T },
    Configured { value: T },
    Requested { value: T },
    Estimated { value: T },
    Unavailable { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteFailure {
    pub class: RouteFailureClass,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RouteFailureClass {
    Policy,
    Authentication,
    Quota,
    Environment,
    Infrastructure,
    UnsupportedEffort,
    MissingCapability,
    InsufficientContext,
    Unattested,
    NoEligibleCandidate,
}

/// Select the eligible candidate with the lowest comparable token estimate.
/// Profile identity breaks ties deterministically; it is never a cost proxy.
pub fn select_candidate(
    policy: &DevelopmentPolicy,
    request: RouteRequest,
    candidates: &[ModelCandidate],
) -> RouteDecision {
    if let Err(detail) = policy.validate() {
        return rejected(request, RouteFailureClass::Policy, detail);
    }
    let mut ordered: Vec<&ModelCandidate> = candidates.iter().collect();
    ordered.sort_by(|left, right| {
        (
            left.estimated_task_tokens.unwrap_or(u64::MAX),
            &left.profile_id,
            &left.observed_model,
            &left.configured_model,
        )
            .cmp(&(
                right.estimated_task_tokens.unwrap_or(u64::MAX),
                &right.profile_id,
                &right.observed_model,
                &right.configured_model,
            ))
    });

    let mut rejections = Vec::new();
    for candidate in ordered {
        match candidate_eligibility(policy, &request, candidate) {
            Ok(()) => {
                return RouteDecision {
                    requested: request.clone(),
                    resolved: Some(resolved(candidate, &request)),
                    failure: None,
                }
            }
            Err(rejection) => rejections.push(rejection),
        }
    }
    let failure = rejections
        .into_iter()
        .min_by_key(|failure| failure_priority(failure.class))
        .unwrap_or(RouteFailure {
            class: RouteFailureClass::NoEligibleCandidate,
            detail: "no model/profile records were supplied".to_string(),
        });
    rejected(request, failure.class, failure.detail)
}

fn rejected(request: RouteRequest, class: RouteFailureClass, detail: String) -> RouteDecision {
    RouteDecision {
        requested: request,
        resolved: None,
        failure: Some(RouteFailure { class, detail }),
    }
}

fn candidate_eligibility(
    policy: &DevelopmentPolicy,
    request: &RouteRequest,
    candidate: &ModelCandidate,
) -> Result<(), RouteFailure> {
    if candidate.profile_id.trim().is_empty() {
        return Err(failure(
            RouteFailureClass::Environment,
            "candidate has no existing profile id",
        ));
    }
    if !policy.providers.contains(&candidate.provider) {
        return Err(failure(
            RouteFailureClass::Policy,
            "candidate provider is not enabled by policy",
        ));
    }
    if !candidate.enabled {
        return Err(failure(
            RouteFailureClass::Environment,
            "existing profile is disabled",
        ));
    }
    if !candidate.attested || empty(&candidate.observed_model) {
        return Err(failure(
            RouteFailureClass::Unattested,
            "candidate lacks an observed model attestation",
        ));
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |v| v.as_secs());
    if candidate.evidence_id.trim().is_empty()
        || candidate.observed_at > now
        || candidate.expires_at <= now
        || candidate.expires_at <= candidate.observed_at
    {
        return Err(failure(
            RouteFailureClass::Unattested,
            "candidate attestation is stale or lacks provenance",
        ));
    }
    if candidate
        .estimated_task_tokens
        .is_none_or(|tokens| tokens == 0)
    {
        return Err(failure(
            RouteFailureClass::Unattested,
            "comparable task token estimate is unavailable",
        ));
    }
    if !policy.routing.billing.contains(&candidate.billing)
        || matches!(candidate.billing, Billing::Paid | Billing::Unknown)
    {
        return Err(failure(
            RouteFailureClass::Policy,
            "candidate billing is not policy-permitted",
        ));
    }
    if let Some(requested_model) = request.requested_model.as_deref() {
        if candidate.observed_model.as_deref() != Some(requested_model) {
            return Err(failure(
                RouteFailureClass::NoEligibleCandidate,
                "candidate does not match requested model",
            ));
        }
    }
    if !request
        .required_capabilities
        .iter()
        .all(|needed| candidate.capabilities.contains(needed))
    {
        return Err(failure(
            RouteFailureClass::MissingCapability,
            "candidate lacks a required capability",
        ));
    }
    if request.requires_verified_tool_adapter && candidate.tool_adapter != ToolAdapter::Verified {
        return Err(failure(
            RouteFailureClass::MissingCapability,
            "candidate has no verified tool adapter",
        ));
    }
    if let Some(effort) = request.effort.as_deref() {
        if !candidate.efforts.contains(effort) {
            return Err(failure(
                RouteFailureClass::UnsupportedEffort,
                "candidate does not attest the requested effort",
            ));
        }
    }
    match candidate.max_context_tokens {
        Some(tokens) if tokens >= request.minimum_context_tokens => {}
        Some(_) => {
            return Err(failure(
                RouteFailureClass::InsufficientContext,
                "candidate context is below requested minimum",
            ))
        }
        None => {
            return Err(failure(
                RouteFailureClass::Environment,
                "candidate context measurement is unavailable",
            ))
        }
    }
    match candidate.quota_remaining_percent {
        None if candidate.billing == Billing::Local => Ok(()),
        Some(quota) if quota > policy.routing.quota_reserve_percent && quota <= 100 => Ok(()),
        Some(_) => Err(failure(
            RouteFailureClass::Quota,
            "candidate quota is at or below the policy reserve",
        )),
        None => Err(failure(
            RouteFailureClass::Quota,
            "candidate quota measurement is unavailable",
        )),
    }
}

fn empty(value: &Option<String>) -> bool {
    match value.as_deref() {
        None => true,
        Some(value) => value.is_empty(),
    }
}

fn failure(class: RouteFailureClass, detail: &str) -> RouteFailure {
    RouteFailure {
        class,
        detail: detail.to_string(),
    }
}

fn failure_priority(class: RouteFailureClass) -> u8 {
    match class {
        RouteFailureClass::Authentication => 0,
        RouteFailureClass::Quota => 1,
        RouteFailureClass::Environment => 2,
        RouteFailureClass::Infrastructure => 3,
        RouteFailureClass::Policy => 4,
        RouteFailureClass::UnsupportedEffort => 5,
        RouteFailureClass::MissingCapability => 6,
        RouteFailureClass::InsufficientContext => 7,
        RouteFailureClass::Unattested => 8,
        RouteFailureClass::NoEligibleCandidate => 9,
    }
}

fn resolved(candidate: &ModelCandidate, request: &RouteRequest) -> ResolvedRoute {
    resolved_with_registry(candidate, request, &FamilyRegistry::production())
}

fn resolved_with_registry(
    candidate: &ModelCandidate,
    request: &RouteRequest,
    registry: &FamilyRegistry,
) -> ResolvedRoute {
    let candidate_family = candidate.observed_model.as_deref().map_or_else(
        || FamilyResolution::status(IdentityStatus::Unknown),
        |model| resolve_family(registry, candidate.provider, model),
    );
    ResolvedRoute {
        profile_id: candidate.profile_id.clone(),
        provider: candidate.provider,
        configured_model: candidate.configured_model.clone().map_or_else(
            || Observation::Unavailable {
                reason: "no configured model was recorded".to_string(),
            },
            |value| Observation::Configured { value },
        ),
        resolved_model: candidate.observed_model.clone().map_or_else(
            || Observation::Unavailable {
                reason: "no observed model attestation".to_string(),
            },
            |value| Observation::Measured { value },
        ),
        effort: request.effort.clone().map_or_else(
            || Observation::Unavailable {
                reason: "no effort was requested".to_string(),
            },
            |value| Observation::Requested { value },
        ),
        context_tokens: candidate.max_context_tokens.map_or_else(
            || Observation::Unavailable {
                reason: "context measurement is unavailable".to_string(),
            },
            |value| Observation::Measured { value },
        ),
        quota_remaining_percent: candidate.quota_remaining_percent.map_or_else(
            || Observation::Unavailable {
                reason: "quota measurement is unavailable".to_string(),
            },
            |value| Observation::Measured { value },
        ),
        estimated_task_tokens: candidate.estimated_task_tokens.map_or_else(
            || Observation::Unavailable {
                reason: "no task estimate".into(),
            },
            |value| Observation::Estimated { value },
        ),
        evidence_id: candidate.evidence_id.clone(),
        observed_at: candidate.observed_at,
        candidate_family,
    }
}

/// An execution failure reported by the adapter. Only independently verified
/// implementation/reasoning failures can consume the single escalation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionFailureClass {
    Authentication,
    Quota,
    Environment,
    Infrastructure,
    Implementation,
    Reasoning,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionFailure {
    pub class: ExecutionFailureClass,
    pub verified: bool,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EscalationDecision {
    Allowed { next_escalation: u8 },
    Denied { reason: String },
}

pub fn decide_escalation(
    policy: &DevelopmentPolicy,
    previous_escalations: u8,
    failure: &ExecutionFailure,
) -> EscalationDecision {
    if let Err(error) = policy.validate() {
        return EscalationDecision::Denied { reason: error };
    }
    if previous_escalations >= policy.continuous.max_escalations
        || previous_escalations >= DEFAULT_MAX_ESCALATIONS
    {
        return EscalationDecision::Denied {
            reason: "escalation limit is exhausted".to_string(),
        };
    }
    if !failure.verified {
        return EscalationDecision::Denied {
            reason: "failure is not independently verified".to_string(),
        };
    }
    match failure.class {
        ExecutionFailureClass::Implementation | ExecutionFailureClass::Reasoning => {
            EscalationDecision::Allowed {
                next_escalation: previous_escalations + 1,
            }
        }
        ExecutionFailureClass::Authentication
        | ExecutionFailureClass::Quota
        | ExecutionFailureClass::Environment
        | ExecutionFailureClass::Infrastructure => EscalationDecision::Denied {
            reason:
                "authentication, quota, environment, and infrastructure failures cannot escalate"
                    .to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn fixture_registry_resolves_exact_alias_without_attesting_a_run() {
        let entries = [(Provider::Codex, "fixture-model", "fixture-family")];
        let registry = FamilyRegistry::fixture("fixture-source", "r1", false, &entries).unwrap();
        let found = resolve_family(&registry, Provider::Codex, "fixture-model");
        assert_eq!(found.status, IdentityStatus::Observed);
        assert_eq!(found.family.as_deref(), Some("fixture-family"));
        assert_eq!(found.registry, Some(registry.reference.clone()));
        assert_eq!(
            registry.reference.digest,
            "9343f4752f1f2a1d3f335af61536cae0a189af68ddb175e2af8d77413373e449"
        );
        assert_eq!(
            resolve_family(&registry, Provider::Claude, "fixture-model").status,
            IdentityStatus::Unknown
        );
        assert_eq!(
            resolve_family(&registry, Provider::Codex, "missing").status,
            IdentityStatus::Unknown
        );
        assert_eq!(
            FamilyRegistry::fixture(
                "fixture-source",
                "r1",
                false,
                &[(Provider::Codex, "x", "a"), (Provider::Codex, "x", "b")]
            )
            .unwrap_err(),
            "conflicting family aliases"
        );
        assert!(FamilyRegistry::fixture("", "r1", false, &entries).is_err());
        assert!(FamilyRegistry::checked(
            "fixture-source",
            "r1",
            false,
            &entries,
            Some("bad-digest")
        )
        .is_err());
        assert!(FamilyRegistry::fixture(
            "fixture-source",
            "r1",
            false,
            &[(Provider::Codex, "", "a")]
        )
        .is_err());
        let revoked = FamilyRegistry::fixture("fixture-source", "r1", true, &entries).unwrap();
        let stale = revoked.resolve(Provider::Codex, "fixture-model");
        assert_eq!(stale.status, IdentityStatus::Stale);
        assert_eq!(stale.registry, Some(revoked.reference.clone()));

        let mut candidate = attested("fixture-profile", Provider::Codex);
        candidate.configured_model = Some("configured-invocation".into());
        candidate.observed_model = Some("fixture-model".into());
        let route = resolved_with_registry(&candidate, &request(), &registry);
        let serialized = serde_json::to_value(&route).unwrap();
        assert_eq!(
            serialized["candidateFamily"],
            serde_json::json!({
                "status":"observed",
                "family":"fixture-family",
                "registry":{
                    "source":"fixture-source",
                    "revision":"r1",
                    "digest":registry.reference.digest,
                }
            })
        );
        assert_eq!(
            serialized["configuredModel"]["configured"]["value"],
            "configured-invocation"
        );
        assert_eq!(
            serialized["resolvedModel"]["measured"]["value"],
            "fixture-model"
        );
    }

    #[test]
    fn observation_requires_provenance_and_exact_registry_reference() {
        let registry = FamilyRegistry::fixture(
            "fixture-source",
            "r1",
            false,
            &[(Provider::Codex, "fixture-model", "fixture-family")],
        )
        .unwrap();
        let mut observation = IdentityObservation {
            identity: IdentityTuple {
                provider: Some(Provider::Codex),
                model: Some("fixture-model".into()),
                family: Some("fixture-family".into()),
            },
            status: IdentityStatus::Observed,
            source: Some("fixture-collector".into()),
            evidence_id: Some("fixture-evidence".into()),
            observed_at: Some(1),
            expires_at: Some(20),
            registry: Some(registry.reference.clone()),
        };
        assert_eq!(
            assess_identity_observation(&observation, &registry, 10),
            IdentityStatus::Observed
        );
        let mut attributed = observation.clone();
        attributed.status = IdentityStatus::Conflicting;
        attributed.source = None;
        assert_eq!(
            assess_identity_observation(&attributed, &registry, 10),
            IdentityStatus::Conflicting
        );
        for missing_source in [true, false] {
            let mut invalid = observation.clone();
            if missing_source {
                invalid.source = None;
            } else {
                invalid.evidence_id = None;
            }
            assert_eq!(
                assess_identity_observation(&invalid, &registry, 10),
                IdentityStatus::Unknown
            );
        }
        assert_eq!(
            assess_identity_observation(&observation, &registry, 21),
            IdentityStatus::Stale
        );
        observation.expires_at = Some(20);
        let next = FamilyRegistry::fixture(
            "fixture-source",
            "r2",
            false,
            &[(Provider::Codex, "fixture-model", "fixture-family")],
        )
        .unwrap();
        assert_eq!(observation.registry, Some(registry.reference.clone()));
        assert_eq!(
            assess_identity_observation(&observation, &next, 10),
            IdentityStatus::Unknown
        );
        observation.identity.family = Some("other-family".into());
        assert_eq!(
            assess_identity_observation(&observation, &registry, 10),
            IdentityStatus::Conflicting
        );
        observation.identity.family = Some("fixture-family".into());
        let revoked = FamilyRegistry::fixture(
            "fixture-source",
            "r1",
            true,
            &[(Provider::Codex, "fixture-model", "fixture-family")],
        )
        .unwrap();
        assert_eq!(
            assess_identity_observation(&observation, &revoked, 10),
            IdentityStatus::Stale
        );
    }

    #[test]
    fn candidate_claim_and_ui_profile_do_not_create_execution_attestation() {
        let mut candidate = attested("fixture-profile", Provider::Codex);
        candidate.configured_model = Some("configured-only".into());
        let route = select_candidate(&DevelopmentPolicy::defaults(), request(), &[candidate]);
        let route = route.resolved.unwrap();
        assert_eq!(route.candidate_family.status, IdentityStatus::Unknown);
        assert_eq!(route.candidate_family.family, None);
        let identity = ExecutionIdentity {
            id: "fixture-id".into(),
            run_id: "fixture-run".into(),
            requested: IdentityTuple {
                provider: Some(Provider::Claude),
                model: Some("requested".into()),
                family: None,
            },
            configured: IdentityTuple {
                provider: Some(Provider::Codex),
                model: Some("configured-only".into()),
                family: None,
            },
            observed: None,
            adapter: Some(AdapterIdentity {
                adapter_id: "fixture-adapter".into(),
                version: "v1".into(),
            }),
            ui_profile_id: Some("fixture-ui".into()),
        };
        assert!(identity.observed.is_none());
        assert!(identity.validate_shape().is_ok());
        assert_ne!(identity.requested, identity.configured);
        assert_eq!(identity.configured.family, None);
        let mut changed = identity.clone();
        changed.ui_profile_id = Some("other-fixture-ui".into());
        changed.adapter.as_mut().unwrap().version = "v2".into();
        assert_eq!(changed.configured.family, identity.configured.family);
    }
    #[test]
    fn token_policy_is_bounded_and_missing_legacy_values_stay_unavailable() {
        let mut value = serde_json::to_value(super::DevelopmentPolicy::defaults()).unwrap();
        value.as_object_mut().unwrap().remove("tokens");
        assert!(super::parse(&value.to_string()).unwrap().tokens.is_none());
        for tokens in [
            serde_json::json!({"maxPerGoal":200001,"verificationReserve":1}),
            serde_json::json!({"maxPerGoal":10,"verificationReserve":11}),
            serde_json::json!({"maxPerGoal":10,"verificationReserve":0}),
        ] {
            value["tokens"] = tokens;
            assert!(super::parse(&value.to_string()).is_err());
        }
    }
    use super::*;

    fn attested(profile_id: &str, provider: Provider) -> ModelCandidate {
        ModelCandidate {
            profile_id: profile_id.to_string(),
            provider,
            configured_model: Some("model-a".to_string()),
            observed_model: Some("model-a".to_string()),
            attested: true,
            enabled: true,
            billing: Billing::Subscription,
            capabilities: ["edit".to_string()].into_iter().collect(),
            efforts: ["high".to_string()].into_iter().collect(),
            max_context_tokens: Some(128_000),
            quota_remaining_percent: Some(80),
            tool_adapter: ToolAdapter::Verified,
            estimated_task_tokens: Some(1000),
            evidence_id: "fixture-attestation".into(),
            observed_at: 1,
            expires_at: u64::MAX,
        }
    }

    fn request() -> RouteRequest {
        RouteRequest {
            requested_model: Some("model-a".to_string()),
            required_capabilities: ["edit".to_string()].into_iter().collect(),
            effort: Some("high".to_string()),
            minimum_context_tokens: 32_000,
            requires_verified_tool_adapter: true,
        }
    }

    #[test]
    fn default_policy_is_bounded_and_continuous_is_disabled() {
        let policy = DevelopmentPolicy::defaults();
        policy.validate().unwrap();
        assert!(!policy.continuous.enabled);
        assert_eq!(policy.continuous.max_workers, 2);
        assert_eq!(policy.routing.quota_reserve_percent, 20);
    }

    #[test]
    fn cheaper_eligible_route_wins_and_stale_evidence_cannot_route() {
        let mut expensive = attested("a-strong", Provider::Codex);
        expensive.estimated_task_tokens = Some(4000);
        let cheap = attested("z-small", Provider::Codex);
        let result = select_candidate(
            &DevelopmentPolicy::defaults(),
            request(),
            &[expensive, cheap.clone()],
        );
        assert_eq!(result.resolved.unwrap().profile_id, "z-small");
        let mut stale = cheap;
        stale.expires_at = 2;
        assert!(
            select_candidate(&DevelopmentPolicy::defaults(), request(), &[stale])
                .resolved
                .is_none()
        );
    }

    #[test]
    fn parser_rejects_unknown_fields_and_limit_widening() {
        let unknown = r#"{"schemaVersion":1,"continuous":{"enabled":false,"maxWorkers":2,"maxIntegration":1,"goalMinutes":90,"maxTasksPerGoal":8,"maxAttemptsPerTask":3,"maxEscalations":1,"discoveryRunsPerDay":2,"maxAutonomousGoals":1,"typo":true},"routing":{"additionalPaidApi":false,"quotaReservePercent":20,"billing":["subscription"]},"providers":["codex"],"teams":[{"id":"development","roles":["implementer"]}]}"#;
        assert!(parse(unknown).unwrap_err().contains("unknown field"));
        let mut policy = DevelopmentPolicy::defaults();
        policy.continuous.max_workers = 3;
        assert!(policy.validate().unwrap_err().contains("maxWorkers"));
    }

    #[test]
    fn missing_policy_fails_closed() {
        let root = std::env::temp_dir().join(format!("projecta-policy-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        assert!(load(&root).unwrap_err().contains("cannot read"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn disabled_or_quota_exhausted_records_do_not_route() {
        let policy = DevelopmentPolicy::defaults();
        let mut disabled = attested("codex", Provider::Codex);
        disabled.enabled = false;
        let decision = select_candidate(&policy, request(), &[disabled]);
        assert_eq!(
            decision.failure.unwrap().class,
            RouteFailureClass::Environment
        );

        let mut quota = attested("codex", Provider::Codex);
        quota.quota_remaining_percent = Some(19);
        let decision = select_candidate(&policy, request(), &[quota]);
        assert_eq!(decision.failure.unwrap().class, RouteFailureClass::Quota);
    }

    #[test]
    fn unsupported_effort_and_ollama_helper_do_not_silently_escalate_capability() {
        let policy = DevelopmentPolicy::defaults();
        let mut no_effort = attested("ollama", Provider::Ollama);
        no_effort.efforts.clear();
        let decision = select_candidate(&policy, request(), &[no_effort]);
        assert_eq!(
            decision.failure.unwrap().class,
            RouteFailureClass::UnsupportedEffort
        );

        let mut helper = attested("ollama", Provider::Ollama);
        helper.tool_adapter = ToolAdapter::Helper;
        let decision = select_candidate(&policy, request(), &[helper]);
        assert_eq!(
            decision.failure.unwrap().class,
            RouteFailureClass::MissingCapability
        );
    }

    #[test]
    fn verified_tool_adapter_routes_with_measured_settings() {
        let decision = select_candidate(
            &DevelopmentPolicy::defaults(),
            request(),
            &[attested("codex", Provider::Codex)],
        );
        let resolved = decision
            .resolved
            .expect("verified adapter should be eligible");
        assert_eq!(resolved.profile_id, "codex");
        assert_eq!(
            resolved.resolved_model,
            Observation::Measured {
                value: "model-a".to_string()
            }
        );
    }

    #[test]
    fn only_verified_implementation_or_reasoning_failure_gets_one_escalation() {
        let policy = DevelopmentPolicy::defaults();
        let auth = ExecutionFailure {
            class: ExecutionFailureClass::Authentication,
            verified: true,
            detail: "401".into(),
        };
        assert!(matches!(
            decide_escalation(&policy, 0, &auth),
            EscalationDecision::Denied { .. }
        ));
        let reasoning = ExecutionFailure {
            class: ExecutionFailureClass::Reasoning,
            verified: true,
            detail: "review reproduced failure".into(),
        };
        assert!(matches!(
            decide_escalation(&policy, 0, &reasoning),
            EscalationDecision::Allowed { next_escalation: 1 }
        ));
        assert!(matches!(
            decide_escalation(&policy, 1, &reasoning),
            EscalationDecision::Denied { .. }
        ));
    }
}
