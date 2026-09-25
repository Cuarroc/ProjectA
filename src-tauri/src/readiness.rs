//! Review readiness: lifecycle and blockers as a pure function.
//!
//! The board column is a view. This module is the decision: a worker is
//! [`Readiness::Ready`] only when the evidence tuple still matches the code
//! that would merge, the tests and the human approval bound to that tuple are
//! green, and none of the listed blockers apply. A manual pin is not an input.
//!
//! Persistence and HTTP live elsewhere. Callers gather [`Facts`] and pass them
//! in; [`evaluate`] does not talk to the database or the window.
//!
//! `dead_code`: this package cannot call into `workers.rs` / `store.rs` /
//! `api.rs`. The next F4 specs are the callers. Clippy on the bin would
//! otherwise treat a deliberate seam as unused.

#![allow(dead_code)]

use std::path::Path;
use std::process::Output;

use serde::{Deserialize, Serialize};

/// Lifecycle is not readiness. A finished agent can still be blocked; a
/// running one cannot be ready.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lifecycle {
    Queued,
    Running,
    Exited,
    Archived,
    Merged,
    Failed,
}

impl Lifecycle {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Exited => "exited",
            Self::Archived => "archived",
            Self::Merged => "merged",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Readiness {
    Unknown,
    Blocked,
    Ready,
}

impl Readiness {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Blocked => "blocked",
            Self::Ready => "ready",
        }
    }
}

/// Closed blocker vocabulary from the plan. Display order is
/// [`BlockerCode::display_rank`]; the stored list keeps every code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BlockerCode {
    AgentRunning,
    Dirty,
    SetupFailed,
    TestsStale,
    ReviewStale,
    ChangesRequested,
    CommentsOpen,
    BaseChanged,
    Conflicting,
    GitUnsupported,
}

impl BlockerCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AgentRunning => "agent_running",
            Self::Dirty => "dirty",
            Self::SetupFailed => "setup_failed",
            Self::TestsStale => "tests_stale",
            Self::ReviewStale => "review_stale",
            Self::ChangesRequested => "changes_requested",
            Self::CommentsOpen => "comments_open",
            Self::BaseChanged => "base_changed",
            Self::Conflicting => "conflicting",
            Self::GitUnsupported => "git_unsupported",
        }
    }

    /// Lower is shown first. Never used to drop a blocker.
    pub fn display_rank(self) -> u8 {
        match self {
            Self::GitUnsupported => 0,
            Self::AgentRunning => 1,
            Self::Dirty => 2,
            Self::Conflicting => 3,
            Self::SetupFailed => 4,
            Self::TestsStale => 5,
            Self::BaseChanged => 6,
            Self::ReviewStale => 7,
            Self::ChangesRequested => 8,
            Self::CommentsOpen => 9,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Blocker {
    pub code: BlockerCode,
    pub message: String,
    pub next_step: String,
}

impl Blocker {
    fn new(code: BlockerCode, message: &str, next_step: &str) -> Self {
        Self {
            code,
            message: message.to_string(),
            next_step: next_step.to_string(),
        }
    }

    pub fn line(&self) -> String {
        format!(
            "{}: {} — {}",
            self.code.as_str(),
            self.message,
            self.next_step
        )
    }
}

/// The code that would merge: worker HEAD, the base tip it is merging into,
/// and the tree `git merge-tree --write-tree` produced for that pair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeTuple {
    pub worker_head_sha: String,
    pub base_tip_sha: String,
    pub merge_tree_oid: String,
}

impl CodeTuple {
    pub fn matches(&self, other: &Self) -> bool {
        self.worker_head_sha == other.worker_head_sha
            && self.base_tip_sha == other.base_tip_sha
            && self.merge_tree_oid == other.merge_tree_oid
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestRecord {
    pub code: CodeTuple,
    pub verification_policy_hash: String,
    pub passed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalSource {
    Desktop,
    VerdictToken,
    Unverified,
}

impl ApprovalSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Desktop => "desktop",
            Self::VerdictToken => "verdict_token",
            Self::Unverified => "unverified",
        }
    }

    pub fn counts_as_human(self) -> bool {
        matches!(self, Self::Desktop | Self::VerdictToken)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalDecision {
    Approved,
    ChangesRequested,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovalRecord {
    pub code: CodeTuple,
    pub acceptance_hash: String,
    pub reviewed_by: String,
    pub approval_source: ApprovalSource,
    pub decision: ApprovalDecision,
}

/// Trust for a setup command: identity of the repo, the normalised command,
/// the base SHA it was granted against, and the hash of declared executable
/// inputs (manifest, lockfile, lifecycle script). Serde because the review
/// surface sends the shown grant back as the `expected` payload of the
/// approval command — the core re-computes and compares before storing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrustGrant {
    pub repo_identity: String,
    pub command_normalized: String,
    pub base_sha: String,
    pub inputs_hash: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrustStatus {
    /// No grant stored — setup must not run.
    Missing,
    /// Grant exists but command/identity/base/inputs no longer match.
    Mismatch,
    Granted,
}

impl TrustStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TrustStatus::Missing => "missing",
            TrustStatus::Mismatch => "mismatch",
            TrustStatus::Granted => "granted",
        }
    }
}

/// What the review surface shows before the person grants setup trust: the
/// candidate-bound grant plus the declared input files it covers. The shown
/// values are exactly what the approval binds — no silent fields.
/// `merge_tree_oid` identifies the candidate tree visibly; the approval
/// carries the tree the reviewer READ (from the diff) separately, and the
/// core refuses when the two differ (review-F4-r18, Opus Fund 1).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupTrustWire {
    pub command: String,
    pub status: &'static str,
    pub repo_identity: String,
    pub command_normalized: String,
    pub base_sha: String,
    pub inputs_hash: String,
    pub input_files: Vec<String>,
    pub merge_tree_oid: String,
    pub granted_at: Option<i64>,
}

