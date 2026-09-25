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
