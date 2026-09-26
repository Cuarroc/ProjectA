# Review: lic-01-delta — kimi-k3

- Autor des Artefakts: kimi-code lic-01 worker
- Reviewer: kimi-k3 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `kimi-k3:cloud`, bedient `kimi-k3`
- Datum: 2026-09-25 13:40 UTC, Dauer 316 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_lic-01-delta.md` (7573 Zeichen)

## Roh-Urteil des Reviewers

# Delta-Review LIC-01 round 2 (7bc68ef + 860be7e)

## Verified OK first

- **Fail-closed basics**: empty/undefined `licenses` → `"UNKNOWN"` → violation; non-string/array junk stringifies to garbage → violation; `*` stripping can only shorten a token (no `GPL*`→`MIT` tricks); `WITH` exceptions fail closed (token not on list). No path returns "allowed" on missing data.
- **Paren-free expressions** are evaluated with correct SPDX precedence (AND binds tighter): `GPL OR MIT AND Apache-2.0` etc. all match cargo-deny/spdx. The claimed parity holds for DNF inputs.
- **Array handling** is conservative (every element must pass). **Pins**: npx uses an exact spec (`@5.0.1`), cargo-deny uses `--locked --version 0.20.2`, install failure ⇒ `exit 1`.
- **Allowlist untouched** by this diff; no secrets, tokens, or exfiltration anywhere.
- **Red-first**: order test (7bc68ef) → fix (860be7e) checks out. The OR test and array test are genuinely red against the old implementation (old code required *all* parts including OR-alternatives; old code stringified arrays to `"MIT,Apache-2.0"`). The drift test is green-by-design (it pins two pre-existing files), which is acceptable for a pin test.

## Findings

### F1 — medium — `scripts/lib/license-check.mjs:41–54` (esp. L42, L46–47)
**Parenthesis flattening destroys SPDX precedence — a new smuggle path.** Splitting on `OR` before honoring parens changes the satisfaction set of mixed expressions:

```
"(MIT OR Apache-2.0) AND GPL-3.0-only"
→ flattened: "MIT OR Apache-2.0 AND GPL-3.0-only"
→ alternative "MIT" alone passes ⇒ gate PASSES
```
True semantics (and cargo-deny): GPL-3.0-only is a **mandatory conjunct** ⇒ must be a violation. The old implementation flagged any disallowed token anywhere, so this is a *new* bypass introduced by this change, and it directly contradicts the code comment's "matching cargo-deny" claim and the review bar of "no new ways to smuggle a disallowed license through". Mixed AND/OR expressions with parens are rare but valid SPDX in npm metadata.
**Fix (fail-closed, pick one)**: (a) precedence-aware mini-parser or a dependency like `spdx-expression-parse`; (b) conservative fallback — if the raw expression contains `(`/`)`, require *all* tokens allowed (old behavior for that subset) or flag for manual review; (c) at minimum correct the comment and pin the chosen behavior with a test.

### F2 — medium (conditional) — `scripts/ci/license-check.sh:12–13`
**The version probe may abort the script before the install branch runs.** If the unshown header (lines 1–8) contains `set -euo pipefail`, then when cargo-deny is absent, `cargo deny --version` fails ⇒ pipefail makes the pipeline fail ⇒ `installed="$(...)"` fails ⇒ `set -e` terminates the script silently. The old `if ! cargo deny --version; then` was exempt (condition context). Result: exactly the case the feature exists for (tool missing) skips the documented auto-install. Gate still exits non-zero (fail-closed), but "reinstall on version/missing" is broken. Verify the header; guard with `installed="$(... )" || true`.

### F3 — low — `scripts/ci/license-check.sh:12–20`
**No post-install re-verification.** After `cargo install`, the script runs whatever `cargo deny` resolves to on PATH. If another cargo-deny shadows `~/.cargo/bin` (e.g. `/usr/local/bin`), the gate silently executes the *wrong* version every run while reinstalling each time. Fail-closed fix: re-run the version probe after install and `exit 1` on mismatch.

### F4 — low — `scripts/lib/license-check.test.mjs` (drift test, ~L56–66)
**Regex not scoped to `[licenses]`.** `/^allow = \[\n([\s\S]*?)\]/m` matches the *first* `allow = [` array in the file; if deny.toml ever gains another `allow = [` (e.g. a `[bans]` crate allowlist ordered earlier), the guard compares crate names against licenses and fails. Failure is loud (safe direction), but anchoring to the `[licenses]` section removes false alarms and ambiguity. Note the order- and formatting-sensitive `deepEqual` is intentional pinning — good.

### F5 — low — `scripts/lib/license-check.test.mjs`
**Test gaps in the new code**: the array test only covers all-allowed; add `["MIT", "GPL-3.0-only"]` ⇒ violation (the property the comment claims). No test pins `*`-marker behavior (`"MIT*"` passes-with-warning, `"GPL-3.0-only*"` fails). No test pins parenthesized-expression behavior — which is exactly why F1 shipped undetected.

### F6 — info — `scripts/lib/license-check.mjs:43–45`
**Inferred licenses (`*`) pass the gate with only a stderr line.** This matches the stated intended behavior ("marker is logged"), so not a defect — but "verify by hand" depends on a human actually reading CI logs. If the gate should be strictly fail-closed on uncertain provenance, count warnings and fail at the end, or require an explicit per-package override.

### F7 — low (verify) — `scripts/lib/license-check.test.mjs`
The drift test references `ALLOWED_LICENSES`, but the diff shows no change to the module import line (only the `fs` import changed). If the pre-existing import was `import { evaluateLicenses } from "./license-check.mjs"`, this test throws ReferenceError in both commits. Failure is red (safe), and the authors presumably ran the suite — just confirm the existing import already includes it.

## Verdict

**Approve with conditions.**

- **Blocking (per the stated fail-closed / no-new-smuggle bar):** F1 — parenthesized mixed expressions must either be parsed with real SPDX precedence or handled conservatively; F2 — verify the script header and make the probe set-e/pipefail-safe so "install on version mismatch" actually executes.
- **Recommended before or shortly after merge:** F3–F5, F7; F6 is a documented-policy decision for the maintainers.

The pins, array semantics, paren-free OR/AND semantics, drift-pin both-ways, no-secrets, and red-first commit ordering are all correct as claimed — only the precedence hole keeps this from a clean approve.
