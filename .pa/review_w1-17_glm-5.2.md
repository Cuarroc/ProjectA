# Review w1-17 - glm-5.2

- Status: ok
- Reviewer: glm-5.2 (kind ollama)
- Model requested: glm-5.2:cloud
- Model reported: glm-5.2
- Author of the candidate: Claude Sonnet 5
- Prompt: .pa/review_prompt_w1-17.md (40426 chars, sha256 3979916aeaf5f696)
- Time: 2026-09-26T14:47:40Z

---

## Findings

### K1 — Test hardcodes exact milestone IDs, violating "no revision dependency"
**Severity: medium**
**File:** `scripts/lib/hq-pages.test.mjs:101`

```js
assert.deepEqual(ids, ["M1", "M2", "M3", "M4"]);
```

This asserts the snapshot contains exactly M1–M4 in that order. The rules state "Tests must not depend on one revision of PLAN.md or STAND.md." When PLAN.md gains an M5 or a milestone is renamed, this test breaks instead of verifying the structural contract. The removed test it replaced was explicitly "bound to the contract, not to one STAND revision." The fix: assert that every `m.id` matches `/^M\d+$/`, that IDs are strictly increasing, and that progress numbers are internally consistent — without pinning the exact set.

---

### K2 — `milestoneState` has no isolated unit test for edge cases
**Severity: low**
**File:** `scripts/lib/hq-parse.mjs:243–249` (`milestoneState`)

The function is only tested indirectly through `parseMilestones` with the `PLAN_FIXTURE`. Edge cases that are not covered by the fixture and could silently change behaviour:
- Empty string `""` → falls through to `return "open"` (correct, but untested).
- `"✓"` with no PR number → returns `"done"` (untested).
- `"✓ #140 (PR #160)"` → contains `✓` and `PR #\d` → `"in_progress"` (arguable; untested).
- `"PR #164 merged"` → matches `^PR #\d` → `"pr"` even though it says "merged" (potential false positive; untested).

A small parameterized test on `milestoneState` directly would pin the contract.

---

### K3 — Title cleaning strips backticks and `**` but not single `*` (italics)
**Severity: low**
**File:** `scripts/lib/hq-parse.mjs:271`

```js
title: (c[col("Paket")] ?? "").replace(/`|\*\*/g, ""),
```

If a future PLAN.md row uses `*italic text*` in the Paket column, the asterisks survive into the title and reach `escape()` / `innerHTML` as literal `*` characters. Not a security issue (they're escaped), but a data-quality gap. Consider `replace(/[`*]/g, "")` or a broader markdown-strip.

---

### K4 — Adjacent tables without a blank line would be merged into one milestone
**Severity: low**
**File:** `scripts/lib/hq-parse.mjs:266` (inner loop)

```js
for (let j = i + 2; j < lines.length && lines[j].startsWith("|"); j++) {
```

The inner loop consumes **all** consecutive `|`-prefixed lines, including a following table's header and separator rows. If two `| ID | Paket |…` tables were ever adjacent (no blank line between them — unusual but valid markdown), the second table's rows (and the stray `---` separator row) would be appended to the current milestone's `packages`. The `---` row would become a package with `id: "---"`. Not triggered by the current PLAN.md, but a latent robustness gap.

---

### K5 — No test verifies the rendered state labels or progress numbers in hq.js
**Severity: low**
**File:** `docs/dev-hq/hq.js` (`milestoneTable`, `milestoneProgress`)

The a11y test checks that `.signal-list li` elements exist with an `M\d` text, and that `.package-table` tables have 5 `th[scope="col"]` headers. But no test verifies that a package with `state: "done"` renders the label `"done"`, that `state: "pr"` renders `"PR open"`, or that the `done/total` fraction in `milestoneProgress` matches the data. A regression in `MILESTONE_STATE` mapping or the `m.done/m.total` interpolation would go unnoticed.

---

## Verdict

**Approve with conditions.**

The parser logic is sound, escaping is correct (all data-derived values go through `escape()`, `sectionTitle` callers escape their arguments, `cls`/`label` come from a fixed map), the red-first test exists and would fail on the old code, and the integration into `hq-live-lib.mjs` / `hq-stats.mjs` / `dev-hq.mjs` is consistent. The DAG removal is clean.

Condition: fix **K1** before merge — replace the hardcoded `["M1", "M2", "M3", "M4"]` assertion with a structural contract check (IDs match `/^M\d+$/`, are sorted, progress is consistent). K2–K5 are low-severity and can be addressed in a follow-up.
