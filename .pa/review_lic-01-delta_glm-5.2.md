# Review: lic-01-delta — glm-5.2

- Autor des Artefakts: kimi-code lic-01 worker
- Reviewer: glm-5.2 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `glm-5.2:cloud`, bedient `glm-5.2`
- Datum: 2026-09-25 13:46 UTC, Dauer 96 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_lic-01-delta.md` (7573 Zeichen)

## Roh-Urteil des Reviewers

## Review: LIC-01 delta (commits `7bc68ef` → `860be7e`)

### Summary

The diff implements the intended behavior for the common cases: OR/AND semantics, array licenses, `*` inference marker logging, tool pinning, and the deny.toml drift guard. Red-first ordering is correct — the test commit precedes the fix commit, and the OR and array tests would fail against the old `every()`-on-all-parts logic. No secrets are present. However, the parenthesis-flattening strategy introduces a narrow regression in fail-closed behavior compared to the old code.

---

### Findings

**F1 — Medium — `scripts/lib/license-check.mjs:42` (parenthesis flattening creates a new smuggling vector)**

The old code split on both `OR` and `AND` with a single regex and required `every()` part to be allowed — overly strict, but fail-closed for parenthesized expressions. The new code flattens parentheses (`replace(/[()]/g, " ")`) and then splits on `OR` first, so a parenthesized AND expression like:

```
(MIT OR Apache-2.0) AND GPL-3.0-only
```

flattens to `MIT OR Apache-2.0 AND GPL-3.0-only`, splits on OR into `["MIT", "Apache-2.0 AND GPL-3.0-only"]`, and the first alternative (`MIT`) passes via `some()` — accepting a package that, under correct SPDX semantics, should be **rejected** because `GPL-3.0-only` is a mandatory conjunct.

The old code would have rejected this (by accident, via its blanket `every()`). The new code accepts it. That is a new smuggling path.

*Mitigation options:* either (a) do a structural SPDX parse (a small recursive-descent parser is ~40 lines and removes the caveat entirely), or (b) at minimum, detect any `(` or `)` in the input expression and fail-closed (push a violation) with a "complex expression, review manually" message, preserving the old code's conservatism for that case while still handling the common flat OR/AND expressions correctly.

**F2 — Low — `scripts/lib/license-check.mjs:65` (empty-array `licenses` passes silently)**

```js
const expressions = Array.isArray(info.licenses) ? info.licenses : [info.licenses ?? "UNKNOWN"];
```

If `info.licenses` is `[]` (empty array), `expressions` is `[]`, the `for` loop body never executes, and no violation is pushed. This is not strictly fail-closed. In practice `license-checker-rseidelsohn` does not emit empty arrays (it reports `undefined` → `"UNKNOWN"`), so the risk is theoretical, but the guard is cheap:

```js
const expressions = Array.isArray(info.licenses) && info.licenses.length > 0
  ? info.licenses
  : [info.licenses ?? "UNKNOWN"];
```

or simply prepend a check: if `Array.isArray(info.licenses) && info.licenses.length === 0`, push a violation.

**F3 — Informational — `scripts/ci/license-check.sh:12` (cargo-deny version extraction assumes output format)**

```sh
installed="$(cargo deny --version 2>/dev/null | awk '{print $NF}')"
```

This relies on `cargo deny --version` printing `cargo-deny <version>` with the version as the last whitespace-delimited field. If a future cargo-deny version changes the output format (e.g., appends a git hash), `$NF` could capture the wrong token, triggering a spurious reinstall on every CI run. Not a correctness issue (the reinstall is still pinned to `$DENY_VERSION`), but worth a comment noting the assumption. The fail-closed property holds: if extraction fails, `installed` is empty, `"" != "0.20.2"` is true, and the pinned version is installed.

---

### What is correct

- **OR/AND semantics:** `some()` for OR alternatives, `every()` for AND conjuncts — matches cargo-deny parity for flat expressions. ✓
- **Array licenses:** evaluated element-wise with a conservative "every entry must pass" policy. ✓
- **`*` inference marker:** detected via `/\*/.test(cleaned)`, logged to stderr with package name and original expression, stripped from tokens before lookup. A token like `"DISALLOWED*"` still resolves to `"DISALLOWED"` which is not in the allowlist — no smuggling via the `*` strip. ✓
- **Tool pinning:** cargo-deny reinstall-on-mismatch and `license-checker-rseidelsohn@5.0.1` via npx. ✓
- **Drift test:** regex extracts `allow = [...]` from deny.toml, parses quoted SPDX IDs, and `deepEqual` against `ALLOWED_LICENSES` (order-sensitive, which is appropriately strict for a drift guard). ✓
- **Red-first ordering:** test commit `7bc68ef` precedes fix commit `860be7e`. The OR test (`"MIT OR GPL-3.0-only"` expects no violation) and the array test (`["MIT", "Apache-2.0"]` expects no violation) both fail against the old `every()`-on-split logic. ✓
- **No secrets.** ✓

---

### Verdict: **approve with conditions**

The core intended behavior is correctly implemented and the common cases are solid. Condition: address **F1** before merge — either parse parenthesized SPDX expressions properly or fail-closed when parentheses are detected, to restore the old code's conservatism for that edge case and eliminate the smuggling regression. **F2** is recommended but not blocking.
