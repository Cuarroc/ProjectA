//! Final native authority is an opaque value returned only after host cleanup.
//! Provisional checkpoint JSON is never accepted as that authority.
use super::*;
use crate::store::development_budget::usage_receipt::UsageReceipt;
use crate::store::development_budget::{self, CaptureLaunchIdentity, RunUsageBinding};

struct ClosingBinding {
    bindings: std::sync::Arc<std::sync::Mutex<crate::store::SessionBindings>>,
    worker: String,
}
impl Drop for ClosingBinding {
    fn drop(&mut self) {
        if let Ok(mut bindings) = self.bindings.lock() {
            bindings.native_closing.remove(&self.worker);
        }
    }
}

pub(crate) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("CREATE TABLE development_capture_results (run_id TEXT PRIMARY KEY REFERENCES development_capture_owners(run_id), result_json TEXT NOT NULL, observed_at INTEGER NOT NULL)")
        .execute(&mut **tx).await.map_err(db)?;
    Ok(())
}

impl Store {
    /// Trusted native final handler, after capture accounting and revocation.
    /// Keep the in-memory binding until both durable rows commit together.
    pub(crate) async fn finish_native_session(&self, owner: &CaptureOwner) -> Result<(), String> {
        self.finish_native_session_observed(owner, || {}).await
    }

