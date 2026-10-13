//! V2-RUN-1: pure workflow model (ADR-V2-06 and ADR-V2-07 in docs/decisions.md).
//! Callers supply trusted plans and authenticated authority scoped to this order (ADR-V2-03).
//! RUN-2/3/4 own execution/review/delivery; ST-C1 owns persistence.
#![cfg_attr(not(test), allow(dead_code))] // Unwired until RUN-2/3/4; tests exercise it.
use crate::preflight::{self, Blocker, Facts, HostFacts, Report};
use crate::readiness::proof::{GateResult, LanePlan, ProofSet, ProofStatus};
use crate::workers::queue_order::QueueState;
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
/// Admission is only a proposal; a future executor must supply a real spawn receipt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartProposal {
    pub profile: Report,
    /// None means not observed, not proven capacity (B3).
    pub free_ram_bytes: Option<u64>,
    pub running_builds: Option<u32>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdmissionRefusal {
    MissingClick,
    MismatchedClick,
    NotStartable(Step),
    InvalidOrder,
    Preflight(Vec<Blocker>),
    QueueWaiting { grund: String },
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
    /// Trusted adapter supplies an authenticated click scoped to this order, fresh
    /// profile/host facts and this order's verdict from queue_order::queue_order.
    /// Events/timers cannot provide click authority; no cached report is accepted.
    pub fn propose_start(
        &self,
        _click: Option<&str>,
        _facts: &Facts,
        _host: &HostFacts,
        _queue: &QueueState,
        _now: i64,
    ) -> Result<StartProposal, AdmissionRefusal> {
        Err(AdmissionRefusal::MissingClick)
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
            (Ordered | Waiting | Stale | Reviewing, Work) => {
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
            (Evidenced | Reviewing, Review(report)) => {
                if report.sha != self.sha
                    || report.tier != self.order.risk
                    || !report.accepted
                    || report.report_ref.trim().is_empty()
                {
                    return Err(Refusal::InvalidInput);
                }
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
            (Ordered | Working | Evidenced | Reviewing, Reject) => Rejected,
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
    fn start_facts() -> Facts {
        Facts {
            profile_id: "worker".into(),
            known: true,
            enabled: true,
            quota_state: "ok".into(),
            quota_reason: None,
            blocked_until: None,
            budget: None,
        }
    }
    fn queued(id: &str) -> crate::workers::queue_order::QueuedTask {
        crate::workers::queue_order::QueuedTask {
            id: id.into(),
            depends_on: vec![],
            seams: Default::default(),
        }
    }
    fn startable() -> QueueState {
        crate::workers::queue_order::queue_order(&[queued("order")], &Default::default(), &[])
            .remove(0)
            .1
    }
    fn admission(
        run: &Run,
        click: Option<&str>,
        facts: &Facts,
        host: &HostFacts,
        queue: &QueueState,
    ) -> Result<StartProposal, AdmissionRefusal> {
        let before = run.clone();
        let result = run.propose_start(click, facts, host, queue, 100);
        assert_eq!(*run, before, "admission must not change any run data");
        result
    }
    #[test]
    fn admission_requires_a_matching_explicit_click() {
        for kind in [OrderKind::ProjectPackage, OrderKind::CustomerOrder] {
            let mut run = run(kind, RiskTier::A);
            let check = |run: &Run, click| {
                admission(
                    run,
                    click,
                    &start_facts(),
                    &HostFacts::default(),
                    &startable(),
                )
            };
            for click in [None, Some(""), Some(" \n")] {
                assert_eq!(check(&run, click), Err(AdmissionRefusal::MissingClick));
            }
            assert_eq!(
                check(&run, Some("click-2")),
                Err(AdmissionRefusal::MismatchedClick)
            );
            assert!(check(&run, Some("click-1")).is_ok());
            run.order.start_authority = " ".into();
            assert_eq!(
                check(&run, Some("click-1")),
                Err(AdmissionRefusal::MismatchedClick)
            );
            run.order.start_authority = "click-1".into();
            run.order.template.clear();
            assert_eq!(
                check(&run, Some("click-1")),
                Err(AdmissionRefusal::InvalidOrder)
            );
            run.order.template = "standard".into();
            run.sha.clear();
            assert_eq!(
                check(&run, Some("click-1")),
                Err(AdmissionRefusal::InvalidOrder)
            );
        }
    }
    #[test]
    fn admission_reports_profile_and_host_blockers_without_starting() {
        let run = run(OrderKind::ProjectPackage, RiskTier::A);
        let mut facts = start_facts();
        let mut host = HostFacts::default();
        facts.enabled = false;
        let profile = Blocker {
            code: "profile_disabled",
            message: "Agent-Profil 'worker' ist in den Einstellungen aus".into(),
            repair: "In Einstellungen > Agent-Kategorien > Profile wieder aktivieren".into(),
            transient: true,
        };
        let check = |facts: &Facts, host: &HostFacts| {
            admission(&run, Some("click-1"), facts, host, &startable())
        };
        assert_eq!(
            check(&facts, &host),
            Err(AdmissionRefusal::Preflight(vec![profile.clone()]))
        );
        host.free_ram_bytes = Some(0);
        let ram = Blocker {
            code: "low_ram",
            message: "Nur 0.0 GiB RAM frei (Schwelle 1.5 GiB)".into(),
            repair: "Warten oder andere Programme beenden; der Start wird danach neu geprueft"
                .into(),
            transient: true,
        };
        assert_eq!(
            check(&facts, &host),
            Err(AdmissionRefusal::Preflight(vec![profile, ram.clone()]))
        );
        facts.enabled = true;
        assert_eq!(
            check(&facts, &host),
            Err(AdmissionRefusal::Preflight(vec![ram]))
        );
        host.free_ram_bytes = Some(preflight::MIN_FREE_RAM_BYTES);
        host.running_builds = Some(0);
        let proposal = check(&facts, &host).unwrap();
        assert!(proposal.profile.is_clear());
        assert_eq!(proposal.profile.checked_at, 100);
        assert_eq!(proposal.free_ram_bytes, Some(preflight::MIN_FREE_RAM_BYTES));
        assert_eq!(proposal.running_builds, Some(0));
    }
    #[test]
    fn admission_preserves_queue_predecessor_and_seam_wait_reasons() {
        use crate::workers::{lane_guard::Seam, queue_order::queue_order};
        let run = run(OrderKind::ProjectPackage, RiskTier::A);
        let mut first = queued("first");
        let mut second = queued("second");
        second.depends_on.push("first".into());
        let check = |queue: &QueueState| {
            admission(
                &run,
                Some("click-1"),
                &start_facts(),
                &HostFacts::default(),
                queue,
            )
        };
        let verdicts = queue_order(&[first.clone(), second.clone()], &Default::default(), &[]);
        assert!(check(&verdicts[0].1).is_ok());
        assert_eq!(
            check(&verdicts[1].1),
            Err(AdmissionRefusal::QueueWaiting {
                grund: "Vorgänger first ist noch offen".into(),
            })
        );
        second.depends_on.clear();
        first.seams.insert(Seam::Store);
        second.seams.insert(Seam::Store);
        let verdicts = queue_order(&[first, second.clone()], &Default::default(), &[]);
        assert!(check(&verdicts[0].1).is_ok());
        assert_eq!(
            check(&verdicts[1].1),
            Err(AdmissionRefusal::QueueWaiting {
                grund: "Naht src-tauri/src/store.rs ist belegt von first".into(),
            })
        );
        let held = [preflight::SeamHold {
            seam: Seam::Store,
            holder: "running".into(),
        }];
        let verdicts = queue_order(&[second], &Default::default(), &held);
        assert_eq!(
            check(&verdicts[0].1),
            Err(AdmissionRefusal::QueueWaiting {
                grund: "Naht src-tauri/src/store.rs ist belegt von running".into(),
            })
        );
    }
    #[test]
    fn admission_is_idempotent_and_never_marks_a_process_started() {
        for kind in [OrderKind::ProjectPackage, OrderKind::CustomerOrder] {
            for state in [
                Ordered, Waiting, Stale, Working, Evidenced, Reviewing, Approved, Delivered,
                Rejected,
            ] {
                let mut run = run(kind, RiskTier::A);
                match state {
                    Waiting => run.transition(Action::Wait).unwrap(),
                    Stale => run.transition(Action::Candidate("b".into())).unwrap(),
                    Working => run.transition(Action::Work).unwrap(),
                    Evidenced => {
                        run.transition(Action::Work).unwrap();
                        run.transition(Action::Prove(vec![gate("a", 0)])).unwrap();
                    }
                    Reviewing | Approved | Delivered => {
                        reviewing(&mut run);
                        if state != Reviewing {
                            run.transition(Action::Approve(record("a"))).unwrap();
                        }
                        if state == Delivered {
                            run.transition(Action::Deliver(record("a"))).unwrap();
                        }
                    }
                    Rejected => run.transition(Action::Reject).unwrap(),
                    _ => {}
                }
                assert_eq!(run.state(), state);
                let check = || {
                    admission(
                        &run,
                        Some("click-1"),
                        &start_facts(),
                        &HostFacts::default(),
                        &startable(),
                    )
                };
                let result = check();
                assert_eq!(result, check());
                if matches!(state, Ordered | Waiting | Stale | Reviewing) {
                    let proposal = result.unwrap();
                    assert_eq!(proposal.free_ram_bytes, None);
                    assert_eq!(proposal.running_builds, None);
                } else {
                    assert_eq!(result, Err(AdmissionRefusal::NotStartable(state)));
                }
            }
        }
    }
    #[test]
    fn invalid_reviews_leave_evidence_and_state_unchanged() {
        let mut invalid = vec![report("old", RiskTier::A), report("a", RiskTier::B)];
        let mut negative = report("a", RiskTier::A);
        negative.accepted = false;
        invalid.push(negative);
        let mut blank = report("a", RiskTier::A);
        blank.report_ref = " \n".into();
        invalid.push(blank);
        for review in invalid {
            let mut run = run(OrderKind::ProjectPackage, RiskTier::A);
            run.transition(Action::Work).unwrap();
            run.transition(Action::Prove(vec![gate("a", 0)])).unwrap();
            for state in [Evidenced, Reviewing] {
                if state == Reviewing {
                    run.transition(Action::Review(report("a", RiskTier::A)))
                        .unwrap();
                }
                let before = run.clone();
                assert_eq!(
                    run.transition(Action::Review(review.clone())),
                    Err(Refusal::InvalidInput)
                );
                assert_eq!(run, before);
            }
        }
    }
    #[test]
    fn reviewing_allows_current_reports_and_rework() {
        let mut run = run(OrderKind::CustomerOrder, RiskTier::A);
        reviewing(&mut run);
        run.transition(Action::Review(report("a", RiskTier::A)))
            .unwrap();
        assert_eq!(run.evidence_status(), ProofStatus::Belegt);
        let mut approved = run.clone();
        approved.transition(Action::Approve(record("a"))).unwrap();
        assert_eq!(approved.state(), Approved);
        run.transition(Action::Work).unwrap();
        assert_eq!(run.state(), Working);
        assert_eq!(
            run.transition(Action::Approve(record("a"))),
            Err(Refusal::InvalidTransition)
        );
        run.transition(Action::Prove(vec![gate("a", 0)])).unwrap();
        run.transition(Action::Review(report("a", RiskTier::A)))
            .unwrap();
        run.transition(Action::Approve(record("a"))).unwrap();
        assert_eq!(run.state(), Approved);
    }
    #[test]
    fn reject_is_limited_to_productive_states() {
        for state in [Approved, Waiting, Stale] {
            let mut run = run(OrderKind::ProjectPackage, RiskTier::A);
            reviewing(&mut run);
            let action = match state {
                Approved => Action::Approve(record("a")),
                Waiting => Action::Wait,
                _ => Action::Candidate("b".into()),
            };
            run.transition(action).unwrap();
            assert_eq!(run.state(), state);
            let before = run.clone();
            assert_eq!(
                run.transition(Action::Reject),
                Err(Refusal::InvalidTransition)
            );
            assert_eq!(run, before);
        }
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
        assert_eq!(
            run.transition(Action::Review(report("a", run.order().risk))),
            Err(Refusal::InvalidInput)
        );
        assert_eq!(run.state(), Evidenced);
        assert!(run.transition(Action::Approve(record("b"))).is_err());
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
