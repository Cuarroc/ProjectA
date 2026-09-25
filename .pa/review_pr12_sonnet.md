# Review of W2-07b (PR #12)

I reviewed the embedded diff only. I read no other files and ran no code. Line numbers are approximate, taken from the diff hunks. Where a finding depends on code outside the diff, I say so.

## Findings

**F1 (high): the owner check breaks across elevation boundaries and can permanently block startup**
`credential_acl.rs`, `token_owner_sid` and `validate_owner_only`; `api.rs`, `write_descriptor_body`

- The check compares the file owner with the process's `TokenOwner`. For an elevated admin token that is normally `BUILTIN\Administrators`. For an unelevated token it is the user.
- The change only handles "elevated run reads a file it created". It does not handle a file that outlives the process.
- `projecta-api.json` and `agent-access/` persist across runs, and both new paths keep the existing object's owner:
  - `write_descriptor_body` uses `create(true).truncate(true)`, which Rust maps to `CREATE_ALWAYS`. On an existing file the owner is not reset.
  - `create_dir_all` and `restrict_directory_to_current_user` also keep the existing owner.
- Scenario A: the user runs the app once elevated. The file and directory are then owned by Administrators, and the DACL names the user's SID.
  - Every later unelevated start opens the file fine, because the user has `FILE_ALL_ACCESS`, including `WRITE_DAC`.
  - `verify_owner_only` then fails with "owned by another account".
  - Startup fails closed on every launch until someone deletes the file by hand. The `agent-access/` directory fails the same way, so every scoped launch fails too.
- Scenario B: the reverse order. The file is owned by the user, and an elevated run compares it with Administrators and is refused.
- The bug is that the file's owner is compared against a single SID.
- Fixes:
  - Accept the owner if it equals `TokenUser` or `TokenOwner`. This is still not enough for Scenario A, where the file is Administrators-owned and the process is unelevated.
  - Or, on an owner mismatch, delete the file and recreate it with `create_new`. For the directory, recreate it or apply a policy.
  - I recommend delete and `create_new`. It also fixes F4.
- Also confirm whether any reader-side code (`pa`, agent, CLI) calls `verify_owner_only`. If so, an unelevated `pa` reading a descriptor from an elevated app is now rejected.

**F2 (high, probable): the oracle tests compare against `TokenUser`, production against `TokenOwner`**
`credential_acl_tests.rs`, `read_dacl` and `assert_owner_only`

- The oracle sets `owner_is_user` from `TokenUser` and asserts it. Production accepts `TokenOwner`. The two definitions disagree.
- Under an elevated shell, or on the GitHub-hosted Windows runner (an elevated admin), files are typically owned by Administrators.
- Then `broad_descriptor_grants_only_the_current_user`, `agent_access_directory_grants_only_the_current_user` and the scoped test would fail on `owner_is_user`, while production behaves as designed.
- `gates (windows)` is a stub on PRs, so the first real verdict would be the merge-queue run, which ejects the PR.
- Make the oracle use the same rule as production (owner ∈ {user, token owner}), and run the tests once in an elevated shell.
- Please verify on an elevated console before merge.

**F3 (medium): `share_mode(0)` makes issuance flaky under concurrency and with scanners**
`agent_access.rs` (new call on every issuance); `credential_acl.rs`, `restrict_directory_to_current_user`; `api.rs`, `write_descriptor_body`

- The directory is now opened with share mode 0 on every descriptor issuance. Any other open handle on `agent-access/` makes the call fail with `ERROR_SHARING_VIOLATION`. Sources include:
  - a parallel issuance for another worker (the queue dispatches workers in parallel)
  - an AV or indexer scan
  - a `ReadDirectoryChangesW` watcher
  - Explorer
- That becomes a fail-closed launch error. Unless issuance is serialized (not visible in the diff), this will fail intermittently.
- For a directory, share 0 buys little. The handle is only used for `WRITE_DAC` and the read-back.
- Use `FILE_SHARE_READ | WRITE | DELETE` for the directory, or a bounded retry on sharing violation.
- The broad descriptor has the same issue at startup. A `pa` CLI or AV holding the old `projecta-api.json` open makes startup fail. Previously `std::fs::write` used full sharing. A bounded retry is enough.
- Any process holding an open handle to the file can now block startup. This is acceptable as fail-closed, but it is a new DoS vector.

**F4 (medium): `CREATE_ALWAYS` follows links and hard links, and is inconsistent with the scoped path**
`api.rs`, `write_descriptor_body`; `credential_acl.rs`, `restrict_directory_to_current_user`

- The scoped writer uses `create_new`. The broad writer uses create+truncate.
- With `CREATE_ALWAYS`, a planted symlink or hard link at `projecta-api.json` is followed. The victim-owned target is truncated and its DACL is replaced with "user-only, protected". The token is written into it.
- The directory open has `FILE_FLAG_BACKUP_SEMANTICS` but no `FILE_FLAG_OPEN_REPARSE_POINT`. An `agent-access` junction to a victim-owned directory gets its DACL rewritten. That is DoS or integrity damage to an arbitrary user directory, for example locking out SYSTEM and Administrators.
- The owner check only stops attacker-owned targets.
- The attacker needs write access to the data directory. That is plausible under an overridden data dir, which is the scenario the module doc cites.
- Fix: remove the file and use `create_new`. Or open with `FILE_FLAG_OPEN_REPARSE_POINT` and refuse a reparse point or a link count above 1 via `GetFileInformationByHandle`. Do the same for the directory.

