# Review-Auftrag: W1-26b — Token-Maskierung härten (Rust, `src-tauri/src/redact.rs`)

Du bist unabhängiger Code-Reviewer. Du hast an diesem Artefakt nicht mitgearbeitet.
Antworte auf Deutsch. Liefere Befunde als `X<n> — <hoch|mittel|niedrig> — <Stelle>` mit Begründung und konkretem Fix-Vorschlag, danach einen Abschnitt "Geprüft und verworfen" und ein Gesamturteil (mergebar ja/nein).

## Kontext

`redact.rs` maskiert Secrets in Text, bevor er auf Platte/ins Log geht. Text wird an Whitespace in Tokens zerlegt (der streamingfähige `Redactor` hält ein unvollständiges End-Token zurück), jedes Token wird an Nicht-Key-Chars (`is_key_char` = ASCII-alphanumerisch, `-`, `_`) in Segmente zerlegt, und jedes Segment wird mit `looks_secret` geprüft.
Das Vorgänger-Paket W1-26 (PR #73) hat eine Regel ergänzt: Ein Segment aus genau 32 kleingeschriebenen Hex-Zeichen (die Form von `api::new_token` bzw. `oneshot::random_hex`: `format!("{:032x}", u128)` aus 16 Zufallsbytes) wird maskiert. Drei externe Reviews fanden: (X1) ein an Wortzeichen geklebtes Token (`tok_<hex>`, `verdict-<hex>`, ANSI `…m<hex>`) rutscht durch; (X2) Bindestrich-lose UUIDs als Falsch-Positive undokumentiert; (X3) Kopplung an das echte Token-Format nur per Kommentar; (X4) kein Streaming-Test über Chunk-Grenzen.

## Dieses Paket (W1-26b)

a) Neue Funktion `mask_token_runs`: sucht im Segment maximale Läufe aus `0-9a-f` und maskiert einen Lauf von GENAU 32 Zeichen (nur den Lauf). Bewusst nicht: 33er-Läufe (`a<hex>`), 64er-Läufe (zwei Tokens hintereinander = auch SHA-256-Form), 40er (Git-SHA).
b) Test gegen `oneshot::random_hex()` (gleiches Format wie `api::new_token`; letzteres ist privat in `api.rs`, einer Nahtstelle, die dieses Paket nicht ändern darf).
c) Streaming-Test: jeder Split-Offset und zeichenweise.
d) Doku der verbleibenden Lücken und der Falsch-Positive.

Bitte besonders prüfen: Korrektheit von `mask_token_runs` (Grenzen, Char-Boundaries/Panics bei Nicht-ASCII — kann ein Segment Nicht-ASCII enthalten?), ob neue Falsch-Positive entstehen, die die Abwägung kippen, ob die Tests das Behauptete wirklich belegen, und ob die Doku ehrlich ist.

## Diff (gegen den Stand von PR #73)

