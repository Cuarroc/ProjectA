//! One place that builds child processes, so none of them opens a window.
//!
//! On Windows a GUI application that spawns a console program gets a console
//! window for it - a black rectangle that appears and vanishes. The app spawns
//! `git` and `gh` constantly: `stuck.rs` alone probes two git commands per
//! running worker every sixty seconds, so three workers made the window flash
//! six times a minute, permanently. The user's report was "terminal windows
//! keep opening briefly and closing", and that cadence is exactly it.
//!
//! The cure is one flag, `CREATE_NO_WINDOW`. The reason this module exists
//! rather than the flag being sprinkled across thirty-odd call sites is that a
//! forgotten one is invisible: it compiles, it passes every gate, and it is
//! only ever seen in a running window on Windows - while the server that runs
//! the test suite is Linux. `no_command_new_outside_this_module` below is the
//! net.

use std::ffi::OsStr;
use std::process::Command;

/// `CREATE_NO_WINDOW` from the Win32 process-creation flags.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A [`Command`] that runs without opening a console window.
///
/// Use this instead of [`Command::new`] everywhere outside tests.
///
/// Every child also inherits `GIT_NO_REPLACE_OBJECTS=1`: `refs/replace/*`
/// lives in the shared git common dir and swaps object CONTENT at read time
/// under an unchanged OID — a hostile test-run can plant one and it survives
/// candidate cleanup. Every measurement, checkout, and especially the MERGE
/// must read the real objects (review-F4-r24/r25, Opus Fund 1 + r25 F1).
/// Set unconditionally because git is not always spawned as `git`:
/// `providers::program_invocation` can wrap it in `cmd`/`sh`, which a name
/// check would miss (measured: the merge path did exactly that). The
/// variable is git-namespaced; every other program ignores it. ProjectA
/// itself never uses replace refs — a future caller that truly needs them
/// must override the env on its own command explicitly.
pub fn command<S: AsRef<OsStr>>(program: S) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program.as_ref());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.env("GIT_NO_REPLACE_OBJECTS", "1");
    cmd
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;
    use std::fs;
    use std::path::Path;

    /// Review-F4-r26 (Opus F2): the central pin must be pinned itself — a
    /// refactor that drops the env (or a production git spawn written with
    /// `Command::new`, which `no_command_new_outside_this_module` already
    /// catches) would silently reopen the replace-ref hole.
    #[test]
    fn every_command_carries_no_replace_objects() {
        let cmd = super::command("git");
        assert!(
            cmd.get_envs().any(|(key, value)| {
                key == OsStr::new("GIT_NO_REPLACE_OBJECTS") && value == Some(OsStr::new("1"))
            }),
            "proc::command must pin GIT_NO_REPLACE_OBJECTS=1"
        );
        // Deliberately also on non-git programs: providers::program_invocation
        // can wrap git in cmd/sh, so the pin cannot afford a name check.
        let wrapped = super::command("cmd");
        assert!(
            wrapped.get_envs().any(|(key, value)| {
                key == OsStr::new("GIT_NO_REPLACE_OBJECTS") && value == Some(OsStr::new("1"))
            }),
            "the pin applies to every spawn (git may be cmd-wrapped)"
        );
    }

    /// Every spawn in production code must go through [`super::command`].
    ///
    /// The scan walks `src/` at test time rather than naming files, so a module
    /// added tomorrow is covered without anyone remembering this test. Test
    /// code is exempt: a window that flashes during `cargo test` bothers
    /// nobody, and `testutil.rs` exists only for tests.
    #[test]
    fn no_command_new_outside_this_module() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut offenders = Vec::new();

        let mut stack = vec![src.clone()];
        while let Some(dir) = stack.pop() {
            let entries = fs::read_dir(&dir).expect("src/ is readable");
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                    continue;
                }
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                // This module owns the one legitimate call; testutil is tests.
                if name == "proc.rs" || name == "testutil.rs" {
                    continue;
                }
                let text = fs::read_to_string(&path).expect("a source file is readable");
                // Only the part above `mod tests` counts as production code.
                let production = text.split("mod tests").next().unwrap_or(&text);
                for (n, line) in production.lines().enumerate() {
                    if line.contains("Command::new") {
                        offenders.push(format!("{}:{}: {}", name, n + 1, line.trim()));
                    }
                }
            }
        }

        assert!(
            offenders.is_empty(),
            "these spawns bypass proc::command and will flash a console window \
             on Windows - route them through it:\n  {}",
            offenders.join("\n  ")
        );
    }

    #[test]
    fn pure_shim_parser_helpers_are_not_hidden_from_the_linux_gate() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/pty.rs");
        let text = fs::read_to_string(path).expect("pty.rs is readable");
        let lines: Vec<_> = text.lines().collect();
        let mut hidden = Vec::new();
        for helper in [
            "fn expand_shim_token(",
            "fn split_outside_quotes(",
            "fn tokenize_command(",
        ] {
            let line = lines
                .iter()
                .position(|line| line.contains(helper))
                .expect("shim parser helper exists");
            if line > 0 && lines[line - 1].trim() == "#[cfg(windows)]" {
                hidden.push(helper.trim_end_matches('('));
            }
        }
        assert!(
            hidden.is_empty(),
            "pure string/path helpers are excluded from this Linux gate:\n  {}",
            hidden.join("\n  ")
        );
    }

    fn production_source_offenders(needle: &str, exempt: &str) -> Vec<String> {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut offenders = Vec::new();
        let mut stack = vec![src];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(dir).expect("src/ is readable").flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                if path.extension().and_then(|e| e.to_str()) != Some("rs")
                    || path.file_name().and_then(|n| n.to_str()) == Some(exempt)
                {
                    continue;
                }
                let text = fs::read_to_string(&path).expect("source file is readable");
                let production = text.split("mod tests").next().unwrap_or(&text);
                for (n, line) in production.lines().enumerate() {
                    if line.contains(needle) {
                        offenders.push(format!(
                            "{}:{}: {}",
                            path.file_name().unwrap().to_string_lossy(),
                            n + 1,
                            line.trim()
                        ));
                    }
                }
            }
        }
        offenders
    }

    #[test]
    fn comspec_routing_is_owned_by_the_windows_shim_module() {
        let offenders = production_source_offenders("var_os(\"COMSPEC\")", "pty.rs");
        assert!(
            offenders.is_empty(),
            "COMSPEC routing bypasses pty::windows_invocation:\n  {}",
            offenders.join("\n  ")
        );
    }

    #[test]
    fn secret_file_permissions_have_one_auditable_owner() {
        let offenders = production_source_offenders("set_permissions", "oneshot.rs");
        assert!(
            offenders.is_empty(),
            "secret-file permission handling is duplicated outside oneshot::make_private:\n  {}",
            offenders.join("\n  ")
        );
    }
}
