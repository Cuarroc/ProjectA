# Review request PR #136 (W1-23c): "-0 Tokens" fix and MSRV measurement of windows-sys/windows-link/r-efi/encode_unicode (ProjectA, Tauri 2, Rust)

You are an independent code reviewer from a different model vendor than the
author (Claude Code). Review the diff below for correctness and evidence
quality. Report findings as a numbered list, each with: severity
(blocking/medium/low), file:line, what is wrong, a concrete failing scenario,
and a suggested fix. End with an explicit overall verdict: "mergeable: yes"
or "mergeable: no". Say explicitly if you find nothing blocking. Do not
restate the diff.

## Background
- ProjectA is a Tauri 2 desktop app. `src-tauri/src/status.rs` renders token
  counts for the status line via `format_tokens(value: f64) -> Option<String>`;
  `None` means "not shown" (non-finite or negative values).
- W1-23b left two follow-ups, which this package (W1-23c) addresses:
  - Part A: `-0.0` rendered as "-0 Tokens", because `-0.0 < 0.0` is false in
    IEEE 754, so the value passed the negativity guard and
    `format!("{:.0}", -0.0)` yields `"-0"`. The task requires that any value
    in `[-0.5, 0]` displays "0 Tokens" (Rust's `{:.0}` rounds ties to even,
    so -0.5 rounds to -0); values ≤ -0.6 must stay `None`. Everything else
    (unit scaling, NaN/∞ → None, -1.0 → None) must stay unchanged.
  - Part B: the project declares `rust-version = "1.89"`. A decisions.md entry
    listed the MSRV of resolved crates but marked `windows-sys`,
    `windows-link`, `r-efi` and `encode_unicode` as "unchecked" because they
    were not in the local registry cache. This package measures them:
    declared `rust-version` read from the registry cache after
    `cargo fetch --locked`, plus throwaway-crate builds with `=`-pinned
    versions matching `src-tauri/Cargo.lock` (checksums verified), built
    with Rust 1.89 and checked with Rust 1.71 on `x86_64-pc-windows-gnu`
    (r-efi additionally built for `x86_64-unknown-uefi`). Result: declared
    values 1.48–1.71, all build with 1.89, all pass `cargo check` with 1.71.
    The decisions.md entry is updated accordingly. No project code changes
    for Part B.

## Guiding questions
1. Correctness of the fix: does clamping `(-0.5..=0.0)` to `0.0` before the
   finite/negative guard implement exactly the required behavior? Any value
   that changes behavior beyond the stated intent (e.g. -0.5 itself, NaN,
   subnormals, -0.4999... vs. f64 representation of the range bound)?
2. Is the range bound right? `(-0.5..=0.0).contains(&value)` — does -0.5
   belong to the "0 Tokens" class given round-to-even, and is the boundary
   at -0.6 / just below -0.5 handled correctly for f64?
3. Tests: does `format_tokens_never_renders_negative_zero` prove the goal
   (-0.0, -0.4, -0.5 → "0 Tokens"; -0.6, -1.0 → None)? Are callers and
   existing snapshot tests (`format_tokens_snapshot`, carries-over) left
   intact, and is any claim in the PR text not covered by a test?
4. Doc accuracy: the doc comment says "None if the value is not finite or
   negative" while small negatives now render as "0 Tokens" — is the
   comment now misleading?
5. Part B evidence: is "all ten versions build with 1.89" sufficient support
   for the updated decisions.md sentence? Does the measurement method
   (windows-gnu instead of -msvc, rlibs without linking, no per-crate
   bisection, check at 1.71 rather than exact floor) leave gaps that the
   text overstates? Does the decisions.md edit accurately summarize the
   report?
6. AGENTS.md consistency: any contradiction with "Runtime claims need
   measured evidence", the NICHT-ABGEDECKT disclosure rules, or the claim
   discipline for unobserved environments?

## Diff

