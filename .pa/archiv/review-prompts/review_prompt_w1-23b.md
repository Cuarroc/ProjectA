# Review-Auftrag W1-23b (Snapshot-Nacharbeit zu PR #79)

Du bist unabhängiger Code-Reviewer (nicht der Autor). Prüfe den folgenden Diff gegen `origin/main`
im Repo ProjectA (Tauri 2 / Rust). Antworte auf Deutsch.

Ziele des Pakets:
- S1: Doc-Kommentar von `budget::tests::settings_fold_snapshot` korrigieren (er übertrieb, was das
  Fixture gegenüber `settings_fold_into_one_entry_per_profile` hinzufügt) + Fall „doppelter Schlüssel,
  letzter Wert gewinnt“.
- S3 (Bug): `status::format_tokens(999_999.0)` lieferte „1000,0 k Tokens“. Einheit muss nach der
  Rundung gewählt werden. Roter Test zuerst, dann Fix, Snapshot aktualisiert.
- S5: docs/decisions.md behauptete MSRV 1.66 für den insta-Baum; `console` 0.16.6 verlangt 1.71.
- S6: `.gitattributes` um `*.snap text eol=lf`.

Prüfe insbesondere: Korrektheit von `format_tokens` an allen Grenzen (auch 0.5, sehr kleine Werte,
999.5 bei Rundung „half to even“ der Rust-Formatierung, Werte ≥ 1e12), Lesbarkeit/Einfachheit,
ob Tests und Snapshots die Behauptungen belegen, und ob die Doku-Aussagen stimmen.

Gib jeden Befund mit ID (R1, R2, …), Schwere (blocker/major/minor/nit), Fundstelle und Begründung an.
Wenn nichts zu beanstanden ist, sag das ausdrücklich.

## Diff

