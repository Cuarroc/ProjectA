# Review pr10 — disposition (reviewer: grok, round 4 / stage B)

Reviewer: xAI Grok (CLI), full-diff review of the substantive files.
Prompt: `.pa/review_prompt_pr10.md`, response: `.pa/review_pr10_grok.md`.
Verdict: **approve with conditions** (F1, F2, F3, F4 named as conditions).
Each finding verified against the actual code before the decision.

## F1 — drift pin misses exceptions/clarify/single quotes — ACCEPTED, fixed

Verified: the drift pin reads only the double-quoted `allow` array inside
`[licenses]`; cargo-deny 0.20 would additionally honor `exceptions = [...]`
in that table and `[[licenses.clarify]]` tables, and a single-quoted allow
entry would vanish from the mirror comparison. All three keep the test
green while the Rust half passes a license the npm half rejects.
Fix: `denyTomlPolicyProblems` in `scripts/lib/license-check.mjs` flags all
three, pinned against fixtures and run against the real `deny.toml`.
Red commit 8076670 (exit 1, missing export), green in a75dfe8.

## F2 — license-check.test.mjs not registered with any test script — REJECTED

Verified against `scripts/ci/gates.sh:101` and `package.json:29`: the
`hq-test` gate runs `npm run test:hq` = `node --test scripts/lib/*.test.mjs`,
which globs `license-check.test.mjs`, in lanes `prepush, branchpush, linux,
release` — a superset of the `licenses` gate lanes (`linux, release`,
`gates.sh:108`). Wherever the license gate runs, the SPDX/mirror tests run
too. No change.

## F3 — npm half fail-open on empty/root-only scan — ACCEPTED, fixed

Verified: `evaluateLicenses({})` returns `[]` and `main` printed
"0 production packages, all on the allowlist" with exit 0; the count also
included the skipped root key. Fix: `main` fails closed when the report
contains no third-party packages, and the count excludes the root.
CLI test pins both the empty and the root-only case (exit 1).
Red commit 8076670, green in a75dfe8.

## F4 — notices preamble overclaims what CI enforces — ACCEPTED, fixed

Verified: the preamble said every entry is allowlisted and CI-enforced,
but the fonts/skill packs are attribution entries outside the scanned
trees, and the Rust dump lists OR alternatives off the allowlist
(LGPL-2.1-or-later, MIT-0, Unlicense, CDLA-Permissive-2.0). Fixed in
9a9203b: the preamble now scopes the enforcement claim to the Rust crate
graph and npm production tree and marks the bundled assets as
attribution-only. Sub-point deferred (follow-up below): nothing diffs the
hand-written tables against a fresh scan.

## F5 — root skip is a name prefix — ACCEPTED, fixed

Verified: `pkg.startsWith(`${rootName}@`)` would skip a production
dependency named `projecta` at any version. Fix: exact `name@version`
match from package.json. Red commit 8076670, green in a75dfe8.

## F6 — `*` on a parenthesized group becomes a false violation — ACCEPTED, fixed

Verified: `(MIT OR Apache-2.0)*` tokenized `)*` as one word, hit the
"unbalanced parentheses" path and failed closed — safe direction, but a
false positive for a real license-checker output shape. Fix: `*` is its
own token and is skipped after a token or group; `MIT**` stays malformed,
a bare `*` stays fail-closed. Red commit 8076670, green in a75dfe8.

## F7 — regenerate instructions use unpinned tools — ACCEPTED, fixed

Verified: the notices file suggested plain `cargo deny list` and
`npx license-checker-rseidelsohn` (latest). Fixed in 9a9203b: both
commands now pin cargo-deny 0.20.2 / license-checker-rseidelsohn 5.0.1,
matching `scripts/ci/license-check.sh`.

## F8 — npm half only sees the Linux runner's node_modules — DEFERRED (follow-up)

Verified and real: license-checker scans the installed tree, so a
production/optional dependency limited to another OS never enters the
JSON on the Linux lane. cargo-deny evaluates the whole Rust lockfile for
all targets; the npm side has no equivalent lockfile walk. Fixing this
means evaluating `package-lock.json` (which lists all platforms'
optional dependencies) instead of the installed tree — a design change,
out of scope for this review round. Follow-up recorded below.

## Follow-ups (for the coordinator)

1. F8: lockfile-based npm license evaluation so platform-specific
   optional dependencies of non-Linux targets are covered.
2. F4 sub-point: a drift check that regenerates the dependency tables in
   `docs/THIRD_PARTY_NOTICES.md` and diffs them against the committed
   file.
3. Unchanged from rounds 1–3: `webpki-root-certs` (CDLA-Permissive-2.0)
   keeps the gate red until the orchestrator decides — not part of this
   review.