/// What git said about the merge candidate. Filename overlap is not a
/// variant: only [`Self::Clean`] with a single tree OID is green evidence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitProbe {
    Unsupported,
    Failed,
    Conflict,
    Clean { tree_oid: String },
}

/// Already-gathered facts. Two identical `Facts` are the same situation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Facts {
    pub lifecycle: Lifecycle,
    pub agent_running: bool,
    pub dirty: bool,
    pub git: GitProbe,
    pub current_code: Option<CodeTuple>,
    pub current_policy_hash: String,
    pub current_acceptance_hash: String,
    pub stored_test: Option<TestRecord>,
    pub stored_approval: Option<ApprovalRecord>,
    pub open_comments: usize,
    pub setup_failed: bool,
    pub trust: TrustStatus,
    /// When false, a project has no test command: tests_stale is not emitted.
    pub tests_required: bool,
    /// Display-only. Never read by [`evaluate`] or [`merge_preflight`].
    pub board_pin: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    pub lifecycle: Lifecycle,
    pub readiness: Readiness,
    pub blockers: Vec<Blocker>,
    pub checked_at: i64,
    pub ahead: u32,
    pub behind: u32,
    pub current_code: Option<CodeTuple>,
}

impl Report {
    pub fn is_ready(&self) -> bool {
        self.readiness == Readiness::Ready && self.blockers.is_empty()
    }

    pub fn to_wire(&self) -> ReadinessWire {
        ReadinessWire {
            lifecycle: self.lifecycle.as_str(),
            readiness: self.readiness.as_str(),
            blockers: self
                .blockers
                .iter()
                .map(|blocker| BlockerWire {
                    code: blocker.code.as_str(),
                    message: blocker.message.clone(),
                    next_step: blocker.next_step.clone(),
                })
                .collect(),
            checked_at: self.checked_at,
            ahead: self.ahead,
            behind: self.behind,
            code: self.current_code.clone(),
        }
    }
}

/// IPC shape for the Review surface. Codes stay the engine vocabulary.
///
/// `code` is the tuple the surface is looking at; sending it back with the
/// verdict is what binds the human decision to the reviewed code instead of
/// to whatever git happens to say at click time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessWire {
    pub lifecycle: &'static str,
    pub readiness: &'static str,
    pub blockers: Vec<BlockerWire>,
    pub checked_at: i64,
    pub ahead: u32,
    pub behind: u32,
    pub code: Option<CodeTuple>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockerWire {
    pub code: &'static str,
    pub message: String,
    pub next_step: String,
}

