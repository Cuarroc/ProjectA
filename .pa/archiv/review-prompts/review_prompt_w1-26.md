# Review-Auftrag — W1-26: 32-Hex-API-Tokens im Log maskieren (PR #73)

Du bist unabhängiger Code-Reviewer. Du hast den Code nicht geschrieben.
Autor: Claude Code (Cloud-Sitzung). Du bist die anbieterfremde Gegenprobe.

## Kontext

ProjectA ist eine Tauri-2-App (Rust), die CLI-Agenten in PTYs startet und
eine lokale HTTP-API anbietet. `src-tauri/src/redact.rs` maskiert
geheimnisartige Segmente in Log-Zeilen, bevor sie geschrieben werden. Bisher
erkannte es nur Anbieter-Präfixe (`sk-`, `ghp_`, `AIza`, …, Mindestlänge 12)
und PEM-Header.

**Befund W1-26:** Die eigenen API-/Verdict-Tokens der App haben kein Präfix.
Sie entstehen so (`src-tauri/src/api.rs`, unverändert):

```rust
fn new_token() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| format!("failed to draw an api token: {e}"))?;
    Ok(format!("{:032x}", u128::from_be_bytes(bytes)))
}
```

Solche Tokens konnten unmaskiert im Log landen (`token=<hex>`,
`Bearer <hex>`, nackt). **Fix:** Ein Segment, das exakt 32 Zeichen lang ist
und nur aus `0-9a-f` besteht, gilt als Geheimnis. **Ziel zugleich:**
Falsch-Positive vermeiden (40-stellige Git-SHA, Kurz-SHA, UUID mit
Bindestrichen, Großbuchstaben-Hex bleiben lesbar).

Unveränderter Kontext zur Segmentierung (gilt für den Diff): Text wird an
Whitespace in Tokens geteilt; jedes Token wird an allen Zeichen außer
`[A-Za-z0-9_-]` (`is_key_char`) in Segmente zerlegt, und jedes Segment wird
einzeln mit `looks_secret` beurteilt. `-` und `_` gehören also **zum**
Segment.

## Worauf du achten sollst

1. Wirksamkeit: Gibt es realistische Einbettungen eines echten Tokens
   (Präfixe mit `-`/`_`, URL-Pfade, JSON, Query-Strings, Zeilenumbrüche,
   Streaming-Grenzen im `Redactor`), in denen es trotzdem unmaskiert bleibt?
2. Falsch-Positive: Welche legitimen 32-Hex-Werte werden jetzt maskiert
   (MD5, Hashes, IDs im eigenen Code), und ist das akzeptabel? Ist die
   Beschränkung auf Kleinbuchstaben richtig begründet?
3. Wechselwirkung mit `MIN_SECRET_LEN` und den Präfix-Regeln; Unicode-/
   Byte-Längen-Fallen (`len()` in Bytes vs. Zeichen).
4. Tests: Belegen sie, was sie behaupten? Fehlt ein wichtiger Fall?
5. Alles, was dir sonst auffällt.

## Antwortformat

Befunde als Liste: ID (X1, X2 …), Schwere (hoch/mittel/niedrig), Datei:Zeile
(im Diff), konkretes Fehlerszenario, Fix-Vorschlag. Danach geprüfte und
verworfene Punkte in je einer Zeile. Zum Schluss ein Urteil:
mergebereit / nach Überarbeitung / ablehnen. Deutsch, knapp. Keine Befunde
erfinden: „keine Befunde" ist eine gültige Antwort.

## Der Diff (gegen `main` @ c26c6ab)

