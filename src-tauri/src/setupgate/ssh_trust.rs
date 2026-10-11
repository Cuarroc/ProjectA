//! SSH trust core, pure and not wired: no network, no `ssh` call, no vault
//! access. Decides whether a host key matches its pin ([`check_host`]), whether
//! a key is only a vault reference ([`TresorRef`]) and whether a host entry
//! carries a password ([`HostEintrag`]). Reasons are German and never echo the
//! rejected value, and an observation that fails [`pruefe_fingerprint`] is never
//! retained in an outcome (`Ungueltig` has no payload), so a pasted key or
//! password cannot reach a log or a `Debug` print.

use base64::engine::general_purpose::STANDARD_NO_PAD;
use base64::Engine;

/// A pinned host key: the OpenSSH `SHA256:<base64 without padding>` form.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostPin {
    pub host: String,
    pub port: u16,
    pub fingerprint: String,
}

impl HostPin {
    pub fn neu(host: &str, port: u16, fp: &str) -> Result<HostPin, String> {
        pruefe_host(host)?;
        if port == 0 {
            return Err(PORT_FEHLER.into());
        }
        pruefe_fingerprint(fp)?;
        Ok(HostPin {
            host: host.into(),
            port,
            fingerprint: fp.into(),
        })
    }
}

/// Outcome of comparing an observed host key with the pin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Vertrauen {
    /// Observed key equals the pin.
    Bekannt,
    /// Observed key differs from the pin: stop, never auto-accept.
    Abweichend { erwartet: String, gesehen: String },
    /// First contact, nothing pinned: the caller must ask the user.
    Neu { gesehen: String },
    /// The observation (or the pin) is no valid fingerprint; carries no payload.
    Ungueltig,
}

/// `Bekannt` only for an equal, well-formed fingerprint. An observation (or a
/// hand-built pin) that is no valid fingerprint is `Ungueltig`, fail closed and
/// payload-free: only validated `SHA256:` values ever reach `Neu`/`Abweichend`.
pub fn check_host(pin: Option<&HostPin>, observed: &str) -> Vertrauen {
    if pruefe_fingerprint(observed).is_err() {
        return Vertrauen::Ungueltig;
    }
    let gesehen = observed.to_string();
    match pin {
        None => Vertrauen::Neu { gesehen },
        Some(p) if pruefe_fingerprint(&p.fingerprint).is_err() => Vertrauen::Ungueltig,
        Some(p) if gleich(&p.fingerprint, observed) => Vertrauen::Bekannt,
        Some(p) => Vertrauen::Abweichend {
            erwartet: p.fingerprint.clone(),
            gesehen,
        },
    }
}

/// Constant-time equality (the length is not secret).
fn gleich(a: &str, b: &str) -> bool {
    let diff = a
        .bytes()
        .zip(b.bytes())
        .fold(0, |acc, (x, y)| acc | (x ^ y));
    a.len() == b.len() && diff == 0
}

/// Accept only `SHA256:` + 43 base64 characters decoding to 32 bytes.
pub fn pruefe_fingerprint(fp: &str) -> Result<(), String> {
    if ist_md5_hex(fp) || fp.to_ascii_uppercase().starts_with("MD5:") {
        return Err("MD5-Fingerabdrücke sind unsicher; nur SHA256:<base64> ist erlaubt".into());
    }
    let Some(b64) = fp.strip_prefix("SHA256:") else {
        return Err("Fingerabdruck muss die Form SHA256:<base64> haben".into());
    };
    match STANDARD_NO_PAD.decode(b64) {
        Ok(raw) if raw.len() == 32 => Ok(()),
        _ => Err("SHA256-Fingerabdruck ist ungültig (43 Base64-Zeichen ohne Auffüllung)".into()),
    }
}

/// MD5 colon form: 16 pairs of hex digits (`aa:bb:…`), not merely that length.
fn ist_md5_hex(fp: &str) -> bool {
    let paare: Vec<&str> = fp.split(':').collect();
    paare.len() == 16
        && paare
            .iter()
            .all(|p| p.len() == 2 && p.bytes().all(|b| b.is_ascii_hexdigit()))
}

const PORT_FEHLER: &str = "Port muss 1 bis 65535 sein";

/// Vault reference `tresor://<name>`; holds the name only, so `Debug` shows only that.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TresorRef(String);

impl TresorRef {
    pub fn parse(wert: &str) -> Result<TresorRef, String> {
        let name = wert.strip_prefix("tresor://").ok_or_else(|| {
            "Schlüssel nur als Tresor-Verweis tresor://<name>, nie als Pfad oder Schlüsseltext"
                .to_string()
        })?;
        let gueltig = (1..=64).contains(&name.len())
            && name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'));
        if gueltig {
            Ok(TresorRef(name.to_string()))
        } else {
            Err("Tresor-Name: 1 bis 64 Zeichen aus A-Z, a-z, 0-9, _ . -".into())
        }
    }

    pub fn name(&self) -> &str {
        &self.0
    }
}

