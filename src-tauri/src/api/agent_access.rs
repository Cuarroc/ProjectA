//! Process-scoped credentials for one already claimed development run.
//! Only trusted in-process launch code can mint them. Restart revokes all grants;
//! a launcher must reconcile the durable run before obtaining a replacement.
use super::*;
use crate::workers::delivery_state::WorkerDelivery;
use std::sync::Mutex;

#[derive(Clone)]
pub(super) struct RunGrant {
    run_id: String,
    owner: String,
    fence: i64,
    expires_at: std::time::Instant,
    descriptor_file: Option<PathBuf>,
    session_id: Option<String>,
}

impl RunGrant {
    /// `(run, owner, fence)` of the run this credential speaks for; the
    /// planning gate (W2-04f) resolves its dispatch role from these.
    pub(super) fn principal(&self) -> (&str, &str, i64) {
        (&self.run_id, &self.owner, self.fence)
    }
}

#[derive(Default)]
pub(super) struct RunCredentials(Mutex<HashMap<String, RunGrant>>);

fn now() -> std::time::Instant {
    std::time::Instant::now()
}

#[derive(Clone)]
pub struct RunCredentialIssuer {
    inner: Arc<Inner>,
    port: u16,
    descriptor: PathBuf,
}

impl ApiServer {
    pub fn run_credential_issuer(&self) -> RunCredentialIssuer {
        RunCredentialIssuer {
            inner: Arc::clone(&self.inner),
            port: self.port,
            descriptor: self.descriptor.clone(),
        }
    }
    #[allow(dead_code)]
    pub fn issue_run_descriptor(
        &self,
        run: &str,
        owner: &str,
        fence: i64,
        lifetime: u64,
    ) -> Result<Descriptor, String> {
        self.run_credential_issuer()
            .issue_run_descriptor(run, owner, fence, lifetime)
    }
    #[allow(dead_code)]
    pub fn issue_run_descriptor_file(
        &self,
        run: &str,
        owner: &str,
        fence: i64,
        lifetime: u64,
    ) -> Result<PathBuf, String> {
        self.run_credential_issuer()
            .issue_run_descriptor_file(run, owner, fence, lifetime)
    }
    #[allow(dead_code)]
    pub fn revoke_run_credentials(&self, run: &str) -> Result<(), String> {
        self.run_credential_issuer().revoke_run_credentials(run)
    }
}

impl RunCredentialIssuer {
    pub fn bind_session(&self, run_id: &str, session_id: &str) -> Result<(), String> {
        if session_id.is_empty() {
            return Err("empty launch session".into());
        }
        let mut grants = self
            .inner
            .run_credentials
            .0
            .lock()
            .map_err(|_| "run credentials unavailable")?;
        let matching: Vec<_> = grants.values().filter(|g| g.run_id == run_id).collect();
        if matching.is_empty()
            || matching
                .iter()
                .any(|g| g.session_id.as_deref().is_some_and(|s| s != session_id))
        {
            return Err("missing or conflicting run session credential".into());
        }
        for grant in grants.values_mut().filter(|g| g.run_id == run_id) {
            grant.session_id = Some(session_id.into());
        }
        Ok(())
    }

    /// Revoke before attempting persistence, including when the database fails.
    pub async fn observe_exit<T>(
        &self,
        session_id: &str,
        persistence: impl std::future::Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        self.inner
            .run_credentials
            .0
            .lock()
            .map_err(|_| "run credentials unavailable")?
            .retain(|_, grant| {
                if grant.session_id.as_deref() == Some(session_id) {
                    drop_grant_file(grant);
                    false
                } else {
                    true
                }
            });
        persistence.await
    }
    /// No HTTP equivalent exists. The trusted launcher supplies the actual
    /// durable run identity, never fields from an agent's request.
    #[allow(dead_code)] // Used by the forthcoming reconciled launcher.
    pub fn issue_run_descriptor(
        &self,
        run_id: &str,
        owner: &str,
        fence: i64,
        lifetime_seconds: u64,
    ) -> Result<Descriptor, String> {
        if !(1..=5400).contains(&lifetime_seconds) || fence < 1 {
            return Err(
                "run credential lifetime must be 1..5400 seconds and fence positive".into(),
            );
        }
        self.inner.backend.agent_run_context(run_id, owner, fence)?;
        let timestamp = now();
        let token = new_token()?;
        let mut grants = self
            .inner
            .run_credentials
            .0
            .lock()
            .map_err(|_| "run credentials unavailable")?;
        grants.retain(|_, grant| {
            if grant.expires_at > timestamp {
                true
            } else {
                drop_grant_file(grant);
                false
            }
        });
        if grants.len() >= 128 {
            return Err("run credential capacity exhausted".into());
        }
        grants.insert(
            token.clone(),
            RunGrant {
                run_id: run_id.into(),
                owner: owner.into(),
                fence,
                expires_at: timestamp + Duration::from_secs(lifetime_seconds),
                descriptor_file: None,
                session_id: None,
            },
        );
        Ok(Descriptor {
            port: self.port,
            token,
        })
    }

