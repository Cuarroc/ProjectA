//! Pure file identity checks for update staging.

use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

/// Names the source contract without changing update behavior.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(dead_code)] // W3-02
pub enum UpdateChannel {
    /// Bytes offered for validation before they may reach the stable channel.
    CandidateChannel,
    /// Bytes already published through the normal updater channel.
    PromotedUpdater,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(dead_code)] // W3-02
pub enum ArtifactKind {
    Manifest,
    Installer,
    Binary,
    Database,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(dead_code)] // W3-02
pub struct ExpectedFile {
    pub path: PathBuf,
    pub byte_len: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(dead_code)] // W3-02
pub struct StagingIdentity {
    pub channel: UpdateChannel,
    pub manifest: ExpectedFile,
    pub installer: ExpectedFile,
    pub binary: ExpectedFile,
    pub database: ExpectedFile,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(dead_code)] // W3-02
pub enum RejectionReason {
    Missing(ArtifactKind),
    Truncated(ArtifactKind),
    HashMismatch(ArtifactKind),
    Changed(ArtifactKind),
}

#[allow(dead_code)] // W3-02
pub struct InstallPayload {
    pub manifest: Vec<u8>,
    pub installer: Vec<u8>,
    pub binary: Vec<u8>,
    pub database: Vec<u8>,
}

#[allow(dead_code)] // W3-02
pub struct VerifiedStaging {
    identity: StagingIdentity,
}

impl StagingIdentity {
    #[allow(dead_code)] // W3-02
    pub fn verify(self) -> Result<VerifiedStaging, RejectionReason> {
        // Red-first stub: W3-02b implements the four identity checks next.
        Ok(VerifiedStaging { identity: self })
    }
}

impl VerifiedStaging {
    #[allow(dead_code)] // W3-02
    pub fn install<T>(
        self,
        install: impl FnOnce(InstallPayload) -> T,
    ) -> Result<T, RejectionReason> {
        let payload = InstallPayload {
            manifest: fs::read(&self.identity.manifest.path).unwrap_or_default(),
            installer: fs::read(&self.identity.installer.path).unwrap_or_default(),
            binary: fs::read(&self.identity.binary.path).unwrap_or_default(),
            database: fs::read(&self.identity.database.path).unwrap_or_default(),
        };
        Ok(install(payload))
    }
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;
    use std::cell::Cell;
    use std::path::Path;

    fn write_file(dir: &Path, name: &str, bytes: &[u8]) -> ExpectedFile {
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        ExpectedFile {
            path,
            byte_len: bytes.len() as u64,
            sha256: digest(bytes),
        }
    }

    fn identity(dir: &TempDir) -> StagingIdentity {
        StagingIdentity {
            channel: UpdateChannel::CandidateChannel,
            manifest: write_file(dir.path(), "manifest.json", b"manifest-1"),
            installer: write_file(dir.path(), "installer.bin", b"installer-1"),
            binary: write_file(dir.path(), "projecta.bin", b"binary-1"),
            database: write_file(dir.path(), "projecta.db", b"database-1"),
        }
    }

    #[test]
    fn installer_swap_after_hash_check_is_rejected_before_install() {
        let dir = TempDir::new("staging-swap");
        let expected = identity(&dir);
        let installer = expected.installer.path.clone();
        let staged = expected.verify().unwrap();
        fs::write(installer, b"attacker-11").unwrap();
        let calls = Cell::new(0);
        let result = staged.install(|_| calls.set(calls.get() + 1));
        assert_eq!(
            result,
            Err(RejectionReason::Changed(ArtifactKind::Installer))
        );
        assert_eq!(calls.get(), 0);
    }

    #[test]
    fn wrong_hash_is_rejected_with_named_reason() {
        let dir = TempDir::new("staging-hash");
        let mut expected = identity(&dir);
        expected.manifest.sha256 = digest(b"wrong-byte");
        assert!(matches!(
            expected.verify(),
            Err(RejectionReason::HashMismatch(ArtifactKind::Manifest))
        ));
    }

    #[test]
    fn missing_file_is_rejected_with_named_reason() {
        let dir = TempDir::new("staging-missing");
        let expected = identity(&dir);
        fs::remove_file(&expected.binary.path).unwrap();
        assert!(matches!(
            expected.verify(),
            Err(RejectionReason::Missing(ArtifactKind::Binary))
        ));
    }

    #[test]
    fn truncated_file_is_rejected_with_named_reason() {
        let dir = TempDir::new("staging-truncated");
        let expected = identity(&dir);
        fs::write(&expected.database.path, b"db").unwrap();
        assert!(matches!(
            expected.verify(),
            Err(RejectionReason::Truncated(ArtifactKind::Database))
        ));
    }
}
