## Findings

**F1 — medium — `scripts/lib/license-check.test.mjs:59-67`**
The drift pin does scope to `[licenses]`: it starts at `[licenses]\n`, cuts at the next line-opening `[` (so `[licenses.private]` is outside the slice), and `deepEqual`s the double-quoted `allow` array to `ALLOWED_LICENSES` in order. A double-quoted toml-only entry and an mjs-only entry both fail that assertion.

That slice stops at the first `]` of `allow = [`. Anything else cargo-deny 0.20 will still honor inside the same table is invisible to the pin: `exceptions = [{ allow = ["GPL-3.0-only"], name = "...", version = "*" }]` and `[[licenses.clarify]]` (expression rewrite plus a license-file hash; the hash checks that you named the file, not that the expression matches the text). Either keeps this test green and makes `cargo deny check licenses` accept a license the npm half would reject. A single-quoted allow entry (`'GPL-3.0-only'`) is also dropped by `"([^"]+)"` and would not change `fromToml`.

**F2 — medium — `scripts/ci/license-check.sh:44` (and `scripts/ci/gates.sh:108`)**
The new `licenses` gate runs `license-check.sh` only. That script never runs `scripts/lib/license-check.test.mjs`, and this diff does not register that file with any test script. The allowlist mirror and the SPDX cases (precedence, `*` , empty arrays, malformed expressions) protect the gate only if some other required job already globs `scripts/lib/*.test.mjs`.

**F3 — medium — `scripts/ci/license-check.sh:38-44`, `scripts/lib/license-check.mjs:144`**
The npm half fail-opens on a successful but empty scan. `npx ... --json` exiting 0 with `{}` (or with only the skipped root package) makes `evaluateLicenses` return `[]`, `main` prints `N production packages, all on the allowlist` using `Object.keys(report).length` (skipped keys included), and the shell exits 0. There is no lockfile cross-check and no minimum package count. An incomplete `node_modules` — checker exit 0, partial JSON — is a green gate.

The Rust/npm exit plumbing itself holds: no `set -e` is paired with `|| fails=1` on `cargo deny check licenses` (line 30) and on `node` (line 42); a failed install or a post-install version mismatch exits 1; a non-zero checker exits 1 before `node` runs. A real non-zero deny or a real violation still fails the script.

**F4 — medium — `docs/THIRD_PARTY_NOTICES.md:3-9` and `:20-32`**
The preamble says every listed entry is on the allowlist and that CI enforces that list. The gate only sees the cargo graph (crates.io / workspace resolution) and npm `--production` in `node_modules`. Inter, Recursive, `prompt-master`, `taste-skill`, `unlazy`, and `claude-code-setup` are attribution-only; replacing one of those trees with a non-allowlisted license does not fail `licenses`. The same file’s Rust dump then lists `LGPL-2.1-or-later`, `MIT-0`, `Unlicense`, and `CDLA-Permissive-2.0` (CDLA row in the fenced list). The later OR/CDLA paragraph explains why, but the opening sentence still says every entry is an allowlisted license. Nothing in CI checks the snapshot against a fresh `cargo deny list` / checker report.

**F5 — low — `scripts/lib/license-check.mjs:115`**
The root skip is `pkg.startsWith(`${rootName}@`)`. For a root named `projecta`, every key `projecta@<any version>` is dropped, including a production dependency that shares that name, at any version, with any license. The skip is not tied to the root version or to the checker’s `path`.

**F6 — low — `scripts/lib/license-check.mjs:47` and `:83`**
The trailing `*` strip runs only on a primary token (`MIT*` → `MIT`, `GPL-3.0-only*` stays disallowed, `Apache-2.0 WITH LLVM-exception*` rejoins and then strips). `tokenize` splits parentheses before that. A checker string such as `(MIT OR Apache-2.0)*` becomes a leftover `*` token, `pos === tokens.length` fails, and an allowlisted expression is a violation. Disallowed licenses on that path still fail. `*` on its own token is the same fail-closed false positive.

**F7 — low — `docs/THIRD_PARTY_NOTICES.md:14-15`**
Regenerate instructions call unpinned `cargo deny list` and `npx --yes license-checker-rseidelsohn` (latest). The gate pins cargo-deny `0.20.2` and `license-checker-rseidelsohn@5.0.1`. A regen on a different day can rewrite the notices from a different resolver than the gate.

**F8 — low — `scripts/ci/gates.sh:108`, `scripts/ci/license-check.sh:38`**
The npm half is whatever `node_modules` the Linux release job installed. A production or optional dependency limited to another OS (not installed on that runner) never enters the JSON. cargo-deny still sees the Rust lockfile; the npm half does not have an equivalent lockfile walk. The Linux-only lane is consistent with the cargo-deny install comment; the npm scan is what becomes platform-shaped.

## What holds

SPDX evaluation matches the stated cargo-deny rules. `AND` binds tighter than `OR`, parentheses group, and `(MIT OR Apache-2.0) AND GPL-3.0-only` is a violation. `WITH` is rejoined into one token and only `Apache-2.0 WITH LLVM-exception` is allowlisted, so `MIT WITH GPL-3.0-only` does not become MIT. Parser calls sit on the left of `&&` / `||`, so a true `OR` arm or a false `AND` arm still consumes the rest of the expression; success also requires `pos === tokens.length`. Malformed input, empty tokens, empty license arrays, missing `licenses`, and `UNKNOWN` return violations. No secrets, credentials, or machine-local paths show up in this diff. Copyright lines in the notices are attribution for the vendored packs.

`webpki-root-certs` / `CDLA-Permissive-2.0` staying off the allowlist, with the gate red until an orchestrator decision, is treated as given and is not a finding. `src-tauri/src/skills.rs` is a formatting-only assert wrap.

## Verdict

**Approve with conditions.** The SPDX parser and the shell’s `fails` / install / re-verify paths do not show a remaining way for a disallowed expression to evaluate as allowed. Before calling the gate closed: extend the deny.toml pin over `exceptions` and `clarify` (F1), run `license-check.test.mjs` from the gate (F2), and fail the npm half on an empty or root-only report (F3). Adjust the notices so CI enforcement and the allowlist describe only what the gate actually checks (F4).
