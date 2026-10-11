//! Durable approval consumption. Execution enforcement belongs to PC-TRUST-14.
#![cfg_attr(not(test), allow(dead_code))]
use super::audit::{append_domain_audit_tx, AuditEnvelope};
use super::continuous::begin_write;
use super::Store;
use crate::development_policy::approval_gate::{
    check, ApprovalGrant, Denial, ExecutionRequest, Scope, UnixSeconds,
};
use sqlx::{Sqlite, Transaction};
use std::collections::HashSet;
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Permit(());
pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("CREATE TABLE IF NOT EXISTS approval_grants (nonce TEXT PRIMARY KEY NOT NULL, content_hash TEXT NOT NULL, target TEXT NOT NULL, run_id TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER NULL)")
        .execute(&mut **tx).await.map_err(|e| format!("approval grants: {e}"))?;
    Ok(())
}
impl Store {
    /// Trusted approval issuer only. Never replace an existing nonce, even after use.
    pub(crate) async fn record_grant(&self, grant: &ApprovalGrant<'_>) -> Result<(), Denial> {
        let mut tx = begin_write(&self.pool, "record approval")
            .await
            .map_err(storage)?;
        sqlx::query("INSERT INTO approval_grants(nonce,content_hash,target,run_id,expires_at) VALUES(?,?,?,?,?)")
            .bind(grant.nonce).bind(grant.scope.content_hash).bind(grant.scope.target)
            .bind(grant.scope.run_id).bind(grant.expires_at.0).execute(&mut *tx).await.map_err(storage)?;
        tx.commit().await.map_err(storage)
    }
    /// Trusted time and request identity come from the caller; only a committed use yields a permit.
    pub(crate) async fn consume(
        &self,
        nonce: &str,
        request: &ExecutionRequest<'_>,
    ) -> Result<Permit, Denial> {
        let mut tx = begin_write(&self.pool, "consume approval")
            .await
            .map_err(storage)?;
        let result = async {
            let (hash, target, run, expiry, used): (String, String, String, i64, Option<i64>) =
                sqlx::query_as("SELECT content_hash,target,run_id,expires_at,consumed_at FROM approval_grants WHERE nonce=?")
                    .bind(nonce).fetch_optional(&mut *tx).await.map_err(storage)?.ok_or(Denial::Unknown)?;
            let grant = ApprovalGrant { scope: Scope { content_hash: &hash, target: &target, run_id: &run }, expires_at: UnixSeconds(expiry), nonce };
            let mut consumed = HashSet::new();
            if used.is_some() { consumed.insert(nonce.to_string()); }
            check(&grant, request, &mut consumed)?;
            let changed = sqlx::query("UPDATE approval_grants SET consumed_at=? WHERE nonce=? AND consumed_at IS NULL")
                .bind(request.now.0).bind(nonce).execute(&mut *tx).await.map_err(storage)?;
            if changed.rows_affected() != 1 { return Err(Denial::AlreadyUsed); }
            // Fixed global envelope: never leak the nonce, hash, target or run into the trail.
            append_domain_audit_tx(&mut tx, "approval_gate", "approval_consumed", "global",
                &AuditEnvelope { project: "global", run: "global", result: "consumed", source_ref: "approval_grants:consume" }).await.map_err(storage)
        }.await;
        match result {
            Ok(()) => {
                tx.commit().await.map_err(storage)?;
                Ok(Permit(()))
            }
            Err(denial) => Err(rollback_denial(tx, denial).await),
        }
    }
}
async fn rollback_denial(tx: Transaction<'_, Sqlite>, denial: Denial) -> Denial {
    match tx.rollback().await {
        Ok(()) => denial,
        Err(error) => storage(error),
    }
}
fn storage(_: impl std::fmt::Display) -> Denial {
    Denial::Storage
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;
    use Denial::{AlreadyUsed, ContentChanged, DuplicateNonce, Expired, Unknown};
    const REQUEST: ExecutionRequest<'static> = ExecutionRequest {
        scope: Scope {
            content_hash: "ab12",
            target: "demo-target",
            run_id: "demo-run",
        },
        now: UnixSeconds(99),
    };
    fn grant() -> ApprovalGrant<'static> {
        ApprovalGrant {
            scope: REQUEST.scope,
            expires_at: UnixSeconds(100),
            nonce: "demo-nonce",
        }
    }
    async fn fixture() -> (TempDir, Store) {
        let dir = TempDir::new("approval-grants");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        store.record_grant(&grant()).await.unwrap();
        (dir, store)
    }
    #[tokio::test]
    async fn second_consume_of_same_grant_is_already_used() {
        let (dir, store) = fixture().await;
        assert!(store.consume(grant().nonce, &REQUEST).await.is_ok());
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        assert_eq!(
            reopened.consume(grant().nonce, &REQUEST).await,
            Err(AlreadyUsed)
        );
        assert_eq!(reopened.record_grant(&grant()).await, Err(DuplicateNonce));
        assert_eq!(reopened.consume("unknown", &REQUEST).await, Err(Unknown));
    }
    #[tokio::test]
    async fn duplicate_nonce_is_reported_as_duplicate() {
        let (_dir, store) = fixture().await;
        let mut duplicate = grant();
        duplicate.scope.content_hash = "changed";
        assert_eq!(store.record_grant(&duplicate).await, Err(DuplicateNonce));
        assert!(store.consume(grant().nonce, &REQUEST).await.is_ok());
        assert_eq!(store.record_grant(&duplicate).await, Err(DuplicateNonce));
        assert_eq!(
            store.consume(grant().nonce, &REQUEST).await,
            Err(AlreadyUsed)
        );
    }
    #[tokio::test]
    async fn rollback_failure_preserves_original_denial() {
        for denial in [Unknown, ContentChanged, Expired, AlreadyUsed] {
            let (_dir, store) = fixture().await;
            let mut tx = begin_write(&store.pool, "approval rollback test")
                .await
                .unwrap();
            // End the SQLite transaction behind sqlx to make its rollback fail.
            sqlx::query("ROLLBACK").execute(&mut *tx).await.unwrap();
            assert_eq!(rollback_denial(tx, denial).await, denial);
        }
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn concurrent_consumes_yield_exactly_one_permit() {
        let (dir, store) = fixture().await;
        let other = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let (a, b) = tokio::join!(
            store.consume(grant().nonce, &REQUEST),
            other.consume(grant().nonce, &REQUEST)
        );
        assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
        assert_eq!(a.err().or(b.err()), Some(AlreadyUsed));
    }
    #[tokio::test]
    async fn changed_content_is_denied_and_not_consumed() {
        let (_dir, store) = fixture().await;
        let mut changed = REQUEST;
        changed.scope.content_hash = "changed";
        assert_eq!(
            store.consume(grant().nonce, &changed).await,
            Err(ContentChanged)
        );
        let mut expired = REQUEST;
        expired.now = UnixSeconds(100);
        assert_eq!(store.consume(grant().nonce, &expired).await, Err(Expired));
        assert!(store.consume(grant().nonce, &REQUEST).await.is_ok());
    }
}
