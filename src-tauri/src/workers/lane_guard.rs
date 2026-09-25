//! Conflict forecast and seam-lane guard for development package starts (W5-22).
//!
//! One path core, two halves:
//!
//! - **Forecast** ([`dispatch_order`]): given planned packages - the files they
//!   will touch, their follow-up dependencies and their dispatch priority -
//!   compute a lane-serial order: packages that share a file never overlap,
//!   dependencies always come first. Validated by back-calculation against
//!   wave 2 of 2026-09-23 (store-, status.rs- and pty.rs-lanes).
//! - **Guard** ([`evaluate`] + [`refuse_lane_conflicts`]): before a package
//!   starts (its development run is launched), a second package on an occupied
//!   seam lane - `st` (`store.rs` + `store/`), `api` (`api.rs`), `mn`
//!   (`main.rs`), `pa` (`bin/pa.rs`) - is refused while the first package is
//!   still open; overlapping non-seam paths produce a warning, not a refusal.
//!
//! Scope locks (`continuous_scope_locks`) already serialize *identical* paths
//! at task admission; they cannot see that `store/continuous.rs` and
//! `store/discovery.rs` sit on the same seam lane. That lane-level view is the
//! gap this module closes. The store adapter below reads only existing public
//! store methods, so the four seams themselves stay untouched.

use std::collections::{BTreeMap, BTreeSet};

use crate::store::{
    development_runs::{DevelopmentRun, RUN_INTENT, RUN_LAUNCHED, RUN_RECONCILING},
    Store,
};

/// One of the four serial seam lanes named in AGENTS.md. Two open packages on
/// the same seam may not run in parallel, no matter which concrete files of
/// the lane they touch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Seam {
    /// `src-tauri/src/store.rs` and everything under `src-tauri/src/store/`.
    Store,
    /// `src-tauri/src/api.rs`.
    Api,
    /// `src-tauri/src/main.rs`.
    Main,
    /// `src-tauri/src/bin/pa.rs`.
    Cli,
}

impl Seam {
    /// The short lane name used by the plan tables (st, api, mn, pa).
    pub fn lane(self) -> &'static str {
        match self {
            Seam::Store => "st",
            Seam::Api => "api",
            Seam::Main => "mn",
            Seam::Cli => "pa",
        }
    }

    /// The seam a normalized workspace path belongs to, if any. Only the
    /// store seam covers a whole directory; the other three are single files,
    /// exactly as AGENTS.md declares them.
    pub fn of_path(path: &str) -> Option<Seam> {
        match normalize_path(path).as_str() {
            "src-tauri/src/store.rs" => Some(Seam::Store),
            "src-tauri/src/api.rs" => Some(Seam::Api),
            "src-tauri/src/main.rs" => Some(Seam::Main),
            "src-tauri/src/bin/pa.rs" => Some(Seam::Cli),
            p if p.starts_with("src-tauri/src/store/") => Some(Seam::Store),
            _ => None,
        }
    }
}

/// Normalize a declared workspace path for comparison: forward slashes, no
/// leading `./`, no trailing `/`, case folded (NTFS is case-insensitive).
pub fn normalize_path(raw: &str) -> String {
    let mut value = raw.trim().replace('\\', "/");
    while let Some(rest) = value.strip_prefix("./") {
        value = rest.to_string();
    }
    while value.ends_with('/') {
        value.pop();
    }
    value.to_ascii_lowercase()
}

/// Whether two normalized paths overlap: identical, or one is a path-prefix
/// (on a `/` boundary) of the other.
pub fn paths_overlap(left: &str, right: &str) -> bool {
    let left = normalize_path(left);
    let right = normalize_path(right);
    left == right
        || left.starts_with(&format!("{right}/"))
        || right.starts_with(&format!("{left}/"))
}

/// The seam lanes a set of declared paths occupies.
pub fn lanes_of(paths: &[String]) -> BTreeSet<Seam> {
    paths.iter().filter_map(|p| Seam::of_path(p)).collect()
}

/// A package that is currently open (claimed or running) with its declared
/// write scope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenPackage {
    /// The development run holding the package; empty when only a claim exists.
    pub run_id: String,
    pub task_id: String,
    pub owned_paths: Vec<String>,
}

/// What collided between a candidate and one open package.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConflictKind {
    /// Both packages touch the same seam lane (any file on it).
    Lane(Seam),
    /// The packages share a concrete non-seam path (identical or nested).
    Path(String),
}

