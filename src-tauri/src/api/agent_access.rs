//! Process-scoped credentials for one already claimed development run.
//! Only trusted in-process launch code can mint them. Restart revokes all grants;
//! a launcher must reconcile the durable run before obtaining a replacement.
use super::*;
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
                    remove_grant_file(grant);
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
                remove_grant_file(grant);
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
            #[cfg(unix)]
            crate::oneshot::make_private(&directory);
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
                remove_grant_file(&grant);
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
                    remove_grant_file(grant);
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
            remove_grant_file(grant);
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
pub(super) fn sweep_orphaned_descriptor_files(api_dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(api_dir.join(ACCESS_DIR)) else {
        return 0;
    };
    let mut removed = 0;
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
        if minted && regular && std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

fn remove_grant_file(grant: &RunGrant) {
    if let Some(path) = &grant.descriptor_file {
        let _ = std::fs::remove_file(path);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateInput {
    pub candidate_commit: String,
    pub source: String,
    pub observed_at: i64,
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