```diff
diff --git a/.gitattributes b/.gitattributes
index 35ea21e..863bea3 100644
--- a/.gitattributes
+++ b/.gitattributes
@@ -19,3 +19,6 @@ src-tauri/testdata/pty/*.raw binary
 # clone-lokal und wird von scripts/install-hooks.sh registriert.
 docs/dev-hq/data.js merge=hqdata
 docs/dev-hq/data.json merge=hqdata
+# insta-Snapshots vergleichen Zeichen fuer Zeichen; mit autocrlf-Checkout
+# (CRLF) waeren sie unter Windows sonst alle "veraendert".
+*.snap text eol=lf
diff --git a/docs/decisions.md b/docs/decisions.md
index 82b0ec5..e803ff3 100644
--- a/docs/decisions.md
+++ b/docs/decisions.md
@@ -953,8 +953,14 @@ No review workflow execution or paid model spending is part of this update.
 
 New dev-dependency `insta = "1.48"` (`src-tauri/Cargo.toml`), default
 features only (`colors`/`console`) — no `json`/`csv`/`redactions` extras.
-MSRV 1.66.0, under this crate's `rust-version = "1.89"` and the 1.94.1
-toolchain in use here; nothing pulled in needs a newer compiler. First
+insta itself declares MSRV 1.66.0, but that is not the floor of what the
+lockfile resolves under it: `console` 0.16.6 declares `rust-version = "1.71"`
+and `getrandom` 0.4.3 (via `tempfile`) declares 1.85, the highest value among
+the resolved crates that declare one (`windows-sys`, `windows-link`, `r-efi`
+and `encode_unicode` were not checked). Corrected 2026-09-23 in W1-23b — the
+first version of this entry claimed nothing needed more than 1.66. Everything
+stays under this crate's `rust-version = "1.89"` and the 1.94.1 toolchain in
+use here. First
 snapshots cover two pure parser/formatter pairs: `budget::limits_from_settings`
 + `BudgetStop::reason()` (`src-tauri/src/budget.rs`), and
 `status::parse_statusline` + `status::format_tokens`
diff --git a/src-tauri/src/budget.rs b/src-tauri/src/budget.rs
index 2d746bc..eec4ebd 100644
--- a/src-tauri/src/budget.rs
+++ b/src-tauri/src/budget.rs
@@ -703,10 +703,11 @@ mod tests {
         );
     }
 
-    /// Snapshot of the fold's full shape - profile order, both windows next
-    /// to each other, and the drop cases from the point-assertion test above
-    /// in one picture. A point assertion checks the value it names; a
-    /// snapshot also catches a field or an entry nobody thought to name.
+    /// The fixture repeats most of `settings_fold_into_one_entry_per_profile`
+    /// (same three drop cases, same claude/kimi entries). What it adds is a
+    /// third profile with both windows, a key set twice (the later value
+    /// wins, as `limits_from_settings` overwrites in input order), and the
+    /// whole `Debug` shape as one reviewed file instead of named fields.
     #[test]
     fn settings_fold_snapshot() {
         let settings = vec![
@@ -715,6 +716,8 @@ mod tests {
             ("budget.kimi.seven_day_pct".to_string(), "70".to_string()),
             ("budget.gpt-5.five_hour_pct".to_string(), "1".to_string()),
             ("budget.gpt-5.seven_day_pct".to_string(), "100".to_string()),
+            // Set twice: the later value wins.
+            ("budget.claude.five_hour_pct".to_string(), "95".to_string()),
             // Skipped: wrong prefix, unparsable value, empty profile id.
             ("learning.worker".to_string(), "0".to_string()),
             ("budget.gpt.five_hour_pct".to_string(), "abc".to_string()),
diff --git a/src-tauri/src/snapshots/projecta__budget__tests__settings_fold_snapshot.snap b/src-tauri/src/snapshots/projecta__budget__tests__settings_fold_snapshot.snap
index b422ac0..337832a 100644
--- a/src-tauri/src/snapshots/projecta__budget__tests__settings_fold_snapshot.snap
+++ b/src-tauri/src/snapshots/projecta__budget__tests__settings_fold_snapshot.snap
@@ -6,7 +6,7 @@ expression: limits_from_settings(&settings)
     BudgetLimits {
         profile_id: "claude",
         five_hour_pct: Some(
-            90,
+            95,
         ),
         seven_day_pct: Some(
             80,
diff --git a/src-tauri/src/snapshots/projecta__status__tests__format_tokens_snapshot.snap b/src-tauri/src/snapshots/projecta__status__tests__format_tokens_snapshot.snap
index f5ced26..aff3755 100644
--- a/src-tauri/src/snapshots/projecta__status__tests__format_tokens_snapshot.snap
+++ b/src-tauri/src/snapshots/projecta__status__tests__format_tokens_snapshot.snap
@@ -36,7 +36,7 @@ expression: cases
     (
         999999.0,
         Some(
-            "1000,0 k Tokens",
+            "1,0 M Tokens",
         ),
     ),
     (
diff --git a/src-tauri/src/status.rs b/src-tauri/src/status.rs
index 0621904..b192809 100644
--- a/src-tauri/src/status.rs
+++ b/src-tauri/src/status.rs
@@ -2031,25 +2031,33 @@ fn context_window_usage(window: Option<&ContextWindow>) -> (Option<String>, Opti
     (used, limit)
 }
 
+/// Render a token count for display, e.g. "999 Tokens" or "1,0 M Tokens";
+/// `None` if the value is not finite or negative.
 fn format_tokens(value: f64) -> Option<String> {
     if !value.is_finite() || value < 0.0 {
         return None;
     }
-    let (scaled, unit) = if value >= 1_000_000_000.0 {
-        (value / 1_000_000_000.0, "G")
-    } else if value >= 1_000_000.0 {
-        (value / 1_000_000.0, "M")
-    } else if value >= 1_000.0 {
-        (value / 1_000.0, "k")
-    } else {
-        (value, "")
-    };
-    let rendered = if unit.is_empty() {
-        format!("{:.0} Tokens", scaled)
-    } else {
-        format!("{:.1} {} Tokens", scaled, unit).replace('.', ",")
-    };
-    Some(rendered)
+    // The unit is picked *after* rounding, so 999_999.0 cannot render as
+    // "1000,0 k Tokens": the first unit whose rounded digits stay below 1000
+    // wins. The digits that pass that check are the digits shown, so the
+    // check and the display cannot round differently. G is the largest unit
+    // and keeps whatever it rounds to.
+    const UNITS: [(f64, &str, usize); 4] = [
+        (1.0, "", 0),
+        (1_000.0, " k", 1),
+        (1_000_000.0, " M", 1),
+        (1_000_000_000.0, " G", 1),
+    ];
+    let mut digits = String::new();
+    let mut unit = "";
+    for (scale, name, precision) in UNITS {
+        digits = format!("{:.*}", precision, value / scale);
+        unit = name;
+        if digits.parse::<f64>().is_ok_and(|rounded| rounded < 1000.0) {
+            break;
+        }
+    }
+    Some(format!("{}{} Tokens", digits.replace('.', ","), unit))
 }
 
 #[cfg(test)]
@@ -3343,6 +3351,26 @@ mod tests {
         insta::assert_debug_snapshot!(usage);
     }
 
+    /// Rounding to one decimal must not leave a value in a unit it has
+    /// outgrown: 999 999 tokens once read "1000,0 k Tokens". The unit is
+    /// chosen after rounding, so the display carries over to the next one.
+    #[test]
+    fn format_tokens_carries_over_to_the_next_unit_after_rounding() {
+        let rendered = |value: f64| format_tokens(value).expect("finite, non-negative");
+        // Rust rounds a tie to even: 0.5 shows as 0, 999.5 as 1000.
+        assert_eq!(rendered(0.5), "0 Tokens");
+        assert_eq!(rendered(999.4), "999 Tokens");
+        assert_eq!(rendered(999.5), "1,0 k Tokens");
+        assert_eq!(rendered(999_949.0), "999,9 k Tokens");
+        assert_eq!(rendered(999_950.0), "1,0 M Tokens");
+        assert_eq!(rendered(999_999.0), "1,0 M Tokens");
+        assert_eq!(rendered(999_949_999.0), "999,9 M Tokens");
+        assert_eq!(rendered(999_999_999.0), "1,0 G Tokens");
+        assert_eq!(rendered(999_949_999_999.0), "999,9 G Tokens");
+        // G is the largest unit; there is nothing to carry over into.
+        assert_eq!(rendered(999_999_999_999.0), "1000,0 G Tokens");
+    }
+
     /// [`format_tokens`] scales k/M/G and renders the German decimal comma;
     /// a snapshot table is cheaper to extend than a point assertion per
     /// magnitude and shows every boundary in one review.
```