/// One collision with the package that holds the contested scope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conflict {
    pub kind: ConflictKind,
    pub holder_run: String,
    pub holder_task: String,
}

impl Conflict {
    pub fn describe(&self) -> String {
        let holder = if self.holder_run.is_empty() {
            format!("task {}", self.holder_task)
        } else {
            format!("run {} (task {})", self.holder_run, self.holder_task)
        };
        match &self.kind {
            ConflictKind::Lane(seam) => {
                format!("seam lane '{}' is held by {}", seam.lane(), holder)
            }
            ConflictKind::Path(path) => format!("path '{}' overlaps {}", path, holder),
        }
    }
}

/// The guard's verdict for one candidate against all open packages.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Verdict {
    /// Seam-lane collisions: the start must be refused.
    pub blocks: Vec<Conflict>,
    /// Non-seam path overlaps: the start may proceed, but somebody should look.
    pub warnings: Vec<Conflict>,
}

impl Verdict {
    pub fn is_clear(&self) -> bool {
        self.blocks.is_empty() && self.warnings.is_empty()
    }
}

/// Judge one candidate against the currently open packages. A package is
/// never its own conflict (matched by task id).
pub fn evaluate(candidate_task: &str, candidate_paths: &[String], open: &[OpenPackage]) -> Verdict {
    let _ = (candidate_task, candidate_paths, open);
    // W5-22 red: stub, implemented in the green commit.
    Verdict::default()
}

/// One package as the wave plan declares it for scheduling.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedPackage {
    pub id: String,
    /// Dispatch readiness of the wave plan: lower goes first. The plan owns
    /// this number (PLAN.md: "Priorität mit Begründung"); the predictor only
    /// serializes it, it never invents it.
    pub priority: u32,
    /// The files the package is expected to touch.
    pub files: Vec<String>,
    /// Follow-up edges: these package ids must complete first.
    pub depends_on: Vec<String>,
}

/// Compute a lane-serial dispatch order: a linear extension of the follow-up
/// dependencies where no two packages that share a file overlap - the
/// higher-priority package (then the lexicographically smaller id) goes
/// first. Unknown dependencies and unsatisfiable constraint cycles are
/// errors, not silently dropped packages.
pub fn dispatch_order(packages: &[PlannedPackage]) -> Result<Vec<String>, String> {
    // W5-22 red: stub, implemented in the green commit.
    let _ = BTreeMap::<String, String>::new();
    Ok(packages.iter().map(|p| p.id.clone()).collect())
}

