//! Durable approval consumption. Execution enforcement belongs to PC-TRUST-14.
#![cfg_attr(not(test), allow(dead_code))]
use super::Store;
use crate::development_policy::approval_gate::{ApprovalGrant, Denial, ExecutionRequest};
use sqlx::{Sqlite, Transaction};

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Permit(());

pub(super) async fn apply_migration(_tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    Ok(())
}
impl Store {
    pub(crate) async fn record_grant(&self, _grant: &ApprovalGrant<'_>) -> Result<(), Denial> {
        Ok(())
    }
    pub(crate) async fn consume(
        &self,
        _nonce: &str,
        _request: &ExecutionRequest<'_>,
    ) -> Result<Permit, Denial> {
        Err(Denial::Storage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        development_policy::approval_gate::{Scope, UnixSeconds},
        testutil::TempDir,
    };

    fn grant() -> ApprovalGrant<'static> {
        ApprovalGrant {
            scope: Scope {
                content_hash: "ab12",
                target: "demo-target",
                run_id: "demo-run",
            },
            expires_at: UnixSeconds(100),
            nonce: "demo-nonce",
        }
    }
    fn request() -> ExecutionRequest<'static> {
        ExecutionRequest {
            scope: grant().scope,
            now: UnixSeconds(99),
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
        assert!(store.consume(grant().nonce, &request()).await.is_ok());
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        assert_eq!(
            reopened.consume(grant().nonce, &request()).await,
            Err(Denial::AlreadyUsed)
        );
        assert!(reopened.record_grant(&grant()).await.is_err());
        assert_eq!(
            reopened.consume("unknown", &request()).await,
            Err(Denial::Unknown)
        );
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn concurrent_consumes_yield_exactly_one_permit() {
        let (dir, store) = fixture().await;
        let other = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let req = request();
        let (a, b) = tokio::join!(
            store.consume(grant().nonce, &req),
            other.consume(grant().nonce, &req)
        );
        assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
        assert_eq!(a.err().or(b.err()), Some(Denial::AlreadyUsed));
    }
    #[tokio::test]
    async fn changed_content_is_denied_and_not_consumed() {
        let (_dir, store) = fixture().await;
        let mut changed = request();
        changed.scope.content_hash = "changed";
        assert_eq!(
            store.consume(grant().nonce, &changed).await,
            Err(Denial::ContentChanged)
        );
        let mut expired = request();
        expired.now = UnixSeconds(100);
        assert_eq!(
            store.consume(grant().nonce, &expired).await,
            Err(Denial::Expired)
        );
        assert!(store.consume(grant().nonce, &request()).await.is_ok());
    }
}
