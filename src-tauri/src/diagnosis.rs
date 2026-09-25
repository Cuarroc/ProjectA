//! Diagnosis pack (P2-H): a structural field allowlist, then redaction.
//!
//! The pack is a typed document. Forbidden fields — agent free text, repo
//! paths, setting *values*, provider keys — are not on the struct, so they
//! cannot leak by being "filtered out" of a dump. Product-managed secrets that
//! somehow land in an allowed field are stripped by exact match (and derived
//! encodings) before [`crate::redact`] runs as the seatbelt.

use std::path::Path;

use base64::Engine;
use serde::Serialize;

use crate::providers::{KeyVault, OMNIROUTE_MANAGEMENT, PROVIDERS};
use crate::redact;
use crate::status::{Grade, ReasonCode, Signal, StatusEngine};
use crate::store::Store;

/// Last N lines of the current log file. Older rotations stay out.
pub const LOG_TAIL_LINES: usize = 200;

/// Post-open schema version this pack reports.
///
/// [`crate::store::Store::user_version`] is crate-private and this package
/// cannot widen `store.rs`. After `Store::open` the live database is always
/// at the migration target; a source scan in the tests pins this number to
/// the highest `MIGRATIONS` step.
pub const SCHEMA_USER_VERSION: i64 = 22;

/// Panic markers collected at startup, before rotation, so both generations
/// reach the window.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanicNotice {
    pub current: Option<String>,
    pub previous: Option<String>,
}

/// One reason-code explained for the Warum-view.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReasonExplanation {
    pub code: &'static str,
    pub grade: Grade,
    pub line: String,
}

macro_rules! reason_catalog {
    ($($variant:ident),+ $(,)?) => {
        /// Closed catalog: every [`ReasonCode`] has a line. A new variant
        /// fails to compile here rather than shipping as an unexplained code.
        pub fn reason_catalog() -> Vec<ReasonExplanation> {
            [$(ReasonCode::$variant),+]
                .into_iter()
                .map(explain_reason)
                .collect()
        }

        fn explain_reason(code: ReasonCode) -> ReasonExplanation {
            match code {
                $(ReasonCode::$variant => ReasonExplanation {
                    code: code.code(),
                    grade: code.grade(),
                    line: Signal::new(code).line(),
                },)+
            }
        }
    };
}

reason_catalog!(
    ApprovalRequired,
    QuotaBlocked,
    DeliveryFailed,
    AgentExited,
    AgentStalled,
    DecisionPending,
    AgentReported,
    IdleAtPrompt,
    ChangesRequested,
    ReviewPending,
    ReviewApproved,
    ApprovedButDraft,
    ChecksPending,
    ReviewDraft,
    PullRequestMerged,
);

/// The diagnosis document. Field names *are* the allowlist.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosisPack {
    pub app_version: String,
    pub build: String,
    pub os_version: String,
    pub schema_user_version: i64,
    pub log_excerpt: String,
    pub panic_current: Option<String>,
    pub panic_previous: Option<String>,
    pub projects: Vec<ProjectDiag>,
    pub workers: Vec<WorkerDiag>,
    pub settings: Vec<SettingDiag>,
    pub providers: Vec<ProviderDiag>,
    pub counts: CountsDiag,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDiag {
    pub id: String,
    pub name: String,
    pub max_workers: i64,
    pub test_command_set: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkerDiag {
    pub id: String,
    pub kind: String,
    pub status: String,
    pub column: String,
    pub reason_code: Option<String>,
    pub test_status: Option<String>,
    pub branch: String,
}

/// Key name and whether a value is stored. Never the value.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingDiag {
    pub key: String,
    pub set: bool,
}

/// Provider id and whether the vault holds a key. Never the key.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDiag {
    pub id: String,
    pub key_stored: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CountsDiag {
    pub workers: usize,
    pub questions: usize,
    pub recommendations: usize,
}

