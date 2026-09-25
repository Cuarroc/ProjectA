//! Bounded working-tree guidance. Repository prose is data, not runtime authority.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::File,
    io::Read,
    path::{Component, Path, PathBuf},
};

const FILE_LIMIT: u64 = 262_144;

fn text(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn words(value: &str) -> BTreeSet<String> {
    value
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| s.chars().count() >= 3)
        .map(str::to_lowercase)
        .filter(|s| {
            ![
                "the", "and", "for", "with", "der", "die", "das", "und", "mit",
            ]
            .contains(&s.as_str())
        })
        .collect()
}

#[cfg(windows)]
fn opened_path(file: &File) -> Result<PathBuf, &'static str> {
    use std::os::windows::{ffi::OsStringExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
    let mut buffer = vec![0u16; 32768];
    let length = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            0,
        )
    } as usize;
    if length == 0 || length >= buffer.len() {
        return Err("file_identity_unavailable");
    }
    Ok(PathBuf::from(std::ffi::OsString::from_wide(
        &buffer[..length],
    )))
}

#[cfg(target_os = "linux")]
fn opened_path(file: &File) -> Result<PathBuf, &'static str> {
    use std::os::fd::AsRawFd;
    std::fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd()))
        .map_err(|_| "file_identity_unavailable")
}

#[cfg(not(any(windows, target_os = "linux")))]
fn opened_path(_: &File) -> Result<PathBuf, &'static str> {
    Err("file_identity_unavailable")
}

pub(in crate::store) fn read(
    root: &Path,
    relative: &str,
) -> Result<(String, String), &'static str> {
    let target = root.join(relative).canonicalize().map_err(|error| {
        if matches!(
            error.kind(),
            std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
        ) {
            "missing"
        } else {
            "unreadable"
        }
    })?;
    if !target.starts_with(root) {
        return Err("outside_project");
    }
    if !target.metadata().map_err(|_| "unreadable")?.is_file() {
        return Err("not_regular_file");
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW);
    }
    let file = options.open(&target).map_err(|_| "unreadable")?;
    // Check the opened handle, not just the path checked before open. A replaced
    // symlink/junction must not expose a file outside this project.
    if !opened_path(&file)?.starts_with(root) {
        return Err("outside_project");
    }
    if !file.metadata().map_err(|_| "unreadable")?.is_file() {
        return Err("not_regular_file");
    }
    let mut bytes = Vec::new();
    file.take(FILE_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "unreadable")?;
    if bytes.len() as u64 > FILE_LIMIT {
        return Err("oversized");
    }
    let digest = format!("{:x}", Sha256::digest(&bytes));
    Ok((
        String::from_utf8(bytes).map_err(|_| "invalid_utf8")?,
        digest,
    ))
}

