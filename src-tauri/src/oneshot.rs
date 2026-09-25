//! One-shot headless runs of a bundled skill.
//!
//! Several features in ProjectA are the same shape: take one instruction, hand
//! it to a headless coding agent that has one *bundled skill* available, and
//! read back what it printed. Prompt enhancement was the first
//! ([`crate::enhance`]); the learning critic ([`crate::critic`]) is the second.
//! What they share lives here.
//!
//! The run itself is one child process:
//!
//! ```text
//! claude -p --add-dir <workspace> --output-format text  < the instruction
//! ```
//!
//! A skill is only discoverable through a `.claude/skills/<name>/` directory,
//! and ProjectA must not touch the user's own `~/.claude`. So every call builds
//! a throwaway workspace:
//!
//! ```text
//! <temp>/projecta-oneshot-<random>/.claude/skills/<name>/SKILL.md
//!                                                        references/...
//! ```
//!
//! hands it to `--add-dir`, and deletes the whole thing on the way out.
//!
//! Nothing here is best-effort: a missing CLI, a failing run and a run that
//! never finishes each become an error string a caller can show verbatim. What
//! a caller *does* with that error - surface it, or log it and move on - is the
//! caller's decision, not this module's.
//!
//! ## Shared plumbing
//!
//! Three helpers here are used by the rest of the app rather than only by a
//! one-shot run: [`random_hex`], [`make_private`], and the pair
//! [`detach_process_group`] / [`ProcessTree`]. They live in this module
//! because a one-shot run needs all of them anyway, and because the other two
//! users - the test gate and the hook receiver - sit *above* this module, so
//! the dependency points the right way round. A module of its own would be a
//! lot of ceremony for fifty lines.

use std::ffi::OsString;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

/// The CLI that runs a bundled skill headlessly.
pub const CLAUDE_BIN: &str = "claude";

/// How often the child is checked while waiting for it.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// Files the run reads from and writes to, inside the workspace.
const PROMPT_FILE: &str = "instruction.txt";
const STDOUT_FILE: &str = "stdout.txt";
const STDERR_FILE: &str = "stderr.txt";

// -- shared plumbing -------------------------------------------------------

/// A 128 bit random hex string, for names and secrets that must not be
/// guessable from outside this process.
///
/// Drawn from the operating system's random source - the same CSPRNG
/// [`crate::api`] insists on for its token, and for the same reason: the
/// construction this replaced mixed the clock, the process id and a counter
/// through two `RandomState` hashers, whose inputs are all guessable and whose
/// whole entropy was the one OS seed `std` hands the process. A hook secret is
/// the key to a worker's message log; a key that can be precomputed is not
/// one.
///
/// A failing random source is a panic, not a fallback: `api::new_token`
/// aborts startup over it, and here there is no startup to abort, so loud is
/// the only honest failure mode left.
pub fn random_hex() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("the OS random source failed");
    format!("{:032x}", u128::from_be_bytes(bytes))
}

/// Narrow `path` to its owner on unix; a no-op elsewhere.
///
/// The temp directories this app creates hold an instruction, a run's output,
/// and - since the hook receiver got a secret - a key to one worker's message
/// log. On Windows the per-user temp directory already says that; on unix the
/// default umask does not, so the mode is set explicitly.
///
/// Best effort: a directory that cannot be narrowed is still usable, and
/// failing a run over it would trade a working feature for a hardening step.
pub fn make_private(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if path.is_dir() { 0o700 } else { 0o600 };
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// The fail-closed sibling of [`make_private`] for credential directories: a
/// key directory whose mode cannot be set must abort the issuance, not sail
/// on group-readable.
#[cfg(unix)]
pub fn make_private_checked(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mode = if path.is_dir() { 0o700 } else { 0o600 };
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
        .map_err(|e| format!("failed to narrow {}: {e}", path.display()))
}

/// Put `command`'s child in a process group of its own, so that a later
/// [`ProcessTree::kill`] can end the group instead of only its leader.
///
/// A no-op on Windows, where a job object takes over that role instead (see
/// [`ProcessTree::attach`]) and no group has to be arranged in advance.
pub fn detach_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // 0 means "a new group whose id is the child's pid", which is what
        // makes `kill -<pid>` below address exactly this run.
        command.process_group(0);
    }
    #[cfg(not(unix))]
    let _ = command;
}