/// Collect the pack from live sources. Known product secrets are returned
/// beside it so [`export_json`] can strip them; they never become fields.
pub async fn collect(
    app_data: &Path,
    store: &Store,
    engine: &StatusEngine,
    vault: &KeyVault,
    panic: &PanicNotice,
) -> Result<(DiagnosisPack, Vec<String>), String> {
    let projects = store.list_projects().await?;
    let workers = store.list_workers(None).await?;
    let questions = store.list_questions(None, None).await?;
    let recommendations = store.list_recommendations(None).await?;
    let settings = store.list_settings("").await?;
    let cards = engine.board(&workers);

    let pack = DiagnosisPack {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        build: if cfg!(debug_assertions) {
            "debug".to_string()
        } else {
            "release".to_string()
        },
        os_version: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        schema_user_version: SCHEMA_USER_VERSION,
        log_excerpt: crate::logging::tail_log(app_data, LOG_TAIL_LINES),
        panic_current: panic.current.clone(),
        panic_previous: panic.previous.clone(),
        projects: projects
            .iter()
            .map(|project| ProjectDiag {
                id: project.id.clone(),
                name: project.name.clone(),
                max_workers: project.max_workers.unwrap_or(0),
                test_command_set: project
                    .test_command
                    .as_deref()
                    .is_some_and(|command| !command.trim().is_empty()),
            })
            .collect(),
        workers: cards
            .iter()
            .map(|card| WorkerDiag {
                id: card.worker.id.clone(),
                kind: card.worker.kind.clone(),
                status: card.worker.status.clone(),
                column: card.column.clone(),
                reason_code: reason_code_from_reason(card.attention_reason.as_deref()),
                test_status: card.worker.test_status.clone(),
                branch: card.worker.branch.clone(),
            })
            .collect(),
        settings: settings
            .into_iter()
            .map(|(key, value)| SettingDiag {
                key,
                set: !value.trim().is_empty(),
            })
            .collect(),
        providers: {
            let stored = vault.stored_ids();
            PROVIDERS
                .iter()
                .map(|spec| ProviderDiag {
                    id: spec.id.to_string(),
                    key_stored: stored.iter().any(|id| id == spec.id),
                })
                .collect()
        },
        counts: CountsDiag {
            workers: workers.len(),
            questions: questions.len(),
            recommendations: recommendations.len(),
        },
    };

    Ok((pack, product_secrets(app_data, store, vault).await))
}

async fn product_secrets(app_data: &Path, store: &Store, vault: &KeyVault) -> Vec<String> {
    let mut secrets = Vec::new();
    if let Ok(raw) = std::fs::read_to_string(app_data.join(crate::api::DESCRIPTOR_FILE)) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(token) = value.get("token").and_then(|token| token.as_str()) {
                if !token.is_empty() {
                    secrets.push(token.to_string());
                }
            }
        }
    }
    if let Ok(Some(token)) = store.get_setting("web_interface.token").await {
        if !token.trim().is_empty() {
            secrets.push(token);
        }
    }
    if let Some(token) = vault.get(OMNIROUTE_MANAGEMENT) {
        if !token.trim().is_empty() {
            secrets.push(token);
        }
    }
    secrets
}

fn reason_code_from_reason(reason: Option<&str>) -> Option<String> {
    let reason = reason?;
    reason_catalog()
        .into_iter()
        .find(|entry| entry.line == reason)
        .map(|entry| entry.code.to_string())
}

/// Serialize, strip product-managed secrets (exact + derived), then redact.
pub fn export_json(pack: &DiagnosisPack, known_secrets: &[String]) -> String {
    let raw = serde_json::to_string_pretty(pack).unwrap_or_else(|_| "{}".to_string());
    let stripped = strip_known_secrets(&raw, known_secrets);
    redact::redact(&stripped)
}

fn encodings(secret: &str) -> Vec<String> {
    if secret.is_empty() {
        return Vec::new();
    }
    let mut out = vec![secret.to_string()];
    if secret.len() >= 12 {
        out.push(secret[..12].to_string());
    }
    out.push(base64::engine::general_purpose::STANDARD.encode(secret.as_bytes()));
    out.push(
        secret
            .as_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    );
    out
}

fn strip_known_secrets(text: &str, secrets: &[String]) -> String {
    let mut out = text.to_string();
    for secret in secrets {
        for needle in encodings(secret) {
            if needle.len() < 8 {
                continue;
            }
            out = out.replace(&needle, redact::MASK);
        }
    }
    out
}

#[cfg(test)]
#[derive(Clone, Copy)]
enum Slot {
    AppVersion,
    Build,
    OsVersion,
    LogExcerpt,
    PanicCurrent,
    PanicPrevious,
    ProjectId,
    ProjectName,
    WorkerId,
    WorkerKind,
    WorkerStatus,
    WorkerColumn,
    WorkerReasonCode,
    WorkerTestStatus,
    WorkerBranch,
    SettingKey,
    ProviderId,
}

