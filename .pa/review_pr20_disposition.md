# Disposition: review stage B for PR #20 (branch port/sec-01)

Date: 2026-09-26. Candidate reviewed: `6e5c127` (diff without `.pa/`, 328 lines).
Reviewer: Nemotron 3 Ultra 550B (`kilo/nvidia/nemotron-3-ultra-550b-a55b:free`
via the Kilo CLI, read-only). Author: a Claude model, so the reviewer is a
different family. One reviewer, as ordered; the two stage A reviews of the
predecessor are in `.pa/review_sec-gitleaks_*.md`.
Prompt: `.pa/review_prompt_pr20.md`. Answer, unchanged:
`.pa/review_pr20_nemotron-3-ultra.md`. The reviewer had no tools beyond
reading the prompt; every finding below was checked against the code.

## Accepted

### N-1 (high): `.gitleaks.toml` allowlist `AKIACANARY[0-9A-Z]{10,12}` is too broad
Correct in substance. The regex is unanchored and applies to the matched
secret, so any AWS key that happens to contain `CANARY` followed by ten to
twelve letters/digits is waved through. All canaries in the repo
(`src-tauri/src/logging.rs:299`, `scripts/test-secret-scan.sh`) are digit-only,
so the letters are not needed. (The reviewer's example key has 30 characters
and is not a valid AWS key, but a 20-character `AKIACANARY` + 10 letters is.)
**Fix:** `AKIACANARY[0-9]{10,12}`.
**Red first:** case 1b in `scripts/test-secret-scan.sh` plants
`AKIA` + `CANARY` + `ABCDEFGHIJ` (assembled from pieces); before the fix the
self-test printed `FEHLER ... wurde von der Allowlist verschluckt (Exit 0,
erwartet 1)`, exit 1 (commit `91827cc`); after the fix all cases are ok,
exit 0.

### N-2 (medium): `doctor.sh` install hint names only winget
Correct: `secret-scan.sh` and `gates.sh` name winget, choco, brew and the Linux
page; the doctor verdict named winget only. **Fix:** the verdict now lists
winget, brew and the install page. Message text only, no test of its own
(covered by the doctor run below).

### N-4 (low): case 1 accepts any non-zero exit
Correct. With a gitleaks that always exits 2 the old case 1 printed
`ok Test-Geheimnis wird gefunden (Exit 2)`; a tool failure counted as a find.
**Fix:** case 1 requires exit 1. **Evidence (mutation):** stub `gitleaks`
exiting 2 first in PATH: old test file (`6e5c127`) `ok ... (Exit 2)` for
case 1, new file `FEHLER ... (Exit 2, erwartet 1)`.

## Rejected

### N-3 (medium): trailing colon in PATH gives an empty entry in case 4
The empty entry is tested as `/gitleaks`, which does not exist, so it stays in
the filtered PATH (an empty PATH element means the current directory). That
only matters if the current directory holds a `gitleaks` binary, and then the
positive control right after the filter (`kein gitleaks mehr auffindbar`)
turns the case red instead of green. The case cannot pass vacuously, which is
what the finding fears. No change.

### N-5 (low): two install hints when gitleaks is missing
`secret-scan.sh` must explain itself when run on its own (the self-test case 4
asserts exactly that); the hint in `gates.sh` (`hint_for`) is the runner's
existing convention for missing tools (see `rust-suite`/nextest). The hook
therefore prints both. Cosmetic; merging them would couple the script to the
runner. No change.

### N-6 (low): `::error::` in a local hook
`::error::` is the house style of the scripts in `scripts/ci/`
(`actions-pinned.sh`, `ci-shape.sh`, `gates.sh` print it locally as well as in
CI). No change.

## Notes from the check

- The reviewer's "no issues" list (gate/lane wiring, doctor lane verdicts,
  no silent fallback, conflict resolution) was not taken on trust; the
  `gates.sh --list`, doctor and `prepush` runs are in the PR report.
- `gitleaks dir .` over the whole worktree reports one finding in the ignored,
  untracked build output `src-tauri/target/debug/deps/libmuda-*.rmeta`
  (`generic-api-key`, compiled dependency). It is not in git and not part of
  any staged scan; the tracked tree is what the allowlist claim covers.
