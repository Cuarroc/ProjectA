//! Hold verified executable bytes against writes/deletion. This is the
//! pre-spawn check only; it does not attest a created process or loaded DLLs.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::Path;
use windows_sys::Win32::Storage::FileSystem::{
    GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_SHARE_READ,
};

const MAX_IMAGE_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageIdentity {
    pub schema_version: u32,
    pub volume_serial: u32,
    #[serde(serialize_with = "native_id")]
    pub file_index: u64,
    pub size: u64,
    pub sha256: String,
    pub state: &'static str,
}

pub(super) fn native_id<S: serde::Serializer>(
    value: &u64,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&value.to_string())
}

pub struct VerifiedImage {
    // Keeping this handle alive is essential: no write/delete sharing.
    _file: File,
    identity: ImageIdentity,
}

impl VerifiedImage {
    pub fn open(path: &Path, expected_sha256: &str) -> Result<Self, String> {
        if !path.is_absolute()
            || expected_sha256.len() != 64
            || !expected_sha256.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("absolute executable path and 64-digit SHA256 required".into());
        }
        let held = Self::observe(path)?;
        if !held.identity.sha256.eq_ignore_ascii_case(expected_sha256) {
            return Err(format!(
                "executable identity mismatch: expected {expected_sha256}, observed {}",
                held.identity.sha256
            ));
        }
        Ok(held)
    }

    // Observation is used only to select the native diagnostic image. It is
    // not an attestation against an independently supplied expected digest.
    pub(super) fn observe(path: &Path) -> Result<Self, String> {
        if !path.is_absolute() {
            return Err("absolute executable path required".into());
        }
        let mut file = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(path)
            .map_err(|e| format!("cannot hold executable without write/delete sharing: {e}"))?;
        let metadata = file.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_IMAGE_BYTES {
            return Err("executable must be a nonempty regular file of at most 512 MiB".into());
        }
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        // SAFETY: file owns a live handle, and info is writable for the call.
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err(format!(
                "cannot observe executable file identity: {}",
                std::io::Error::last_os_error()
            ));
        }
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 65_536];
        let mut count = 0u64;
        loop {
            let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            count += read as u64;
            if count > MAX_IMAGE_BYTES {
                return Err("executable grew beyond size bound".into());
            }
            hash.update(&buffer[..read]);
        }
        let digest = format!("{:x}", hash.finalize());
        if count != metadata.len() {
            return Err("executable size changed during observation".into());
        }
        Ok(Self {
            _file: file,
            identity: ImageIdentity {
                schema_version: 2,
                volume_serial: info.dwVolumeSerialNumber,
                file_index: ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
                size: count,
                sha256: digest,
                state: "held_file_verified_process_not_started",
            },
        })
    }

    pub fn identity(&self) -> &ImageIdentity {
        &self.identity
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn held_identity_rejects_replacement_writes_and_wrong_receipts() {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let dir =
            std::env::temp_dir().join(format!("pa-image-{:032x}", u128::from_le_bytes(random)));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("fixture.exe");
        // Native OS executable, copied into an isolated directory; never run.
        let source = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap())
            .join("System32")
            .join("whoami.exe");
        std::fs::copy(source, &path).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let digest = format!("{:x}", Sha256::digest(&bytes));
        assert!(VerifiedImage::open(&path, &"0".repeat(64)).is_err());
        assert!(VerifiedImage::open(Path::new("relative.exe"), &digest).is_err());
        // Sharing compatibility is checked against already-open access too.
        let existing_writer = OpenOptions::new()
            .write(true)
            .share_mode(
                FILE_SHARE_READ
                    | windows_sys::Win32::Storage::FileSystem::FILE_SHARE_WRITE
                    | windows_sys::Win32::Storage::FileSystem::FILE_SHARE_DELETE,
            )
            .open(&path)
            .unwrap();
        assert!(VerifiedImage::open(&path, &digest).is_err());
        drop(existing_writer);
        let held = VerifiedImage::open(&path, &digest.to_uppercase()).unwrap();
        assert_eq!(held.identity().sha256, digest);
        assert_eq!(held.identity().size, bytes.len() as u64);
        assert!(OpenOptions::new().write(true).open(&path).is_err());
        assert!(std::fs::remove_file(&path).is_err());
        assert!(std::fs::rename(&path, dir.join("moved.exe")).is_err());
        let second = VerifiedImage::open(&path, &digest).unwrap();
        assert_eq!(held.identity().file_index, second.identity().file_index);
        drop(second);
        drop(held);
        std::fs::write(&path, b"replacement").unwrap();
        assert!(VerifiedImage::open(&path, &digest).is_err());
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(&dir).unwrap();
    }
}