#[cfg(test)]
impl Slot {
    const ALL: &'static [Slot] = &[
        Slot::AppVersion,
        Slot::Build,
        Slot::OsVersion,
        Slot::LogExcerpt,
        Slot::PanicCurrent,
        Slot::PanicPrevious,
        Slot::ProjectId,
        Slot::ProjectName,
        Slot::WorkerId,
        Slot::WorkerKind,
        Slot::WorkerStatus,
        Slot::WorkerColumn,
        Slot::WorkerReasonCode,
        Slot::WorkerTestStatus,
        Slot::WorkerBranch,
        Slot::SettingKey,
        Slot::ProviderId,
    ];

    fn name(self) -> &'static str {
        match self {
            Slot::AppVersion => "appVersion",
            Slot::Build => "build",
            Slot::OsVersion => "osVersion",
            Slot::LogExcerpt => "logExcerpt",
            Slot::PanicCurrent => "panicCurrent",
            Slot::PanicPrevious => "panicPrevious",
            Slot::ProjectId => "projects[].id",
            Slot::ProjectName => "projects[].name",
            Slot::WorkerId => "workers[].id",
            Slot::WorkerKind => "workers[].kind",
            Slot::WorkerStatus => "workers[].status",
            Slot::WorkerColumn => "workers[].column",
            Slot::WorkerReasonCode => "workers[].reasonCode",
            Slot::WorkerTestStatus => "workers[].testStatus",
            Slot::WorkerBranch => "workers[].branch",
            Slot::SettingKey => "settings[].key",
            Slot::ProviderId => "providers[].id",
        }
    }

    fn plant(self, pack: &mut DiagnosisPack, value: &str) {
        match self {
            Slot::AppVersion => pack.app_version = value.to_string(),
            Slot::Build => pack.build = value.to_string(),
            Slot::OsVersion => pack.os_version = value.to_string(),
            Slot::LogExcerpt => pack.log_excerpt = value.to_string(),
            Slot::PanicCurrent => pack.panic_current = Some(value.to_string()),
            Slot::PanicPrevious => pack.panic_previous = Some(value.to_string()),
            Slot::ProjectId => sample_project(pack).id = value.to_string(),
            Slot::ProjectName => sample_project(pack).name = value.to_string(),
            Slot::WorkerId => sample_worker(pack).id = value.to_string(),
            Slot::WorkerKind => sample_worker(pack).kind = value.to_string(),
            Slot::WorkerStatus => sample_worker(pack).status = value.to_string(),
            Slot::WorkerColumn => sample_worker(pack).column = value.to_string(),
            Slot::WorkerReasonCode => sample_worker(pack).reason_code = Some(value.to_string()),
            Slot::WorkerTestStatus => sample_worker(pack).test_status = Some(value.to_string()),
            Slot::WorkerBranch => sample_worker(pack).branch = value.to_string(),
            Slot::SettingKey => sample_setting(pack).key = value.to_string(),
            Slot::ProviderId => sample_provider(pack).id = value.to_string(),
        }
    }
}

#[cfg(test)]
fn sample_project(pack: &mut DiagnosisPack) -> &mut ProjectDiag {
    if pack.projects.is_empty() {
        pack.projects.push(ProjectDiag::default());
    }
    &mut pack.projects[0]
}

#[cfg(test)]
fn sample_worker(pack: &mut DiagnosisPack) -> &mut WorkerDiag {
    if pack.workers.is_empty() {
        pack.workers.push(WorkerDiag::default());
    }
    &mut pack.workers[0]
}

#[cfg(test)]
fn sample_setting(pack: &mut DiagnosisPack) -> &mut SettingDiag {
    if pack.settings.is_empty() {
        pack.settings.push(SettingDiag::default());
    }
    &mut pack.settings[0]
}

#[cfg(test)]
fn sample_provider(pack: &mut DiagnosisPack) -> &mut ProviderDiag {
    if pack.providers.is_empty() {
        pack.providers.push(ProviderDiag::default());
    }
    &mut pack.providers[0]
}

#[cfg(test)]
struct SecretKind {
    name: &'static str,
    value: &'static str,
}

/// One planted value per product-managed secret type in the spec.
#[cfg(test)]
const SECRET_KINDS: &[SecretKind] = &[
    SecretKind {
        name: "api_token",
        value: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    },
    SecretKind {
        name: "verdict_token",
        value: "f0e1d2c3b4a5968778695a4b3c2d1e0f",
    },
    SecretKind {
        name: "hook_secret",
        value: "deadbeefcafebabe0123456789abcdef",
    },
    SecretKind {
        name: "web_interface_token",
        value: "wi_token_CANARY_webinterface_zz99",
    },
    SecretKind {
        name: "provider_key",
        value: "sk-ant-CANARYPROVIDERKEY99xxxx",
    },
    SecretKind {
        name: "omniroute_management",
        value: "oma_live_CANARY_management_tok",
    },
];