/// A validated SSH host entry: where to connect and which vault key to use.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostEintrag {
    pub host: String,
    pub port: u16,
    pub schluessel: TresorRef,
}

impl HostEintrag {
    /// Validate raw config fields (`host`, `port`, `schluessel`).
    /// Password-like fields are rejected first, then unknown ones.
    pub fn pruefen(felder: &[(&str, &str)]) -> Result<HostEintrag, String> {
        const BEKANNT: [&str; 3] = ["host", "port", "schluessel"];
        for (name, wert) in felder {
            // Names broadly; values only on explicit markers (`bypass.example` is a host).
            let marker = ["password", "passphrase", "passwort", "kennwort", "pwd="];
            if enthaelt(name, &["pass", "pwd", "kennwort", "secret"]) || enthaelt(wert, &marker) {
                return Err("Passwörter werden nicht gespeichert".into());
            }
        }
        if felder
            .iter()
            .any(|f| !BEKANNT.contains(&f.0.to_lowercase().as_str()))
        {
            return Err("Unbekanntes Feld im Host-Eintrag".into());
        }
        // Lookup is case-insensitive, so a repeated name would be ambiguous.
        let mut namen: Vec<String> = felder.iter().map(|f| f.0.to_lowercase()).collect();
        namen.sort();
        if namen.windows(2).any(|w| w[0] == w[1]) {
            return Err("Feld doppelt im Host-Eintrag".into());
        }
        let feld = |n: &str| {
            felder
                .iter()
                .find(|f| f.0.eq_ignore_ascii_case(n))
                .map(|f| f.1)
        };
        let host = feld("host").ok_or("Host fehlt")?;
        pruefe_host(host)?;
        let port = match feld("port") {
            None => 22,
            Some(p) => p.parse().ok().filter(|n| *n != 0).ok_or(PORT_FEHLER)?,
        };
        let schluessel = TresorRef::parse(feld("schluessel").ok_or("Schlüssel fehlt")?)?;
        Ok(HostEintrag {
            host: host.into(),
            port,
            schluessel,
        })
    }
}

fn enthaelt(text: &str, woerter: &[&str]) -> bool {
    let t = text.to_lowercase();
    woerter.iter().any(|w| t.contains(w))
}

