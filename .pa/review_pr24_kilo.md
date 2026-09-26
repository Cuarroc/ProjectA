# Review of PR #24 (W5-02a): Coordinators Run Without a Write Path

## Summary
The implementation broadly satisfies the four requirements, but there are **two high-severity correctness bugs**, several medium-severity gaps in the filesystem guard, and test coverage gaps.

---

## High Severity

### 1. Symlink bypass in `ensure_outside_checkouts` — `src-tauri/src/workers.rs:278-304`
`std::fs::canonicalize` follows symlinks. A coordinator cwd that is a **symlink inside a checkout pointing outside** passes the check (resolved path is outside), but the process runs with cwd = the symlink path *inside* the checkout. The agent can then use relative paths (`cd ../..`) to reach the repository.

```rust
// Current code resolves symlinks, then checks the resolved path
let resolved = std::fs::canonicalize(dir)?;
// If dir = /checkout/symlink -> /outside, resolved = /outside → ALLOWED
// But the process's $PWD is /checkout/symlink
```

**Fix**: Also check the *original* (unresolved) path's ancestors for `.git`, or reject symlinks entirely for coordinator cwds.

### 2. Worker row leak on spawn failure — `src-tauri/src/workers.rs:209-211` and `244-246`
In both `create_orchestrator` and `create_queen_as_role`, if `spawn_bound` fails after the worker row was created, only the session is cleaned up:

```rust
Err(err) => {
    let _ = store.take_session(&worker_id);  // worker row NOT deleted
    return Err(err);
}
```

The worker row remains in the database with `status = RUNNING` but no session. This leaks state and blocks future spawns for that worker_id.

---

## Medium Severity

### 3. Missing check: repo inside coordinator cwd — `workers.rs:285-292`
`ensure_outside_checkouts` checks `resolved.starts_with(&repo)` (dir inside repo) but **not** `repo.starts_with(&resolved)` (repo inside dir). If coordinator cwd = `/home/user` and repo = `/home/user/project`, the check passes but the repo is a subdirectory of the cwd. The coordinator can `cd project && git commit`.

### 4. Windows path handling risks — `workers.rs:279`
`std::fs::canonicalize` on Windows has known issues with:
- UNC paths (`\\server\share`)
- Extended-length paths (`\\?\C:\very\long\path`)
- Junction points / reparse points
A coordinator cwd on such a path may error incorrectly or (worse) pass incorrectly.

### 5. `for_coordinator()` preserves `passthrough` env vars — `profiles.rs:118-122`
```rust
pub fn for_coordinator(&self) -> AgentProfile {
    let mut profile = self.clone();
    profile.env_policy.isolation = EnvIsolation::Strict;
    profile  // passthrough is NOT cleared
}
```
If a profile has `passthrough: ["GITHUB_TOKEN"]`, the coordinator still receives it. The requirement states "no token, no credential helper, no ssh". Either `Strict` isolation must block passthrough for sensitive vars, or `for_coordinator` should clear `passthrough`.

### 6. `coordinator_dir` depends on `settings_dir()` — `hooks.rs:88-98`
The comment says "next to the hooks directory" but `settings_dir()` may not be the hooks directory. If `settings_dir()` returns a path inside the repository (unlikely but possible), the "by construction outside" claim fails. Verify `settings_dir()` returns an app-data path.

### 7. Error message shows original path, not resolved — `workers.rs:280-283`
```rust
format!("{ERR_REFUSED}coordinator directory {} cannot be resolved: {e}", dir.display())
```
If `dir` is a symlink, the user sees the symlink path, not the resolved target. Use `resolved.display()` in error messages.

---

## Low Severity / Test Gaps

### 8. Test coverage missing for `ensure_outside_checkouts` — `workers.rs:523-539`
The test `a_coordinator_directory_inside_a_checkout_is_refused` does not cover:
- Symlink inside checkout → outside (bypass)
- Symlink outside → inside checkout
- `.git` **file** (linked worktree) — though `exists()` catches both
- Repo inside coordinator cwd (parent directory case)
- Windows UNC / `\\?\` paths
- Empty directory verification (requirement: "empty private directory")

### 9. Continuous refusal test doesn't verify worker row — `workers.rs:570-612`
`a_coordinator_role_run_is_refused_before_a_worktree_exists` checks `spawn_count() == 0` and no worktrees dir, but **does not assert** that no worker row was inserted in the database.

### 10. Prompt text is German-only — `workers.rs:319-328`
`coordinator_scope_block` returns hardcoded German. The codebase appears German-localized (orchestrator prompt is also German), so this may be intentional. Confirm this matches product language strategy.

---

## What's Correct

- ✅ Strict isolation applied to **routed** profile (failover-safe) in `create_orchestrator`, `create_queen_as_role`, `respawn_worker`
- ✅ Coordinator cwd is `<app data>/hooks-cwd/<worker_id>` created via `ensure_private_dir`
- ✅ `ensure_outside_checkouts` validates on create and respawn
- ✅ Continuous coordinator run refused early in `create_worker_impl` before worktree creation
- ✅ Orchestrator prompt no longer instructs MEMORY.md append (lines 1355-1358 removed)
- ✅ Both coordinator prompts include `coordinator_scope_block` with repo path and "KEIN Schreibpfad"
- ✅ Respawn ordering fixed: validation before destructive operations (kill session, remove files)
- ✅ Non-coordinator workers unaffected (test `an_ordinary_worker_keeps_its_checkout_and_environment`)

---

## Recommendations

1. **Fix symlink bypass**: Check both original and resolved paths, or reject symlinks for coordinator cwds.
2. **Clean up worker row on spawn failure** in `create_orchestrator` and `create_queen_as_role`.
3. **Add `repo.starts_with(&resolved)` check** in `ensure_outside_checkouts`.
4. **Clear `passthrough` in `for_coordinator()`** or document that `Strict` isolation blocks sensitive vars regardless.
5. **Add test cases** for symlinks, Windows paths, linked worktrees (`.git` file), parent-directory case, and empty-dir verification.
6. **Verify `settings_dir()` contract** in `hooks.rs`.
