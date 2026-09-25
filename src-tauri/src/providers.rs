//! Providers: what this machine can actually reach, and the keys that let it.
//!
//! A profile in [`crate::profiles`] is a command line; a *provider* is the
//! account behind it. The board already knows when a provider says no
//! ([`crate::quota`]); this module answers the question that comes before it -
//! is the thing installed, is it signed in, and do we hold a key for it.
//!
//! Three parts:
//!
//! 1. **A registry.** Static, because these are the providers ProjectA knows
//!    how to look for, and each carries the instructions for finding it: a CLI
//!    to run, a loopback endpoint to call, or a key to look up.
//! 2. **A vault.** API keys live in `<app data dir>/provider-keys.json`, next
//!    to the database and the API descriptor. Never in the repository: the file
//!    is as private as the user's profile directory, which is the same trust
//!    boundary the control API's token already sits on. On Windows the file is
//!    DPAPI-encrypted for the current user account (`DPAPI1:` + base64 blob;
//!    legacy plaintext files are migrated on the next write); on unix it stays
//!    plaintext, created with mode 0600 rather than chmodded after the fact.
//!    Writes are atomic (temp file + rename), and a vault that cannot be read
//!    is a named error on the overview - never a silent empty one.
//! 3. **An overview.** One row per provider, joining the probe against the
//!    quota tracker, which is what both `get_provider_overview` and
//!    `GET /api/providers` serve.
//!
//! Everything here fails soft. A CLI that is not installed, a router that is
//! not running, a key that was never stored: all of them are ordinary answers,
//! never errors. The one exception is a vault that exists but cannot be read:
//! silently treating it as empty would be indistinguishable from "no keys
//! stored", so it is reported instead. The only other operations that can fail
//! are the ones that write.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// The vault's DPAPI blob is base64 on disk; `Engine` provides encode/decode.
use base64::Engine as _;

use crate::omniroute::{self, OmniRoute};
use crate::quota::QuotaTracker;
use crate::status::StatusEngine;
use crate::store::{now_unix_secs, Store, QUOTA_UNKNOWN};

/// The provider is paid for as a plan; there is no key to hold.
pub const KIND_SUBSCRIPTION: &str = "subscription";
/// The provider is billed per call against a key we store.
pub const KIND_API_KEY: &str = "api_key";
/// The provider runs on this machine.
pub const KIND_LOCAL: &str = "local";

/// Name of the vault file inside the app data directory.
pub const VAULT_FILE: &str = "provider-keys.json";

/// First bytes of an encrypted vault: `DPAPI1:` + base64 of the DPAPI blob.
/// Anything else is the legacy plaintext format (and, on unix, still the
/// native one). The marker is recognised on every platform, so a Windows
/// vault opened elsewhere fails with a named error instead of parsing as
/// garbage - or, worse, decrypting nothing and reading as empty.
const VAULT_DPAPI_MARKER: &str = "DPAPI1:";

/// Written into the vault so that whoever opens the file knows what it is.
const VAULT_NOTE: &str = "ProjectA provider API keys. Private to this user account - \
never copy this file into a repository.";

/// A provider CLI that cannot say its own version in this long is not one the
/// overview should keep the window waiting for.
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// How often a spawned probe is checked for having finished.
const POLL_INTERVAL: Duration = Duration::from_millis(25);

/// Ollama's local server.
const OLLAMA_PORT: u16 = 11434;

/// Vault key for OmniRoute's management API token - the one that opens
/// `/api/usage/logs`. Held apart from the `omniroute` row on purpose: that one
/// is the router as an inference endpoint, which needs no credential of ours.
///
/// The token is typed into the app like any other key. It is deliberately
/// *not* read from the environment: a credential that only exists in a shell
/// profile is invisible to the window that has to explain why the ledger is
/// empty. Without it [`crate::omniroute::OmniRoute::login`] degrades and the
/// ledger simply stays where it is.
pub const OMNIROUTE_MANAGEMENT: &str = "omniroute-management";

/// Refuse an OmniRoute reply larger than this, matching [`crate::omniroute`].
const MAX_RESPONSE: usize = 64 * 1024;

/// OmniRoute endpoints tried when pushing keys, in order. None of these is
/// promised by any particular build, which is why there are three of them and
/// why failing all three is not an error.
const OMNIROUTE_CONFIG_PATHS: [&str; 3] = [
    "/api/v1/providers",
    "/api/providers",
    "/api/v1/config/providers",
];

/// How a provider is looked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Probe {
    /// Run a CLI and ask it what it is.
    Cli(CliProbe),
    /// `GET` a loopback endpoint.
    Http { port: u16, path: &'static str },
    /// Look in the vault. Nothing is run and nothing is called: for a provider
    /// reached over someone else's API, holding the key *is* being connected.
    StoredKey,
}

/// A CLI provider: a binary, and the evidence that it is signed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CliProbe {
    /// Resolved against `PATH` the way a shell would.
    pub binary: &'static str,
    /// Subcommand that reports the login state, when the CLI has one. Empty
    /// when it does not, and then presence of the binary is the whole answer.
    pub auth_args: &'static [&'static str],
    /// Home-relative files whose existence means "signed in". Any one of them
    /// is enough.
    pub auth_files: &'static [&'static str],
}

/// One provider ProjectA knows how to look for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProviderSpec {
    /// Matches the profile id in [`crate::profiles`] wherever there is one, so
    /// that the quota tracker's rows line up without a translation table.
    pub id: &'static str,
    pub name: &'static str,
    /// [`KIND_SUBSCRIPTION`], [`KIND_API_KEY`] or [`KIND_LOCAL`].
    pub kind: &'static str,
    pub probe: Probe,
}

/// Every provider, in the order the overview lists them.
pub const PROVIDERS: &[ProviderSpec] = &[
    ProviderSpec {
        id: "claude",
        name: "Claude Code",
        kind: KIND_SUBSCRIPTION,
        probe: Probe::Cli(CliProbe {
            binary: "claude",
            // Recent builds answer this; older ones exit non-zero, which is
            // read as "installed, login state unknown" rather than as absent.
            auth_args: &["auth", "status"],
            auth_files: &[".claude/.credentials.json"],
        }),
    },
    ProviderSpec {
        id: "codex",
        name: "Codex CLI",
        kind: KIND_SUBSCRIPTION,
        probe: Probe::Cli(CliProbe {
            binary: "codex",
            auth_args: &[],
            auth_files: &[".codex/auth.json"],
        }),
    },
    ProviderSpec {
        id: "opencode",
        name: "OpenCode",
        kind: KIND_SUBSCRIPTION,
        probe: Probe::Cli(CliProbe {
            binary: "opencode",
            auth_args: &[],
            auth_files: &[
                ".local/share/opencode/auth.json",
                ".config/opencode/opencode.json",
                ".config/opencode/config.json",
                ".opencode.json",
            ],
        }),
    },
    ProviderSpec {
        id: "kimi",
        name: "Kimi CLI",
        kind: KIND_SUBSCRIPTION,
        probe: Probe::Cli(CliProbe {
            binary: "kimi",
            auth_args: &[],
            auth_files: &[".kimi/auth.json"],
        }),
    },
    ProviderSpec {
        id: "ollama",
        name: "Ollama",
        kind: KIND_LOCAL,
        probe: Probe::Http {
            port: OLLAMA_PORT,
            path: "/api/version",
        },
    },
    ProviderSpec {
        id: "omniroute",
        name: "OmniRoute",
        kind: KIND_LOCAL,
        probe: Probe::Http {
            port: omniroute::DEFAULT_PORT,
            path: "/health",
        },
    },
    ProviderSpec {
        id: OMNIROUTE_MANAGEMENT,
        name: "OmniRoute (Management)",
        kind: KIND_API_KEY,
        // Not a second router: the same OmniRoute, entered through its
        // login-gated management API instead of its inference port. It is its
        // own registry row because it is its own credential - the vault keys
        // off the provider id, and this token buys `/api/usage/*`, which the
        // inference side does not need and must not carry.
        probe: Probe::StoredKey,
    },
    ProviderSpec {
        id: "openrouter",
        name: "OpenRouter",
        kind: KIND_API_KEY,
        probe: Probe::StoredKey,
    },
];

/// The registry entry with this id.
pub fn find(provider_id: &str) -> Option<&'static ProviderSpec> {
    PROVIDERS.iter().find(|spec| spec.id == provider_id)
}

/// One provider's row in `get_provider_overview`.
///
/// Serialized as `{ "id", "name", "kind", "connected", "detail", "quotaState",
/// "blockedUntil", "omniRouteOnline", "usage", "vaultError" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderOverview {
    pub id: String,
    pub name: String,
    /// [`KIND_SUBSCRIPTION`], [`KIND_API_KEY`] or [`KIND_LOCAL`].
    pub kind: String,
    /// Did the probe find it - installed, answering, or keyed.
    pub connected: bool,
    /// Whatever the probe learned worth showing: a version, a login hint.
    pub detail: Option<String>,
    /// `ok`, `blocked` or `unknown`, from the quota tracker. A provider with no
    /// profile of its own stays `unknown` forever, which is honest: nothing has
    /// ever been observed about it.
    pub quota_state: String,
    pub blocked_until: Option<i64>,
    /// Repeated on every row, exactly like [`crate::quota::QuotaStateRow`]:
    /// one fact about the machine, read one row at a time.
    pub omni_route_online: bool,
    /// Usage snapshot, if any source reported one. `None` means unknown, never
    /// a fabricated zero.
    pub usage: Option<ProviderUsage>,
    /// The vault's read error, repeated on every row like
    /// [`Self::omni_route_online`]: one fact about the machine. `None` when the
    /// vault read cleanly; a `vault_*`-prefixed message otherwise, so the UI
    /// can say "the key store is broken" instead of showing a panel that looks
    /// exactly like "no keys stored".
    pub vault_error: Option<String>,
}

/// A usage snapshot for one provider.
///
/// Serialized as `{ "percent", "used", "limit", "windowLabel", "resetsAt",
/// "source", "observedAt" }`. Numbers are never invented: any missing fact is
/// `null`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
    pub percent: Option<u8>,
    pub used: Option<String>,
    pub limit: Option<String>,
    pub window_label: String,
    pub resets_at: Option<i64>,
    /// "hook", "api", "local" or "heuristic".
    pub source: String,
    pub observed_at: i64,
}

/// What a probe found.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProbeOutcome {
    pub connected: bool,
    pub detail: Option<String>,
}

