//! Test-only helpers: throwaway directories and throwaway git repositories.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::pty::CursorReportScanner;
use crate::store::new_id;

/// A directory under the system temp dir, deleted when the guard drops.
pub struct TempDir {
    path: PathBuf,
}

impl TempDir {
    pub fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "projecta-test-{label}-{}-{}",
            std::process::id(),
            new_id("t")
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        // Best effort: a still-open sqlite or git handle must not fail a test.
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Copy a checked-in SQLite fixture (and its WAL sidecars, if any) into
/// `dest`. Same hook the production-copy probe uses: `std::fs::copy` before
/// [`crate::store::Store::open`], never open the original.
pub fn copy_db_fixture(source: &Path, dest: &Path) {
    std::fs::copy(source, dest)
        .unwrap_or_else(|err| panic!("copy {} -> {}: {err}", source.display(), dest.display()));
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{suffix}", source.display()));
        if sidecar.is_file() {
            let dest_name = dest.file_name().expect("dest has a name").to_string_lossy();
            std::fs::copy(
                &sidecar,
                dest.with_file_name(format!("{dest_name}{suffix}")),
            )
            .unwrap_or_else(|err| panic!("copy {} -> WAL sidecar: {err}", sidecar.display()));
        }
    }
}

/// Create a git repository at `path` with one empty commit, so that
/// `git worktree add -b` has a HEAD to branch from.
///
/// Identity and hooks are pinned on the command line, so the result does not
/// depend on the developer's global git configuration.
pub fn init_repo(path: &Path) -> PathBuf {
    std::fs::create_dir_all(path).expect("create repo dir");
    run_git(path, &["init", "-b", "main"]);
    run_git(path, &["config", "user.name", "ProjectA Test"]);
    run_git(path, &["config", "user.email", "test@projecta.invalid"]);
    run_git(
        path,
        &["commit", "--allow-empty", "--no-gpg-sign", "-m", "init"],
    );
    path.to_path_buf()
}

fn run_git(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd.as_os_str())
        .args(args.iter().map(OsStr::new))
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

// Capture artifacts deliberately outlive the harness for inspection.
fn capture_workspace(parent: &Path, label: &str) -> PathBuf {
    let path = parent.join(format!(
        "projecta-capture-{label}-{}-{}",
        std::process::id(),
        new_id("capture")
    ));
    std::fs::create_dir(&path).expect("create fresh capture workspace");
    path
}

#[test]
fn capture_workspaces_are_fresh_for_repeated_runs() {
    let root = TempDir::new("capture-workspace-regression");
    for provider in ["claude", "kimi"] {
        let first = capture_workspace(root.path(), provider);
        std::fs::write(first.join("probe.txt"), "stale result").unwrap();
        let second = capture_workspace(root.path(), provider);
        assert_ne!(first, second, "{provider} reused a capture workspace");
        assert!(!second.join("probe.txt").exists());
        assert!(first.join("probe.txt").exists(), "retain previous evidence");
    }
}

#[test]
fn capture_cursor_queries_survive_every_chunk_boundary() {
    let query = b"\x1b[6n";
    for split in 1..query.len() {
        let mut scanner = CursorReportScanner::default();
        assert_eq!(scanner.feed(&query[..split]), 0);
        assert_eq!(scanner.feed(&query[split..]), 1, "split at {split}");
    }
    let mut scanner = CursorReportScanner::default();
    assert_eq!(scanner.feed(b"noise\x1b[6x\x1b"), 0);
    assert_eq!(scanner.feed(b"\x1b[6n\x1b[6n"), 2);
    assert_eq!(scanner.feed(b"n"), 0);
}