```diff
diff --git a/src-tauri/src/redact.rs b/src-tauri/src/redact.rs
index 8f9a14f..d1ac669 100644
--- a/src-tauri/src/redact.rs
+++ b/src-tauri/src/redact.rs
@@ -16,9 +16,14 @@
 //! [`Redactor::flush`]) says it is complete.
 //!
 //! What counts as a secret is a heuristic and says so: a short list of the
-//! prefixes the providers this app talks to actually mint, plus the shape of a
-//! PEM header. It is a seatbelt on a path that should not be carrying secrets
-//! in the first place, not a scanner.
+//! prefixes the providers this app talks to actually mint, the shape of a PEM
+//! header, and - since W1-26 - the exact shape of this app's own API/verdict
+//! tokens (`api::new_token`): exactly 32 lowercase hex characters and no
+//! prefix at all. That shape is deliberately exact and case-sensitive (not
+//! "32-ish hex characters"), so it does not also catch a 40-character git
+//! SHA or a hyphenated UUID; see [`is_token_shaped`] for the trade-off that
+//! leaves open. It is a seatbelt on a path that should not be carrying
+//! secrets in the first place, not a scanner.
 
 /// What replaces a token that looks like a secret.
 pub const MASK: &str = "[redacted]";
@@ -42,6 +47,38 @@ const SECRET_PREFIXES: [&str; 9] = [
 /// its own, or `AKIA` as a word in a sentence, says nothing.
 const MIN_SECRET_LEN: usize = 12;
 
+/// The exact length of an API/verdict token: `api::new_token` draws 16
+/// random bytes and formats them as `format!("{:032x}", ...)` - always 32
+/// lowercase hex digits, never more, never less, and with no prefix a
+/// `SECRET_PREFIXES` check could ever catch.
+const TOKEN_HEX_LEN: usize = 32;
+
+/// Is this segment exactly the shape `api::new_token` mints?
+///
+/// The length has to be exact, not "at least": a 40-character git SHA or a
+/// 36-character hyphenated UUID must not be swept up just for being made of
+/// hex-ish characters. Segmentation in [`redact_token`] already isolates this
+/// from surrounding punctuation, so `token=<hex>` and `Bearer <hex>` both
+/// reach this check with only the hex part as `segment`.
+///
+/// Only ASCII `0`-`9` and lowercase `a`-`f` count, matching `{:032x}`
+/// exactly - the same case-sensitivity `SECRET_PREFIXES` already relies on.
+/// An uppercase or mixed-case 32-character string (an uppercase MD5 digest,
+/// a bare Windows GUID) is therefore not touched.
+///
+/// This does mean a bare *lowercase* 32-hex string that is not one of our
+/// tokens - a lowercase MD5 digest is the one real case - is masked too.
+/// Given how the tokens are actually embedded in log lines (`token=`,
+/// `Bearer `, or alone), there is no cheap way to tell the two apart from the
+/// string alone, and a token that leaks is worse than a hash that gets
+/// masked by mistake.
+fn is_token_shaped(segment: &str) -> bool {
+    segment.len() == TOKEN_HEX_LEN
+        && segment
+            .bytes()
+            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
+}
+
 /// Characters a provider token is made of. Everything else - quotes, `=`,
 /// commas, brackets - is punctuation around it, and is where a token is cut
 /// into the segments [`looks_secret`] judges.
@@ -64,6 +101,8 @@ pub fn looks_secret(segment: &str) -> bool {
         // A PEM header never appears alone, but its first line is enough to
         // catch the block it opens.
         || segment.contains("PRIVATE-KEY")
+        // api::new_token has no prefix at all - only its fixed 32-hex shape.
+        || is_token_shaped(segment)
 }
 
 /// Mask the secret-looking segments of one whitespace-delimited token, leaving
@@ -204,6 +243,64 @@ mod tests {
         assert!(!whole.contains("ghp_"), "{whole}");
     }
 
+    #[test]
+    fn a_32_hex_token_is_masked() {
+        // api::new_token mints exactly this shape: format!("{:032x}", ...) on
+        // 16 random bytes - 32 lowercase hex characters, no prefix at all.
+        // Embedded the way logging.rs and the handlers actually write it.
+        let token = "0123456789abcdef0123456789abcdef";
+        assert_eq!(token.len(), 32, "fixture must be 32 chars: {token}");
+
+        assert_eq!(
+            redact(&format!("token={token}")),
+            "token=[redacted]",
+            "token=<hex> form"
+        );
+        assert_eq!(
+            redact(&format!("Bearer {token}")),
+            "Bearer [redacted]",
+            "Bearer <hex> form"
+        );
+        assert_eq!(redact(token), "[redacted]", "bare token");
+    }
+
+    #[test]
+    fn hex_lookalikes_are_not_masked() {
+        // A git SHA-1 is 40 hex characters, eight more than a token.
+        let sha40 = "abcdef0123456789abcdef0123456789abcdef01";
+        assert_eq!(sha40.len(), 40);
+        assert_eq!(redact(sha40), sha40, "40-char sha stays untouched");
+
+        // An abbreviated git SHA is far shorter.
+        assert_eq!(redact("commit abc1234 done"), "commit abc1234 done");
+
+        // A UUID is 32 hex digits too, but with hyphens breaking it up -
+        // still 36 characters as one segment, and not the token shape.
+        let uuid = "550e8400-e29b-41d4-a716-446655440000";
+        assert_eq!(redact(uuid), uuid, "hyphenated uuid stays untouched");
+
+        // 31 and 33 hex characters must not match either - the length has to
+        // be exact, not "roughly 32".
+        let hex31 = "0123456789abcdef0123456789abcde";
+        assert_eq!(hex31.len(), 31);
+        assert_eq!(redact(hex31), hex31);
+        let hex33 = "0123456789abcdef0123456789abcdef0";
+        assert_eq!(hex33.len(), 33);
+        assert_eq!(redact(hex33), hex33);
+
+        // api::new_token is lowercase-only (`{:032x}`); an uppercase 32-hex
+        // string - a Windows-style GUID without braces/hyphens, or an
+        // uppercase MD5 - is not this app's token shape and stays readable.
+        let upper32 = "0123456789ABCDEF0123456789ABCDEF";
+        assert_eq!(upper32.len(), 32);
+        assert_eq!(redact(upper32), upper32, "uppercase hex stays untouched");
+
+        // A mixed-case 32-hex string is not the exact lowercase shape either.
+        let mixed32 = "0123456789abcdef0123456789ABCDEF";
+        assert_eq!(mixed32.len(), 32);
+        assert_eq!(redact(mixed32), mixed32, "mixed-case hex stays untouched");
+    }
+
     #[test]
     fn punctuation_around_a_key_does_not_hide_it_and_survives_it() {
         for (wrapped, expected) in [
```
