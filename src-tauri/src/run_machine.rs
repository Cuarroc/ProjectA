//! V2-RUN-1: pure workflow model (ADR-V2-06 and ADR-V2-07 in docs/decisions.md).
//! Callers supply trusted plans and authenticated authority scoped to this order (ADR-V2-03).
//! RUN-2/3/4 own execution/review/delivery; ST-C1 owns persistence.
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
pub enum Action {
    Work,
    Prove(Vec<GateResult>),
    Review(ReviewReport),
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
    pub fn transition(&mut self, action: Action) -> Result<(), Refusal> {
        use Action::*;
        use Step::*;
        let next = match (self.state(), action) {
            (Delivered | Rejected, _) => return Err(Refusal::InvalidTransition),
            (_, Candidate(sha)) => {
                if sha.trim().is_empty() {
                    return Err(Refusal::InvalidInput);
                }
                if sha == self.sha {
                    return Ok(());
                }
                self.sha = sha;
                self.approval = None;
                Stale
            }
            (Ordered | Waiting | Stale, Work) => {
                if self.order.start_authority.trim().is_empty()
                    || self.sha.trim().is_empty()
                    || self.order.template.trim().is_empty()
                {
                    return Err(Refusal::InvalidInput);
                }
                Working
            }
            (Working, Prove(gates)) => {
                if ProofSet::new(&self.plan, &self.lane, &gates).status(&self.sha)
                    != ProofStatus::Belegt
                {
                    return Err(Refusal::EvidenceRequired);
                }
                self.evidence = gates.into_iter().map(Evidence::Gate).collect();
                Evidenced
            }
            (Evidenced, Review(report)) => {
                self.evidence.push(Evidence::Review(report));
                Reviewing
            }
            (Reviewing, Approve(record)) => {
                if self.evidence_status() != ProofStatus::Belegt {
                    return Err(Refusal::EvidenceRequired);
                }
                let reviewed = self.evidence.iter().any(|e| matches!(e, Evidence::Review(r)
                    if r.sha == self.sha && r.tier == self.order.risk && r.accepted && !r.report_ref.trim().is_empty()));
                if !reviewed {
                    return Err(Refusal::ReviewRequired);
                }
                self.check_record(&record)?;
                self.approval = Some(record);
                Approved
            }
            (Approved, Deliver(record)) => {
                self.check_record(&record)?;
                self.delivery = Some(record);
                Delivered
            }
            (Ordered | Working | Evidenced | Reviewing, Wait) => Waiting,
            (_, Reject) => Rejected,
            _ => return Err(Refusal::InvalidTransition),
        };
        self.steps.push(next);
        Ok(())
    }
    fn check_record(&self, record: &BoundRecord) -> Result<(), Refusal> {
        (record.sha == self.sha && !record.reference.trim().is_empty())
            .then_some(())
            .ok_or(Refusal::InvalidInput)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use Step::*;
    fn run(kind: OrderKind, risk: RiskTier) -> Run {
        Run::new(
            Order {
                kind,
                template: "standard".into(),
                risk,
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
    fn report(sha: &str, tier: RiskTier) -> ReviewReport {
        ReviewReport {
            sha: sha.into(),
            tier,
            report_ref: "review-1".into(),
            accepted: true,
        }
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
        run.transition(Action::Review(report("a", run.order().risk)))
            .unwrap();
    }
    #[test]
    fn package_and_customer_orders_share_states() {
        for risk in [RiskTier::A, RiskTier::B, RiskTier::C] {
            for kind in [OrderKind::ProjectPackage, OrderKind::CustomerOrder] {
                let mut run = run(kind, risk);
                reviewing(&mut run);
                run.transition(Action::Approve(record("a"))).unwrap();
                run.transition(Action::Deliver(record("a"))).unwrap();
                assert_eq!(
                    run.steps(),
                    &[Ordered, Working, Evidenced, Reviewing, Approved, Delivered]
                );
                assert_eq!(run.order().kind, kind);
                assert_eq!(run.evidence_status(), ProofStatus::Belegt);
                assert!(run.transition(Action::Work).is_err());
            }
        }
    }
    #[test]
    fn skipped_state_is_rejected_without_mutation() {
        let mut run = run(OrderKind::ProjectPackage, RiskTier::A);
        for action in [
            Action::Prove(vec![gate("a", 0)]),
            Action::Review(report("a", run.order().risk)),
            Action::Approve(record("a")),
            Action::Deliver(record("a")),
        ] {
            let before = run.clone();
            assert_eq!(run.transition(action), Err(Refusal::InvalidTransition));
            assert_eq!(run, before);
        }
        run.transition(Action::Wait).unwrap();
        run.transition(Action::Work).unwrap();
        run.transition(Action::Reject).unwrap();
        assert_eq!(run.state(), Step::Rejected);
        assert!(run.transition(Action::Work).is_err());
    }
    #[test]
    fn new_commit_stales_evidence_and_revokes_approval() {
        let mut run = run(OrderKind::CustomerOrder, RiskTier::A);
        reviewing(&mut run);
        run.transition(Action::Approve(record("a"))).unwrap();
        run.transition(Action::Candidate("b".into())).unwrap();
        assert_eq!(run.state(), Step::Stale);
        assert_eq!(run.evidence_status(), ProofStatus::Veraltet);
        assert!(run.transition(Action::Deliver(record("a"))).is_err());
        run.transition(Action::Work).unwrap();
        run.transition(Action::Prove(vec![gate("b", 0)])).unwrap();
        run.transition(Action::Review(report("a", run.order().risk)))
            .unwrap();
        assert_eq!(
            run.transition(Action::Approve(record("b"))),
            Err(Refusal::ReviewRequired)
        );
    }
    #[test]
    fn no_approval_without_current_successful_evidence() {
        for gates in [vec![], vec![gate("a", 1)], vec![gate("old", 0)]] {
            let mut run = run(OrderKind::ProjectPackage, RiskTier::A);
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
