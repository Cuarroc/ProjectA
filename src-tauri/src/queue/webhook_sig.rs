//! Webhook signature check: HMAC-SHA256 over the raw body, GitHub-style
//! `sha256=<hex>` header, constant-time comparison and a 24 h key overlap.
//!
//! Pure core, not wired yet: keys arrive as bytes from the caller (vault
//! wiring comes later) and the clock is injected as unix seconds. Keys never
//! appear in reasons, `Debug` output or logs.

#![allow(dead_code)] // trigger core part 2; the HTTP receiver wires it later

use std::fmt;

use sha2::{Digest, Sha256};

const BLOCK: usize = 64;
const MAC_LEN: usize = 32;
const PREFIX: &str = "sha256=";
/// How long the previous key stays valid after a rotation.
pub const UEBERLAPPUNG_SEKUNDEN: u64 = 24 * 60 * 60;

/// HMAC-SHA256 per RFC 2104 (64-byte block).
pub fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; MAC_LEN] {
    let mut block = [0u8; BLOCK];
    if key.len() > BLOCK {
        block[..MAC_LEN].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    inner.update(block.map(|b| b ^ 0x36));
    inner.update(msg);
    let mut outer = Sha256::new();
    outer.update(block.map(|b| b ^ 0x5c));
    outer.update(inner.finalize());
    outer.finalize().into()
}

/// Compares without an early exit on the first differing byte. Only the
/// lengths (public) can short-circuit.
fn gleich(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Parses `sha256=<64 hex chars>`; anything else is a format error.
fn parse_header(header: &str) -> Option<[u8; MAC_LEN]> {
    let hex = header.strip_prefix(PREFIX)?.as_bytes();
    if hex.len() != MAC_LEN * 2 {
        return None;
    }
    let mut mac = [0u8; MAC_LEN];
    let digit = |i: usize| char::from(hex[i]).to_digit(16);
    for (i, byte) in mac.iter_mut().enumerate() {
        *byte = (digit(2 * i)? << 4 | digit(2 * i + 1)?) as u8;
    }
    Some(mac)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Schluessel {
    Aktuell,
    Vorher,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Grund {
    SignaturFehlt,
    SignaturPasstNicht,
    AlterSchluesselAbgelaufen,
    FormatUngueltig,
}

impl Grund {
    pub fn text(self) -> &'static str {
        match self {
            Grund::SignaturFehlt => "Signatur fehlt",
            Grund::SignaturPasstNicht => "Signatur passt nicht",
            Grund::AlterSchluesselAbgelaufen => "alter Schlüssel abgelaufen",
            Grund::FormatUngueltig => "Format ungültig",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pruefung {
    Gueltig { schluessel: Schluessel },
    Abgelehnt { grund: Grund },
}

/// The current key plus, after a rotation, the previous one with its expiry.
#[derive(Clone, PartialEq, Eq)]
pub struct Schluesselring {
    pub aktuell: Vec<u8>,
    /// Previous key and `gueltig_bis` (unix seconds, exclusive).
    pub vorher: Option<(Vec<u8>, u64)>,
}

impl fmt::Debug for Schluesselring {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let bis = self.vorher.as_ref().map(|v| v.1);
        f.debug_struct("Schluesselring")
            .field("aktuell", &"<redacted>")
            .field("vorher_gueltig_bis", &bis)
            .finish()
    }
}

impl Pruefung {
    const fn abgelehnt(grund: Grund) -> Self {
        Self::Abgelehnt { grund }
    }

    const fn gueltig(schluessel: Schluessel) -> Self {
        Self::Gueltig { schluessel }
    }
}

impl Schluesselring {
    pub fn neu(aktuell: Vec<u8>) -> Self {
        Self {
            aktuell,
            vorher: None,
        }
    }

    /// Installs `neu`; the old key stays valid until `jetzt` + 24 h.
    pub fn rotiere(&mut self, neu: Vec<u8>, jetzt: u64) {
        let alt = std::mem::replace(&mut self.aktuell, neu);
        self.vorher = Some((alt, jetzt.saturating_add(UEBERLAPPUNG_SEKUNDEN)));
    }

    /// Checks `header` (`sha256=<hex>`, `None` if absent) against the raw
    /// `body` at time `jetzt` (unix seconds). An empty key never matches.
    pub fn pruefe(&self, header: Option<&str>, body: &[u8], jetzt: u64) -> Pruefung {
        let Some(header) = header else {
            return Pruefung::abgelehnt(Grund::SignaturFehlt);
        };
        let Some(gegeben) = parse_header(header) else {
            return Pruefung::abgelehnt(Grund::FormatUngueltig);
        };
        let passt = |key: &[u8]| !key.is_empty() && gleich(&hmac_sha256(key, body), &gegeben);
        // Evaluate both keys so timing does not reveal which one matched.
        let aktuell = passt(&self.aktuell);
        let vorher = self.vorher.as_ref().map(|(key, bis)| (passt(key), *bis));
        if aktuell {
            return Pruefung::gueltig(Schluessel::Aktuell);
        }
        match vorher {
            Some((true, bis)) if jetzt < bis => Pruefung::gueltig(Schluessel::Vorher),
            Some((true, _)) => Pruefung::abgelehnt(Grund::AlterSchluesselAbgelaufen),
            _ => Pruefung::abgelehnt(Grund::SignaturPasstNicht),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: u64 = 3600;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn header(key: &[u8], body: &[u8]) -> String {
        format!("sha256={}", hex(&hmac_sha256(key, body)))
    }

    #[test]
    #[rustfmt::skip]
    fn rfc4231_cases_1_2_3_4_6() {
        let key4: Vec<u8> = (1..=25).collect();
        let cases: [(&[u8], &[u8], &str); 5] = [
            (&[0x0b; 20], b"Hi There", "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"),
            (b"Jefe", b"what do ya want for nothing?", "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"),
            (&[0xaa; 20], &[0xdd; 50], "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe"),
            (&key4, &[0xcd; 50], "82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b"),
            (
                &[0xaa; 131],
                b"Test Using Larger Than Block-Size Key - Hash Key First",
                "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
            ),
        ];
        for (key, data, expected) in cases {
            assert_eq!(hex(&hmac_sha256(key, data)), expected);
        }
    }

    #[test]
    fn valid_signature_with_current_key() {
        let ring = Schluesselring::neu(b"Jefe".to_vec());
        let h = header(b"Jefe", b"{\"a\":1}");
        assert_eq!(
            ring.pruefe(Some(&h), b"{\"a\":1}", 0),
            Pruefung::gueltig(Schluessel::Aktuell)
        );
    }

    #[test]
    fn forged_signature_is_rejected() {
        let ring = Schluesselring::neu(b"Jefe".to_vec());
        let forged = header(b"angreifer", b"body");
        let r = ring.pruefe(Some(&forged), b"body", 0);
        assert_eq!(r, Pruefung::abgelehnt(Grund::SignaturPasstNicht));
        assert_eq!(Grund::SignaturPasstNicht.text(), "Signatur passt nicht");
        // A valid signature over a different body does not match either.
        let other = header(b"Jefe", b"anderer body");
        assert_eq!(ring.pruefe(Some(&other), b"body", 0), r);
    }

    #[test]
    fn missing_header_is_rejected() {
        let ring = Schluesselring::neu(b"Jefe".to_vec());
        let r = ring.pruefe(None, b"body", 0);
        assert_eq!(r, Pruefung::abgelehnt(Grund::SignaturFehlt));
        assert_eq!(Grund::SignaturFehlt.text(), "Signatur fehlt");
    }

    #[test]
    fn malformed_header_is_rejected() {
        let ring = Schluesselring::neu(b"Jefe".to_vec());
        let good = header(b"Jefe", b"body");
        let bad = [
            good.replacen("sha256=", "sha1=", 1),
            good[7..].to_string(),
            format!("sha256={}", "zz".repeat(32)),
            format!("sha256={}", &good[7..good.len() - 2]),
            format!("{good}00"),
            "sha256=".to_string(),
            String::new(),
        ];
        for h in bad {
            assert_eq!(
                ring.pruefe(Some(&h), b"body", 0),
                Pruefung::abgelehnt(Grund::FormatUngueltig),
                "{h}"
            );
        }
        assert_eq!(Grund::FormatUngueltig.text(), "Format ungültig");
    }

    #[test]
    fn previous_key_valid_23h_after_rotation() {
        let mut ring = Schluesselring::neu(b"alt".to_vec());
        ring.rotiere(b"neu".to_vec(), 1000);
        let h = header(b"alt", b"body");
        assert_eq!(
            ring.pruefe(Some(&h), b"body", 1000 + 23 * H),
            Pruefung::gueltig(Schluessel::Vorher)
        );
    }

    #[test]
    fn previous_key_rejected_25h_after_rotation() {
        let mut ring = Schluesselring::neu(b"alt".to_vec());
        ring.rotiere(b"neu".to_vec(), 1000);
        let h = header(b"alt", b"body");
        let r = ring.pruefe(Some(&h), b"body", 1000 + 25 * H);
        assert_eq!(r, Pruefung::abgelehnt(Grund::AlterSchluesselAbgelaufen));
        assert_eq!(
            Grund::AlterSchluesselAbgelaufen.text(),
            "alter Schlüssel abgelaufen"
        );
        // The expiry instant itself is already expired (exclusive bound).
        assert_eq!(ring.pruefe(Some(&h), b"body", 1000 + 24 * H), r);
        // A wrong signature is never reported as "expired".
        let forged = header(b"x", b"body");
        assert_eq!(
            ring.pruefe(Some(&forged), b"body", 1000 + 25 * H),
            Pruefung::abgelehnt(Grund::SignaturPasstNicht)
        );
    }

    #[test]
    fn empty_key_never_matches() {
        let ring = Schluesselring::neu(Vec::new());
        let h = header(b"", b"body");
        assert_eq!(
            ring.pruefe(Some(&h), b"body", 0),
            Pruefung::abgelehnt(Grund::SignaturPasstNicht)
        );
    }

    #[test]
    fn debug_output_redacts_keys() {
        let mut ring = Schluesselring::neu(b"geheim-aktuell-xyz".to_vec());
        ring.rotiere(b"geheim-neu-abc".to_vec(), 5);
        let dbg = format!("{ring:?}");
        for key in [&b"geheim-aktuell-xyz"[..], &b"geheim-neu-abc"[..]] {
            assert!(!dbg.contains(std::str::from_utf8(key).unwrap()), "{dbg}");
            assert!(!dbg.contains(&hex(key)), "{dbg}");
            assert!(!dbg.contains(&format!("{key:?}")), "{dbg}");
            assert!(!dbg.contains(&format!("{:?}", key[0])), "{dbg}");
        }
        assert!(dbg.contains("redacted"));
    }
}
