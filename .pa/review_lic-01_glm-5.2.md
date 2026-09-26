# Review: lic-01 — glm-5.2

- Autor des Artefakts: kimi-code lic-01 worker
- Reviewer: glm-5.2 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `glm-5.2:cloud`, bedient `glm-5.2`
- Datum: 2026-09-25 13:23 UTC, Dauer 115 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_lic-01.md` (18337 Zeichen)

## Roh-Urteil des Reviewers

## Findings

### F1 — high — `scripts/lib/license-check.mjs:34`

**Reasoning:** `licenseAllowed` splits SPDX expressions on both `OR` and `AND`, then applies `.every()` — requiring *every* alternative to be on the allowlist regardless of operator. For an `OR` expression like `MIT OR GPL-3.0-only`, only one alternative needs to be allowed (the consumer can choose MIT), but the code rejects it because `GPL-3.0-only` is not in the set. This directly contradicts `docs/THIRD_PARTY_NOTICES.md`, which states: *"crates under an `OR` expression appear under every alternative, but only one needs to be on the allowlist for the gate to pass."* The test suite does not cover this case — every `OR` expression in the tests has both alternatives on the allowlist, so the bug is masked. When a future npm dependency carries `MIT OR GPL-3.0-only`, the gate will falsely reject it, potentially pressuring a developer into making a wrong license decision (e.g., adding GPL to the allowlist) or dropping an acceptable dependency.

**Fix:** Split `OR` and `AND` separately. For `OR`, use `.some()` (any alternative on the list suffices). For `AND`, use `.every()` (all conjuncts must be on the list). Add a test case: `MIT OR GPL-3.0-only` → no violation; `MIT AND GPL-3.0-only` → violation.

---

### F2 — medium — commit 2 (`test(lic-01)…`)

**Reasoning:** The red-first rule requires the test to be red on the base and green on the head. Commit 2 introduces both `license-check.mjs` (implementation) and `license-check.test.mjs` (test) in the same commit. On the base (c60f267) the test file does not exist, so it is absent rather than red — there is no commit where the test exists and fails. The test should have been introduced first (or in a separate commit that fails), demonstrating the red state before the implementation lands.

---

### F3 — low — `scripts/lib/license-check.mjs:42`

**Reasoning:** `String(info.licenses ?? "UNKNOWN")` assumes `licenses` is always a string. Some `license-checker-rseidelsohn` outputs can produce an array (e.g., `["MIT", "Apache-2.0"]`), which `String([...])` serialises as `"MIT,Apache-2.0"`. This would not split on `OR`/`AND` and would fail to match any allowlist entry, producing a false violation. Not triggered by the current 14-package tree, but worth guarding with an `Array.isArray` check.

---

### Items checked and passed

| Check | Result |
|---|---|
| Exec bits on shell scripts | All shell scripts in `scripts/ci/`, `scripts/`, `.githooks/` changed to 100755. `license-check.sh` is 100755. Node modules (`license-check.mjs`, `.test.mjs`) and `deny.toml` are 100644 — correct (not shell scripts). |
| Gate can fail | `licenses` gate added to `GATES[]` in `gates.sh`. `license-check.sh` propagates failures via `fails=1` and `exit "$fails"`. cargo-deny currently fails on `webpki-root-certs` (CDLA-Permissive-2.0), so the gate is genuinely red. |
| Findings visible, not hidden | `webpki-root-certs` CDLA-Permissive-2.0 is deliberately left red and documented in `THIRD_PARTY_NOTICES.md` as a "Needs decision" finding — not silently excepted. `deny.toml` does not include CDLA-Permissive-2.0. |
| Allowlist consistency | `deny.toml`, `license-check.mjs ALLOWED_LICENSES`, and the test's expected list all match the user-approved allowlist (14 entries + OFL-1.1). Verified by the allowlist test. |
| No secrets / personal data | No API keys, tokens, or credentials in any committed file. Copyright holder names in `THIRD_PARTY_NOTICES.md` are required attribution, not sensitive personal data. |
| `deny.toml` private ignore | `[licenses.private] ignore = true` correctly skips the workspace's own unlicensed crate, which is a separate LIC-01 decision item. |
| Rustfmt drift repair | `skills.rs` change is a cosmetic rustfmt reformat of an `assert!` macro call — no logic change. |

---

## Verdict: **approve with conditions**

1. **F1 must be fixed before merge.** The `OR`/`AND` logic in `licenseAllowed` is incorrect for disjunctive licenses and contradicts the project's own notices. Fix the evaluator and add a test case for `MIT OR GPL-3.0-only` (should pass) and `MIT AND GPL-3.0-only` (should fail).
2. **F2 (red-first)** is a process note — acceptable if the team's convention allows co-commits, but the explicit rule asks for red-first. Consider splitting test and implementation into separate commits in future iterations.
3. **F3** is a nice-to-have guard; not blocking.
4. The `webpki-root-certs` / CDLA-Permissive-2.0 finding is correctly surfaced as a visible, non-hidden "Needs decision" item — no action needed in this PR.