/// A process tree whose lifetime belongs to one app operation.
///
/// On Windows this is a job object. A process assigned to a job brings every
/// child it starts into that job, including `cmd /C start /B`, which no longer
/// has to remain a child by the time a timeout fires. On Unix the process group
/// set by [`detach_process_group`] is the equivalent mechanism.
pub struct ProcessTree {
    #[cfg(windows)]
    job: Option<windows_sys::Win32::Foundation::HANDLE>,
}

impl ProcessTree {
    /// Attach immediately after spawn, before the interpreter can start a
    /// worker that would otherwise escape a parent-PID walk.
    pub fn attach(child: &Child) -> Self {
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::Foundation::CloseHandle;
            use windows_sys::Win32::System::JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            };

            let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if job.is_null() {
                return Self { job: None };
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = unsafe {
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                ) != 0
            };
            let assigned = configured
                && unsafe { AssignProcessToJobObject(job, child.as_raw_handle() as _) != 0 };
            if !assigned {
                unsafe { CloseHandle(job) };
                return Self { job: None };
            }
            Self { job: Some(job) }
        }
        #[cfg(not(windows))]
        {
            let _ = child;
            Self {}
        }
    }

    /// End the process and every child assigned to this operation, then reap
    /// the interpreter. If a job could not be assigned (for example an older
    /// restricted Windows host), keep the prior `taskkill` fallback.
    pub fn kill(&mut self, child: &mut Child) {
        #[cfg(windows)]
        {
            use windows_sys::Win32::Foundation::CloseHandle;
            use windows_sys::Win32::System::JobObjects::TerminateJobObject;

            if let Some(job) = self.job.take() {
                unsafe {
                    TerminateJobObject(job, 1);
                    CloseHandle(job);
                }
            } else {
                let _ = crate::proc::command("taskkill")
                    .args(["/T", "/F", "/PID", &child.id().to_string()])
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
        }
        #[cfg(unix)]
        {
            // The `--` matters: procps' `/usr/bin/kill` reads a bare `-<pid>` as
            // more options and silently aims at the wrong process group (the bash
            // builtin parses the same line correctly, which is why hand-testing
            // this in a shell looks fine). With `--` the negative pid is parsed
            // as a pid again - and a negative pid means the group.
            let _ = crate::proc::command("kill")
                .args(["-9", "--", &format!("-{}", child.id())])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }

        // The interpreter itself, in case the helper never ran, plus the reap that
        // keeps it from lingering as a zombie.
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        if let Some(job) = self.job.take() {
            unsafe { windows_sys::Win32::Foundation::CloseHandle(job) };
        }
    }
}

// -- the bundled skill -----------------------------------------------------

/// Where a bundled skill lives in a source checkout.
pub fn dev_skill_dir(skill_name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(skill_name)
}

/// A directory is the skill if it has the `SKILL.md` the CLI reads.
fn is_skill_dir(path: &Path) -> bool {
    path.join("SKILL.md").is_file()
}

/// Locate a bundled skill: the installed copy first, the checkout second.
///
/// `tauri.conf.json` bundles `resources/<name>/**/*`, and Tauri keeps that
/// relative layout under the resource directory, so the installed copy is
/// `<resources>/resources/<name>`.
pub fn bundled_skill_dir(app: &AppHandle, skill_name: &str) -> Result<PathBuf, String> {
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("resources").join(skill_name);
        if is_skill_dir(&bundled) {
            return Ok(bundled);
        }
    }

    let dev = dev_skill_dir(skill_name);
    if is_skill_dir(&dev) {
        return Ok(dev);
    }

    Err(format!(
        "the bundled {skill_name} skill is missing; ProjectA cannot run it"
    ))
}

// -- the throwaway workspace -----------------------------------------------

/// A temp directory holding one copy of a skill, deleted when dropped.
pub struct SkillWorkspace {
    path: PathBuf,
    skill_name: String,
    /// Where the packs go inside [`Self::path`], as the runner's capability
    /// named it. Held rather than recomputed so [`Self::skill_path`] cannot
    /// drift from the directory `create` actually wrote to.
    skills_root: PathBuf,
}