impl ProbeOutcome {
    /// Nothing found: not installed, not answering, no key.
    pub fn missing() -> Self {
        Self::default()
    }

    pub fn found(detail: impl Into<String>) -> Self {
        let detail = detail.into();
        let detail = detail.trim();
        Self {
            connected: true,
            detail: (!detail.is_empty()).then(|| detail.to_string()),
        }
    }
}

/// Where the overview's facts about a single provider come from.
///
/// Behind this trait are child processes and sockets, neither of which belongs
/// in a unit test. The join is the part worth testing, so the tests hand
/// [`overview`] a table of canned answers instead.
pub trait ProviderProbe: Send + Sync {
    /// `has_key` is whether the vault holds a key for this provider, which is
    /// the whole answer for [`Probe::StoredKey`].
    fn probe(&self, spec: &ProviderSpec, has_key: bool) -> ProbeOutcome;
}

/// The real one: runs the CLIs and calls the endpoints.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemProbe;

impl ProviderProbe for SystemProbe {
    fn probe(&self, spec: &ProviderSpec, has_key: bool) -> ProbeOutcome {
        match spec.probe {
            Probe::Cli(cli) => probe_cli(&cli),
            Probe::Http { port, path } => probe_http(port, path),
            Probe::StoredKey => {
                if has_key {
                    ProbeOutcome::found("key stored")
                } else {
                    ProbeOutcome::missing()
                }
            }
        }
    }
}

/// Is the binary there, and does anything say it is signed in?
///
/// A CLI that runs but exits non-zero is still installed, so only a spawn that
/// produced nothing at all counts as missing.
fn probe_cli(cli: &CliProbe) -> ProbeOutcome {
    let Some((ok, printed)) = run_capture(cli.binary, &["--version"]) else {
        return ProbeOutcome::missing();
    };
    if !ok && printed.is_empty() {
        return ProbeOutcome::missing();
    }

    let version = first_line(&printed);
    let mut detail = if version.is_empty() {
        "installed".to_string()
    } else {
        version
    };
    if signed_in(cli) {
        detail.push_str(" \u{b7} signed in");
    }
    ProbeOutcome::found(detail)
}

/// Two kinds of evidence, either of which is enough: an `auth status` that
/// exits zero, or one of the files a successful login leaves behind.
fn signed_in(cli: &CliProbe) -> bool {
    if !cli.auth_args.is_empty() && run_capture(cli.binary, cli.auth_args).is_some_and(|(ok, _)| ok)
    {
        return true;
    }
    let Some(home) = home_dir() else {
        return false;
    };
    cli.auth_files
        .iter()
        .any(|relative| home.join(relative).exists())
}

fn probe_http(port: u16, path: &str) -> ProbeOutcome {
    let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
    let Some((status, body)) = omniroute::get(addr, path) else {
        return ProbeOutcome::missing();
    };
    if !(200..300).contains(&status) {
        return ProbeOutcome::missing();
    }
    match version_of(&body) {
        Some(version) => ProbeOutcome::found(version),
        None => ProbeOutcome::found("online"),
    }
}

/// Pull a version out of a health payload without insisting on its shape.
fn version_of(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body.trim()).ok()?;
    ["version", "app_version", "build"]
        .into_iter()
        .find_map(|key| value.get(key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .map(str::to_string)
}

fn first_line(text: &str) -> String {
    text.lines().next().unwrap_or_default().trim().to_string()
}

/// The user's home directory, without a dependency.
fn home_dir() -> Option<PathBuf> {
    // Windows leads with `USERPROFILE`: an MSYS `HOME` (say `/c/Users/me`) is
    // a spelling the rest of Windows cannot read, and auth files looked up
    // below it would land nowhere. Everywhere else `HOME` is the spelling
    // that counts, with `USERPROFILE` only as a fallback.
    if cfg!(windows) {
        if let Some(profile) = std::env::var_os("USERPROFILE").filter(|p| !p.is_empty()) {
            return Some(PathBuf::from(profile));
        }
    }
    if let Some(home) = std::env::var_os("HOME").filter(|home| !home.is_empty()) {
        return Some(PathBuf::from(home));
    }
    if let Some(profile) = std::env::var_os("USERPROFILE").filter(|p| !p.is_empty()) {
        return Some(PathBuf::from(profile));
    }
    let drive = std::env::var_os("HOMEDRIVE")?;
    let path = std::env::var_os("HOMEPATH")?;
    let mut home = drive;
    home.push(path);
    Some(PathBuf::from(home))
}

/// Run a probe command and return `(exited zero, what it printed)`.
///
/// `None` means it could not be run at all - which for a probe is the answer
/// that matters, because it is the difference between "not installed" and
/// "installed and unhappy".
///
/// The wait is bounded. Unlike the `gh` calls in [`crate::gh`] this runs on the
/// thread serving a Tauri command, so a CLI that sits waiting for a terminal
/// would otherwise take the window with it.
fn run_capture(program: &str, args: &[&str]) -> Option<(bool, String)> {
    run_capture_with_stdin(program, args, None)
}

/// [`run_capture`] with `input` written to the child's stdin, for secrets that
/// must not ride in the command line: `argv` is world-readable on the machine
/// (`/proc/<pid>/cmdline`, `ps aux`), the child's standard input is not.
fn run_capture_with_stdin(
    program: &str,
    args: &[&str],
    input: Option<&str>,
) -> Option<(bool, String)> {
    let (exe, prefix) = program_invocation(program);
    let mut child = crate::proc::command(exe)
        .args(prefix)
        .args(args)
        // No terminal on the other end: a prompt would hang until the timeout.
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;

    if let (Some(mut stdin), Some(input)) = (child.stdin.take(), input) {
        use std::io::Write;
        // Short enough to fit the pipe buffer, so this cannot block behind a
        // child that never reads; dropping the handle closes the pipe, which
        // is what tells the child the input is over. A failed write means the
        // child is already gone, and the wait below reports that.
        let _ = stdin.write_all(input.as_bytes());
    }

    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {}
            Err(_) => return None,
        }
        if started.elapsed() >= PROBE_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(POLL_INTERVAL);
    }

    let output = child.wait_with_output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let printed = if stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr).trim().to_string()
    } else {
        stdout
    };
    Some((output.status.success(), printed))
}

/// Split `program` into the executable to run and any arguments in front of
/// ours.
///
/// On Windows these CLIs are usually npm shims, which `CreateProcess` cannot
/// execute directly, so the question goes to the one module that answers it:
/// [`crate::pty::windows_invocation`] reads the shim and hands back the
/// interpreter it would have started, falling back to `%COMSPEC% /C` only for
/// a shim it cannot read. PR titles and bodies travel on this command line,
/// which is why the answer must not be a second, hand-built `cmd.exe` call.
#[cfg(windows)]
pub(crate) fn program_invocation(program: &str) -> (OsString, Vec<OsString>) {
    let Some(path) = crate::pty::resolve_windows_program(program) else {
        return (OsString::from(program), Vec::new());
    };
    let (exe, prefix) = crate::pty::windows_invocation(&path);
    (exe.into_os_string(), prefix)
}

#[cfg(not(windows))]
pub(crate) fn program_invocation(program: &str) -> (OsString, Vec<OsString>) {
    (OsString::from(program), Vec::new())
}

// -- the vault -------------------------------------------------------------

/// What `provider-keys.json` holds.
#[derive(Default, Serialize, Deserialize)]
struct VaultFile {
    /// Explains the file to whoever opens it. Rewritten on every save.
    #[serde(default)]
    note: String,
    #[serde(default)]
    keys: BTreeMap<String, String>,
}

/// Keys must never reach a log. The derived `Debug` would print every stored
/// key next to its provider id, so this one prints the ids only: they are
/// registry entries, not secrets.
impl std::fmt::Debug for VaultFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VaultFile")
            .field("note", &self.note)
            .field("keys", &self.keys.keys().collect::<Vec<_>>())
            .finish()
    }
}

/// Why the vault on disk could not be read.
///
/// The `Display` form starts with a stable machine-matchable code -
/// `vault_unreadable`, `vault_corrupt` or `vault_decrypt_failed` - so the
/// frontend can tell a broken vault apart from "no keys stored". The detail
/// after the code is for humans and carries no key material: `serde_json`
/// errors name line and column, IO and DPAPI errors are OS codes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultReadError {
    /// The file exists but the OS will not hand it over (permissions, a
    /// vanishing disk). A *missing* file is not an error - it is an empty
    /// vault.
    Unreadable(String),
    /// The bytes are neither valid legacy JSON nor a readable encrypted blob.
    /// The next `set`/`delete` archives the file and starts over: whatever
    /// was in it was unreadable anyway, and the archive keeps the evidence.
    Corrupt(String),
    /// An encrypted vault this user cannot open: DPAPI-scoped to another
    /// Windows account or machine (or a damaged blob), or opened on a
    /// platform without DPAPI. Those keys may be perfectly readable to the
    /// account that made them, so nothing here is ever overwritten - moving
    /// the file away by hand is the documented way to start over.
    DecryptFailed(String),
}

impl VaultReadError {
    /// The stable prefix of the `Display` form, for matching without parsing.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Unreadable(_) => "vault_unreadable",
            Self::Corrupt(_) => "vault_corrupt",
            Self::DecryptFailed(_) => "vault_decrypt_failed",
        }
    }
}

impl std::fmt::Display for VaultReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let detail = match self {
            Self::Unreadable(detail) | Self::Corrupt(detail) | Self::DecryptFailed(detail) => {
                detail
            }
        };
        write!(f, "{}: {detail}", self.code())
    }
}

/// API keys on disk: one file, read and written whole.
///
/// The file is tiny and changes when a human types a key into a dialog, so
/// there is nothing to gain from caching it: every call reads what is actually
/// there. The mutex serializes read-modify-write, so two dialogs cannot lose
/// each other's key.
///
/// A vault that exists but cannot be read is reported through [`Self::status`]
/// and refused by the writing methods; the soft reads (`get`, `has`, `all`,
/// `stored_ids`) still answer empty so that a broken vault does not take the
/// whole panel down with it.
pub struct KeyVault {
    path: PathBuf,
    lock: Mutex<()>,
}

