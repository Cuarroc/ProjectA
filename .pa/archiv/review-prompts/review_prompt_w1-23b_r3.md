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


Hinweis: Zwei Reviews (glm-5.3, kimi-k3) liegen vor; Disposition im Diff. Prüfe unabhängig, auch ob die Disposition die Befunde korrekt behandelt.

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
diff --git a/.pa/report_w1-23b.md b/.pa/report_w1-23b.md
new file mode 100644
index 0000000..33e9b2b
--- /dev/null
+++ b/.pa/report_w1-23b.md
@@ -0,0 +1,94 @@
+# W1-23b: Snapshot-Nacharbeit zu PR #79
+
+Branch `claude/w1-23b-snapshot-polish`, PR #83, Basis `origin/main` @ `45b6a19`.
+
+## Befunde und Fixes
+
+- **S3 (Bug):** `status::format_tokens` wählte die Einheit vor der Rundung.
+  - 999 999 wurde als „1000,0 k Tokens“ angezeigt.
+  - Bisher unbemerkt: 999,5 wurde als „1000 Tokens“ angezeigt.
+  - Fix: Gewählt wird jetzt die kleinste Einheit, deren gerundete Ziffern unter 1000 bleiben. Angezeigt wird genau die Ziffernfolge, die diese Prüfung bestanden hat, also mit derselben Rundung (Rust-`{:.*}`, Rundung auf gerade). G ist die größte Einheit und läuft nicht weiter über.
+  - Der Snapshot `format_tokens_snapshot` zeigt für 999999 jetzt „1,0 M Tokens“.
+- **S1:** Der Doc-Kommentar von `budget::tests::settings_fold_snapshot` beschreibt jetzt ehrlich, was das Fixture ergänzt.
+  - Neu ist der Fall „Schlüssel zweimal gesetzt, der spätere Wert gewinnt“.
+  - Snapshot: claude `five_hour_pct` 90 → 95.
+- **S5:** `docs/decisions.md` hatte behauptet, im insta-Baum brauche nichts mehr als 1.66. Nachgemessen wurden die `rust-version`-Felder der lockfile-aufgelösten Crates unter insta:
+  - `console` 0.16.6 verlangt 1.71.
+  - `getrandom` 0.4.3 (über `tempfile`) verlangt 1.85, der höchste geprüfte Wert.
+  - `proc-macro2`, `quote`, `syn` 3.0.5, `serde_derive` und `unicode-ident` verlangen 1.71.
+  - `windows-sys`, `windows-link`, `r-efi` und `encode_unicode` lagen nicht in der lokalen Registry und sind ungeprüft.
+  - Alle gemessenen Werte liegen unter `rust-version = "1.89"` des Crates.
+- **S6:** `.gitattributes` enthält jetzt `*.snap text eol=lf`. `git ls-files --eol` zeigt alle fünf Snapshots bereits als `i/lf`, eine Renormalisierung ist nicht nötig.
+
+## Roter Lauf (gegen den unveränderten Code, Commit `62bbc55`)
+
+```
+$ CARGO_BUILD_JOBS=2 cargo test --bin projecta -- status::tests::format_tokens_carries_over_to_the_next_unit_after_rounding
+thread 'status::tests::format_tokens_carries_over_to_the_next_unit_after_rounding' (11267) panicked at src/status.rs:3353:9:
+assertion `left == right` failed
+  left: "1000 Tokens"
+ right: "1,0 k Tokens"
+test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 1237 filtered out; finished in 0.22s
+```
+
+## Grüne Läufe (Linux, lokal)
+
+- Nach dem Fix (`ee1abde`) und nach der Review-Nacharbeit (`5f9b018`): `cargo test --bin projecta -- status:: budget::` mit 106 passed, 0 failed.
+- `cargo clippy --all-targets -- -D warnings` grün.
+- Prepush-Bahn beim Push von `8949167` (`gates.sh lane prepush`), alle Gates grün:
+
+  | Gate | Dauer |
+  |---|---|
+  | fmt | 1 s |
+  | typecheck | 6 s |
+  | lint | 3 s |
+  | fe-test | 27 s |
+  | hq-test | 4 s |
+  | clippy | 1 s |
+  | rust-suite (nextest, 1346 Tests) | 48 s |
+
+- Der erste Push-Versuch wurde vom Gate „Arbeitsbaum verändert“ abgewiesen, weil ich während des Laufs Dateien geändert hatte. Das Gate hat korrekt gegriffen; der zweite Push mit sauberem Baum lief durch.
+
+## Implementierung und Reviews (Anbieter)
+
+- **Implementierung:**
+  - Ein erster Versuch über die OpenCode-CLI (1.18.32) mit kimi-k3 über Ollama Cloud hing beim Bootstrap: 403 auf `models.opencode.ai`, keine Ausgabe nach etwa 12 Minuten. Er wurde abgebrochen.
+  - Den Fix-Entwurf für `format_tokens` lieferte **glm-5.3** über Ollama Cloud, per API ohne Agenten-Schleife. Claude hat ihn geprüft, übernommen und nach Review R1 umgebaut.
+  - Tests, Doku und Snapshots stammen von Claude.
+- **Reviews** (siehe `.pa/review_w1-23b_disposition.md`):
+  - glm-5.3 (Ollama Cloud): Approve, 3 minor und 2 nit. R1, R2 und R4 sind behoben, R3 ist zurückgestellt, R5 ist geprüft.
+  - kimi-k3 (OpenCode Go): 1 nit, behoben. Das ist das unabhängige Review, weil glm-5.3 am Fix mitgeschrieben hat.
+- **Nicht erreicht:** Ollama Cloud antwortete zeitweise mit 502 und 429 (kimi-k3, deepseek-v4-pro, qwen3.5, minimax-m3, mistral-large-3). Moonshot direkt wurde bewusst nicht genutzt, weil dort nach Nutzung abgerechnet wird und AGENTS.md keine zusätzlichen Kosten erlaubt.
+
+## Nicht abgedeckt
+
+- Die Windows-Hälfte (`#[cfg(windows)]`-Tests, Windows-Arme von clippy) deckt nur die CI ab.
+- Die Bahn `linux` lief nicht lokal: Browser-Smoke, Frontend-Build und Workflow-Gates laufen in CI.
+- `-0.0` wird weiterhin als „-0 Tokens“ angezeigt (älteres Verhalten, Review R3, zurückgestellt).
+- Die MSRV von `windows-sys`, `windows-link`, `r-efi` und `encode_unicode` ist nicht gemessen.
+
+## Nachtrag 23.09., nach dem Merge von `main` (Koordination Welle 2)
+
+Der Branch war 40 Commits hinter `main` (#73, #75, #76, #80 u. a.). `main`
+(`c23e050`) ist per Merge-Commit `300001e` hereingeholt, ohne Konflikt.
+Die vom Post-Merge-Hook neu erzeugten `docs/dev-hq/data.{js,json}` sind
+verworfen, nicht committet.
+
+GitHub Actions ist seit 18:59 UTC wegen Billing gesperrt: Jeder Lauf bricht
+nach etwa 2 s ab. Deshalb sind die Gates **lokal auf `300001e`** gelaufen:
+
+- **Bahn `linux` vollständig grün.** Gates: no-masked, wf-shell, wf-pinned,
+  selftest-gates, selftest-red-first, selftest-review, fmt, typecheck, lint,
+  fe-test, hq-test, hq-visual, fe-build, e2e, clippy, rust-suite (nextest).
+  - `hq-visual` scheiterte im ersten Anlauf an der Umgebung: Playwright
+    suchte `chromium_headless_shell-1243`, installiert ist 1194.
+  - Mit einem lokalen `PLAYWRIGHT_BROWSERS_PATH` im Scratchpad, der die
+    vorhandene Headless-Shell 1194 unter dem erwarteten Namen verlinkt, liefen
+    alle 10 Tests grün. Danach lief die Bahn ab `hq-visual` durch.
+  - Das ist ein reiner Workaround in der Umgebung, der Repo-Code ist
+    unverändert. CI verwendet seine eigene Browser-Installation.
+- **`red-first` lokal** (`BASE_SHA=c23e050`, `HEAD_SHA=300001e`):
+  `format_tokens_carries_over_to_the_next_unit_after_rounding` ist an der
+  Merge-Base rot bzw. fehlt, am Kopf grün. Ergebnis `red-first: OK`.
+- **Nicht abgedeckt:** die Windows-Hälfte (`gates (windows)`). Sie ist erst
+  wieder prüfbar, wenn Actions läuft.
diff --git a/.pa/review_w1-23b_disposition.md b/.pa/review_w1-23b_disposition.md
new file mode 100644
index 0000000..2fa37f4
--- /dev/null
+++ b/.pa/review_w1-23b_disposition.md
@@ -0,0 +1,33 @@
+# W1-23b — Disposition der Reviews
+
+Reviews (beide Nicht-Anthropic, Prompt `.pa/review_prompt_w1-23b.md`):
+
+| Datei | Modell | Weg | Diff-Stand |
+|---|---|---|---|
+| `review_w1-23b_glm-5.3.md` | glm-5.3 | Ollama Cloud `/v1/chat/completions` | bis `8949167` (vor R1-Nacharbeit) |
+| `review_w1-23b_kimi-k3.md` | kimi-k3 | OpenCode Go `/zen/go/v1/chat/completions` | bis `5f9b018` (nach R1/R2/R4) |
+
+Einschränkung: glm-5.3 hat den ersten Entwurf von `format_tokens` formuliert
+und ist für S3 nicht unabhängig. kimi-k3 hat den Fix weder geschrieben noch
+gesehen, bevor es ihn prüfte, und ist damit das unabhängige Review. (Diff
+unter 300 Zeilen, keine Nahtstelle: ein Review wäre Pflicht gewesen.)
+
+## glm-5.3
+
+| ID | Schwere | Befund | Disposition |
+|---|---|---|---|
+| R1 | minor | Nachkommastellen doppelt gepflegt (Tabelle nur für die Probe, Literale für die Anzeige); „by construction“ stimmte nicht | **angenommen/behoben** in `5f9b018`: angezeigt wird genau die Ziffernfolge, die die <1000-Prüfung besteht. Ausgabe und Snapshots unverändert. |
+| R2 | minor | Rundung „half to even“ (0,5) und oberer G-Rand nicht festgehalten | **angenommen/behoben** in `5f9b018`: `0.5 → "0 Tokens"` und `999_949_999_999 → "999,9 G Tokens"` im Punkt-Test. |
+| R3 | nit | `-0.0` ergibt „-0 Tokens“ | **zurückgestellt**: Das Verhalten ist älter als diese Änderung. Die Werte stammen aus Token-Summen ≥ 0, die aus JSON geparst werden; `-0.0` kommt dort praktisch nicht vor. Ohne Beleg für ein reales Auftreten gehört es nicht in diesen Bugfix. |
+| R4 | minor | „effective floor … therefore 1.71“ aus einem einzigen Datenpunkt abgeleitet | **angenommen/behoben** in `5f9b018`: Lockfile-Baum unter insta nachgemessen, `getrandom` 0.4.3 verlangt 1.85. Nicht geprüfte Crates sind genannt. |
+| R5 | nit | Begründung im Kommentar zu `.gitattributes` unscharf; `git ls-files --eol` prüfen | **geprüft, kein Änderungsbedarf**: Alle fünf `.snap` stehen auf `i/lf w/lf attr/text eol=lf`, eine Renormalisierung ist nicht nötig. Die Begründung (insta vergleicht zeichengenau) bleibt so stehen. |
+
+## kimi-k3
+
+| ID | Schwere | Befund | Disposition |
+|---|---|---|---|
+| R1 | nit | „the highest value among the resolved crates that declare one“ passt nicht dazu, dass vier Crates ungeprüft sind | **angenommen/behoben**: Die Formulierung lautet jetzt „among the resolved crates checked“, die ungeprüften Crates sind als ungeprüft benannt. |
+
+Sonst ohne Befund. kimi-k3 hat die Grenzfälle von `format_tokens` einzeln
+nachgerechnet (0,4 / 0,5 / 999,4 / 999,5 / 999 949 / 999 950 / 999 999 /
+≥1e12 / nicht endlich).
diff --git a/docs/decisions.md b/docs/decisions.md
index 82b0ec5..7e3938a 100644
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
+the resolved crates checked (`windows-sys`, `windows-link`, `r-efi` and
+`encode_unicode` were not in the local registry and are unchecked). Corrected 2026-09-23 in W1-23b — the
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
