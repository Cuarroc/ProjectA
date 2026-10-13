//! V2-RUN-1: pure workflow model (ADR-V2-06 and ADR-V2-07 in docs/decisions.md).
//! This single-file form of workflow/model.rs has no scheduler or evidence ledger.
//! Callers supply trusted gate plans, observed identities and authenticated authority
//! references scoped to this order; strings alone are not authentication (ADR-V2-03).
//! RUN-2/3/4 own execution, review collection and delivery; ST-C1 owns persistence.
#![cfg_attr(not(test), allow(dead_code))] // Unwired until RUN-2/3/4; tests exercise it.

use crate::readiness::proof::{GateResult, LanePlan, ProofSet, ProofStatus};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderKind {
    ProjectPackage,
    CustomerOrder,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RiskTier {
    A,
    B,
    C,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Order {
    pub kind: OrderKind,
    pub template: String,
    pub risk: RiskTier,
    pub start_authority: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Ordered,
    Working,
    Evidenced,
    Reviewing,
    Approved,
    Delivered,
    Waiting,
    Rejected,
    Stale,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewReport {
    pub sha: String,
    pub tier: RiskTier,
    pub report_ref: String,
    /// RUN-3 attests tier/identity checks and complete disposition without open high findings.
    pub accepted: bool,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Evidence {
    Gate(GateResult),
    Review(ReviewReport),
}
/// Candidate-bound authority or delivery receipt, authenticated by the adapter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundRecord {
    pub sha: String,
    pub reference: String,
}
#[derive(Debug, Clone)]
pub enum Action {
    Work,
    Prove(Vec<GateResult>),
    Review(Vec<ReviewReport>),
    Approve(BoundRecord),
    Deliver(BoundRecord),
    Candidate(String),
    Wait,
    Reject,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    InvalidTransition,
    InvalidInput,
    EvidenceRequired,
    ReviewRequired,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Run {
    order: Order,
    sha: String,
    plan: LanePlan,
    lane: String,
    steps: Vec<Step>,
    evidence: Vec<Evidence>,
    approval: Option<BoundRecord>,
    delivery: Option<BoundRecord>,
}
impl Run {
    pub fn new(order: Order, sha: String, plan: LanePlan, lane: String) -> Self {
        Self {
            order,
            sha,
            plan,
            lane,
            steps: vec![Step::Ordered],
            evidence: vec![],
            approval: None,
            delivery: None,
        }
    }
    pub fn state(&self) -> Step {
        *self.steps.last().expect("initial ordered step")
    }
    pub fn steps(&self) -> &[Step] {
        &self.steps
    }
    pub fn order(&self) -> &Order {
        &self.order
    }
    pub fn evidence_status(&self) -> ProofStatus {
        let gates: Vec<_> = self
            .evidence
            .iter()
            .filter_map(|e| match e {
                Evidence::Gate(g) => Some(g.clone()),
                Evidence::Review(_) => None,
            })
            .collect();
        ProofSet::new(&self.plan, &self.lane, &gates).status(&self.sha)
    }
    /// The only mutation boundary. Refusals leave the entire value unchanged.
    pub fn transition(&mut self, _action: Action) -> Result<(), Refusal> {
        todo!("implement guarded transitions after red evidence")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use Step::*;
    fn run(kind: OrderKind) -> Run {
        Run::new(
            Order {
                kind,
                template: "standard".into(),
                risk: RiskTier::A,
                start_authority: "click-1".into(),
            },
            "a".into(),
            LanePlan::from_list("test prepush cargo-test"),
            "prepush".into(),
        )
    }
    fn gate(sha: &str, exit_code: i32) -> GateResult {
        GateResult {
            lane: "prepush".into(),
            gate: "test".into(),
            exit_code,
            sha: sha.into(),
        }
    }
    fn reports(sha: &str) -> Vec<ReviewReport> {
        vec![ReviewReport {
            sha: sha.into(),
            tier: RiskTier::A,
            report_ref: "review-1".into(),
            accepted: true,
        }]
    }

    fn record(sha: &str) -> BoundRecord {
        BoundRecord {
            sha: sha.into(),
            reference: "receipt-1".into(),
        }
    }
    fn reviewing(run: &mut Run) {
        run.transition(Action::Work).unwrap();
        run.transition(Action::Prove(vec![gate("a", 0)])).unwrap();
        run.transition(Action::Review(reports("a"))).unwrap();
    }
    #[test]
    fn package_and_customer_orders_share_states() {
        for kind in [OrderKind::ProjectPackage, OrderKind::CustomerOrder] {
            let mut run = run(kind);
            reviewing(&mut run);
            run.transition(Action::Approve(record("a"))).unwrap();
            run.transition(Action::Deliver(record("a"))).unwrap();
            assert_eq!(
                run.steps(),
                &[Ordered, Working, Evidenced, Reviewing, Approved, Delivered]
            );
            assert_eq!(run.order().kind, kind);
            assert_eq!(run.evidence_status(), ProofStatus::Belegt);
        }
    }
    #[test]
    fn skipped_state_is_rejected_without_mutation() {
        let mut run = run(OrderKind::ProjectPackage);
        for action in [
            Action::Prove(vec![gate("a", 0)]),
            Action::Review(reports("a")),
            Action::Approve(record("a")),
            Action::Deliver(record("a")),
        ] {
            let before = run.clone();
            assert_eq!(run.transition(action), Err(Refusal::InvalidTransition));
            assert_eq!(run, before);
        }
    }
    #[test]
    fn new_commit_stales_evidence_and_revokes_approval() {
        let mut run = run(OrderKind::CustomerOrder);
        reviewing(&mut run);
        run.transition(Action::Approve(record("a"))).unwrap();
        run.transition(Action::Candidate("b".into())).unwrap();
        assert_eq!(run.state(), Step::Stale);
        assert_eq!(run.evidence_status(), ProofStatus::Veraltet);
        assert!(run.transition(Action::Deliver(record("a"))).is_err());
        run.transition(Action::Work).unwrap();
        run.transition(Action::Prove(vec![gate("b", 0)])).unwrap();
        run.transition(Action::Review(reports("a"))).unwrap();
        assert_eq!(
            run.transition(Action::Approve(record("b"))),
            Err(Refusal::ReviewRequired)
        );
    }
    #[test]
    fn no_approval_without_current_successful_evidence() {
        for gates in [vec![], vec![gate("a", 1)], vec![gate("old", 0)]] {
            let mut run = run(OrderKind::ProjectPackage);
            run.transition(Action::Work).unwrap();
            let before = run.clone();
            assert_eq!(
                run.transition(Action::Prove(gates)),
                Err(Refusal::EvidenceRequired)
            );
            assert_eq!(run, before);
            assert!(run.transition(Action::Approve(record("a"))).is_err());
        }
    }
}
