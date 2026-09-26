# Review-Auftrag: W1-26c — new_token()-Formassertion gegen redact::looks_secret (Rust, `src-tauri/src/api.rs`)

Du bist unabhängiger Code-Reviewer. Du hast an diesem Artefakt nicht mitgearbeitet.
Antworte auf Deutsch. Liefere Befunde als `X<n> — <hoch|mittel|niedrig> — <Stelle>` mit
Begründung und konkretem Fix-Vorschlag, danach einen Abschnitt "Geprüft und verworfen"
und ein Gesamturteil (mergebar ja/nein).

## Kontext

`redact::looks_secret`/`mask_token_runs` (W1-26/W1-26b) maskieren ein Segment aus
genau 32 kleingeschriebenen Hex-Zeichen — die Form, die `api::new_token` erzeugt
(`format!("{:032x}", u128)` aus 16 Zufallsbytes). Der Redact-Test in W1-26b konnte
nur gegen `oneshot::random_hex()` prüfen, weil `new_token` privat in `api.rs` ist
(einer Nahtstelle, die das W1-26b-Paket nicht ändern durfte). Befund
`.pa/review_w1-26b_disposition.md` C-X1/K-X3 (codex mittel, kimi niedrig): Driftet
`new_token` von dieser Form weg (Länge, Alphabet), bleibt der Redact-Test trotzdem
grün — er prüft ja nur `random_hex`, nicht `new_token`. Beide damaligen Reviewer
schlugen als Nacharbeit genau diesen Test vor.

## Dieses Paket (W1-26c)

Reine Testergänzung im `#[cfg(test)]`-Modul von `api.rs`, keine Produktcodeänderung.
Neuer Test `new_token_has_the_shape_redact_expects_to_mask`:
1. `new_token()` liefert einen String der Länge 32.
2. Jedes Zeichen ist `0-9` oder `a-f` (kleingeschrieben, kein `is_ascii_hexdigit()`,
   das auch Großbuchstaben zuließe).
3. `crate::redact::looks_secret(&new_token().unwrap())` ist `true`.

Drift-Beleg (nicht committet, nur lokal gezeigt): `new_token` testweise auf 31 Zeichen
bzw. auf Großbuchstaben umgestellt → dieser neue Test wird rot, der bisherige
Redact-Test (gegen `random_hex`) bleibt grün. Das zeigt, dass der neue Test genau die
Lücke schließt, die C-X1/K-X3 beschreiben.

Bitte besonders prüfen: Ist die Assertion (Länge 32, nur `0-9a-f`, `looks_secret`
true) wirklich äquivalent zu dem, was `redact::looks_secret`/`mask_token_runs`
erwarten (Blick in `redact.rs` falls nötig)? Ist der Test deterministisch (keine
Flakiness durch die Zufallsbytes — jede mögliche 32-stellige Hexfolge muss die
Assertion erfüllen)? Passt der Test zum Stil des Moduls? Gibt es eine bessere
Stelle/Formulierung? Ist die Doku-Begründung im Testkommentar korrekt und ehrlich?

## Diff (gegen `origin/main`)

```diff
diff --git a/src-tauri/src/api.rs b/src-tauri/src/api.rs
index 88e1547..b834db1 100644
--- a/src-tauri/src/api.rs
+++ b/src-tauri/src/api.rs
@@ -2426,6 +2426,25 @@ pub fn parse_request(head: &str, body: String) -> Option<Request> {
 #[cfg(test)]
 pub(crate) mod tests {
     use super::*;
+
+    /// W1-26b's `looks_secret`/`mask_token_runs` are coupled to
+    /// `oneshot::random_hex`'s shape, not to this function's — `new_token` is
+    /// private to this file, so `redact.rs` cannot assert against it
+    /// directly (see `.pa/review_w1-26b_disposition.md`, C-X1/K-X3). If
+    /// `new_token` ever drifts to a different length or an uppercase/mixed
+    /// alphabet, `redact::looks_secret` stops recognizing a real token and
+    /// this is the test that catches it.
+    #[test]
+    fn new_token_has_the_shape_redact_expects_to_mask() {
+        let token = new_token().unwrap();
+        assert_eq!(token.len(), 32, "{token}");
+        assert!(
+            token.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)),
+            "{token}"
+        );
+        assert!(crate::redact::looks_secret(&token), "{token}");
+    }
+
     #[test]
     fn continuous_policy_refusals_are_conflicts_not_server_failures() {
         for message in [
```