/// Refuse the start of `run` while another open package holds a seam lane the
/// run's task also touches. Returns the non-blocking path warnings for the
/// caller to surface; a blocking conflict is the `Err`.
///
/// Advisory, not transactional: the check reads, it does not lock. The only
/// caller is the trusted launch lane and no concurrent production scheduler
/// exists yet; moving the check into the launch reservation transaction (a
/// store-lane change) is the documented follow-up for when one does.
pub async fn refuse_lane_conflicts(
    store: &Store,
    run: &DevelopmentRun,
) -> Result<Vec<Conflict>, String> {
    let _ = (store, run);
    let _ = (RUN_INTENT, RUN_LAUNCHED, RUN_RECONCILING);
    let _ = BTreeSet::<Seam>::new();
    // W5-22 red: stub, implemented in the green commit.
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    fn open(run: &str, task: &str, paths: &[&str]) -> OpenPackage {
        OpenPackage {
            run_id: run.into(),
            task_id: task.into(),
            owned_paths: paths.iter().map(|p| p.to_string()).collect(),
        }
    }

    #[test]
    fn seam_lane_mapping_covers_the_four_declared_seams() {
        assert_eq!(Seam::of_path("src-tauri/src/store.rs"), Some(Seam::Store));
        assert_eq!(
            Seam::of_path("src-tauri/src/store/continuous.rs"),
            Some(Seam::Store)
        );
        assert_eq!(
            Seam::of_path("src-tauri\\src\\store\\discovery.rs"),
            Some(Seam::Store),
            "Windows separators normalize to the same lane"
        );
        assert_eq!(Seam::of_path("SRC-TAURI/SRC/API.RS"), Some(Seam::Api));
        assert_eq!(Seam::of_path("src-tauri/src/main.rs"), Some(Seam::Main));
        assert_eq!(Seam::of_path("src-tauri/src/bin/pa.rs"), Some(Seam::Cli));
        // Exactly the AGENTS.md set: the api/ test directory and the capture
        // host are not seams.
        assert_eq!(Seam::of_path("src-tauri/src/api/tests/x.rs"), None);
        assert_eq!(Seam::of_path("src-tauri/src/bin/pa-capture-host.rs"), None);
        assert_eq!(Seam::of_path("src-tauri/src/queue.rs"), None);
        assert_eq!(
            lanes_of(&[
                "src-tauri/src/store.rs".to_string(),
                "src-tauri/src/store/continuous.rs".to_string(),
                "src/components/App.tsx".to_string(),
            ]),
            BTreeSet::from([Seam::Store])
        );
    }

    #[test]
    fn a_second_package_on_an_occupied_seam_lane_is_blocked() {
        // The gap scope locks cannot see: different files, same lane.
        let verdict = evaluate(
            "task-b",
            &["src-tauri/src/store/discovery.rs".to_string()],
            &[open(
                "run-a",
                "task-a",
                &["src-tauri/src/store/continuous.rs"],
            )],
        );
        assert_eq!(verdict.warnings, vec![]);
        assert_eq!(verdict.blocks.len(), 1);
        assert_eq!(
            verdict.blocks[0].kind,
            ConflictKind::Lane(Seam::Store),
            "block: {:?}",
            verdict.blocks[0].describe()
        );
        assert_eq!(verdict.blocks[0].holder_run, "run-a");
    }

    #[test]
    fn disjoint_seam_lanes_do_not_block_each_other() {
        let verdict = evaluate(
            "task-b",
            &["src-tauri/src/api.rs".to_string()],
            &[open("run-a", "task-a", &["src-tauri/src/store.rs"])],
        );
        assert!(verdict.is_clear(), "{:?}", verdict);
        // A package is never its own conflict.
        let own = evaluate(
            "task-a",
            &["src-tauri/src/store.rs".to_string()],
            &[open("run-a", "task-a", &["src-tauri/src/store.rs"])],
        );
        assert!(own.is_clear(), "{:?}", own);
    }

    #[test]
    fn an_overlapping_non_seam_path_warns_without_blocking() {
        let verdict = evaluate(
            "task-b",
            &["src-tauri/src/queue.rs".to_string()],
            &[open("run-a", "task-a", &["src-tauri/src/queue.rs"])],
        );
        assert!(verdict.blocks.is_empty(), "{:?}", verdict.blocks);
        assert_eq!(verdict.warnings.len(), 1);
        assert_eq!(
            verdict.warnings[0].kind,
            ConflictKind::Path("src-tauri/src/queue.rs".into())
        );
        // Nested paths overlap the same way.
        let nested = evaluate(
            "task-b",
            &["src/components/TerminalView.tsx".to_string()],
            &[open("run-a", "task-a", &["src/components"])],
        );
        assert!(nested.blocks.is_empty());
        assert_eq!(nested.warnings.len(), 1);
    }

    #[test]
    fn a_shared_seam_file_blocks_once_without_a_duplicate_warning() {
        let verdict = evaluate(
            "task-b",
            &["src-tauri/src/store.rs".to_string()],
            &[open(
                "run-a",
                "task-a",
                &["src-tauri/src/store/continuous.rs"],
            )],
        );
        assert_eq!(verdict.blocks.len(), 1);
        assert!(
            verdict.warnings.is_empty(),
            "the lane block already says it: {:?}",
            verdict.warnings
        );
    }

    /// Wave 2 of 2026-09-23 (docs/ERLEDIGT.md of the coordination repo; the
    /// file lists are the merge diffs of the named public PRs). Priorities
    /// encode the wave's dispatch readiness: base packages in their planned
    /// order, follow-ups after their bases, and W1-25b ahead of W1-16 because
    /// #82 was still a draft on the unmerged W1-25 branch when #85 was ready
    /// (.pa/report_w1-16.md: "Basis origin/claude/w1-25-sqlite-load").
    fn wave_two() -> Vec<PlannedPackage> {
        let pkg = |id: &str, priority: u32, files: &[&str], deps: &[&str]| PlannedPackage {
            id: id.into(),
            priority,
            files: files.iter().map(|f| f.to_string()).collect(),
            depends_on: deps.iter().map(|d| d.to_string()).collect(),
        };
        vec![
            // Merged as PR #72 (pty.rs lane).
            pkg("W1-03", 10, &["src-tauri/src/pty.rs"], &[]),
            // Merged as PR #79 (status.rs lane).
            pkg(
                "W1-23",
                20,
                &[
                    ".gitignore",
                    "docs/decisions.md",
                    "src-tauri/Cargo.lock",
                    "src-tauri/Cargo.toml",
                    "src-tauri/src/budget.rs",
                    "src-tauri/src/snapshots/projecta__budget__tests__budget_stop_reason_snapshot.snap",
                    "src-tauri/src/snapshots/projecta__budget__tests__settings_fold_snapshot.snap",
                    "src-tauri/src/snapshots/projecta__status__tests__format_tokens_snapshot.snap",
                    "src-tauri/src/status.rs",
                ],
                &[],
            ),
            // Merged as PR #74 (frontend).
            pkg(
                "W1-21",
                30,
                &[
                    "docs/decisions.md",
                    "package-lock.json",
                    "package.json",
                    "src/components/TerminalView.test.tsx",
                    "src/components/TerminalView.tsx",
                    "src/styles.css",
                    "src/test/tauriBrowserMock.ts",
                ],
                &[],
            ),
            // Merged as PR #77 (store lane).
            pkg(
                "W1-25",
                40,
                &[
                    "src-tauri/src/store.rs",
                    "src-tauri/src/store/continuous.rs",
                    "src-tauri/src/store/team_assignments.rs",
                    "src-tauri/src/workers.rs",
                ],
                &[],
            ),
            // Merged as PR #75 (ci scripts, lane-free).
            pkg(
                "W3-06",
                50,
                &[
                    ".github/workflows/ci.yml",
                    "docs/ci-lokal.md",
                    "scripts/ci/gates.sh",
                    "scripts/ci/native-tests.sh",
                    "scripts/test-gates.sh",
                ],
                &[],
            ),
            // Merged as PR #76 (pty.rs lane, mn seam).
            pkg(
                "W1-15",
                60,
                &[
                    "src-tauri/src/hooks.rs",
                    "src-tauri/src/main.rs",
                    "src-tauri/src/omniroute.rs",
                    "src-tauri/src/providers.rs",
                    "src-tauri/src/pty.rs",
                    "src-tauri/src/quota.rs",
                ],
                &[],
            ),
            // Merged as PR #73 (pa seam + redact.rs).
            pkg(
                "W1-26",
                70,
                &["src-tauri/src/bin/pa.rs", "src-tauri/src/redact.rs"],
                &[],
            ),
            // Merged as PR #78 (roles.rs + frontend).
            pkg(
                "W1-09",
                80,
                &[
                    "src-tauri/src/roles.rs",
                    "src/App.tsx",
                    "src/components/CommandChat.test.tsx",
                    "src/components/CommandChat.tsx",
                    "src/components/LearningsPanel.roles.test.tsx",
                    "src/components/LearningsPanel.tsx",
                    "src/lib/ipc.test.ts",
                    "src/lib/ipc.ts",
                ],
                &[],
            ),
            // Merged as PR #85 (store lane, direct continuation of W1-25).
            pkg(
                "W1-25b",
                90,
                &[
                    "src-tauri/src/store.rs",
                    "src-tauri/src/store/continuous.rs",
                    "src-tauri/src/store/development_budget.rs",
                    "src-tauri/src/store/development_capture.rs",
                    "src-tauri/src/store/development_delivery.rs",
                    "src-tauri/src/store/development_events.rs",
                    "src-tauri/src/store/development_launches.rs",
                    "src-tauri/src/store/development_runs.rs",
                    "src-tauri/src/store/discovery.rs",
                    "src-tauri/src/store/journal_watch.rs",
                    "src-tauri/src/store/native_completion.rs",
                    "src-tauri/src/store/supervisor.rs",
                    "src-tauri/src/store/team_assignments.rs",
                ],
                &["W1-25"],
            ),
            // Merged as PR #82 (store + api seams); its branch was based on
            // the unmerged W1-25 branch, hence the dependency.
            pkg(
                "W1-16",
                100,
                &[
                    "KNOWN_ISSUES.md",
                    "src-tauri/src/api.rs",
                    "src-tauri/src/queue.rs",
                    "src-tauri/src/store.rs",
                ],
                &["W1-25"],
            ),
            // Merged as PR #83 (status.rs lane).
            pkg(
                "W1-23b",
                110,
                &[
                    ".gitattributes",
                    "docs/decisions.md",
                    "src-tauri/src/budget.rs",
                    "src-tauri/src/snapshots/projecta__budget__tests__settings_fold_snapshot.snap",
                    "src-tauri/src/snapshots/projecta__status__tests__format_tokens_snapshot.snap",
                    "src-tauri/src/status.rs",
                ],
                &["W1-23"],
            ),
            // Merged as PR #87 (pty.rs + status.rs lanes).
            pkg(
                "W1-15b",
                120,
                &["src-tauri/src/pty.rs", "src-tauri/src/status.rs"],
                &["W1-15"],
            ),
            // Merged as PR #84 (redact.rs).
            pkg("W1-26b", 130, &["src-tauri/src/redact.rs"], &["W1-26"]),
            // Merged as PR #88 (pty.rs lane, mn seam).
            pkg(
                "W1-03cd",
                140,
                &[
                    "src-tauri/src/main.rs",
                    "src-tauri/src/pty.rs",
                    "src-tauri/src/submit_guard.rs",
                ],
                &["W1-03"],
            ),
            // Merged as PR #86 (frontend).
            pkg(
                "W1-21b",
                150,
                &[
                    "docs/decisions.md",
                    "package-lock.json",
                    "package.json",
                    "src/components/TerminalView.test.tsx",
                    "src/components/TerminalView.tsx",
                    "src/components/xtermFitCompat.test.ts",
                ],
                &["W1-21"],
            ),
        ]
    }

    /// The actual merge order of 2026-09-23, oldest first (docs/ERLEDIGT.md;
    /// merge SHAs  c26c6ab 6673cbf 45b6a19 0049256 649a655 84b869b c23e050
    /// b719cd9 394af7d a8027e3 5210804 a889f51 c178056 1186189 19b3d64).
    const WAVE_TWO_ACTUAL: [&str; 15] = [
        "W1-03", "W1-23", "W1-21", "W1-25", "W3-06", "W1-15", "W1-26", "W1-09", "W1-25b", "W1-16",
        "W1-23b", "W1-15b", "W1-26b", "W1-03cd", "W1-21b",
    ];

    #[test]
    fn wave_two_backcalculation_reproduces_the_merge_order() {
        // Fed in reverse readiness order: the predictor must recover the wave.
        let mut packages = wave_two();
        packages.reverse();
        let order = dispatch_order(&packages).unwrap();
        assert_eq!(order, WAVE_TWO_ACTUAL);
    }

    #[test]
    fn swapped_priorities_reserialize_the_store_lane() {
        // Mutation control: the constraint model, not the fixture, orders the
        // lanes. W1-16 ahead of W1-25b moves it ahead on the store lane.
        let mut packages = wave_two();
        for p in &mut packages {
            if p.id == "W1-16" {
                p.priority = 85;
            } else if p.id == "W1-25b" {
                p.priority = 105;
            }
        }
        let order = dispatch_order(&packages).unwrap();
        let pos = |id: &str| order.iter().position(|x| x == id).unwrap();
        assert!(pos("W1-25") < pos("W1-16"));
        assert!(pos("W1-16") < pos("W1-25b"));
        // The pty lane is untouched by the swap.
        assert!(pos("W1-03") < pos("W1-15"));
        assert!(pos("W1-15") < pos("W1-15b"));
        assert!(pos("W1-15b") < pos("W1-03cd"));
    }

    #[test]
    fn unknown_dependencies_and_conflict_cycles_are_errors() {
        let mut packages = wave_two();
        packages[0].depends_on = vec!["NOPE-1".into()];
        assert!(dispatch_order(&packages).is_err());
        // A dependency against the lane-serial order cannot be scheduled.
        let mut inverted = wave_two();
        for p in &mut inverted {
            if p.id == "W1-15" {
                // W1-03cd shares pty.rs and ranks behind W1-15: a cycle.
                p.depends_on = vec!["W1-03cd".into()];
            }
        }
        assert!(dispatch_order(&inverted).is_err());
    }

    #[test]
    fn the_guard_reads_the_wave_two_lanes_from_files() {
        // The runtime guard on the same real scopes: with W1-25 open, W1-16
        // (api.rs + queue.rs + store.rs) is refused on the st lane, while a
        // frontend package passes.
        let wave = wave_two();
        let files_of = |id: &str| wave.iter().find(|p| p.id == id).unwrap().files.clone();
        let w1_25_files = files_of("W1-25");
        let w1_25_refs: Vec<&str> = w1_25_files.iter().map(String::as_str).collect();
        let verdict = evaluate(
            "task-w1-16",
            &files_of("W1-16"),
            &[open("run-w1-25", "task-w1-25", &w1_25_refs)],
        );
        assert!(
            verdict
                .blocks
                .iter()
                .any(|c| c.kind == ConflictKind::Lane(Seam::Store)),
            "{:?}",
            verdict.blocks
        );
        let frontend = evaluate("task-w1-21", &files_of("W1-21"), &[]);
        assert!(frontend.is_clear(), "{:?}", frontend);
    }

    /// Insert goal, root policy and two claimed tasks with the given owned
    /// paths, then record one run intent per task. Mirrors the fixtures in
    /// workers.rs (raw SQL keeps the scope-lock admission out of the fixture).
    async fn store_with_two_runs(a_paths: &str, b_paths: &str) -> (TempDir, Store, String, String) {
        let dir = TempDir::new("lane-guard");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let project = store
            .create_project("lane-guard", &dir.path().to_string_lossy())
            .await
            .unwrap();
        let pool = sqlx::SqlitePool::connect(&format!(
            "sqlite:{}",
            dir.path().join("projecta.db").display()
        ))
        .await
        .unwrap();
        let policy =
            serde_json::to_string(&crate::development_policy::DevelopmentPolicy::defaults())
                .unwrap();
        sqlx::query("INSERT INTO continuous_goals(id, project_id, root_goal_id, objective, status, deadline_at, admitted, created_at, updated_at) VALUES('goal', ?, 'goal', 'goal', 'open', 9999999999, 1, 1, 1)")
            .bind(&project.id).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO continuous_root_policies(root_goal_id, policy_json, source, observed_at) VALUES('goal', ?, 'test', 1)")
            .bind(policy).execute(&pool).await.unwrap();
        for (id, paths) in [("task-a", a_paths), ("task-b", b_paths)] {
            sqlx::query("INSERT INTO continuous_tasks(id, goal_id, objective, owned_paths_json, dependencies_json, status, claim_owner, claim_fence, created_at, updated_at) VALUES(?, 'goal', 'task', ?, '[]', 'running', 'owner', 1, 1, 1)")
                .bind(id).bind(paths).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO continuous_projects(project_id, status, updated_at) VALUES(?, 'enabled', 1)")
            .bind(&project.id).execute(&pool).await.unwrap();
        pool.close().await;
        let run_a = store
            .record_development_run_intent("task-a", "owner", 1)
            .await
            .unwrap();
        let run_b = store
            .record_development_run_intent("task-b", "owner", 1)
            .await
            .unwrap();
        (dir, store, run_a.id, run_b.id)
    }

    #[tokio::test]
    async fn a_second_start_on_an_occupied_lane_is_refused_while_the_first_is_open() {
        let (_dir, store, _run_a, run_b) = store_with_two_runs(
            "[\"src-tauri/src/store/continuous.rs\"]",
            "[\"src-tauri/src/store/discovery.rs\"]",
        )
        .await;
        let run_b = store.get_development_run(&run_b).await.unwrap().unwrap();
        let error = refuse_lane_conflicts(&store, &run_b).await.unwrap_err();
        assert!(
            error.contains("lane guard") && error.contains("'st'"),
            "unexpected refusal text: {error}"
        );
        // The refusal happens before any launch reservation exists.
        assert!(store.development_launch(&run_b.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn the_guard_clears_once_the_holding_package_is_finished() {
        let (_dir, store, run_a, run_b) = store_with_two_runs(
            "[\"src-tauri/src/store/continuous.rs\"]",
            "[\"src-tauri/src/store/discovery.rs\"]",
        )
        .await;
        store
            .fail_development_run(&run_a, "owner", 1, "aborted")
            .await
            .unwrap();
        let run_b = store.get_development_run(&run_b).await.unwrap().unwrap();
        let warnings = refuse_lane_conflicts(&store, &run_b).await.unwrap();
        assert!(warnings.is_empty(), "{warnings:?}");
    }

    #[tokio::test]
    async fn a_disjoint_lane_start_passes_and_a_path_overlap_only_warns() {
        let (_dir, store, _run_a, run_b) = store_with_two_runs(
            "[\"src-tauri/src/queue.rs\"]",
            "[\"src-tauri/src/queue.rs\"]",
        )
        .await;
        let run_b = store.get_development_run(&run_b).await.unwrap().unwrap();
        let warnings = refuse_lane_conflicts(&store, &run_b).await.unwrap();
        assert_eq!(warnings.len(), 1, "{warnings:?}");
        assert_eq!(
            warnings[0].kind,
            ConflictKind::Path("src-tauri/src/queue.rs".into())
        );
    }
}
