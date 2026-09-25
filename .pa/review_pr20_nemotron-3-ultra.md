# Review: PR #20 — gitleaks secret scan as mandatory precommit gate

## High

**1. `.gitleaks.toml:25` — Allowlist regex `AKIACANARY[0-9A-Z]{10,12}` is too broad**  
Matches any alphanumeric suffix (36¹⁰–36¹² possibilities). A real AWS key `AKIA[0-9A-Z]{16}` that happens to contain `CANARY` at positions 5–10 (e.g., `AKIACANARYX1X2X3X4X5X6X7X8X9X0`) would be allowed. The test canaries use digits only (`AKIACANARY1234567890`, `AKIACANARY123456789012`). Fix: change to `AKIACANARY[0-9]{10,12}`.

## Medium

**2. `scripts/ci/doctor.sh:149` — Windows-only install hint for gitleaks**  
`urteil="BLOCKIERT (gitleaks fehlt: winget install Gitleaks.Gitleaks)"` omits macOS/Linux hints present in `secret-scan.sh:22-24` and `gates.sh:327-330`. A macOS/Linux developer running `doctor.sh` gets misleading guidance.

**3. `scripts/test-secret-scan.sh:108-110` — PATH filtering edge case with trailing colon**  
`printf '%s' "$PATH" | tr ':' '\n'` produces an empty line if PATH ends with `:`. The `while` loop then tests `[ ! -e "/gitleaks" ]` (root directory), potentially keeping `/` in the filtered PATH. Unlikely in practice but a correctness gap.

## Low

**4. `scripts/test-secret-scan.sh:58` — Test 1 accepts any non-zero exit for planted secret**  
`[ "$rc" -ne 0 ]` passes for exit 2 (gitleaks error) as well as exit 1 (finding). Should check `[ "$rc" -eq 1 ]` to distinguish detection from tool failure.

**5. `scripts/ci/secret-scan.sh:24` + `scripts/ci/gates.sh:327` — Duplicate install hints**  
When gitleaks is missing, `secret-scan.sh` prints a hint (stderr), then `gates.sh`'s `hint_for secrets` prints another (stdout). User sees two similar messages.

**6. `scripts/ci/secret-scan.sh:24` — `::error::` annotation in local hook**  
GitHub Actions annotation format (`::error::...`) emits raw text in local terminal. Harmless but confusing; intended for CI log parsing.

## No issues found

- Gate/lane wiring: `secrets` in `precommit`, `selftest-secrets` in `prepush` — matches requirement.
- `doctor.sh` marks both lanes `BLOCKED` when gitleaks missing — correct.
- Self-test covers all four required cases (planted secret, 13 canary values across 10 allowlist entries, empty index, missing gitleaks → exit 2).
- No silent fallback: missing gitleaks → exit 2 in both gate and self-test.
- CI lanes (`linux`, `windows`, `release`) do not include `secrets` — per requirement.
- Merge conflict resolution in `gates.sh` and `decisions.md` clean.
- Windows/Git-Bash portability: shebangs, `mktemp`, `trap`, `:`-separated PATH handling all correct for Git Bash.

## Summary

| Severity | Count |
|----------|-------|
| High     | 1     |
| Medium   | 2     |
| Low      | 3     |

The high-severity allowlist regex must be fixed before merge. Medium items should be addressed for consistency and robustness. Low items are polish.
