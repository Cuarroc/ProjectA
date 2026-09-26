# Review: lic-01-delta2 — kimi-k3

- Autor des Artefakts: kimi-code lic-01 worker
- Reviewer: kimi-k3 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `kimi-k3:cloud`, bedient `kimi-k3`
- Datum: 2026-09-25 13:55 UTC, Dauer 218 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_lic-01-delta2.md` (10518 Zeichen)

## Roh-Urteil des Reviewers

# Delta Review LIC-01 Round 3 — SPDX Precedence Parser + Shell Hardening

## Core question: can a disallowed license still slip through?

I hand-traced the parser against the attack surface (npm-controlled license strings). Key paths:

**Precedence + grouping.** `(MIT OR Apache-2.0) AND GPL-3.0-only`: parsePrimary enters the group → parseOr returns true → `)` consumed → parseAnd's loop hits AND → parsePrimary(GPL) = false → `false && true` = false. Violation. The round-2 flattening bug is genuinely closed.

**Short-circuit safety.** Both loops evaluate the operand *first*:
```js
value = parsePrimary() && value;   // parsePrimary always runs
value = parseAnd() || value;       // parseAnd always runs
```
All tokens are consumed even when the accumulator is already false/true, and a throw mid-expression escapes to the `catch → return false`. Even hypothetically with reversed operand order, the `pos === tokens.length && value` return condition is a second fail-closed backstop (unconsumed tail ⇒ false). Double-locked. ✓

**WITH re-join abuse.** The merge extends the *previous* token, and four cases all fail closed:
- `MIT WITH` (trailing): `/^WITH$/i` not joined (`i+1 < words.length` fails) → `WITH` becomes a bare token → pos misalignment → false.
- `WITH X` (leading): `tokens.length === 0` guard → `WITH` treated as unknown license id → false.
- Merge into an operator/paren (`MIT OR WITH X`, `(Apache-2.0) WITH LLVM-exception`): produces tokens like `OR WITH X` / `) WITH X` that match neither operator nor `)` → misalignment or throw → false.
- Merge into a license id (`Apache-2.0 WITH GPL-3.0-only`): the merged token is checked *wholesale* against the allowlist → not present → false. The disallowed id can only ride along on an OR alternative the licensee may decline (choice semantics, same as cargo-deny) — it can never become a *mandatory* accepted conjunct. ✓

**`*` strip.** Only one trailing `*` stripped; `MIT*` → MIT (allowed, correct); `GPL-3.0-only*` → stripped → disallowed → violation; `MIT *` (detached) → bare `*` token strips to `""` → not allowlisted → pos mismatch → false; `**` → residual `*` → false. The marker never upgrades a verdict. ✓

**Fail-closed paths.** Traced: `""`, `[]` → UNKNOWN violation; `undefined`/`null`/number licenses → UNKNOWN/stringified → violation; `MIT)`, `MIT OR`, `OR MIT`, `(MIT`, `()`, `MIT (X11)` → throw or pos mismatch → false; deep nesting → RangeError caught by try/catch (and even uncaught would crash the gate red). ✓

## Findings

**F1 — low** — `scripts/lib/license-check.mjs:~49-64` (tokenize)
The re-joined WITH token gets zero exception-id validation, so technically-malformed SPDX like `Apache-2.0 WITH GPL-3.0-only OR MIT` *passes* (via the MIT alternative), while cargo-deny rejects it as an unknown exception — the two gate halves diverge. Not exploitable into accepting a mandatory disallowed license (the allowlist constrains merged tokens; OR is legitimate choice semantics), but the block comment "malformed input fails closed" overclaims. Recommendation: validate the exception part against a pattern/known list, or soften the comment.

**F2 — low** — `scripts/lib/license-check.test.mjs:~60-65` (deny.toml mirror)
`toml.indexOf("[licenses]\n")` misses CRLF files and `[licenses] # comment` on one line; a `# [licenses]` comment line preceding the real section could anchor the slice early. All failure modes are **fail-loud** (assert fires, test goes red), so this is brittle-but-safe. Consider `/^\[licenses\]\s*$/m` for resilience.

**F3 — nit** — `scripts/lib/license-check.test.mjs`
The new tests pin precedence, empty arrays, WITH grouping, and `*` — but the fail-closed *malformed-input* contract (trailing `AND`/`OR`, unbalanced `(`, `()`, empty string) is verified only by my trace, not by a pinned test. One table-driven test over malformed strings expecting violations would lock F1's claim and catch future parser refactors.

**F4 — nit** — `scripts/lib/license-check.mjs:~67-69`
Raw expression is echoed to stderr in the `*` warning and into violation strings; package metadata with newlines could forge log lines. Local tooling, low impact — note only.

## Red-first ordering & secrets

- Order confirmed: `3e2bec0` (tests) precedes `55f89db` (fix). Verified the new tests are genuinely red under the old parser: flattening `(MIT OR Apache-2.0) AND GPL-3.0-only` passes via the MIT alternative (old code) vs. expected violation (new test) ✓; empty array produced zero iterations → no violation (old) vs. expected violation (new) ✓. The `with-exc`/`grouped-with`/`inferred-ok` cases are characterization pins, not red-first — acceptable.
- Shell hardening (`3- d522d66`): `|| true` is redundant-but-harmless (awk masks cargo's exit code either way; the *signal* is the empty `installed` string, which correctly routes to install). Post-install re-verify correctly fails loud on a PATH-shadowing binary instead of silently trusting it. No `set -e`-related hazard introduced.
- No secrets, credentials, or URLs anywhere in the delta. Pinned version + `--locked` retained.

## Verdict

**Approve.** The recursive-descent parser is sound under adversarial trace — no precedence, WITH, `*`, short-circuit, or fail-open path found that admits a disallowed license. F1–F4 are low/nit hardening suggestions, none blocking. The intentional red on webpki-root-certs (CDLA-Permissive-2.0) correctly remains an orchestrator decision item outside this delta.