impl SkillWorkspace {
    /// Copy `skill_src` into a fresh `<temp>/projecta-oneshot-<random>`
    /// workspace, laid out the way the CLI discovers skills.
    ///
    /// The name is random rather than `<pid>-<n>`: the instruction handed to
    /// the agent can carry a worker's diff and message log, and a predictable
    /// path is one another local process can sit and wait for.
    /// `skills` is the runner's own capability: where that CLI reads packs.
    /// `.claude/skills` for the conventional ones, its own directory for a
    /// runner that reads somewhere else (`ConventionAt`), and the conventional
    /// place for a CLI that reads none at all - a one-shot exists to run a
    /// skill, so there is no "copy nothing" case here, only a place to put it.
    /// A directory that would leave the workspace is an error: `create` calls
    /// `remove_dir_all` on it, and for `ConventionAt` the value is user input
    /// from `agents.json`.
    pub fn create(
        skill_name: &str,
        skill_src: &Path,
        skills: &crate::capabilities::SkillsDiscovery,
    ) -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!("projecta-oneshot-{}", random_hex()));

        // A leftover from a crashed run must not poison this one.
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path)
            .map_err(|e| format!("failed to create {}: {e}", path.display()))?;
        // Narrowed to the owner before anything is written into it: the
        // instruction handed to the agent can carry a worker's diff.
        make_private(&path);
        // The containment check resolves symlinks, so the root has to exist
        // before it is asked - hence the directory above this line.
        let skills_root = resolve_skills_root(&path, skills)?;
        let workspace = Self {
            path,
            skill_name: skill_name.to_string(),
            skills_root,
        };

        let dest = workspace.skill_path();
        std::fs::create_dir_all(&dest)
            .map_err(|e| format!("failed to create {}: {e}", dest.display()))?;
        copy_dir_all(skill_src, &dest)?;
        Ok(workspace)
    }

    /// The directory handed to `--add-dir`.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Where the skill itself ends up: `<skills root>/<name>`, and the root is
    /// whatever the runner's capability named (`.claude/skills` by convention).
    pub fn skill_path(&self) -> PathBuf {
        self.skills_root.join(&self.skill_name)
    }
}

/// Where the packs go for this runner, or an error. `create` has already made
/// `path` when it asks, and a refused capability leaves no `SkillWorkspace`
/// whose `Drop` would clean up - so the error path removes the root itself.
fn resolve_skills_root(
    path: &Path,
    skills: &crate::capabilities::SkillsDiscovery,
) -> Result<PathBuf, String> {
    match crate::skills::skills_path_for(path, skills) {
        Ok(dest) => Ok(dest
            .map(|dest| dest.path().to_path_buf())
            .unwrap_or_else(|| path.join(".claude").join("skills"))),
        Err(err) => {
            // No SkillWorkspace is constructed on this path, so its Drop
            // cannot clean up the root created above - the error has to.
            let _ = std::fs::remove_dir_all(path);
            Err(err)
        }
    }
}

