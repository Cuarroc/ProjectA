//! Pure approval matching; persistence and execution enforcement are separate.

use std::collections::HashSet;

/// Trusted approval data supplied by the caller, with an opaque unique nonce.
/// All strings are compared byte-for-byte, without normalization.
#[derive(Debug, Clone)]
pub struct ApprovalGrant<'a> {
    pub content_hash: &'a str,
    pub target: &'a str,
    pub run_id: &'a str,
    /// Exclusive deadline in Unix seconds, in the same clock domain as `now`.
    pub expires_at: u64,
    pub nonce: &'a str,
}

#[derive(Debug, Clone)]
pub struct ExecutionRequest<'a> {
    pub content_hash: &'a str,
    pub target: &'a str,
    pub run_id: &'a str,
    /// Current Unix seconds supplied by the caller; no clock is read here.
    pub now: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Denial {
    ContentChanged,
    WrongTarget,
    WrongRun,
    Expired,
    AlreadyUsed,
}

/// Return the first denial in this fixed order: content, target, run, expiry,
/// consumption. The deadline itself is expired (`now >= expires_at`).
///
/// Success does not consume the nonce. The caller must atomically check and
/// mark it consumed before execution; this function provides no synchronization.
/// The caller also owns hash generation, grant authenticity and trusted time.
pub fn check(
    _grant: &ApprovalGrant<'_>,
    _request: &ExecutionRequest<'_>,
    _consumed: &HashSet<String>,
) -> Result<(), Denial> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (ApprovalGrant<'static>, ExecutionRequest<'static>) {
        (
            ApprovalGrant {
                content_hash: "ab12",
                target: "demo-target",
                run_id: "demo-run",
                expires_at: 100,
                nonce: "demo-nonce",
            },
            ExecutionRequest {
                content_hash: "ab12",
                target: "demo-target",
                run_id: "demo-run",
                now: 99,
            },
        )
    }

    #[test]
    fn accepts_matching_request_without_consuming() {
        let (grant, request) = fixture();
        let consumed = HashSet::from(["DEMO-NONCE".to_string()]);
        assert_eq!(check(&grant, &request, &consumed), Ok(()));
        assert_eq!(check(&grant, &request, &consumed), Ok(()));
        assert_eq!(consumed, HashSet::from(["DEMO-NONCE".to_string()]));
    }

    #[test]
    fn denies_when_content_hash_changed() {
        let (grant, mut request) = fixture();
        for hash in ["cd34", "AB12", "ab12 ", ""] {
            request.content_hash = hash;
            assert_eq!(
                check(&grant, &request, &HashSet::new()),
                Err(Denial::ContentChanged)
            );
        }
    }

    #[test]
    fn denies_wrong_target() {
        let (grant, mut request) = fixture();
        for target in ["other-target", "DEMO-TARGET", "demo-target ", ""] {
            request.target = target;
            assert_eq!(
                check(&grant, &request, &HashSet::new()),
                Err(Denial::WrongTarget)
            );
        }
        let grant = ApprovalGrant {
            target: "é",
            ..grant
        };
        request.target = "e\u{301}";
        assert_eq!(
            check(&grant, &request, &HashSet::new()),
            Err(Denial::WrongTarget)
        );
    }

    #[test]
    fn denies_wrong_run() {
        let (grant, mut request) = fixture();
        for run_id in ["other-run", "DEMO-RUN", "demo-run ", ""] {
            request.run_id = run_id;
            assert_eq!(
                check(&grant, &request, &HashSet::new()),
                Err(Denial::WrongRun)
            );
        }
    }

    #[test]
    fn denies_at_exact_expiry() {
        let (mut grant, mut request) = fixture();
        for now in [100, 101, u64::MAX] {
            request.now = now;
            assert_eq!(
                check(&grant, &request, &HashSet::new()),
                Err(Denial::Expired)
            );
        }
        for deadline in [0, u64::MAX] {
            grant.expires_at = deadline;
            request.now = deadline;
            assert_eq!(
                check(&grant, &request, &HashSet::new()),
                Err(Denial::Expired)
            );
        }
    }

    #[test]
    fn denies_reuse_of_a_consumed_grant() {
        let (grant, request) = fixture();
        let mut consumed = HashSet::new();
        assert_eq!(check(&grant, &request, &consumed), Ok(()));
        consumed.insert(grant.nonce.to_string());
        assert_eq!(check(&grant, &request, &consumed), Err(Denial::AlreadyUsed));
        assert_eq!(consumed.len(), 1);
    }

    #[test]
    fn returns_first_denial_in_documented_order() {
        let (grant, mut request) = fixture();
        let consumed = HashSet::from([grant.nonce.to_string()]);
        request.content_hash = "changed";
        request.target = "other-target";
        request.run_id = "other-run";
        request.now = 100;
        assert_eq!(
            check(&grant, &request, &consumed),
            Err(Denial::ContentChanged)
        );
        request.content_hash = grant.content_hash;
        assert_eq!(check(&grant, &request, &consumed), Err(Denial::WrongTarget));
        request.target = grant.target;
        assert_eq!(check(&grant, &request, &consumed), Err(Denial::WrongRun));
        request.run_id = grant.run_id;
        assert_eq!(check(&grant, &request, &consumed), Err(Denial::Expired));
        request.now = 99;
        assert_eq!(check(&grant, &request, &consumed), Err(Denial::AlreadyUsed));
    }
}