pub(super) fn collect(repo: Option<String>, objective: String, paths: Value) -> Value {
    let Some(root) = repo.and_then(|p| Path::new(&p).canonicalize().ok()) else {
        return json!({"state":"unavailable","reason":"project_path_unavailable"});
    };
    let mut candidates = BTreeSet::from(["AGENTS.md".to_string()]);
    let mut truncated = objective.chars().count() > 4096;
    let mut query = text(&objective, 4096);
    let owned = paths.as_array().cloned().unwrap_or_default();
    truncated |= owned.len() > 64;
    for entry in owned.iter().take(64).filter_map(Value::as_str) {
        if entry.len() > 1024 {
            truncated = true;
            continue;
        }
        let path = Path::new(entry);
        if path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        {
            truncated = true;
            continue;
        }
        query.push(' ');
        query.push_str(entry);
        let mut prefix = PathBuf::new();
        for component in path.components().take(16) {
            prefix.push(component);
            candidates.insert(
                prefix
                    .join("AGENTS.md")
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
        truncated |= path.components().count() > 16;
    }
    truncated |= candidates.len() > 24;
    let mut rules = Vec::new();
    for path in candidates.iter().take(24) {
        match read(&root, path) {
            Ok((content, hash)) => {
                let shortened = content.chars().count() > 2048;
                truncated |= shortened;
                rules.push(json!({"path":path,"state":"recorded","sha256":hash,"text":text(&content,2048),"truncated":shortened}));
            }
            Err("missing") => {}
            Err(reason) => {
                truncated = true;
                rules.push(json!({"path":path,"state":"unavailable","reason":reason}));
            }
        }
    }
    let lessons = match read(&root, "docs/dev-hq/lessons.json") {
        Ok((content, hash)) => match serde_json::from_str::<Value>(&content) {
            Ok(document) if document["schema"] == 1 && document["lessons"].is_array() => {
                let terms = words(&query);
                let mut ranked = Vec::new();
                let entries = document["lessons"].as_array().unwrap();
                let mut seen = BTreeSet::new();
                for lesson in entries.iter().take(512) {
                    let Some(id) = lesson["id"]
                        .as_str()
                        .filter(|s| !s.is_empty() && s.len() <= 128)
                    else {
                        continue;
                    };
                    if !seen.insert(id) {
                        continue;
                    }
                    let Some(symptom) = lesson["symptom"].as_str() else {
                        continue;
                    };
                    let Some(cause) = lesson["cause"].as_str() else {
                        continue;
                    };
                    let Some(fix) = lesson["fix"].as_str() else {
                        continue;
                    };
                    let symptom_words = words(symptom);
                    let rest = words(&format!("{cause} {fix}"));
                    let tags = words(&lesson["tags"].to_string());
                    let score = terms
                        .iter()
                        .map(|term| {
                            2 * usize::from(symptom_words.contains(term))
                                + usize::from(rest.contains(term))
                                + 3 * usize::from(tags.contains(term))
                        })
                        .sum::<usize>();
                    if score == 0 {
                        continue;
                    }
                    ranked.push((score,id.to_string(),json!({"id":id,"symptom":text(symptom,384),"cause":text(cause,384),"fix":text(fix,768),"sourceHint":text(lesson["source"].as_str().unwrap_or(""),256),"truncated":symptom.chars().count()>384||cause.chars().count()>384||fix.chars().count()>768,"outcomeState":"unverified"})));
                }
                ranked.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
                let matched = ranked.len();
                json!({"state":"recorded","path":"docs/dev-hq/lessons.json","sha256":hash,"total":entries.len(),"scanned":entries.len().min(512),"matched":matched,"limit":4,"truncated":entries.len()>512||matched>4,"items":ranked.into_iter().take(4).map(|(_,_,item)|item).collect::<Vec<_>>()})
            }
            _ => json!({"state":"unavailable","reason":"invalid_lessons_format"}),
        },
        Err(reason) => json!({"state":"unavailable","reason":reason}),
    };
    json!({"state":"recorded","source":"project-working-tree","observedAt":super::now_unix_secs(),"candidateBinding":"unavailable","trust":"unverified-data","instructionAuthority":false,"rules":{"items":rules,"candidateCount":candidates.len(),"limit":24,"truncated":truncated,"fetchRequired":truncated},"lessons":lessons})
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    #[test]
    fn guidance_selects_owned_ancestors_and_lessons_without_confidence_inflation() {
        let dir = TempDir::new("guidance");
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        std::fs::create_dir_all(dir.path().join("docs/dev-hq")).unwrap();
        std::fs::write(dir.path().join("AGENTS.md"), "shared rules").unwrap();
        std::fs::write(dir.path().join("src/AGENTS.md"), "source rules").unwrap();
        std::fs::write(dir.path().join("docs/dev-hq/lessons.json"),json!({"schema":1,"lessons":[{"id":"a","symptom":"quota failure","cause":"capacity exhausted","fix":"wait for quota","hits":0},{"id":"b","symptom":"quota failure","cause":"capacity exhausted","fix":"wait for quota","hits":99999}]}).to_string()).unwrap();
        let got = collect(
            Some(dir.path().to_string_lossy().into()),
            "quota".into(),
            json!(["src/file.rs"]),
        );
        assert_eq!(got["rules"]["items"].as_array().unwrap().len(), 2);
        assert_eq!(got["lessons"]["items"][0]["id"], "a");
        assert_eq!(got["lessons"]["items"][0]["outcomeState"], "unverified");
        assert_eq!(got["instructionAuthority"], false);
        assert_eq!(got["candidateBinding"], "unavailable");
        assert_eq!(
            got["rules"]["items"][0]["sha256"].as_str().unwrap().len(),
            64
        );
    }

    #[test]
    fn guidance_bounds_and_invalid_sources_are_explicit() {
        let dir = TempDir::new("guidance-bounds");
        std::fs::create_dir_all(dir.path().join("docs/dev-hq")).unwrap();
        std::fs::write(dir.path().join("AGENTS.md"), "ä".repeat(3000)).unwrap();
        std::fs::write(dir.path().join("docs/dev-hq/lessons.json"), "bad json").unwrap();
        let got = collect(
            Some(dir.path().to_string_lossy().into()),
            "task".into(),
            json!(["../outside"]),
        );
        assert_eq!(got["rules"]["fetchRequired"], true);
        assert_eq!(
            got["rules"]["items"][0]["text"]
                .as_str()
                .unwrap()
                .chars()
                .count(),
            2048
        );
        assert_eq!(got["lessons"]["state"], "unavailable");
        assert_eq!(
            collect(None, "task".into(), json!([]))["state"],
            "unavailable"
        );
    }

    #[test]
    fn guidance_rejects_oversized_and_nonregular_sources() {
        let dir = TempDir::new("guidance-files");
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("AGENTS.md"), vec![b'x'; FILE_LIMIT as usize + 1]).unwrap();
        assert_eq!(read(&root, "AGENTS.md").unwrap_err(), "oversized");
        std::fs::create_dir(root.join("directory")).unwrap();
        assert_eq!(read(&root, "directory").unwrap_err(), "not_regular_file");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn guidance_rejects_external_symlink_and_fifo() {
        use std::os::unix::fs::symlink;
        let dir = TempDir::new("guidance-links");
        let other = TempDir::new("guidance-outside");
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(other.path().join("secret"), "do not expose").unwrap();
        symlink(other.path().join("secret"), root.join("AGENTS.md")).unwrap();
        assert_eq!(read(&root, "AGENTS.md").unwrap_err(), "outside_project");
        let pipe = std::ffi::CString::new(root.join("pipe").to_string_lossy().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(pipe.as_ptr(), 0o600) }, 0);
        assert_eq!(read(&root, "pipe").unwrap_err(), "not_regular_file");
    }
}