#[cfg(test)]
fn assert_secret_absent(export: &str, secret: &str, label: &str) {
    assert!(
        !export.contains(secret),
        "{label}: exact secret leaked:\n{export}"
    );
    if secret.len() >= 12 {
        assert!(
            !export.contains(&secret[..12]),
            "{label}: 12-char prefix leaked:\n{export}"
        );
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(secret.as_bytes());
    assert!(!export.contains(&b64), "{label}: base64 leaked:\n{export}");
    let hex: String = secret
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    assert!(!export.contains(&hex), "{label}: hex leaked:\n{export}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_reason_code_has_a_warum_line() {
        let catalog = reason_catalog();
        assert_eq!(catalog.len(), 15, "{catalog:?}");
        for entry in &catalog {
            assert!(!entry.code.is_empty(), "{}", entry.code);
            assert!(!entry.line.is_empty(), "{}", entry.code);
        }
        let codes: Vec<&str> = catalog.iter().map(|entry| entry.code).collect();
        assert!(codes.contains(&"quota_blocked"));
        assert_eq!(
            codes
                .iter()
                .filter(|code| **code == "quota_blocked")
                .count(),
            1
        );
    }

    #[test]
    fn reported_schema_version_matches_store_migrations() {
        let src = include_str!("store.rs");
        let start = src
            .find("const MIGRATIONS:")
            .expect("MIGRATIONS table in store.rs");
        let rest = &src[start..];
        let end = rest.find("];").expect("MIGRATIONS terminator");
        let block = &rest[..end];
        let mut highest = 1_i64;
        for chunk in block.split('(').skip(1) {
            let digits: String = chunk
                .trim_start()
                .chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect();
            if let Ok(version) = digits.parse::<i64>() {
                highest = highest.max(version);
            }
        }
        assert_eq!(
            SCHEMA_USER_VERSION, highest,
            "diagnosis schema_user_version drifted from store.rs MIGRATIONS"
        );
    }

    #[test]
    fn the_pack_struct_has_no_forbidden_keys() {
        let json = serde_json::to_string(&DiagnosisPack {
            projects: vec![ProjectDiag {
                id: "pj-1".into(),
                name: "Alpha".into(),
                max_workers: 4,
                test_command_set: true,
            }],
            workers: vec![WorkerDiag {
                id: "wk-1".into(),
                kind: "worker".into(),
                status: "running".into(),
                column: "working".into(),
                reason_code: Some("idle_at_prompt".into()),
                test_status: Some("pass".into()),
                branch: "pa/wk-1".into(),
            }],
            settings: vec![SettingDiag {
                key: "web_interface.token".into(),
                set: true,
            }],
            providers: vec![ProviderDiag {
                id: "claude".into(),
                key_stored: true,
            }],
            counts: CountsDiag {
                workers: 1,
                questions: 0,
                recommendations: 0,
            },
            ..DiagnosisPack::default()
        })
        .unwrap();
        for forbidden in [
            "task",
            "repoPath",
            "repo_path",
            "landingPageMarkdown",
            "landing_page_markdown",
            "worktreePath",
            "pausedReason",
            "\"value\"",
            "scrollback",
            "session-buffers",
        ] {
            assert!(
                !json.contains(forbidden),
                "allowlist leaked forbidden key {forbidden}: {json}"
            );
        }
        assert!(json.contains("testCommandSet"));
        assert!(json.contains("keyStored"));
        assert!(
            !json.contains("npm test"),
            "test command value must not appear"
        );
    }

    #[test]
    fn canary_every_secret_type_in_every_allowed_string_field() {
        let mut failures = Vec::new();
        for kind in SECRET_KINDS {
            for slot in Slot::ALL {
                let mut pack = DiagnosisPack::default();
                slot.plant(&mut pack, kind.value);
                let export = export_json(&pack, &[kind.value.to_string()]);
                let label = format!("{} × {}", kind.name, slot.name());
                if export.contains(kind.value)
                    || (kind.value.len() >= 12 && export.contains(&kind.value[..12]))
                {
                    failures.push(label);
                } else {
                    assert_secret_absent(&export, kind.value, &label);
                }
            }
        }
        assert!(
            failures.is_empty(),
            "canary leaks (secret × field):\n{}",
            failures.join("\n")
        );
    }

    #[test]
    fn a_provider_shaped_key_is_redacted_even_without_the_strip_list() {
        let mut pack = DiagnosisPack::default();
        Slot::ProjectName.plant(&mut pack, "sk-ant-CANARYPROVIDERKEY99xxxx");
        let export = export_json(&pack, &[]);
        assert_secret_absent(
            &export,
            "sk-ant-CANARYPROVIDERKEY99xxxx",
            "heuristic seatbelt",
        );
        assert!(export.contains(redact::MASK));
    }

    #[test]
    fn numeric_counts_cannot_hold_a_token() {
        let pack = DiagnosisPack {
            counts: CountsDiag {
                workers: 3,
                questions: 1,
                recommendations: 1,
            },
            ..DiagnosisPack::default()
        };
        let json = export_json(&pack, &[]);
        assert!(json.contains("\"workers\": 3"));
        assert!(!json.contains("sk-"));
    }
}
