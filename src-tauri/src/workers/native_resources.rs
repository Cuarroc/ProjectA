//! Signed host authorization, separate from provider and execution eligibility.
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde::Deserialize;
use sha2::{Digest, Sha256};

const MAX_PAYLOAD: usize = 16_384;
const MAX_SIGNATURE: usize = 8192;
const MAX_KEY: usize = 4096;
const WINDOWS_TARGET: &str = "x86_64-pc-windows-msvc";

#[cfg(windows)]
#[path = "native_resource_files.rs"]
pub mod files;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema_version: u32,
    purpose: String,
    app_version: String,
    build_commit: String,
    target: String,
    protocol_version: u32,
    host_name: String,
    host_sha256: String,
}

/// No Deserialize or public constructor. This authorizes one hash only; the
/// held executable must still match it, and provider policy remains independent.
pub struct AuthorizedHost {
    host_sha256: String,
    manifest_sha256: String,
}
impl AuthorizedHost {
    pub fn host_sha256(&self) -> &str {
        &self.host_sha256
    }
    pub fn manifest_sha256(&self) -> &str {
        &self.manifest_sha256
    }
}

struct Expected<'a> {
    version: &'a str,
    commit: &'a str,
    target: &'a str,
    protocol: u32,
}

/// No caller-selected trust key or runtime identity. option_env! also records
/// the build variable in Cargo's compiler dependency tracking.
pub fn verify_for_current_build(payload: &[u8], signature: &str) -> Result<AuthorizedHost, String> {
    if !cfg!(all(windows, target_arch = "x86_64", target_env = "msvc")) {
        return Err("native signed resources unavailable for this target".into());
    }
    let commit = option_env!("PROJECTA_BUILD_COMMIT")
        .ok_or("native signed resources require embedded build identity")?;
    let expected = Expected {
        version: env!("CARGO_PKG_VERSION"),
        commit,
        target: WINDOWS_TARGET,
        protocol: crate::protocol::VERSION,
    };
    verify(payload, signature, &embedded_key()?, &expected)
}

fn embedded_key() -> Result<String, String> {
    let config: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json"))
        .map_err(|_| "embedded updater configuration invalid")?;
    config["plugins"]["updater"]["pubkey"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "embedded updater key unavailable".into())
}

fn lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn authenticate(payload: &[u8], signature: &str, key: &str) -> Result<(), String> {
    if payload.is_empty()
        || payload.len() > MAX_PAYLOAD
        || signature.is_empty()
        || signature.len() > MAX_SIGNATURE
        || key.is_empty()
        || key.len() > MAX_KEY
    {
        return Err("native resource envelope exceeds bounds or is empty".into());
    }
    let key_bytes = STANDARD
        .decode(key)
        .map_err(|_| "native resource key encoding invalid")?;
    let key_text =
        std::str::from_utf8(&key_bytes).map_err(|_| "native resource key is not UTF-8")?;
    let key = PublicKey::decode(key_text).map_err(|_| "native resource key invalid")?;
    let sig_bytes = STANDARD
        .decode(signature)
        .map_err(|_| "native resource signature encoding invalid")?;
    let sig_text =
        std::str::from_utf8(&sig_bytes).map_err(|_| "native resource signature is not UTF-8")?;
    let sig = Signature::decode(sig_text).map_err(|_| "native resource signature invalid")?;
    key.verify(payload, &sig, false)
        .map_err(|_| "native resource signature verification failed".into())
}

fn verify(
    payload: &[u8],
    signature: &str,
    key: &str,
    expected: &Expected<'_>,
) -> Result<AuthorizedHost, String> {
    if !lower_hex(expected.commit, 40)
        || expected.version.is_empty()
        || expected.target != WINDOWS_TARGET
    {
        return Err("compiled native resource identity invalid".into());
    }
    authenticate(payload, signature, key)?;
    let manifest: Manifest =
        serde_json::from_slice(payload).map_err(|_| "signed native resource manifest invalid")?;
    if manifest.schema_version != 1
        || manifest.purpose != "projecta-native-host-v1"
        || manifest.app_version != expected.version
        || manifest.build_commit != expected.commit
        || manifest.target != expected.target
        || manifest.protocol_version != expected.protocol
        || manifest.host_name != "pa-capture-host.exe"
        || !lower_hex(&manifest.host_sha256, 64)
    {
        return Err("signed native resource manifest does not match this build".into());
    }
    Ok(AuthorizedHost {
        host_sha256: manifest.host_sha256,
        manifest_sha256: format!("{:x}", Sha256::digest(payload)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Fixtures {
        public_key: String,
        cases: Vec<Case>,
    }
    #[derive(Deserialize)]
    struct Case {
        name: String,
        message: String,
        signature: String,
    }
    fn fixtures() -> Fixtures {
        serde_json::from_str(include_str!("fixtures/native-resources.json")).unwrap()
    }
    fn expected() -> Expected<'static> {
        Expected {
            version: "1.3.0",
            commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            target: WINDOWS_TARGET,
            protocol: 1,
        }
    }

    #[test]
    fn signed_resource_fixtures_require_exact_schema_purpose_and_build_identity() {
        let fixtures = fixtures();
        assert_eq!(fixtures.cases.len(), 12);
        for case in &fixtures.cases {
            authenticate(
                case.message.as_bytes(),
                &case.signature,
                &fixtures.public_key,
            )
            .unwrap();
            let result = verify(
                case.message.as_bytes(),
                &case.signature,
                &fixtures.public_key,
                &expected(),
            );
            if case.name == "valid" {
                let authorized = result.unwrap();
                assert_eq!(authorized.host_sha256(), "b".repeat(64));
                assert_eq!(
                    authorized.manifest_sha256(),
                    format!("{:x}", Sha256::digest(case.message.as_bytes()))
                );
            } else {
                assert!(
                    result.is_err(),
                    "accepted signed invalid case {}",
                    case.name
                );
            }
        }
    }

    #[test]
    fn signature_tampering_wrong_key_and_unbounded_envelopes_are_refused() {
        let fixtures = fixtures();
        let case = fixtures
            .cases
            .iter()
            .find(|case| case.name == "valid")
            .unwrap();
        assert!(verify_for_current_build(case.message.as_bytes(), &case.signature).is_err());
        let run = |payload: &[u8], signature: &str, key: &str| {
            verify(payload, signature, key, &expected())
        };
        assert!(run(
            format!("{} ", case.message).as_bytes(),
            &case.signature,
            &fixtures.public_key
        )
        .is_err());
        assert!(run(
            case.message.as_bytes(),
            &case.signature,
            &embedded_key().unwrap()
        )
        .is_err());
        assert!(run(case.message.as_bytes(), "invalid", &fixtures.public_key).is_err());
        assert!(run(
            &vec![b'a'; MAX_PAYLOAD + 1],
            &case.signature,
            &fixtures.public_key
        )
        .is_err());
        assert!(run(
            case.message.as_bytes(),
            &"a".repeat(MAX_SIGNATURE + 1),
            &fixtures.public_key
        )
        .is_err());
        assert!(run(
            case.message.as_bytes(),
            &case.signature,
            &"a".repeat(MAX_KEY + 1)
        )
        .is_err());
        assert!(run(&[], &case.signature, &fixtures.public_key).is_err());
        let mut identity = expected();
        identity.commit = "not-a-commit";
        assert!(verify(
            case.message.as_bytes(),
            &case.signature,
            &fixtures.public_key,
            &identity
        )
        .is_err());
    }
}
