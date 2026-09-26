# PR #24 (W5-02a) - review disposition, stage A

Candidate: `639a1d7` (single commit, +385/-37, over 300 lines, no seam file).
Author: Claude (Sonnet 5). Reviewers, neither of them a Claude model:

| Reviewer | Model | Transport | Raw answer |
|---|---|---|---|
| Kilo | `kilo/nvidia/nemotron-3-ultra-550b-a55b:free` | `kilo run`, prompt attached with `-f`, run in an empty scratch directory (read-only, no repository in reach) | `.pa/review_pr24_kilo.md` |
| Cerebras | `cerebras/gpt-oss-120b` | `opencode run`, prompt attached with `-f`, same scratch directory | `.pa/review_pr24_cerebras.md` |

Prompt: `.pa/review_prompt_pr24.md` (context, requirement, full
`git diff origin/main...HEAD`). Kimi and GLM (Ollama) were not used (weekly
limit). Both answers are stored unchanged. Ids: K = Kilo, C = Cerebras.

Every claim was checked against the code, not against the diff alone.

## Findings

| ID | Source | Sev | Finding | Disposition |
|---|---|---|---|---|
| K1 | Kilo | high | `canonicalize` follows symlinks, so a symlinked coordinator cwd passes and the agent walks out of it | **Rejected.** The OS resolves a symlink at `chdir`; the process's real cwd is the canonical path, which is what the guard tests. The directory is `<app data>/hooks-cwd/<id>`, not inside a checkout, and on unix `ensure_private_dir` refuses a symlink or non-directory at that path (`hooks.rs`, `symlink_metadata` check). Planting a link there needs the same OS user - the documented boundary (W5-02e). |
| K2 | Kilo | high | The worker row leaks when `spawn_bound` fails in `create_orchestrator` / `create_queen_as_role` | **Rejected, factually wrong.** The error arm does `take_session`, `remove_worker_files` **and** `store.delete_worker(&worker_id)` (`workers.rs`, create_orchestrator ~l.783; queen alike). The new `coordinator_cwd` error arm deletes the row and the files too. |
| K3 | Kilo | med | Guard misses "repo inside the coordinator cwd" | **Rejected.** The cwd is an empty directory this app creates under app data; a repository can only lie under it if the user put the project into `hooks-cwd/<id>`, and the `.git`-ancestor test of the cwd is about where a commit can be made from the cwd, not about what lies below it. Reading the repo by absolute path is allowed by design. |
| K4 | Kilo | med | Windows `\\?\` / UNC / junction handling of `canonicalize` | **Rejected.** `dir` and `repo` are both canonicalized, so `starts_with` compares like with like; `.git` existence checks work on `\\?\` paths. The unresolvable case is refused, not passed (tested: missing directory). Windows is the developer machine and the `a_coordinator_starts_outside_every_checkout_...` test runs there. |
| K5 / C3 | Kilo, Cerebras (both) | med / low | `for_coordinator` keeps `passthrough`, so a listed credential still reaches the coordinator | **Rejected, verified.** `passthrough` names variables the agent CLI needs to run at all (e.g. `MOONSHOT_API_KEY`); clearing it would break provider authentication of every coordinator, and the unit test pins that on purpose. The git-host tokens are removed *after* passthrough by `lock_credentials` (`STRICT_REMOVED`: `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `SSH_AUTH_SOCK`, ...), so strict wins over a passthrough entry for exactly the credentials that matter for push. A different credential the user lists deliberately is the documented "deliberate access" limit. |
| K6 | Kilo | med | `settings_dir()` might not be an app-data path | **Rejected.** `settings_dir()` is `app_data_dir()` (temp dir only as last resort, where `ensure_private_dir` refuses a directory that is not provably ours), and `coordinator_cwd` runs `ensure_outside_checkouts` on the result anyway. |
| K7 | Kilo | low | Error message shows the unresolved path | **Rejected.** The unresolved path is the only one available when `canonicalize` fails; the other refusal messages already print the resolved path. |
| K8 | Kilo | low | Test gaps: symlink, UNC, `.git` file, parent-directory case, empty-dir check | **Rejected** as a batch: symlink/UNC/parent cases are rejected above (K1, K3, K4). A `.git` *file* (linked worktree) is covered by `exists()` and by the worktree the fixture itself uses. Emptiness is not a safety property - the directory is the coordinator's own scratch space. |
| K9 | Kilo | low | The refusal test does not assert that no worker row was created | **Accepted.** Cheap and closes a real gap: the requirement is "refused before anything exists". Assertion added to `a_coordinator_role_run_is_refused_before_a_worktree_exists`; verified green: `cargo test --bin projecta workers::tests::a_coordinator` 3 passed, exit 0. |
| K10 | Kilo | low | Coordinator scope block is German only | **Rejected.** Both coordinator prompts are German by design (the user is German; "Du antwortest kurz und auf Deutsch"). |
| C1 | Cerebras | low | `coordinator_dir` does not create the parent of `<hooks>-cwd` | **Rejected.** `ensure_private_dir` starts with `create_dir_all(parent)` on unix and is `create_dir_all` on Windows. |
| C2 | Cerebras | low | Symlink guard bypass | Same as K1. |
| C4 | Cerebras | low | `ERR_REFUSED` might not compile | **Rejected.** It is the module's existing constant, used in the same file before this change; the candidate builds; `cargo test --bin projecta workers::` ran 180 passed, 0 failed (exit 0). |
| C5 | Cerebras | low | The `(profile, cwd)` tuple could use an uninitialised `cwd` | **Rejected.** Rust has no uninitialised use; `coordinator_dir` is resolved (and may return early) before the tuple is formed. |
| C6 | Cerebras | low | Pass `cwd.as_path()` instead of `&PathBuf` | **Rejected.** Style; deref coercion is the idiom used across this file. |
| C7 | Cerebras | low | Test might be flaky if the temp dir vanishes | **Rejected.** `TempDir` lives for the whole test; the "missing" path is a child that was never created. |
| C8 | Cerebras | low | Test does not assert `passthrough` is empty | **Rejected.** See K5: emptying it is not the intended behaviour. |

## Own observation while verifying (no change)

`respawn_worker` now calls `with_skills_flag(&profile, &cwd)` with the coordinator
directory. A coordinator's cwd holds no skills directory, so a respawned
coordinator on a flag-based CLI no longer gets `--skills-dir` pointing into the
repository. `create_orchestrator` / `create_queen_as_role` never added that flag,
so respawn now matches create; nothing installs skills for coordinators.

## Result

1 accepted (K9, test only), 16 rejected with reason, 0 follow-ups. No production
code changed by the review.