```diff
diff --git a/docs/decisions.md b/docs/decisions.md
index c0e3bf1c..5108e186 100644
--- a/docs/decisions.md
+++ b/docs/decisions.md
@@ -1018,8 +1018,10 @@ features only (`colors`/`console`) — no `json`/`csv`/`redactions` extras.
 insta itself declares MSRV 1.66.0, but that is not the floor of what the
 lockfile resolves under it: `console` 0.16.6 declares `rust-version = "1.71"`
 and `getrandom` 0.4.3 (via `tempfile`) declares 1.85, the highest value among
-the resolved crates checked (`windows-sys`, `windows-link`, `r-efi` and
-`encode_unicode` were not in the local registry and are unchecked). Corrected 2026-09-23 in W1-23b — the
+the resolved crates checked. `windows-sys` (0.45.0–0.61.2), `windows-link`,
+`r-efi` and `encode_unicode` were measured in W1-23c: declared 1.48–1.71
+(`encode_unicode` 1.0.0 has no field, its README says 1.56), and all of them
+build with 1.89 and pass `cargo check` with 1.71 (`.pa/report_w1-23c.md`). Corrected 2026-09-23 in W1-23b — the
 first version of this entry claimed nothing needed more than 1.66. Everything
 stays under this crate's `rust-version = "1.89"` and the 1.94.1 toolchain in
 use here. First
diff --git a/src-tauri/src/status.rs b/src-tauri/src/status.rs
index 678d081e..110b22a3 100644
--- a/src-tauri/src/status.rs
+++ b/src-tauri/src/status.rs
@@ -2023,8 +2023,16 @@ fn context_window_usage(window: Option<&ContextWindow>) -> (Option<String>, Opti
 }
 
 /// Render a token count for display, e.g. "999 Tokens" or "1,0 M Tokens";
-/// `None` if the value is not finite or negative.
+/// `None` if the value is not finite or negative. A value that rounds to
+/// zero shows as "0 Tokens", never "-0 Tokens".
 fn format_tokens(value: f64) -> Option<String> {
+    // -0.0 and negatives down to -0.5 (a tie rounds to even) round to a
+    // negative zero; they are zero, not a negative count.
+    let value = if (-0.5..=0.0).contains(&value) {
+        0.0
+    } else {
+        value
+    };
     if !value.is_finite() || value < 0.0 {
         return None;
     }
@@ -3446,6 +3454,19 @@ mod tests {
         assert_eq!(rendered(999_999_999_999.0), "1000,0 G Tokens");
     }
 
+    /// A value that rounds to zero shows as "0 Tokens", never "-0 Tokens":
+    /// -0.0 passes the `< 0.0` guard, and a small negative rounds to "-0".
+    /// Negatives that do not round to zero stay rejected.
+    #[test]
+    fn format_tokens_never_renders_negative_zero() {
+        assert_eq!(format_tokens(-0.0).as_deref(), Some("0 Tokens"));
+        assert_eq!(format_tokens(-0.4).as_deref(), Some("0 Tokens"));
+        // Rust rounds a tie to even, so -0.5 rounds to (negative) zero too.
+        assert_eq!(format_tokens(-0.5).as_deref(), Some("0 Tokens"));
+        assert_eq!(format_tokens(-0.6), None);
+        assert_eq!(format_tokens(-1.0), None);
+    }
+
     /// [`format_tokens`] scales k/M/G and renders the German decimal comma;
     /// a snapshot table is cheaper to extend than a point assertion per
     /// magnitude and shows every boundary in one review.
```

## Report excerpt (Part B measurement, from `.pa/report_w1-23c.md` in the same diff)

| Crate | Version (lockfile) | declared `rust-version` | build 1.89 (windows-gnu) | check 1.71 (windows-gnu) |
|---|---|---|---|---|
| windows-sys | 0.45.0 | 1.48 | Exit 0 | Exit 0 |
| windows-sys | 0.52.0 | 1.56 | Exit 0 | Exit 0 |
| windows-sys | 0.59.0 | 1.60 | Exit 0 | Exit 0 |
| windows-sys | 0.60.2 | 1.60 | Exit 0 | Exit 0 |
| windows-sys | 0.61.2 | 1.71 | Exit 0 | Exit 0 |
| windows-link | 0.1.3 | 1.71 | Exit 0 | Exit 0 |
| windows-link | 0.2.1 | 1.71 | Exit 0 | Exit 0 |
| r-efi | 5.3.0 | 1.68 | Exit 0 (also uefi) | Exit 0 |
| r-efi | 6.0.0 | 1.68 | Exit 0 (also uefi) | Exit 0 |
| encode_unicode | 1.0.0 | no field; README: 1.56 | Exit 0 | Exit 0 |

Declared NICHT ABGEDECKT by the author: Windows test half only in CI; MSRV
build on `-gnu` not `-msvc`; rlibs only, no linking; exact per-crate floor
not bisected (only points 1.71 and 1.89 checked); lane `linux` (browser
smoke, frontend build, workflow gates) not run locally.