impl Drop for SkillWorkspace {
    fn drop(&mut self) {
        // Best effort: a leftover temp directory must not fail a run that
        // otherwise worked.
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Copy `src` into `dest` recursively, creating directories as needed.
fn copy_dir_all(src: &Path, dest: &Path) -> Result<(), String> {
    let entries =
        std::fs::read_dir(src).map_err(|e| format!("failed to read {}: {e}", src.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read {}: {e}", src.display()))?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if from.is_dir() {
            std::fs::create_dir_all(&to)
                .map_err(|e| format!("failed to create {}: {e}", to.display()))?;
            copy_dir_all(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)
                .map_err(|e| format!("failed to copy {}: {e}", from.display()))?;
        }
    }
    Ok(())
}

// -- running the CLI -------------------------------------------------------

/// The arguments the runner CLI gets, after any platform shim prefix. A
/// runner that needs a flag to find skills is pointed at the workspace copy;
/// claude finds it by convention and gets the plain set.
pub fn skill_args(
    workspace: &Path,
    skills: &crate::capabilities::SkillsDiscovery,
) -> Vec<OsString> {
    let mut args = vec![
        OsString::from("-p"),
        OsString::from("--add-dir"),
        workspace.as_os_str().to_os_string(),
        OsString::from("--output-format"),
        OsString::from("text"),
    ];
    if let crate::capabilities::SkillsDiscovery::Flag { flag } = skills {
        args.push(OsString::from(flag));
        args.push(workspace.join(".claude").join("skills").into_os_string());
    }
    args
}

/// Split `program` into the executable to run and any arguments in front of
/// ours.
///
/// On Windows the CLI is usually an npm shim (`claude.cmd`), which
/// `CreateProcess` cannot execute directly. The same resolution the PTY layer
/// does is used here - [`crate::pty::windows_invocation`] reads the shim and
/// hands back the interpreter it would have started, falling back to
/// `%COMSPEC% /C` only for a shim it cannot read - so this path has the same
/// answer to the same question rather than a second, differently broken one.
///
/// It matters here for the same reason it matters there: the instruction this
/// module runs carries a worker's diff and message log, and while that travels
/// on stdin, the workspace path on the command line still goes through
/// whatever parser sits in front of the CLI.
///
/// An unresolvable name is handed over untouched, so the spawn fails with the
/// usual not-found error.
#[cfg(windows)]
fn program_invocation(program: &str) -> (OsString, Vec<OsString>) {
    let Some(path) = crate::pty::resolve_windows_program(program) else {
        return (OsString::from(program), Vec::new());
    };
    let (exe, prefix) = crate::pty::windows_invocation(&path);
    (exe.into_os_string(), prefix)
}

#[cfg(not(windows))]
fn program_invocation(program: &str) -> (OsString, Vec<OsString>) {
    (OsString::from(program), Vec::new())
}

/// Run `program` over `workspace` with `instruction` on stdin, and return what
/// it printed.
///
/// `program` is a parameter rather than [`CLAUDE_BIN`] so the tests can point
/// it at a name that is definitely not installed and check the error, without
/// ever invoking the real CLI.
pub fn run_claude(
    program: &str,
    workspace: &Path,
    instruction: &str,
    timeout: Duration,
    skills: &crate::capabilities::SkillsDiscovery,
) -> Result<String, String> {
    let stdin_path = workspace.join(PROMPT_FILE);
    let stdout_path = workspace.join(STDOUT_FILE);
    let stderr_path = workspace.join(STDERR_FILE);

    // The instruction goes through a file, not a pipe: a long input would
    // otherwise deadlock against a full pipe buffer while we wait for the exit.
    std::fs::write(&stdin_path, instruction)
        .map_err(|e| format!("failed to write {}: {e}", stdin_path.display()))?;

    let (exe, prefix) = program_invocation(program);
    let mut command = crate::proc::command(exe);
    command
        .args(prefix)
        .args(skill_args(workspace, skills))
        .current_dir(workspace)
        .stdin(Stdio::from(open_read(&stdin_path)?))
        .stdout(Stdio::from(create(&stdout_path)?))
        .stderr(Stdio::from(create(&stderr_path)?));
    // Arranged before the spawn, because the timeout below can only end a
    // group that already exists when the child starts.
    detach_process_group(&mut command);

    let mut child = command.spawn().map_err(|e| spawn_error(program, &e))?;
    let mut tree = ProcessTree::attach(&child);

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(e) => return Err(format!("failed to wait for {program}: {e}")),
        }
        if started.elapsed() >= timeout {
            // The whole tree, not just the interpreter: the agent underneath it
            // would otherwise keep running - and keep working inside the
            // workspace the caller deletes the moment this returns.
            tree.kill(&mut child);
            return Err(format!(
                "{program} did not finish within {}s",
                timeout.as_secs()
            ));
        }
        std::thread::sleep(POLL_INTERVAL);
    };

    let stdout = read_trimmed(&stdout_path);
    if !status.success() {
        let stderr = read_trimmed(&stderr_path);
        let detail = [stderr, stdout]
            .into_iter()
            .find(|s| !s.is_empty())
            .unwrap_or_else(|| format!("exited with {status}"));
        return Err(format!("{program} failed: {detail}"));
    }
    if stdout.is_empty() {
        // A run that printed nothing is a broken run, not a terse one: the CLI
        // always echoes *something* when it worked. Callers that can live with
        // an empty answer decide that themselves, on the error.
        return Err(format!("{program} returned no output"));
    }
    Ok(stdout)
}

/// Turn a failed spawn into something the user can act on.
fn spawn_error(program: &str, err: &std::io::Error) -> String {
    if err.kind() == std::io::ErrorKind::NotFound {
        return format!(
            "{program} was not found on the PATH; install the Claude CLI to run bundled skills"
        );
    }
    format!("failed to run {program}: {err}")
}

fn open_read(path: &Path) -> Result<File, String> {
    File::open(path).map_err(|e| format!("failed to open {}: {e}", path.display()))
}

fn create(path: &Path) -> Result<File, String> {
    File::create(path).map_err(|e| format!("failed to create {}: {e}", path.display()))
}

