# Review: lic-01 — kimi-k3

- Autor des Artefakts: kimi-code lic-01 worker
- Reviewer: kimi-k3 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `kimi-k3:cloud`, bedient `kimi-k3`
- Datum: 2026-09-25 13:19 UTC, Dauer 226 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_lic-01.md` (18337 Zeichen)

## Roh-Urteil des Reviewers

# LIC-01 Review — License Audit Branch

## Rules checklist (verified against the diff)

| Rule | Result |
|---|---|
| Findings visible, not hidden | ✅ webpki-root-certs left red **and** documented in the notices; `deny.toml` contains **zero** `exceptions` blocks; the evaluator's only skip (root package) is commented and mirrored in the notices doc |
| Gate must actually be able to fail | ✅ fail-closed on all paths: install failure (`license-check.sh:16`), checker failure (`:26`), violations (`:28,30`); unknown/empty licenses rejected (`license-check.mjs:40-41` — `parts.length > 0` guard + exact `Set` membership, so nothing can be smuggled past as "part of" an allowed ID) |
| No secrets / personal data | ✅ None. Names in `THIRD_PARTY_NOTICES.md` (Inter authors, Nelson, Leonxlnx) are upstream copyright lines whose preservation is **required** by MIT/OFL — legal attribution, not a personal-data leak |
| Shell scripts 100755 | ✅ New `license-check.sh` is 100755; all squash-lost exec bits restored; `.mjs` files need no exec bit (invoked via `node`, no shebang) |
| Red-first | ✅ Structurally (both files absent on base → red; green on head) — see F9 for the caveat |

Allowlists verified 1:1 against the user rule in **both** files (14 entries, no silent additions), and the unit test pins the list.

## Findings

**F1 — medium — webpki-root-certs / CDLA-Permissive-2.0 keeps the new gate red by design**
`docs/THIRD_PARTY_NOTICES.md` ("Rust dependencies"), `scripts/ci/gates.sh:108`, `src-tauri/deny.toml:6-23`.
The handling itself is exactly right: refused locally, escalated visibly, no exception smuggled into `deny.toml`. But it is a **merge-blocking decision item**: if this branch lands before the orchestrator rules, `main` gets a permanently red `licenses` gate. That may be the intended "visible finding" marker — state it consciously at merge. The decision options are allow CDLA-Permissive-2.0 explicitly, or remove the dependency (note: `webpki-roots` — different crate from `webpki-root-certs` — is MPL-2.0 and already on the allowlist, if the dependency chain permits the swap). Sibling item: the repo's own root license is likewise "Needs decision" (`deny.toml:25-26`); nothing enforces a root LICENSE file once decided — file as follow-up.

**F2 — medium — npm half of the gate runs an unpinned tool fetched on every CI run**
`scripts/ci/license-check.sh:24`.
`npx --yes license-checker-rseidelsohn` resolves to "latest" each run (no devDependency/lockfile entry appears in the diff). The gate's verdict therefore depends on whatever the registry serves that day — non-reproducible and a supply-chain hole in a compliance gate, in contrast to the Rust half which is pinned and `--locked` (`:11-17`). A breaking output-format change would likely fail closed, but a compromised release runs arbitrary code in the release lane. Fix: pin an exact version, ideally as a devDependency with a lockfile entry.

**F3 — low — allowlist duplicated in two files; nothing enforces the claimed mirroring**
`scripts/lib/license-check.mjs:15-30` vs `src-tauri/deny.toml:8-23`.
Both headers assert the lists mirror each other; the unit test pins only the `.mjs` side. One edited without the other desyncs the two halves of the gate silently (relevant the moment F1 is resolved by editing `deny.toml`). Fix: a test that parses `deny.toml`'s `allow` array and asserts equality with `ALLOWED_LICENSES`.

**F4 — low — THIRD_PARTY_NOTICES table is hand-curated; freshness is not CI-enforced**
`docs/THIRD_PARTY_NOTICES.md` (regeneration block).
The gate enforces the allowlist, but nothing checks that new on-list dependencies actually appear in the notices — the npm table is manual transcription of the JSON report. A 15th MIT package would pass the gate yet be missing from the required-notices surface. Fix: a CI diff check, or a documented regeneration step in the release process.

**F5 — low — vendored assets (fonts, skill packs) sit outside gate coverage; OFL-1.1 is dead config in the dependency allowlists**
`src-tauri/deny.toml:22`, `scripts/lib/license-check.mjs:29`.
Neither cargo-deny nor license-checker can ever see the vendored fonts/packs, so the OFL-1.1 entries never fire there; conversely the user scoped OFL-1.1 "for fonts", while these lists would accept OFL-1.1 on *any* crate/npm package (fail-safe in practice, but broader than the letter of the rule). The real gap: a font or skill-pack swap under a different license fails no gate — coverage rests on the static notices doc. Acceptable for LIC-01's stated scope ("gate for rust and npm + notices"), but it should be a documented decision; suggest a manifest/integrity check for vendored assets as follow-up.

**F6 — low — OR-expressions: npm half requires *all* alternatives on the list; Rust half requires *any***
`scripts/lib/license-check.mjs:41`.
`parts.every(...)` makes `"MIT OR WTFPL"` a violation, while cargo-deny (and the notices doc's own sentence — "only one needs to be on the allowlist") accepts it via SPDX choice semantics. Fail-closed, so no compliance risk, and escalation-on-anything-off-list is arguably the intended strictness — but the two halves currently apply different rules to the same list, contradicting the notices. Align or document.

**F7 — low — preinstalled cargo-deny of any version satisfies the presence check**
`scripts/ci/license-check.sh:12`.
`cargo deny --version` is only a presence probe; `DENY_VERSION` pinning applies solely on fresh install. cargo-deny versions ship different SPDX/license data, so a CI image with an older preinstalled version can produce a different gate verdict. Fix: compare against `DENY_VERSION` and install on mismatch.

**F8 — low — license-checker's "inferred" marker (`*`) is stripped silently**
`scripts/lib/license-check.mjs:37,39`.
`"MIT*"` (inferred from a LICENSE file, not declared in metadata) passes as MIT. A defensible default, but inference errors exist in both directions; given the "findings visible" rule, at least log when a `*` was stripped so inferred licenses are visible rather than silent.

**F9 — low — unit test's CI wiring is not shown; red-on-base is module-not-found**
`scripts/lib/license-check.test.mjs` (whole file).
The diff adds the test but no lane that runs `node --test` over `scripts/lib/*.test.mjs`; gates.sh registers only the `licenses` gate, which exercises the evaluator on *live* data, not these unit tests. If the existing node test lane doesn't glob this directory, commit 2's promise never runs in CI — verify. Also, red-on-base is "module not found" since test and implementation land in one commit: the red proves absence, not assertion behavior. Acceptable for a new-module test, but record the base run.

## Verdict

**Approve with conditions.**

1. **Blocking:** F1 — the orchestrator must decide CDLA-Permissive-2.0 (explicit allow, or drop `webpki-root-certs`). The branch correctly refuses to decide this locally; merging before the decision means a knowingly red `licenses` gate on main. The repo's own root license decision also remains open.
2. **Should fix before relying on the gate:** F2 — pin `license-checker-rseidelsohn`.
3. **Follow-ups (non-blocking):** F3 (drift test), F4 (notices freshness), F5 (document the vendored-asset scope gap), F6 (align OR semantics), F7–F9.

Everything else — exec-bit restoration, rustfmt drift, allowlist fidelity, fail-closed gate design, visible escalation, attribution completeness (fonts, skill packs, MPL §3.2 note, the claude-code-setup template copyright disclosure) — is in order.
