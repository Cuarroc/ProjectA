# Review disposition W1-18b (OpenCode skills discovery)

Candidate: branch `port/w1-18b`, head `de57a41` (3 commits on `main` fdcba59:
red tests, fix, docs). Author: Claude Sonnet 5. Reviewers: Kimi K3
(`.pa/review_w1-18b_kimi-k3.md`, verdict: approve with conditions) and GLM 5.2
(`.pa/review_w1-18b_glm-5.2.md`, verdict: approve), both via
`.pa/review_transport.py`, different vendors than the author. The diff is about
260 lines and touches no seam, so one reviewer would suffice; two ran.

| ID | Source | Severity | Finding | Disposition |
|---|---|---|---|---|
| P-1 | kimi-k3 (glm-5.2 #1, info) | minor | The `opencode-glm-53-flash` profile is lifted by inference; only the bare `opencode debug skill --pure` was probed, not the `-m` variant. | Accepted (option b). The test comment in `profiles.rs` now names it an assumption (`--pure` makes no model call). Re-probing the exact argument list is left as a follow-up. |
| P-2 | kimi-k3 (glm-5.2 #3, info) | minor | The mirror test parses `capabilities.rs` with a regex/brace walk; a rustfmt restyle or an odd doc comment could break it. | Accepted as advisory, no change. It fails loudly, never silently passes, and a self-check proves the comparison trips on drift. |
| P-3 | kimi-k3 | info | `import.meta.dirname` needs Node 20.11 or newer. | No change needed: the repo requires Node 24 or newer (`AGENTS.md`). |
| P-4 | kimi-k3 | info | "liest OpenCode" in `docs/setup/README.md` reads stronger than the observed discovery. | Accepted: now "findet OpenCode ... ebenfalls". |
| G-2, G-4 | glm-5.2 | info | Positive notes (drift self-check, Codex wording). | No action. |

Result: no blocker; the one condition (P-1) is met by the wording change in the
docs commit that follows the review.

## Stage B (head `ebd96f2`, one reviewer)

Reviewer: Nemotron 3 Ultra 550B (`kilo/nvidia/nemotron-3-ultra-550b-a55b:free`,
Kilo CLI, read-only, free model), a different vendor than the author. Prompt:
`.pa/review_prompt_pr30.md`; answer stored unchanged in
`.pa/review_pr30_nemotron-3-ultra.md`. Verdict: freigeben mit Auflagen. The
`file:line` references in the answer do not match the files (e.g.
`hq-profile-contract.test.mjs` has 106 lines, cited `:177`; `opencode.md` has 44
lines, cited `:94-98`), so each finding was checked against the actual text.
No code change results, so no red test is due.

| ID | Source | Severity | Finding | Disposition |
|---|---|---|---|---|
| N-1 | nemotron | minor | The glm variant inherits `ConventionAt` by assumption; re-probe later and revert to `Unsupported` if negative. | Already handled by P-1: the assumption is named in the test comment (`profiles.rs` ~l.520) and in the PR text. Follow-up stays: probe `opencode -m opencode-go/glm-5.3-flash debug skill --pure`; on a negative result revert that profile. No change now. |
| N-2 | nemotron | minor | The mirror test evaluates the validator's mode table with `new Function()`. | Rejected. Test-only code; the input is a slice of a tracked repo file, never external data. The table is an inline literal inside `validateStoredProfile`, so it cannot be imported without changing production code for a test's sake. |
| N-3 | nemotron | info | The docs cite the PR text as evidence rather than an artifact in the repo. | Accepted as is, no change. Verified: the PR text has a "Beleg (Probe 2026-09-25)" section with tool version, command, exit code and what is not claimed; `.pa/evidence_*.json` is gitignored, as the PR text states. |

Result: no blocker, no new condition beyond the existing P-1 follow-up.
