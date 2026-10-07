# ARCH-D4 serial slice 1: discovery

Source: docs/PLAN.md ARCH-D4; docs/plan/v1.6.0/plan.md section 3.
Decision: ARCH-D4-PLAN rev1, answer 6b733c02, serial-total300.
Pinned chain baseline: 20d0e32e2a6aa37b5ebc5e704056d93c362da2a0; api.rs 8164 lines.
Predecessor: ARCH-D1 PR596, merged f871ce8.
Owner: one Chief-assigned API implementer; exclusive API seam.
Files: api.rs, api/d4_routes.rs, api/d4_discovery.rs, this spec.
Move only the exact whole arms listed in the preparation manifest.
Preserve auth/verdict order, body consumption, status and JSON semantics.
Preserve wrong-method/foreign-path None and final parent 404/405.
Use the private parent fixture; no backend visibility expansion.
Add the child None stub and contract before implementing the move.
Observe compiling RED on stub and GREEN on extracted candidate.
Do not report missing base tests as an observed failing regression.
Run own secret scan and full prepush; retain NICHT ABGEDECKT.
Tier A: two other-vendor reviews bound to the actual candidate SHA.
All-file additions plus deletions must remain <=300, including this spec.
Record commit SHAs, API line counts and cumulative net against baseline.
Chain final API reduction must be >=300; no per-slice 150 minimum.
One draft PR; Root owns acceptance, Chief dispatch, Mergify merge.