    /// Immutable, private per-launch descriptor outside the worktree. Never
    /// overwrite the broad descriptor or reuse a predecessor process's file.
    pub fn issue_run_descriptor_file(
        &self,
        run_id: &str,
        owner: &str,
        fence: i64,
        lifetime_seconds: u64,
    ) -> Result<PathBuf, String> {
        let descriptor = self.issue_run_descriptor(run_id, owner, fence, lifetime_seconds)?;
        let result = (|| {
            use std::io::Write;
            let directory = self
                .descriptor
                .parent()
                .ok_or("API descriptor has no parent")?
                .join(ACCESS_DIR);
            std::fs::create_dir_all(&directory)
                .map_err(|e| format!("create scoped descriptor directory: {e}"))?;
            // W2-07b: the directory decides who may list it, plant files in
            // it or delete from it - narrowing only the files leaves all
            // three open. Fail closed like the file restriction below.
            #[cfg(windows)]
            super::credential_acl::restrict_directory_to_current_user(&directory)?;
            // Unix parity (0o700), fail closed like the Windows branch: an
            // unchanged, still-group-readable directory must abort the
            // issuance, not sail on.
            #[cfg(unix)]
            crate::oneshot::make_private_checked(&directory)?;
            let path = directory.join(format!("{}.json", new_token()?));
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            // Windows: no mode; the DACL is replaced below. Share mode 0 keeps
            // every other opener out until the narrow DACL is in place.
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                use windows_sys::Win32::Foundation::GENERIC_WRITE;
                use windows_sys::Win32::Storage::FileSystem::{READ_CONTROL, WRITE_DAC};
                options
                    .access_mode(GENERIC_WRITE | WRITE_DAC | READ_CONTROL)
                    .share_mode(0);
            }
            let mut file = options
                .open(&path)
                .map_err(|e| format!("create scoped descriptor: {e}"))?;
            let mut grants = self
                .inner
                .run_credentials
                .0
                .lock()
                .map_err(|_| "run credentials unavailable")?;
            let grant = grants
                .get_mut(&descriptor.token)
                .ok_or("run credential revoked before provisioning")?;
            grant.descriptor_file = Some(path.clone());
            // Fail closed before the token touches the disk: an ACL that is
            // wider than the current user refuses the whole launch.
            #[cfg(windows)]
            super::credential_acl::restrict_to_current_user(&file)?;
            let body = serde_json::to_vec(&descriptor)
                .map_err(|e| format!("encode scoped descriptor: {e}"))?;
            file.write_all(&body)
                .and_then(|()| file.sync_all())
                .map_err(|e| format!("persist scoped descriptor: {e}"))?;
            Ok(path)
        })();
        if result.is_err() {
            // Rollback only removes, so a poisoned map is taken over
            // (W1-15c) instead of leaving the failed launch's grant live.
            let mut grants = self
                .inner
                .run_credentials
                .0
                .lock()
                .unwrap_or_else(|poison| {
                    note_poison("removing the failed launch's grant anyway");
                    poison.into_inner()
                });
            if let Some(grant) = grants.remove(&descriptor.token) {
                drop_grant_file(&grant);
            }
        }
        result
    }

    #[allow(dead_code)] // Trusted launcher revocation hook; never an agent API.
    pub fn revoke_run_credentials(&self, run_id: &str) -> Result<(), String> {
        self.inner
            .run_credentials
            .0
            .lock()
            .map_err(|_| "run credentials unavailable")?
            .retain(|_, grant| {
                if grant.run_id != run_id {
                    true
                } else {
                    drop_grant_file(grant);
                    false
                }
            });
        Ok(())
    }
}

/// Report a poisoned credential map. `writeln!` instead of `eprintln!`, as in
/// `pty::recover`: a failing stderr must not panic an agent request or a
/// revocation (review W1-15c, kimi-k3 R2 / glm-5.2 R2).
fn note_poison(consequence: &str) {
    use std::io::Write;
    let _ = writeln!(
        std::io::stderr(),
        "projecta: run credentials were poisoned; {consequence}"
    );
}

impl RunCredentials {
    /// Under poison the map only shrinks and is never trusted (W1-15c):
    /// revocation takes a poisoned map over - removing is always safe - while
    /// [`RunCredentials::lookup`] refuses it.
    pub(super) fn revoke_all(&self) {
        let mut grants = self.0.lock().unwrap_or_else(|poison| {
            note_poison("revoking all grants anyway");
            poison.into_inner()
        });
        for grant in grants.values() {
            drop_grant_file(grant);
        }
        grants.clear();
    }
    /// Fail-closed under poison, but no longer silently (W1-15c):
    /// `observe_exit` and `revoke_run_credentials` refuse a poisoned map, so a
    /// taken-over read could honour a grant they failed to revoke. Logged
    /// once, since every agent request looks its token up.
    pub(super) fn lookup(&self, token: &str) -> Option<RunGrant> {
        static POISON_LOGGED: std::sync::atomic::AtomicBool =
            std::sync::atomic::AtomicBool::new(false);
        let Ok(grants) = self.0.lock() else {
            if !POISON_LOGGED.swap(true, std::sync::atomic::Ordering::Relaxed) {
                note_poison("refusing every run token until restart");
            }
            return None;
        };
        grants
            .get(token)
            .filter(|grant| grant.expires_at > now())
            .cloned()
    }
}

/// Directory next to the broad descriptor that holds scoped descriptors.
pub(super) const ACCESS_DIR: &str = "agent-access";

/// Recovery: grants live only in this process's memory, so at boot every
/// scoped descriptor on disk belongs to a predecessor - crashed (its `Drop`
/// never ran) or exiting (its agents are being killed). Their tokens are
/// already dead; the files go too. Only names this module mints
/// (`<32 lowercase hex>.json`, regular files) are touched. Best effort: a
/// file that cannot be removed holds a token no server honours. The name
/// shape is `new_token()`'s (`{:032x}`), guarded by
/// `new_token_has_the_shape_redact_expects_to_mask`.
pub(super) fn sweep_orphaned_descriptor_files(api_dir: &Path) -> SweepReport {
    let mut report = SweepReport::default();
    let Ok(entries) = std::fs::read_dir(api_dir.join(ACCESS_DIR)) else {
        return report;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(stem) = name.to_str().and_then(|n| n.strip_suffix(".json")) else {
            continue;
        };
        let minted = stem.len() == 32
            && stem
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        let regular = entry.file_type().is_ok_and(|kind| kind.is_file());
        if minted && regular {
            match remove_file_if_present(&entry.path()) {
                Ok(()) => report.removed += 1,
                Err(error) => {
                    report.failed += 1;
                    note_removal_failure(&error);
                }
            }
        }
    }
    report
}

/// Outcome of the boot sweep: files removed vs. files that stayed behind.
#[derive(Default)]
pub(super) struct SweepReport {
    pub removed: usize,
    pub failed: usize,
}

/// NotFound counts as removed: the goal is "the file is gone".
fn remove_file_if_present(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
        _ => Ok(()),
    }
}

fn remove_grant_file(grant: &RunGrant) -> Result<(), String> {
    grant
        .descriptor_file
        .as_deref()
        .map_or(Ok(()), remove_file_if_present)
}

/// The map-internal call sites (`retain`, rollback, `revoke_all`) cannot
/// return an error, and the grant is dropped from memory regardless, so the
/// token is dead; the leftover file is reported, never silently ignored.
fn drop_grant_file(grant: &RunGrant) {
    if let Err(error) = remove_grant_file(grant) {
        note_removal_failure(&error);
    }
}

