//! Installed host resources. Trust comes from the compiled verifier, never files.
use super::{verify_for_current_build, AuthorizedHost, MAX_PAYLOAD, MAX_SIGNATURE};
use crate::windows_image::VerifiedImage;
use std::{
    fs::{File, OpenOptions},
    io::Read,
    os::windows::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
};

pub struct LoadedHost {
    path: PathBuf,
    authorization: AuthorizedHost,
    // This handle excludes writes/deletion for the lifetime of the receipt.
    _image: VerifiedImage,
}
impl LoadedHost {
    pub fn path(&self) -> &Path {
        &self.path
    }
    pub fn authorization(&self) -> &AuthorizedHost {
        &self.authorization
    }
}

/// Fixed installation-relative names, with no caller-selected root or key.
/// Holding this receipt does not enable a provider or authorize a launch.
pub fn load_for_current_app() -> Result<LoadedHost, String> {
    let executable = std::env::current_exe()
        .and_then(std::fs::canonicalize)
        .map_err(|_| "cannot resolve installed native resource directory")?;
    let directory = executable
        .parent()
        .ok_or("installed native resource directory unavailable")?;
    let (payload, signature) = read_envelope(directory)?;
    let authorization = verify_for_current_build(&payload, &signature)?;
    hold_host(directory, authorization)
}

fn hold_host(directory: &Path, authorization: AuthorizedHost) -> Result<LoadedHost, String> {
    let path = directory.join("pa-capture-host.exe");
    let image = VerifiedImage::open(&path, authorization.host_sha256())
        .map_err(|_| "installed native host does not match signed authorization")?;
    Ok(LoadedHost {
        path,
        authorization,
        _image: image,
    })
}

fn open_document(path: &Path) -> Result<File, String> {
    let file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|_| "native resource document cannot be held read-only")?;
    // Check the opened object. Pre-open path metadata would permit substitution.
    let metadata = file
        .metadata()
        .map_err(|_| "native resource document metadata unavailable")?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("native resource document must be a regular non-reparse file".into());
    }
    Ok(file)
}

fn bounded_read(file: &mut File, limit: usize) -> Result<Vec<u8>, String> {
    let length = file
        .metadata()
        .map_err(|_| "native resource document size unavailable")?
        .len();
    if length == 0 || length > limit as u64 {
        return Err("native resource document exceeds bounds or is empty".into());
    }
    // Bound allocation and reads independently of the observed metadata.
    let mut bytes = Vec::with_capacity(length as usize);
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "native resource document read failed")?;
    if bytes.len() as u64 != length || bytes.len() > limit {
        return Err("native resource document changed or exceeded bounds".into());
    }
    Ok(bytes)
}

fn read_envelope(directory: &Path) -> Result<(Vec<u8>, String), String> {
    let mut payload_file = open_document(&directory.join("pa-native-host.json"))?;
    let mut signature_file = open_document(&directory.join("pa-native-host.json.sig"))?;
    let payload = bounded_read(&mut payload_file, MAX_PAYLOAD)?;
    let signature = String::from_utf8(bounded_read(&mut signature_file, MAX_SIGNATURE)?)
        .map_err(|_| "native resource signature is not UTF-8")?;
    Ok((payload, signature.trim().to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let mut random = [0u8; 16];
            getrandom::fill(&mut random).unwrap();
            let path = std::env::temp_dir().join(format!(
                "pa-resource-files-{:032x}",
                u128::from_le_bytes(random)
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn document_reader_bounds_and_sharing_are_enforced_on_opened_files() {
        let fixture = Fixture::new();
        let path = fixture.0.join("document");
        assert!(open_document(&path).is_err());
        assert!(open_document(&fixture.0).is_err());
        std::fs::write(&path, b"abcd").unwrap();
        let writer = OpenOptions::new().write(true).open(&path).unwrap();
        assert!(open_document(&path).is_err());
        drop(writer);
        let mut held = open_document(&path).unwrap();
        assert!(std::fs::write(&path, b"changed").is_err());
        assert!(std::fs::remove_file(&path).is_err());
        assert!(bounded_read(&mut held, 3).is_err());
        assert_eq!(bounded_read(&mut held, 4).unwrap(), b"abcd");
        drop(held);
        std::fs::write(&path, []).unwrap();
        assert!(bounded_read(&mut open_document(&path).unwrap(), 4).is_err());
    }

    #[test]
    fn document_reader_refuses_file_reparse_points_when_symlink_creation_is_available() {
        let fixture = Fixture::new();
        let target = fixture.0.join("target");
        let link = fixture.0.join("link");
        std::fs::write(&target, b"document").unwrap();
        match std::os::windows::fs::symlink_file(&target, &link) {
            Ok(()) => assert!(open_document(&link).is_err()),
            Err(error) if error.raw_os_error() == Some(1314) => {
                eprintln!("UNAVAILABLE: reparse fixture requires Windows symlink privilege; no reparse test evidence");
            }
            Err(error) => panic!("unexpected symlink fixture failure: {error}"),
        }
    }

    #[test]
    fn loaded_envelope_preserves_signed_bytes_and_host_hold_requires_exact_digest() {
        let fixture = Fixture::new();
        let fixtures: serde_json::Value =
            serde_json::from_str(include_str!("fixtures/native-resources.json")).unwrap();
        let valid = fixtures["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["name"] == "valid")
            .unwrap();
        let message = valid["message"].as_str().unwrap();
        let signature = valid["signature"].as_str().unwrap();
        std::fs::write(fixture.0.join("pa-native-host.json"), message).unwrap();
        let sig_path = fixture.0.join("pa-native-host.json.sig");
        std::fs::write(&sig_path, format!("{signature}\r\n")).unwrap();
        let (payload, loaded_signature) = read_envelope(&fixture.0).unwrap();
        assert_eq!(payload, message.as_bytes());
        let authority = super::super::verify(
            &payload,
            &loaded_signature,
            fixtures["publicKey"].as_str().unwrap(),
            &super::super::Expected {
                version: "1.3.0",
                commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                target: super::super::WINDOWS_TARGET,
                protocol: 1,
            },
        )
        .unwrap();
        let host = fixture.0.join("pa-capture-host.exe");
        std::fs::write(&host, b"host fixture, never executed").unwrap();
        assert!(hold_host(&fixture.0, authority).is_err());
        // Separate held-image test; this synthetic authority is not signed proof.
        let authority = AuthorizedHost {
            host_sha256: format!("{:x}", Sha256::digest(b"host fixture, never executed")),
            manifest_sha256: "fixture-only".into(),
        };
        let loaded = hold_host(&fixture.0, authority).unwrap();
        assert_eq!(loaded.path(), host);
        assert_eq!(loaded.authorization().manifest_sha256(), "fixture-only");
        assert!(std::fs::write(&host, b"replacement").is_err());
        assert!(std::fs::remove_file(&host).is_err());
        drop(loaded);
        std::fs::write(&host, b"replacement").unwrap();
        std::fs::write(&sig_path, [255]).unwrap();
        assert!(read_envelope(&fixture.0).is_err());
        std::fs::write(&sig_path, vec![b'a'; MAX_SIGNATURE + 1]).unwrap();
        assert!(read_envelope(&fixture.0).is_err());
    }
}