/// Hash a string the same way preflight fingerprints facts: FNV-1a, not a
/// cryptographic claim, just a stable "is this the same input" token.
fn fnv1a(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Collapse interior whitespace and trim, so `cargo test` and `cargo  test`
/// are the same policy.
pub fn normalize_command(command: &str) -> String {
    command.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn verification_policy_hash(command: &str) -> String {
    fnv1a(normalize_command(command).as_bytes())
}

/// Stable hash for acceptance criteria (today: the worker task text).
pub fn acceptance_hash(text: &str) -> String {
    fnv1a(text.as_bytes())
}

/// Hash declared executable inputs in a stable order: `name\\0bytes` per file.
///
/// FNV-1a is invertible and meet-in-the-middle over attacker-controlled bytes
/// (~2^32), so this token must never be the security binding for content the
/// worker agent controls. It remains only in the disk fallback
/// (`setupgate::hash_inputs` via `current_grant`). That fallback can never
/// match a stored grant in any path that actually compares: `facts_for_merge`
/// compares only when a setup command exists, and then either overrides the
/// fallback with `grant_for_tree` (candidate measurable) or carries an empty
/// `base_sha` (no candidate) — and even with a real `base_sha` the token
/// formats differ (FNV fold vs. `name=oid` list). Without a setup command no
/// trust comparison happens at all. The binding path is
/// [`inputs_oid_token`]; the invariant is pinned by
/// `setupgate::tests::the_disk_fallback_never_matches_a_tree_grant`.
pub fn inputs_hash(files: &[(&str, &[u8])]) -> String {
    let mut ordered: Vec<(&str, &[u8])> = files.to_vec();
    ordered.sort_by(|a, b| a.0.cmp(b.0));
    let mut buf = Vec::new();
    for (name, bytes) in ordered {
        buf.extend_from_slice(name.as_bytes());
        buf.push(0);
        buf.extend_from_slice(bytes);
        buf.push(0);
    }
    fnv1a(&buf)
}

/// The token a setup grant binds to: the sorted `name=blob-oid` lines of the
/// declared inputs. A blob OID already commits cryptographically to the
/// bytes, so the token needs no fold of its own — folding the bytes into a
/// weak hash instead (the old FNV-1a path) re-opened collision games against
/// attacker-controlled content (review-F4-r13, k3 Befund 1). Equality of the
/// token is equality of the exact approved blobs.
pub fn inputs_oid_token(files: &[(&str, &str)]) -> String {
    let mut ordered: Vec<(&str, &str)> = files.to_vec();
    ordered.sort_by(|a, b| a.0.cmp(b.0));
    ordered
        .iter()
        .map(|(name, oid)| format!("{name}={oid}"))
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn trust_matches(granted: &TrustGrant, current: &TrustGrant) -> bool {
    granted == current
}

pub fn trust_status(granted: Option<&TrustGrant>, current: &TrustGrant) -> TrustStatus {
    match granted {
        None => TrustStatus::Missing,
        Some(g) if trust_matches(g, current) => TrustStatus::Granted,
        Some(_) => TrustStatus::Mismatch,
    }
}

/// Collect every applicable blocker. The pin is ignored on purpose.
pub fn evaluate(facts: &Facts, now: i64) -> Report {
    // `board_pin` is display-only; naming it here documents that evaluate
    // must not branch on it (F0-2).
    let _ = facts.board_pin.as_deref();
    let mut blockers = Vec::new();

    if facts.agent_running || facts.lifecycle == Lifecycle::Running {
        blockers.push(Blocker::new(
            BlockerCode::AgentRunning,
            "the agent is still running",
            "archive or wait until the session exits, then review again",
        ));
    }
    if facts.dirty {
        blockers.push(Blocker::new(
            BlockerCode::Dirty,
            "the worktree has uncommitted changes",
            "commit or discard the dirty files in the worker worktree",
        ));
    }
    if facts.setup_failed || facts.trust != TrustStatus::Granted {
        let (message, next) = match facts.trust {
            TrustStatus::Missing => (
                "setup has no trust grant for this command and inputs",
                "grant trust for the normalised command, repo identity, base SHA and scripts",
            ),
            TrustStatus::Mismatch => (
                "the setup command is unchanged but its declared inputs are not",
                "re-grant trust; the lifecycle script, lockfile or manifest changed",
            ),
            TrustStatus::Granted => (
                // No successful run on record for this tree — maybe none ever
                // ran; "failed" would be a claim we cannot make (r18, Opus).
                "no successful setup run is on record for this candidate tree",
                "run the setup command (the gate does it), then review again",
            ),
        };
        blockers.push(Blocker::new(BlockerCode::SetupFailed, message, next));
    }

    match &facts.git {
        GitProbe::Unsupported | GitProbe::Failed => blockers.push(Blocker::new(
            BlockerCode::GitUnsupported,
            "git is missing, the repository is unreadable, or merge-tree did not return one tree",
            "install git, open a real repository, and rerun the merge-tree probe",
        )),
        GitProbe::Conflict => blockers.push(Blocker::new(
            BlockerCode::Conflicting,
            "git merge-tree reported a conflict against the current base",
            "rebase or merge the base into the worker branch and resolve the conflict",
        )),
        GitProbe::Clean { .. } => {}
    }

    let current = facts.current_code.as_ref();
    let test_stale = facts.tests_required
        && match (&facts.stored_test, current) {
            (Some(test), Some(code)) => {
                !test.passed
                    || !test.code.matches(code)
                    || test.verification_policy_hash != facts.current_policy_hash
            }
            _ => true,
        };
    if test_stale {
        blockers.push(Blocker::new(
            BlockerCode::TestsStale,
            "there is no green test bound to the current worker HEAD, base tip and merge tree",
            "run the tests against the merge-tree candidate for this evidence set",
        ));
    }

    let stored_base_differs =
        |stored_base: &str| current.is_some_and(|c| stored_base != c.base_tip_sha);
    let base_changed = facts
        .stored_test
        .as_ref()
        .is_some_and(|t| stored_base_differs(&t.code.base_tip_sha))
        || facts
            .stored_approval
            .as_ref()
            .is_some_and(|a| stored_base_differs(&a.code.base_tip_sha));
    if base_changed {
        blockers.push(Blocker::new(
            BlockerCode::BaseChanged,
            "the base tip moved since the stored test or approval",
            "re-run tests and review against the new base",
        ));
    }

    let changes_requested = facts
        .stored_approval
        .as_ref()
        .is_some_and(|a| a.decision == ApprovalDecision::ChangesRequested);
    if changes_requested {
        blockers.push(Blocker::new(
            BlockerCode::ChangesRequested,
            "the last human review asked for changes",
            "address the comments and obtain a new approval for this evidence set",
        ));
    }

    let review_stale = match (&facts.stored_approval, current) {
        (Some(approval), Some(code)) => {
            approval.decision != ApprovalDecision::Approved
                || !approval.approval_source.counts_as_human()
                || !approval.code.matches(code)
                || approval.acceptance_hash != facts.current_acceptance_hash
        }
        _ => true,
    };
    if review_stale {
        blockers.push(Blocker::new(
            BlockerCode::ReviewStale,
            "there is no human approval bound to the current evidence set",
            "review the diff and the acceptance criteria from the desktop or with the verdict token",
        ));
    }

    if facts.open_comments > 0 {
        blockers.push(Blocker::new(
            BlockerCode::CommentsOpen,
            "open review comments remain",
            "resolve or mark each comment done, then approve again if the code changed",
        ));
    }

    blockers.sort_by_key(|b| b.code.display_rank());

    let readiness = match (
        &facts.git,
        facts.lifecycle,
        blockers.is_empty(),
        &facts.current_code,
    ) {
        (_, Lifecycle::Queued | Lifecycle::Merged, true, _) => Readiness::Unknown,
        (
            GitProbe::Clean { tree_oid },
            Lifecycle::Exited | Lifecycle::Archived,
            true,
            Some(code),
        ) if !tree_oid.is_empty() && code.merge_tree_oid == *tree_oid => Readiness::Ready,
        (_, _, false, _) => Readiness::Blocked,
        _ => Readiness::Unknown,
    };

    Report {
        lifecycle: facts.lifecycle,
        readiness,
        blockers,
        checked_at: now,
        ahead: facts.ahead,
        behind: facts.behind,
        current_code: facts.current_code.clone(),
    }
}

/// Hard fail unless [`Report::is_ready`]. The pin never reaches here.
pub fn merge_preflight(report: &Report) -> Result<(), String> {
    if report.is_ready() {
        return Ok(());
    }
    if report.blockers.is_empty() {
        return Err(format!(
            "worker is {}, not ready to merge — measure git, tests and approval first",
            report.readiness.as_str()
        ));
    }
    let lines: Vec<String> = report.blockers.iter().map(Blocker::line).collect();
    Err(format!(
        "merge blocked ({}); {}",
        report.readiness.as_str(),
        lines.join("; ")
    ))
}

/// Setup is part of the verification policy, including its absence.
pub fn verification_policy_with_setup(test: &str, setup: Option<&str>) -> String {
    match setup {
        None => verification_policy_hash(test),
        Some(setup) => {
            fnv1a(format!("{:?}", (normalize_command(setup), normalize_command(test))).as_bytes())
        }
    }
}

fn git_output(repo: &Path, args: &[&str]) -> Result<Output, GitProbe> {
    crate::proc::command("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map_err(|_| GitProbe::Unsupported)
}

fn first_oid_line(stdout: &str) -> Option<String> {
    let line = stdout.lines().map(str::trim).find(|l| !l.is_empty())?;
    let oid = line.split_whitespace().next()?.to_string();
    let ok = (oid.len() == 40 || oid.len() == 64) && oid.chars().all(|c| c.is_ascii_hexdigit());
    ok.then_some(oid)
}

/// `git merge-tree --write-tree <base-tip> <worker-head>`.
///
/// Exit 0 and exactly one tree OID → [`GitProbe::Clean`]. Exit 1 →
/// [`GitProbe::Conflict`]. Anything else, including a missing binary or an
/// ambiguous stdout, is not green.
pub fn probe_merge_tree(repo: &Path, base_tip: &str, worker_head: &str) -> GitProbe {
    if !repo.is_dir() {
        return GitProbe::Unsupported;
    }
    let output = match git_output(repo, &["merge-tree", "--write-tree", base_tip, worker_head]) {
        Ok(out) => out,
        Err(probe) => return probe,
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}{stderr}").to_ascii_lowercase();
    if combined.contains("unknown option") || combined.contains("not a git command") {
        return GitProbe::Unsupported;
    }
    let code = output.status.code();
    if code == Some(1) || combined.contains("conflict") {
        return GitProbe::Conflict;
    }
    if !output.status.success() {
        return if code.is_none() {
            GitProbe::Unsupported
        } else {
            GitProbe::Failed
        };
    }
    match first_oid_line(&stdout) {
        Some(tree_oid) => GitProbe::Clean { tree_oid },
        None => GitProbe::Failed,
    }
}

pub fn rev_parse(repo: &Path, rev: &str) -> Result<String, GitProbe> {
    let output = git_output(repo, &["rev-parse", rev])?;
    if !output.status.success() {
        return Err(GitProbe::Failed);
    }
    first_oid_line(&String::from_utf8_lossy(&output.stdout)).ok_or(GitProbe::Failed)
}

/// Ahead/behind of `worker` relative to `base`: commits only on the worker,
/// commits only on the base.
pub fn ahead_behind(repo: &Path, base: &str, worker: &str) -> Result<(u32, u32), GitProbe> {
    let output = git_output(
        repo,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("{base}...{worker}"),
        ],
    )?;
    if !output.status.success() {
        return Err(GitProbe::Failed);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut parts = text.split_whitespace();
    let behind = parts
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or(GitProbe::Failed)?;
    let ahead = parts
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or(GitProbe::Failed)?;
    Ok((ahead, behind))
}

/// Measure the code tuple for a base/worker pair. Fails closed.
pub fn measure_code(repo: &Path, base_tip: &str, worker_head: &str) -> Result<CodeTuple, GitProbe> {
    let base_tip_sha = rev_parse(repo, base_tip)?;
    let worker_head_sha = rev_parse(repo, worker_head)?;
    match probe_merge_tree(repo, &base_tip_sha, &worker_head_sha) {
        GitProbe::Clean { tree_oid } => Ok(CodeTuple {
            worker_head_sha,
            base_tip_sha,
            merge_tree_oid: tree_oid,
        }),
        other => Err(other),
    }
}

/// Porcelain dirty: uncommitted *work*, not spawn scaffolding.
///
/// `create_worker` copies skill packs into `.claude/skills` (and similar
/// convention dirs). Those files are untracked by design and must not block
/// a merge of the committed merge-tree. A new source file, a modified tracked
/// file, or a staged change still counts.
pub fn worktree_dirty(repo: &Path) -> Result<bool, GitProbe> {
    let output = git_output(repo, &["status", "--porcelain"])?;
    if !output.status.success() {
        return Err(GitProbe::Failed);
    }
    let dirty = String::from_utf8_lossy(&output.stdout)
        .lines()
        .any(|line| !line.trim().is_empty() && !porcelain_is_spawn_artifact(line));
    Ok(dirty)
}

fn porcelain_is_spawn_artifact(line: &str) -> bool {
    let path = line.get(3..).unwrap_or(line).trim().replace('\\', "/");
    path.starts_with(".claude/") || path.starts_with(".agents/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{init_repo, TempDir};
    use std::fs;
    use std::process::Command;

    fn code(head: &str, base: &str, tree: &str) -> CodeTuple {
        CodeTuple {
            worker_head_sha: head.into(),
            base_tip_sha: base.into(),
            merge_tree_oid: tree.into(),
        }
    }

    /// Review-F4-r16 (Opus Fund 3): über die Kommando-Grenze tragen zwei
    /// Strukturen ENTGEGENGESETZTE Namenskonventionen — `TrustGrant` bleibt
    /// snake_case (kommt als `expected`-Payload vom Client herein),
    /// `SetupTrustWire` ist camelCase (geht zur Anzeige hinaus). Kein anderer
    /// Test überquert diese Grenze: die Rust-Tests rufen
    /// `workers::approve_setup_trust` mit nativem Struct, ipc.test.ts und
    /// DiffView.test.tsx mocken die Grenze weg. Eine Vereinheitlichung auf
    /// camelCase würde jede Freigabe zur Laufzeit brechen, während alle
    /// Suites grün bleiben — die Schlüssel werden hier exakt gepinnt.
    #[test]
    fn the_setup_trust_serde_contract_is_pinned() {
        let grant = TrustGrant {
            repo_identity: "r".into(),
            command_normalized: "c".into(),
            base_sha: "b".into(),
            inputs_hash: "i".into(),
        };
        let value = serde_json::to_value(&grant).expect("serialize grant");
        for key in [
            "repo_identity",
            "command_normalized",
            "base_sha",
            "inputs_hash",
        ] {
            assert!(value.get(key).is_some(), "missing snake_case key {key}");
        }
        assert!(
            value.get("inputsHash").is_none(),
            "TrustGrant must stay snake_case"
        );
        let parsed: TrustGrant = serde_json::from_value(value).expect("deserialize grant");
        assert_eq!(parsed, grant);

        let wire = SetupTrustWire {
            command: "npm ci".into(),
            status: "missing",
            repo_identity: "r".into(),
            command_normalized: "c".into(),
            base_sha: "b".into(),
            inputs_hash: "i".into(),
            input_files: vec!["package.json".into()],
            merge_tree_oid: "t".into(),
            granted_at: None,
        };
        let value = serde_json::to_value(&wire).expect("serialize wire");
        for key in [
            "command",
            "status",
            "repoIdentity",
            "commandNormalized",
            "baseSha",
            "inputsHash",
            "inputFiles",
            "mergeTreeOid",
            "grantedAt",
        ] {
            assert!(value.get(key).is_some(), "missing camelCase key {key}");
        }
        assert!(
            value.get("inputs_hash").is_none(),
            "SetupTrustWire must stay camelCase"
        );
    }

    fn ready_facts(c: CodeTuple) -> Facts {
        let policy = verification_policy_hash("cargo test");
        let acceptance = fnv1a(b"must stay green");
        Facts {
            lifecycle: Lifecycle::Exited,
            agent_running: false,
            dirty: false,
            git: GitProbe::Clean {
                tree_oid: c.merge_tree_oid.clone(),
            },
            current_code: Some(c.clone()),
            current_policy_hash: policy.clone(),
            current_acceptance_hash: acceptance.clone(),
            stored_test: Some(TestRecord {
                code: c.clone(),
                verification_policy_hash: policy,
                passed: true,
            }),
            stored_approval: Some(ApprovalRecord {
                code: c,
                acceptance_hash: acceptance,
                reviewed_by: "human".into(),
                approval_source: ApprovalSource::Desktop,
                decision: ApprovalDecision::Approved,
            }),
            open_comments: 0,
            setup_failed: false,
            trust: TrustStatus::Granted,
            tests_required: true,
            board_pin: None,
            ahead: 1,
            behind: 0,
        }
    }

    fn git(repo: &std::path::Path, args: &[&str]) {
        let out = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .expect("git");
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    #[test]
    fn every_lifecycle_and_readiness_has_a_wire_name() {
        for life in [
            Lifecycle::Queued,
            Lifecycle::Running,
            Lifecycle::Exited,
            Lifecycle::Archived,
            Lifecycle::Merged,
            Lifecycle::Failed,
        ] {
            assert!(!life.as_str().is_empty());
        }
        assert_eq!(Readiness::Unknown.as_str(), "unknown");
        assert_eq!(Readiness::Blocked.as_str(), "blocked");
        assert_eq!(Readiness::Ready.as_str(), "ready");
    }

    #[test]
    fn a_complete_exited_worker_is_ready() {
        let facts = ready_facts(code("aaa", "bbb", "ccc"));
        let report = evaluate(&facts, 1);
        assert_eq!(report.readiness, Readiness::Ready, "{:?}", report.blockers);
        assert!(report.blockers.is_empty());
        assert!(merge_preflight(&report).is_ok());
    }

    #[test]
    fn archived_with_full_evidence_can_be_ready() {
        let mut facts = ready_facts(code("aaa", "bbb", "ccc"));
        facts.lifecycle = Lifecycle::Archived;
        let report = evaluate(&facts, 1);
        assert_eq!(report.readiness, Readiness::Ready, "{:?}", report.blockers);
        assert!(merge_preflight(&report).is_ok());
    }

    #[test]
    fn queued_without_blockers_is_unknown_not_ready() {
        let mut facts = ready_facts(code("aaa", "bbb", "ccc"));
        facts.lifecycle = Lifecycle::Queued;
        let report = evaluate(&facts, 1);
        assert_eq!(report.readiness, Readiness::Unknown);
        assert!(merge_preflight(&report).is_err());
    }

    #[test]
    fn running_agent_blocks_even_when_everything_else_is_green() {
        let mut facts = ready_facts(code("aaa", "bbb", "ccc"));
        facts.lifecycle = Lifecycle::Running;
        facts.agent_running = true;
        let report = evaluate(&facts, 1);
        assert_eq!(report.readiness, Readiness::Blocked);
        assert!(report
            .blockers
            .iter()
            .any(|b| b.code == BlockerCode::AgentRunning));
        let err = merge_preflight(&report).unwrap_err();
        assert!(err.contains("agent_running"), "{err}");
        assert!(err.contains("archive"), "{err}");
    }

    #[test]
    fn dirty_worktree_blocks_with_a_next_step() {
        let mut facts = ready_facts(code("aaa", "bbb", "ccc"));
        facts.dirty = true;
        let report = evaluate(&facts, 1);
        assert!(report
            .blockers
            .iter()
            .any(|b| b.code == BlockerCode::Dirty && b.next_step.contains("dirty")));
        assert!(merge_preflight(&report).is_err());
    }

    #[test]
    fn several_blockers_stay_visible_at_once() {
        let mut facts = ready_facts(code("aaa", "bbb", "ccc"));
        facts.dirty = true;
        facts.agent_running = true;
        facts.open_comments = 2;
        facts.git = GitProbe::Conflict;
        let report = evaluate(&facts, 1);
        let codes: Vec<_> = report.blockers.iter().map(|b| b.code).collect();
        assert!(codes.contains(&BlockerCode::Dirty));
        assert!(codes.contains(&BlockerCode::AgentRunning));
        assert!(codes.contains(&BlockerCode::CommentsOpen));
        assert!(codes.contains(&BlockerCode::Conflicting));
        assert!(
            codes.len() >= 4,
            "priority must not drop blockers: {codes:?}"
        );
        // Display order: git-ish / running / dirty before comments.
        let ranks: Vec<_> = report
            .blockers
            .iter()
            .map(|b| b.code.display_rank())
            .collect();
        let mut sorted = ranks.clone();
        sorted.sort();
        assert_eq!(ranks, sorted);
    }

    #[test]
    fn a_board_pin_does_not_make_a_dirty_running_worker_ready() {
        let mut facts = ready_facts(code("aaa", "bbb", "ccc"));
        facts.dirty = true;
        facts.agent_running = true;
        facts.board_pin = Some("ready_to_merge".into());
        let report = evaluate(&facts, 1);
        assert_eq!(report.readiness, Readiness::Blocked);
        assert!(merge_preflight(&report).is_err());
    }

    #[test]
    fn unbound_pass_without_sha_is_tests_stale() {
        let mut facts = ready_facts(code("aaa", "bbb", "ccc"));
        facts.stored_test = None;
        let report = evaluate(&facts, 1);
        assert!(report
            .blockers
            .iter()
            .any(|b| b.code == BlockerCode::TestsStale));
        assert_ne!(report.readiness, Readiness::Ready);
    }

    #[test]
    fn new_worker_head_makes_test_conflict_and_approval_stale() {
        let old = code("head1", "base1", "tree1");
        let mut facts = ready_facts(old.clone());
        let new = code("head2", "base1", "tree2");
        facts.current_code = Some(new.clone());
        facts.git = GitProbe::Clean {
            tree_oid: "tree2".into(),
        };
        let report = evaluate(&facts, 1);
        let codes: Vec<_> = report.blockers.iter().map(|b| b.code).collect();
        assert!(codes.contains(&BlockerCode::TestsStale), "{codes:?}");
        assert!(codes.contains(&BlockerCode::ReviewStale), "{codes:?}");
    }

    #[test]
    fn new_base_tip_marks_base_changed_and_stale_evidence() {
        let old = code("head1", "base1", "tree1");
        let mut facts = ready_facts(old);
        facts.current_code = Some(code("head1", "base2", "tree9"));
        facts.git = GitProbe::Clean {
            tree_oid: "tree9".into(),
        };
        let report = evaluate(&facts, 1);
        let codes: Vec<_> = report.blockers.iter().map(|b| b.code).collect();
        assert!(codes.contains(&BlockerCode::BaseChanged), "{codes:?}");
        assert!(codes.contains(&BlockerCode::TestsStale), "{codes:?}");
        assert!(codes.contains(&BlockerCode::ReviewStale), "{codes:?}");
    }

    #[test]
    fn policy_change_stales_only_the_test() {
        let c = code("aaa", "bbb", "ccc");
        let mut facts = ready_facts(c);
        facts.current_policy_hash = verification_policy_hash("cargo test --all");
        let report = evaluate(&facts, 1);
        let codes: Vec<_> = report.blockers.iter().map(|b| b.code).collect();
        assert!(codes.contains(&BlockerCode::TestsStale), "{codes:?}");
        assert!(!codes.contains(&BlockerCode::ReviewStale), "{codes:?}");
    }

    #[test]
    fn acceptance_change_stales_only_the_approval() {
        let c = code("aaa", "bbb", "ccc");
        let mut facts = ready_facts(c);
        facts.current_acceptance_hash = fnv1a(b"new criteria");
        let report = evaluate(&facts, 1);
        let codes: Vec<_> = report.blockers.iter().map(|b| b.code).collect();
        assert!(codes.contains(&BlockerCode::ReviewStale), "{codes:?}");
        assert!(!codes.contains(&BlockerCode::TestsStale), "{codes:?}");
    }

    #[test]
    fn changes_requested_demands_a_new_approval_and_rejects_the_old_one() {
        let c = code("aaa", "bbb", "ccc");
        let mut facts = ready_facts(c);
        if let Some(a) = facts.stored_approval.as_mut() {
            a.decision = ApprovalDecision::ChangesRequested;
        }
        let report = evaluate(&facts, 1);
        let codes: Vec<_> = report.blockers.iter().map(|b| b.code).collect();
        assert!(codes.contains(&BlockerCode::ChangesRequested), "{codes:?}");
        assert!(codes.contains(&BlockerCode::ReviewStale), "{codes:?}");
        assert!(merge_preflight(&report)
            .unwrap_err()
            .contains("changes_requested"));
    }

    #[test]
    fn unverified_approval_cannot_mint_or_replay_ready() {
        let c = code("aaa", "bbb", "ccc");
        let mut facts = ready_facts(c.clone());
        if let Some(a) = facts.stored_approval.as_mut() {
            a.approval_source = ApprovalSource::Unverified;
        }
        let report = evaluate(&facts, 1);
        assert!(report
            .blockers
            .iter()
            .any(|b| b.code == BlockerCode::ReviewStale));
        assert_ne!(report.readiness, Readiness::Ready);

        // Replaying a desktop approval onto a different tuple also fails.
        let mut replay = ready_facts(c);
        replay.current_code = Some(code("other", "bbb", "ccc"));
        replay.git = GitProbe::Clean {
            tree_oid: "ccc".into(),
        };
        let report = evaluate(&replay, 1);
        assert!(report
            .blockers
            .iter()
            .any(|b| b.code == BlockerCode::ReviewStale));
    }

    #[test]
    fn verdict_token_approval_counts_as_human() {
        let c = code("aaa", "bbb", "ccc");
        let mut facts = ready_facts(c);
        if let Some(a) = facts.stored_approval.as_mut() {
            a.approval_source = ApprovalSource::VerdictToken;
        }
        let report = evaluate(&facts, 1);
        assert_eq!(report.readiness, Readiness::Ready, "{:?}", report.blockers);
    }

    #[test]
    fn missing_git_blocks_merge_with_a_next_step() {
        let mut facts = ready_facts(code("aaa", "bbb", "ccc"));
        facts.git = GitProbe::Unsupported;
        let report = evaluate(&facts, 1);
        assert!(report
            .blockers
            .iter()
            .any(|b| b.code == BlockerCode::GitUnsupported && b.next_step.contains("install git")));
        assert!(merge_preflight(&report).is_err());
    }

    #[test]
    fn unchanged_command_with_changed_lifecycle_script_reasks_trust() {
        let grant = TrustGrant {
            repo_identity: "example.git".into(),
            command_normalized: normalize_command("npm run setup"),
            base_sha: "base1".into(),
            inputs_hash: inputs_hash(&[("scripts/lifecycle.sh", b"old")]),
        };
        let current = TrustGrant {
            repo_identity: grant.repo_identity.clone(),
            command_normalized: grant.command_normalized.clone(),
            base_sha: grant.base_sha.clone(),
            inputs_hash: inputs_hash(&[("scripts/lifecycle.sh", b"new")]),
        };
        assert_eq!(trust_status(Some(&grant), &current), TrustStatus::Mismatch);
        let mut facts = ready_facts(code("aaa", "bbb", "ccc"));
        facts.trust = TrustStatus::Mismatch;
        let report = evaluate(&facts, 1);
        let setup = report
            .blockers
            .iter()
            .find(|b| b.code == BlockerCode::SetupFailed)
            .expect("setup_failed");
        assert!(setup.next_step.contains("re-grant"), "{}", setup.next_step);
        assert!(setup.message.contains("inputs"), "{}", setup.message);
    }

    #[test]
    fn merge_tree_clean_pair_returns_one_oid() {
        let dir = TempDir::new("ready-merge-clean");
        let repo = init_repo(&dir.path().join("repo"));
        git(&repo, &["checkout", "-b", "pa/wk-1"]);
        fs::write(repo.join("worker.txt"), "from the worker\n").unwrap();
        git(&repo, &["add", "worker.txt"]);
        git(&repo, &["commit", "--no-gpg-sign", "-m", "worker"]);
        git(&repo, &["checkout", "main"]);
        let base = rev_parse(&repo, "main").expect("base");
        let head = rev_parse(&repo, "pa/wk-1").expect("head");
        match probe_merge_tree(&repo, &base, &head) {
            GitProbe::Clean { tree_oid } => {
                assert!(tree_oid.len() == 40 || tree_oid.len() == 64, "{tree_oid}");
            }
            other => panic!("expected clean merge-tree, got {other:?}"),
        }
        let measured = measure_code(&repo, "main", "pa/wk-1").expect("measure");
        assert_eq!(measured.base_tip_sha, base);
        assert_eq!(measured.worker_head_sha, head);
        let (ahead, behind) = ahead_behind(&repo, "main", "pa/wk-1").expect("div");
        assert_eq!(ahead, 1);
        assert_eq!(behind, 0);
        assert!(!worktree_dirty(&repo).unwrap());
    }

    #[test]
    fn spawn_skill_copies_are_not_dirty_but_a_new_source_file_is() {
        let dir = TempDir::new("ready-dirty-skills");
        let repo = init_repo(&dir.path().join("repo"));
        fs::create_dir_all(repo.join(".claude/skills/pack")).unwrap();
        fs::write(repo.join(".claude/skills/pack/SKILL.md"), "skill\n").unwrap();
        assert!(
            !worktree_dirty(&repo).unwrap(),
            "copied skill packs must not block merge"
        );
        fs::write(repo.join("extra.txt"), "work\n").unwrap();
        assert!(worktree_dirty(&repo).unwrap(), "untracked source is dirty");
    }

    #[test]
    fn merge_tree_conflict_is_not_green() {
        let dir = TempDir::new("ready-merge-conflict");
        let repo = init_repo(&dir.path().join("repo"));
        fs::write(repo.join("same.txt"), "base\n").unwrap();
        git(&repo, &["add", "same.txt"]);
        git(&repo, &["commit", "--no-gpg-sign", "-m", "base file"]);
        git(&repo, &["checkout", "-b", "pa/wk-1"]);
        fs::write(repo.join("same.txt"), "worker\n").unwrap();
        git(&repo, &["add", "same.txt"]);
        git(&repo, &["commit", "--no-gpg-sign", "-m", "worker edit"]);
        git(&repo, &["checkout", "main"]);
        fs::write(repo.join("same.txt"), "mainline\n").unwrap();
        git(&repo, &["add", "same.txt"]);
        git(&repo, &["commit", "--no-gpg-sign", "-m", "main edit"]);
        let base = rev_parse(&repo, "main").expect("base");
        let head = rev_parse(&repo, "pa/wk-1").expect("head");
        assert_eq!(probe_merge_tree(&repo, &base, &head), GitProbe::Conflict);
        assert!(measure_code(&repo, "main", "pa/wk-1").is_err());
    }

    #[test]
    fn merge_tree_on_a_missing_path_is_unsupported() {
        let dir = TempDir::new("ready-merge-missing");
        assert_eq!(
            probe_merge_tree(&dir.path().join("nope"), "HEAD", "HEAD"),
            GitProbe::Unsupported
        );
    }

    #[test]
    fn failed_setup_and_open_comments_each_have_their_code() {
        let mut facts = ready_facts(code("aaa", "bbb", "ccc"));
        facts.setup_failed = true;
        facts.open_comments = 1;
        let report = evaluate(&facts, 1);
        assert!(report
            .blockers
            .iter()
            .any(|b| b.code == BlockerCode::SetupFailed));
        assert!(report
            .blockers
            .iter()
            .any(|b| b.code == BlockerCode::CommentsOpen));
    }
}
