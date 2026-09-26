# Review: lic-01-delta2 — glm-5.2

- Autor des Artefakts: kimi-code lic-01 worker
- Reviewer: glm-5.2 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `glm-5.2:cloud`, bedient `glm-5.2`
- Datum: 2026-09-25 13:58 UTC, Dauer 119 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_lic-01-delta2.md` (10518 Zeichen)

## Roh-Urteil des Reviewers

## Review: LIC-01 Round 3 — SPDX precedence parser + shell hardening

I traced the recursive-descent parser through every class of input the review asked about: parenthesized precedence, WITH re-join, `*` stripping, short-circuit token consumption, malformed/empty inputs, and the shell probe hardening. The logic is sound and fail-closed on every path I could construct.

### Findings

**F1 — info — scripts/lib/license-check.mjs:55-73 — WITH re-join handles all boundary cases correctly**
The `WITH` re-join guards against every degenerate position: `tokens.length > 0` (WITH at start), `i + 1 < words.length` (WITH at end). In both cases WITH falls through to `tokens.push(words[i])` and is later rejected by `tokenAllowed` (no SPDX license id is "WITH") or by the `pos !== tokens.length` check. "MIT WITH" (trailing) tokenizes to `["MIT", "WITH"]`; MIT parses as primary but pos=1 ≠ 2, so the expression fails closed. "WITH" alone pushes WITH, which fails `tokenAllowed`. Verdict: correct.

**F2 — info — scripts/lib/license-check.mjs:78-94 — Short-circuit evaluation consumes all tokens**
The key risk with `&&`/`||` short-circuit is skipping `pos` advancement. Traced both: `value = parsePrimary() && value` — `parsePrimary()` is the *left* operand, always evaluated, always advances pos before returning. The right `value` is a variable read (no pos change). Same for `value = parseAnd() || value`. No token can be skipped. The final `pos === tokens.length` check is the backstop for any edge case where trailing tokens remain unconsumed (e.g., "MIT OR" → parsePrimary hits undefined → throw → false). Verdict: correct.

**F3 — pass — scripts/lib/license-check.mjs:74-76 — The smuggle regression is blocked**
"(MIT OR Apache-2.0) AND GPL-3.0-only" tokenizes to `["(", "MIT", "OR", "Apache-2.0", "AND", "GPL-3.0-only", ")"]`. Inside the paren, parseOr consumes "MIT OR Apache-2.0" (pos=4), then the paren handler checks `tokens[4]` which is "AND" ≠ ")" → throws "unbalanced parentheses" → caught → returns false. The expression fails closed. The valid counterpart "(MIT OR Apache-2.0) AND Zlib" tokenizes correctly (close-paren at the right position) and passes. Verdict: correct — this is exactly the Round 2 regression fixed.

**F4 — pass — scripts/lib/license-check.mjs:76 — `*` strip is scoped to the token tail only**
`tokenAllowed(token.replace(/\*$/, ""))` strips only a trailing `*` from the individual token. For WITH expressions like "Apache-2.0 WITH LLVM-exception*" (the `*` appended by license-checker to the whole expression), tokenize re-joins into one token, and the `*` is at the tail → stripped correctly. For "MIT*" → "MIT" → allowed. For "GPL-3.0-only*" → "GPL-3.0-only" → rejected. The `/\*/.test(expression)` warning fires regardless of position. Verdict: correct.

**F5 — pass — scripts/lib/license-check.mjs:117-120 — Empty array fail-closed works**
`info.licenses.length > 0 ? info.licenses : ["UNKNOWN"]` converts empty arrays to `["UNKNOWN"]`, which fails `tokenAllowed`. Missing/null licenses fall through to `info.licenses ?? "UNKNOWN"`. Both paths produce a violation. The test asserts `"arr-empty@1.0.0: UNKNOWN"` appears in violations. Verdict: correct.

**F6 — pass — scripts/lib/license-check.test.mjs:56-64 — Drift-test regex is now section-scoped**
The test now finds `[licenses]\n`, slices to the next `^\[` section (or EOF), and matches `allow = [...]` only within that slice. This prevents a false-positive match against an `allow` array in `[bans]` or `[advisories]`. Both missing-section and missing-array cases have `assert.ok` guards. Verdict: correct hardening.

**F7 — pass — scripts/ci/license-check.sh:12-28 — Shell probe + post-install re-verify**
The `|| true` on the probe is belt-and-suspenders (script runs without `set -e` per the comment), ensuring `installed` is set to empty string rather than propagating a non-zero exit from the subshell. The post-install re-verify catches PATH shadowing: if a different `cargo-deny` binary is found after `cargo install`, the script exits 1 instead of running an unverified tool. Verdict: correct.

**F8 — pass — No secrets present**
The diff contains only version pins, license identifiers, and parsing logic. No credentials, tokens, or internal URLs. Verdict: clean.

**F9 — pass — Red-first ordering**
The commit messages reference prior review findings (kimi-k3 F1/F8, glm-5.2 F1/F2/F3) and the test additions assert the regression cases (smuggle, empty array, inferred marker) as violations before the ok-cases. The three commits follow test → fix → chore ordering. Verdict: consistent with red-first process.

### Edge cases I explicitly verified (no findings, logged for completeness)

| Input | Tokenize | Parse result | Correct? |
|---|---|---|---|
| `""` | `[]` | `tokens.length === 0` → false | ✓ |
| `"()"` | `["(", ")"]` | parsePrimary "(" → parseOr → parsePrimary ")" → throw → false | ✓ |
| `"(MIT"` | `["(", "MIT"]` | paren handler: `tokens[2]` undefined ≠ ")" → throw → false | ✓ |
| `"MIT)"` | `["MIT", ")"]` | pos=1 ≠ 2 → false | ✓ |
| `"MIT OR"` | `["MIT", "OR"]` | parsePrimary undefined → throw → false | ✓ |
| `"OR AND"` | `["OR", "AND"]` | parsePrimary "OR" → throw → false | ✓ |
| `"((MIT))"` | nested parens | pos=5=length, value=true | ✓ |
| `"GPL-3.0-only AND (MIT OR Apache-2.0)"` | — | GPL fails AND → false | ✓ |
| `"MIT OR (GPL-3.0-only AND MIT)"` | — | MIT alternative → true | ✓ |
| `"Apache-2.0 WITH LLVM-exception"` | re-joined to 1 token | tokenAllowed check on full id | ✓ |

### Verdict: **approve**

The recursive-descent parser correctly implements SPDX precedence (AND tighter than OR, parentheses group), re-joins WITH expressions as single tokens, strips only trailing `*` markers, and fails closed on every malformed or incomplete input path. The short-circuit evaluation never skips token consumption because `parsePrimary`/`parseAnd` always advance `pos` as the left operand before the boolean operator can short-circuit. The `pos === tokens.length` post-check is an effective backstop. Empty license arrays, missing fields, and unbalanced parentheses all produce violations. Shell hardening (probe `|| true`, post-install re-verify) is correct. No secrets. Red-first ordering preserved.