/// Read a captured stream, or an empty string if it is unreadable.
fn read_trimmed(path: &Path) -> String {
    std::fs::read(path)
        .map(|bytes| String::from_utf8_lossy(&bytes).trim().to_string())
        .unwrap_or_default()
}

// -- the whole job ---------------------------------------------------------

/// Run `instruction` through a headless Claude with `skill_name` available,
/// and return its stdout.
///
/// Builds a workspace around `skill_src`, runs the CLI, cleans up. Blocking,
/// and for up to `timeout`: callers hand this to a blocking thread rather than
/// running it on the one serving the UI.
///
/// The cleanup is the `SkillWorkspace` drop at the end of this function, which
/// is deliberately *after* [`run_claude`] returns: a timed-out run ends its
/// process tree before it hands control back, so the directory is never pulled
/// out from under a process that is still reading it.
pub fn run(
    skill_src: &Path,
    skill_name: &str,
    instruction: &str,
    timeout: Duration,
) -> Result<String, String> {
    // The registry is the single source for how a CLI is invoked; the const is
    // only the fallback for the impossible case of a missing default profile.
    // It is read before the workspace is built, because where the packs go is
    // the runner's business (W1-18).
    let runner = crate::profiles::find_profile("claude");
    let (program, skills) = match &runner {
        Some(p) => (p.command.as_str(), p.caps.skills.clone()),
        None => (CLAUDE_BIN, crate::capabilities::SkillsDiscovery::Convention),
    };
    let workspace = SkillWorkspace::create(skill_name, skill_src, &skills)?;
    run_claude(program, workspace.path(), instruction, timeout, &skills)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;
    use std::ffi::OsStr;

    /// A name no PATH entry can plausibly contain.
    const MISSING_BIN: &str = "projecta-not-a-real-claude-binary";

    /// Write a stand-in skill so the layout tests never depend on a real one.
    fn fake_skill(root: &Path) -> PathBuf {
        let src = root.join("bundled");
        std::fs::create_dir_all(src.join("references")).expect("mkdir");
        std::fs::write(src.join("SKILL.md"), "---\nname: fake\n---\n").expect("write");
        std::fs::write(src.join("references").join("patterns.md"), "patterns").expect("write");
        src
    }

    #[test]
    fn the_repository_ships_the_skills_it_bundles() {
        // The dev lookup and `tauri.conf.json` both point here, so an empty or
        // renamed resource directory has to fail loudly.
        for skill in ["prompt-master", "learning-critic"] {
            let dev = dev_skill_dir(skill);
            assert!(is_skill_dir(&dev), "{} has no SKILL.md", dev.display());
        }
        assert!(dev_skill_dir("prompt-master").join("references").is_dir());
    }

    #[test]
    fn the_workspace_puts_the_skill_where_the_cli_looks_for_it() {
        let dir = TempDir::new("oneshot-layout");
        let src = fake_skill(dir.path());

        let workspace = SkillWorkspace::create(
            "prompt-master",
            &src,
            &crate::capabilities::SkillsDiscovery::Convention,
        )
        .expect("workspace");
        let root = workspace.path().to_path_buf();

        assert!(root
            .file_name()
            .and_then(OsStr::to_str)
            .is_some_and(|n| n.starts_with("projecta-oneshot-")));

        let skill = root.join(".claude").join("skills").join("prompt-master");
        assert_eq!(workspace.skill_path(), skill);
        assert!(skill.join("SKILL.md").is_file(), "SKILL.md did not land");
        // Subdirectories come along, or half the skill is missing.
        assert_eq!(
            std::fs::read_to_string(skill.join("references").join("patterns.md")).unwrap(),
            "patterns"
        );

        drop(workspace);
        assert!(!root.exists(), "{} should be gone", root.display());
    }

    #[test]
    fn the_workspace_is_named_after_the_skill_it_carries() {
        let dir = TempDir::new("oneshot-name");
        let src = fake_skill(dir.path());

        let workspace = SkillWorkspace::create(
            "learning-critic",
            &src,
            &crate::capabilities::SkillsDiscovery::Convention,
        )
        .expect("workspace");
        assert!(workspace.skill_path().ends_with("learning-critic"));
        assert!(workspace.skill_path().join("SKILL.md").is_file());
    }

    #[test]
    fn concurrent_workspaces_do_not_share_a_directory() {
        let dir = TempDir::new("oneshot-unique");
        let src = fake_skill(dir.path());

        let first = SkillWorkspace::create(
            "prompt-master",
            &src,
            &crate::capabilities::SkillsDiscovery::Convention,
        )
        .expect("first");
        let second = SkillWorkspace::create(
            "prompt-master",
            &src,
            &crate::capabilities::SkillsDiscovery::Convention,
        )
        .expect("second");
        assert_ne!(first.path(), second.path());
        assert!(first.path().join(".claude").is_dir());
        assert!(second.path().join(".claude").is_dir());
    }

    /// The workspace carries the instruction - which can hold a worker's whole
    /// diff - so its name must not be one another local process can compute in
    /// advance and wait for.
    #[test]
    fn a_workspace_name_cannot_be_derived_from_the_pid() {
        let dir = TempDir::new("oneshot-random");
        let src = fake_skill(dir.path());

        let workspace = SkillWorkspace::create(
            "prompt-master",
            &src,
            &crate::capabilities::SkillsDiscovery::Convention,
        )
        .expect("workspace");
        let name = workspace
            .path()
            .file_name()
            .and_then(OsStr::to_str)
            .expect("name")
            .to_string();

        let suffix = name
            .strip_prefix("projecta-oneshot-")
            .unwrap_or_else(|| panic!("unexpected name {name}"));
        assert_eq!(suffix.len(), 32, "{name}");
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()), "{name}");
        assert!(
            !name.contains(&std::process::id().to_string()),
            "the pid must not be part of the name: {name}"
        );
    }

    #[test]
    fn random_hex_does_not_repeat_itself() {
        let a = random_hex();
        let b = random_hex();
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()), "{a}");
        assert_ne!(a, b);
    }

    /// On unix the temp root is shared, so the workspace has to say who it
    /// belongs to. On Windows the per-user temp directory already does.
    #[cfg(unix)]
    #[test]
    fn a_workspace_is_readable_by_its_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new("oneshot-perms");
        let src = fake_skill(dir.path());
        let workspace = SkillWorkspace::create(
            "prompt-master",
            &src,
            &crate::capabilities::SkillsDiscovery::Convention,
        )
        .expect("workspace");

        let mode = std::fs::metadata(workspace.path())
            .expect("metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o700, "{mode:o}");
    }

    /// W1-18: `ConventionAt` was added for the spawn path and `oneshot` never
    /// heard about it. A user who points the `claude` profile at another
    /// directory in `agents.json` got the skill copied to `.claude/skills`
    /// while the CLI looked where the profile said - a one-shot that runs and
    /// finds nothing, with no error anywhere. The workspace follows the
    /// capability, and a place outside the workspace is refused, not bent
    /// straight: `create` deletes and writes there.
    #[test]
    fn the_workspace_follows_a_runner_that_reads_skills_elsewhere() {
        let dir = TempDir::new("oneshot-conventionat");
        let src = fake_skill(dir.path());

        let elsewhere = crate::capabilities::SkillsDiscovery::ConventionAt {
            dir: ".agents/skills".into(),
        };
        let workspace =
            SkillWorkspace::create("prompt-master", &src, &elsewhere).expect("workspace");
        let expected = workspace
            .path()
            .join(".agents")
            .join("skills")
            .join("prompt-master");
        assert_eq!(workspace.skill_path(), expected);
        assert!(expected.join("SKILL.md").is_file(), "SKILL.md did not land");
        assert!(
            !workspace.path().join(".claude").exists(),
            "nothing was written to the conventional place"
        );

        // A flag runner must point at its own populated workspace.
        let flag_capability = crate::capabilities::SkillsDiscovery::Flag {
            flag: "--skills-dir".into(),
        };
        let flag_workspace = SkillWorkspace::create("prompt-master", &src, &flag_capability)
            .expect("flag workspace");
        let rendered: Vec<String> = skill_args(flag_workspace.path(), &flag_capability)
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let at = rendered
            .iter()
            .position(|a| a == "--skills-dir")
            .expect("flag present");
        assert!(
            rendered[at + 1].ends_with(
                std::path::Path::new(".claude")
                    .join("skills")
                    .to_string_lossy()
                    .as_ref()
            ),
            "{}",
            rendered[at + 1]
        );

        assert!(Path::new(&rendered[at + 1])
            .join("prompt-master")
            .join("SKILL.md")
            .is_file());

        // A directory outside the workspace is an error, never a write.
        let escape = crate::capabilities::SkillsDiscovery::ConventionAt {
            dir: "../outside".into(),
        };
        let err = match SkillWorkspace::create("prompt-master", &src, &escape) {
            Ok(_) => panic!("a directory outside the workspace was accepted"),
            Err(err) => err,
        };
        assert!(err.contains("outside"), "{err}");
    }

    /// A refused `ConventionAt` directory errors out before `SkillWorkspace`
    /// exists, so its `Drop` never runs - the root created for the check must
    /// not be left behind for the next run to trip over.
    #[test]
    fn a_refused_skill_directory_does_not_leave_the_workspace_root_behind() {
        let base = TempDir::new("oneshot-refused-root");
        let root = base.path().join("workspace");
        std::fs::create_dir_all(&root).expect("root");
        let escape = crate::capabilities::SkillsDiscovery::ConventionAt {
            dir: "../outside".into(),
        };
        let err = resolve_skills_root(&root, &escape).expect_err("refused");
        assert!(err.contains("outside"), "{err}");
        assert!(
            !root.exists(),
            "refused workspace root was left behind: {}",
            root.display()
        );
    }

    #[test]
    fn the_argv_asks_for_a_headless_run_over_the_workspace() {
        let workspace = Path::new("C:/tmp/projecta-oneshot-1-1");
        let args: Vec<String> =
            skill_args(workspace, &crate::capabilities::SkillsDiscovery::Convention)
                .iter()
                .map(|a| a.to_string_lossy().into_owned())
                .collect();
        assert_eq!(
            args,
            vec![
                "-p",
                "--add-dir",
                &workspace.to_string_lossy(),
                "--output-format",
                "text",
            ]
        );
    }

    #[test]
    fn a_flag_discovery_runner_is_pointed_at_the_workspace_skills() {
        let args = skill_args(
            Path::new("C:/tmp/ws"),
            &crate::capabilities::SkillsDiscovery::Flag {
                flag: "--skills-dir".into(),
            },
        );
        let rendered: Vec<String> = args
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let at = rendered
            .iter()
            .position(|a| a == "--skills-dir")
            .expect("flag present");
        assert!(rendered[at + 1].ends_with("skills"), "{}", rendered[at + 1]);
    }

    #[test]
    fn a_convention_runner_gets_the_plain_args() {
        let args = skill_args(
            Path::new("C:/tmp/ws"),
            &crate::capabilities::SkillsDiscovery::Convention,
        );
        assert!(!args
            .iter()
            .any(|a| a.to_string_lossy().contains("skills-dir")));
    }

    #[test]
    fn a_missing_cli_is_a_clean_error_not_a_panic() {
        let dir = TempDir::new("oneshot-missing");
        let err = run_claude(
            MISSING_BIN,
            dir.path(),
            "instruction",
            Duration::from_secs(5),
            &crate::capabilities::SkillsDiscovery::Convention,
        )
        .expect_err("a missing binary must fail");

        assert!(err.contains(MISSING_BIN), "{err}");
        assert!(err.contains("was not found on the PATH"), "{err}");
        // The instruction was still written, so the failure is the spawn.
        assert!(dir.path().join(PROMPT_FILE).is_file());
    }

    #[test]
    fn a_missing_skill_directory_is_an_error_naming_the_skill() {
        let dir = TempDir::new("oneshot-noskill");
        let err = run(
            &dir.path().join("nowhere"),
            "learning-critic",
            "instruction",
            Duration::from_secs(5),
        )
        .expect_err("a missing skill source must fail");
        assert!(err.contains("failed to read"), "{err}");
    }

    /// The fail-closed sibling of `make_private`: it narrows a credential directory to 0o700 and reports a
    /// path it cannot narrow instead of sailing on.
    #[cfg(unix)]
    #[test]
    fn make_private_checked_narrows_a_directory_and_fails_closed() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new("oneshot-private");
        let inner = dir.path().join("agent-access");
        std::fs::create_dir(&inner).unwrap();
        std::fs::set_permissions(&inner, std::fs::Permissions::from_mode(0o755)).unwrap();
        make_private_checked(&inner).unwrap();
        assert_eq!(
            std::fs::metadata(&inner).unwrap().permissions().mode() & 0o777,
            0o700
        );
        let error = make_private_checked(&dir.path().join("missing")).unwrap_err();
        assert!(error.contains("failed to narrow"), "{error}");
    }
}