/// Log the OS error only: the path's file name is the token, so it never
/// reaches stderr (same `writeln!` rationale as [`note_poison`]).
fn note_removal_failure(error: &str) {
    use std::io::Write;
    let _ = writeln!(
        std::io::stderr(),
        "projecta: scoped descriptor file could not be removed: {error}"
    );
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateInput {
    pub candidate_commit: String,
    pub source: String,
    pub observed_at: i64,
}

/// Body of `POST /api/hq/v1/agent/delivery` (W1-03f-api). The run, owner and
/// fence come from the credential only; any other field is refused with 400.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeliveryInput {
    outcome: String,
    reason: Option<String>,
}

fn parse_delivery(body: &str) -> Result<WorkerDelivery, String> {
    let input = serde_json::from_str::<DeliveryInput>(body)
        .map_err(|_| "invalid delivery input".to_string())?;
    match (input.outcome.as_str(), input.reason) {
        ("done", None) => Ok(WorkerDelivery::Done),
        ("done", Some(_)) => Err("a done delivery takes no reason".into()),
        ("blocked", Some(reason)) if !reason.trim().is_empty() => {
            Ok(WorkerDelivery::Blocked { reason })
        }
        ("blocked", _) => Err("a blocked delivery requires a non-empty reason".into()),
        _ => Err("delivery outcome must be done or blocked".into()),
    }
}

fn delivery_value((run, repeated): DeliveryReceipt) -> Value {
    json!({
        "apiVersion": 1,
        "runId": run.id,
        "status": run.status,
        "repeated": repeated,
        "run": run,
    })
}

pub(super) fn handle_run(inner: &Inner, request: &Request, grant: RunGrant) -> Response {
    if request.headers.contains_key(VERDICT_TOKEN_HEADER) || !request.query.is_empty() {
        return Response::error(
            403,
            "run credentials cannot carry verdict authority or override scope",
        );
    }
    let segments = request.segments();
    let path: Vec<&str> = segments.iter().map(String::as_str).collect();
    let backend = inner.backend.as_ref();
    let result = match (request.method.as_str(), path.as_slice()) {
        ("GET", ["api", "hq", "v1", "agent", "records", collection, cursor])
            if matches!(*collection, "evidence" | "reviews") =>
        {
            backend.agent_record_page(
                &grant.run_id,
                &grant.owner,
                grant.fence,
                collection,
                if *cursor == "start" {
                    None
                } else {
                    Some(cursor)
                },
            )
        }
        ("GET", ["api", "hq", "v1", "agent", "checkpoint", revision]) => {
            let revision = match revision.parse::<i64>() {
                Ok(revision) if revision > 0 => revision,
                _ => return Response::error(400, "invalid checkpoint revision"),
            };
            backend.agent_checkpoint_at(&grant.run_id, &grant.owner, grant.fence, revision)
        }
        ("GET", ["api", "hq", "v1", "agent", "evidence", id]) => {
            backend.agent_evidence(&grant.run_id, &grant.owner, grant.fence, id)
        }
        ("GET", ["api", "hq", "v1", "agent", "context"]) => {
            backend.agent_run_context(&grant.run_id, &grant.owner, grant.fence)
        }
        ("GET", ["api", "hq", "v1", "agent", "lessons"]) => {
            backend.agent_run_context(&grant.run_id, &grant.owner, grant.fence)
                .map(|context| {
                    let lessons = context
                        .get("guidance")
                        .and_then(|guidance| guidance.get("lessons"))
                        .cloned()
                        .unwrap_or_else(|| {
                            json!({
                                "state": "unavailable",
                                "reason": "run guidance did not include lessons",
                                "instructionAuthority": false,
                            })
                        });
                    json!({
                        "apiVersion": 1,
                        "source": "rust/sqlite",
                        "sourceTimestamp": context.get("sourceTimestamp").cloned().unwrap_or(Value::Null),
                        "runId": grant.run_id,
                        "lessons": lessons,
                        "instructionAuthority": false,
                    })
                })
        }
        ("GET", ["api", "hq", "v1", "agent", "release"]) => backend
            .agent_run_context(&grant.run_id, &grant.owner, grant.fence)
            .map(|context| release_view(&grant.run_id, &context)),
        ("POST", ["api", "hq", "v1", "agent", "checkpoint"]) => {
            let input = match serde_json::from_str::<crate::store::development_runs::CheckpointInput>(
                &request.body,
            ) {
                Ok(input) => input,
                Err(_) => return Response::error(400, "invalid checkpoint input"),
            };
            backend.agent_checkpoint(&grant.run_id, &grant.owner, grant.fence, input)
        }
        ("POST", ["api", "hq", "v1", "agent", "candidate"]) => {
            let input = match serde_json::from_str::<CandidateInput>(&request.body) {
                Ok(input) => input,
                Err(_) => return Response::error(400, "invalid candidate input"),
            };
            backend.agent_bind_candidate(&grant.run_id, &grant.owner, grant.fence, input)
        }
        ("POST", ["api", "hq", "v1", "agent", "evidence"]) => {
            let input = match serde_json::from_str::<crate::store::development_runs::EvidenceInput>(
                &request.body,
            ) {
                Ok(input) => input,
                Err(_) => return Response::error(400, "invalid evidence input"),
            };
            backend.agent_submit_evidence(&grant.run_id, &grant.owner, grant.fence, input)
        }
        // W2-01b: the reviewer principal is the run this credential was minted
        // for. `ReviewInput` denies unknown fields, so a body naming a run
        // (`reviewerRunId`, `runId`, ...) is refused with 400 like every other
        // injected run field on these routes - never silently ignored, so a
        // confused or forging caller learns its claim did not count. The
        // reviewed run is the owner of the named evidence, derived by the store.
        ("POST", ["api", "hq", "v1", "agent", "review"]) => {
            let input = match serde_json::from_str::<crate::store::development_runs::ReviewInput>(
                &request.body,
            ) {
                Ok(input) => input,
                Err(_) => return Response::error(400, "invalid review input"),
            };
            backend.agent_submit_review(&grant.run_id, &grant.owner, grant.fence, input)
        }
        // The run is the credential's, never the body's: `DeliveryInput` denies
        // unknown fields, like the other agent POST routes.
        ("POST", ["api", "hq", "v1", "agent", "delivery"]) => {
            let delivery = match parse_delivery(&request.body) {
                Ok(delivery) => delivery,
                Err(error) => return Response::error(400, error),
            };
            match backend.agent_record_delivery(&grant.run_id, &grant.owner, grant.fence, delivery)
            {
                Ok(receipt) => Ok(delivery_value(receipt)),
                Err(DeliveryError::Conflict(error)) => return Response::error(409, error),
                Err(DeliveryError::Failed(error)) => Err(error),
            }
        }
        _ => return Response::error(403, "route is outside this run credential scope"),
    };
    match result {
        Ok(value) => Response::ok(value),
        Err(error) if error.contains("unauthorized") => {
            Response::error(403, "run ownership is no longer authorized")
        }
        Err(error) => agent_error(error),
    }
}

