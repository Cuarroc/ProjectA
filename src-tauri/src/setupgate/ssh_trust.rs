//! SSH trust core, pure and not wired: no network, no `ssh` call, no vault
//! access. Decides whether a host key matches its pin ([`check_host`]), whether
//! a key is only a vault reference ([`TresorRef`]) and whether a host entry
//! carries a password ([`HostEintrag`]). Reasons are German and never echo the
//! rejected value, so a pasted key or password cannot reach a log.

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
}

/// `Bekannt` only for an equal, well-formed fingerprint; garbage is never known.
pub fn check_host(pin: Option<&HostPin>, observed: &str) -> Vertrauen {
    let gesehen = observed.to_string();
    match pin {
        None => Vertrauen::Neu { gesehen },
        Some(p) if pruefe_fingerprint(observed).is_ok() && gleich(&p.fingerprint, observed) => {
            Vertrauen::Bekannt
        }
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
    let hex_paare = fp.len() == 47 && fp.bytes().filter(|b| *b == b':').count() == 15;
    if hex_paare || fp.to_ascii_uppercase().starts_with("MD5:") {
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
            Some(p) => p
                .parse()
                .ok()
                .filter(|n| *n != 0)
                .ok_or("Port muss 1 bis 65535 sein")?,
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
            assert!(matches!(v, Vertrauen::Abweichend { .. }), "{kaputt}");
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