```diff
diff --git a/src-tauri/src/redact.rs b/src-tauri/src/redact.rs
index e43f21a..dd02cdc 100644
--- a/src-tauri/src/redact.rs
+++ b/src-tauri/src/redact.rs
@@ -24,9 +24,10 @@
 //! shape is deliberately exact and case-sensitive (not "32-ish hex
 //! characters"), so it does not also catch a 40-character git SHA or a
 //! hyphenated UUID; see [`is_token_shaped`] for the false positives that
-//! leaves open, and the segmentation gap it does not close. It is a seatbelt
-//! on a path that should not be carrying secrets in the first place, not a
-//! scanner.
+//! leaves open. Since W1-26b the shape is also found as a run *inside* a
+//! segment ([`mask_token_runs`]), so a token glued to a word is masked too.
+//! It is a seatbelt on a path that should not be carrying secrets in the first
+//! place, not a scanner.
 
 /// What replaces a token that looks like a secret.
 pub const MASK: &str = "[redacted]";
@@ -65,9 +66,9 @@ const TOKEN_HEX_LEN: usize = 32;
 /// The length has to be exact, not "at least": a 40-character git SHA or a
 /// 36-character hyphenated UUID must not be swept up just for being made of
 /// hex-ish characters. [`redact_token`] only splits on characters outside
-/// [`is_key_char`] (not hex-vs-non-hex), so this check only ever sees the
-/// hex shape cleanly when a token is not itself glued to other key-chars -
-/// see the known gap noted below.
+/// [`is_key_char`] (not hex-vs-non-hex), so this check only sees a token that
+/// is not glued to other key characters - [`mask_token_runs`] covers the rest,
+/// see below.
 ///
 /// Only ASCII `0`-`9` and lowercase `a`-`f` count, matching `{:032x}`
 /// exactly - the same case-sensitivity `SECRET_PREFIXES` already relies on.
@@ -87,27 +88,62 @@ const TOKEN_HEX_LEN: usize = 32;
 /// alone, and a token that leaks is worse than one of these getting masked by
 /// mistake.
 ///
-/// **Known gap, not fixed by this rule:** [`redact_token`] only splits at
-/// characters *outside* [`is_key_char`] (alphanumeric, `-`, `_`), so a token
-/// that is glued to surrounding letters, digits, `-` or `_` is not isolated
-/// into its own segment and this check never sees it in isolation - it stays
-/// unmasked. For example `tok_<hex>`, `verdict-<hex>`, `<hex>_x`, a
-/// `{:?}`-debug-formatted line where a real newline is written out as the two
-/// literal characters `\` and `n` (`\` splits the segment, but `n` is a key
-/// char, so the token ends up glued as `n<hex>`), an ANSI-colored
-/// `\x1b[32m<hex>` (the same mechanism leaves `m<hex>`), a URL-encoded
-/// `%3D<hex>`, or two tokens written back to back (64 hex characters as one
-/// segment) all pass through unmasked today. No place in this repository
-/// currently embeds a token this way, but the segmentation does not rule it
-/// out. Closing this gap needs run-based detection (scanning for a 32-hex run
-/// anywhere in a segment, not just segment-equality) and is deliberately left
-/// as follow-up work, not part of this fix - see
-/// `a_token_glued_to_a_word_is_a_known_gap` below.
+/// A token glued to other key characters (`tok_<hex>`, `verdict-<hex>`) is not
+/// its own segment, because [`redact_token`] only splits at characters outside
+/// [`is_key_char`]; since W1-26b [`mask_token_runs`] finds the 32-hex run
+/// inside such a segment instead. This function stays the whole-segment test
+/// [`looks_secret`] uses.
+///
+/// A lowercase hex *UUID without hyphens* - Python's `uuid4().hex`, .NET's
+/// `Guid.ToString("N")` - is exactly this shape as well and is masked too.
+/// Another known false positive, for the same reason as the MD5 digest.
 fn is_token_shaped(segment: &str) -> bool {
-    segment.len() == TOKEN_HEX_LEN
-        && segment
-            .bytes()
-            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
+    segment.len() == TOKEN_HEX_LEN && segment.bytes().all(is_token_hex)
+}
+
+/// Is this byte part of the `{:032x}` alphabet - `0`-`9` and lowercase `a`-`f`?
+fn is_token_hex(b: u8) -> bool {
+    b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
+}
+
+/// Mask every maximal run of exactly [`TOKEN_HEX_LEN`] token-hex characters
+/// inside a segment, leaving the rest of it as it was.
+///
+/// This is what catches a token glued to a word: `tok_<hex>`,
+/// `verdict-<hex>`, `<hex>_x`, a `{:?}`-debug line where a newline became the
+/// two characters `\` and `n` (leaving `n<hex>`), an ANSI-colored
+/// `\x1b[32m<hex>` (leaving `m<hex>`), or a URL-encoded `%3D<hex>` (uppercase
+/// `D` is not in the alphabet). The run must be *maximal*: a 40-character git
+/// SHA or a 64-character SHA-256 digest glued to a word is still not touched.
+///
+/// **Known gaps:** a token glued to a character that is itself lowercase hex
+/// or a digit (`a<hex>`, `cafe<hex>`, `v1<hex>`) merges into a longer run and
+/// stays unmasked, and so do two tokens written back to back (one 64-character
+/// run). Masking every multiple of 32 would close the latter only by also
+/// masking every SHA-256 digest, which is common in logs (lockfiles, image
+/// digests); a leak needs a token to be glued this way, which no place in the
+/// repository does today.
+fn mask_token_runs(segment: &str) -> String {
+    let bytes = segment.as_bytes();
+    let mut out = String::with_capacity(segment.len());
+    let mut start = 0;
+    while start < bytes.len() {
+        let hex = is_token_hex(bytes[start]);
+        let end = bytes[start..]
+            .iter()
+            .position(|&b| is_token_hex(b) != hex)
+            .map_or(bytes.len(), |len| start + len);
+        // Both ends sit on ASCII bytes (or the end of the string), so the
+        // slice is always on a char boundary.
+        let run = &segment[start..end];
+        if hex && run.len() == TOKEN_HEX_LEN {
+            out.push_str(MASK);
+        } else {
+            out.push_str(run);
+        }
+        start = end;
+    }
+    out
 }
 
 /// Characters a provider token is made of. Everything else - quotes, `=`,
@@ -145,7 +181,7 @@ fn redact_token(token: &str) -> String {
         if looks_secret(segment) {
             out.push_str(MASK);
         } else {
-            out.push_str(segment);
+            out.push_str(&mask_token_runs(segment));
         }
         segment.clear();
     };
@@ -317,45 +353,98 @@ mod tests {
     }
 
     #[test]
-    fn a_token_glued_to_a_word_is_a_known_gap() {
-        // Documented gap (see is_token_shaped's doc comment): redact_token
-        // only splits at characters outside is_key_char, and '_' and '-' are
-        // both key chars, so a token glued to a word via one of them - or to
-        // another word with no separator at all - is not isolated into its
-        // own segment and slips through unmasked. This test asserts today's
-        // actual (unwanted) behaviour; closing it is follow-up work
-        // (run-based token detection), not part of this fix.
+    fn a_token_glued_to_a_word_is_masked() {
+        // W1-26b: redact_token only splits at characters outside is_key_char,
+        // and '_' and '-' are both key chars, so a token glued to a word is
+        // not its own segment. The run of exactly 32 lowercase hex characters
+        // inside the segment is masked anyway, and only that run - the word
+        // it is glued to stays readable.
         let token = "0123456789abcdef0123456789abcdef";
+        for (glued, expected) in [
+            (format!("tok_{token}"), "tok_[redacted]".to_string()),
+            (format!("verdict-{token}"), "verdict-[redacted]".to_string()),
+            (format!("{token}_x"), "[redacted]_x".to_string()),
+            // A `{:?}`-formatted newline is a literal `\` + `n`; `\` splits
+            // the segment, `n` is left glued to the token.
+            (format!("line\\n{token}"), "line\\n[redacted]".to_string()),
+            // ANSI color: `\x1b[32m` leaves an `m` glued to the token.
+            (
+                format!("\x1b[32m{token}\x1b[0m"),
+                "\x1b[32m[redacted]\x1b[0m".to_string(),
+            ),
+            // URL-encoded `=`: the uppercase `D` is not part of the run.
+            (format!("a%3D{token}"), "a%3D[redacted]".to_string()),
+        ] {
+            assert_eq!(redact(&glued), expected, "{glued:?}");
+        }
+    }
 
-        let glued_prefix = format!("tok_{token}");
-        assert_eq!(
-            redact(&glued_prefix),
-            glued_prefix,
-            "dokumentierte Lücke, Folgeauftrag"
-        );
-
-        let glued_suffix = format!("verdict-{token}");
-        assert_eq!(
-            redact(&glued_suffix),
-            glued_suffix,
-            "dokumentierte Lücke, Folgeauftrag"
-        );
+    #[test]
+    fn hex_runs_of_other_lengths_inside_a_segment_are_not_masked() {
+        let token = "0123456789abcdef0123456789abcdef";
+        // Two tokens back to back are one 64-character run, which is also
+        // the shape of a SHA-256 digest - left alone on purpose (see
+        // is_token_shaped): exact 32, not "a multiple of 32".
+        let doubled = format!("{token}{token}");
+        assert_eq!(redact(&doubled), doubled);
+        // A git SHA glued to a word stays a 40-character run.
+        let sha = "commit_abcdef0123456789abcdef0123456789abcdef01";
+        assert_eq!(redact(sha), sha);
+        // A hex letter glued in front lengthens the run to 33: this is the
+        // gap run-based detection leaves open (see is_token_shaped).
+        let hexglued = format!("a{token}");
+        assert_eq!(redact(&hexglued), hexglued);
+        // A hyphenated UUID is five short runs, none of them 32.
+        let uuid = "id-550e8400-e29b-41d4-a716-446655440000";
+        assert_eq!(redact(uuid), uuid);
+    }
 
-        let glued_trailing = format!("{token}_x");
-        assert_eq!(
-            redact(&glued_trailing),
-            glued_trailing,
-            "dokumentierte Lücke, Folgeauftrag"
-        );
+    #[test]
+    fn the_tokens_this_app_mints_are_masked() {
+        // Couples this rule to the real minting code instead of a comment: if
+        // the token format ever changed shape, this goes red. It calls
+        // oneshot::random_hex (hook secrets), which formats 16 random bytes
+        // with the same `{:032x}` as api::new_token; api::new_token itself is
+        // private to api.rs and cannot be reached from here without changing
+        // that seam.
+        for _ in 0..64 {
+            let token = crate::oneshot::random_hex();
+            assert!(looks_secret(&token), "{token}");
+            assert_eq!(redact(&token), MASK, "{token}");
+            assert_eq!(redact(&format!("Bearer {token}")), "Bearer [redacted]");
+            assert_eq!(redact(&format!("tok_{token}")), "tok_[redacted]");
+        }
+    }
 
-        // Two tokens back to back form one 64-character segment, which is
-        // not the exact 32-length shape either.
-        let doubled = format!("{token}{token}");
-        assert_eq!(
-            redact(&doubled),
-            doubled,
-            "dokumentierte Lücke, Folgeauftrag"
-        );
+    #[test]
+    fn a_token_split_at_every_offset_is_still_masked() {
+        // Redactor holds back a token until whitespace proves it complete, so
+        // no chunk boundary may let the 32-hex shape through - bare, after a
+        // prefix, or glued to a word.
+        let token = "0123456789abcdef0123456789abcdef";
+        for text in [
+            format!("Bearer {token} ok"),
+            format!("x tok_{token}\n"),
+            format!("verdict-{token}_x,y"),
+            token.to_string(),
+        ] {
+            let whole = redact(&text);
+            assert!(!whole.contains(token), "{whole}");
+            for cut in 0..=text.len() {
+                let mut redactor = Redactor::default();
+                let mut out = redactor.push(&text[..cut]);
+                out.push_str(&redactor.push(&text[cut..]));
+                out.push_str(&redactor.flush());
+                assert_eq!(out, whole, "{text:?} cut at {cut}");
+            }
+            let mut redactor = Redactor::default();
+            let mut out = String::new();
+            for ch in text.chars() {
+                out.push_str(&redactor.push(&ch.to_string()));
+            }
+            out.push_str(&redactor.flush());
+            assert_eq!(out, whole, "{text:?} one char at a time");
+        }
     }
 
     #[test]
```

## Vollständige Datei nach der Änderung

```rust
//! Redaction that survives being fed in pieces.
//!
//! ProjectA deliberately does not persist raw terminal output (see
//! [`crate::store::Message`]), but it does persist text a human or an agent
//! typed - task descriptions, system notes - and since Phase 18 it writes some
//! of that into a file in the repository's `.pa/` directory. Anything that
//! copies text out of the app and onto disk is a place a pasted API key can
//! come to rest.
//!
//! The rule this module exists to enforce comes from the CCUI2 review, where
//! redaction was applied per pipe chunk: a key that arrived as `sk-a` in one
//! read and `nt-...` in the next matched nothing in either half and went
//! through unredacted. **Chunk on whitespace, then redact, then store.** A
//! secret has no whitespace in it, so a token that is still growing is a token
//! that cannot be judged yet - [`Redactor`] holds it back until whitespace (or
//! [`Redactor::flush`]) says it is complete.
//!
//! What counts as a secret is a heuristic and says so: a short list of the
//! prefixes the providers this app talks to actually mint, the shape of a PEM
//! header, and - since W1-26 - the exact shape of this app's own API/verdict
//! tokens (`api::new_token`) *and* its hook secrets (`oneshot::random_hex`,
//! used from `hooks.rs`): both mint exactly 32 lowercase hex characters
//! (`format!("{:032x}", ...)` on 16 random bytes) with no prefix at all. That
//! shape is deliberately exact and case-sensitive (not "32-ish hex
//! characters"), so it does not also catch a 40-character git SHA or a
//! hyphenated UUID; see [`is_token_shaped`] for the false positives that
//! leaves open. Since W1-26b the shape is also found as a run *inside* a
//! segment ([`mask_token_runs`]), so a token glued to a word is masked too.
//! It is a seatbelt on a path that should not be carrying secrets in the first
//! place, not a scanner.

/// What replaces a token that looks like a secret.
pub const MASK: &str = "[redacted]";

/// Prefixes that mark a provider token. Matched case-sensitively: every one of
/// these is minted in exactly this case, and matching loosely would redact
/// ordinary prose that happens to start the same way.
const SECRET_PREFIXES: [&str; 9] = [
    "sk-",         // OpenAI, Anthropic (`sk-ant-`), and most of the copies
    "ghp_",        // GitHub personal access token
    "gho_",        // GitHub OAuth token
    "ghs_",        // GitHub server-to-server token
    "github_pat_", // GitHub fine-grained token
    "xoxb-",       // Slack bot token
    "xoxp-",       // Slack user token
    "AIza",        // Google API key
    "AKIA",        // AWS access key id
];

/// Below this length a match is more likely to be prose than a key: `sk-` on
/// its own, or `AKIA` as a word in a sentence, says nothing.
const MIN_SECRET_LEN: usize = 12;

/// The exact length of an API/verdict token: `api::new_token` draws 16
/// random bytes and formats them as `format!("{:032x}", ...)` - always 32
/// lowercase hex digits, never more, never less, and with no prefix a
/// `SECRET_PREFIXES` check could ever catch. The hook secrets minted by
/// [`crate::oneshot::random_hex`] (used from `hooks.rs`) are drawn the same
/// way and formatted with the same `{:032x}`, so this length and the rule
/// below cover both.
const TOKEN_HEX_LEN: usize = 32;

/// Is this segment exactly the shape `api::new_token` (and
/// `oneshot::random_hex`) mints?
///
/// The length has to be exact, not "at least": a 40-character git SHA or a
/// 36-character hyphenated UUID must not be swept up just for being made of
/// hex-ish characters. [`redact_token`] only splits on characters outside
/// [`is_key_char`] (not hex-vs-non-hex), so this check only sees a token that
/// is not glued to other key characters - [`mask_token_runs`] covers the rest,
/// see below.
///
/// Only ASCII `0`-`9` and lowercase `a`-`f` count, matching `{:032x}`
/// exactly - the same case-sensitivity `SECRET_PREFIXES` already relies on.
/// An uppercase or mixed-case 32-character string (an uppercase MD5 digest,
/// a bare Windows GUID) is therefore not touched.
///
/// This does mean a bare *lowercase* 32-hex string that is not one of our
/// tokens is masked too. Known false positives, none of them minted by this
/// app today but plausible in adjacent text: a lowercase MD5 digest, a
/// filename such as `agent-access/<hex>.json` (`api/agent_access.rs`, the
/// stem is `new_token()`), a W3C trace id, or any other 32-lowercase-hex
/// value that lands in message text - which `digest.rs` renders into `.pa/`
/// and `diagnosis.rs` exports; its test fixtures at `diagnosis.rs:430-445`
/// use exactly this shape to prove such values are *not* torn out. However
/// the segment ends up in text - after `token=`, `Bearer `, a header name, or
/// on its own - there is no cheap way to tell these apart from the string
/// alone, and a token that leaks is worse than one of these getting masked by
/// mistake.
///
/// A token glued to other key characters (`tok_<hex>`, `verdict-<hex>`) is not
/// its own segment, because [`redact_token`] only splits at characters outside
/// [`is_key_char`]; since W1-26b [`mask_token_runs`] finds the 32-hex run
/// inside such a segment instead. This function stays the whole-segment test
/// [`looks_secret`] uses.
///
/// A lowercase hex *UUID without hyphens* - Python's `uuid4().hex`, .NET's
/// `Guid.ToString("N")` - is exactly this shape as well and is masked too.
/// Another known false positive, for the same reason as the MD5 digest.
fn is_token_shaped(segment: &str) -> bool {
    segment.len() == TOKEN_HEX_LEN && segment.bytes().all(is_token_hex)
}

/// Is this byte part of the `{:032x}` alphabet - `0`-`9` and lowercase `a`-`f`?
fn is_token_hex(b: u8) -> bool {
    b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
}

/// Mask every maximal run of exactly [`TOKEN_HEX_LEN`] token-hex characters
/// inside a segment, leaving the rest of it as it was.
///
/// This is what catches a token glued to a word: `tok_<hex>`,
/// `verdict-<hex>`, `<hex>_x`, a `{:?}`-debug line where a newline became the
/// two characters `\` and `n` (leaving `n<hex>`), an ANSI-colored
/// `\x1b[32m<hex>` (leaving `m<hex>`), or a URL-encoded `%3D<hex>` (uppercase
/// `D` is not in the alphabet). The run must be *maximal*: a 40-character git
/// SHA or a 64-character SHA-256 digest glued to a word is still not touched.
///
/// **Known gaps:** a token glued to a character that is itself lowercase hex
/// or a digit (`a<hex>`, `cafe<hex>`, `v1<hex>`) merges into a longer run and
/// stays unmasked, and so do two tokens written back to back (one 64-character
/// run). Masking every multiple of 32 would close the latter only by also
/// masking every SHA-256 digest, which is common in logs (lockfiles, image
/// digests); a leak needs a token to be glued this way, which no place in the
/// repository does today.
fn mask_token_runs(segment: &str) -> String {
    let bytes = segment.as_bytes();
    let mut out = String::with_capacity(segment.len());
    let mut start = 0;
    while start < bytes.len() {
        let hex = is_token_hex(bytes[start]);
        let end = bytes[start..]
            .iter()
            .position(|&b| is_token_hex(b) != hex)
            .map_or(bytes.len(), |len| start + len);
        // Both ends sit on ASCII bytes (or the end of the string), so the
        // slice is always on a char boundary.
        let run = &segment[start..end];
        if hex && run.len() == TOKEN_HEX_LEN {
            out.push_str(MASK);
        } else {
            out.push_str(run);
        }
        start = end;
    }
    out
}

/// Characters a provider token is made of. Everything else - quotes, `=`,
/// commas, brackets - is punctuation around it, and is where a token is cut
/// into the segments [`looks_secret`] judges.
fn is_key_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '-' || c == '_'
}

/// Does this segment look like a secret?
///
/// A *segment*, not a whole whitespace token: `KEY=sk-ant-...` is one token
/// and two segments, and only the second one is the key. Masking the token
/// would take the variable name with it and tell the reader less, not more.
pub fn looks_secret(segment: &str) -> bool {
    if segment.len() < MIN_SECRET_LEN {
        return false;
    }
    SECRET_PREFIXES
        .iter()
        .any(|prefix| segment.starts_with(prefix))
        // A PEM header never appears alone, but its first line is enough to
        // catch the block it opens.
        || segment.contains("PRIVATE-KEY")
        // api::new_token has no prefix at all - only its fixed 32-hex shape.
        || is_token_shaped(segment)
}

/// Mask the secret-looking segments of one whitespace-delimited token, leaving
/// everything around them exactly as it was.
fn redact_token(token: &str) -> String {
    let mut out = String::with_capacity(token.len());
    let mut segment = String::new();
    let flush = |segment: &mut String, out: &mut String| {
        if looks_secret(segment) {
            out.push_str(MASK);
        } else {
            out.push_str(&mask_token_runs(segment));
        }
        segment.clear();
    };
    for ch in token.chars() {
        if is_key_char(ch) {
            segment.push(ch);
        } else {
            flush(&mut segment, &mut out);
            out.push(ch);
        }
    }
    flush(&mut segment, &mut out);
    out
}

/// Redact a whole string. The one-shot form of [`Redactor`], and the same
/// rule: split on whitespace, judge each token, keep the spacing.
pub fn redact(text: &str) -> String {
    let mut redactor = Redactor::default();
    let mut out = redactor.push(text);
    out.push_str(&redactor.flush());
    out
}

/// A redactor that can be fed in arbitrary pieces.
///
/// Text goes in through [`Redactor::push`] and comes back redacted, except for
/// a trailing run of non-whitespace, which is held until the next call proves
/// where it ends. [`Redactor::flush`] releases that remainder at the end of the
/// stream. Feeding the same bytes as one string or as fifty produces the same
/// output, which is the whole property being bought here.
#[derive(Debug, Default)]
pub struct Redactor {
    /// The trailing token that may still be growing.
    pending: String,
}

impl Redactor {
    /// Take a chunk and return everything that can be judged already.
    pub fn push(&mut self, chunk: &str) -> String {
        let mut out = String::with_capacity(chunk.len());
        for ch in chunk.chars() {
            if ch.is_whitespace() {
                // The pending token just ended, so now it can be judged.
                out.push_str(&self.take_pending());
                out.push(ch);
            } else {
                self.pending.push(ch);
            }
        }
        out
    }

    /// Release the last token. Call once, when there is no more input.
    pub fn flush(&mut self) -> String {
        self.take_pending()
    }

    fn take_pending(&mut self) -> String {
        if self.pending.is_empty() {
            return String::new();
        }
        let token = std::mem::take(&mut self.pending);
        redact_token(&token)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_is_masked_and_ordinary_prose_is_not() {
        assert_eq!(
            redact("export ANTHROPIC_API_KEY=sk-ant-api03-AAAAAAAAAAAAAAAA"),
            "export ANTHROPIC_API_KEY=[redacted]"
        );
        assert_eq!(
            redact("token ghp_AAAAAAAAAAAAAAAAAAAA done"),
            "token [redacted] done"
        );

        // Prose keeps every character, including the words the prefixes are
        // taken from: redaction that eats the log is worse than no log.
        let prose = "Der Agent hat die Tests repariert und gepusht.";
        assert_eq!(redact(prose), prose);
        assert_eq!(redact("sk- alone"), "sk- alone");
        assert_eq!(redact("AKIA"), "AKIA");
    }

    #[test]
    fn spacing_and_newlines_survive_untouched() {
        let text = "  zwei  Leerzeichen\n\tund ein Tab\r\n";
        assert_eq!(redact(text), text);
        assert_eq!(redact(""), "");
        assert_eq!(redact("   "), "   ");
    }

    #[test]
    fn a_key_split_across_reads_is_still_caught() {
        // The CCUI2 finding, as a test: redaction per chunk let this through.
        let mut redactor = Redactor::default();
        let mut out = redactor.push("key=sk-a");
        out.push_str(&redactor.push("nt-api03-AAAAAAAAAAAA"));
        out.push_str(&redactor.push(" and more"));
        out.push_str(&redactor.flush());
        assert_eq!(out, "key=[redacted] and more");
    }

    #[test]
    fn the_same_bytes_redact_the_same_however_they_are_split() {
        let text = "a sk-ant-api03-BBBBBBBBBBBBBBBB b ghp_CCCCCCCCCCCCCCCCCCCC\nc";
        let whole = redact(text);

        for size in [1, 2, 3, 5, 7, 13] {
            let mut redactor = Redactor::default();
            let mut out = String::new();
            let chars: Vec<char> = text.chars().collect();
            for chunk in chars.chunks(size) {
                out.push_str(&redactor.push(&chunk.iter().collect::<String>()));
            }
            out.push_str(&redactor.flush());
            assert_eq!(out, whole, "split into {size}-character chunks");
        }
        assert!(!whole.contains("sk-ant"), "{whole}");
        assert!(!whole.contains("ghp_"), "{whole}");
    }

    #[test]
    fn a_32_hex_token_is_masked() {
        // api::new_token mints exactly this shape: format!("{:032x}", ...) on
        // 16 random bytes - 32 lowercase hex characters, no prefix at all.
        // The app itself sends the token over HTTP headers
        // (`x-projecta-token` / `x-verdict-token`, see `api.rs:189` and
        // `api.rs:194`), not embedded in a log line the way this test's
        // `token=`/`Bearer` forms suggest - no place in the repo logs it
        // today. These forms are exercised anyway because they are the
        // shapes a human might type or paste (e.g. a curl command) and
        // because the CLI accepts a token this way, as `--verdict-token
        // <hex>` (`pa.rs`) - it does not echo it back, but the value still
        // passes through whatever might log the invocation.
        let token = "0123456789abcdef0123456789abcdef";
        assert_eq!(token.len(), 32, "fixture must be 32 chars: {token}");

        assert_eq!(
            redact(&format!("token={token}")),
            "token=[redacted]",
            "token=<hex> form"
        );
        assert_eq!(
            redact(&format!("Bearer {token}")),
            "Bearer [redacted]",
            "Bearer <hex> form"
        );
        assert_eq!(redact(token), "[redacted]", "bare token");

        // The header name the app actually uses, and the CLI flag that takes
        // the same shape of value (`pa.rs`'s `--verdict-token`).
        assert_eq!(
            redact(&format!("x-verdict-token: {token}")),
            "x-verdict-token: [redacted]",
            "x-verdict-token: <hex> form"
        );
        assert_eq!(
            redact(&format!("--verdict-token {token}")),
            "--verdict-token [redacted]",
            "--verdict-token <hex> form"
        );
    }

    #[test]
    fn a_token_glued_to_a_word_is_masked() {
        // W1-26b: redact_token only splits at characters outside is_key_char,
        // and '_' and '-' are both key chars, so a token glued to a word is
        // not its own segment. The run of exactly 32 lowercase hex characters
        // inside the segment is masked anyway, and only that run - the word
        // it is glued to stays readable.
        let token = "0123456789abcdef0123456789abcdef";
        for (glued, expected) in [
            (format!("tok_{token}"), "tok_[redacted]".to_string()),
            (format!("verdict-{token}"), "verdict-[redacted]".to_string()),
            (format!("{token}_x"), "[redacted]_x".to_string()),
            // A `{:?}`-formatted newline is a literal `\` + `n`; `\` splits
            // the segment, `n` is left glued to the token.
            (format!("line\\n{token}"), "line\\n[redacted]".to_string()),
            // ANSI color: `\x1b[32m` leaves an `m` glued to the token.
            (
                format!("\x1b[32m{token}\x1b[0m"),
                "\x1b[32m[redacted]\x1b[0m".to_string(),
            ),
            // URL-encoded `=`: the uppercase `D` is not part of the run.
            (format!("a%3D{token}"), "a%3D[redacted]".to_string()),
        ] {
            assert_eq!(redact(&glued), expected, "{glued:?}");
        }
    }

    #[test]
    fn hex_runs_of_other_lengths_inside_a_segment_are_not_masked() {
        let token = "0123456789abcdef0123456789abcdef";
        // Two tokens back to back are one 64-character run, which is also
        // the shape of a SHA-256 digest - left alone on purpose (see
        // is_token_shaped): exact 32, not "a multiple of 32".
        let doubled = format!("{token}{token}");
        assert_eq!(redact(&doubled), doubled);
        // A git SHA glued to a word stays a 40-character run.
        let sha = "commit_abcdef0123456789abcdef0123456789abcdef01";
        assert_eq!(redact(sha), sha);
        // A hex letter glued in front lengthens the run to 33: this is the
        // gap run-based detection leaves open (see is_token_shaped).
        let hexglued = format!("a{token}");
        assert_eq!(redact(&hexglued), hexglued);
        // A hyphenated UUID is five short runs, none of them 32.
        let uuid = "id-550e8400-e29b-41d4-a716-446655440000";
        assert_eq!(redact(uuid), uuid);
    }

    #[test]
    fn the_tokens_this_app_mints_are_masked() {
        // Couples this rule to the real minting code instead of a comment: if
        // the token format ever changed shape, this goes red. It calls
        // oneshot::random_hex (hook secrets), which formats 16 random bytes
        // with the same `{:032x}` as api::new_token; api::new_token itself is
        // private to api.rs and cannot be reached from here without changing
        // that seam.
        for _ in 0..64 {
            let token = crate::oneshot::random_hex();
            assert!(looks_secret(&token), "{token}");
            assert_eq!(redact(&token), MASK, "{token}");
            assert_eq!(redact(&format!("Bearer {token}")), "Bearer [redacted]");
            assert_eq!(redact(&format!("tok_{token}")), "tok_[redacted]");
        }
    }

    #[test]
    fn a_token_split_at_every_offset_is_still_masked() {
        // Redactor holds back a token until whitespace proves it complete, so
        // no chunk boundary may let the 32-hex shape through - bare, after a
        // prefix, or glued to a word.
        let token = "0123456789abcdef0123456789abcdef";
        for text in [
            format!("Bearer {token} ok"),
            format!("x tok_{token}\n"),
            format!("verdict-{token}_x,y"),
            token.to_string(),
        ] {
            let whole = redact(&text);
            assert!(!whole.contains(token), "{whole}");
            for cut in 0..=text.len() {
                let mut redactor = Redactor::default();
                let mut out = redactor.push(&text[..cut]);
                out.push_str(&redactor.push(&text[cut..]));
                out.push_str(&redactor.flush());
                assert_eq!(out, whole, "{text:?} cut at {cut}");
            }
            let mut redactor = Redactor::default();
            let mut out = String::new();
            for ch in text.chars() {
                out.push_str(&redactor.push(&ch.to_string()));
            }
            out.push_str(&redactor.flush());
            assert_eq!(out, whole, "{text:?} one char at a time");
        }
    }

    #[test]
    fn hex_lookalikes_are_not_masked() {
        // A git SHA-1 is 40 hex characters, eight more than a token.
        let sha40 = "abcdef0123456789abcdef0123456789abcdef01";
        assert_eq!(sha40.len(), 40);
        assert_eq!(redact(sha40), sha40, "40-char sha stays untouched");

        // An abbreviated git SHA is far shorter.
        assert_eq!(redact("commit abc1234 done"), "commit abc1234 done");

        // A UUID is 32 hex digits too, but with hyphens breaking it up -
        // still 36 characters as one segment, and not the token shape.
        let uuid = "550e8400-e29b-41d4-a716-446655440000";
        assert_eq!(redact(uuid), uuid, "hyphenated uuid stays untouched");

        // 31 and 33 hex characters must not match either - the length has to
        // be exact, not "roughly 32".
        let hex31 = "0123456789abcdef0123456789abcde";
        assert_eq!(hex31.len(), 31);
        assert_eq!(redact(hex31), hex31);
        let hex33 = "0123456789abcdef0123456789abcdef0";
        assert_eq!(hex33.len(), 33);
        assert_eq!(redact(hex33), hex33);

        // api::new_token is lowercase-only (`{:032x}`); an uppercase 32-hex
        // string - a Windows-style GUID without braces/hyphens, or an
        // uppercase MD5 - is not this app's token shape and stays readable.
        let upper32 = "0123456789ABCDEF0123456789ABCDEF";
        assert_eq!(upper32.len(), 32);
        assert_eq!(redact(upper32), upper32, "uppercase hex stays untouched");

        // A mixed-case 32-hex string is not the exact lowercase shape either.
        let mixed32 = "0123456789abcdef0123456789ABCDEF";
        assert_eq!(mixed32.len(), 32);
        assert_eq!(redact(mixed32), mixed32, "mixed-case hex stays untouched");
    }

    #[test]
    fn punctuation_around_a_key_does_not_hide_it_and_survives_it() {
        for (wrapped, expected) in [
            ("\"sk-ant-api03-AAAAAAAAAAAA\"", "\"[redacted]\""),
            ("(sk-ant-api03-AAAAAAAAAAAA)", "([redacted])"),
            ("sk-ant-api03-AAAAAAAAAAAA,", "[redacted],"),
            ("'sk-ant-api03-AAAAAAAAAAAA';", "'[redacted]';"),
            // The name of the variable is not the secret, and keeping it is
            // what makes the redacted line still worth reading.
            (
                "ANTHROPIC_API_KEY=sk-ant-api03-AAAAAAAAAAAA",
                "ANTHROPIC_API_KEY=[redacted]",
            ),
        ] {
            assert_eq!(redact(wrapped), expected, "{wrapped}");
        }
    }
}
```
