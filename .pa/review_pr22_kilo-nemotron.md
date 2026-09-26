# Review: PR #22 (SETUP-08a+b) — Git/PR and Plan/Spec Helpers under `scripts/dev`

## Overall Assessment

**Strong implementation.** The nine helpers and shared plumbing are well-structured, thoroughly tested (real git repos in tmp for destructive ops, injected deps for pure logic), and the prior review findings (15+17) have been properly addressed with test-first fixes. No blocking issues found.

---

## Findings

### Medium

**1. `report-commit.mjs:1725` — Misleading error message for untracked HQ data**  
The check `hq.some(e => e.x !== " " && e.x !== "?")` throws `"ist gestaged"` (staged) for **both** staged files (index status ≠ space) **and** untracked files (index status = `?`). If the post-merge hook ever creates HQ files as untracked (new files), the error message incorrectly claims they're staged.  
*Impact:* Low — behavior is conservative (refuses), scenario unlikely. Fix: separate the two cases in the message.

**2. `prune-worktrees.mjs:1406–1408, 1484–1485` — Exit 0 on `gh` error masks partial functionality**  
When `gh pr list` fails, `planPrune` sets `ghError` but continues with only the "in main" check, and `main` exits 0 with a hint. The README documents this exception, but exit 0 on a degraded code path can mislead automation.  
*Impact:* Low-Medium — documented, but consider Exit 3 (REFUSED) with `--no-gh` implied, or at least a distinct exit code.

---

### Low

**3. `hygiene.mjs:946` — `prMatchesId` boundary regex excludes `_` and `.`**  
`[^a-z0-9-]` doesn't include `_` or `.`, which the ID regex (`/^[A-Za-z0-9][A-Za-z0-9 .,/()–-]*$/`) permits. An ID like `W1_05` in a title `"W1_05b feature"` could falsely match `W1_05`.  
*Mitigation:* Current IDs use hyphens; tests pass for prefix cases (`W1-05b` ≠ `W1-05`). Add `_` and `.` to boundary class for completeness.

**4. `prune-worktrees.mjs:1352–1357` — Symlink handling conservative (acknowledged in N6)**  
`makeNorm` uses `resolve()` not `realpathSync()`, so symlinked worktree paths may not match canonically. The review disposition accepts this: "Fehlrichtung ist konservativ (nichts wird entfernt), kein Datenverlust möglich". No action needed.

**5. `build-slot.mjs:546–551` — Windows process filter hardcoded**  
The WMI filter string lists seven process names. If new cargo-related tools appear (e.g., `cargo-machete`), they won't be detected until the list is updated. Low risk given current ecosystem.

**6. `spec-close.mjs:1925–1928` — Only first "Aktive Specs" section processed**  
`findIndex` takes the first match; multiple sections would only clear the first. Unlikely in practice (STAND.md has one).

**7. `dev-tools.mjs:3712–3721` — `ghJson` parses JSON even on non-zero exit**  
If `gh` exits non-zero but outputs valid JSON (e.g., GraphQL errors), it parses instead of throwing. Callers validate structure so they fail gracefully, but the error context is lost. Consider checking `r.code === 0` first.

---

## Verified Fixes from Prior Reviews

All 15 (08a) + 14 (08b) accepted findings are correctly implemented with tests:

| Finding | Fix Verified |
|---------|--------------|
| G2: `push-verified` detached HEAD crash | ✅ Sync `UsageError` before any `await` (L1586–1592) |
| G3: Windows filter missing `cargo-clippy.exe`/`build-script-build.exe` | ✅ Added to WMI filter (L546), test at L2114–2124 |
| G4/N3: Linux `comm` 15-char truncation | ✅ `isCargoProcessName` accepts 15-char prefixes (L399–405), test L2126–2136 |
| M2: Ignored files (`.env`) silently deleted | ✅ `--ignored=matching -uall` + allowlist (L1384–1392), tests L3038–3058 |
| M3: Build-slot freshness/unattributed logic | ✅ Freshness with process list (L478–479), unattributed counted in `busy` (L489–492), tests L2147–2160 |
| M4: `report-commit --merge` untracked files passed | ✅ Refuses **before** merge if any porcelain entry (L1763–1764), test L3420–3432 |
| M5: No timeout, credential helper hangs | ✅ `cleanEnv` sets `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`; per-call timeouts (push 15m, ls-remote 2m) map to exit 124 (L3664–3698, L1569–1572), tests L3801–3815 |
| N1: HQ backup lost silently | ✅ `mkdtempSync` backup, path logged (L1780–1788), test L3434–3452 |
| N4: `ci-watch` grace was poll-count not time | ✅ `graceMs` time-based (L666–678), test L2247–2253 (37 polls @ 5s/180s) |
| N5: `report-commit` cwd-relative `git add` | ✅ All git ops via `gitIn(run, top)` (L1751), test L3454–3459 |
| N6: `makeNorm` platform-dependent, untestable on Linux CI | ✅ `makeNorm(platform)` exported & injectable (L1349–1357), test L3117–3122 |
| K1: `erledigt-row` idempotency with multi-ID | ✅ Splits ID cell by comma, normalizes case (L812–816), tests L2419–2439 |
| K2: `hygiene` silent empty on missing inputs | ✅ `null` inputs → "Nicht geprüft", counts for `--strict` (L1039–1045), tests L2697–2727 |
| K3: Silent cwd fallback on `git rev-parse` failure | ✅ All three tools exit 3 with git error (L1079–1080, L1957–1959, L1139–1143), tests L2729–2734, L3627–3633 |
| K5: `MACHINE_BRANCH` prefix-matched too broadly | ✅ Exact regex `/^(?:main\|HEAD\|origin)$\|^(?:mergify\|gh-readonly-queue)\//` (L909), test L2682–2695 |
| K6: `gh pr list` limits silent truncation | ✅ Warning on stderr at 200/1000 (L1095–1096, L1275), tests L2736–2745, L2847–2858 |
| K9: `gh pr view --json files` 100-file limit | ✅ Warning on stderr, `--report` override (L855–857), test L2480–2489 |
| K10: `spec-close` dropped status suffix silently | ✅ Refuses `Status: <word> <suffix>` with Exit 3 (L1914–1915), test L3602–3607 |

The two refuted findings (G1: reflog timestamp, M1: stash per-worktree) are empirically validated by tests L3107–3115 and L3060–3071.

---

## Test Quality

**Excellent.** 358 tests total (`npm run test:hq` 358/358). Coverage includes:
- Real git repos in tmp for `prune-worktrees`, `push-verified`, `report-commit` (destructive ops)
- Injected runners/fake `gh` for pure logic (all other tools)
- Edge cases: stash, lock, detached, current dir, ignored files, fresh checkout, multi-ID rows, old link formats, non-ASCII filenames, gh limits, missing inputs, status suffixes, Windows path normalization
- CLI wiring: every `dev:*` script runs `--help` as subprocess, exits 0
- Drift guard: `pr-status` `REQUIRED` array tested against `.mergify.yml` and `ci.yml` (L2839–2845)

---

## Recommendations

1. **Fix the `report-commit` error message** (Medium #1) — distinguish staged vs untracked HQ data.
2. **Consider Exit 3 for `prune-worktrees` gh failure** (Medium #2) — or document the 0-exit exception more prominently in the tool's own `--help`.
3. **Add `_` and `.` to `prMatchesId` boundary** (Low #3) — one-line regex fix.
4. **Add `ghJson` exit-code check** (Low #7) — `if (r.code !== 0) throw ...` before JSON parse.

No changes required for merge; the code is production-ready with the documented caveats.