/// A hostname or address; never empty, never an option (`-o…`), no spaces.
fn pruefe_host(host: &str) -> Result<(), String> {
    let ok = !host.is_empty()
        && !host.starts_with('-')
        && host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b':'));
    ok.then_some(())
        .ok_or_else(|| "Host ist ungültig".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Made-up fixtures (SHA-256 of throwaway strings), not real host keys.
    const FP_A: &str = "SHA256:Bq2lfCaqXPQp6fLAqZ4+SkLa7NRfxMlV18E5mrQieug";
    const FP_B: &str = "SHA256:4O9W1utgPZ/+h+dMKLghCw6pODni6k+2Tx/Cxm6V45E";
    const MD5: &str = "aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99";

    fn pin() -> HostPin {
        HostPin::neu("example.test", 22, FP_A).unwrap()
    }

    fn eintrag(extra: &[(&str, &str)]) -> Result<HostEintrag, String> {
        let mut f = vec![("host", "example.test")];
        f.extend_from_slice(extra);
        HostEintrag::pruefen(&f)
    }

    #[test]
    fn same_fingerprint_is_bekannt() {
        assert_eq!(check_host(Some(&pin()), FP_A), Vertrauen::Bekannt);
    }

    #[test]
    fn changed_fingerprint_is_abweichend_naming_both() {
        let (erwartet, gesehen) = (FP_A.to_string(), FP_B.to_string());
        let want = Vertrauen::Abweichend { erwartet, gesehen };
        assert_eq!(check_host(Some(&pin()), FP_B), want);
    }

    #[test]
    fn no_pin_is_neu_never_bekannt() {
        let want = Vertrauen::Neu {
            gesehen: FP_A.into(),
        };
        assert_eq!(check_host(None, FP_A), want);
    }

    #[test]
    fn unreadable_observation_never_counts_as_bekannt() {
        for kaputt in [FP_A.trim_end_matches('g'), ""] {
            let v = check_host(Some(&pin()), kaputt);
            assert_eq!(v, Vertrauen::Ungueltig, "{kaputt}");
        }
    }

    #[test]
    fn pasted_secret_is_never_retained_in_the_outcome() {
        let secret = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk";
        for pin in [None, Some(pin())] {
            let text = format!("{:?}", check_host(pin.as_ref(), secret));
            assert!(
                !text.contains("PRIVATE") && !text.contains("b3Blbn"),
                "{text}"
            );
        }
        assert!(!pruefe_fingerprint(secret).unwrap_err().contains("PRIVATE"));
    }

    #[test]
    fn invalid_observation_is_ungueltig_with_or_without_pin() {
        let pin = pin();
        for kaputt in ["", "SHA256:abc", MD5, "key"] {
            for p in [None, Some(&pin)] {
                assert_eq!(check_host(p, kaputt), Vertrauen::Ungueltig, "{kaputt}");
            }
        }
    }

    #[test]
    fn hand_built_pin_with_bad_fingerprint_is_ungueltig() {
        let bad = HostPin {
            host: "example.test".into(),
            port: 22,
            fingerprint: "SHA256:abc".into(),
        };
        assert_eq!(check_host(Some(&bad), FP_B), Vertrauen::Ungueltig);
    }

    #[test]
    fn pin_with_port_zero_is_rejected() {
        assert!(HostPin::neu("example.test", 0, FP_A).is_err());
        assert!(HostPin::neu("example.test", 1, FP_A).is_ok());
        assert!(HostPin::neu("example.test", 65535, FP_A).is_ok());
    }

    #[test]
    fn md5_message_only_for_real_hex_colon_shape() {
        // 16 pairs, 47 chars, 15 colons, but not hex: generic reason, no MD5 claim.
        let not_hex = "zz:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99";
        let why = pruefe_fingerprint(not_hex).unwrap_err();
        assert!(!why.contains("MD5") && why.contains("SHA256:"), "{why}");
        let upper = MD5.to_ascii_uppercase();
        assert!(pruefe_fingerprint(&upper).unwrap_err().contains("MD5"));
    }

    #[test]
    fn duplicate_field_names_are_rejected_fail_closed() {
        let base = [
            ("host", "example.test"),
            ("port", "22"),
            ("schluessel", "tresor://k"),
        ];
        assert!(HostEintrag::pruefen(&base).is_ok());
        for dup in [
            ("host", "other.test"),
            ("HOST", "other.test"),
            ("port", "2222"),
            ("Schluessel", "tresor://m"),
        ] {
            let f = [&base[..], &[dup][..]].concat();
            assert!(HostEintrag::pruefen(&f).is_err(), "{dup:?}");
        }
    }

    #[test]
    fn md5_fingerprint_is_rejected_with_reason() {
        assert!(pruefe_fingerprint(MD5).unwrap_err().contains("MD5"));
        assert!(pruefe_fingerprint(&format!("MD5:{MD5}")).is_err());
        assert!(HostPin::neu("example.test", 22, MD5).is_err());
    }

    #[test]
    fn malformed_sha256_is_rejected() {
        let bare = &FP_A[7..];
        for fp in ["", "SHA256:", "SHA256:abc", bare, &format!("{FP_A}=")] {
            assert!(pruefe_fingerprint(fp).is_err(), "{fp}");
        }
    }

    #[test]
    fn key_as_vault_reference_is_accepted() {
        let e = eintrag(&[("port", "2222"), ("schluessel", "tresor://gh-deploy")]).unwrap();
        assert_eq!((e.port, e.schluessel.name()), (2222, "gh-deploy"));
    }

    #[test]
    fn key_as_path_or_raw_text_is_rejected_without_echo() {
        let raw = "-----BEGIN OPENSSH PRIVATE KEY-----";
        for v in [
            "/home/x/.ssh/id_ed25519",
            "~/.ssh/id_rsa",
            raw,
            "ssh-ed25519 AAAA",
        ] {
            let why = eintrag(&[("schluessel", v)]).unwrap_err();
            assert!(why.contains("tresor://") && !why.contains(v), "{why}");
        }
        let ref_ = |n: &str| TresorRef::parse(&format!("tresor://{n}"));
        assert!(["", "a/b", "a b", &"a".repeat(65)]
            .iter()
            .all(|n| ref_(n).is_err()));
        assert!(ref_(&"a".repeat(64)).is_ok());
    }

    #[test]
    fn entry_carrying_a_password_is_rejected() {
        let key = ("schluessel", "tresor://gh-deploy");
        for extra in [
            ("password", "x"),
            ("Passphrase", "x"),
            ("ssh_pwd", "x"),
            ("n", "password=x"),
        ] {
            let why = eintrag(&[key, extra]).unwrap_err();
            assert_eq!(why, "Passwörter werden nicht gespeichert", "{extra:?}");
        }
        assert!(eintrag(&[key, ("zusatz", "x")]).is_err());
    }

    #[test]
    fn debug_shows_the_reference_name_only() {
        let e = eintrag(&[("schluessel", "tresor://gh-deploy")]).unwrap();
        let text = format!("{e:?}");
        assert!(
            text.contains("gh-deploy") && !text.contains("tresor://"),
            "{text}"
        );
    }

    #[test]
    fn bad_host_and_port_are_rejected() {
        let k = ("schluessel", "tresor://k");
        assert_eq!(eintrag(&[k]).unwrap().port, 22);
        assert!(["0", "70000"]
            .iter()
            .all(|p| eintrag(&[k, ("port", p)]).is_err()));
        for host in ["-oProxyCommand=x", "", "a b"] {
            assert!(
                HostEintrag::pruefen(&[("host", host), k]).is_err(),
                "{host}"
            );
        }
    }
}