impl KeyVault {
    /// The vault inside `dir`, which is the app data directory. The file is not
    /// created until the first key is stored.
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join(VAULT_FILE),
            lock: Mutex::new(()),
        }
    }

    /// Where the keys are written. Nothing in the app asks - the vault is the
    /// only thing that touches the file - but the tests assert on it, because
    /// "beside the database, never in the repository" is the point of it.
    #[cfg(test)]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Store `key` for `provider_id`, replacing whatever was there.
    ///
    /// Refuses an unknown provider and a blank key: both are typos, and a typo
    /// in a vault is a mystery to debug months later. Also refuses a vault it
    /// cannot safely merge into - one encrypted for somebody else is never
    /// clobbered (see [`VaultReadError`]).
    pub fn set(&self, provider_id: &str, key: &str) -> Result<(), String> {
        let provider_id = provider_id.trim();
        if find(provider_id).is_none() {
            return Err(format!("unknown provider: {provider_id}"));
        }
        let key = key.trim();
        if key.is_empty() {
            return Err(format!("the {provider_id} key is empty"));
        }

        let _guard = self.lock.lock().map_err(|_| "the key vault is poisoned")?;
        let mut file = self.read_for_update()?;
        file.keys.insert(provider_id.to_string(), key.to_string());
        self.write(&file)
    }

    /// Forget this provider's key. Deleting one that is not there is fine: the
    /// caller wanted it gone, and it is.
    pub fn delete(&self, provider_id: &str) -> Result<(), String> {
        let provider_id = provider_id.trim();
        let _guard = self.lock.lock().map_err(|_| "the key vault is poisoned")?;
        let mut file = self.read_for_update()?;
        if file.keys.remove(provider_id).is_none() {
            return Ok(());
        }
        self.write(&file)
    }

    pub fn has(&self, provider_id: &str) -> bool {
        self.get(provider_id).is_some()
    }

    /// The stored key, if there is one.
    pub fn get(&self, provider_id: &str) -> Option<String> {
        self.read_soft().keys.remove(provider_id.trim())
    }

    /// Every stored key, for the one caller that needs them all: the OmniRoute
    /// key sync, and only once the user has opted in to it. Crate-private on
    /// purpose (dual review W1-24b, R-2): nothing else has a reason to hold
    /// every key at once. Never log the result and never hand it to an IPC or
    /// HTTP caller.
    pub(crate) fn all(&self) -> BTreeMap<String, String> {
        self.read_soft().keys
    }

    /// The ids with a key, which is all the overview needs - it has no business
    /// holding the keys themselves.
    pub fn stored_ids(&self) -> Vec<String> {
        self.read_soft().keys.into_keys().collect()
    }

    /// `None` when the vault read cleanly (or does not exist yet); the read
    /// error otherwise. This is how a broken vault becomes visible - on the
    /// overview's `vaultError` - without breaking the soft reads above.
    pub fn status(&self) -> Option<String> {
        self.read().err().map(|err| err.to_string())
    }

    /// The soft read behind the probe paths: a vault that cannot be read
    /// answers "nothing here", so a broken file does not take the whole panel
    /// down. The error is not lost - it is what [`Self::status`] reports.
    fn read_soft(&self) -> VaultFile {
        match self.read() {
            Ok(file) => file,
            Err(err) => {
                eprintln!("projecta: {err}");
                VaultFile::default()
            }
        }
    }

    /// The read half of a read-modify-write. A *corrupt* vault is archived
    /// next to the original and rebuilt empty - its content was unreadable
    /// anyway, and the archive keeps the evidence. Anything else that failed
    /// to read (permissions, or an encrypted blob made for another user or
    /// machine) comes back as the error: those bytes may be perfectly
    /// readable to somebody, and overwriting them would be the very loss the
    /// error exists to prevent.
    fn read_for_update(&self) -> Result<VaultFile, String> {
        match self.read() {
            Ok(file) => Ok(file),
            Err(err @ VaultReadError::Corrupt(_)) => {
                self.archive_corrupt(&err)?;
                Ok(VaultFile::default())
            }
            Err(err) => Err(err.to_string()),
        }
    }

    /// Move an unreadable vault aside, keeping its bytes as evidence.
    fn archive_corrupt(&self, err: &VaultReadError) -> Result<(), String> {
        let archive = self.path.with_file_name(format!(
            "{}.broken-{}-{}",
            VAULT_FILE,
            now_unix_secs(),
            std::process::id()
        ));
        std::fs::rename(&self.path, &archive).map_err(|io| {
            format!(
                "failed to archive the corrupt vault to {}: {io}",
                archive.display()
            )
        })?;
        eprintln!(
            "projecta: the provider key vault was archived to {} after: {err}",
            archive.display()
        );
        Ok(())
    }

    /// Read the file. A *missing* vault is an empty one. A vault that exists
    /// but cannot be read is an error: reading it as empty would be
    /// indistinguishable from "no keys stored", which is exactly what the
    /// panel used to show while the real state only went to the log.
    ///
    /// This overrides the deliberately documented pre-DPAPI behaviour ("a
    /// corrupt file must not blank the panel with an error the user cannot
    /// act on"). Sanierungsplan Phase 1.6 / Entscheidung 8.2 makes the error
    /// one the user *can* act on: the overview carries it as `vaultError`,
    /// the dialog explains it, and re-entering a key repairs a corrupt vault
    /// while preserving the evidence.
    fn read(&self) -> Result<VaultFile, VaultReadError> {
        let raw = match std::fs::read(&self.path) {
            Ok(raw) => raw,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Ok(VaultFile::default());
            }
            Err(err) => {
                return Err(VaultReadError::Unreadable(format!(
                    "could not read {}: {err}",
                    self.path.display()
                )));
            }
        };
        // Marker and base64 are ASCII; the lossy conversion only rewrites
        // already-corrupt bytes, which then fail parsing exactly as intended.
        let text = String::from_utf8_lossy(&raw);
        let trimmed = text.trim();
        if let Some(payload) = trimmed.strip_prefix(VAULT_DPAPI_MARKER) {
            let blob = base64::engine::general_purpose::STANDARD
                .decode(payload.trim())
                .map_err(|_| {
                    VaultReadError::Corrupt(
                        "the vault claims DPAPI encryption but its payload is not base64"
                            .to_string(),
                    )
                })?;
            let plain = unprotect_vault(&blob, &self.path)?;
            let plain = String::from_utf8(plain).map_err(|_| {
                VaultReadError::Corrupt("the decrypted vault is not UTF-8".to_string())
            })?;
            return serde_json::from_str(&plain).map_err(|err| {
                VaultReadError::Corrupt(format!("the decrypted vault is not valid JSON: {err}"))
            });
        }
        serde_json::from_str(trimmed).map_err(|err| {
            VaultReadError::Corrupt(format!(
                "{} is neither a valid vault file nor an encrypted one: {err}",
                self.path.display()
            ))
        })
    }

    /// Write the vault: encrypt (on Windows), then atomically replace.
    fn write(&self, file: &VaultFile) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
        }
        let body = serde_json::to_string_pretty(&VaultFile {
            note: VAULT_NOTE.to_string(),
            keys: file.keys.clone(),
        })
        .map_err(|e| format!("failed to render the key vault: {e}"))?;
        // Windows encrypts; unix has no DPAPI and stays plaintext - which is
        // also why the unix legacy format and the unix native format are the
        // same file.
        #[cfg(windows)]
        let encoded = encode_body(&body)?;
        #[cfg(not(windows))]
        let encoded = body.as_str();
        write_atomic(&self.path, encoded.as_bytes())?;

        // Belt over the create-with-0600 suspenders in `write_atomic`: the
        // rename keeps the temp file's mode, and this narrows the result
        // again wherever a platform re-inherits on rename.
        crate::oneshot::make_private(&self.path);
        Ok(())
    }
}

/// The vault body's on-disk form on Windows: a DPAPI blob under the marker.
/// The unix counterpart is inline in `write` - there is nothing to encode
/// when no DPAPI exists.
#[cfg(windows)]
fn encode_body(body: &str) -> Result<String, String> {
    let blob = vault_crypto::protect(body.as_bytes())
        .map_err(|err| format!("failed to encrypt the key vault: {err}"))?;
    Ok(format!(
        "{VAULT_DPAPI_MARKER}{}\n",
        base64::engine::general_purpose::STANDARD.encode(blob)
    ))
}

/// Open a DPAPI blob found under the marker. Windows decrypts it for the
/// current user account.
#[cfg(windows)]
fn unprotect_vault(blob: &[u8], path: &Path) -> Result<Vec<u8>, VaultReadError> {
    vault_crypto::unprotect(blob)
        .map_err(|detail| VaultReadError::DecryptFailed(format!("{}: {detail}", path.display())))
}

/// The no-DPAPI counterpart: a Windows vault on a unix mount must fail as
/// "encrypted", not parse as garbage - and never be overwritten.
#[cfg(not(windows))]
fn unprotect_vault(_blob: &[u8], path: &Path) -> Result<Vec<u8>, VaultReadError> {
    Err(VaultReadError::DecryptFailed(format!(
        "{}: the vault is encrypted with Windows DPAPI, which this platform does not have",
        path.display()
    )))
}

/// Write `body` to `path` so a crash mid-write can never leave half a vault
/// behind: the bytes land in a sibling temp file first, are flushed to disk,
/// and are then renamed over the target in one atomic replace. The temp file
/// is created private on unix, so the vault is 0600 from birth rather than
/// for the window between `create` and a later chmod. Windows has no
/// portable create-with-mode in std; there the app data directory's per-user
/// ACL is inherited at creation, which is the best std can do.
fn write_atomic(path: &Path, body: &[u8]) -> Result<(), String> {
    let tmp = path.with_file_name(format!(
        "{}.tmp-{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(VAULT_FILE),
        std::process::id()
    ));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let written = (|| -> std::io::Result<()> {
        let mut file = options.open(&tmp)?;
        file.write_all(body)?;
        file.sync_all()
    })();
    if let Err(err) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("failed to write {}: {err}", tmp.display()));
    }
    if let Err(err) = replace_file(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!(
            "failed to replace {} with {}: {err}",
            path.display(),
            tmp.display()
        ));
    }
    Ok(())
}

/// Rename `tmp` over `target`, replacing it atomically.
///
/// Windows needs `MoveFileExW` with REPLACE_EXISTING called directly: the
/// replacement guarantee of std's `rename` there is toolchain-dependent, and
/// this crate's MSRV (1.77) predates it. On unix `rename(2)` has always
/// replaced.
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
    let ok = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

/// The unix counterpart: `rename(2)` replaces atomically by definition.
#[cfg(not(windows))]
fn replace_file(tmp: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::rename(tmp, target)
}

