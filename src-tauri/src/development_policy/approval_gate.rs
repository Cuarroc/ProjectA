//! Pure approval matching; persistence and execution enforcement are separate.

use std::collections::HashSet;

/// Trusted approval data supplied by the caller, with an opaque unique nonce.
/// All strings are compared byte-for-byte, without normalization.
#[derive(Debug, Clone)]
pub(crate) struct ApprovalGrant<'a> {
    pub scope: Scope<'a>,
    /// Exclusive deadline in Unix seconds, in the same clock domain as `now`.
    pub expires_at: UnixSeconds,
    pub nonce: &'a str,
}

#[derive(Debug, Clone)]
pub(crate) struct ExecutionRequest<'a> {
    pub scope: Scope<'a>,
    /// Current Unix seconds supplied by the caller; no clock is read here.
    pub now: UnixSeconds,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct UnixSeconds(pub i64);
#[derive(Debug, Clone, Copy)]
pub(crate) struct Scope<'a> {
    pub content_hash: &'a str,
    pub target: &'a str,
    pub run_id: &'a str,
}
impl Scope<'_> {
    fn first_mismatch(&self, other: &Self) -> Result<(), Denial> {
        if self.content_hash != other.content_hash {
            return Err(Denial::ContentChanged);
        }
        if self.target != other.target {
            return Err(Denial::WrongTarget);
        }
        if self.run_id != other.run_id {
            return Err(Denial::WrongRun);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Denial {
    ContentChanged,
    WrongTarget,
    WrongRun,
    Expired,
    AlreadyUsed,
    DuplicateNonce,
    Unknown,
    Storage,
}

/// Return the first denial in this fixed order: content, target, run, expiry,
/// consumption. The deadline itself is expired (`now >= expires_at`).
///
/// Success consumes the nonce in the supplied ledger. Durable callers must
/// hold the database writer lock and commit consumption before issuing a permit.
/// The caller also owns hash generation, grant authenticity and trusted time.
pub(crate) fn check(
    grant: &ApprovalGrant<'_>,
    request: &ExecutionRequest<'_>,
    consumed: &mut HashSet<String>,
) -> Result<(), Denial> {
    grant.scope.first_mismatch(&request.scope)?;
    if request.now >= grant.expires_at {
        return Err(Denial::Expired);
    }
    if !consumed.insert(grant.nonce.to_string()) {
        return Err(Denial::AlreadyUsed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (ApprovalGrant<'static>, ExecutionRequest<'static>) {
        (
            ApprovalGrant {
                scope: Scope {
                    content_hash: "ab12",
                    target: "demo-target",
                    run_id: "demo-run",
                },
                expires_at: UnixSeconds(100),
                nonce: "demo-nonce",
            },
            ExecutionRequest {
                scope: Scope {
                    content_hash: "ab12",
                    target: "demo-target",
                    run_id: "demo-run",
                },
                now: UnixSeconds(99),
            },
        )
    }

    #[test]
    fn matching_request_consumes_nonce_atomically() {
        let (grant, request) = fixture();
        let mut used = HashSet::from(["DEMO-NONCE".to_string()]);
        assert_eq!(check(&grant, &request, &mut used), Ok(()));
        assert_eq!(check(&grant, &request, &mut used), Err(Denial::AlreadyUsed));
        assert_eq!(used.len(), 2);
    }

    #[test]
    fn denies_when_content_hash_changed() {
        let (grant, mut request) = fixture();
        for hash in ["cd34", "AB12", "ab12 ", ""] {
            request.scope.content_hash = hash;
            assert_eq!(
                check(&grant, &request, &mut HashSet::new()),
                Err(Denial::ContentChanged)
            );
        }
    }

    #[test]
    fn denies_wrong_target() {
        let (grant, mut request) = fixture();
        for target in ["other-target", "DEMO-TARGET", "demo-target ", ""] {
            request.scope.target = target;
            assert_eq!(
                check(&grant, &request, &mut HashSet::new()),
                Err(Denial::WrongTarget)
            );
        }
        let grant = ApprovalGrant {
            scope: Scope {
                target: "é",
                ..grant.scope
            },
            ..grant
        };
        request.scope.target = "e\u{301}";
        assert_eq!(
            check(&grant, &request, &mut HashSet::new()),
            Err(Denial::WrongTarget)
        );
    }

    #[test]
    fn denies_wrong_run() {
        let (grant, mut request) = fixture();
        for run_id in ["other-run", "DEMO-RUN", "demo-run ", ""] {
            request.scope.run_id = run_id;
            assert_eq!(
                check(&grant, &request, &mut HashSet::new()),
                Err(Denial::WrongRun)
            );
        }
    }

    #[test]
    fn denies_at_exact_expiry() {
        let (mut grant, mut request) = fixture();
        for now in [100, 101, i64::MAX] {
            request.now = UnixSeconds(now);
            assert_eq!(
                check(&grant, &request, &mut HashSet::new()),
                Err(Denial::Expired)
            );
        }
        for deadline in [0, i64::MAX] {
            grant.expires_at = UnixSeconds(deadline);
            request.now = UnixSeconds(deadline);
            assert_eq!(
                check(&grant, &request, &mut HashSet::new()),
                Err(Denial::Expired)
            );
        }
    }

    #[test]
    fn denies_reuse_of_a_consumed_grant() {
        let (grant, request) = fixture();
        let mut used = HashSet::new();
        assert_eq!(check(&grant, &request, &mut used), Ok(()));
        assert_eq!(check(&grant, &request, &mut used), Err(Denial::AlreadyUsed));
        assert_eq!(used.len(), 1);
    }

    #[test]
    fn returns_first_denial_in_documented_order() {
        let (grant, mut request) = fixture();
        let mut used = HashSet::from([grant.nonce.to_string()]);
        request.scope.content_hash = "changed";
        request.scope.target = "other-target";
        request.scope.run_id = "other-run";
        request.now = UnixSeconds(100);
        assert_eq!(
            check(&grant, &request, &mut used),
            Err(Denial::ContentChanged)
        );
        request.scope.content_hash = grant.scope.content_hash;
        assert_eq!(check(&grant, &request, &mut used), Err(Denial::WrongTarget));
        request.scope.target = grant.scope.target;
        assert_eq!(check(&grant, &request, &mut used), Err(Denial::WrongRun));
        request.scope.run_id = grant.scope.run_id;
        assert_eq!(check(&grant, &request, &mut used), Err(Denial::Expired));
        request.now = UnixSeconds(99);
        assert_eq!(check(&grant, &request, &mut used), Err(Denial::AlreadyUsed));
    }
}
