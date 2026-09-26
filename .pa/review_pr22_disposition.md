# Disposition: review of PR #22 (SETUP-08a+b), stage B

- Candidate: `port/setup-08` at b9bc39e (+ the fixes listed below)
- Reviewer: Kilo, `kilo/nvidia/nemotron-3-ultra-550b-a55b:free`, read-only, one
  reviewer (author family: Kimi). Prompt: `.pa/review_prompt_pr22.md`; answer
  unchanged: `.pa/review_pr22_kilo-nemotron.md`.
- Result: 7 findings (2 medium, 5 low). 1 accepted, 6 rejected. The reviewer's
  own verdict: no blocking issue. Line numbers in the review refer to the prompt
  file, not the source files; each finding was checked against the source.

| # | Sev | Finding | Checked against the code | Disposition |
|---|---|---|---|---|
| 1 | medium | report-commit reports "gestaged" for untracked HQ data | Refuted: `hqResetPlan` tests `e.x !== " " && e.x !== "?"`; an untracked entry has `x === "?"` and never reaches that branch (untracked data files are handled as "others"/restorable, not as staged). | Rejected: misreading |
| 2 | medium | prune-worktrees exits 0 when `gh` fails | Confirmed as behavior: PR-state checks are skipped, only "contained in base" is used, so fewer worktrees qualify (conservative, no data loss). Documented in the README exit table; decided in the 08a disposition (N8a). | Rejected: documented, safe direction |
| 3 | low | `prMatchesId` boundary ignores `_` and `.` | `_` is not part of the ID grammar (`/^[A-Za-z0-9][A-Za-z0-9 .,/()–-]*$/`); no ID in PLAN/MASTERPLAN contains `.` or `_`; a trailing full stop in a title is a legitimate boundary. | Rejected: unreachable |
| 4 | low | symlinked worktree paths not canonicalised | Known limit, wrong direction is conservative (nothing removed); see 08a disposition N6. | Rejected: already dispositioned |
| 5 | low | Windows process filter is a fixed list | True, but it is the set of tools that hold a build (tests pin it); `cargo-machete` and similar do not touch the target dir. | Rejected: speculative |
| 6 | low | spec-close only clears the first "Aktive Specs" section | Same rule as `scripts/lib/active-specs.mjs` (first match), so both readers agree; the STAND.md format has one section. | Rejected: consistent with the reader |
| 7 | low | `ghJson` parses JSON although gh exited non-zero | Confirmed: `r.code !== 0` was tolerated when stdout began with `[` or `{`. No caller needs it (all use `pr list`/`pr view`, which exit 0 with JSON; ci-watch parses `pr checks` itself). AGENTS.md: never hide exit codes. | Accepted: red test `dev-tools.test.mjs` (1 fail, exit 1) -> fix, `npm run test:hq` 417/417, exit 0 |

## Found by CI, not by the reviewer

`gates (linux)` of the first PR run was red (run 36196498999): `selftest-lane-plan`
"echtes-repo .pa/report_ci-01.md: erwartet light". `report-commit.mjs` and
`erledigt-row.mjs` name the bare prefix `.pa/report_`; the lane plan's doc-literal
scan counted it as a read and made every report heavy. Fix: two `NOT_A_READ`
entries in `scripts/ci/lane-plan.sh` (path template / filename filter, no read of an
existing doc). `bash scripts/test-lane-plan.sh`: red exit 1 before, green exit 0 after.
