//! Durable, bounded state for an application update that may be interrupted.
//!
//! This module deliberately does not download, install, restore a database, or
//! stop processes.  Those operations belong to a small privileged helper.  It
//! records the facts that helper has proved and returns the one next action it
//! is allowed to perform.  The journal is a file, rather than a SQLite row, so
//! restoring a database can never erase the recovery decision.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Bump this when a serialized journal becomes incompatible.
pub const JOURNAL_FORMAT_VERSION: u32 = 1;

static JOURNAL_TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// An immutable identity of one file involved in an update.
///
/// `sha256` is supplied by the verifier.  This state machine compares it but
/// does not pretend to have verified a signature or a hash itself.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIdentity {
    pub path: PathBuf,
    pub version: String,
    pub sha256: String,
}

impl FileIdentity {
    fn valid(&self, field: &'static str) -> Result<()> {
        if self.path.as_os_str().is_empty() || self.version.is_empty() || self.sha256.is_empty() {
            return Err(RecoveryError::InvalidFact(field));
        }
        Ok(())
    }
}

/// The binary and database identities which are paired for a run.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeIdentity {
    pub binary: FileIdentity,
    pub database: FileIdentity,
}

impl RuntimeIdentity {
    fn valid(&self, field: &'static str) -> Result<()> {
        self.binary.valid(field)?;
        self.database.valid(field)
    }
}

/// Candidate-bound approval records.  They are intentionally strings rather
/// than booleans: an authorization is an externally auditable record, never a
/// `true` passed through an update API.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImmutableRecords {
    pub policy_id: String,
    pub candidate_id: String,
    pub evidence_id: String,
}

impl ImmutableRecords {
    fn valid(&self) -> Result<()> {
        if self.policy_id.is_empty() || self.candidate_id.is_empty() || self.evidence_id.is_empty()
        {
            return Err(RecoveryError::InvalidFact(
                "policy, candidate, and evidence IDs are required",
            ));
        }
        Ok(())
    }
}

/// The staged manifest and the exact signed installer bytes it describes.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedManifestIdentity {
    pub manifest_sha256: String,
    pub signed_artifact_sha256: String,
    pub candidate_version: String,
}

impl StagedManifestIdentity {
    fn valid(&self) -> Result<()> {
        if self.manifest_sha256.is_empty()
            || self.signed_artifact_sha256.is_empty()
            || self.candidate_version.is_empty()
        {
            return Err(RecoveryError::InvalidFact("staged manifest identity"));
        }
        Ok(())
    }
}

/// Input for a newly offered update.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOffer {
    pub records: ImmutableRecords,
    pub nonce: String,
    pub previous: RuntimeIdentity,
    pub candidate: RuntimeIdentity,
    pub staged_manifest: StagedManifestIdentity,
}

/// A phase is persisted before the helper is told to take the corresponding
/// external action.  Thus a power loss always leaves an unambiguous next step.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdatePhase {
    Available,
    Downloaded,
    WaitingIdle,
    Maintenance,
    BackupVerified,
    Installing,
    Validating,
    Installed,
    Promoted,
    RecoveryNeeded,
}

/// The only actions a caller may hand to the privileged update helper.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum RecoveryAction {
    NoAction,
    WaitForIdle,
    VerifyCoherentBackup,
    InstallCandidate {
        candidate: FileIdentity,
        staged_manifest: StagedManifestIdentity,
    },
    ValidateCandidate {
        candidate: RuntimeIdentity,
        nonce: String,
    },
    PromoteSameSignedBytes {
        manifest_sha256: String,
        signed_artifact_sha256: String,
        candidate_id: String,
    },
    ResumeWrites,
    RestorePreviousRuntime {
        previous: RuntimeIdentity,
        snapshot: FileIdentity,
        reason: String,
    },
    QuarantineCurrentState {
        reason: String,
    },
}

