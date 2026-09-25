//! Trusted launch lane. No agent HTTP endpoint or scheduler activation exists
//! until provider attestations and complete policy budgets have passed their gates.
use super::*;

#[path = "candidate_scope.rs"]
mod candidate_scope;

/// Candidate submission from the scoped agent API.
pub async fn bind_candidate(
    store: &Store,
    run: &str,
    owner: &str,
    fence: i64,
    input: crate::api::CandidateInput,
) -> Result<store::development_runs::CandidateBinding, String> {
    // Preserve v1 input validation, but use our own provenance for the actual
    // Git observation; caller labels and timestamps cannot attest the result.
    if input.source.trim().is_empty() {
        return Err("source is required".into());
    }
    if input.observed_at < 1 {
        return Err("observedAt must be positive".into());
    }
    if input.observed_at > store::now_unix_secs() {
        return Err("observedAt cannot be in the future".into());
    }
    // Authenticate before touching paths. The transactional store write below
    // checks the fence again after Git; no SQL connection is held by the probe.
    let context = store.agent_run_context(run, owner, fence).await?;
    // W2-04: the dispatched team role, not the caller, decides whether this
    // run produces candidates. Reviewers and coordinators never do. The
    // authoritative check is in the store's candidate write transaction
    // (W2-04b, `bind_candidate`); this early copy only refuses before the Git
    // probe runs on a worktree the run may not submit from.
    let role = store.development_run_role(run).await?;
    if !role.submits_candidate() {
        return Err(format!(
            "candidate refused: a {} run does not submit integration candidates",
            role.as_str()
        ));
    }
    let launch = store
        .development_launch(run)
        .await?
        .ok_or("candidate scope check failed: no reserved development worktree")?;
    let scopes: Vec<String> = serde_json::from_value(context["task"]["ownedPaths"].clone())
        .map_err(|e| format!("invalid candidate ownership: {e}"))?;
    let commit = input.candidate_commit;
    let probe_commit = commit.clone();
    super::evidence_probe(move || candidate_scope::verify(&launch, &probe_commit, &scopes))
        .await?
        .map_err(|error| format!("candidate scope check failed: {error}"))?;
    store
        .bind_development_run_candidate(
            run,
            owner,
            fence,
            &commit,
            "backend/git-owned-scope-v1",
            store::now_unix_secs(),
        )
        .await
}

pub(super) async fn record_baseline(
    store: &Store,
    context: &LaunchContext<'_>,
) -> Result<(), String> {
    let launch = store
        .development_launch(context.run_id)
        .await?
        .ok_or("development launch reservation missing")?;
    let commit = super::evidence_probe(move || candidate_scope::head(&launch)).await??;
    store
        .bind_development_launch_baseline(context.run_id, context.owner, context.fence, &commit)
        .await
}

pub(super) struct LaunchContext<'a> {
    pub run_id: &'a str,
    pub owner: &'a str,
    pub fence: i64,
    pub worker_id: &'a str,
    pub descriptor: &'a Path,
    pub bind_credentials: &'a (dyn Fn(&str) -> Result<(), String> + Sync),
    pub route: &'a super::development_route::PreparedRoute,
}

/// Execute one previously claimed run. A reservation is consumed once; errors
/// retain durable identity and work for reconciliation rather than authorizing a
/// second worker. Callers must pass their verified routing decision, never agent
/// supplied API fields. This lane itself is not automatic admission authority.
#[allow(clippy::too_many_arguments)]
pub async fn launch_worker(
    store: &Store,
    agents: &dyn AgentControl,
    api: crate::api::RunCredentialIssuer,
    run_id: &str,
    owner: &str,
    fence: i64,
    route: &super::development_route::PreparedRoute,
) -> Result<Worker, String> {
    if route.transport() == super::development_route::Transport::NativeCodexJson {
        agents.native_runner()?;
    }
    let profile_id = route.profile().id.as_str();
    let run_record = store
        .get_development_run(run_id)
        .await?
        .ok_or("unknown development run")?;
    let policy = crate::development_policy::parse(&run_record.policy_json)?;
    let profile = profiles::find_profile(profile_id).ok_or("unknown selected profile")?;
    route.validate(&policy, &profile)?;
    store.agent_run_context(run_id, owner, fence).await?;
    learnings::ensure_profile_enabled(store, profile_id).await?;
    if profiles::find_profile(profile_id).is_none() {
        return Err(format!("{ERR_UNKNOWN}agent profile: {profile_id}"));
    }
    let launch = store
        .reserve_development_launch(run_id, owner, fence, profile_id)
        .await?;
    with_launch_reconciliation(
        store,
        run_id,
        owner,
        fence,
        &|| api.revoke_run_credentials(run_id),
        async {
            store
                .bind_development_launch_route(run_id, owner, fence, &route.receipt())
                .await?;
            let context = store.agent_run_context(run_id, owner, fence).await?;
            let run = run_id.to_string();
            let claim_owner = owner.to_string();
            let issuer = api.clone();
            let descriptor = tauri::async_runtime::spawn_blocking(move || {
                issuer.issue_run_descriptor_file(&run, &claim_owner, fence, 5400)
            })
            .await
            .map_err(|e| format!("scoped descriptor provisioning interrupted: {e}"))
            .and_then(|result| result)?;
            let briefing = serde_json::to_string(&context)
                .map_err(|e| format!("encode task briefing: {e}"))?;
            let scoped = LaunchContext {
                run_id,
                owner,
                fence,
                worker_id: &launch.worker_id,
                descriptor: &descriptor,
                bind_credentials: &|session| api.bind_session(run_id, session),
                route,
            };
            let worker = super::create_worker_impl(
                store,
                agents,
                &launch.project_id,
                &briefing,
                profile_id,
                None,
                None,
                Some(&scoped),
            )
            .await?;
            if route.transport() == super::development_route::Transport::InteractivePty {
                store
                    .mark_development_run_launched(run_id, owner, fence, Some(&worker.id), None)
                    .await
                    .map_err(|error| {
                        format!("worker may be running; reconciliation required: {error}")
                    })?;
            }
            Ok(worker)
        },
    )
    .await
}

/// Every fallible step after reservation passes through this boundary, including
/// briefing reads and serialization before descriptor/worker creation.
pub(super) async fn with_launch_reconciliation<T>(
    store: &Store,
    run_id: &str,
    owner: &str,
    fence: i64,
    revoke: &(dyn Fn() -> Result<(), String> + Sync),
    operation: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    match operation.await {
        Ok(value) => Ok(value),
        Err(error) => {
            let revocation = revoke().err();
            let reconciliation = store
                .mark_development_run_reconciling(run_id, owner, fence)
                .await;
            let mut detail = format!("{error}; launch retained for reconciliation");
            if let Some(error) = revocation {
                detail.push_str(&format!("; credential revocation failed: {error}"));
            }
            if let Err(error) = reconciliation {
                detail.push_str(&format!("; failed to record reconciliation: {error}"));
            }
            Err(detail)
        }
    }
}
