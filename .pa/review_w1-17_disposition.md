# Review disposition W1-17 (HQ parser reads the PLAN.md milestone tables)

Candidate reviewed: `ba6248c` (author: Claude Sonnet 5). Reviewers: kimi-k3 and
glm-5.2 via Ollama Cloud (`.pa/review_transport.py`, both exit 0). Raw answers:
`.pa/review_w1-17_kimi-k3.md`, `.pa/review_w1-17_glm-5.2.md`. Verdict of both:
approve with conditions (condition: K1). Fixes are in the commit that follows
the review commit; the delta is small (parser guards, three tests) and covered
by the tests named below.

| ID | Source | Severity | Finding | Disposition |
|---|---|---|---|---|
| K1 | kimi K1, glm K1 | medium | `hq-pages.test.mjs` pinned the snapshot to exactly `["M1","M2","M3","M4"]`, against the rule "tests must not depend on one revision of PLAN.md" | **Accepted.** Now asserts ids match `/^M\d+$/`, are unique and non-empty; the per-milestone invariants below it stay. |
| K2 | kimi K2, glm K5 | low | No test pins escaping of PLAN.md text in `milestoneTable` / `milestoneProgress`, nor the rendered state labels and `done/total` | **Accepted.** New test `W1-17: the milestone views escape PLAN.md text and label every state` in `hq-a11y.test.mjs` (hostile title/lane/stand, all four state labels, fraction on Map and Now). |
| K3a | kimi K3.1 | low | `/^PR #\d/` was case-sensitive | **Accepted.** `i` flag added; covered by the "pr #7" row of the new edge-case test. |
| K3b | kimi K3.2 | low | The mixed-state fallback matches `offen`/`PR #n`/`in Arbeit` as substrings inside a ✓ cell, so a phrasing like "✓ #171, Folge-PR #172" counts as in progress | **Partly accepted.** `offen` is now word-bounded and the match is case-insensitive. The remaining substring rule stays on purpose: PLAN.md defines the Stand vocabulary ("✓ #n = gemergt, sonst offener PR oder „offen“") and a merged row that names another open PR is rightly "in progress". Documented in the code comment of `milestoneState`. |
| K4a | kimi K4, glm K4 | low | A second/adjacent table with an ID/Stand header in the same section is absorbed; adjacent header and separator rows became pseudo-packages (`id: "---"`); `####` headings did not end a section | **Accepted.** Header and separator rows of an adjacent table are skipped, the outer loop resumes after the table (no double reading), `####` ends the milestone section. New test `parseMilestones: Stand edge cases, adjacent tables, #### headings`. Several tables in one section stay a deliberate feature (all belong to that milestone); noted in the doc comment. |
| K5a | kimi K5 | low | Other readers of `snapshot.packages` outside the diff? | **Verified, no change.** Checked `docs/dev-hq/concepts/`, `scripts/dev/`, `scripts/*.mjs`, `src/lib/`: the only other `.packages` is the Rust plan projection (`studio-roadmap.js`), not the HQ snapshot. |
| K2b | glm K2 | low | `milestoneState` has no isolated unit test for edge cases | **Accepted in part.** The empty cell, a bare "✓" and lower-case "pr #7" are asserted through `parseMilestones` in the edge-case test; `milestoneState` stays private. The ambiguous "✓ #140 (PR #160)" is deliberately not pinned (see K3b). |
| K3c | glm K3 | low | Title cleaning strips backticks and `**` but not a single `*` | **Rejected.** A lone `*` is meaningful in titles (globs such as `docs/*`); PLAN.md only uses backticks and `**` as markup. |
