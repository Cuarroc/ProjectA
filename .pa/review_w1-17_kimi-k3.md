# Review w1-17 - kimi-k3

- Status: ok
- Reviewer: kimi-k3 (kind ollama)
- Model requested: kimi-k3:cloud
- Model reported: kimi-k3
- Author of the candidate: Claude Sonnet 5
- Prompt: .pa/review_prompt_w1-17.md (40426 chars, sha256 3979916aeaf5f696)
- Time: 2026-09-26T14:44:51Z

---

## Review W1-17 (commit ba6248c)

### Findings

**K1 — medium — scripts/lib/hq-pages.test.mjs, test "live snapshot lists the PLAN.md milestones with consistent progress" (~line 103)**

`assert.deepEqual(ids, ["M1", "M2", "M3", "M4"])` binds the test to the current content of docs/PLAN.md. This violates the repo rule "Tests must not depend on one revision of PLAN.md or STAND.md": as soon as PLAN.md gains an M5 (or a milestone is renumbered/split), this test fails although parser, generator and renderer are all correct. Notably, the same diff *removes* the revision-bound F-package tests ("live packages encode F3 → F1 and F2 (Rev 9)") for exactly this reason and then reintroduces the same pattern. The invariant block directly below (id/title/packages/done/total/state per milestone) already covers the contract without pinning the revision. Fix: drop the `deepEqual`, assert every id matches `/^M\d+$/` (and optionally that ids are unique/ordered).

**K2 — low — docs/dev-hq/hq.js `milestoneProgress` / `milestoneTable` (~lines 1285–1310): no escaping regression test**

The implementation is correct — I checked every interpolated value: `m.id`, `m.title`, `p.id`, `p.title`, `p.lane`, `p.stand` all go through `escape()`, including the `sectionTitle()` arguments (which the rules note are *not* escaped internally, so caller-escaping is mandatory and done). But no test pins this, unlike HQ-10/HQ-22 which assert escaping for the setup rows. A future refactor that drops one `escape()` around a PLAN.md-controlled string (title/stand flow into `innerHTML` via renderMap/renderNow) would be caught by nothing. A small JSDOM test feeding a title like `x <img src onerror=...>` through renderMap and asserting `querySelector("img") === null` would close the gap. PLAN.md author content is repo-controlled, hence low.

**K3 — low — scripts/lib/hq-parse.mjs `milestoneState` (~line 240)**

Two sharp edges in the state heuristic:
1. `/^PR #\d/` has no `i` flag: a Stand cell "pr #164" classifies as `open`, not `pr` (the sibling regexes use `i`; PLAN.md currently writes uppercase "PR", so no live impact).
2. The mixed-state fallback `/offen|PR #\d|in Arbeit/` matches substrings anywhere in a ✓-cell. A legitimately merged row like "✓ #171, Folge-PR #172" or "✓ #140 (Liste offener Nacharbeit)" flips to `in_progress`, silently undercounting `m.done`. The requirement explicitly leaves the Stand vocabulary open ("..."), so this will drift as new phrasings appear. Consider anchoring to cell structure (e.g. split on `,`/`;`, classify each token, case-insensitive) or at least word-boundary/`i` on the mixed regex.

**K4 — low — scripts/lib/hq-parse.mjs `parseMilestones` row-collection loop (~line 262)**

Every table with an `ID|…|Stand` header appearing anywhere between a `### M<n>` heading and the next `#{1,3}` heading is absorbed into that milestone — including a *second* table after prose within the same section (the fixture only tests the heading boundary, "X-1"). If PLAN.md ever adds a second such table inside one milestone section (e.g. a sub-package or "Nachzügler" table), its rows are silently merged into the milestone's packages and corrupt the x/y progress with non-package rows. The stated contract is "one table per milestone", so today this is robustness-only; a one-line guard ("only the first ID/Stand table per section", or a warning on a second) would make the assumption explicit. Related: `####`-level headings don't reset `current` (regex is `/^#{1,3}\s/`), same consequence, same low severity.

**K5 — low — snapshot schema: `data.packages` removed, consumers outside the diff unverifiable**

All in-diff readers were migrated (hq.js `summary`/`renderMap`, hq-live.mjs `analysis`, hq-stats.mjs `snapshotStats`, plus the `DATA.packages === undefined` regression guards — good). But the diff is HQ-internal; any other consumer of `docs/dev-hq/data.json` (the lane legend mentions `hqS` = docs/dev-hq/concepts/, and OPS-01's status-report.mjs) that reads `snapshot.packages` would now get `undefined` with no error. Please confirm explicitly that nothing outside this diff reads that key; if that's verified, no action needed.

### Non-findings (checked, fine)

- `parseMilestones` heading/reset/separator logic, lookbehind pipe-splitting and `\|` unescaping are correct and covered by the fixture (incl. prose-after-table and the later "### Reihenfolge" table being ignored). The red-first requirement is satisfied: the fixture test is `TypeError`-red against the old parser.
- `dev-hq.mjs` keeps `buildPackages` internally for `buildNext` gating, adds a warning instead of any exit path on missing milestones — matches the author's note and the "no hidden exit codes" rule.
- HQ_SKIP_SNAPSHOT untouched; all new tests run against tmp dirs or read data.json read-only.
- HQ-9/HQ-13 a11y rewrites and the TDZ guard (`MILESTONE_STATE` before dispatch) are consistent with the new markup.

### Verdict

**Approve with conditions.** Condition: fix K1 (it directly violates the repo's own test rule that this diff otherwise enforces). K2–K5 are optional hardening; K3 and K4 are worth at least a code comment so the next PLAN.md wording change doesn't silently corrupt the progress numbers.