    async fn finish_native_session_observed(
        &self,
        owner: &CaptureOwner,
        after_claim: impl FnOnce(),
    ) -> Result<(), String> {
        let mut tx = self.pool.begin().await.map_err(db)?;
        ensure_full(&mut tx).await?;
        // next_stage=4 closes a confirmed delivery, next_stage=2 only an
        // undelivered exit; the row query below pins each to its own result.
        let changed = sqlx::query("UPDATE development_capture_owners SET state=state WHERE run_id=? AND capability_sha256=? AND launch_sha256=? AND claim_owner=? AND claim_fence=? AND state='closed' AND next_stage IN (2,4)")
            .bind(&owner.binding.run_id).bind(&owner.capability_sha256).bind(&owner.launch_sha256)
            .bind(&owner.owner).bind(owner.fence).execute(&mut *tx).await.map_err(db)?;
        if changed.rows_affected() != 1 {
            return Err("native session owner incomplete or changed".into());
        }
        let row: Option<(String, i32)> = sqlx::query_as("SELECT l.worker_id,l.exit_code FROM development_launches l JOIN development_capture_results c ON c.run_id=l.run_id JOIN development_capture_owners o ON o.run_id=l.run_id JOIN development_runs r ON r.id=l.run_id JOIN continuous_tasks t ON t.id=r.task_id JOIN sessions s ON s.id=l.session_id AND s.worker_id=l.worker_id JOIN workers w ON w.id=l.worker_id AND w.project_id=l.project_id WHERE l.run_id=? AND l.session_id=? AND l.process_instance=? AND ((o.next_stage=4 AND l.state='exited' AND json_extract(c.result_json,'$.state')='native_cleanup_confirmed') OR (o.next_stage=2 AND l.state='exited_undelivered' AND json_extract(c.result_json,'$.state')='native_exited_before_input_delivery')) AND l.exit_code IS NOT NULL AND r.status='reconciling' AND r.claim_owner=? AND r.claim_fence=? AND t.claim_owner=? AND t.claim_fence=? AND t.status='running' AND (s.ended_at IS NULL OR s.exit_code=l.exit_code)")
            .bind(&owner.binding.run_id).bind(&owner.binding.session_id).bind(&owner.binding.process_instance)
            .bind(&owner.owner).bind(owner.fence).bind(&owner.owner).bind(owner.fence)
            .fetch_optional(&mut *tx).await.map_err(db)?;
        let (worker, exit_code) = row.ok_or("native session completion binding unavailable")?;
        let _closing = {
            let mut bindings = self
                .sessions
                .lock()
                .map_err(|_| "native session map unavailable")?;
            if bindings
                .by_worker
                .get(&worker)
                .is_some_and(|session| session != &owner.binding.session_id)
            {
                return Err("native worker rebound before completion".into());
            }
            if bindings
                .by_session
                .get(&owner.binding.session_id)
                .is_some_and(|bound_worker| bound_worker != &worker)
            {
                return Err("native session rebound to another worker".into());
            }
            if bindings.native_closing.contains_key(&worker) {
                return Err("native session finalization already in progress".into());
            }
            bindings
                .native_closing
                .insert(worker.clone(), owner.binding.session_id.clone());
            ClosingBinding {
                bindings: self.sessions.clone(),
                worker: worker.clone(),
            }
        };
        after_claim();
        let changed = sqlx::query("UPDATE sessions SET ended_at=unixepoch(),exit_code=? WHERE id=? AND worker_id=? AND ended_at IS NULL")
            .bind(exit_code).bind(&owner.binding.session_id).bind(&worker)
            .execute(&mut *tx).await.map_err(db)?;
        sqlx::query("UPDATE workers SET status=? WHERE id=? AND status=?")
            .bind(crate::store::STATUS_EXITED)
            .bind(&worker)
            .bind(crate::store::STATUS_RUNNING)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        if changed.rows_affected() == 1 {
            sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) SELECT project_id,'development_session_closed',json_object('version',1,'runId',run_id),unixepoch() FROM development_launches WHERE run_id=?")
                .bind(&owner.binding.run_id).execute(&mut *tx).await.map_err(db)?;
        }
        tx.commit().await.map_err(db)?;
        let mut bindings = self
            .sessions
            .lock()
            .map_err(|_| "native session map unavailable after commit")?;
        match bindings.by_worker.get(&worker) {
            Some(session) if session == &owner.binding.session_id => {
                bindings.unbind_worker(&worker);
            }
            Some(_) => return Err("native worker rebound during completion; reconcile".into()),
            None => {}
        }
        Ok(())
    }

    #[cfg(windows)]
    pub(crate) async fn finalize_native_capture(
        &self,
        owner: &CaptureOwner,
        confirmed: &crate::process_capture::windows_process::ConfirmedCapture,
    ) -> Result<(), String> {
        if confirmed.launch_sha256() != owner.launch_sha256 {
            return Err("confirmed native invocation differs from capture owner".into());
        }
        let host =
            serde_json::to_value(confirmed.host()).map_err(|_| "invalid host observation")?;
        self.commit_native_completion(owner, confirmed.reply(), host, confirmed.observed_at())
            .await
    }

    // Private seam for portable transaction tests. Production calls above must
    // carry native authority; serialized provider output cannot construct it.
    async fn commit_native_completion(
        &self,
        owner: &CaptureOwner,
        reply: &host_reply::Reply,
        host: Value,
        observed_at: i64,
    ) -> Result<(), String> {
        let bytes = serde_json::to_vec(reply).map_err(|_| "invalid final reply")?;
        host_reply::decode(&bytes, &owner.binding, &owner.launch)?;
        let metadata = owner.receipt_metadata(reply);
        let mut tx = self.pool.begin().await.map_err(db)?;
        ensure_full(&mut tx).await?;
        // Acquire the writer before reading any authority, including on replay.
        let changed = sqlx::query("UPDATE development_capture_owners SET state=state WHERE run_id=? AND capability_sha256=? AND launch_sha256=? AND claim_owner=? AND claim_fence=? AND state='closed' AND next_stage=4 AND created_at<=? AND ?>0 AND ?<=unixepoch()+5")
            .bind(&owner.binding.run_id).bind(&owner.capability_sha256).bind(&owner.launch_sha256)
            .bind(&owner.owner).bind(owner.fence).bind(observed_at).bind(observed_at).bind(observed_at)
            .execute(&mut *tx).await.map_err(db)?;
        if changed.rows_affected() != 1 {
            return Err("native completion owner incomplete or stale".into());
        }
        let route: Option<String> = sqlx::query_scalar("SELECT l.route_json FROM development_launches l JOIN development_deliveries d ON d.run_id=l.run_id JOIN development_runs r ON r.id=l.run_id JOIN continuous_tasks t ON t.id=r.task_id WHERE l.run_id=? AND l.session_id=? AND l.process_instance=? AND l.state IN ('spawning','exited') AND d.session_id=l.session_id AND d.process_instance=l.process_instance AND d.route_sha256=? AND d.input_sha256=? AND d.input_bytes=? AND r.status IN ('intent','launched','reconciling') AND r.claim_owner=? AND r.claim_fence=? AND t.status='running' AND t.claim_owner=? AND t.claim_fence=?")
            .bind(&owner.binding.run_id).bind(&owner.binding.session_id).bind(&owner.binding.process_instance)
            .bind(&owner.binding.route_sha256).bind(&owner.launch.input_sha256).bind(owner.launch.input_bytes as i64)
            .bind(&owner.owner).bind(owner.fence).bind(&owner.owner).bind(owner.fence)
            .fetch_optional(&mut *tx).await.map_err(db)?;
        let route = route.ok_or("native completion launch binding changed")?;
        if digest(route.as_bytes()) != owner.binding.route_sha256 {
            return Err("native completion route changed".into());
        }
        let receipt: String = sqlx::query_scalar(
            "SELECT evidence_json FROM development_capture_checkpoints WHERE run_id=? AND stage=3",
        )
        .bind(&owner.binding.run_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
        if serde_json::from_str::<Value>(&receipt).map_err(|_| "invalid stored receipt")?
            != metadata
        {
            return Err("native completion differs from acknowledged receipt".into());
        }
        let resolved: Value = serde_json::from_str(&route).map_err(|_| "invalid stored route")?;
        let exit_code = reply.capture.exit_code as i32; // Preserve the Windows DWORD bit pattern.
                                                        // The cost receipt always names its provenance: measured, rejected by
                                                        // the collector, or not reported by an adapter without one.
        let receipt = UsageReceipt::collect(&resolved, &reply.capture.stdout, Some(exit_code));
        let usage = receipt.tokens();
        let mut result = json!({"version":1,"state":"native_cleanup_confirmed","host":host,
            "receipt":metadata,"observedAt":observed_at,
            "usage": receipt.to_json(Some(observed_at))})
        .to_string();
        let previous: Option<String> = sqlx::query_scalar(
            "SELECT result_json FROM development_capture_results WHERE run_id=?",
        )
        .bind(&owner.binding.run_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?;
        if let Some(previous) = previous {
            let same_exit: bool = sqlx::query_scalar(
                "SELECT state='exited' AND exit_code IS ? FROM development_launches WHERE run_id=?",
            )
            .bind(exit_code)
            .bind(&owner.binding.run_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
            // A body committed before usage provenance (W2-03) replays
            // unchanged and is never rewritten. The old body carries no
            // capture digest, so this matches on binding, host, receipt,
            // exit, observedAt and parsed token total only (review K3). The ledger
            // replay below still compares the stored capture digest and
            // fails closed on different bytes.
            let legacy = json!({"version":1,"state":"native_cleanup_confirmed","host":host,
                "receipt":metadata,"observedAt":observed_at,
                "usage": match usage { Some(tokens)=>json!({"state":"measured","tokens":tokens}), None=>json!({"state":"unavailable"}) }}).to_string();
            if previous == legacy {
                result = legacy;
            }
            if previous != result || !same_exit {
                return Err("native completion conflicts with prior result".into());
            }
        } else {
            let changed=sqlx::query("UPDATE development_launches SET state='exited',exit_code=? WHERE run_id=? AND state='spawning'")
                .bind(exit_code).bind(&owner.binding.run_id).execute(&mut *tx).await.map_err(db)?;
            if changed.rows_affected() != 1 {
                return Err("native launch exited outside its capture transaction".into());
            }
            sqlx::query("UPDATE development_runs SET status='reconciling' WHERE id=?")
                .bind(&owner.binding.run_id)
                .execute(&mut *tx)
                .await
                .map_err(db)?;
            sqlx::query("INSERT INTO development_capture_results(run_id,result_json,observed_at) VALUES(?,?,?)")
                .bind(&owner.binding.run_id).bind(&result).bind(observed_at).execute(&mut *tx).await.map_err(db)?;
            sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) SELECT project_id,'development_capture_completed',json_object('version',1,'runId',run_id,'usageAvailable',?,'usageState',?),unixepoch() FROM development_launches WHERE run_id=?")
                .bind(usage.is_some()).bind(receipt.state()).bind(&owner.binding.run_id).execute(&mut *tx).await.map_err(db)?;
        }
        crate::store::development_identity::append_native_unknown(
            &mut tx,
            &owner.binding.run_id,
            &result,
            observed_at,
        )
        .await?;
        if let Some(tokens) = usage {
            let reservation:String=sqlx::query_scalar("SELECT id FROM development_token_reservations WHERE run_id=? AND purpose='implementation' AND state!='cancelled'")
                .bind(&owner.binding.run_id).fetch_one(&mut *tx).await.map_err(db)?;
            let source = receipt
                .ledger_source()
                .ok_or("measured usage without a ledger source")?;
            development_budget::settle_bound(
                &mut tx,
                &reservation,
                tokens,
                &source,
                observed_at,
                Some(RunUsageBinding {
                    run_id: &owner.binding.run_id,
                    session_id: &owner.binding.session_id,
                }),
                Some(CaptureLaunchIdentity {
                    route_json: &route,
                    exit_code: Some(exit_code),
                }),
            )
            .await?;
        }
        tx.commit().await.map_err(db)
    }

    /// Trusted settlement of a provider that demonstrably exited before its
    /// task input was delivered. Records the distinct `exited_undelivered`
    /// launch state; never a capture result, delivery, usage or attestation.
    #[cfg(windows)]
    pub(crate) async fn finalize_native_undelivered_exit(
        &self,
        owner: &CaptureOwner,
        confirmed: &crate::process_capture::windows_process::ConfirmedUndeliveredExit,
    ) -> Result<(), String> {
        if confirmed.launch_sha256() != owner.launch_sha256 {
            return Err("confirmed native invocation differs from capture owner".into());
        }
        let host =
            serde_json::to_value(confirmed.host()).map_err(|_| "invalid host observation")?;
        self.commit_native_undelivered_exit(owner, confirmed.exit(), host, confirmed.observed_at())
            .await
    }

    // Private seam for portable transaction tests, like commit_native_completion.
    async fn commit_native_undelivered_exit(
        &self,
        owner: &CaptureOwner,
        exit: &host_reply::UndeliveredExit,
        host: Value,
        observed_at: i64,
    ) -> Result<(), String> {
        let bytes = serde_json::to_vec(exit).map_err(|_| "invalid undelivered exit")?;
        host_reply::decode_undelivered(&bytes, &owner.binding, &owner.launch)?;
        let mut tx = self.pool.begin().await.map_err(db)?;
        ensure_full(&mut tx).await?;
        // Acquire the writer before reading any authority, including on replay.
        // next_stage=2: launch and process were acknowledged, the input
        // checkpoint never was - delivery was not confirmed by this owner.
        let changed = sqlx::query("UPDATE development_capture_owners SET state=state WHERE run_id=? AND capability_sha256=? AND launch_sha256=? AND claim_owner=? AND claim_fence=? AND state='closed' AND next_stage=2 AND created_at<=? AND ?>0 AND ?<=unixepoch()+5")
            .bind(&owner.binding.run_id).bind(&owner.capability_sha256).bind(&owner.launch_sha256)
            .bind(&owner.owner).bind(owner.fence).bind(observed_at).bind(observed_at).bind(observed_at)
            .execute(&mut *tx).await.map_err(db)?;
        if changed.rows_affected() != 1 {
            return Err("native undelivered exit owner incomplete or stale".into());
        }
        let stages: Vec<(i64, String)> = sqlx::query_as(
            "SELECT stage,evidence_json FROM development_capture_checkpoints WHERE run_id=? ORDER BY stage",
        )
        .bind(&owner.binding.run_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(db)?;
        let [(0, _), (1, process)] = stages.as_slice() else {
            return Err("native undelivered exit checkpoint ledger mismatch".into());
        };
        let process: host_reply::Identity =
            serde_json::from_str(process).map_err(|_| "invalid stored process identity")?;
        if !process.same_process(&exit.identity) {
            return Err("native undelivered exit process changed".into());
        }
        let route: Option<String> = sqlx::query_scalar("SELECT l.route_json FROM development_launches l JOIN development_deliveries d ON d.run_id=l.run_id JOIN development_runs r ON r.id=l.run_id JOIN continuous_tasks t ON t.id=r.task_id WHERE l.run_id=? AND l.session_id=? AND l.process_instance=? AND l.state IN ('spawning','exited_undelivered') AND d.session_id=l.session_id AND d.process_instance=l.process_instance AND d.route_sha256=? AND d.input_sha256=? AND d.input_bytes=? AND r.status IN ('intent','launched','reconciling') AND r.claim_owner=? AND r.claim_fence=? AND t.status='running' AND t.claim_owner=? AND t.claim_fence=?")
            .bind(&owner.binding.run_id).bind(&owner.binding.session_id).bind(&owner.binding.process_instance)
            .bind(&owner.binding.route_sha256).bind(&owner.launch.input_sha256).bind(owner.launch.input_bytes as i64)
            .bind(&owner.owner).bind(owner.fence).bind(&owner.owner).bind(owner.fence)
            .fetch_optional(&mut *tx).await.map_err(db)?;
        let route = route.ok_or("native undelivered exit launch binding changed")?;
        if digest(route.as_bytes()) != owner.binding.route_sha256 {
            return Err("native undelivered exit route changed".into());
        }
        let exit_code = exit.exit_code as i32; // Preserve the Windows DWORD bit pattern.
        let reason = exit.reason.as_str();
        let result = json!({"version":1,"state":"native_exited_before_input_delivery",
            "host":host,"identity":exit.identity,"exitCode":exit.exit_code,"reason":reason,
            "inputDelivered":false,"observedAt":observed_at})
        .to_string();
        let previous: Option<String> = sqlx::query_scalar(
            "SELECT result_json FROM development_capture_results WHERE run_id=?",
        )
        .bind(&owner.binding.run_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?;
        if let Some(previous) = previous {
            let same_exit: bool = sqlx::query_scalar(
                "SELECT state='exited_undelivered' AND exit_code IS ? AND exit_reason IS ? FROM development_launches WHERE run_id=?",
            )
            .bind(exit_code)
            .bind(reason)
            .bind(&owner.binding.run_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
            if previous != result || !same_exit {
                return Err("native undelivered exit conflicts with prior result".into());
            }
        } else {
            let changed = sqlx::query("UPDATE development_launches SET state='exited_undelivered',exit_code=?,exit_reason=?,exited_at=? WHERE run_id=? AND state='spawning'")
                .bind(exit_code).bind(reason).bind(observed_at).bind(&owner.binding.run_id)
                .execute(&mut *tx).await.map_err(db)?;
            if changed.rows_affected() != 1 {
                return Err("native launch exited outside its capture transaction".into());
            }
            sqlx::query("UPDATE development_runs SET status='reconciling',terminal_detail=? WHERE id=?")
                .bind(format!("native provider exited before task input delivery; exit code {exit_code}; input not delivered"))
                .bind(&owner.binding.run_id)
                .execute(&mut *tx)
                .await
                .map_err(db)?;
            sqlx::query("INSERT INTO development_capture_results(run_id,result_json,observed_at) VALUES(?,?,?)")
                .bind(&owner.binding.run_id).bind(&result).bind(observed_at).execute(&mut *tx).await.map_err(db)?;
            sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) SELECT project_id,'development_capture_exited_undelivered',json_object('version',1,'runId',run_id,'exitCode',?,'reason',?),unixepoch() FROM development_launches WHERE run_id=?")
                .bind(exit_code).bind(reason).bind(&owner.binding.run_id).execute(&mut *tx).await.map_err(db)?;
        }
        // DF-15b / KI-27: the proof above (checkpoint ledger, process
        // identity, exit code) also releases the unused reservation and
        // journals the delivery release, atomically with the exit. The
        // release is guarded and idempotent, so the replay branch frees rows
        // committed before the release existed. Without a commit nothing is
        // freed: a crash before it keeps the reservation held (fail-closed).
        crate::store::development_budget::release_undelivered_run_tokens(
            &mut tx,
            &owner.binding.run_id,
        )
        .await?;
        tx.commit().await.map_err(db)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    // Synthetic parts prove transaction semantics, never native provenance.
    async fn fixture(
        transport: &str,
        stdout: &[u8],
        exit: u32,
    ) -> (TempDir, Store, CaptureOwner, host_reply::Reply, i64) {
        let (dir, store, mut binding, launch) = super::super::tests::ready().await;
        let route = json!({"selection":{"resolved":{"provider":"codex","profileId":"codex"}},
            "preparedInvocation":{"transport":transport},
            "observedIdentity":{"status":"observed","model":"route-claimed-model"}})
        .to_string();
        binding.route_sha256 = digest(route.as_bytes());
        sqlx::query("UPDATE development_launches SET route_json=?")
            .bind(route)
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("UPDATE development_deliveries SET route_sha256=?")
            .bind(&binding.route_sha256)
            .execute(&store.pool)
            .await
            .unwrap();
        let owner = store
            .reserve_native_capture_owner(binding, launch, "owner", 1)
            .await
            .unwrap();
        let value = json!({"schemaVersion":1,"state":"native_protocol_capture_completed","binding":owner.binding,
            "inputBytes":4,"inputSha256":owner.launch.input_sha256,"capture":{"identity":{
            "schemaVersion":1,"processId":42,"createdFiletime":"123456","volumeSerial":0,"fileIndex":"456",
            "imageSize":100,"imageSha256":"a".repeat(64),"state":"native_image_verified_execution_exited_and_pipes_drained"},
            "exitCode":exit,"stdout":stdout,"stderr":[]}});
        let reply = host_reply::decode(
            &serde_json::to_vec(&value).unwrap(),
            &owner.binding,
            &owner.launch,
        )
        .unwrap();
        sqlx::query("UPDATE development_capture_owners SET next_stage=4,state='closed'")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO development_capture_checkpoints(run_id,stage,evidence_json,observed_at) VALUES(?,3,?,unixepoch())")
            .bind(&owner.binding.run_id).bind(owner.receipt_metadata(&reply).to_string()).execute(&store.pool).await.unwrap();
        let now = sqlx::query_scalar("SELECT unixepoch()")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        (dir, store, owner, reply, now)
    }
    const USAGE:&[u8]=b"{\"type\":\"thread.started\",\"thread_id\":\"t\"}\n{\"type\":\"turn.started\"}\n{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":10,\"output_tokens\":5}}\n";
    async fn session_fixture(store: &Store, owner: &CaptureOwner) -> String {
        let worker: String =
            sqlx::query_scalar("SELECT worker_id FROM development_launches WHERE run_id=?")
                .bind(&owner.binding.run_id)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        sqlx::query("INSERT INTO workers(id,project_id,task,profile_id,branch,worktree_path,status,kind,created_at) SELECT worker_id,project_id,'native fixture','codex','fixture','fixture','running','worker',unixepoch() FROM development_launches WHERE run_id=?")
            .bind(&owner.binding.run_id).execute(&store.pool).await.unwrap();
        store
            .bind_session_in_memory(&worker, &owner.binding.session_id)
            .unwrap();
        store
            .record_session_start(&worker, &owner.binding.session_id)
            .await;
        worker
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_session_failure_rolls_back_both_rows_and_preserves_binding_for_retry() {
        let (_dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
        let worker = session_fixture(&store, &owner).await;
        assert!(store.finish_native_session(&owner).await.is_err()); // provisional is insufficient
        commit(&store, &owner, &reply, now).await.unwrap();
        sqlx::query("CREATE TRIGGER reject_native_session BEFORE UPDATE OF status ON workers BEGIN SELECT RAISE(ABORT,'injected worker completion failure'); END")
            .execute(&store.pool).await.unwrap();
        assert!(store
            .finish_native_session(&owner)
            .await
            .unwrap_err()
            .contains("injected worker"));
        let ended: Option<i64> = sqlx::query_scalar("SELECT ended_at FROM sessions WHERE id=?")
            .bind(&owner.binding.session_id)
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(ended, None);
        assert_eq!(
            store.session_for_worker(&worker).as_deref(),
            Some(owner.binding.session_id.as_str())
        );
        sqlx::query("DROP TRIGGER reject_native_session")
            .execute(&store.pool)
            .await
            .unwrap();
        store.finish_native_session(&owner).await.unwrap();
        store.finish_native_session(&owner).await.unwrap();
        assert!(store.session_for_worker(&worker).is_none());
        let (ended, exit, status): (Option<i64>, Option<i64>, String) = sqlx::query_as("SELECT s.ended_at,s.exit_code,w.status FROM sessions s JOIN workers w ON w.id=s.worker_id WHERE s.id=?")
            .bind(&owner.binding.session_id).fetch_one(&store.pool).await.unwrap();
        assert!(ended.is_some());
        assert_eq!(exit, Some(0));
        assert_eq!(status, crate::store::STATUS_EXITED);
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM continuous_events WHERE kind='development_session_closed'",
        )
        .fetch_one(&store.pool)
        .await
        .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_session_cannot_be_rebound_between_validation_and_commit() {
        let (_dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
        let worker = session_fixture(&store, &owner).await;
        commit(&store, &owner, &reply, now).await.unwrap();
        store
            .finish_native_session_observed(&owner, || {
                assert!(store
                    .bind_session_in_memory(&worker, "replacement-session")
                    .is_err());
                assert!(store
                    .bind_session_in_memory("another-worker", &owner.binding.session_id)
                    .is_err());
                assert_eq!(
                    store.session_for_worker(&worker).as_deref(),
                    Some(owner.binding.session_id.as_str()),
                    "replacement entered during native commit"
                );
            })
            .await
            .unwrap();
        assert!(store.session_for_worker(&worker).is_none());
        store
            .bind_session_in_memory(&worker, "replacement-session")
            .unwrap();
        assert_eq!(
            store.session_for_worker(&worker).as_deref(),
            Some("replacement-session")
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_session_rejects_stale_missing_rebound_or_conflicting_completion() {
        for case in 0..6 {
            let (_dir, store, owner, reply, now) =
                fixture("native_codex_exec_json", USAGE, 0).await;
            let worker = session_fixture(&store, &owner).await;
            commit(&store, &owner, &reply, now).await.unwrap();
            match case {
                0 => {
                    sqlx::query("UPDATE continuous_tasks SET claim_fence=claim_fence+1")
                        .execute(&store.pool)
                        .await
                        .unwrap();
                }
                1 => {
                    sqlx::query("DELETE FROM sessions")
                        .execute(&store.pool)
                        .await
                        .unwrap();
                }
                2 => {
                    store
                        .bind_session_in_memory(&worker, "replacement-session")
                        .unwrap();
                }
                3 => {
                    sqlx::query("UPDATE sessions SET ended_at=1,exit_code=99")
                        .execute(&store.pool)
                        .await
                        .unwrap();
                }
                4 => {
                    sqlx::query("DELETE FROM development_capture_results")
                        .execute(&store.pool)
                        .await
                        .unwrap();
                }
                _ => {
                    store
                        .bind_session_in_memory("another-worker", &owner.binding.session_id)
                        .unwrap();
                }
            }
            assert!(
                store.finish_native_session(&owner).await.is_err(),
                "case {case}"
            );
            if case == 5 {
                assert_eq!(
                    store
                        .worker_for_session(&owner.binding.session_id)
                        .as_deref(),
                    Some("another-worker")
                );
            } else {
                assert!(store.session_for_worker(&worker).is_some());
            }
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_session_preserves_archival_and_nonzero_exit() {
        let (_dir, store, owner, reply, now) =
            fixture("native_codex_exec_json", b"failed", u32::MAX).await;
        let worker = session_fixture(&store, &owner).await;
        commit(&store, &owner, &reply, now).await.unwrap();
        sqlx::query("UPDATE workers SET status='archived'")
            .execute(&store.pool)
            .await
            .unwrap();
        store.finish_native_session(&owner).await.unwrap();
        let (status, exit):(String,i64)=sqlx::query_as("SELECT w.status,s.exit_code FROM workers w JOIN sessions s ON s.worker_id=w.id WHERE w.id=?")
            .bind(worker).fetch_one(&store.pool).await.unwrap();
        assert_eq!(status, "archived");
        assert_eq!(exit, -1);
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_completion_writers_wait_for_a_foreign_writer() {
        use crate::store::write_lock_tests::waits;
        let (dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
        session_fixture(&store, &owner).await;
        waits(
            "a native completion",
            &dir,
            commit(&store, &owner, &reply, now),
        )
        .await
        .unwrap();
        waits(
            "a native session finish",
            &dir,
            store.finish_native_session(&owner),
        )
        .await
        .unwrap();
    }
    async fn commit(
        store: &Store,
        owner: &CaptureOwner,
        reply: &host_reply::Reply,
        now: i64,
    ) -> Result<(), String> {
        store
            .commit_native_completion(owner, reply, json!({"fixture":true}), now)
            .await
    }
    async fn state(store: &Store) -> (String, String, i64) {
        sqlx::query_as("SELECT l.state,b.state,(SELECT count(*) FROM development_capture_results) FROM development_launches l JOIN development_token_reservations b ON b.run_id=l.run_id")
            .fetch_one(&store.pool).await.unwrap()
    }
    async fn identity_for_run(store: &Store, run_id: &str) -> Value {
        let mut tx = store.pool.begin().await.unwrap();
        crate::store::development_identity::for_run(&mut tx, run_id)
            .await
            .unwrap()
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_completion_records_unknown_provenance_and_persists_on_reopen() {
        let (dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
        let run_id = &owner.binding.run_id;
        let before = identity_for_run(&store, run_id).await;
        commit(&store, &owner, &reply, now).await.unwrap();
        let identity = identity_for_run(&store, run_id).await;
        assert_eq!(identity["state"], "recorded");
        assert_eq!(identity["history"].as_array().unwrap().len(), 2);
        assert_eq!(identity["history"][1]["observation"]["status"], "unknown");
        assert_eq!(
            identity["history"][1]["observation"]["source"],
            "projecta-native-capture-v1"
        );
        assert_eq!(
            identity["history"][1]["observation"]["evidenceId"],
            format!("native-capture-result-v1:{run_id}")
        );
        assert_eq!(identity["history"][1]["observation"]["observedAt"], now);
        assert!(identity["history"][1]["observation"]["identity"]["model"].is_null());
        assert!(identity["identity"]["adapter"].is_null());
        assert_eq!(
            identity["identity"]["requested"],
            before["identity"]["requested"]
        );
        assert_eq!(
            identity["identity"]["configured"],
            before["identity"]["configured"]
        );
        assert_eq!(identity["assessment"], "unknown");
        store.pool.close().await;
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        assert_eq!(identity_for_run(&reopened, run_id).await, identity);
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_completion_replay_upgrades_valid_old_capture_once() {
        let (_dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
        let run_id = &owner.binding.run_id;
        commit(&store, &owner, &reply, now).await.unwrap();
        // Simulate a DF08b database: its header and capture exist, but the
        // native observation writer did not exist when completion ran.
        sqlx::query("DROP TRIGGER development_identity_observation_no_delete")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM development_identity_observations WHERE sequence=2")
            .execute(&store.pool)
            .await
            .unwrap();
        assert_eq!(
            identity_for_run(&store, run_id).await["history"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        commit(&store, &owner, &reply, now).await.unwrap();
        let first = identity_for_run(&store, run_id).await;
        assert_eq!(first["history"].as_array().unwrap().len(), 2);
        assert_eq!(first["history"][1]["observation"]["observedAt"], now);
        commit(&store, &owner, &reply, now).await.unwrap();
        assert_eq!(identity_for_run(&store, run_id).await, first);
        assert!(commit(&store, &owner, &reply, now + 1).await.is_err());
        assert_eq!(identity_for_run(&store, run_id).await, first);
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_completion_without_identity_header_keeps_legacy_unavailable() {
        let (_dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
        for statement in [
            "DROP TRIGGER development_identity_observation_no_delete",
            "DROP TRIGGER development_identity_no_delete",
            "DELETE FROM development_identity_observations",
            "DELETE FROM development_execution_identities",
        ] {
            sqlx::query(statement).execute(&store.pool).await.unwrap();
        }
        commit(&store, &owner, &reply, now).await.unwrap();
        commit(&store, &owner, &reply, now).await.unwrap();
        assert_eq!(
            identity_for_run(&store, &owner.binding.run_id).await["state"],
            "unavailable"
        );
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_identity_insert_failure_rolls_back_capture_exit_and_tokens() {
        let (_dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
        sqlx::query("CREATE TRIGGER reject_native_identity BEFORE INSERT ON development_identity_observations WHEN NEW.idempotency_key LIKE 'native-capture:%' BEGIN SELECT RAISE(ABORT,'injected native identity failure'); END")
            .execute(&store.pool).await.unwrap();
        assert!(commit(&store, &owner, &reply, now)
            .await
            .unwrap_err()
            .contains("injected native identity failure"));
        assert_eq!(
            state(&store).await,
            ("spawning".into(), "started".into(), 0)
        );
        let identity = identity_for_run(&store, &owner.binding.run_id).await;
        assert_eq!(identity["history"].as_array().unwrap().len(), 1);
        sqlx::query("DROP TRIGGER reject_native_identity")
            .execute(&store.pool)
            .await
            .unwrap();
        commit(&store, &owner, &reply, now).await.unwrap();
        assert_eq!(
            identity_for_run(&store, &owner.binding.run_id).await["history"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_completion_rejects_conflicting_existing_observation() {
        let (_dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
        let run_id = &owner.binding.run_id;
        let identity_id: String =
            sqlx::query_scalar("SELECT id FROM development_execution_identities WHERE run_id=?")
                .bind(run_id)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        let conflicting = json!({"identity":{"provider":null,"model":"agent-claim","family":null},
            "status":"observed","source":"agent","evidenceId":format!("native-capture-result-v1:{run_id}"),
            "observedAt":now,"expiresAt":null,"registry":null});
        sqlx::query("INSERT INTO development_identity_observations(id, identity_id, sequence, idempotency_key, observation_json, recorded_at) VALUES('conflict', ?, 2, ?, ?, ?)")
            .bind(&identity_id).bind(format!("native-capture:{run_id}"))
            .bind(conflicting.to_string()).bind(now).execute(&store.pool).await.unwrap();
        assert!(commit(&store, &owner, &reply, now)
            .await
            .unwrap_err()
            .contains("conflicts with prior evidence"));
        assert_eq!(
            state(&store).await,
            ("spawning".into(), "started".into(), 0)
        );
        assert_eq!(
            identity_for_run(&store, run_id).await["history"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_completion_rejects_foreign_key_with_duplicate_evidence_or_source() {
        for case in 0..2 {
            let (_dir, store, owner, reply, now) =
                fixture("native_codex_exec_json", USAGE, 0).await;
            let run_id = &owner.binding.run_id;
            let identity_id: String = sqlx::query_scalar(
                "SELECT id FROM development_execution_identities WHERE run_id=?",
            )
            .bind(run_id)
            .fetch_one(&store.pool)
            .await
            .unwrap();
            let evidence = format!("native-capture-result-v1:{run_id}");
            let conflicting = json!({
                "identity":{"provider":null,"model":null,"family":null},
                "status":"unknown",
                "source":if case == 0 {"foreign-producer"} else {"projecta-native-capture-v1"},
                "evidenceId":if case == 0 {evidence.as_str()} else {"foreign-evidence"},
                "observedAt":now,"expiresAt":null,"registry":null
            });
            sqlx::query("INSERT INTO development_identity_observations(id, identity_id, sequence, idempotency_key, observation_json, recorded_at) VALUES(?, ?, 2, ?, ?, ?)")
                .bind(format!("foreign-observation-{case}"))
                .bind(&identity_id)
                .bind(format!("foreign-key:{run_id}"))
                .bind(conflicting.to_string())
                .bind(now)
                .execute(&store.pool).await.unwrap();
            assert!(
                commit(&store, &owner, &reply, now)
                    .await
                    .unwrap_err()
                    .contains("native identity evidence already bound"),
                "case {case}"
            );
            assert_eq!(
                state(&store).await,
                ("spawning".into(), "started".into(), 0)
            );
            let (exit_code, actual_tokens): (Option<i64>, Option<i64>) = sqlx::query_as(
                "SELECT l.exit_code, b.actual_tokens FROM development_launches l JOIN development_token_reservations b ON b.run_id=l.run_id WHERE l.run_id=?",
            )
            .bind(run_id)
            .fetch_one(&store.pool)
            .await
            .unwrap();
            assert_eq!((exit_code, actual_tokens), (None, None));
            assert_eq!(
                identity_for_run(&store, run_id).await["history"]
                    .as_array()
                    .unwrap()
                    .len(),
                2
            );
        }
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_stdout_and_route_model_claims_cannot_become_observed_identity() {
        let claim = br#"{"model":"claimed-model","family":"claimed-family","executionIdentity":{"status":"observed"}}"#;
        let (_dir, store, owner, reply, now) = fixture("interactive_pty", claim, 0).await;
        commit(&store, &owner, &reply, now).await.unwrap();
        let identity = identity_for_run(&store, &owner.binding.run_id).await;
        assert_eq!(identity["history"][1]["observation"]["status"], "unknown");
        assert!(identity["history"][1]["observation"]["identity"]["model"].is_null());
        assert!(identity["history"][1]["observation"]["identity"]["family"].is_null());
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_completion_ignores_cancelled_reservation_history() {
        let (_dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
        sqlx::query("UPDATE development_token_reservations SET state='cancelled'")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO development_token_reservations(id,root_goal_id,goal_id,idempotency_key,purpose,run_id,reserved_tokens,state,created_at,started_at) SELECT 'replacement',root_goal_id,goal_id,'replacement',purpose,run_id,reserved_tokens,'started',created_at,started_at FROM development_token_reservations").execute(&store.pool).await.unwrap();
        commit(&store, &owner, &reply, now).await.unwrap();
        commit(&store, &owner, &reply, now).await.unwrap();
        let actual: i64 = sqlx::query_scalar(
            "SELECT actual_tokens FROM development_token_reservations WHERE id='replacement'",
        )
        .fetch_one(&store.pool)
        .await
        .unwrap();
        assert_eq!(actual, 15);
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_completion_settles_once_and_preserves_reconciliation() {
        let (_dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
        commit(&store, &owner, &reply, now).await.unwrap();
        commit(&store, &owner, &reply, now).await.unwrap();
        assert_eq!(state(&store).await, ("exited".into(), "settled".into(), 1));
        let measured: i64 =
            sqlx::query_scalar("SELECT actual_tokens FROM development_token_reservations")
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(measured, 15);
        let result: String =
            sqlx::query_scalar("SELECT result_json FROM development_capture_results")
                .fetch_one(&store.pool)
                .await
                .unwrap();
        let usage = &serde_json::from_str::<Value>(&result).unwrap()["usage"];
        assert_eq!(usage["state"], "measured");
        assert_eq!(usage["tokens"], 15);
        assert_eq!(usage["provenance"]["collector"], "codex-exec-json-v1");
        assert_eq!(usage["provenance"]["measurement"], "live");
        assert_eq!(usage["provenance"]["sourceSha256"], digest(USAGE));
        let source: String =
            sqlx::query_scalar("SELECT source FROM development_token_reservations")
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(
            source,
            format!("codex-exec-json-v1:sha256:{}", digest(USAGE))
        );
        let run: String = sqlx::query_scalar("SELECT status FROM development_runs")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(run, "reconciling");
        assert!(commit(&store, &owner, &reply, now + 1).await.is_err());
        sqlx::query("UPDATE continuous_tasks SET claim_fence=claim_fence+1")
            .execute(&store.pool)
            .await
            .unwrap();
        assert!(commit(&store, &owner, &reply, now).await.is_err());
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn pre_provenance_capture_results_replay_unchanged() {
        for (stdout, legacy_usage) in [
            (USAGE, json!({"state":"measured","tokens":15})),
            (b"partial".as_slice(), json!({"state":"unavailable"})),
        ] {
            let (_dir, store, owner, reply, now) =
                fixture("native_codex_exec_json", stdout, 0).await;
            commit(&store, &owner, &reply, now).await.unwrap();
            // Rewrite the stored body into the exact pre-W2-03 serialization.
            let stored: String =
                sqlx::query_scalar("SELECT result_json FROM development_capture_results")
                    .fetch_one(&store.pool)
                    .await
                    .unwrap();
            let mut legacy: Value = serde_json::from_str(&stored).unwrap();
            legacy["usage"] = legacy_usage.clone();
            let legacy = legacy.to_string();
            sqlx::query("UPDATE development_capture_results SET result_json=?")
                .bind(&legacy)
                .execute(&store.pool)
                .await
                .unwrap();
            sqlx::query("DROP TRIGGER development_identity_observation_no_delete")
                .execute(&store.pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM development_identity_observations WHERE sequence=2")
                .execute(&store.pool)
                .await
                .unwrap();
            commit(&store, &owner, &reply, now).await.unwrap();
            let after: String =
                sqlx::query_scalar("SELECT result_json FROM development_capture_results")
                    .fetch_one(&store.pool)
                    .await
                    .unwrap();
            assert_eq!(after, legacy, "a legacy body is never rewritten");
            // Any other legacy usage for this capture is still a conflict.
            let mut forged: Value = serde_json::from_str(&legacy).unwrap();
            forged["usage"] = json!({"state":"measured","tokens":16});
            sqlx::query("UPDATE development_capture_results SET result_json=?")
                .bind(forged.to_string())
                .execute(&store.pool)
                .await
                .unwrap();
            assert!(commit(&store, &owner, &reply, now)
                .await
                .unwrap_err()
                .contains("conflicts with prior result"));
        }
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_completion_unknown_usage_retains_reserved_capacity() {
        for (transport, stdout, exit, receipt, reason) in [
            (
                "interactive_pty",
                USAGE,
                0,
                "not_reported",
                "not reported by adapter: Codex reports usage only through native `codex exec --json`; this run used interactive_pty",
            ),
            (
                "native_codex_exec_json",
                USAGE,
                1,
                "rejected",
                "process exit code is not zero",
            ),
            (
                "native_codex_exec_json",
                b"partial".as_slice(),
                0,
                "rejected",
                "capture is truncated before a final newline",
            ),
        ] {
            let (_dir, store, owner, reply, now) = fixture(transport, stdout, exit).await;
            commit(&store, &owner, &reply, now).await.unwrap();
            assert_eq!(state(&store).await, ("exited".into(), "started".into(), 1));
            let result: String =
                sqlx::query_scalar("SELECT result_json FROM development_capture_results")
                    .fetch_one(&store.pool)
                    .await
                    .unwrap();
            let usage = &serde_json::from_str::<Value>(&result).unwrap()["usage"];
            // The cost receipt names why nothing settled; never a bare gap.
            assert_eq!(usage["state"], receipt);
            assert_eq!(usage["reason"], reason);
            assert_eq!(usage["reservation"], "retained");
            assert_eq!(usage["provenance"]["observedAt"], now);
            assert!(!usage.to_string().contains("unavailable"), "{usage}");
            let event: String = sqlx::query_scalar("SELECT detail FROM continuous_events WHERE kind='development_capture_completed'")
                .fetch_one(&store.pool).await.unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(&event).unwrap()["usageState"],
                receipt
            );
        }
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_completion_settlement_failure_rolls_back_exit_and_result() {
        let (_dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
        sqlx::query("CREATE TRIGGER fail_settlement BEFORE UPDATE OF actual_tokens ON development_token_reservations BEGIN SELECT RAISE(ABORT,'injected settlement failure'); END").execute(&store.pool).await.unwrap();
        assert!(commit(&store, &owner, &reply, now)
            .await
            .unwrap_err()
            .contains("injected settlement failure"));
        assert_eq!(
            state(&store).await,
            ("spawning".into(), "started".into(), 0)
        );
        assert_eq!(
            identity_for_run(&store, &owner.binding.run_id).await["history"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_completion_rechecks_every_binding_after_writer_wait() {
        for mutation in [
            "UPDATE development_launches SET session_id='other'",
            "UPDATE development_launches SET process_instance='other'",
            "UPDATE development_launches SET route_json='{}'",
            "UPDATE continuous_tasks SET claim_fence=2",
            "UPDATE development_capture_checkpoints SET evidence_json='{}'",
            "UPDATE development_capture_owners SET state='open'",
        ] {
            let (_dir, store, owner, reply, now) =
                fixture("native_codex_exec_json", USAGE, 0).await;
            let mut blocker = store.pool.begin().await.unwrap();
            sqlx::query("UPDATE development_capture_owners SET state=state")
                .execute(&mut *blocker)
                .await
                .unwrap();
            let finish = commit(&store, &owner, &reply, now);
            let race = async {
                tokio::time::sleep(std::time::Duration::from_millis(40)).await;
                sqlx::query(mutation).execute(&mut *blocker).await.unwrap();
                blocker.commit().await.unwrap();
            };
            let (result, ()) = tokio::join!(finish, race);
            assert!(result.is_err(), "{mutation}");
            assert_eq!(
                state(&store).await,
                ("spawning".into(), "started".into(), 0)
            );
            assert_eq!(
                identity_for_run(&store, &owner.binding.run_id).await["history"]
                    .as_array()
                    .unwrap()
                    .len(),
                1
            );
        }
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn populated_schema18_upgrade_never_invents_final_native_proof() {
        let (dir, store, owner, _reply, _now) = fixture("native_codex_exec_json", USAGE, 0).await;
        sqlx::query("DROP TABLE development_identity_observations")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("DROP TABLE development_execution_identities")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("DROP TABLE development_plan_revisions")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("DROP TABLE development_plans")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("DROP TABLE development_capture_results")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("PRAGMA user_version=18")
            .execute(&store.pool)
            .await
            .unwrap();
        store.pool.close().await;
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        assert_eq!(
            state(&reopened).await,
            ("spawning".into(), "started".into(), 0)
        );
        let saved: String =
            sqlx::query_scalar("SELECT state FROM development_capture_owners WHERE run_id=?")
                .bind(&owner.binding.run_id)
                .fetch_one(&reopened.pool)
                .await
                .unwrap();
        assert_eq!(saved, "closed");
    }

    // DF-15: the undelivered terminal path, driven through the real ledger.
    use crate::process_capture::checkpoints::Stage;
    async fn undelivered_fixture(
        acknowledged: &[Stage],
    ) -> (
        TempDir,
        Store,
        CaptureOwner,
        host_reply::UndeliveredExit,
        i64,
    ) {
        use super::super::tests::{accept, identity, launch_payload, ready};
        let (dir, store, binding, launch) = ready().await;
        let owner = store
            .reserve_native_capture_owner(binding, launch, "owner", 1)
            .await
            .unwrap();
        for stage in acknowledged {
            let payload = match stage {
                Stage::Launch => launch_payload(&owner),
                Stage::Process => identity("native_image_verified_suspended_before_execution"),
                Stage::Input => json!({"inputBytes":4,"inputSha256":owner.launch.input_sha256}),
                Stage::Receipt => unreachable!("an undelivered exit has no receipt"),
            };
            accept(&store, &owner, *stage, payload).await;
        }
        store.close_native_capture_owner(&owner).await.unwrap();
        let value = json!({"schemaVersion":1,"state":host_reply::UNDELIVERED_EXIT_STATE,
            "binding":owner.binding,"inputBytes":4,"inputSha256":owner.launch.input_sha256,
            "identity":identity(host_reply::UNDELIVERED_IDENTITY_STATE),"exitCode":2,
            "reason":"provider_exited_before_input_delivery"});
        let exit = host_reply::decode_undelivered(
            &serde_json::to_vec(&value).unwrap(),
            &owner.binding,
            &owner.launch,
        )
        .unwrap();
        let now = sqlx::query_scalar("SELECT unixepoch()")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        (dir, store, owner, exit, now)
    }
    async fn undeliver(
        store: &Store,
        owner: &CaptureOwner,
        exit: &host_reply::UndeliveredExit,
        now: i64,
    ) -> Result<(), String> {
        store
            .commit_native_undelivered_exit(owner, exit, json!({"fixture":true}), now)
            .await
    }
    fn exit_with(
        exit: &host_reply::UndeliveredExit,
        pointer: &str,
        value: Value,
    ) -> host_reply::UndeliveredExit {
        let mut changed = serde_json::to_value(exit).unwrap();
        *changed.pointer_mut(pointer).unwrap() = value;
        serde_json::from_value(changed).unwrap()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn undelivered_exit_is_a_distinct_idempotent_terminal_state_never_read_as_delivered() {
        let (_dir, store, owner, exit, now) =
            undelivered_fixture(&[Stage::Launch, Stage::Process]).await;
        let worker = session_fixture(&store, &owner).await;
        let run = owner.binding.run_id.clone();
        assert!(store.finish_native_session(&owner).await.is_err());
        undeliver(&store, &owner, &exit, now).await.unwrap();
        undeliver(&store, &owner, &exit, now).await.unwrap(); // crash-safe replay
        let other = exit_with(&exit, "/exitCode", json!(3));
        assert!(undeliver(&store, &owner, &other, now)
            .await
            .unwrap_err()
            .contains("conflicts"));
        let launch = store.development_launch(&run).await.unwrap().unwrap();
        assert_eq!(launch.state, "exited_undelivered");
        assert_eq!(launch.exit_code, Some(2));
        assert_eq!(launch.exited_at, Some(now));
        assert_eq!(
            launch.exit_reason.as_deref(),
            Some("provider_exited_before_input_delivery")
        );
        let detail = store.get_development_run(&run).await.unwrap().unwrap();
        assert_eq!(detail.status, "reconciling");
        assert!(detail
            .terminal_detail
            .is_some_and(|text| text.contains("exit code 2; input not delivered")));
        let result: String = sqlx::query_scalar(
            "SELECT result_json FROM development_capture_results WHERE run_id=?",
        )
        .bind(&run)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        let result: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(result["state"], "native_exited_before_input_delivery");
        assert_eq!(result["inputDelivered"], false);
        assert!(result.get("receipt").is_none() && result.get("usage").is_none());
        let (undelivered, completed, exited, delivery): (i64, i64, i64, String) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM continuous_events WHERE kind='development_capture_exited_undelivered'),(SELECT count(*) FROM continuous_events WHERE kind='development_capture_completed'),(SELECT count(*) FROM development_launches WHERE state='exited'),(SELECT state FROM development_deliveries WHERE run_id=?)")
            .bind(&run).fetch_one(&store.pool).await.unwrap();
        assert_eq!((undelivered, completed, exited), (1, 0, 0));
        assert_eq!(
            delivery, "started",
            "input must never be recorded delivered"
        );
        // Readers of `exited` stay fail-closed: no usage settlement, and no
        // later delivery receipt can turn this launch into a completed one.
        let reservation: String =
            sqlx::query_scalar("SELECT id FROM development_token_reservations WHERE run_id=?")
                .bind(&run)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert!(store
            .settle_codex_run_capture(
                &reservation,
                RunUsageBinding {
                    run_id: &run,
                    session_id: &owner.binding.session_id,
                },
                USAGE,
                Some(2),
                now,
            )
            .await
            .is_err());
        let receipt = json!({"schemaVersion":1,"state":"native_protocol_capture_completed","binding":owner.binding,
            "inputBytes":4,"inputSha256":owner.launch.input_sha256,"capture":{"identity":super::super::tests::identity(
            "native_image_verified_execution_exited_and_pipes_drained"),"exitCode":2,"stdout":[],"stderr":[]}});
        let receipt = host_reply::decode(
            &serde_json::to_vec(&receipt).unwrap(),
            &owner.binding,
            &owner.launch,
        )
        .unwrap();
        // Even a forged complete ledger cannot promote the launch to delivered.
        sqlx::query("UPDATE development_capture_owners SET next_stage=4")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO development_capture_checkpoints(run_id,stage,evidence_json,observed_at) VALUES(?,3,?,unixepoch())")
            .bind(&run).bind(owner.receipt_metadata(&receipt).to_string()).execute(&store.pool).await.unwrap();
        assert!(commit(&store, &owner, &receipt, now).await.is_err());
        sqlx::query("UPDATE development_capture_owners SET next_stage=2")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM development_capture_checkpoints WHERE stage=3")
            .execute(&store.pool)
            .await
            .unwrap();
        let launch = store.development_launch(&run).await.unwrap().unwrap();
        assert_eq!(
            (launch.state.as_str(), launch.exit_code),
            ("exited_undelivered", Some(2))
        );
        // Same session/worker closure as a delivered capture, exactly once.
        store.finish_native_session(&owner).await.unwrap();
        store.finish_native_session(&owner).await.unwrap();
        assert!(store.session_for_worker(&worker).is_none());
        let (ended, code, status): (Option<i64>, Option<i64>, String) = sqlx::query_as("SELECT s.ended_at,s.exit_code,w.status FROM sessions s JOIN workers w ON w.id=s.worker_id WHERE s.id=?")
            .bind(&owner.binding.session_id).fetch_one(&store.pool).await.unwrap();
        assert!(ended.is_some());
        assert_eq!(code, Some(2));
        assert_eq!(status, crate::store::STATUS_EXITED);
    }

    // DF-15b / KI-27: the proven undelivered exit releases the run's token
    // reservation (unused: the input never reached the provider) and journals
    // the delivery release - atomically, in the same transaction as the exit.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn undelivered_exit_releases_its_reservation_and_delivery_exactly_once() {
        let (_dir, store, owner, exit, now) =
            undelivered_fixture(&[Stage::Launch, Stage::Process]).await;
        let run = owner.binding.run_id.clone();
        let reservation: String =
            sqlx::query_scalar("SELECT id FROM development_token_reservations WHERE run_id=?")
                .bind(&run)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        let before = {
            let mut tx = store.pool.begin().await.unwrap();
            let balance = crate::store::development_budget::balance(&mut tx, "goal")
                .await
                .unwrap();
            tx.commit().await.unwrap();
            balance
        };
        assert_eq!(before.reserved_tokens, 1000);
        assert_eq!(before.unresolved_operations, 1);
        undeliver(&store, &owner, &exit, now).await.unwrap();
        undeliver(&store, &owner, &exit, now).await.unwrap(); // crash-safe replay
        let (state, settled_at): (String, Option<i64>) = sqlx::query_as(
            "SELECT state,settled_at FROM development_token_reservations WHERE id=?",
        )
        .bind(&reservation)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        assert_eq!(
            state, "cancelled",
            "the unused reservation is released after the proven exit"
        );
        assert!(settled_at.is_some());
        let events: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM continuous_events WHERE kind='development_delivery_released'",
        )
        .fetch_one(&store.pool)
        .await
        .unwrap();
        assert_eq!(events, 1, "the delivery release is journaled exactly once");
        // The raw delivery row stays truthful: the intent began and the
        // transport never confirmed an enqueue; the release lives in the
        // journal and the terminal launch state, not in rewritten history.
        let delivery: String =
            sqlx::query_scalar("SELECT state FROM development_deliveries WHERE run_id=?")
                .bind(&run)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(delivery, "started");
        // A row committed before the release existed (DF-15a era: exit
        // committed, reservation still held) is freed on the next validated
        // replay - again exactly once.
        sqlx::query(
            "UPDATE development_token_reservations SET state='started',settled_at=NULL WHERE id=?",
        )
        .bind(&reservation)
        .execute(&store.pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM continuous_events WHERE kind='development_delivery_released'")
            .execute(&store.pool)
            .await
            .unwrap();
        undeliver(&store, &owner, &exit, now).await.unwrap();
        undeliver(&store, &owner, &exit, now).await.unwrap();
        let (state, events): (String, i64) = sqlx::query_as(
            "SELECT (SELECT state FROM development_token_reservations WHERE id=?),(SELECT count(*) FROM continuous_events WHERE kind='development_delivery_released')",
        )
        .bind(&reservation)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        assert_eq!(state, "cancelled", "the replay frees the legacy row");
        assert_eq!(events, 1, "the legacy release is journaled exactly once");
        let after = {
            let mut tx = store.pool.begin().await.unwrap();
            let balance = crate::store::development_budget::balance(&mut tx, "goal")
                .await
                .unwrap();
            tx.commit().await.unwrap();
            balance
        };
        assert_eq!(
            after.reserved_tokens, 0,
            "the released budget is free again"
        );
        assert_eq!(after.unresolved_operations, 0);
        assert_eq!(after.available_tokens, before.available_tokens + 1000);
        // The cost receipt names the release instead of the generic
        // "cancelled before work started", and the briefing carries the
        // derived delivery release.
        let launch = store.development_launch(&run).await.unwrap().unwrap();
        let receipt = {
            let mut tx = store.pool.begin().await.unwrap();
            let receipt = crate::store::development_budget::usage_receipt::for_run(
                &mut tx,
                &run,
                Some(&launch),
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
            receipt
        };
        assert_eq!(receipt["state"], "cancelled");
        assert!(receipt["reason"]
            .as_str()
            .unwrap()
            .contains("before its input was delivered"));
        let context = store.agent_run_context(&run, "owner", 1).await.unwrap();
        assert_eq!(context["delivery"]["state"], "started");
        assert_eq!(
            context["delivery"]["effectiveState"],
            "released_undelivered"
        );
    }

    // Review PR #16 (grok G1, sonnet R2): a DF-15a-era row (exit committed,
    // reservation still held) is neither reported as released nor left held
    // forever: startup reconciliation frees it with the same guard.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_legacy_undelivered_row_is_not_reported_released_and_startup_frees_it() {
        let (_dir, store, owner, exit, now) =
            undelivered_fixture(&[Stage::Launch, Stage::Process]).await;
        let run = owner.binding.run_id.clone();
        undeliver(&store, &owner, &exit, now).await.unwrap();
        let hold = || async {
            sqlx::query("UPDATE development_token_reservations SET state='started',settled_at=NULL WHERE run_id=?")
                .bind(&run)
                .execute(&store.pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM continuous_events WHERE kind='development_delivery_released'")
                .execute(&store.pool)
                .await
                .unwrap();
        };
        hold().await;
        let context = store.agent_run_context(&run, "owner", 1).await.unwrap();
        assert!(
            context["delivery"].get("effectiveState").is_none(),
            "a still-held reservation is not reported as released"
        );
        store
            .reconcile_interrupted_development_launches()
            .await
            .unwrap();
        store
            .reconcile_interrupted_development_launches()
            .await
            .unwrap();
        let (state, events): (String, i64) = sqlx::query_as(
            "SELECT (SELECT state FROM development_token_reservations WHERE run_id=?),(SELECT count(*) FROM continuous_events WHERE kind='development_delivery_released')",
        )
        .bind(&run)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        assert_eq!(state, "cancelled", "startup frees the legacy row");
        assert_eq!(events, 1, "the startup release is journaled exactly once");
        let context = store.agent_run_context(&run, "owner", 1).await.unwrap();
        assert_eq!(
            context["delivery"]["effectiveState"],
            "released_undelivered"
        );
    }

    // Review PR #16 (sonnet R4): the transport cannot confirm an enqueue
    // after the proven undelivered exit released the reservation.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_late_enqueue_after_an_undelivered_exit_is_rejected() {
        let (_dir, store, owner, exit, now) =
            undelivered_fixture(&[Stage::Launch, Stage::Process]).await;
        let run = owner.binding.run_id.clone();
        undeliver(&store, &owner, &exit, now).await.unwrap();
        let receipt = store.development_delivery(&run).await.unwrap().unwrap();
        assert!(store
            .record_development_delivery_enqueued(&receipt)
            .await
            .is_err());
        let delivery: String =
            sqlx::query_scalar("SELECT state FROM development_deliveries WHERE run_id=?")
                .bind(&run)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(delivery, "started");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn undelivered_exit_without_exact_ledger_process_or_fence_stays_unresolved() {
        let both = [Stage::Launch, Stage::Process];
        for case in 0..6 {
            let stages: &[Stage] = match case {
                0 => &[Stage::Launch, Stage::Process, Stage::Input],
                1 => &[Stage::Launch],
                _ => &both,
            };
            let (_dir, store, owner, mut exit, now) = undelivered_fixture(stages).await;
            session_fixture(&store, &owner).await;
            match case {
                2 => {
                    sqlx::query("UPDATE development_capture_owners SET state='open'")
                        .execute(&store.pool)
                        .await
                        .unwrap();
                }
                3 => exit = exit_with(&exit, "/identity/processId", json!(43)),
                4 => {
                    sqlx::query("UPDATE continuous_tasks SET claim_fence=claim_fence+1")
                        .execute(&store.pool)
                        .await
                        .unwrap();
                }
                5 => {
                    sqlx::query("CREATE TRIGGER reject_undelivered BEFORE INSERT ON development_capture_results BEGIN SELECT RAISE(ABORT,'fixture result write'); END")
                        .execute(&store.pool).await.unwrap();
                }
                _ => {}
            }
            assert!(
                undeliver(&store, &owner, &exit, now).await.is_err(),
                "case {case}"
            );
            let (state, code, results): (String, Option<i64>, i64) = sqlx::query_as("SELECT state,exit_code,(SELECT count(*) FROM development_capture_results) FROM development_launches WHERE run_id=?")
                .bind(&owner.binding.run_id).fetch_one(&store.pool).await.unwrap();
            assert_eq!(
                (state.as_str(), code, results),
                ("spawning", None, 0),
                "case {case}"
            );
            assert!(
                store.finish_native_session(&owner).await.is_err(),
                "case {case}"
            );
        }
    }
}