/// The release view of one run. Delivery and approval authority are never
/// taken from the run context: a scoped credential cannot widen them.
fn release_view(run_id: &str, context: &Value) -> Value {
    let field = |name: &str| context.get(name).cloned().unwrap_or(Value::Null);
    json!({
        "apiVersion": 1,
        "source": "rust/sqlite",
        "sourceTimestamp": field("sourceTimestamp"),
        "runId": run_id,
        "runStatus": context.get("run").and_then(|run| run.get("status")).cloned().unwrap_or(Value::Null),
        "candidate": field("candidate"),
        "evidenceTotal": field("evidenceTotal"),
        "reviewTotal": field("reviewTotal"),
        "delivery": {
            "state": "unavailable",
            "reason": "release authority is outside a scoped run credential",
            "automaticDelivery": false,
        },
        "approvalAuthority": crate::store::development_runs::approval_authority(),
    })
}

fn agent_error(error: String) -> Response {
    // A well-formed review this credential's run may not give: its own
    // candidate, the same model vendor, another project. Retrying cannot
    // change the principal, so it is a refusal (403), not a bad request.
    if error.starts_with("reviewer must be independent")
        || error == "reviewer run belongs to another project"
    {
        return Response::error(403, error);
    }
    if error == "review evidence does not exist" {
        return Response::error(404, error);
    }
    if error.contains("idempotency key was reused")
        || error == "review evidence is not valid for the reviewed run and candidate"
        || error.starts_with("checkpoint idempotency key reused")
        || error.starts_with("checkpoint revision changed")
        || error.starts_with("checkpoint evidence is missing")
        || error.contains("development run is not active")
        || error.contains("candidate does not match")
        || error.contains("candidate must be bound")
        || error.starts_with("candidate scope check failed:")
        || error.starts_with("ambiguous candidate observation:")
    {
        Response::error(409, error)
    } else if error.contains("cannot be in the future")
        || error.starts_with("invalid record cursor")
        || error.starts_with("invalid or mismatched record cursor")
        || error.contains("cannot use a null value")
        || error.starts_with("checkpoint exceeds")
    {
        Response::error(400, error)
    } else {
        continuous_error(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::development_runs::{
        DevelopmentEvidence, EvidenceInput, EvidenceMeasurement, ReviewInput,
    };
    use crate::testutil::TempDir;
    use std::io::{Read, Write};
    use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream};
    macro_rules! unavailable {
        ($(fn $name:ident($($arg:ident: $ty:ty),*) -> $result:ty;)*) => {$(
            fn $name(&self $(, $arg: $ty)*) -> $result { unreachable!("unused test backend method") }
        )*};
    }
    const COMMIT_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const COMMIT_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    struct StoreBackend(crate::store::Store);

    impl ControlBackend for StoreBackend {
        fn agent_evidence(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            id: &str,
        ) -> Result<Value, String> {
            tauri::async_runtime::block_on(self.0.agent_evidence(run, owner, fence, id))
        }
        fn agent_run_context(&self, run: &str, owner: &str, fence: i64) -> Result<Value, String> {
            tauri::async_runtime::block_on(self.0.agent_run_context(run, owner, fence))
        }
        fn agent_bind_candidate(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            input: CandidateInput,
        ) -> Result<Value, String> {
            let binding = tauri::async_runtime::block_on(self.0.bind_development_run_candidate(
                run,
                owner,
                fence,
                &input.candidate_commit,
                &input.source,
                input.observed_at,
            ))?;
            serde_json::to_value(binding).map_err(|error| error.to_string())
        }
        fn agent_submit_evidence(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            input: EvidenceInput,
        ) -> Result<Value, String> {
            let evidence = tauri::async_runtime::block_on(
                self.0.record_development_evidence(run, owner, fence, input),
            )?;
            serde_json::to_value(evidence).map_err(|error| error.to_string())
        }
        fn agent_submit_review(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            input: ReviewInput,
        ) -> Result<Value, String> {
            let review = tauri::async_runtime::block_on(
                self.0.record_development_review(run, owner, fence, input),
            )?;
            serde_json::to_value(review).map_err(|error| error.to_string())
        }
        unavailable! {
            fn project_exists(_project_id: &str) -> Result<bool, String>; fn create_worker(_project_id: &str, _task: &str, _profile_id: &str, _spawned_by: Option<String>) -> Result<Worker, String>; fn list_workers(_project_id: Option<&str>) -> Result<Vec<Worker>, String>; fn worker_state(_worker_id: &str) -> Result<Option<WorkerBoardState>, String>; fn send_to_worker(_worker_id: &str, _text: &str) -> Result<(), String>; fn merge_worker(_worker_id: &str, _remove: bool) -> Result<Worker, String>; fn send_to_orchestrator(_project_id: &str, _text: &str) -> Result<Worker, String>; fn list_worker_messages(_worker_id: &str, _limit: Option<usize>) -> Result<Vec<Message>, String>; fn board(_project_id: Option<&str>) -> Result<Vec<WorkerBoardState>, String>; fn quota() -> Result<Vec<QuotaStateRow>, String>; fn updater_state() -> Result<UpdaterState, String>; fn providers() -> Result<Vec<ProviderOverview>, String>; fn usage(_limit: u32) -> Result<UsageReport, String>; fn list_budgets() -> Result<Vec<BudgetLimits>, String>; fn set_budget(_profile_id: &str, _five: Option<Option<u8>>, _seven: Option<Option<u8>>) -> Result<BudgetLimits, String>; fn enqueue_task(_project_id: &str, _text: &str, _profile: Option<String>, _sharpen: bool, _priority: Option<i32>, _spawned_by: Option<String>) -> Result<QueueEntry, String>; fn list_queue(_project_id: Option<&str>) -> Result<Vec<QueueEntry>, String>; fn cancel_queued_task(_id: &str) -> Result<(), String>; fn create_scout(_project_id: &str) -> Result<Worker, String>; fn triage_repos(_project_id: &str, _urls: &[String]) -> Result<Worker, String>; fn list_recommendations(_project_id: Option<&str>) -> Result<Vec<Recommendation>, String>; fn add_recommendation(_project_id: &str, _title: &str, _rationale: &str, _url: Option<String>, _effort: Option<String>) -> Result<Recommendation, String>; fn set_recommendation_status(_id: &str, _status: &str) -> Result<(), String>; fn accept_recommendation(_id: &str) -> Result<QueueEntry, String>; fn list_learnings(_project_id: Option<&str>, _status: Option<&str>) -> Result<Vec<Learning>, String>; fn approve_learning(_id: &str, _text: &str) -> Result<(), String>; fn reject_learning(_id: &str) -> Result<(), String>; fn ask_question(_project_id: &str, _worker_id: Option<&str>, _question: &str, _options: Option<&str>) -> Result<Question, String>; fn answer_question(_id: &str, _answer: &str, _by: &str) -> Result<Question, String>; fn list_questions(_project_id: Option<&str>, _status: Option<&str>) -> Result<Vec<Question>, String>; fn list_role_variants(_project_id: Option<&str>, _status: Option<&str>) -> Result<Vec<RoleVariant>, String>; fn approve_role_variant(_id: &str) -> Result<(), String>; fn reject_role_variant(_id: &str) -> Result<(), String>; fn get_activity(_project_id: Option<&str>, _limit: u32) -> Result<Vec<ActivityEntry>, String>; fn list_projects() -> Result<Vec<ProjectOverview>, String>; fn create_project(_name: &str, _repo: &str) -> Result<ProjectOverview, String>; fn create_github_repo(_project_id: &str, _name: &str, _private: bool) -> Result<String, String>; fn link_github_remote(_project_id: &str, _url: &str) -> Result<(), String>; fn get_landing_page(_project_id: &str) -> Result<Option<String>, String>; fn set_landing_page(_project_id: &str, _markdown: Option<&str>) -> Result<(), String>; fn list_digests(_project_id: &str) -> Result<Vec<String>, String>; fn read_digest(_project_id: &str, _date: &str) -> Result<Option<String>, String>; fn project_stats(_project_id: &str, _range: crate::stats::StatsRange) -> Result<crate::stats::ProjectStats, String>;
        }
    }
    struct Route {
        server: ApiServer,
        store: crate::store::Store,
        pool: sqlx::SqlitePool,
        implementer: String,
        peer: String,
        reviewer: String,
        foreign_reviewer: String,
        _dir: TempDir,
    }
    async fn create_run(
        store: &crate::store::Store,
        task: &str,
        owner: &str,
        fence: i64,
    ) -> String {
        store
            .record_development_run_intent(task, owner, fence)
            .await
            .unwrap()
            .id
    }

    fn route(label: &str) -> Route {
        let dir = TempDir::new(label);
        let db = dir.path().join("projecta.db");
        let store = tauri::async_runtime::block_on(crate::store::Store::open(&db)).unwrap();
        let pool = tauri::async_runtime::block_on(sqlx::SqlitePool::connect(&format!(
            "sqlite:{}",
            db.display()
        )))
        .unwrap();
        let (implementer, peer, reviewer, foreign_reviewer) = tauri::async_runtime::block_on(
            async {
                let policy = serde_json::to_string(
                    &crate::development_policy::DevelopmentPolicy::defaults(),
                )
                .unwrap();
                for (root, project) in [("root-a", "project-a"), ("root-b", "project-b")] {
                    sqlx::query("INSERT INTO continuous_goals(id,project_id,root_goal_id,objective,status,deadline_at,admitted,created_at,updated_at) VALUES(?,?,?,'goal','open',9999999999,1,1,1)")
                        .bind(root).bind(project).bind(root).execute(&pool).await.unwrap();
                    sqlx::query("INSERT INTO continuous_root_policies(root_goal_id,policy_json,source,observed_at) VALUES(?,?,'test',1)")
                        .bind(root).bind(&policy).execute(&pool).await.unwrap();
                }
                for (task, root, owner, fence) in [
                    ("task-a", "root-a", "worker-a", 7),
                    ("task-b", "root-a", "worker-b", 8),
                    ("task-r", "root-a", "worker-r", 3),
                    ("task-f", "root-b", "worker-f", 4),
                ] {
                    sqlx::query("INSERT INTO continuous_tasks(id,goal_id,objective,owned_paths_json,dependencies_json,status,claim_owner,claim_fence,created_at,updated_at) VALUES(?,?,'task','[]','[]','running',?,?,1,1)")
                        .bind(task).bind(root).bind(owner).bind(fence).execute(&pool).await.unwrap();
                }
                for (task, owner) in [("task-r", "worker-r"), ("task-f", "worker-f")] {
                    sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES(?,'development','reviewer',?,1,1,1)")
                        .bind(task).bind(owner).execute(&pool).await.unwrap();
                }
                let a = create_run(&store, "task-a", "worker-a", 7).await;
                let b = create_run(&store, "task-b", "worker-b", 8).await;
                let r = create_run(&store, "task-r", "worker-r", 3).await;
                let f = create_run(&store, "task-f", "worker-f", 4).await;
                (a, b, r, f)
            },
        );
        let server = boot(
            Arc::new(StoreBackend(store.clone())),
            &dir.path().join("api"),
            false,
        )
        .unwrap();
        Route {
            server,
            store,
            pool,
            implementer,
            peer,
            reviewer,
            foreign_reviewer,
            _dir: dir,
        }
    }

    impl Route {
        fn call(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            method: &str,
            path: &str,
            body: &str,
        ) -> (u16, Value) {
            let token = self
                .server
                .issue_run_descriptor(run, owner, fence, 60)
                .unwrap()
                .token;
            let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, self.server.port()));
            let mut stream = TcpStream::connect(addr).unwrap();
            stream.set_read_timeout(Some(IO_TIMEOUT)).unwrap();
            write!(stream, "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{TOKEN_HEADER}: {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
            let mut raw = String::new();
            stream.read_to_string(&mut raw).unwrap();
            let status = raw[9..12].parse().unwrap();
            let body = raw.split_once("\r\n\r\n").unwrap().1;
            (status, serde_json::from_str(body).unwrap())
        }

        fn candidate(&self, commit: &str, observed_at: i64) -> (u16, Value) {
            let body = json!({"candidateCommit":commit,"source":"git","observedAt":observed_at})
                .to_string();
            self.call(
                &self.implementer,
                "worker-a",
                7,
                "POST",
                "/api/hq/v1/agent/candidate",
                &body,
            )
        }

        fn evidence(&self) -> (u16, Value) {
            let body = json!({"idempotencyKey":"evidence-key","source":"cargo","observedAt":7,"candidateCommit":COMMIT_A,"measurement":{"state":"measured","value":{"passed":true}},"payload":{"command":"cargo test"}}).to_string();
            self.call(
                &self.implementer,
                "worker-a",
                7,
                "POST",
                "/api/hq/v1/agent/evidence",
                &body,
            )
        }

        fn trusted_evidence(
            &self,
            commit: &str,
            key: &str,
            observed_at: i64,
        ) -> DevelopmentEvidence {
            tauri::async_runtime::block_on(self.store.record_trusted_development_test_evidence(
                &self.implementer,
                "worker-a",
                7,
                EvidenceInput {
                    idempotency_key: key.into(),
                    source: "projecta-test-runner".into(),
                    observed_at,
                    candidate_commit: commit.into(),
                    measurement: EvidenceMeasurement::Measured {
                        value: json!({"passed": true}),
                    },
                    payload: json!({"command": "cargo test"}),
                },
            ))
            .unwrap()
        }

        fn review(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            evidence: &str,
            key: &str,
        ) -> (u16, Value) {
            let body = json!({"idempotencyKey":key,"evidenceId":evidence,"candidateCommit":COMMIT_A,"disposition":"approved","source":"review","observedAt":11}).to_string();
            self.call(run, owner, fence, "POST", "/api/hq/v1/agent/review", &body)
        }
    }

    #[test]
    fn candidate_and_evidence_bind_to_commit_and_run_and_replay_idempotently() {
        let fx = route("agent-http-bind-replay");
        assert_eq!(fx.candidate(COMMIT_A, 6).0, 200);
        let (status, first) = fx.evidence();
        assert_eq!(status, 200, "{first}");
        let (status, replay) = fx.evidence();
        assert_eq!(status, 200, "{replay}");
        assert_eq!(replay, first);
        assert_eq!(first["runId"], fx.implementer);
        assert_eq!(first["candidateCommit"], COMMIT_A);
    }

    #[test]
    fn evidence_is_readable_only_inside_its_own_run() {
        let fx = route("agent-http-evidence-scope");
        assert_eq!(fx.candidate(COMMIT_A, 6).0, 200);
        let evidence = fx.evidence().1;
        let path = format!(
            "/api/hq/v1/agent/evidence/{}",
            evidence["id"].as_str().unwrap()
        );
        let (status, reply) = fx.call(&fx.peer, "worker-b", 8, "GET", &path, "");
        assert_eq!(status, 404, "{reply}");
        assert_eq!(reply["error"], "unknown evidence in this run");
    }

    #[test]
    fn foreign_and_stale_evidence_are_refused() {
        let fx = route("agent-http-review-scope");
        assert_eq!(fx.candidate(COMMIT_A, 6).0, 200);
        let evidence = fx.evidence().1["id"].as_str().unwrap().to_string();
        let (status, reply) = fx.review(&fx.foreign_reviewer, "worker-f", 4, &evidence, "foreign");
        assert_eq!(status, 403, "{reply}");
        assert_eq!(reply["error"], "reviewer run belongs to another project");
        assert_eq!(fx.candidate(COMMIT_B, 9).0, 200);
        assert_eq!(fx.candidate(COMMIT_A, 10).0, 200);
        let (status, reply) = fx.review(&fx.reviewer, "worker-r", 3, &evidence, "stale");
        assert_eq!(status, 409, "{reply}");
        assert_eq!(
            reply["error"],
            "review evidence is not valid for the reviewed run and candidate"
        );
    }

    #[test]
    fn candidate_delta_invalidates_prior_chain_over_http() {
        let fx = route("agent-http-candidate-delta");
        assert_eq!(fx.candidate(COMMIT_A, 6).0, 200);
        let evidence_a = fx.trusted_evidence(COMMIT_A, "trusted-a", 7);
        let (status, review_a) = fx.review(&fx.reviewer, "worker-r", 3, &evidence_a.id, "review-a");
        assert_eq!(status, 200, "{review_a}");
        assert_eq!(review_a["status"], "valid");

        let replay = fx.candidate(COMMIT_A, 8);
        assert_eq!(replay.1["invalidatedRecords"], 0);
        let (status, briefing) = fx.call(
            &fx.implementer,
            "worker-a",
            7,
            "GET",
            "/api/hq/v1/agent/context",
            "",
        );
        assert_eq!(status, 200, "{briefing}");
        assert_eq!(briefing["reviews"][0]["status"], "valid");

        let delta = fx.candidate(COMMIT_B, 9);
        assert_eq!(delta.0, 200, "{}", delta.1);
        let briefing = fx
            .call(
                &fx.implementer,
                "worker-a",
                7,
                "GET",
                "/api/hq/v1/agent/context",
                "",
            )
            .1;
        assert_eq!(briefing["candidate"]["candidateCommit"], COMMIT_B);
        assert!(briefing["evidence"][0]["invalidatedAt"].as_i64().is_some());
        assert_eq!(briefing["reviews"][0]["status"], "invalidated");
        assert_eq!(briefing["reviews"][0]["candidateCommit"], COMMIT_A);
        assert_eq!(briefing["reviews"][0]["invalidatedAt"], 9);
        assert_eq!(briefing["reviews"][0]["invalidatedByCommit"], COMMIT_B);
        assert_eq!(briefing["reviews"][0]["id"], review_a["id"]);
        let evidence_path = format!("/api/hq/v1/agent/evidence/{}", evidence_a.id);
        let evidence = fx
            .call(&fx.implementer, "worker-a", 7, "GET", &evidence_path, "")
            .1;
        assert_eq!(evidence["candidateCommit"], COMMIT_A);
        assert_eq!(evidence["invalidatedAt"], 9);
        assert_eq!(evidence["invalidatedByCommit"], COMMIT_B);
        let release = fx
            .call(
                &fx.implementer,
                "worker-a",
                7,
                "GET",
                "/api/hq/v1/agent/release",
                "",
            )
            .1;
        assert_eq!(release["candidate"]["candidateCommit"], COMMIT_B);
        assert_eq!(release["approvalAuthority"]["state"], "unavailable");

        let stale_review = fx.review(
            &fx.reviewer,
            "worker-r",
            3,
            &evidence_a.id,
            "stale-review-a",
        );
        assert_eq!(stale_review.0, 409, "{}", stale_review.1);
        assert_ne!(fx.candidate(COMMIT_A, 8).0, 200);
        let replay_b = fx.candidate(COMMIT_B, 10).1;
        assert_eq!(replay_b["candidateCommit"], COMMIT_B);
        assert_eq!(replay_b["invalidatedRecords"], 0);

        let evidence_b = fx.trusted_evidence(COMMIT_B, "trusted-b", 10);
        let review_b_body = json!({"idempotencyKey":"review-b","evidenceId":evidence_b.id,"candidateCommit":COMMIT_B,"disposition":"approved","source":"review","observedAt":11}).to_string();
        let review_b = fx.call(
            &fx.reviewer,
            "worker-r",
            3,
            "POST",
            "/api/hq/v1/agent/review",
            &review_b_body,
        );
        assert_eq!(review_b.0, 200, "{}", review_b.1);
        assert_eq!(review_b.1["status"], "valid");
        assert_eq!(review_b.1["approvalEligible"], false);

        let reopened = tauri::async_runtime::block_on(crate::store::Store::open(
            &fx._dir.path().join("projecta.db"),
        ))
        .unwrap();
        let persisted = tauri::async_runtime::block_on(reopened.agent_run_context(
            &fx.implementer,
            "worker-a",
            7,
        ))
        .unwrap();
        assert_eq!(persisted["candidate"]["candidateCommit"], COMMIT_B);
        let old = persisted["reviews"]
            .as_array()
            .unwrap()
            .iter()
            .find(|review| review["id"] == review_a["id"])
            .unwrap();
        assert_eq!(old["status"], "invalidated");
        assert_eq!(old["candidateCommit"], COMMIT_A);
        assert_eq!(old["invalidatedAt"], 9);
        assert_eq!(old["invalidatedByCommit"], COMMIT_B);

        let insert = tauri::async_runtime::block_on(sqlx::query("INSERT INTO development_run_reviews(id,run_id,evidence_id,idempotency_key,candidate_commit,disposition,reviewer_identity,implementer_identity,source,observed_at,reviewer_attestation,approval_eligible,status) SELECT 'forged',run_id,evidence_id,'forged',candidate_commit,disposition,reviewer_identity,implementer_identity,source,observed_at,reviewer_attestation,1,status FROM development_run_reviews LIMIT 1").execute(&fx.pool));
        assert!(insert.is_err());
        let update = tauri::async_runtime::block_on(
            sqlx::query("UPDATE development_run_reviews SET approval_eligible=1 WHERE id=?")
                .bind(review_b.1["id"].as_str().unwrap())
                .execute(&fx.pool),
        );
        assert!(update.is_err());
    }

    #[test]
    fn rewritten_root_policy_leaves_run_policy_unchanged_and_fails_closed() {
        let fx = route("agent-http-frozen-policy");
        let context = fx
            .call(
                &fx.implementer,
                "worker-a",
                7,
                "GET",
                "/api/hq/v1/agent/context",
                "",
            )
            .1;
        let frozen = context["run"]["policyJson"].clone();
        let mut rewritten = crate::development_policy::DevelopmentPolicy::defaults();
        rewritten.teams[0].roles = vec!["reviewer".into()];
        tauri::async_runtime::block_on(
            sqlx::query(
                "UPDATE continuous_root_policies SET policy_json=? WHERE root_goal_id='root-a'",
            )
            .bind(serde_json::to_string(&rewritten).unwrap())
            .execute(&fx.pool),
        )
        .unwrap();
        let (status, context) = fx.call(
            &fx.implementer,
            "worker-a",
            7,
            "GET",
            "/api/hq/v1/agent/context",
            "",
        );
        assert_eq!(status, 200, "{context}");
        assert_eq!(context["run"]["policyJson"], frozen);
        assert_eq!(context["dispatch"]["role"], Value::Null);
        assert!(context["dispatch"]["unresolved"]
            .as_str()
            .unwrap()
            .contains("frozen root policy"));
    }
    #[test]
    fn checkpoint_input_and_conflicts_have_actionable_http_status() {
        assert_eq!(agent_error("invalid record cursor".into()).status, 400);
        assert_eq!(
            agent_error("invalid or mismatched record cursor".into()).status,
            400
        );
        for error in [
            "checkpoint idempotency key reused with different content",
            "checkpoint revision changed; refresh task context",
            "checkpoint evidence is missing, stale or belongs to another run",
        ] {
            assert_eq!(agent_error(error.into()).status, 409, "{error}");
        }
        assert_eq!(
            agent_error("checkpoint exceeds revision, list or 16KiB content limits".into()).status,
            400
        );
        assert_eq!(
            agent_error("unknown checkpoint revision for this task".into()).status,
            404
        );
    }
    #[test]
    fn evidence_validation_and_candidate_conflicts_are_not_server_failures() {
        assert_eq!(
            agent_error("observedAt cannot be in the future".into()).status,
            400
        );
        assert_eq!(
            agent_error("measured evidence cannot use a null value".into()).status,
            400
        );
        for error in [
            "development evidence idempotency key was reused with a different payload",
            "evidence candidate does not match the bound current candidate",
            "candidate must be bound before accepting evidence",
            "candidate scope check failed: candidate changes a path outside task ownership",
            "development run is not active; candidate and evidence writes are closed",
        ] {
            assert_eq!(agent_error(error.into()).status, 409);
        }
        assert_eq!(agent_error("database pool unavailable".into()).status, 500);
    }
    #[test]
    fn ambiguous_candidate_observations_are_conflicts() {
        assert_eq!(
            agent_error(
                "ambiguous candidate observation: observedAt 10 ties with the bound candidate; the order within one second is unknown"
                    .into()
            )
            .status,
            409
        );
    }
    /// The store's review refusals, verbatim from `record_development_review`.
    #[test]
    fn review_refusals_are_not_bad_requests_or_server_failures() {
        for error in [
            "reviewer must be independent from the implementer: a run cannot review its own candidate",
            "reviewer must be independent: reviewer and implementer resolve to the same provider claude",
            "reviewer run belongs to another project",
        ] {
            assert_eq!(agent_error(error.into()).status, 403, "{error}");
        }
        assert_eq!(
            agent_error("review evidence does not exist".into()).status,
            404
        );
        for error in [
            "review evidence is not valid for the reviewed run and candidate",
            "development review idempotency key was reused with a different payload",
        ] {
            assert_eq!(agent_error(error.into()).status, 409, "{error}");
        }
        assert_eq!(agent_error("evidenceId is required".into()).status, 400);
    }
    #[test]
    fn expired_and_previous_process_credentials_are_rejected() {
        let credentials = RunCredentials::default();
        credentials.0.lock().unwrap().insert(
            "expired".into(),
            RunGrant {
                run_id: "run".into(),
                owner: "owner".into(),
                fence: 1,
                expires_at: now() - Duration::from_secs(1),
                descriptor_file: None,
                session_id: None,
            },
        );
        assert!(credentials.lookup("expired").is_none());
        credentials.0.lock().unwrap().insert(
            "live".into(),
            RunGrant {
                run_id: "run".into(),
                owner: "owner".into(),
                fence: 1,
                expires_at: now() + Duration::from_secs(60),
                descriptor_file: None,
                session_id: None,
            },
        );
        assert!(credentials.lookup("live").is_some());
        assert!(RunCredentials::default().lookup("live").is_none());
    }
    fn grant_with_file(path: PathBuf) -> RunGrant {
        RunGrant {
            run_id: "run".into(),
            owner: "owner".into(),
            fence: 1,
            expires_at: now() + Duration::from_secs(60),
            descriptor_file: Some(path),
            session_id: None,
        }
    }

    /// INV-SEC-CRED-CLEANUP: a descriptor that cannot be removed used to
    /// vanish into `let _ =`; it must come back as an error, while a file
    /// that is already gone counts as removed.
    #[test]
    fn grant_file_removal_failure_is_reported_and_not_found_counts_as_removed() {
        let dir = TempDir::new("grant-file-removal");
        let file = dir.path().join("gone.json");
        assert_eq!(remove_grant_file(&grant_with_file(file.clone())), Ok(()));
        std::fs::write(&file, b"{}").unwrap();
        assert_eq!(remove_grant_file(&grant_with_file(file.clone())), Ok(()));
        assert!(!file.exists());
        let stuck = dir.path().join("stuck.json");
        std::fs::create_dir(&stuck).unwrap();
        assert!(remove_grant_file(&grant_with_file(stuck)).is_err());
    }

    /// The boot sweep counts failures instead of only successes.
    #[cfg(unix)]
    #[test]
    fn orphan_sweep_counts_files_it_could_not_remove() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new("orphan-sweep-failure");
        let access = dir.path().join(ACCESS_DIR);
        std::fs::create_dir_all(&access).unwrap();
        std::fs::write(access.join(format!("{:032x}.json", 1)), b"{}").unwrap();
        std::fs::set_permissions(&access, std::fs::Permissions::from_mode(0o500)).unwrap();
        let report = sweep_orphaned_descriptor_files(dir.path());
        std::fs::set_permissions(&access, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!((report.removed, report.failed), (0, 1));
    }

    /// W1-15c: under poison the credential map only shrinks and is never
    /// trusted. `revoke_all` used to skip a poisoned map, leaving every
    /// grant and its descriptor file alive; `lookup` stays fail-closed,
    /// because `observe_exit` and `revoke_run_credentials` refuse a poisoned
    /// map and a recovered read could honour a grant they failed to revoke.
    #[test]
    fn a_poisoned_credential_map_still_revokes_and_never_admits() {
        let credentials = RunCredentials::default();
        credentials.0.lock().unwrap().insert(
            "live".into(),
            RunGrant {
                run_id: "run".into(),
                owner: "owner".into(),
                fence: 1,
                expires_at: now() + Duration::from_secs(60),
                descriptor_file: None,
                session_id: None,
            },
        );
        std::thread::scope(|scope| {
            let _ = scope
                .spawn(|| {
                    let _guard = credentials.0.lock();
                    panic!("poison fixture");
                })
                .join();
        });
        assert!(credentials.0.is_poisoned());
        assert!(
            credentials.lookup("live").is_none(),
            "a poisoned credential map must not admit a token"
        );
        credentials.revoke_all();
        assert!(
            credentials
                .0
                .lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .is_empty(),
            "revoke_all must clear a poisoned credential map"
        );
    }

    /// W2-01c: the release view states the W2-01 approval rule (reviewer
    /// principals from launch route receipts, no signed verdicts yet) and
    /// never takes delivery or approval authority from the run context.
    #[test]
    fn release_view_states_the_w2_01_approval_rule_and_ignores_the_context() {
        let forged = json!({
            "approvalAuthority": { "state": "available", "reviewerPrincipal": "caller" },
            "delivery": { "state": "available", "automaticDelivery": true },
            "reviewTotal": 2,
        });
        let view = release_view("run-a", &forged);
        let authority = &view["approvalAuthority"];
        assert_eq!(authority["state"], "unavailable");
        assert_eq!(authority["reviewerPrincipal"], "launch-route-receipt");
        assert!(
            authority["detail"]
                .as_str()
                .is_some_and(|detail| detail.contains("signed verdicts")),
            "{authority}"
        );
        assert_eq!(
            *authority,
            crate::store::development_runs::approval_authority()
        );
        assert_eq!(view["delivery"]["state"], "unavailable");
        assert_eq!(view["delivery"]["automaticDelivery"], false);
        assert_eq!(view["runId"], "run-a");
        assert_eq!(view["reviewTotal"], 2);
    }
}