**F5 (medium/low): the parent directory of the broad descriptor stays wide**
`api.rs`; `agent_access.rs`

- Only the file and `agent-access/` are narrowed. The data directory that contains `projecta-api.json` and `agent-access/` is not.
- A principal with `FILE_DELETE_CHILD` on the parent can delete or replace `projecta-api.json` regardless of the file DACL. It can also rename `agent-access/` or swap in a junction.
- On the write side, the owner check and the `WRITE_DAC` requirement fail closed against an attacker-owned replacement. That is good.
- On the read side (CLI/agent), a planted descriptor that points at an attacker's port with an attacker's token would redirect the client's requests. This depends on whether readers check the owner or DACL. That code is not in the diff, so I can't judge it.
- Please state the trust boundary for the data directory (profile-only versus overridable), and whether readers verify the owner.

**F6 (medium/low): the failure-injection flag is now consumed by the directory step**
`credential_acl.rs`, `FAIL_NEXT_RESTRICT` check in `restrict_handle`; `agent_access.rs`

- The flag is checked inside `restrict_handle`, which the new directory restriction reaches first. Without seeing the test, this looks likely.
- The existing "failed restriction leaves neither file nor grant behind" test now fails at the directory step. The file-cleanup path it was meant to cover no longer runs. The test probably still passes, so the coverage loss is silent.
- Give the directory and file restrictions separate injection points, or add a test where the directory succeeds and the file fails.

**F7 (low/medium): test gaps**

- No test for a fail-closed `write_descriptor` (a failed restriction, a foreign-owned file, or a share violation) leaving no token on disk.
- No test for self-healing. Nothing pre-creates a wide-DACL `projecta-api.json` or `agent-access/` and checks they are narrowed.
- `a_restricted_directory_passes_the_same_check` does not assert the following:
  - the directory ACE flags are `OBJECT_INHERIT | CONTAINER_INHERIT`
  - a child created inside inherits only the user ACE and has no SYSTEM or Administrators entry before the writer replaces its DACL
- The owner tests use a crafted snapshot. Nothing exercises `token_owner_sid` or `EqualSid` against a real owner (F1 would have shown up here). Nothing covers elevated versus unelevated reuse of an existing file.
- No test for symlink, junction or hard-link planting (F4), or for concurrent issuance with share 0 (F3).
- Old descriptor files that predate this change and carry wide ACEs are not swept. Narrowing the directory does not propagate to existing children.

**F8 (low): Unix parity is weaker than stated**
`agent_access.rs` (`#[cfg(unix)]`); `api.rs`

- `make_private` swallows errors, so the Unix side is not fail-closed. Please confirm that `make_private` applies `0o700` to a directory rather than `0o600`. The new assertion implies it, but the code is not shown.
- The broad descriptor on Unix is written with `std::fs::write` (umask-dependent mode, or the old mode if it pre-exists) and chmod'd afterward. The token is on disk with the wrong mode for a short window. This is not new, but it contradicts "before the token touches disk". `OpenOptions::mode(0o600)` plus a permissions fix before writing would close it.
- There is no owner or symlink check on Unix. `chmod` on a planted symlink follows it.
- The `#[cfg(unix)]` directory `make_private` does change Unix behavior. That is intended, but the question about `#[cfg(windows)]` changes is answered "no": the Windows-only code does not touch Unix.

**F9 (low): the guarantee is documented more strongly than it holds under elevation**
`credential_acl.rs`, module doc

- When the owner is Administrators, every elevated member of that group has implicit `READ_CONTROL` and `WRITE_DAC` on the file. "User-only" then means "user plus local admins". That is a defensible tradeoff, since admins can take ownership anyway. Say so in the doc.
- The user-only directory DACL removes SYSTEM and Administrators from it. Uninstallers, backup tools and cleanup by another elevated principal need `SeTakeOwnership` or backup privileges. This is an operational note.

## Answers to your specific questions

- **Share mode 0, narrow-before-write order, protected flag:** correct in concept. The token is written only after `SetKernelObjectSecurity` and the read-back. Residual risks are the sharing failures in F3 and the link-following in F4.
- **Inheritance flags on the directory ACE:** `OBJECT_INHERIT | CONTAINER_INHERIT` without `INHERIT_ONLY`. The ACE therefore applies to the directory itself and its children. The ACE is mutated before it is put into the descriptor, so the flags are carried. This part is sound.
- **`TokenOwner` versus `TokenUser`:** it does not let foreign user-owned files through. The problems are false rejections (F1) and the Administrators-owner case (F9).
- **TOCTOU:** after the handle-based narrow and read-back there is no meaningful window for the file. For the directory, a handle opened by another process before the restrict causes a sharing failure, so it fails closed. The wide parent (F5) is the remaining gap.
- **Fail-closed paths:** the Windows paths return errors. The truncated empty broad file is left behind when narrowing fails. That is harmless except that it wipes a running instance's descriptor. Unix swallows errors (F8).
- **Public-repo hygiene:** nothing in the diff (no secrets, personal data or local paths). The working tree has unrelated changes to `docs/dev-hq/data.*` and untracked `.pa/` files. Keep them out of the PR commit.

## Verdict

**Approve with conditions.**

- Must fix before merge: F1 (owner logic across elevation, and the file recreate policy) and F2 (make the oracle consistent with production, and run it elevated).
- Should fix: F3 (directory sharing and retry), F4 (reparse and hard-link handling, `create_new`) and F6 (separate injection points).
- The rest can be follow-ups with tests, F7 first.
