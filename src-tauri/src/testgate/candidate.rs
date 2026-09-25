//! Disposable checkout of the exact merge tree. Never reset the worker.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use crate::readiness::CodeTuple;

pub(super) struct Candidate {
    source: PathBuf,
    root: PathBuf,
    checkout: PathBuf,
    commit: String,
}

fn git_command(repo: &Path, args: &[&str]) -> std::process::Command {
    let mut command = crate::proc::command("git");
    command
        .arg("-C")
        .arg(repo)
        .args([
            "-c",
            "core.hooksPath=",
            "-c",
            "commit.gpgSign=false",
            // The candidate's checked-out bytes must be the blob bytes: no
            // ambient line-ending conversion from the machine's config.
            "-c",
            "core.autocrlf=false",
            "-c",
            "core.eol=lf",
            // Only the tree's own .gitattributes (reviewed in the diff) and
            // info/attributes (covered by the sweep) may apply — never the
            // machine's global or system attribute files (review-F4-r22).
            "-c",
            "core.attributesFile=",
            "-c",
            "user.name=ProjectA Verification",
            "-c",
            "user.email=verification@projecta.invalid",
        ])
        .args(args)
        .env("GIT_ATTR_NOSYSTEM", "1");
    // refs/replace/* lives in the SHARED common dir and swaps object CONTENT
    // at read time under an unchanged OID — a run can plant one (it survives
    // cleanup). `crate::proc::command` pins GIT_NO_REPLACE_OBJECTS=1 for
    // every git spawn centrally (review-F4-r24/r25, Opus Fund 1 + r25 F1).
    command
}

fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_command(repo, args)
        .output()
        .map_err(|e| format!("candidate git: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "candidate git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Raw stdout bytes of a candidate git call (for `-z` listings — never
/// lossy-string a path that might not be UTF-8).
fn git_bytes(repo: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = git_command(repo, args)
        .output()
        .map_err(|e| format!("candidate git: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "candidate git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(output.stdout)
}

/// `git hash-object --no-filters` over bytes on stdin — the RAW blob hash,
/// never through a filter (review-F4-r23, k3 Fund 1).
fn git_hash_stdin(repo: &Path, input: &[u8]) -> Result<String, String> {
    git_hash(repo, &["hash-object", "--no-filters", "--stdin"], input)
}

/// Same, batched: the paths go as ARGUMENTS (one OID per argument, in
/// order) — no line protocol, no quoting edge cases (review-F4-r24).
fn git_hash_paths(repo: &Path, paths: &[&str]) -> Result<String, String> {
    let output = git_command(repo, &["hash-object", "--no-filters", "--"])
        .args(paths)
        .output()
        .map_err(|e| format!("candidate git: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "candidate git hash-object: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn git_hash(repo: &Path, args: &[&str], input: &[u8]) -> Result<String, String> {
    let mut child = git_command(repo, args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("candidate git: {e}"))?;
    // Feed stdin from a thread: the output pipe must not deadlock the write.
    let mut stdin = child.stdin.take().expect("piped stdin");
    let bytes = input.to_vec();
    let writer = std::thread::spawn(move || {
        use std::io::Write;
        let _ = stdin.write_all(&bytes);
    });
    let out = child
        .wait_with_output()
        .map_err(|e| format!("candidate git: {e}"))?;
    let _ = writer.join();
    if !out.status.success() {
        return Err(format!(
            "candidate git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

impl Candidate {
    pub(super) fn prepare(source: &Path, code: &CodeTuple) -> Result<Self, String> {
        // The smudge sweep runs BEFORE anything checks the tree out: after
        // `worktree add`, a committed filter would already have fetched and
        // executed (network + filter code from an unreviewed tree).
        // (review-F4-r22, Opus Fund 1+2: the check belongs to the candidate,
        // not to the setup command, and before the checkout, not after.)
        // Product consequence, deliberate (r23, Opus Fund 2): a repo that
        // legitimately uses Git LFS or working-tree-encoding cannot run the
        // candidate gate at all — evidence only ever binds to bytes the
        // reviewer actually read. Fail-closed, message names file + cause.
        crate::setupgate::refuse_transforming_tree_attrs(source, &code.merge_tree_oid)?;
        let root =
            std::env::temp_dir().join(format!("projecta-verify-{}", crate::oneshot::random_hex()));
        fs::create_dir(&root).map_err(|e| format!("candidate directory: {e}"))?;
        crate::oneshot::make_private(&root);
        let mut candidate = Self {
            source: source.to_path_buf(),
            checkout: root.join("checkout"),
            root,
            commit: String::new(),
        };
        candidate.commit = git(
            source,
            &[
                "commit-tree",
                &code.merge_tree_oid,
                "-p",
                &code.worker_head_sha,
                "-m",
                "ProjectA merge candidate verification",
            ],
        )?; // (review-F4-r24, Opus Beobachtung: this writes one unreachable
            // commit object per run into the owner repo — it is collected by the
            // next `git gc`; deliberately not pruned here, cleanup must not grow
            // a second mutation surface against the worker repo.)
        git(
            source,
            &[
                "worktree",
                "add",
                "--detach",
                candidate
                    .checkout
                    .to_str()
                    .ok_or("candidate path is not UTF-8")?,
                &candidate.commit,
            ],
        )?;
        candidate.validate(code)?;
        Ok(candidate)
    }

    pub(super) fn path(&self) -> &Path {
        &self.checkout
    }

    /// Isolation means: the commit is still the merge-tree commit and every
    /// tracked file's RAW bytes equal the blob the merge tree names. Gitlinks
    /// are content-free by design (the tree names only the pointer — a run
    /// could fill a submodule directory and test inside it; that is outside
    /// what the merge carries, r26 Opus B2). No filter-mediated comparison
    /// anywhere: `update-index`/`status` hash
    /// worktree files through the CLEAN filter, and a run can plant one in
    /// the shared git common dir (`info/attributes` + `config
    /// filter.<name>.clean`) to launder tampered bytes back to their
    /// original OID (review-F4-r23, k3 Fund 1 — cross-platform, no timestamp
    /// forgery needed; this also subsumes the old Windows-SetFileTime
    /// residual from r15, because no stat is trusted anymore). Untracked
    /// artifacts (build output, logs, `node_modules`) are the run's own
    /// business — the candidate is disposable exactly so they may exist
    /// without touching the worker.
    ///
    /// Residual TOCTOU (review-F4-r22, Opus Fund 2, documented): the smudge
    /// sweep in `prepare` reads `info/attributes` per `--source`; a
    /// background process planted by the agent could rewrite it between the
    /// sweep and `worktree add`. The window is a few git spawns wide, the
    /// tree's own attributes are always covered, and the machine's
    /// global/system attribute files are neutralised at checkout
    /// (`core.attributesFile=` + `GIT_ATTR_NOSYSTEM=1`).
    ///
    /// Persistence residue (review-F4-r23, k3 Geschwister-Notiz): anything a
    /// run plants in the source repo's common dir (`info/attributes`,
    /// `config` — including `core.hooksPath`) survives the cleanup in the
    /// OWNER'S real repo. Consequence (r24, k3 Beobachtung): planted
    /// `info/attributes` makes every FUTURE candidate fail the sweep until
    /// the owner cleans the file by hand — a refusal-DoS, fail-closed.
    /// Grafts are the exception (r26, Opus B1): a planted `info/grafts`
    /// line shifts commit parents and merge bases for BOTH the display and
    /// the merge — consistent, but the tuple collapses once the file
    /// vanishes, and the evidence lapses with it. Not fail-closed, hence
    /// named here.
    /// Full sandboxing is outside this model; the note stands so nobody
    /// believes cleanup erases it.
    ///
    /// Cost note (r24, Opus Beobachtung): validate runs twice per gate run
    /// (in `prepare` and after the run) and is now O(tree) raw I/O instead
    /// of an index refresh — deliberate: the raw pass is the only one that
    /// no planted filter/stat can launder.
    ///
    /// Residual, accepted (r25, Opus F4): validate measures at the END. A
    /// run that patches a tracked file, executes the weakened suite, and
    /// writes the original bytes back before exit binds green evidence to
    /// the merge tree although other bytes ran. The candidate moved the
    /// blast radius out of the worker's checkout; it cannot close
    /// write-and-restore without recording every byte the run touched.
    /// Accepted without an owner — if this ever matters, the answer is
    /// tracing (fsnotify/inotify) or a fused filesystem, not more hashing.
    pub(super) fn validate(&self, code: &CodeTuple) -> Result<(), String> {
        if git(&self.checkout, &["rev-parse", "HEAD"])? != self.commit
            || git(&self.checkout, &["rev-parse", "HEAD^{tree}"])? != code.merge_tree_oid
        {
            return Err(
                "the merge candidate's tracked code changed during verification; no test evidence was recorded"
                    .into(),
            );
        }
        self.validate_raw_bytes(code)
    }

    /// Every tracked path in the merge tree must hash, RAW, to the blob the
    /// tree names. Batched: one `ls-tree -r -z` (byte-exact) + `hash-object
    /// --no-filters` with the paths as ARGUMENTS in chunks — the first
    /// version fed them LF-separated via `--stdin-paths`, but that protocol
    /// C-unquotes leading `"` and strips trailing `\r` (review-F4-r24, Opus
    /// Fund 2); arguments carry no such parsing. Symlink blobs hash their
    /// link text; gitlinks are content-free; a non-UTF-8 path gets a named
    /// refusal instead of a lossy mangling (r24, Opus Fund 4 — same product
    /// consequence class as the LFS note on `prepare`).
    fn validate_raw_bytes(&self, code: &CodeTuple) -> Result<(), String> {
        let listing = git_bytes(
            &self.checkout,
            &["ls-tree", "-r", "-z", &code.merge_tree_oid],
        )?;
        let mut regular: Vec<(String, String)> = Vec::new(); // (path, blob oid)
        for entry in listing.split(|&b| b == 0).filter(|e| !e.is_empty()) {
            let unreadable =
                "the candidate's tree listing is unreadable; no test evidence was recorded";
            let Some(tab) = entry.iter().position(|&b| b == b'\t') else {
                return Err(unreadable.into());
            };
            let meta = std::str::from_utf8(&entry[..tab]).map_err(|_| unreadable.to_string())?;
            let mut parts = meta.split_whitespace();
            let (Some(mode), Some(kind), Some(oid)) = (parts.next(), parts.next(), parts.next())
            else {
                return Err(unreadable.into());
            };
            let path_bytes = &entry[tab + 1..];
            let path = String::from_utf8(path_bytes.to_vec()).map_err(|_| {
                format!(
                    "a tracked path is not UTF-8 — this repo cannot use the candidate gate ({})",
                    String::from_utf8_lossy(path_bytes)
                )
            })?;
            match (mode, kind) {
                (_, "commit") => {} // gitlink: content-free
                ("120000", "blob") => {
                    // A symlink's blob is its link text. On Windows with
                    // core.symlinks=false the checkout carries that text as
                    // a regular file — the fs::read fallback exists exactly
                    // for that layout. On unix a regular file in its place
                    // is a type change and refuses (r24, Opus Fund 3).
                    let on_disk = self.checkout.join(&path);
                    #[cfg(unix)]
                    if !fs::symlink_metadata(&on_disk)
                        .map_err(|e| format!("cannot stat candidate symlink {path}: {e}"))?
                        .file_type()
                        .is_symlink()
                    {
                        return Err(format!(
                            "tracked symlink {path} changed type during verification; no test evidence was recorded"
                        ));
                    }
                    let bytes = match fs::read_link(&on_disk) {
                        Ok(target) => target.as_os_str().as_encoded_bytes().to_vec(),
                        Err(_) => fs::read(&on_disk)
                            .map_err(|e| format!("cannot read candidate symlink {path}: {e}"))?,
                    };
                    let actual = git_hash_stdin(&self.checkout, &bytes)?;
                    if actual != oid {
                        return Err(format!(
                            "tracked symlink {path} changed during verification; no test evidence was recorded"
                        ));
                    }
                }
                ("100644" | "100755", "blob") => {
                    // Mode is part of the merge tree — a chmod during the run
                    // must invalidate too (unix only: NTFS has no exec bit;
                    // r24, Opus Fund 3). Caveat (r26, Opus B3): on a temp root
                    // living on vfat/exfat every file reports exec bits —
                    // a 100644 blob would then refuse permanently. Fail-closed,
                    // but unexplained to the owner; hence named here.
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let executable = fs::metadata(self.checkout.join(&path))
                            .map_err(|e| format!("cannot stat candidate file {path}: {e}"))?
                            .permissions()
                            .mode()
                            & 0o111
                            != 0;
                        if executable != (mode == "100755") {
                            return Err(format!(
                                "tracked file {path} changed mode during verification; no test evidence was recorded"
                            ));
                        }
                    }
                    regular.push((path, oid.to_string()));
                }
                _ => {
                    return Err(
                        "the candidate's tree carries an unexpected entry; no test evidence was recorded"
                            .into(),
                    )
                }
            }
        }
        // Chunked argument batches: one hash per argument, in order.
        // Budgeted by BYTES, not count (r25, Opus F3): Windows lpCommandLine
        // caps at 32767 chars, and the line also carries `-C <abs path>`
        // plus the `-c` pins — 100 deep monorepo paths would burst it.
        // (Tests use a tiny budget so the multi-chunk path is exercised on
        // small fixtures.)
        #[cfg(not(test))]
        const CHUNK_BUDGET: usize = 24 * 1024;
        #[cfg(test)]
        const CHUNK_BUDGET: usize = 512;
        let mut start = 0;
        while start < regular.len() {
            let mut end = start;
            let mut size = 0;
            while end < regular.len()
                && (end == start || size + regular[end].0.len() < CHUNK_BUDGET)
            {
                size += regular[end].0.len() + 1;
                end += 1;
            }
            let chunk = &regular[start..end];
            let paths: Vec<&str> = chunk.iter().map(|(path, _)| path.as_str()).collect();
            let out = git_hash_paths(&self.checkout, &paths)?;
            let actual: Vec<&str> = out.lines().collect();
            if actual.len() != chunk.len() {
                return Err(
                    "the candidate's raw hash pass is incomplete; no test evidence was recorded"
                        .into(),
                );
            }
            for ((path, oid), got) in chunk.iter().zip(actual) {
                if got != oid {
                    return Err(format!(
                        "tracked file {path} changed during verification; no test evidence was recorded"
                    ));
                }
            }
            start = end;
        }
        Ok(())
    }

    /// Removes the worktree, then the temp root — deliberately NOT
    /// recursively: `root` may contain files a project/test command wrote
    /// above its cwd (`../artifact.txt`) or by absolute path, and a
    /// recursive delete against a command-prepared path is the worse
    /// trade-off. The cost of that caution: a non-empty root makes cleanup
    /// fail loudly (Err here, one retry + `eprintln` in `Drop`) and leaves
    /// the `%TEMP%/projecta-verify-*` remnant for manual sweeps — a bounded,
    /// visible leak instead of silent data loss (review-F4-r14, Sonnet
    /// Befund 2; pinned by `a_stray_file_above_the_checkout_fails_cleanup_loudly`).
    /// On that failure path the admin entry under `.git/worktrees/` in the
    /// source repo also remains; the temp ROOT name is random, but the
    /// worktree admin name is the fixed basename `checkout` — git dedupes it
    /// with a counter (`checkout1`, …), so repeated failed cleanups grow the
    /// admin entries until a `git worktree prune` collects them
    /// (review-F4-r16, Opus Beobachtung; Richtigstellung der Namensbehauptung
    /// in r21, Opus B3 — deliberately no automatic prune: cleanup must not
    /// grow a second mutation surface against the worker repo).
    pub(super) fn cleanup(&self) -> Result<(), String> {
        if self.checkout.exists() {
            git(
                &self.source,
                &[
                    "worktree",
                    "remove",
                    "--force",
                    self.checkout
                        .to_str()
                        .ok_or("candidate path is not UTF-8")?,
                ],
            )?;
        }
        if self.root.exists() {
            // Only the directory this guard created; never recursively delete
            // an unexpected file or a path supplied by a project/test command.
            fs::remove_dir(&self.root).map_err(|e| format!("candidate cleanup: {e}"))?;
        }
        Ok(())
    }
}

impl Drop for Candidate {
    fn drop(&mut self) {
        if let Err(err) = self.cleanup() {
            eprintln!("projecta: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Review-F4-r14 (Sonnet Befund 2): schreibt ein Kommando oberhalb seines
    /// CWD in das Temp-Root (`../stray.txt`), ist das Verzeichnis beim
    /// Cleanup nicht leer. Der bewusste Vertrag: laut scheitern und nichts
    /// rekursiv löschen — der Git-Worktree wird trotzdem entfernt, der Rest
    /// bleibt sichtbar liegen. Dieser Test pinnt genau dieses Verhalten,
    /// damit der Leak-Pfad eine Entscheidung bleibt und nicht vergisst.
    #[test]
    fn a_stray_file_above_the_checkout_fails_cleanup_loudly() {
        let dir = crate::testutil::TempDir::new("candidate-stray");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let candidate = Candidate::prepare(&repo, &code).expect("candidate");
        std::fs::write(candidate.root.join("stray.txt"), b"x").expect("stray");

        let err = candidate
            .cleanup()
            .expect_err("a non-empty root must fail loudly, not vanish recursively");
        assert!(err.contains("cleanup"), "the failure says where: {err}");
        assert!(
            !candidate.checkout.exists(),
            "the git worktree is removed even when the root stays"
        );
        assert!(
            candidate.root.join("stray.txt").exists(),
            "nothing below the root is deleted silently"
        );

        std::fs::remove_dir_all(&candidate.root).expect("test cleanup");
        // Drop retries cleanup; with the root gone it is a no-op Ok.
    }

    /// Review-F4-r25 (Opus F3): the byte-budgeted chunking must keep the
    /// positional assignment across chunk boundaries. A tampered file in a
    /// LATER chunk must be named by its own path. (Pinning: green against
    /// correct code; the 512-byte test budget forces several chunks.)
    #[test]
    fn a_tampered_file_in_a_later_chunk_is_named() {
        let dir = crate::testutil::TempDir::new("candidate-chunks");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        // 200 files × ~13 bytes of path each → several chunks at the test
        // budget.
        for i in 0..200 {
            std::fs::write(repo.join(format!("f{i:03}.txt")), format!("v{i}\n")).expect("write");
        }
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["add", "."])
            .output()
            .expect("git add");
        assert!(out.status.success());
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["commit", "--no-gpg-sign", "-m", "many files"])
            .output()
            .expect("git commit");
        assert!(out.status.success());

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let candidate = Candidate::prepare(&repo, &code).expect("candidate");
        std::fs::write(candidate.path().join("f150.txt"), "tampered\n").expect("tamper");
        let err = candidate
            .validate(&code)
            .expect_err("a tampered file in a later chunk must be caught");
        assert!(
            err.contains("f150.txt"),
            "the refusal names the tampered path: {err}"
        );
    }

    /// Review-F4-r25 (Opus F2): a chmod during the run changes the merge
    /// tree's mode — the raw comparison must invalidate. Unix only (NTFS has
    /// no exec bit); runs in Linux-CI/WSL, not on the Windows gate.
    #[cfg(unix)]
    #[test]
    fn a_mode_change_during_the_run_invalidates() {
        let dir = crate::testutil::TempDir::new("candidate-mode");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        std::fs::write(repo.join("run.sh"), "#!/bin/sh\nexit 0\n").expect("write");
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["add", "run.sh"])
            .output()
            .expect("git add");
        assert!(out.status.success());
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["commit", "--no-gpg-sign", "-m", "script"])
            .output()
            .expect("git commit");
        assert!(out.status.success());

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let candidate = Candidate::prepare(&repo, &code).expect("candidate");
        let target = candidate.path().join("run.sh");
        let mut perms = std::fs::metadata(&target).expect("meta").permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut perms, 0o755);
        std::fs::set_permissions(&target, perms).expect("chmod");
        let err = candidate
            .validate(&code)
            .expect_err("a mode change must invalidate");
        assert!(err.contains("changed mode"), "{err}");
    }

    /// Review-F4-r25 (Opus F2): a symlink replaced by a regular file with
    /// the link text as content must not pass as unchanged (unix; Windows
    /// checks out symlinks as text files under core.symlinks=false, where
    /// the fs::read fallback is the intended layout).
    #[cfg(unix)]
    #[test]
    fn a_symlink_replaced_by_a_regular_file_invalidates() {
        let dir = crate::testutil::TempDir::new("candidate-symlink-type");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        std::os::unix::fs::symlink("target.txt", repo.join("link.txt")).expect("symlink");
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["add", "link.txt"])
            .output()
            .expect("git add");
        assert!(out.status.success());
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["commit", "--no-gpg-sign", "-m", "symlink"])
            .output()
            .expect("git commit");
        assert!(out.status.success());

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let candidate = Candidate::prepare(&repo, &code).expect("candidate");
        let link = candidate.path().join("link.txt");
        std::fs::remove_file(&link).expect("remove symlink");
        std::fs::write(&link, "target.txt").expect("regular file with link text");
        let err = candidate
            .validate(&code)
            .expect_err("a symlink turned regular file must invalidate");
        assert!(err.contains("changed type"), "{err}");
    }

    /// Review-F4-r25 (Opus F2/F4): a non-UTF-8 tracked path gets a named
    /// refusal — never a silently mangled lossy path (unix: arbitrary bytes
    /// in file names; Windows cannot express them anyway).
    #[cfg(unix)]
    #[test]
    fn a_non_utf8_path_gets_a_named_refusal() {
        use std::os::unix::ffi::OsStrExt;
        let dir = crate::testutil::TempDir::new("candidate-nonutf8");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let bad = std::ffi::OsStr::from_bytes(b"bad\xff.txt");
        std::fs::write(repo.join(bad), b"x\n").expect("write");
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(&repo)
            .arg("add")
            .arg(bad)
            .output()
            .expect("git add");
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["commit", "--no-gpg-sign", "-m", "non-utf8"])
            .output()
            .expect("git commit");
        assert!(out.status.success());

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        // (no expect_err: Candidate has no Debug impl — let-else works without)
        let Err(err) = Candidate::prepare(&repo, &code) else {
            panic!("a non-UTF-8 path must be a named refusal");
        };
        assert!(err.contains("not UTF-8"), "{err}");
    }
}