/// Windows DPAPI: encryption scoped to the current user account. The blob it
/// produces can be opened by the same user on the same machine and by nobody
/// else - which is exactly the trust boundary the plaintext vault used to
/// borrow from the profile directory.
#[cfg(windows)]
mod vault_crypto {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    /// DPAPI-encrypt `plain` for the current user account.
    pub fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: plain.len() as u32,
            pbData: plain.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        // UI_FORBIDDEN: a background app must never pop a system dialog.
        let ok = unsafe {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(format!(
                "CryptProtectData failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        let bytes =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
        unsafe {
            LocalFree(output.pbData as *mut core::ffi::c_void);
        }
        Ok(bytes)
    }

    /// The reverse of [`protect`]. A blob made by another user or machine -
    /// or a damaged one - fails here, and the caller turns that into the
    /// error the vault never overwrites.
    pub fn unprotect(blob: &[u8]) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: blob.len() as u32,
            pbData: blob.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let ok = unsafe {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(format!(
                "encrypted for another Windows user or machine, or the blob is damaged; \
                 it is left untouched (CryptUnprotectData: {})",
                std::io::Error::last_os_error()
            ));
        }
        let bytes =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
        unsafe {
            LocalFree(output.pbData as *mut core::ffi::c_void);
        }
        Ok(bytes)
    }
}

/// Seal a private UTF-8 payload the same way the vault does: DPAPI on
/// Windows, plaintext on unix. Session buffers reuse this so scrollback is
/// never a second encryption scheme.
pub(crate) fn seal_private(plain: &str) -> Result<String, String> {
    #[cfg(windows)]
    {
        encode_body(plain)
    }
    #[cfg(not(windows))]
    {
        Ok(plain.to_string())
    }
}

/// Reverse of [`seal_private`]. A DPAPI blob this user cannot open fails
/// rather than returning plaintext that happens to start with the marker.
pub(crate) fn open_private(stored: &str) -> Result<String, String> {
    let trimmed = stored.trim();
    if let Some(payload) = trimmed.strip_prefix(VAULT_DPAPI_MARKER) {
        let blob = base64::engine::general_purpose::STANDARD
            .decode(payload.trim())
            .map_err(|err| format!("private blob is not base64: {err}"))?;
        let bytes =
            unprotect_vault(&blob, Path::new("session-buffer")).map_err(|err| err.to_string())?;
        String::from_utf8(bytes).map_err(|err| format!("private blob is not utf-8: {err}"))
    } else {
        Ok(stored.to_string())
    }
}

// -- the overview ----------------------------------------------------------

/// One row per provider: what the probe found, joined with what the quota
/// tracker knows.
///
/// The two halves answer different questions and neither implies the other. A
/// `claude` that is installed and signed in is `connected` even while its
/// `quotaState` is `blocked`; that pair - reachable but refusing - is exactly
/// the state worth showing.
pub fn overview(
    probe: &dyn ProviderProbe,
    vault: &KeyVault,
    quota: &QuotaTracker,
    engine: &StatusEngine,
) -> Vec<ProviderOverview> {
    let ids: Vec<String> = PROVIDERS.iter().map(|spec| spec.id.to_string()).collect();
    let rows = quota.snapshot(&ids);
    // Every row carries the same flag; the snapshot answers for the ids asked
    // for, so there is always a first one.
    let omni_route_online = rows.first().is_some_and(|row| row.omni_route_online);
    let stored = vault.stored_ids();
    // One fact about the machine, same on every row: a broken vault is the
    // difference between "no keys stored" and "keys unreadable", and the panel
    // has to be able to say which one it is looking at.
    let vault_error = vault.status();

    PROVIDERS
        .iter()
        .map(|spec| {
            let has_key = stored.iter().any(|id| id == spec.id);
            let outcome = probe.probe(spec, has_key);
            let quota_row = rows.iter().find(|row| row.profile_id == spec.id);
            ProviderOverview {
                id: spec.id.to_string(),
                name: spec.name.to_string(),
                kind: spec.kind.to_string(),
                connected: outcome.connected,
                detail: outcome.detail,
                quota_state: quota_row
                    .map(|row| row.state.clone())
                    .unwrap_or_else(|| QUOTA_UNKNOWN.to_string()),
                blocked_until: quota_row.and_then(|row| row.blocked_until),
                omni_route_online,
                usage: resolve_usage(spec.id, vault, engine),
                vault_error: vault_error.clone(),
            }
        })
        .collect()
}

fn resolve_usage(
    provider_id: &str,
    vault: &KeyVault,
    engine: &StatusEngine,
) -> Option<ProviderUsage> {
    match provider_id {
        "claude" => statusline_usage(engine, provider_id),
        "openrouter" => openrouter_usage(vault),
        "ollama" => Some(local_usage()),
        // OmniRoute does not document a usage route; codex/kimi/opencode
        // have no legitimate source per the current findings.
        _ => None,
    }
}

fn statusline_usage(engine: &StatusEngine, provider_id: &str) -> Option<ProviderUsage> {
    engine
        .provider_usage(provider_id)
        .map(|usage| ProviderUsage {
            percent: usage.percent,
            used: usage.used,
            limit: usage.limit,
            window_label: usage.window_label,
            resets_at: usage.resets_at,
            source: "hook".to_string(),
            observed_at: usage.observed_at,
        })
}

fn local_usage() -> ProviderUsage {
    ProviderUsage {
        percent: None,
        used: None,
        limit: None,
        window_label: "lokal — kein Kontingent".to_string(),
        resets_at: None,
        source: "local".to_string(),
        observed_at: now_unix_secs(),
    }
}

fn openrouter_usage(vault: &KeyVault) -> Option<ProviderUsage> {
    let key = vault.get("openrouter")?;
    let cache = OPENROUTER_CACHE.get_or_init(|| Mutex::new(None));
    let now = Instant::now();
    // A stale-but-present cache entry is still a better answer than treating
    // a poisoned lock as "never fetched" (W1-15): the slot is a plain
    // replace, never a partial write, so it is taken over rather than
    // skipped on both the read and the write below.
    {
        let slot = cache.lock().unwrap_or_else(|poison| poison.into_inner());
        if let Some((cached_key, fetched_at, usage)) = slot.as_ref() {
            if cached_key == &key
                && now.saturating_duration_since(*fetched_at) < OPENROUTER_CACHE_TTL
            {
                return Some(usage.clone());
            }
        }
    }

    let body = fetch_openrouter(&key)?;
    let usage = parse_openrouter_body(&body)?;
    *cache.lock().unwrap_or_else(|poison| poison.into_inner()) = Some((key, now, usage.clone()));
    Some(usage)
}

fn fetch_openrouter(key: &str) -> Option<String> {
    let program = if cfg!(windows) { "curl.exe" } else { "curl" };
    // The key goes as a config line on stdin, never as an argv element: a
    // billing key in `/proc/<pid>/cmdline` is readable by every local process
    // for the lifetime of the call. `--config -` is curl's own way to take a
    // header without putting it on the command line.
    let config = format!("header = \"Authorization: Bearer {key}\"\n");
    let (_, printed) = run_capture_with_stdin(
        program,
        &[
            "-sS",
            "-m",
            "5",
            "--config",
            "-",
            "https://openrouter.ai/api/v1/key",
        ],
        Some(&config),
    )?;
    Some(printed)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
struct OpenRouterResponse {
    limit: Option<f64>,
    limit_remaining: Option<f64>,
    usage: Option<f64>,
    is_free_tier: Option<bool>,
}

/// The `/key` response wraps its payload in a `"data"` object.
#[derive(Debug, Deserialize)]
struct OpenRouterEnvelope {
    data: Option<OpenRouterResponse>,
}

fn parse_openrouter_body(body: &str) -> Option<ProviderUsage> {
    let envelope: OpenRouterEnvelope = serde_json::from_str(body.trim()).ok()?;
    let response = envelope.data?;
    let limit = response.limit.filter(|v| v.is_finite() && *v >= 0.0);
    let usage = response.usage.filter(|v| v.is_finite() && *v >= 0.0);
    // A zero limit is OpenRouter's "no cap": no percentage exists, the same
    // answer the null-limit case gives. Dividing anyway yields `0.0 / 0.0`,
    // which casts to `0` and would fabricate a "0 % used" the API never said.
    let percent = limit
        .filter(|limit| *limit > 0.0)
        .and_then(|limit| usage.map(|usage| ((usage / limit) * 100.0).round() as u8))
        .filter(|&p| p <= 100);
    Some(ProviderUsage {
        percent,
        // These are USD credits, not tokens - format them as money.
        used: usage.and_then(format_credits),
        limit: limit.and_then(format_credits),
        window_label: "OpenRouter".to_string(),
        resets_at: None,
        source: "api".to_string(),
        observed_at: now_unix_secs(),
    })
}

/// `$3.71` - two decimals; the API does not carry more precision.
fn format_credits(value: f64) -> Option<String> {
    if !value.is_finite() || value < 0.0 {
        return None;
    }
    Some(format!("${value:.2}"))
}

/// Cache for the OpenRouter `/key` response, keyed by the stored key.
static OPENROUTER_CACHE: std::sync::OnceLock<Mutex<Option<(String, Instant, ProviderUsage)>>> =
    std::sync::OnceLock::new();

/// How long an OpenRouter response is reused before it is refreshed.
const OPENROUTER_CACHE_TTL: Duration = Duration::from_secs(60);

// -- pushing the keys into OmniRoute (opt-in, F-SEC-4) ---------------------
//
// F-SEC-4: the push goes to whatever answers on OmniRoute's loopback port. A
// `200` health reply does not authenticate the listener, so a port squatter
// would be handed every provider key. There is no identity check that neither
// breaks legitimate builds nor hands the squatter something else (see
// `.pa/report_w1-08.md` §3), so the user decides: the sync is off until they
// switch it on (decision of 24.09.2026, W1-24b). Off is the absence of the
// setting, which makes every install from before the switch existed off too.

/// Settings key for the user's opt-in to handing vault keys to OmniRoute.
/// Only the literal `"1"` is consent; a missing row or any other value is off.
pub const SETTING_OMNIROUTE_KEY_SYNC: &str = "omniroute.key_sync";

/// Whether the user has opted in to the key sync. Off unless switched on - the
/// opposite of the digest and learning switches, on purpose: this one hands
/// credentials to another process.
pub async fn key_sync_enabled(store: &Store) -> bool {
    matches!(
        store.get_setting(SETTING_OMNIROUTE_KEY_SYNC).await,
        Ok(Some(value)) if value == "1"
    )
}

/// Record the user's key-sync choice.
pub async fn set_key_sync_enabled(store: &Store, enabled: bool) -> Result<(), String> {
    store
        .set_setting(SETTING_OMNIROUTE_KEY_SYNC, if enabled { "1" } else { "0" })
        .await
}

/// The user's consent to the key sync, as the sync itself takes it. A type and
/// not a `bool` so that no call site can hand over the keys by accident: it
/// has to name [`KeySync::OptedIn`], which only [`KeySync::from_setting`]
/// produces in production code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeySync {
    /// No consent: nothing leaves the vault.
    Off,
    /// The user switched the sync on in the provider dialog.
    OptedIn,
}

impl KeySync {
    /// The consent as the settings table records it right now.
    pub async fn from_setting(store: &Store) -> Self {
        if key_sync_enabled(store).await {
            KeySync::OptedIn
        } else {
            KeySync::Off
        }
    }
}

/// Hand OmniRoute the keys we hold, if the user opted in and the router is up
/// and will take them.
///
/// Without consent this returns before touching the network or the vault.
/// With it, it is entirely best effort, and deliberately so: OmniRoute's
/// configuration API is not pinned down, different builds expose different
/// routes, and ProjectA does not depend on the router at all. Every outcome
/// short of success is printed once and stepped over. Returns whether an
/// endpoint accepted the push, which is what the tests assert on.
pub fn sync_keys_to_omniroute(omni: &OmniRoute, vault: &KeyVault, consent: KeySync) -> bool {
    if consent != KeySync::OptedIn {
        return false;
    }
    if !omni.is_online() {
        return false;
    }
    // The router's own logins are not provider credentials, and handing them
    // back to OmniRoute as such would be both meaningless and a place for
    // them to end up in a config file nobody meant to write them to. There
    // are two: the management token (T3) and the legacy registry entry the
    // free-tier probe reads (T5, `freetier::VAULT_ID`).
    let keys: BTreeMap<String, String> = vault
        .all()
        .into_iter()
        .filter(|(id, _)| id != OMNIROUTE_MANAGEMENT && id != crate::freetier::VAULT_ID)
        .collect();
    if keys.is_empty() {
        return false;
    }

    let providers: serde_json::Map<String, Value> = keys
        .into_iter()
        .map(|(id, key)| (id, json!({ "api_key": key })))
        .collect();
    let body = json!({ "providers": providers }).to_string();

    for path in OMNIROUTE_CONFIG_PATHS {
        // A 404 is the ordinary answer from a build without this route, so a
        // rejected path is simply the next one's turn.
        if matches!(post(omni.addr(), path, &body), Some(status) if (200..300).contains(&status)) {
            return true;
        }
    }
    eprintln!("projecta: omniroute took none of the provider config routes; keys were not pushed");
    false
}

/// One `POST`, returning the status code. The same shape as [`omniroute::get`]:
/// a `TcpStream` and a `format!`, because that is all a loopback call needs.
fn post(addr: SocketAddr, path: &str, body: &str) -> Option<u16> {
    let mut stream = TcpStream::connect_timeout(&addr, omniroute::PROBE_TIMEOUT).ok()?;
    stream
        .set_read_timeout(Some(omniroute::PROBE_TIMEOUT))
        .ok()?;
    stream
        .set_write_timeout(Some(omniroute::PROBE_TIMEOUT))
        .ok()?;

    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {addr}\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nUser-Agent: ProjectA\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).ok()?;
    stream.flush().ok()?;