/// Facts the application must observe before the journal may enter
/// maintenance.  These witness values avoid a generic boolean "release
/// authority" switch; the helper must attach the evidence it actually saw.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum QueueDrain {
    Confirmed,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum PtyDrain {
    Confirmed,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum MaintenanceMode {
    Active,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum WriteBlock {
    Active,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrainProof {
    pub queue_drain: QueueDrain,
    pub pty_drain: PtyDrain,
    pub maintenance_mode: MaintenanceMode,
    pub write_block: WriteBlock,
    pub evidence_id: String,
    /// Database identity observed after the maintenance write block/checkpoint.
    pub quiesced_database: FileIdentity,
}

impl DrainProof {
    fn valid(&self) -> Result<()> {
        self.quiesced_database.valid("quiesced database")?;
        if self.evidence_id.is_empty() {
            return Err(RecoveryError::InvalidFact("drain evidence ID"));
        }
        Ok(())
    }
}

/// A coherent SQLite snapshot, proven by the caller after its checkpoint and
/// sidecar handling.  The state machine only accepts a snapshot whose source
/// and content identities are the journal's pre-update database identity.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedBackup {
    pub snapshot: FileIdentity,
    pub source_database_sha256: String,
    pub checkpoint_evidence_id: String,
    pub verification_evidence_id: String,
}

impl VerifiedBackup {
    fn valid_for(&self, previous_database: &FileIdentity) -> Result<()> {
        self.snapshot.valid("backup snapshot")?;
        if self.source_database_sha256 != previous_database.sha256
            || self.snapshot.sha256 != previous_database.sha256
            || self.checkpoint_evidence_id.is_empty()
            || self.verification_evidence_id.is_empty()
        {
            return Err(RecoveryError::InvalidFact("coherent verified backup"));
        }
        Ok(())
    }
}

/// Identity returned by the newly installed current instance.  A response
/// from the old singleton or a second candidate cannot pass this comparison.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessIdentity {
    pub process_id: u32,
    pub started_at_unix_millis: u128,
}

impl ProcessIdentity {
    fn valid(&self) -> Result<()> {
        if self.process_id == 0 || self.started_at_unix_millis == 0 {
            return Err(RecoveryError::InvalidFact("current process identity"));
        }
        Ok(())
    }
}

/// Assertions observed by the caller's restricted validation endpoint.  They
/// name the evidence but do not claim to be an independent attestation.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ValidationAssertion {
    CandidateReady,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum HealthAssertion {
    Healthy,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationProof {
    pub validation: ValidationAssertion,
    pub health: HealthAssertion,
    pub validation_evidence_id: String,
    pub health_evidence_id: String,
}

impl ValidationProof {
    fn valid(&self) -> Result<()> {
        if self.validation_evidence_id.is_empty() || self.health_evidence_id.is_empty() {
            return Err(RecoveryError::InvalidFact(
                "validation and health evidence IDs",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceHandshake {
    pub binary: FileIdentity,
    pub database: FileIdentity,
    pub nonce: String,
    pub process: ProcessIdentity,
    pub validation: ValidationProof,
}

/// Receipt from the stable-channel publisher.  It proves only identity
/// equality; publishing itself is intentionally outside this module.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotionReceipt {
    pub manifest_sha256: String,
    pub signed_artifact_sha256: String,
    pub candidate_id: String,
    pub evidence_id: String,
}

/// Evidence recorded after the validated instance accepts writes again.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResumption {
    pub evidence_id: String,
}

/// The versioned persistent journal.  Its fields are private so callers cannot
/// edit policy/candidate/evidence records after creating the offer.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateJournal {
    format_version: u32,
    revision: u64,
    records: ImmutableRecords,
    nonce: String,
    previous: RuntimeIdentity,
    candidate: RuntimeIdentity,
    staged_manifest: StagedManifestIdentity,
    phase: UpdatePhase,
    drain: Option<DrainProof>,
    backup: Option<VerifiedBackup>,
    writes_resumed: bool,
    recovery_action: Option<RecoveryAction>,
}

impl UpdateJournal {
    pub fn new(offer: UpdateOffer) -> Result<Self> {
        offer.records.valid()?;
        offer.previous.valid("previous runtime identity")?;
        offer.candidate.valid("candidate runtime identity")?;
        offer.staged_manifest.valid()?;
        if offer.nonce.is_empty()
            || offer.staged_manifest.candidate_version != offer.candidate.binary.version
        {
            return Err(RecoveryError::InvalidFact("update offer identity"));
        }
        Ok(Self {
            format_version: JOURNAL_FORMAT_VERSION,
            revision: 0,
            records: offer.records,
            nonce: offer.nonce,
            previous: offer.previous,
            candidate: offer.candidate,
            staged_manifest: offer.staged_manifest,
            phase: UpdatePhase::Available,
            drain: None,
            backup: None,
            writes_resumed: false,
            recovery_action: None,
        })
    }

    pub fn phase(&self) -> UpdatePhase {
        self.phase
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn records(&self) -> &ImmutableRecords {
        &self.records
    }
    pub fn can_accept_writes(&self) -> bool {
        matches!(self.phase, UpdatePhase::Installed | UpdatePhase::Promoted) && self.writes_resumed
    }

    /// The action is deterministic from durable state, including after an
    /// interruption between every phase and the external helper action.
    pub fn next_action(&self) -> RecoveryAction {
        if let Some(action) = &self.recovery_action {
            return action.clone();
        }
        match self.phase {
            UpdatePhase::Available => RecoveryAction::NoAction,
            UpdatePhase::Downloaded | UpdatePhase::WaitingIdle => RecoveryAction::WaitForIdle,
            UpdatePhase::Maintenance => RecoveryAction::VerifyCoherentBackup,
            UpdatePhase::BackupVerified => RecoveryAction::InstallCandidate {
                candidate: self.candidate.binary.clone(),
                staged_manifest: self.staged_manifest.clone(),
            },
            UpdatePhase::Installing | UpdatePhase::Validating => {
                RecoveryAction::ValidateCandidate {
                    candidate: self.candidate.clone(),
                    nonce: self.nonce.clone(),
                }
            }
            UpdatePhase::Installed if !self.writes_resumed => RecoveryAction::ResumeWrites,
            UpdatePhase::Installed => RecoveryAction::PromoteSameSignedBytes {
                manifest_sha256: self.staged_manifest.manifest_sha256.clone(),
                signed_artifact_sha256: self.staged_manifest.signed_artifact_sha256.clone(),
                candidate_id: self.records.candidate_id.clone(),
            },
            UpdatePhase::Promoted => RecoveryAction::NoAction,
            UpdatePhase::RecoveryNeeded => RecoveryAction::QuarantineCurrentState {
                reason: "journal is missing its recovery action".to_string(),
            },
        }
    }

    pub fn record_downloaded(&mut self, observed: &StagedManifestIdentity) -> Result<()> {
        self.require(UpdatePhase::Available, "record downloaded candidate")?;
        if observed != &self.staged_manifest {
            return Err(RecoveryError::IdentityMismatch("staged manifest"));
        }
        self.phase = UpdatePhase::Downloaded;
        Ok(())
    }

    pub fn wait_for_idle(&mut self) -> Result<()> {
        self.require(UpdatePhase::Downloaded, "wait for idle")?;
        self.phase = UpdatePhase::WaitingIdle;
        Ok(())
    }

    pub fn enter_maintenance(&mut self, proof: DrainProof) -> Result<()> {
        self.require(UpdatePhase::WaitingIdle, "enter maintenance")?;
        proof.valid()?;
        if proof.quiesced_database.path != self.previous.database.path {
            return Err(RecoveryError::IdentityMismatch("quiesced database path"));
        }
        self.previous.database = proof.quiesced_database.clone();
        self.drain = Some(proof);
        self.phase = UpdatePhase::Maintenance;
        Ok(())
    }

    pub fn verify_backup(&mut self, backup: VerifiedBackup) -> Result<()> {
        self.require(UpdatePhase::Maintenance, "verify coherent backup")?;
        if self.drain.is_none() {
            return Err(RecoveryError::InvalidFact("maintenance drain proof"));
        }
        backup.valid_for(&self.previous.database)?;
        self.backup = Some(backup);
        self.phase = UpdatePhase::BackupVerified;
        Ok(())
    }

    pub fn begin_install(&mut self) -> Result<()> {
        self.require(UpdatePhase::BackupVerified, "begin install")?;
        if self.drain.is_none() || self.backup.is_none() {
            return Err(RecoveryError::InvalidFact(
                "drain and backup before install",
            ));
        }
        self.phase = UpdatePhase::Installing;
        Ok(())
    }

    pub fn begin_validation(&mut self) -> Result<()> {
        self.require(UpdatePhase::Installing, "begin validation")?;
        self.phase = UpdatePhase::Validating;
        Ok(())
    }

    pub fn accept_handshake(&mut self, handshake: &InstanceHandshake) -> Result<()> {
        self.require(UpdatePhase::Validating, "accept candidate handshake")?;
        handshake.process.valid()?;
        handshake.validation.valid()?;
        if handshake.nonce != self.nonce
            || handshake.binary != self.candidate.binary
            || handshake.database != self.candidate.database
        {
            return Err(RecoveryError::IdentityMismatch(
                "current instance handshake",
            ));
        }
        self.phase = UpdatePhase::Installed;
        Ok(())
    }

    /// A failed pre-write health check may recover from the verified backup.
    pub fn record_health_failure(&mut self, reason: impl Into<String>) -> Result<()> {
        if !matches!(self.phase, UpdatePhase::Validating | UpdatePhase::Installed)
            || self.writes_resumed
        {
            return Err(RecoveryError::InvalidTransition {
                from: self.phase,
                operation: "record pre-write health failure",
            });
        }
        let reason = nonempty(reason.into(), "health failure reason")?;
        let backup = self
            .backup
            .as_ref()
            .ok_or(RecoveryError::InvalidFact("verified backup"))?;
        self.phase = UpdatePhase::RecoveryNeeded;
        self.recovery_action = Some(RecoveryAction::RestorePreviousRuntime {
            previous: self.previous.clone(),
            snapshot: backup.snapshot.clone(),
            reason,
        });
        Ok(())
    }

    pub fn promote(&mut self, receipt: &PromotionReceipt) -> Result<()> {
        self.require(UpdatePhase::Installed, "promote candidate")?;
        if !self.writes_resumed {
            return Err(RecoveryError::InvalidFact(
                "writes must resume after validation before promotion",
            ));
        }
        if receipt.evidence_id.is_empty()
            || receipt.candidate_id != self.records.candidate_id
            || receipt.manifest_sha256 != self.staged_manifest.manifest_sha256
            || receipt.signed_artifact_sha256 != self.staged_manifest.signed_artifact_sha256
        {
            return Err(RecoveryError::IdentityMismatch("stable promotion identity"));
        }
        self.phase = UpdatePhase::Promoted;
        Ok(())
    }

    pub fn resume_writes(&mut self, proof: WriteResumption) -> Result<()> {
        self.require(UpdatePhase::Installed, "resume writes")?;
        if proof.evidence_id.is_empty() {
            return Err(RecoveryError::InvalidFact("write-resumption evidence ID"));
        }
        self.writes_resumed = true;
        Ok(())
    }

    /// Once user writes are accepted, an old database is history.  A later
    /// runtime failure can only quarantine the new state for a human/helper;
    /// it never returns a rollback action.
    pub fn record_post_resume_failure(&mut self, reason: impl Into<String>) -> Result<()> {
        if !self.writes_resumed {
            return Err(RecoveryError::InvalidTransition {
                from: self.phase,
                operation: "record post-resume failure",
            });
        }
        let reason = nonempty(reason.into(), "post-resume failure reason")?;
        self.phase = UpdatePhase::RecoveryNeeded;
        self.recovery_action = Some(RecoveryAction::QuarantineCurrentState { reason });
        Ok(())
    }

    fn require(&self, expected: UpdatePhase, operation: &'static str) -> Result<()> {
        if self.phase != expected {
            return Err(RecoveryError::InvalidTransition {
                from: self.phase,
                operation,
            });
        }
        Ok(())
    }

    fn validate_loaded(&self) -> Result<()> {
        if self.format_version != JOURNAL_FORMAT_VERSION {
            return Err(RecoveryError::UnsupportedJournalVersion(
                self.format_version,
            ));
        }
        self.records.valid()?;
        self.previous.valid("previous runtime identity")?;
        self.candidate.valid("candidate runtime identity")?;
        self.staged_manifest.valid()?;
        if let Some(drain) = &self.drain {
            if drain.quiesced_database != self.previous.database {
                return Err(RecoveryError::IdentityMismatch("loaded quiesced database"));
            }
        }
        if self.nonce.is_empty()
            || self.staged_manifest.candidate_version != self.candidate.binary.version
        {
            return Err(RecoveryError::InvalidFact("loaded update offer identity"));
        }
        match self.phase {
            UpdatePhase::Available | UpdatePhase::Downloaded | UpdatePhase::WaitingIdle => {
                if self.drain.is_some()
                    || self.backup.is_some()
                    || self.writes_resumed
                    || self.recovery_action.is_some()
                {
                    return Err(RecoveryError::InvalidFact("pre-maintenance journal state"));
                }
            }
            UpdatePhase::Maintenance => {
                self.drain
                    .as_ref()
                    .ok_or(RecoveryError::InvalidFact("maintenance drain proof"))?
                    .valid()?;
                if self.backup.is_some() || self.writes_resumed || self.recovery_action.is_some() {
                    return Err(RecoveryError::InvalidFact("maintenance journal state"));
                }
            }
            UpdatePhase::BackupVerified | UpdatePhase::Installing | UpdatePhase::Validating => {
                self.drain
                    .as_ref()
                    .ok_or(RecoveryError::InvalidFact("maintenance drain proof"))?
                    .valid()?;
                self.backup
                    .as_ref()
                    .ok_or(RecoveryError::InvalidFact("verified backup"))?
                    .valid_for(&self.previous.database)?;
                if self.writes_resumed || self.recovery_action.is_some() {
                    return Err(RecoveryError::InvalidFact("pre-promotion journal state"));
                }
            }
            UpdatePhase::Installed => {
                self.drain
                    .as_ref()
                    .ok_or(RecoveryError::InvalidFact("maintenance drain proof"))?
                    .valid()?;
                self.backup
                    .as_ref()
                    .ok_or(RecoveryError::InvalidFact("verified backup"))?
                    .valid_for(&self.previous.database)?;
                if self.recovery_action.is_some() {
                    return Err(RecoveryError::InvalidFact("installed journal state"));
                }
            }
            UpdatePhase::Promoted => {
                self.drain
                    .as_ref()
                    .ok_or(RecoveryError::InvalidFact("maintenance drain proof"))?
                    .valid()?;
                self.backup
                    .as_ref()
                    .ok_or(RecoveryError::InvalidFact("verified backup"))?
                    .valid_for(&self.previous.database)?;
                if !self.writes_resumed || self.recovery_action.is_some() {
                    return Err(RecoveryError::InvalidFact("promoted journal state"));
                }
            }
            UpdatePhase::RecoveryNeeded => {
                self.drain
                    .as_ref()
                    .ok_or(RecoveryError::InvalidFact("maintenance drain proof"))?
                    .valid()?;
                self.backup
                    .as_ref()
                    .ok_or(RecoveryError::InvalidFact("verified backup"))?
                    .valid_for(&self.previous.database)?;
                match self.recovery_action.as_ref() {
                    Some(RecoveryAction::RestorePreviousRuntime {
                        previous,
                        snapshot,
                        reason,
                    }) if !self.writes_resumed
                        && previous == &self.previous
                        && self
                            .backup
                            .as_ref()
                            .is_some_and(|backup| &backup.snapshot == snapshot)
                        && !reason.is_empty() => {}
                    Some(RecoveryAction::QuarantineCurrentState { reason })
                        if !reason.is_empty() => {}
                    _ => {
                        return Err(RecoveryError::InvalidFact(
                            "unsafe or mismatched recovery action",
                        ))
                    }
                }
            }
        }
        Ok(())
    }
}

/// A journal's on-disk location.  The caller must give the live database path
/// once, which rejects the dangerous case of using the restored DB file itself
/// as the journal.  A sibling file is valid: it is outside SQLite's contents.
#[derive(Clone, Debug)]
pub struct JournalStore {
    path: PathBuf,
}

impl JournalStore {
    pub fn new(path: impl Into<PathBuf>, database_path: &Path) -> Result<Self> {
        let path = path.into();
        let sidecar = |suffix: &str| {
            database_path.with_file_name(format!(
                "{}{}",
                database_path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy(),
                suffix
            ))
        };
        if path.as_os_str().is_empty()
            || same_path(&path, database_path)
            || same_path(&path, &sidecar("-wal"))
            || same_path(&path, &sidecar("-shm"))
        {
            return Err(RecoveryError::InvalidJournalLocation(path));
        }
        Ok(Self { path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<UpdateJournal> {
        let mut bytes = Vec::new();
        File::open(&self.path)
            .and_then(|mut file| file.read_to_end(&mut bytes))
            .map_err(|err| RecoveryError::Io(format!("read {}: {err}", self.path.display())))?;
        let journal: UpdateJournal = serde_json::from_slice(&bytes).map_err(|err| {
            RecoveryError::Serialization(format!("parse {}: {err}", self.path.display()))
        })?;
        journal.validate_loaded()?;
        Ok(journal)
    }

    fn create(&self, journal: &UpdateJournal) -> Result<()> {
        let _lock = self.acquire_write_lock()?;
        if self.path.exists() {
            return Err(RecoveryError::JournalAlreadyExists(self.path.clone()));
        }
        self.write_body(journal)
    }

    fn compare_and_write(&self, journal: &mut UpdateJournal, expected_revision: u64) -> Result<()> {
        let _lock = self.acquire_write_lock()?;
        let actual_revision = self.load()?.revision;
        if actual_revision != expected_revision {
            return Err(RecoveryError::StaleWriter {
                expected: expected_revision,
                actual: actual_revision,
            });
        }
        journal.revision = expected_revision
            .checked_add(1)
            .ok_or(RecoveryError::InvalidFact("journal revision overflow"))?;
        self.write_body(journal)
    }

    fn write_body(&self, journal: &UpdateJournal) -> Result<()> {
        journal.validate_loaded()?;
        let body = serde_json::to_vec_pretty(journal)
            .map_err(|err| RecoveryError::Serialization(format!("serialize journal: {err}")))?;
        write_atomic(&self.path, &body)
    }

    fn acquire_write_lock(&self) -> Result<JournalWriteLock> {
        let file_name = self
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| RecoveryError::InvalidJournalLocation(self.path.clone()))?;
        let lock_path = self.path.with_file_name(format!("{file_name}.lock"));
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .map_err(|error| {
                RecoveryError::Io(format!(
                    "open journal lock {}: {error}",
                    lock_path.display()
                ))
            })?;
        match file.try_lock() {
            Ok(()) => Ok(JournalWriteLock { _file: file }),
            Err(std::fs::TryLockError::WouldBlock) => {
                Err(RecoveryError::ConcurrentWriter(lock_path))
            }
            Err(error) => Err(RecoveryError::Io(format!(
                "lock journal {}: {error}",
                lock_path.display()
            ))),
        }
    }
}

/// Held only over the compare-and-swap write. The operating system releases
/// it if the writer exits or crashes. Its path is retained because an
/// unlink-and-recreate protocol could split the lock across two inodes.
struct JournalWriteLock {
    _file: File,
}

/// A loaded journal whose every public state transition is persisted first.
#[derive(Clone, Debug)]
pub struct DurableJournal {
    store: JournalStore,
    journal: UpdateJournal,
}

impl DurableJournal {
    pub fn create(store: JournalStore, journal: UpdateJournal) -> Result<Self> {
        store.create(&journal)?;
        Ok(Self { store, journal })
    }

    pub fn open(store: JournalStore) -> Result<Self> {
        let journal = store.load()?;
        Ok(Self { store, journal })
    }

    pub fn journal(&self) -> &UpdateJournal {
        &self.journal
    }
    pub fn next_action(&self) -> RecoveryAction {
        self.journal.next_action()
    }

    pub fn record_downloaded(&mut self, observed: &StagedManifestIdentity) -> Result<()> {
        self.change(|journal| journal.record_downloaded(observed))
    }
    pub fn wait_for_idle(&mut self) -> Result<()> {
        self.change(UpdateJournal::wait_for_idle)
    }
    pub fn enter_maintenance(&mut self, proof: DrainProof) -> Result<()> {
        self.change(|journal| journal.enter_maintenance(proof))
    }
    pub fn verify_backup(&mut self, backup: VerifiedBackup) -> Result<()> {
        self.change(|journal| journal.verify_backup(backup))
    }
    pub fn begin_install(&mut self) -> Result<()> {
        self.change(UpdateJournal::begin_install)
    }
    pub fn begin_validation(&mut self) -> Result<()> {
        self.change(UpdateJournal::begin_validation)
    }
    pub fn accept_handshake(&mut self, handshake: &InstanceHandshake) -> Result<()> {
        self.change(|journal| journal.accept_handshake(handshake))
    }
    pub fn record_health_failure(&mut self, reason: impl Into<String>) -> Result<()> {
        self.change(|journal| journal.record_health_failure(reason.into()))
    }
    pub fn promote(&mut self, receipt: &PromotionReceipt) -> Result<()> {
        self.change(|journal| journal.promote(receipt))
    }
    pub fn resume_writes(&mut self, proof: WriteResumption) -> Result<()> {
        self.change(|journal| journal.resume_writes(proof))
    }
    pub fn record_post_resume_failure(&mut self, reason: impl Into<String>) -> Result<()> {
        self.change(|journal| journal.record_post_resume_failure(reason.into()))
    }

    fn change(&mut self, operation: impl FnOnce(&mut UpdateJournal) -> Result<()>) -> Result<()> {
        let mut next = self.journal.clone();
        operation(&mut next)?;
        self.store
            .compare_and_write(&mut next, self.journal.revision)?;
        self.journal = next;
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RecoveryError {
    InvalidTransition {
        from: UpdatePhase,
        operation: &'static str,
    },
    InvalidFact(&'static str),
    IdentityMismatch(&'static str),
    UnsupportedJournalVersion(u32),
    InvalidJournalLocation(PathBuf),
    JournalAlreadyExists(PathBuf),
    ConcurrentWriter(PathBuf),
    StaleWriter {
        expected: u64,
        actual: u64,
    },
    Io(String),
    Serialization(String),
}

impl fmt::Display for RecoveryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidTransition { from, operation } => {
                write!(f, "cannot {operation} from {from:?}")
            }
            Self::InvalidFact(fact) => write!(f, "invalid recovery fact: {fact}"),
            Self::IdentityMismatch(identity) => write!(f, "recovery identity mismatch: {identity}"),
            Self::UnsupportedJournalVersion(version) => {
                write!(f, "unsupported update journal version {version}")
            }
            Self::InvalidJournalLocation(path) => write!(
                f,
                "journal must be outside the database: {}",
                path.display()
            ),
            Self::JournalAlreadyExists(path) => {
                write!(f, "journal already exists: {}", path.display())
            }
            Self::ConcurrentWriter(path) => {
                write!(f, "journal writer is active: {}", path.display())
            }
            Self::StaleWriter { expected, actual } => write!(
                f,
                "stale journal writer expected revision {expected}, found {actual}"
            ),
            Self::Io(error) | Self::Serialization(error) => f.write_str(error),
        }
    }
}

impl std::error::Error for RecoveryError {}

pub type Result<T> = std::result::Result<T, RecoveryError>;

fn nonempty(value: String, field: &'static str) -> Result<String> {
    if value.is_empty() {
        Err(RecoveryError::InvalidFact(field))
    } else {
        Ok(value)
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    fn resolved(path: &Path) -> Option<PathBuf> {
        if let Ok(path) = path.canonicalize() {
            return Some(path);
        }
        // Resolve existing ancestors even when the WAL/SHM leaf is absent.
        let leaf = path.file_name()?;
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        Some(parent.canonicalize().ok()?.join(leaf))
    }
    match (resolved(left), resolved(right)) {
        (Some(left), Some(right)) => paths_equal(&left, &right),
        _ => paths_equal(left, right),
    }
}

#[cfg(windows)]
fn paths_equal(left: &Path, right: &Path) -> bool {
    left.as_os_str().eq_ignore_ascii_case(right.as_os_str())
}

#[cfg(not(windows))]
fn paths_equal(left: &Path, right: &Path) -> bool {
    left == right
}

/// Write and flush before replacement.  Windows uses `MoveFileExW` with
/// WRITE_THROUGH; Unix uses its atomic rename.  This mirrors the provider-vault
/// pattern, but has a per-process sequence suffix. `create_new` and the retry
/// prevent a stale temp file from blocking a later writer after PID reuse.
fn write_atomic(path: &Path, body: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| RecoveryError::InvalidJournalLocation(path.to_path_buf()))?;
    if !parent.exists() {
        return Err(RecoveryError::Io(format!(
            "journal directory does not exist: {}",
            parent.display()
        )));
    }
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| RecoveryError::InvalidJournalLocation(path.to_path_buf()))?;
    let mut tmp = None;
    for _ in 0..64 {
        let sequence = JOURNAL_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let candidate =
            path.with_file_name(format!("{file_name}.tmp-{}-{sequence}", std::process::id()));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(mut file) => {
                if let Err(error) = file.write_all(body).and_then(|_| file.sync_all()) {
                    let _ = fs::remove_file(&candidate);
                    return Err(RecoveryError::Io(format!(
                        "write {}: {error}",
                        candidate.display()
                    )));
                }
                tmp = Some(candidate);
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(RecoveryError::Io(format!(
                    "create journal temp {}: {error}",
                    candidate.display()
                )));
            }
        }
    }
    let tmp = tmp.ok_or_else(|| {
        RecoveryError::Io(format!(
            "could not allocate a journal temp beside {}",
            path.display()
        ))
    })?;
    if let Err(error) = replace_file(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(RecoveryError::Io(format!(
            "replace {}: {error}",
            path.display()
        )));
    }
    sync_parent(parent)?;
    Ok(())
}

#[cfg(windows)]
fn replace_file(tmp: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let wide = |path: &Path| -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    };
    let from = wide(tmp);
    let to = wide(target);
    // Freshly written temp files are briefly scanned by indexers/AV on
    // Windows; the move then fails transiently with access/sharing errors
    // (seen three times on 2026-09-14 in delivery_recovery tests under
    // parallel load, always os error 5 on this exact replace). Retry within
    // a small bounded budget; any other error is returned at once.
    const RETRYABLE: [i32; 2] = [5, 32]; // ERROR_ACCESS_DENIED, ERROR_SHARING_VIOLATION
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
    loop {
        if unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } != 0
        {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        let raw = error.raw_os_error();
        if !raw.is_some_and(|code| RETRYABLE.contains(&code))
            || std::time::Instant::now() >= deadline
        {
            return Err(error);
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
}

#[cfg(not(windows))]
fn replace_file(tmp: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(tmp, target)
}

#[cfg(unix)]
fn sync_parent(parent: &Path) -> Result<()> {
    File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|error| {
            RecoveryError::Io(format!(
                "sync journal directory {}: {error}",
                parent.display()
            ))
        })
}

#[cfg(not(unix))]
fn sync_parent(_: &Path) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    #[test]
    fn absent_sidecar_alias_is_rejected() {
        let dir = TempDir::new("journal-alias");
        let database = dir.path().join("projecta.db");
        assert!(
            JournalStore::new(dir.path().join(".").join("projecta.db-wal"), &database).is_err()
        );
        assert!(
            JournalStore::new(dir.path().join(".").join("projecta.db-shm"), &database).is_err()
        );
    }

    #[test]
    fn installed_pre_write_failure_restores_quiesced_database_after_restart() {
        let dir = TempDir::new("journal-quiesced");
        let location = store(&dir);
        let mut journal =
            DurableJournal::create(location.clone(), UpdateJournal::new(offer()).unwrap()).unwrap();
        journal.record_downloaded(&offer().staged_manifest).unwrap();
        journal.wait_for_idle().unwrap();
        let mut drain = proof();
        drain.quiesced_database.sha256 = "after-interactive-writes".into();
        journal.enter_maintenance(drain.clone()).unwrap();
        assert!(journal.verify_backup(backup()).is_err());
        let mut snapshot = backup();
        snapshot.snapshot.sha256 = drain.quiesced_database.sha256.clone();
        snapshot.source_database_sha256 = drain.quiesced_database.sha256.clone();
        journal.verify_backup(snapshot.clone()).unwrap();
        journal.begin_install().unwrap();
        journal.begin_validation().unwrap();
        journal.accept_handshake(&handshake()).unwrap();
        journal
            .record_health_failure("failed before resumption")
            .unwrap();
        let reopened = DurableJournal::open(location).unwrap();
        let mut previous = offer().previous;
        previous.database = drain.quiesced_database;
        assert_eq!(
            reopened.next_action(),
            RecoveryAction::RestorePreviousRuntime {
                previous,
                snapshot: snapshot.snapshot,
                reason: "failed before resumption".into()
            }
        );
    }

    #[test]
    fn installed_failure_cannot_rollback_after_writes() {
        let dir = TempDir::new("journal-no-late-rollback");
        let mut journal =
            DurableJournal::create(store(&dir), UpdateJournal::new(offer()).unwrap()).unwrap();
        through_validation(&mut journal);
        journal.accept_handshake(&handshake()).unwrap();
        journal
            .resume_writes(WriteResumption {
                evidence_id: "resume".into(),
            })
            .unwrap();
        assert!(journal.record_health_failure("late failure").is_err());
    }

    #[test]
    fn loaded_recovery_cannot_restore_after_writes_or_restore_a_different_pair() {
        let mut journal = UpdateJournal::new(offer()).unwrap();
        journal.record_downloaded(&offer().staged_manifest).unwrap();
        journal.wait_for_idle().unwrap();
        journal.enter_maintenance(proof()).unwrap();
        journal.verify_backup(backup()).unwrap();
        journal.begin_install().unwrap();
        journal.begin_validation().unwrap();
        journal.record_health_failure("failed health").unwrap();
        journal.validate_loaded().unwrap();
        journal.writes_resumed = true;
        assert!(journal.validate_loaded().is_err());
        journal.writes_resumed = false;
        if let Some(RecoveryAction::RestorePreviousRuntime { previous, .. }) =
            &mut journal.recovery_action
        {
            previous.binary.sha256 = "wrong".into();
        }
        assert!(journal.validate_loaded().is_err());
    }

    fn file(name: &str, version: &str, hash: &str) -> FileIdentity {
        FileIdentity {
            path: PathBuf::from(name),
            version: version.into(),
            sha256: hash.into(),
        }
    }

    fn offer() -> UpdateOffer {
        UpdateOffer {
            records: ImmutableRecords {
                policy_id: "policy-7".into(),
                candidate_id: "candidate-9".into(),
                evidence_id: "review-3".into(),
            },
            nonce: "nonce-a".into(),
            previous: RuntimeIdentity {
                binary: file("old.exe", "1.3.0", "old-bin"),
                database: file("projecta.db", "4", "old-db"),
            },
            candidate: RuntimeIdentity {
                binary: file("new.exe", "1.4.0", "new-bin"),
                database: file("projecta.db", "4", "new-db"),
            },
            staged_manifest: StagedManifestIdentity {
                manifest_sha256: "manifest-a".into(),
                signed_artifact_sha256: "signed-installer-a".into(),
                candidate_version: "1.4.0".into(),
            },
        }
    }

    fn store(dir: &TempDir) -> JournalStore {
        JournalStore::new(
            dir.path().join("update-recovery.json"),
            &dir.path().join("projecta.db"),
        )
        .expect("store")
    }

    fn proof() -> DrainProof {
        DrainProof {
            queue_drain: QueueDrain::Confirmed,
            pty_drain: PtyDrain::Confirmed,
            maintenance_mode: MaintenanceMode::Active,
            write_block: WriteBlock::Active,
            evidence_id: "drain-1".into(),
            quiesced_database: offer().previous.database,
        }
    }

    fn backup() -> VerifiedBackup {
        VerifiedBackup {
            snapshot: file("backup.db", "4", "old-db"),
            source_database_sha256: "old-db".into(),
            checkpoint_evidence_id: "checkpoint-1".into(),
            verification_evidence_id: "backup-1".into(),
        }
    }

    fn handshake() -> InstanceHandshake {
        InstanceHandshake {
            binary: file("new.exe", "1.4.0", "new-bin"),
            database: file("projecta.db", "4", "new-db"),
            nonce: "nonce-a".into(),
            process: ProcessIdentity {
                process_id: 4242,
                started_at_unix_millis: 1_726_000_000_000,
            },
            validation: ValidationProof {
                validation: ValidationAssertion::CandidateReady,
                health: HealthAssertion::Healthy,
                validation_evidence_id: "validate-1".into(),
                health_evidence_id: "health-1".into(),
            },
        }
    }

    fn receipt() -> PromotionReceipt {
        PromotionReceipt {
            manifest_sha256: "manifest-a".into(),
            signed_artifact_sha256: "signed-installer-a".into(),
            candidate_id: "candidate-9".into(),
            evidence_id: "promote-1".into(),
        }
    }

    fn through_validation(journal: &mut DurableJournal) {
        let manifest = offer().staged_manifest;
        journal.record_downloaded(&manifest).expect("downloaded");
        journal.wait_for_idle().expect("waiting idle");
        journal.enter_maintenance(proof()).expect("maintenance");
        journal.verify_backup(backup()).expect("backup");
        journal.begin_install().expect("installing");
        journal.begin_validation().expect("validating");
    }

    #[test]
    fn every_interrupted_phase_has_one_deterministic_next_action() {
        let dir = TempDir::new("delivery-recovery-interruptions");
        let store = store(&dir);
        let mut journal =
            DurableJournal::create(store.clone(), UpdateJournal::new(offer()).expect("offer"))
                .expect("create");

        macro_rules! restart {
            () => {
                journal = DurableJournal::open(store.clone()).expect("reopen after interruption")
            };
        }

        assert_eq!(journal.next_action(), RecoveryAction::NoAction);
        restart!();
        let manifest = offer().staged_manifest;
        journal.record_downloaded(&manifest).expect("downloaded");
        assert_eq!(journal.next_action(), RecoveryAction::WaitForIdle);
        restart!();
        journal.wait_for_idle().expect("waiting");
        assert_eq!(journal.next_action(), RecoveryAction::WaitForIdle);
        restart!();
        journal.enter_maintenance(proof()).expect("maintenance");
        assert_eq!(journal.next_action(), RecoveryAction::VerifyCoherentBackup);
        restart!();
        journal.verify_backup(backup()).expect("backup");
        assert!(matches!(
            journal.next_action(),
            RecoveryAction::InstallCandidate { .. }
        ));
        restart!();
        journal.begin_install().expect("install");
        assert!(matches!(
            journal.next_action(),
            RecoveryAction::ValidateCandidate { .. }
        ));
        restart!();
        journal.begin_validation().expect("validate");
        assert!(matches!(
            journal.next_action(),
            RecoveryAction::ValidateCandidate { .. }
        ));
        restart!();
        journal.accept_handshake(&handshake()).expect("handshake");
        assert_eq!(journal.next_action(), RecoveryAction::ResumeWrites);
        restart!();
        journal
            .resume_writes(WriteResumption {
                evidence_id: "writes-1".into(),
            })
            .expect("writes");
        assert!(matches!(
            journal.next_action(),
            RecoveryAction::PromoteSameSignedBytes { .. }
        ));
        restart!();
        journal.promote(&receipt()).expect("promote");
        assert_eq!(journal.next_action(), RecoveryAction::NoAction);
        restart!();
        assert_eq!(journal.journal().phase(), UpdatePhase::Promoted);
    }

    #[test]
    fn wrong_instance_handshake_never_marks_candidate_installed() {
        let dir = TempDir::new("delivery-recovery-wrong-instance");
        let mut journal =
            DurableJournal::create(store(&dir), UpdateJournal::new(offer()).expect("offer"))
                .expect("create");
        through_validation(&mut journal);
        let mut wrong = handshake();
        wrong.nonce = "old-instance".into();
        assert_eq!(
            journal.accept_handshake(&wrong),
            Err(RecoveryError::IdentityMismatch(
                "current instance handshake"
            ))
        );
        assert_eq!(journal.journal().phase(), UpdatePhase::Validating);
    }

    #[test]
    fn handshake_requires_named_process_validation_and_health_evidence() {
        let dir = TempDir::new("delivery-recovery-handshake-proof");
        let mut journal =
            DurableJournal::create(store(&dir), UpdateJournal::new(offer()).expect("offer"))
                .expect("create");
        through_validation(&mut journal);
        let mut missing_health = handshake();
        missing_health.validation.health_evidence_id.clear();
        assert_eq!(
            journal.accept_handshake(&missing_health),
            Err(RecoveryError::InvalidFact(
                "validation and health evidence IDs"
            ))
        );
        assert_eq!(journal.journal().phase(), UpdatePhase::Validating);
    }

    #[test]
    fn interrupted_install_requires_validation_not_a_second_unproven_install() {
        let dir = TempDir::new("delivery-recovery-install-interrupt");
        let store = store(&dir);
        let mut journal =
            DurableJournal::create(store.clone(), UpdateJournal::new(offer()).expect("offer"))
                .expect("create");
        let manifest = offer().staged_manifest;
        journal.record_downloaded(&manifest).expect("download");
        journal.wait_for_idle().expect("wait");
        journal.enter_maintenance(proof()).expect("maint");
        journal.verify_backup(backup()).expect("backup");
        journal.begin_install().expect("installing");
        drop(journal);
        assert!(matches!(
            DurableJournal::open(store).expect("reload").next_action(),
            RecoveryAction::ValidateCandidate { .. }
        ));
    }

    #[test]
    fn failed_health_before_writes_offers_only_verified_backup_recovery() {
        let dir = TempDir::new("delivery-recovery-health-failure");
        let mut journal =
            DurableJournal::create(store(&dir), UpdateJournal::new(offer()).expect("offer"))
                .expect("create");
        through_validation(&mut journal);
        journal
            .record_health_failure("migration probe failed")
            .expect("failure");
        assert_eq!(journal.journal().phase(), UpdatePhase::RecoveryNeeded);
        assert_eq!(
            journal.next_action(),
            RecoveryAction::RestorePreviousRuntime {
                previous: offer().previous,
                snapshot: file("backup.db", "4", "old-db"),
                reason: "migration probe failed".into(),
            }
        );
        assert!(!journal.journal().can_accept_writes());
    }

    #[test]
    fn post_resume_failure_quarantines_and_cannot_offer_old_database_rollback() {
        let dir = TempDir::new("delivery-recovery-no-rollback");
        let mut journal =
            DurableJournal::create(store(&dir), UpdateJournal::new(offer()).expect("offer"))
                .expect("create");
        through_validation(&mut journal);
        journal.accept_handshake(&handshake()).expect("handshake");
        journal
            .resume_writes(WriteResumption {
                evidence_id: "writes-1".into(),
            })
            .expect("writes");
        journal.promote(&receipt()).expect("promote");
        journal
            .record_post_resume_failure("runtime migration regression")
            .expect("failure");
        assert!(matches!(
            journal.next_action(),
            RecoveryAction::QuarantineCurrentState { .. }
        ));
    }

    #[test]
    fn promotion_requires_the_exact_staged_signed_bytes() {
        let dir = TempDir::new("delivery-recovery-stable-identity");
        let mut journal =
            DurableJournal::create(store(&dir), UpdateJournal::new(offer()).expect("offer"))
                .expect("create");
        through_validation(&mut journal);
        journal.accept_handshake(&handshake()).expect("handshake");
        journal
            .resume_writes(WriteResumption {
                evidence_id: "writes-1".into(),
            })
            .expect("writes");
        let mut changed = receipt();
        changed.signed_artifact_sha256 = "different-signed-bytes".into();
        assert_eq!(
            journal.promote(&changed),
            Err(RecoveryError::IdentityMismatch("stable promotion identity"))
        );
        assert_eq!(journal.journal().phase(), UpdatePhase::Installed);
    }

    #[test]
    fn sqlite_sidecars_cannot_be_used_as_a_recovery_journal() {
        let dir = TempDir::new("delivery-recovery-sidecars");
        let database = dir.path().join("projecta.db");
        for forbidden in [
            database.clone(),
            dir.path().join("projecta.db-wal"),
            dir.path().join("projecta.db-shm"),
        ] {
            assert!(matches!(
                JournalStore::new(forbidden, &database),
                Err(RecoveryError::InvalidJournalLocation(_))
            ));
        }
    }

    #[test]
    fn stale_or_concurrent_writers_cannot_replace_a_newer_journal() {
        let dir = TempDir::new("delivery-recovery-stale-writer");
        let store = store(&dir);
        let mut current =
            DurableJournal::create(store.clone(), UpdateJournal::new(offer()).expect("offer"))
                .expect("create");
        let mut stale = DurableJournal::open(store.clone()).expect("stale reader");
        let manifest = offer().staged_manifest;
        current.record_downloaded(&manifest).expect("current write");
        assert_eq!(
            stale.record_downloaded(&manifest),
            Err(RecoveryError::StaleWriter {
                expected: 0,
                actual: 1,
            })
        );
        let lock = store.path().with_file_name("update-recovery.json.lock");
        let lock_file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock)
            .expect("simulate active writer");
        lock_file.try_lock().expect("lock simulated writer");
        assert!(matches!(
            current.wait_for_idle(),
            Err(RecoveryError::ConcurrentWriter(_))
        ));
        drop(lock_file);
        current
            .wait_for_idle()
            .expect("reopen after writer drops lock");
        assert_eq!(current.journal().phase(), UpdatePhase::WaitingIdle);
    }
}
