//! Explicit Windows launch inputs. This module never reads the host environment.
use std::ffi::{OsStr, OsString};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

pub(super) struct Command {
    pub executable: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: PathBuf,
    pub environment: Vec<(String, OsString)>,
    /// Silence after which a live capture is aborted (`stream_guard`).
    pub no_progress: std::time::Duration,
}

pub(super) struct Encoded {
    pub executable: Vec<u16>,
    pub command_line: Vec<u16>,
    pub cwd: Vec<u16>,
    pub environment: Vec<u16>,
}

fn wide(value: &OsStr) -> Result<Vec<u16>, String> {
    let result: Vec<_> = value.encode_wide().collect();
    if result.contains(&0) || result.len() >= 32767 {
        return Err("native launch string contains NUL or exceeds limit".into());
    }
    Ok(result)
}

// MSVC/Rust argument convention, not cmd.exe/PowerShell shell syntax. Always
// quote, double backslashes before quotes and before the closing delimiter.
fn quote(value: &[u16], target: &mut Vec<u16>) {
    target.push(b'"' as u16);
    let mut slashes = 0;
    for &unit in value {
        if unit == b'\\' as u16 {
            slashes += 1;
            continue;
        }
        let count = if unit == b'"' as u16 {
            slashes * 2 + 1
        } else {
            slashes
        };
        target.extend(std::iter::repeat_n(b'\\' as u16, count));
        slashes = 0;
        target.push(unit);
    }
    target.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2));
    target.push(b'"' as u16);
}

impl Command {
    pub fn diagnostic(path: &Path) -> Self {
        Self {
            executable: path.to_owned(),
            args: Vec::new(),
            cwd: path.parent().unwrap_or(path).to_owned(),
            environment: Vec::new(),
            no_progress: crate::stream_guard::NO_PROGRESS_LIMIT,
        }
    }

    pub fn encode(&self) -> Result<Encoded, String> {
        if !self.executable.is_absolute()
            || !self.cwd.is_absolute()
            || self.args.len() > 256
            || self.environment.len() > 512
        {
            return Err(
                "native launch needs absolute paths and bounded arguments/environment".into(),
            );
        }
        let mut executable = wide(self.executable.as_os_str())?;
        if executable.contains(&(b'"' as u16)) {
            return Err("native executable path contains quote".into());
        }
        let mut command_line = Vec::new();
        quote(&executable, &mut command_line);
        for arg in &self.args {
            command_line.push(b' ' as u16);
            quote(&wide(arg)?, &mut command_line);
            if command_line.len() >= 32767 {
                return Err("native command line exceeds limit".into());
            }
        }
        if command_line.len() >= 32767 {
            return Err("native command line exceeds limit".into());
        }
        command_line.push(0);
        executable.push(0);
        let mut cwd = wide(self.cwd.as_os_str())?;
        cwd.push(0);

        let mut entries = Vec::new();
        for (key, value) in &self.environment {
            // ASCII keys keep case-insensitive duplicate detection and sorting
            // exact. Non-ASCII/hidden drive entries need a separate adapter.
            if key.is_empty()
                || key.len() > 256
                || !key.bytes().all(|b| b.is_ascii_graphic() && b != b'=')
            {
                return Err("unsupported native environment key".into());
            }
            entries.push((key.to_ascii_uppercase(), key, wide(value)?));
        }
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        if entries.windows(2).any(|pair| pair[0].0 == pair[1].0) {
            return Err("case-insensitive duplicate native environment key".into());
        }
        let mut environment = Vec::new();
        for (_, key, value) in entries {
            environment.extend(key.encode_utf16());
            environment.push(b'=' as u16);
            environment.extend(value);
            environment.push(0);
            if environment.len() >= 32767 {
                return Err("native environment exceeds limit".into());
            }
        }
        if environment.is_empty() {
            environment.push(0);
        }
        environment.push(0);
        Ok(Encoded {
            executable,
            command_line,
            cwd,
            environment,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_launch_inputs_are_rejected_before_native_creation() {
        let mut command = Command::diagnostic(Path::new(r"C:\Windows\System32\sort.exe"));
        assert_eq!(command.encode().unwrap().environment, [0, 0]);
        command.environment = vec![
            ("Path".into(), "first".into()),
            ("PATH".into(), "second".into()),
        ];
        assert!(command.encode().is_err());
        for key in ["", "=C:", "A=B", "Ü", "A B"] {
            command.environment = vec![(key.into(), "value".into())];
            assert!(command.encode().is_err());
        }
        command.environment = vec![("KEY".into(), "bad\0value".into())];
        assert!(command.encode().is_err());
        command.environment.clear();
        command.args = vec!["x".repeat(32767).into()];
        assert!(command.encode().is_err());
        command.args = vec!["x\0y".into()];
        assert!(command.encode().is_err());
        command.args.clear();
        command.cwd = "relative".into();
        assert!(command.encode().is_err());
    }
}