/// Capture harness, not a test: spawns the real `kimi` CLI under a PTY,
/// provokes a permission prompt, and dumps the raw bytes (ANSI included) to a
/// file. Run it by hand when a new CLI or a new release needs its dialect
/// captured:
///
/// ```text
/// cargo test capture_kimi_output -- --ignored --nocapture
/// ```
///
/// The dump lands next to the temp workspace; the path is printed. Extraction
/// rules live in docs/archive/plaene-2026-09/superpowers/specs/2026-08-26-agent-capabilities-design.md §3.
///
/// `PA_CAPTURE_TASK_FILE=<path>` replaces the built-in one-liner with the
/// file's content (W1-01: the guard writes the task plus the multi-line
/// `ENTSCHEIDUNGEN` block, and kimi's composer collapses exactly that). The
/// byte offsets of the write and of the Enter land in `<dump>.offsets`, so
/// the stream can be cut into "before the write", "the echo window" and
/// "after the Enter" - the three slices the submit guard reasons about.
#[test]
#[ignore = "manual capture harness; talks to the real kimi CLI"]
fn capture_kimi_output() {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::Read;
    use std::time::{Duration, Instant};

    let workspace = capture_workspace(&std::env::temp_dir(), "kimi");
    let git = std::process::Command::new("git")
        .args(["init", "-q"])
        .current_dir(&workspace)
        .status()
        .expect("git init");
    assert!(git.success());

    // `PA_CAPTURE_SIZE=<cols>x<rows>`: a worker spawned through `pa` starts
    // at 80x24 (main.rs DEFAULT_COLS/ROWS) until a terminal view resizes it;
    // the default here is the wide capture size.
    let size: (u16, u16) = std::env::var("PA_CAPTURE_SIZE")
        .ok()
        .and_then(|v| {
            let (c, r) = v.split_once('x')?;
            Some((c.parse().ok()?, r.parse().ok()?))
        })
        .unwrap_or((120, 40));
    let pty = native_pty_system()
        .openpty(PtySize {
            rows: size.1,
            cols: size.0,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty");
    let mut cmd = CommandBuilder::new("kimi");
    cmd.cwd(&workspace);
    // `PA_CAPTURE_LIKE_APP=1` starts kimi the way the launch path does:
    // `--skills-dir <cwd>/.claude/skills` (an empty, freshly created dir) and
    // `TERM=xterm-256color` (pty.rs sets it for every session).
    if std::env::var("PA_CAPTURE_LIKE_APP").is_ok_and(|v| v == "1") {
        let skills = workspace.join(".claude").join("skills");
        std::fs::create_dir_all(&skills).expect("skills dir");
        cmd.arg("--skills-dir");
        cmd.arg(skills.as_os_str());
        cmd.env("TERM", "xterm-256color");
    }
    let mut child = pty.slave.spawn_command(cmd).expect("spawn kimi");

    let mut reader = pty.master.try_clone_reader().expect("reader");
    // Shared: the main thread sends the task, the reader thread answers the
    // terminal queries ConPTY leaves dangling.
    let writer = std::sync::Arc::new(std::sync::Mutex::new(
        pty.master.take_writer().expect("writer"),
    ));
    let answerer = std::sync::Arc::clone(&writer);
    let captured = std::sync::Arc::new(std::sync::Mutex::new(Vec::<u8>::new()));
    let sink = std::sync::Arc::clone(&captured);
    // Timeline sidecar: `<elapsed ms> <bytes so far>` per read chunk, so a
    // stall (the TUI waiting on a terminal reply) shows up as a gap.
    let timeline = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let timeline_sink = std::sync::Arc::clone(&timeline);
    // `PA_CAPTURE_ANSWER_DSR=0` deliberately withholds the cursor-position
    // reply to reproduce a TUI blocked on its query. The app now answers
    // these queries even without an attached terminal view.
    let answer_dsr = !std::env::var("PA_CAPTURE_ANSWER_DSR").is_ok_and(|v| v == "0");
    let spawned_at = Instant::now();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut cursor_reports = CursorReportScanner::default();
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            let chunk = &buf[..n];
            let total = {
                let mut sink = sink.lock().unwrap();
                sink.extend_from_slice(chunk);
                sink.len()
            };
            timeline_sink.lock().unwrap().push_str(&format!(
                "{} {}\n",
                spawned_at.elapsed().as_millis(),
                total
            ));
            // `ESC[6n` is a cursor-position query; ConPTY never replies and a
            // TUI that asked blocks on the answer. Any plausible position does.
            for _ in 0..cursor_reports.feed(chunk) * usize::from(answer_dsr) {
                use std::io::Write;
                let _ = answerer.lock().unwrap().write_all(b"\x1b[1;1R");
            }
        }
    });

    // Let the TUI settle (same idea as the submit guard), then send the task
    // that must trigger a write-permission prompt, then wait for it to render.
    let settle = |secs: u64| {
        let until = Instant::now() + Duration::from_secs(secs);
        while Instant::now() < until {
            std::thread::sleep(Duration::from_millis(200));
        }
    };
    settle(10);
    use std::io::Write;
    let mut offsets = String::new();
    let mark = |label: &str, offsets: &mut String| {
        let at = captured.lock().unwrap().len();
        let ms = spawned_at.elapsed().as_millis();
        offsets.push_str(&format!("{label}={at} t={ms}ms\n"));
        println!("offset {label}={at} t={ms}ms");
    };
    // A folder kimi has never seen triggers the first-run trust dialog; its
    // cursor rests on "Don't trust", so Up then Enter picks "Trust this
    // folder". The dialog is remembered per folder, so on a rerun none of
    // this text is present and no keys are sent.
    //
    // `PA_CAPTURE_TRUST_ANSWERS=<n>` sends the answer `n` times two seconds
    // apart and then waits only three seconds - the guard's own cadence when
    // the dismissed dialog is still inside its 2048-char window (smoke
    // 2026-09-16: three answers at t+7/t+9/t+11, write at t+12).
    if String::from_utf8_lossy(captured.lock().unwrap().as_slice()).contains("Trust this folder") {
        let answers = std::env::var("PA_CAPTURE_TRUST_ANSWERS")
            .ok()
            .and_then(|v| v.parse::<u32>().ok());
        for i in 0..answers.unwrap_or(1) {
            if i > 0 {
                settle(2);
            }
            writer
                .lock()
                .unwrap()
                .write_all(b"\x1b[A\r")
                .expect("trust folder");
            mark(&format!("trust_answer_{}", i + 1), &mut offsets);
        }
        // `PA_CAPTURE_SETTLE_AFTER_TRUST_S=<s>`: how long after the last
        // answer the write goes (the launch path wrote 0-1 s after it).
        let after_trust = std::env::var("PA_CAPTURE_SETTLE_AFTER_TRUST_S")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(if answers.is_some() { 3 } else { 10 });
        settle(after_trust);
    }
    let task = match std::env::var("PA_CAPTURE_TASK_FILE") {
        Ok(path) => std::fs::read_to_string(&path)
            .unwrap_or_else(|err| panic!("read PA_CAPTURE_TASK_FILE {path}: {err}")),
        Err(_) => "Lege eine Datei notes.txt mit einer Zeile Inhalt an.".to_string(),
    };
    mark("before_write", &mut offsets);
    writer
        .lock()
        .unwrap()
        .write_all(task.as_bytes())
        .expect("send task");
    // Enter travels on its own: typed into the same write as the text it is
    // swallowed by the TUI's input handling and the task never submits.
    // The guard's echo window is eight seconds; the same wait here shows
    // what the guard could have seen before its first rewrite.
    //
    // `PA_CAPTURE_ENTER_AFTER_ECHO_MS=<n>` mimics the guard instead: poll
    // for the task's last line to appear after the write (the echo), then
    // send Enter `n` ms later. The guard ticks every 100 ms, so `100` is
    // what the launch path did; larger values probe how long Kimi treats
    // trailing input as part of the paste.
    match std::env::var("PA_CAPTURE_ENTER_AFTER_ECHO_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
    {
        Some(after_ms) => {
            let last_line = task
                .lines()
                .rev()
                .map(str::trim)
                .find(|l| !l.is_empty())
                .unwrap_or("")
                .to_string();
            let write_at = captured.lock().unwrap().len();
            let deadline = Instant::now() + Duration::from_secs(30);
            while Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(100));
                let seen =
                    String::from_utf8_lossy(&captured.lock().unwrap().as_slice()[write_at..])
                        .contains(&last_line);
                if seen {
                    break;
                }
            }
            mark("echo_seen", &mut offsets);
            std::thread::sleep(Duration::from_millis(after_ms));
            // `PA_CAPTURE_ENTER_QUIET_MS=<n>`: additionally wait until the
            // stream has been quiet for `n` ms (capped at 10 s) - the
            // candidate guard rule "Enter after the echo settled".
            if let Some(quiet_ms) = std::env::var("PA_CAPTURE_ENTER_QUIET_MS")
                .ok()
                .and_then(|v| v.parse::<u64>().ok())
            {
                let cap = Instant::now() + Duration::from_secs(10);
                let mut last_len = captured.lock().unwrap().len();
                let mut quiet_since = Instant::now();
                while Instant::now() < cap {
                    std::thread::sleep(Duration::from_millis(100));
                    let len = captured.lock().unwrap().len();
                    if len != last_len {
                        last_len = len;
                        quiet_since = Instant::now();
                    } else if quiet_since.elapsed() >= Duration::from_millis(quiet_ms) {
                        break;
                    }
                }
                mark("echo_quiet", &mut offsets);
            }
        }
        None => settle(8),
    }
    mark("before_enter", &mut offsets);
    writer.lock().unwrap().write_all(b"\r").expect("submit");
    // Wait for the permission prompt, polling instead of a fixed sleep: K3
    // with thinking:high can think for minutes before the prompt renders.
    // Done early when the agent wrote the file without ever asking.
    const PROMPT_HINTS: [&str; 8] = [
        "approve",
        "allow",
        "permission",
        "proceed",
        "yes,",
        "genehmig",
        "erlauben",
        "ausf\u{fc}hren",
    ];
    let deadline = Instant::now() + Duration::from_secs(180);
    let mut prompt_at = None;
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_secs(5));
        if workspace.join("notes.txt").exists() {
            break;
        }
        let text = String::from_utf8_lossy(captured.lock().unwrap().as_slice()).to_lowercase();
        if PROMPT_HINTS.iter().any(|hint| text.contains(hint)) {
            // Give the prompt box a moment to finish drawing.
            settle(5);
            prompt_at = Some(captured.lock().unwrap().len());
            break;
        }
    }

    // kimi defaults to plan mode, so the first prompt is plan approval.
    // Approve it ("1" selects Approve, Enter confirms) and keep recording: the
    // tool-permission prompt that follows is the second dialect sample. Only
    // output past the first prompt is scanned, or stage one's own words would
    // end the wait immediately.
    if let Some(offset) = prompt_at {
        offsets.push_str(&format!("plan_prompt={offset}\n"));
        writer
            .lock()
            .unwrap()
            .write_all(b"1")
            .expect("choose approve");
        settle(2);
        writer
            .lock()
            .unwrap()
            .write_all(b"\r")
            .expect("confirm approve");
        let deadline = Instant::now() + Duration::from_secs(120);
        while Instant::now() < deadline {
            std::thread::sleep(Duration::from_secs(5));
            if workspace.join("notes.txt").exists() {
                settle(5);
                break;
            }
            let stage2 = String::from_utf8_lossy(&captured.lock().unwrap().as_slice()[offset..])
                .to_lowercase();
            if PROMPT_HINTS.iter().any(|hint| stage2.contains(hint)) {
                settle(5);
                break;
            }
        }
    }

    let _ = child.kill();
    let dump = workspace.join("kimi-capture.raw");
    std::fs::write(&dump, captured.lock().unwrap().as_slice()).expect("dump");
    std::fs::write(workspace.join("kimi-capture.raw.offsets"), offsets).expect("offsets");
    std::fs::write(
        workspace.join("kimi-capture.raw.timeline"),
        timeline.lock().unwrap().as_str(),
    )
    .expect("timeline");
    println!(
        "captured {} bytes -> {}",
        captured.lock().unwrap().len(),
        dump.display()
    );
}