    let mut raw: Vec<u8> = Vec::with_capacity(1024);
    let mut chunk = [0u8; 4096];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => raw.extend_from_slice(&chunk[..n]),
        }
        if raw.len() >= MAX_RESPONSE {
            break;
        }
    }
    omniroute::parse_response(&raw).map(|(status, _)| status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::net::TcpListener;
    use std::sync::mpsc::{channel, Receiver, Sender};

    use crate::store::{QUOTA_BLOCKED, QUOTA_OK};
    use crate::testutil::TempDir;

    /// A probe that answers from a table. Anything not in it is missing, which
    /// is the honest default for a machine with nothing installed.
    #[derive(Default)]
    struct FakeProbe {
        outcomes: HashMap<&'static str, ProbeOutcome>,
        /// `(providerId, hasKey)` for every call, in order.
        asked: Mutex<Vec<(String, bool)>>,
    }

    impl FakeProbe {
        fn with(mut self, id: &'static str, outcome: ProbeOutcome) -> Self {
            self.outcomes.insert(id, outcome);
            self
        }
    }

    impl ProviderProbe for FakeProbe {
        fn probe(&self, spec: &ProviderSpec, has_key: bool) -> ProbeOutcome {
            self.asked
                .lock()
                .unwrap()
                .push((spec.id.to_string(), has_key));
            self.outcomes
                .get(spec.id)
                .cloned()
                .unwrap_or_else(ProbeOutcome::missing)
        }
    }

    fn vault(dir: &TempDir) -> KeyVault {
        KeyVault::new(dir.path())
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn openrouter_key_never_appears_in_the_child_process_command_line() {
        use std::ffi::OsString;
        use std::os::unix::fs::PermissionsExt;

        static PATH_LOCK: Mutex<()> = Mutex::new(());
        let _guard = PATH_LOCK.lock().unwrap();
        let dir = TempDir::new("providers-fake-curl");
        let curl = dir.path().join("curl");
        std::fs::write(&curl, "#!/bin/sh\ntr '\\000' '\\n' < /proc/$$/cmdline\n").unwrap();
        std::fs::set_permissions(&curl, std::fs::Permissions::from_mode(0o700)).unwrap();

        struct RestorePath(Option<OsString>);
        impl Drop for RestorePath {
            fn drop(&mut self) {
                match self.0.take() {
                    Some(path) => std::env::set_var("PATH", path),
                    None => std::env::remove_var("PATH"),
                }
            }
        }

        let old_path = std::env::var_os("PATH");
        let _restore = RestorePath(old_path.clone());
        let mut paths = vec![dir.path().to_path_buf()];
        paths.extend(std::env::split_paths(
            old_path.as_deref().unwrap_or_default(),
        ));
        std::env::set_var("PATH", std::env::join_paths(paths).unwrap());

        let key = "sk-or-a2-visible-in-proc";
        let cmdline = fetch_openrouter(key).expect("fake curl output");
        assert!(
            !cmdline.contains(key),
            "the billing key was visible in /proc/<pid>/cmdline: {cmdline:?}"
        );
    }

    fn row(rows: &[ProviderOverview], id: &str) -> ProviderOverview {
        rows.iter()
            .find(|row| row.id == id)
            .unwrap_or_else(|| panic!("no {id} row in the overview"))
            .clone()
    }

    /// A throwaway server answering every request the same way, reporting each
    /// raw request it received down the returned channel.
    fn serve(status: u16, body: &'static str) -> (SocketAddr, Receiver<String>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind");
        let addr = listener.local_addr().expect("addr");
        let (tx, rx): (Sender<String>, Receiver<String>) = channel();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                // Drain the request before answering: closing a socket that
                // still holds unread bytes resets the connection on Windows.
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let _ = tx.send(String::from_utf8_lossy(&buf[..n]).into_owned());
                let reason = if (200..300).contains(&status) {
                    "OK"
                } else {
                    "Not Found"
                };
                let response = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\n\
                     Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        (addr, rx)
    }

    // -- the registry ------------------------------------------------------

    #[test]
    fn windows_prefers_userprofile_over_a_posix_home_spelling() {
        let source = include_str!("providers.rs");
        let home_dir = source
            .split("fn home_dir()")
            .nth(1)
            .and_then(|rest| rest.split("fn run_capture(").next())
            .expect("home_dir source");
        let home = home_dir.find("var_os(\"HOME\")").expect("HOME lookup");
        let userprofile = home_dir
            .find("var_os(\"USERPROFILE\")")
            .expect("USERPROFILE lookup");
        assert!(
            userprofile < home,
            "HOME wins on Windows even when it has an MSYS spelling such as /c/Users/me, so auth files are looked up below C:\\\\c instead of USERPROFILE:\n{home_dir}"
        );
    }

    #[test]
    fn every_provider_the_phase_asks_for_is_registered() {
        let ids: Vec<&str> = PROVIDERS.iter().map(|spec| spec.id).collect();
        for expected in [
            "claude",
            "codex",
            "opencode",
            "ollama",
            "omniroute",
            "kimi",
            "openrouter",
            OMNIROUTE_MANAGEMENT,
        ] {
            assert!(
                ids.contains(&expected),
                "{expected} is missing from {ids:?}"
            );
        }
        assert_eq!(ids.len(), 8, "an unexpected provider appeared: {ids:?}");
    }

    #[test]
    fn the_registry_is_well_formed() {
        let mut seen: Vec<&str> = Vec::new();
        for spec in PROVIDERS {
            assert!(!spec.id.trim().is_empty(), "a provider with no id");
            assert!(!spec.name.trim().is_empty(), "{} has no name", spec.id);
            assert!(
                !seen.contains(&spec.id),
                "{} is registered twice; the vault keys off the id",
                spec.id
            );
            seen.push(spec.id);
            assert!(
                [KIND_SUBSCRIPTION, KIND_API_KEY, KIND_LOCAL].contains(&spec.kind),
                "{} has an unknown kind: {}",
                spec.id,
                spec.kind
            );
            // Only an api_key provider is connected by holding a key.
            if matches!(spec.probe, Probe::StoredKey) {
                assert_eq!(
                    spec.kind, KIND_API_KEY,
                    "{} is keyed but not api_key",
                    spec.id
                );
            }
        }
    }

    #[test]
    fn the_probe_instructions_say_where_to_look() {
        let claude = find("claude").expect("claude");
        assert_eq!(claude.kind, KIND_SUBSCRIPTION);
        let Probe::Cli(cli) = claude.probe else {
            panic!("claude is probed by running it");
        };
        assert_eq!(cli.binary, "claude");
        assert_eq!(cli.auth_args, ["auth", "status"]);

        let Probe::Cli(codex) = find("codex").expect("codex").probe else {
            panic!("codex is probed by running it");
        };
        assert!(codex.auth_files.contains(&".codex/auth.json"));

        let Probe::Cli(opencode) = find("opencode").expect("opencode").probe else {
            panic!("opencode is probed by running it");
        };
        assert!(
            !opencode.auth_files.is_empty(),
            "opencode is probed by its binary and its config"
        );

        assert_eq!(
            find("ollama").expect("ollama").probe,
            Probe::Http {
                port: 11434,
                path: "/api/version"
            }
        );
        let Probe::Http { port, .. } = find("omniroute").expect("omniroute").probe else {
            panic!("omniroute is probed over http");
        };
        assert_eq!(port, omniroute::DEFAULT_PORT);
        assert_eq!(port, 20128);

        assert_eq!(
            find("openrouter").expect("openrouter").probe,
            Probe::StoredKey
        );
        assert_eq!(find("nope"), None);
    }

    // -- the vault ---------------------------------------------------------

    #[test]
    fn a_key_survives_a_round_trip_through_the_file() {
        let dir = TempDir::new("vault");
        let vault = vault(&dir);

        assert!(!vault.has("openrouter"), "nothing is stored yet");
        assert_eq!(vault.get("openrouter"), None);
        assert!(!vault.path().exists(), "an unused vault writes no file");

        vault.set("openrouter", "sk-or-v1-secret").expect("set");
        assert!(vault.has("openrouter"));
        assert_eq!(vault.get("openrouter").as_deref(), Some("sk-or-v1-secret"));

        // A second vault over the same directory is the restart case.
        let reopened = KeyVault::new(dir.path());
        assert_eq!(
            reopened.get("openrouter").as_deref(),
            Some("sk-or-v1-secret")
        );

        reopened
            .set("openrouter", "  sk-replaced  ")
            .expect("replace");
        assert_eq!(vault.get("openrouter").as_deref(), Some("sk-replaced"));

        vault.delete("openrouter").expect("delete");
        assert!(!vault.has("openrouter"));
        assert!(vault.all().is_empty());
        // Deleting again is not an error: the key is gone either way.
        vault.delete("openrouter").expect("delete twice");
    }

    #[test]
    fn the_vault_lives_beside_the_database_and_says_what_it_is() {
        let dir = TempDir::new("vault-file");
        let vault = vault(&dir);
        vault.set("openrouter", "sk-secret").expect("set");

        assert_eq!(vault.path(), dir.path().join(VAULT_FILE));
        let raw = std::fs::read_to_string(vault.path()).expect("read the vault");
        if cfg!(windows) {
            // DPAPI-encrypted: the marker says what the file is; the note and
            // the keys live inside the blob - which is the point of it.
            assert!(raw.starts_with(VAULT_DPAPI_MARKER), "{raw}");
            assert!(!raw.contains("sk-secret"), "{raw}");
        } else {
            let parsed: Value = serde_json::from_str(&raw).expect("the vault is json");
            assert_eq!(parsed["keys"]["openrouter"], "sk-secret");
            assert!(
                parsed["note"].as_str().is_some_and(|note| !note.is_empty()),
                "the file explains itself: {raw}"
            );
        }
    }

    #[test]
    fn a_typo_is_refused_rather_than_stored() {
        let dir = TempDir::new("vault-typo");
        let vault = vault(&dir);

        assert_eq!(
            vault.set("openrouterr", "sk-secret"),
            Err("unknown provider: openrouterr".to_string())
        );
        assert_eq!(
            vault.set("openrouter", "   "),
            Err("the openrouter key is empty".to_string())
        );
        assert!(!vault.path().exists(), "a refused key writes nothing");
    }

    #[test]
    fn a_plaintext_vault_file_still_reads_on_every_platform() {
        // The legacy format - and, on unix, still the native one.
        let dir = TempDir::new("vault-legacy-read");
        let vault = vault(&dir);
        std::fs::write(
            vault.path(),
            r#"{"note":"n","keys":{"openrouter":"sk-or-legacy"}}"#,
        )
        .expect("write");

        assert_eq!(vault.get("openrouter").as_deref(), Some("sk-or-legacy"));
        assert_eq!(vault.status(), None, "plaintext is not an error");
    }

    #[test]
    fn a_corrupt_vault_is_reported_not_silently_emptied() {
        let dir = TempDir::new("vault-corrupt");
        let vault = vault(&dir);
        std::fs::write(vault.path(), "{ not json at all").expect("write");

        // The soft reads stay soft: a broken vault must not take the panel
        // down, it answers "nothing readable here"...
        assert!(!vault.has("openrouter"));
        assert!(vault.all().is_empty());
        // ...but the damage is a named, visible error, not a silent empty
        // vault. "Silently read as empty" was the documented pre-DPAPI
        // behaviour; the error is what overrides it (see `KeyVault::read`).
        let status = vault.status().expect("a corrupt vault is reported");
        assert!(status.starts_with("vault_corrupt"), "{status}");
    }

    #[test]
    fn a_corrupt_vault_heals_on_the_next_write_and_keeps_the_evidence() {
        let dir = TempDir::new("vault-corrupt-heal");
        let vault = vault(&dir);
        std::fs::write(vault.path(), "{ not json at all").expect("write");

        // Re-entering a key is the recovery path: the unreadable file is
        // archived rather than silently overwritten, and the new key lands.
        vault.set("openrouter", "sk-secret").expect("set heals");
        assert_eq!(vault.get("openrouter").as_deref(), Some("sk-secret"));
        assert_eq!(vault.status(), None, "a rewritten vault is healthy");

        let archives: Vec<_> = std::fs::read_dir(dir.path())
            .expect("read_dir")
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("provider-keys.json.broken-")
            })
            .collect();
        assert_eq!(archives.len(), 1, "the corrupt file is kept as evidence");
        let archived = std::fs::read_to_string(archives[0].path()).expect("read archive");
        assert_eq!(archived, "{ not json at all", "the evidence is untouched");
    }

    #[test]
    fn an_undecryptable_vault_is_named_and_never_clobbered() {
        let dir = TempDir::new("vault-foreign");
        let vault = vault(&dir);
        // A valid marker over bytes this user cannot open: on Windows
        // CryptUnprotectData refuses them, on unix the platform check does -
        // the same answer a vault written by another user or machine gets.
        let foreign = format!(
            "{VAULT_DPAPI_MARKER}{}",
            base64::engine::general_purpose::STANDARD.encode(b"not a dpapi blob")
        );
        std::fs::write(vault.path(), &foreign).expect("write");

        let status = vault.status().expect("a foreign vault is reported");
        assert!(status.starts_with("vault_decrypt_failed"), "{status}");

        // Writing must refuse: the keys in that blob may be perfectly
        // readable to the account that made them, and overwriting them would
        // be the loss the error exists to prevent.
        let err = vault
            .set("openrouter", "sk-secret")
            .expect_err("set refuses");
        assert!(err.starts_with("vault_decrypt_failed"), "{err}");
        assert!(
            vault.delete("openrouter").is_err(),
            "delete refuses as well"
        );
        assert_eq!(
            std::fs::read_to_string(vault.path()).expect("read"),
            foreign,
            "the file is byte-identical afterwards"
        );
    }

    /// The real round trip needs DPAPI, which only Windows has.
    #[cfg(windows)]
    #[test]
    fn a_written_vault_is_encrypted_for_this_user_and_round_trips() {
        let dir = TempDir::new("vault-dpapi");
        let vault = vault(&dir);
        vault.set("openrouter", "sk-or-v1-secret").expect("set");

        let raw = std::fs::read_to_string(vault.path()).expect("read the vault");
        assert!(
            raw.starts_with(VAULT_DPAPI_MARKER),
            "encrypted on disk: {raw}"
        );
        assert!(
            !raw.contains("sk-or-v1-secret"),
            "the key must not be recoverable from the file: {raw}"
        );

        let reopened = KeyVault::new(dir.path());
        assert_eq!(
            reopened.get("openrouter").as_deref(),
            Some("sk-or-v1-secret")
        );
        assert_eq!(reopened.status(), None);
    }

    /// Migration: a pre-DPAPI plaintext vault is upgraded by the next write.
    #[cfg(windows)]
    #[test]
    fn a_legacy_plaintext_vault_is_migrated_on_the_next_write() {
        let dir = TempDir::new("vault-migrate");
        let vault = vault(&dir);
        std::fs::write(
            vault.path(),
            "{\n  \"note\": \"legacy\",\n  \"keys\": {\n    \"openrouter\": \"sk-or-legacy\"\n  }\n}",
        )
        .expect("write legacy");

        // Legacy reads as-is, without an error...
        assert_eq!(vault.get("openrouter").as_deref(), Some("sk-or-legacy"));
        assert_eq!(vault.status(), None);

        // ...and the next write turns the file into the encrypted format,
        // content preserved.
        vault.set("openrouter", "sk-or-migrated").expect("set");
        let raw = std::fs::read_to_string(vault.path()).expect("read");
        assert!(raw.starts_with(VAULT_DPAPI_MARKER), "migrated: {raw}");
        assert!(!raw.contains("sk-or-migrated"), "{raw}");
        let reopened = KeyVault::new(dir.path());
        assert_eq!(
            reopened.get("openrouter").as_deref(),
            Some("sk-or-migrated")
        );
    }

    #[test]
    fn an_atomic_write_leaves_no_temp_file_behind() {
        let dir = TempDir::new("vault-atomic");
        let vault = vault(&dir);
        vault.set("openrouter", "sk-secret").expect("set");

        let names: Vec<String> = std::fs::read_dir(dir.path())
            .expect("read_dir")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, [VAULT_FILE.to_string()], "only the vault: {names:?}");
    }

    #[test]
    fn keys_never_appear_in_debug_or_error_output() {
        // The vault's own Debug: provider ids are registry entries, values
        // are secrets.
        let mut file = VaultFile::default();
        file.keys
            .insert("openrouter".to_string(), "sk-or-secret-value".to_string());
        let debug = format!("{file:?}");
        assert!(!debug.contains("sk-or-secret-value"), "{debug}");
        assert!(debug.contains("openrouter"), "{debug}");

        // And a corrupt file holding a key must not leak it through the
        // reported error either.
        let dir = TempDir::new("vault-noleak");
        let vault = vault(&dir);
        std::fs::write(
            vault.path(),
            r#"{"keys": {"openrouter": "sk-or-secret-value"}} trailing garbage"#,
        )
        .expect("write");
        let status = vault.status().expect("reported");
        assert!(!status.contains("sk-or-secret-value"), "{status}");
    }

    /// The vault is born private: create-with-0600, not create-then-chmod.
    #[cfg(unix)]
    #[test]
    fn a_vault_file_is_private_from_the_moment_it_exists() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new("vault-perms");
        let vault = vault(&dir);
        vault.set("openrouter", "sk-secret").expect("set");

        let mode = std::fs::metadata(vault.path())
            .expect("metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600, "{mode:o}");
    }

    // -- the overview ------------------------------------------------------

    #[test]
    fn the_overview_joins_the_probe_with_the_quota_tracker() {
        let dir = TempDir::new("overview");
        let vault = vault(&dir);
        let quota = QuotaTracker::default();
        let engine = StatusEngine::default();
        quota.note_blocked("claude", "5-hour limit reached", Some(1_800_000_000));
        quota.note_ok("codex");

        let probe = FakeProbe::default()
            .with("claude", ProbeOutcome::found("1.2.3 \u{b7} signed in"))
            .with("codex", ProbeOutcome::found("codex 0.9"));
        let rows = overview(&probe, &vault, &quota, &engine);

        assert_eq!(rows.len(), PROVIDERS.len());

        // Reachable but refusing: both halves are reported, independently.
        let claude = row(&rows, "claude");
        assert!(claude.connected);
        assert_eq!(claude.detail.as_deref(), Some("1.2.3 \u{b7} signed in"));
        assert_eq!(claude.quota_state, QUOTA_BLOCKED);
        assert_eq!(claude.blocked_until, Some(1_800_000_000));
        assert_eq!(claude.name, "Claude Code");
        assert_eq!(claude.kind, KIND_SUBSCRIPTION);

        let codex = row(&rows, "codex");
        assert!(codex.connected);
        assert_eq!(codex.quota_state, QUOTA_OK);
        assert_eq!(codex.blocked_until, None);

        // Nothing was observed and nothing was found: unknown, not blocked.
        let kimi = row(&rows, "kimi");
        assert!(!kimi.connected);
        assert_eq!(kimi.detail, None);
        assert_eq!(kimi.quota_state, QUOTA_UNKNOWN);

        // The offline default tracker says so on every row.
        assert!(rows.iter().all(|row| !row.omni_route_online));
    }

    #[test]
    fn a_stored_key_is_what_connects_an_api_key_provider() {
        let dir = TempDir::new("overview-key");
        let vault = vault(&dir);
        let quota = QuotaTracker::default();
        let engine = StatusEngine::default();

        let probe = FakeProbe::default();
        let rows = overview(&probe, &vault, &quota, &engine);
        assert!(!row(&rows, "openrouter").connected);
        assert_eq!(
            probe
                .asked
                .lock()
                .unwrap()
                .iter()
                .find(|(id, _)| id == "openrouter"),
            Some(&("openrouter".to_string(), false)),
            "the probe is told there is no key"
        );

        vault.set("openrouter", "sk-or-v1-secret").expect("set");
        let probe = FakeProbe::default();
        let rows = overview(&probe, &vault, &quota, &engine);
        assert_eq!(
            probe
                .asked
                .lock()
                .unwrap()
                .iter()
                .find(|(id, _)| id == "openrouter"),
            Some(&("openrouter".to_string(), true)),
            "a stored key reaches the probe"
        );

        // And the real probe turns that into a connection - the whole of what
        // being connected means for a provider reached over someone else's API.
        let spec = find("openrouter").expect("openrouter");
        let outcome = SystemProbe.probe(spec, true);
        assert!(outcome.connected);
        assert_eq!(outcome.detail.as_deref(), Some("key stored"));
        assert_eq!(SystemProbe.probe(spec, false), ProbeOutcome::missing());

        let openrouter = row(&rows, "openrouter");
        assert_eq!(openrouter.kind, KIND_API_KEY);
        assert!(
            !serde_json::to_string(&openrouter)
                .unwrap()
                .contains("sk-or-v1"),
            "the overview must never carry the key itself"
        );
    }

    #[test]
    fn the_payload_uses_the_camel_case_wire_names() {
        let dir = TempDir::new("overview-wire");
        let vault = vault(&dir);
        let quota = QuotaTracker::default();
        let engine = StatusEngine::default();
        quota.note_blocked("claude", "usage limit reached", Some(7));

        let probe = FakeProbe::default().with("claude", ProbeOutcome::found("1.2.3"));
        let rows = overview(&probe, &vault, &quota, &engine);
        let json = serde_json::to_value(row(&rows, "claude")).unwrap();

        assert_eq!(json["id"], "claude");
        assert_eq!(json["name"], "Claude Code");
        assert_eq!(json["kind"], KIND_SUBSCRIPTION);
        assert_eq!(json["connected"], true);
        assert_eq!(json["detail"], "1.2.3");
        assert_eq!(json["quotaState"], QUOTA_BLOCKED);
        assert_eq!(json["blockedUntil"], 7);
        assert_eq!(json["omniRouteOnline"], false);
        assert!(json["usage"].is_null());
        assert!(json["vaultError"].is_null(), "a healthy vault says nothing");

        let json = serde_json::to_value(row(&rows, "kimi")).unwrap();
        assert!(json["detail"].is_null());
        assert!(json["blockedUntil"].is_null());
    }

    #[test]
    fn the_overview_names_a_broken_vault_on_every_row() {
        let dir = TempDir::new("overview-vault-error");
        let vault = vault(&dir);
        let quota = QuotaTracker::default();
        let engine = StatusEngine::default();
        std::fs::write(vault.path(), "{ broken").expect("write");

        let rows = overview(&FakeProbe::default(), &vault, &quota, &engine);
        assert!(!rows.is_empty());
        assert!(
            rows.iter().all(|row| row
                .vault_error
                .as_deref()
                .is_some_and(|err| err.starts_with("vault_corrupt"))),
            "every row carries the vault error: {:?}",
            rows.iter().map(|row| &row.vault_error).collect::<Vec<_>>()
        );
    }

    #[test]
    fn an_outcome_with_nothing_to_say_carries_no_detail() {
        assert_eq!(ProbeOutcome::missing(), ProbeOutcome::default());
        assert!(!ProbeOutcome::missing().connected);

        let found = ProbeOutcome::found("  1.2.3  ");
        assert!(found.connected);
        assert_eq!(found.detail.as_deref(), Some("1.2.3"));
        assert_eq!(ProbeOutcome::found("   ").detail, None);
    }

    #[test]
    fn a_health_payload_gives_up_its_version_or_nothing() {
        assert_eq!(
            version_of("{\"version\":\"0.5.1\"}").as_deref(),
            Some("0.5.1")
        );
        assert_eq!(
            version_of("{\"build\":\"2026.8\"}").as_deref(),
            Some("2026.8")
        );
        assert_eq!(version_of("{\"status\":\"ok\"}"), None);
        assert_eq!(version_of("{\"version\":\"  \"}"), None);
        assert_eq!(version_of("<!doctype html>"), None);
        assert_eq!(first_line("claude 1.2.3\nextra\n"), "claude 1.2.3");
        assert_eq!(first_line("   "), "");
    }

    #[test]
    fn a_provider_that_is_not_installed_is_simply_missing() {
        let spec = ProviderSpec {
            id: "claude",
            name: "Claude Code",
            kind: KIND_SUBSCRIPTION,
            probe: Probe::Cli(CliProbe {
                // A name nothing on any machine answers to.
                binary: "projecta-not-a-real-binary",
                auth_args: &[],
                auth_files: &[],
            }),
        };
        assert_eq!(SystemProbe.probe(&spec, false), ProbeOutcome::missing());
    }

    #[test]
    fn an_endpoint_that_is_not_listening_is_missing() {
        // Bound to claim the port, then dropped: nothing answers there.
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind");
        let port = listener.local_addr().expect("addr").port();
        drop(listener);
        assert_eq!(probe_http(port, "/api/version"), ProbeOutcome::missing());
    }

    #[test]
    fn a_local_server_reports_the_version_it_answers_with() {
        let (addr, _requests) = serve(200, "{\"version\":\"0.5.1\"}");
        let outcome = probe_http(addr.port(), "/api/version");
        assert!(outcome.connected);
        assert_eq!(outcome.detail.as_deref(), Some("0.5.1"));
    }

    #[test]
    fn a_server_that_answers_without_a_version_is_still_online() {
        let (addr, _requests) = serve(200, "not json");
        let outcome = probe_http(addr.port(), "/health");
        assert!(outcome.connected);
        assert_eq!(outcome.detail.as_deref(), Some("online"));
    }

    #[test]
    fn a_server_that_refuses_the_route_is_missing() {
        let (addr, _requests) = serve(404, "");
        assert_eq!(
            probe_http(addr.port(), "/api/version"),
            ProbeOutcome::missing()
        );
    }

    // -- the omniroute push ------------------------------------------------

    #[test]
    fn keys_are_not_pushed_to_an_unidentified_listener() {
        let (addr, requests) = serve(200, "{}");
        let omni = OmniRoute::new(addr);
        assert!(
            omni.probe_once(),
            "a 200 health reply does not establish trust"
        );
        let dir = TempDir::new("omni-no-key-push");
        let vault = vault(&dir);
        vault.set("openrouter", "sk-or-test-canary").expect("set");
        vault
            .set(OMNIROUTE_MANAGEMENT, "management-canary")
            .expect("set");
        assert!(!sync_keys_to_omniroute(&omni, &vault, KeySync::Off));
        assert!(requests
            .try_iter()
            .all(|request| !request.starts_with("POST")));
        assert_eq!(
            vault.get("openrouter").as_deref(),
            Some("sk-or-test-canary")
        );
    }

    /// F-SEC-4 opt-in (W1-24b): with the user's consent the sync does what it
    /// did before W1-24 - one POST carrying every provider key, and never the
    /// router's own logins.
    #[test]
    fn an_opted_in_sync_hands_an_online_router_the_stored_keys() {
        let (addr, requests) = serve(200, "{\"ok\":true}");
        let omni = OmniRoute::new(addr);
        assert!(omni.probe_once(), "the fake router answers /health");

        let dir = TempDir::new("omni-optin-push");
        let vault = vault(&dir);
        vault
            .set("openrouter", "sk-or-test-placeholder")
            .expect("set");
        vault
            .set(OMNIROUTE_MANAGEMENT, "management-placeholder")
            .expect("set");
        vault
            .set(crate::freetier::VAULT_ID, "freetier-placeholder")
            .expect("set");

        assert!(sync_keys_to_omniroute(&omni, &vault, KeySync::OptedIn));
        let posted = requests
            .try_iter()
            .find(|request| request.starts_with("POST"))
            .expect("a POST reached the router");
        assert!(posted.contains("/api/v1/providers"), "first config route");
        assert!(posted.contains("openrouter"), "provider id in the body");
        assert!(
            posted.contains("sk-or-test-placeholder"),
            "provider key in the body"
        );
        assert!(
            !posted.contains("management-placeholder"),
            "the management token is not a provider key"
        );
        assert!(
            !posted.contains("freetier-placeholder"),
            "the router's own login is not a provider key"
        );
    }

    #[test]
    fn an_opted_in_sync_with_only_router_logins_pushes_nothing() {
        let (addr, requests) = serve(200, "{\"ok\":true}");
        let omni = OmniRoute::new(addr);
        assert!(omni.probe_once());

        let dir = TempDir::new("omni-optin-logins-only");
        let vault = vault(&dir);
        vault
            .set(OMNIROUTE_MANAGEMENT, "management-placeholder")
            .expect("set");
        vault
            .set(crate::freetier::VAULT_ID, "freetier-placeholder")
            .expect("set");

        assert!(!sync_keys_to_omniroute(&omni, &vault, KeySync::OptedIn));
        // `try_iter` and not `iter`: the sender lives in the server thread and
        // never hangs up.
        assert!(
            !requests
                .try_iter()
                .any(|request| request.starts_with("POST")),
            "nothing was left to push, so nothing should have been sent"
        );
    }

    #[test]
    fn an_opted_in_sync_steps_over_a_router_without_config_routes() {
        // Health answers, the config routes do not - which is what a build
        // without them looks like from here.
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind");
        let addr = listener.local_addr().expect("addr");
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let head = String::from_utf8_lossy(&buf[..n]).into_owned();
                let response = if head.starts_with("GET") {
                    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"
                } else {
                    "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                };
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });

        let omni = OmniRoute::new(addr);
        assert!(omni.probe_once());

        let dir = TempDir::new("omni-optin-404");
        let vault = vault(&dir);
        vault.set("openrouter", "sk-test-placeholder").expect("set");
        assert!(
            !sync_keys_to_omniroute(&omni, &vault, KeySync::OptedIn),
            "no route took it"
        );
    }

    /// The consent lives in the settings table. A fresh install - and every
    /// install from before the setting existed - has no row, which is off;
    /// only an explicit `"1"` written by the toggle is consent.
    #[tokio::test]
    async fn the_key_sync_setting_defaults_to_off_and_survives_a_round_trip() {
        let dir = TempDir::new("omni-key-sync-setting");
        let store = Store::open(&dir.path().join("projecta.db"))
            .await
            .expect("open store");

        assert!(
            !key_sync_enabled(&store).await,
            "no row must mean no key sync"
        );

        set_key_sync_enabled(&store, true).await.expect("enable");
        assert!(key_sync_enabled(&store).await, "the opt-in sticks");

        set_key_sync_enabled(&store, false).await.expect("disable");
        assert!(!key_sync_enabled(&store).await, "the opt-out sticks");

        for value in ["", "0", "true", "yes", " 1", "on"] {
            store
                .set_setting(SETTING_OMNIROUTE_KEY_SYNC, value)
                .await
                .expect("write raw");
            assert!(
                !key_sync_enabled(&store).await,
                "only an explicit \"1\" is consent, not {value:?}"
            );
        }
    }

    #[test]
    fn nothing_is_pushed_to_a_router_that_is_not_there() {
        let dir = TempDir::new("omni-offline");
        let vault = vault(&dir);
        vault.set("openrouter", "sk-secret").expect("set");

        let offline = OmniRoute::default();
        assert!(!offline.is_online());
        assert!(!sync_keys_to_omniroute(&offline, &vault, KeySync::OptedIn));
    }

    #[test]
    fn an_online_router_with_an_empty_vault_is_left_alone() {
        let (addr, requests) = serve(200, "{}");
        let omni = OmniRoute::new(addr);
        assert!(omni.probe_once());

        let dir = TempDir::new("omni-empty");
        let vault = vault(&dir);
        assert!(!sync_keys_to_omniroute(&omni, &vault, KeySync::OptedIn));
        assert!(
            !requests
                .try_iter()
                .any(|request| request.starts_with("POST")),
            "an empty vault has nothing to say"
        );
    }

    // -- usage -------------------------------------------------------------

    #[test]
    fn claude_usage_comes_from_the_statusline_hook() {
        let dir = TempDir::new("overview-usage-claude");
        let vault = vault(&dir);
        let quota = QuotaTracker::default();
        let engine = StatusEngine::default();

        // Register a running Claude worker before the statusLine arrives.
        engine.observe_worker(&crate::store::Worker {
            id: "wk-claude".to_string(),
            project_id: "pj-1".to_string(),
            task: "task".to_string(),
            profile_id: "claude".to_string(),
            branch: "pa/wk-claude".to_string(),
            worktree_path: "C:/tmp/wk-claude".to_string(),
            session_id: None,
            status: crate::store::STATUS_RUNNING.to_string(),
            kind: crate::store::KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            paused_reason: None,
            created_at: 1,
        });

        engine.note_statusline(
            "wk-claude",
            r#"{"rate_limits":{"five_hour":{"used_percentage":87,"resets_at":1787793000}},"context_window":{"context_window_size":1000000,"current_usage":{"input_tokens":500000,"cache_creation_input_tokens":20000,"cache_read_input_tokens":42000}}}"#,
        );

        let rows = overview(&FakeProbe::default(), &vault, &quota, &engine);
        let claude = row(&rows, "claude");
        let usage = claude.usage.expect("claude usage");
        assert_eq!(usage.percent, Some(87));
        assert_eq!(usage.used.as_deref(), Some("562,0 k Tokens"));
        assert_eq!(usage.limit.as_deref(), Some("1,0 M Tokens"));
        assert_eq!(usage.window_label, "5-Stunden-Fenster");
        assert_eq!(usage.resets_at, Some(1_787_793_000));
        assert_eq!(usage.source, "hook");
    }

    #[test]
    fn statusline_without_rate_limits_leaves_usage_unknown() {
        let dir = TempDir::new("overview-usage-no-ratelimits");
        let vault = vault(&dir);
        let quota = QuotaTracker::default();
        let engine = StatusEngine::default();
        engine.observe_worker(&crate::store::Worker {
            id: "wk-claude".to_string(),
            project_id: "pj-1".to_string(),
            task: "task".to_string(),
            profile_id: "claude".to_string(),
            branch: "pa/wk-claude".to_string(),
            worktree_path: "C:/tmp/wk-claude".to_string(),
            session_id: None,
            status: crate::store::STATUS_RUNNING.to_string(),
            kind: crate::store::KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            paused_reason: None,
            created_at: 1,
        });
        engine.note_statusline(
            "wk-claude",
            r#"{"context_window":{"context_window_size":1000000,"current_usage":null}}"#,
        );

        let rows = overview(&FakeProbe::default(), &vault, &quota, &engine);
        assert!(row(&rows, "claude").usage.is_none());
    }

    #[test]
    fn ollama_reports_local_usage() {
        let dir = TempDir::new("overview-usage-ollama");
        let vault = vault(&dir);
        let quota = QuotaTracker::default();
        let engine = StatusEngine::default();

        let rows = overview(&FakeProbe::default(), &vault, &quota, &engine);
        let ollama = row(&rows, "ollama");
        let usage = ollama.usage.expect("ollama usage");
        assert_eq!(usage.source, "local");
        assert_eq!(usage.window_label, "lokal — kein Kontingent");
        assert!(usage.percent.is_none());
        assert!(usage.used.is_none());
        assert!(usage.limit.is_none());
    }

    #[test]
    fn providers_without_a_source_have_no_usage() {
        let dir = TempDir::new("overview-usage-none");
        let vault = vault(&dir);
        let quota = QuotaTracker::default();
        let engine = StatusEngine::default();

        let rows = overview(&FakeProbe::default(), &vault, &quota, &engine);
        assert!(row(&rows, "codex").usage.is_none());
        assert!(row(&rows, "kimi").usage.is_none());
        assert!(row(&rows, "opencode").usage.is_none());
        assert!(row(&rows, "omniroute").usage.is_none());
    }

    #[test]
    fn openrouter_percent_is_usage_over_limit() {
        // The real /key response nests the key facts under "data".
        let usage = parse_openrouter_body(
            r#"{"data":{"limit":1000.0,"limit_remaining":250.0,"usage":750.0,"is_free_tier":false}}"#,
        )
        .expect("parses");
        assert_eq!(usage.percent, Some(75));
        assert_eq!(usage.used.as_deref(), Some("$750.00"));
        assert_eq!(usage.limit.as_deref(), Some("$1000.00"));
        assert_eq!(usage.source, "api");
    }

    #[test]
    fn openrouter_with_null_limit_reports_used_without_percent() {
        let usage = parse_openrouter_body(
            r#"{"data":{"limit":null,"limit_remaining":null,"usage":1300000.0,"is_free_tier":true}}"#,
        )
        .expect("parses");
        assert!(usage.percent.is_none());
        assert_eq!(usage.used.as_deref(), Some("$1300000.00"));
        assert!(usage.limit.is_none());
    }

    #[test]
    fn openrouter_with_a_zero_limit_does_not_fabricate_a_zero_percent() {
        // The null-limit case above reports "used without percent": no limit
        // means no meaningful percentage. A *zero* limit is the same fact on
        // the wire (OpenRouter's "no cap"), but `0.0 / 0.0` is NaN, casts to
        // `0`, slips through `p <= 100`, and fabricates `Some(0)` - a number
        // the API never reported, on a line that also claims `$0.00`.
        let usage = parse_openrouter_body(
            r#"{"data":{"limit":0.0,"limit_remaining":null,"usage":0.0,"is_free_tier":true}}"#,
        )
        .expect("parses");
        assert!(
            usage.percent.is_none(),
            "a zero limit must not read as a fabricated 0% used"
        );
        assert_eq!(usage.percent, None);
    }

    #[test]
    fn a_response_without_the_data_envelope_reports_nothing() {
        // A flat object, an error body or HTML must not render as numbers.
        assert!(parse_openrouter_body(r#"{"limit":10.0,"usage":3.0}"#).is_none());
        assert!(parse_openrouter_body(r#"{"data":null}"#).is_none());
        assert!(parse_openrouter_body("Internal Server Error").is_none());
    }
}