/// Capture harness, not a test: spawns the real `opencode` TUI under a PTY
/// with an isolated config (W1-02), writes a task the way the submit guard
/// would (after the "Ask anything" readiness marker, echo-poll, then Enter)
/// and dumps the raw stream. Run by hand:
///
/// ```text
/// OPENCODE_CONFIG=... cargo test capture_opencode_output -- --ignored --nocapture
/// ```
///
/// `PA_OPENCODE_CONFIG=<path>` points at an opencode.json; without it the
/// TUI starts against the user's real config — do NOT submit a task then.
/// The echo question this answers: does OpenCode's TUI echo the written task
/// back into the ConPTY stream (the guard's only delivery signal), and does
/// an answer arrive on a local Ollama route (billing $0)?
#[test]
#[ignore = "manual capture harness; talks to the real opencode CLI"]
fn capture_opencode_output() {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::Read;
    use std::time::{Duration, Instant};

    let workspace = capture_workspace(&std::env::temp_dir(), "opencode");
    let git = std::process::Command::new("git")
        .args(["init", "-q"])
        .current_dir(&workspace)
        .status()
        .expect("git init");
    assert!(git.success());

    let size: (u16, u16) = std::env::var("PA_CAPTURE_SIZE")
        .ok()
        .and_then(|v| {
            let (c, r) = v.split_once('x')?;
            Some((c.parse().ok()?, r.parse().ok()?))
        })
        .unwrap_or((120, 40));
    let pty = native_pty_system()
        .openpty(PtySize {
            rows: size.1,
            cols: size.0,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty");
    let mut cmd = {
        // Same resolution as the launch path: `opencode` on PATH is an npm
        // shim that CreateProcessW refuses; pty::windows_invocation turns it
        // into the interpreter + script the shim would have started.
        #[cfg(windows)]
        {
            let path = crate::pty::resolve_windows_program("opencode")
                .expect("opencode resolvable on PATH");
            let (program, prefix) = crate::pty::windows_invocation(&path);
            let mut cmd = CommandBuilder::new(program.as_os_str());
            for arg in prefix {
                cmd.arg(arg);
            }
            cmd
        }
        #[cfg(not(windows))]
        {
            CommandBuilder::new("opencode")
        }
    };
    cmd.cwd(&workspace);
    cmd.env("TERM", "xterm-256color");
    // The launch path hands every session the worker's skill packs; an empty
    // fresh dir is what a newly spawned worker presents.
    let skills = workspace.join(".claude").join("skills");
    std::fs::create_dir_all(&skills).expect("skills dir");
    // Review-Auflage 1: without an isolated config the task below would fire
    // into the user's real OpenCode setup — a paid API route would cost
    // money. The harness refuses to run instead of trusting a comment.
    let config = std::env::var("PA_OPENCODE_CONFIG")
        .expect("PA_OPENCODE_CONFIG muss gesetzt sein (isolierte opencode.json)");
    cmd.env("OPENCODE_CONFIG", config);
    let mut child = pty.slave.spawn_command(cmd).expect("spawn opencode");

    let mut reader = pty.master.try_clone_reader().expect("reader");
    let writer = std::sync::Arc::new(std::sync::Mutex::new(
        pty.master.take_writer().expect("writer"),
    ));
    let answerer = std::sync::Arc::clone(&writer);
    let captured = std::sync::Arc::new(std::sync::Mutex::new(Vec::<u8>::new()));
    let sink = std::sync::Arc::clone(&captured);
    let timeline = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let timeline_sink = std::sync::Arc::clone(&timeline);
    let spawned_at = Instant::now();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut cursor_reports = CursorReportScanner::default();
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            let chunk = &buf[..n];
            let total = {
                let mut sink = sink.lock().unwrap();
                sink.extend_from_slice(chunk);
                sink.len()
            };
            timeline_sink.lock().unwrap().push_str(&format!(
                "{} {}\n",
                spawned_at.elapsed().as_millis(),
                total
            ));
            for _ in 0..cursor_reports.feed(chunk) {
                use std::io::Write;
                let _ = answerer.lock().unwrap().write_all(b"\x1b[1;1R");
            }
        }
    });

    let settle = |secs: u64| {
        let until = Instant::now() + Duration::from_secs(secs);
        while Instant::now() < until {
            std::thread::sleep(Duration::from_millis(200));
        }
    };
    // OpenCode paints its splash quickly; the guard's own marker rule treats
    // "Ask anything" as readiness, so 12s of settle is generous.
    settle(12);
    use std::io::Write;
    let mut offsets = String::new();
    let mark = |label: &str, offsets: &mut String| {
        let at = captured.lock().unwrap().len();
        let ms = spawned_at.elapsed().as_millis();
        offsets.push_str(&format!("{label}={at} t={ms}ms\n"));
        println!("offset {label}={at} t={ms}ms");
    };

    // A first-run TUI may sit on a model or trust picker; log what we see so
    // the operator can react. The harness never guesses keys here.
    let head = String::from_utf8_lossy(captured.lock().unwrap().as_slice()).to_string();
    for line in head.lines().filter(|l| !l.trim().is_empty()).take(12) {
        println!("tui| {line}");
    }

    let task = match std::env::var("PA_CAPTURE_TASK_FILE") {
        Ok(path) => std::fs::read_to_string(&path)
            .unwrap_or_else(|err| panic!("read PA_CAPTURE_TASK_FILE {path}: {err}")),
        Err(_) => "Lege eine Datei notes.txt mit einer Zeile Inhalt an.".to_string(),
    };
    mark("before_write", &mut offsets);
    writer
        .lock()
        .unwrap()
        .write_all(task.as_bytes())
        .expect("send task");
    // Same echo discipline as the guard: poll for the task's last line, then
    // Enter 100 ms later — exactly what the launch path did for Kimi.
    // Needle: the longest single word (10+ chars) of the task. A whole line
    // can be broken by the PTY's 120-column wrap and then never matches
    // contiguously; a single long word survives the wrap (review finding 4).
    // ANSI codes are stripped before the contains — a coloured echo is still
    // an echo (finding 2).
    let last_line = task
        .split_whitespace()
        .map(|w| w.trim_matches(|c: char| c.is_ascii_punctuation()))
        .filter(|w| w.len() >= 10)
        .max_by_key(|w| w.len())
        .unwrap_or(&task)
        .to_string();
    let write_at = captured.lock().unwrap().len();
    let echo_deadline = Instant::now() + Duration::from_secs(30);
    let mut echo_seen = false;
    while Instant::now() < echo_deadline {
        std::thread::sleep(Duration::from_millis(100));
        let seen = crate::submit_guard::normalize_tui_output(&String::from_utf8_lossy(
            &captured.lock().unwrap().as_slice()[write_at..],
        ))
        .contains(&last_line);
        if seen {
            echo_seen = true;
            break;
        }
    }
    mark("echo_seen", &mut offsets);
    println!("echo_seen={echo_seen}");
    std::thread::sleep(Duration::from_millis(100));
    mark("before_enter", &mut offsets);
    writer.lock().unwrap().write_all(b"\r").expect("submit");
    // Watch the stream for up to two minutes: an answer on the local route
    // (or any visible reaction) is success; total silence after Enter is the
    // NT-17 delivery gap in its purest form.
    settle(120);
    mark("after_answer_window", &mut offsets);

    let _ = child.kill();
    let dump = workspace.join("opencode-capture.raw");
    std::fs::write(&dump, captured.lock().unwrap().as_slice()).expect("dump");
    std::fs::write(workspace.join("opencode-capture.raw.offsets"), offsets).expect("offsets");
    std::fs::write(
        workspace.join("opencode-capture.raw.timeline"),
        timeline.lock().unwrap().as_str(),
    )
    .expect("timeline");
    println!(
        "captured {} bytes -> {}",
        captured.lock().unwrap().len(),
        dump.display()
    );
}

/// Capture harness for Claude Code, same shape as [`capture_kimi_output`]:
/// spawns the real `claude` CLI under a PTY in a folder it has never seen,
/// answers the ConPTY cursor query, confirms the workspace-trust dialog the
/// way the submit guard does (Down from preselected "No, exit", then Enter
/// on "Yes, I trust this folder"), then sends the probe task and waits for
/// the file. The raw bytes
/// (ANSI included) are dumped so the readiness marker and the answer marker
/// can be read off a real capture instead of guessed:
///
/// ```text
/// cargo test capture_claude_output -- --ignored --nocapture
/// ```
#[test]
#[ignore = "manual capture harness; talks to the real claude CLI"]
fn capture_claude_output() {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::{Read, Write};
    use std::time::{Duration, Instant};

    let workspace = capture_workspace(&std::env::temp_dir(), "claude");
    let git = std::process::Command::new("git")
        .args(["init", "-q"])
        .current_dir(&workspace)
        .status()
        .expect("git init");
    assert!(git.success());

    let pty = native_pty_system()
        .openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty");
    let mut cmd = CommandBuilder::new("claude");
    cmd.cwd(&workspace);
    cmd.env("TERM", "xterm-256color");
    let mut child = pty.slave.spawn_command(cmd).expect("spawn claude");

    let mut reader = pty.master.try_clone_reader().expect("reader");
    let writer = std::sync::Arc::new(std::sync::Mutex::new(
        pty.master.take_writer().expect("writer"),
    ));
    let answerer = std::sync::Arc::clone(&writer);
    let captured = std::sync::Arc::new(std::sync::Mutex::new(Vec::<u8>::new()));
    let sink = std::sync::Arc::clone(&captured);
    // Every chunk is timestamped on stdout so the dump can be read as a
    // timeline: when the TUI first drew, when it went quiet, when it echoed.
    let t0 = Instant::now();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut cursor_reports = CursorReportScanner::default();
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            let chunk = &buf[..n];
            sink.lock().unwrap().extend_from_slice(chunk);
            println!("[+{:6.1}s] {} bytes", t0.elapsed().as_secs_f64(), n);
            for _ in 0..cursor_reports.feed(chunk) {
                let _ = answerer.lock().unwrap().write_all(b"\x1b[1;1R");
            }
        }
    });

    let settle = |secs: u64| {
        let until = Instant::now() + Duration::from_secs(secs);
        while Instant::now() < until {
            std::thread::sleep(Duration::from_millis(200));
        }
    };
    // Matched on the guard's normalized view: Ink separates words with
    // cursor moves, so the raw bytes never contain "Yes, I trust this folder".
    let text = || {
        crate::submit_guard::normalize_tui_output(&String::from_utf8_lossy(
            captured.lock().unwrap().as_slice(),
        ))
    };
    let mark = |what: &str| {
        println!(
            "[+{:6.1}s] --- {what} (captured {} bytes)",
            t0.elapsed().as_secs_f64(),
            captured.lock().unwrap().len()
        );
    };

    // Boot: wait until the trust dialog or the composer is on screen, at most
    // 60 s (plugins and MCP servers can make the first draw slow).
    let boot_deadline = Instant::now() + Duration::from_secs(60);
    while Instant::now() < boot_deadline {
        std::thread::sleep(Duration::from_millis(500));
        let t = text();
        if t.contains("Yes, I trust this folder") || t.contains("? for shortcuts") {
            break;
        }
    }
    settle(3);
    mark("after boot wait");
    if text().contains("Yes, I trust this folder") {
        // Claude Code 2.1.266 preselects "No, exit": Down moves the
        // selector onto "Yes, I trust this folder", Enter confirms.
        mark("trust dialog seen; sending Down then Enter");
        writer
            .lock()
            .unwrap()
            .write_all(b"\x1b[B")
            .expect("trust move");
        settle(1);
        writer
            .lock()
            .unwrap()
            .write_all(b"\r")
            .expect("trust folder");
        settle(10);
        mark("after trust answer");
    }
    mark("sending task");
    writer
        .lock()
        .unwrap()
        .write_all(
            "Create the file probe-claude.txt containing exactly the marker PA_CLAUDE_OK and reply with PA_CLAUDE_OK."
                .as_bytes(),
        )
        .expect("send task");
    settle(3);
    mark("sending Enter");
    writer.lock().unwrap().write_all(b"\r").expect("submit");

    // Wait for the file, answering the edit-permission prompt once with "1"
    // (the dialect the profile already lists), at most 4 minutes.
    let deadline = Instant::now() + Duration::from_secs(240);
    let mut answered_permission = false;
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_secs(3));
        if workspace.join("probe-claude.txt").exists() {
            mark("file exists");
            settle(15);
            break;
        }
        let t = text().to_lowercase();
        if !answered_permission
            && (t.contains("do you want to create") || t.contains("do you want to make this edit"))
        {
            mark("permission prompt seen; answering 1");
            writer.lock().unwrap().write_all(b"1").expect("permit");
            answered_permission = true;
        }
    }
    mark("done waiting");
    // Ask the CLI itself what it is billed against (after the task, so the
    // status panel never swallows the task): the /status screen names
    // the login method and the plan. It is a slash command like any other.
    writer
        .lock()
        .unwrap()
        .write_all(b"/status")
        .expect("status");
    settle(2);
    writer
        .lock()
        .unwrap()
        .write_all(b"\r")
        .expect("status enter");
    settle(6);
    mark("after /status");
    writer
        .lock()
        .unwrap()
        .write_all(b"\x1b")
        .expect("close status");
    settle(2);

    let _ = child.kill();
    let dump = workspace.join("claude-capture.raw");
    std::fs::write(&dump, captured.lock().unwrap().as_slice()).expect("dump");
    println!(
        "captured {} bytes -> {}",
        captured.lock().unwrap().len(),
        dump.display()
    );
}
