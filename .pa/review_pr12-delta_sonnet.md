# Delta review, W2-07b (PR #12), round A fixes

I worked only from the embedded diff and ran nothing. The diff has no absolute line numbers, so locations are given as file plus function or hunk.

**Answers to the specific questions**

- **Owner set:** The set {TokenUser, TokenOwner, Administrators} lets no foreign non-admin account through.
  - Only a holder of the SID with SE_GROUP_OWNER in its token can assign it as owner, or a holder of SeRestore or SeTakeOwnership. Only elevated admins hold these for Administrators, and only the user or a privileged principal for TokenUser.
  - Objects created by LocalSystem services also carry Administrators as owner. That is privileged, not foreign-user, so it stays inside the threat model (see D1).
- **New order in `write_descriptor_body`:** It is sound. The open is share-0, then `refuse_links`, `verify_owned`, `restrict`, `set_len(0)`, write and sync. Every refusal now leaves the old content byte-identical. Two error-path caveats are in D6.
- **Link swap after the check:** There is no bypass on the file. Everything after the open is handle-based, so the checked object is the written object. A hard link added later only adds a name for our own, now user-only, object. The residual path-based check-then-use is on the directory (D3).
- **Retry condition:** `raw_os_error() == Some(32)` is correct. The gap is delete-pending (D5).

## Findings

**D1 (low), `credential_acl.rs`, `owner_accepted` and `administrators_sid`**
Administrators is accepted unconditionally. The justification is "files this process legitimately created". That only holds when the token user is an administrator, meaning the token contains the Administrators group. For a standard user, an Administrators-owned file at the descriptor path was necessarily not created by this user's runs. It was created by an admin or a SYSTEM installer or service. Such a file is accepted, re-ACL'd to the user, and its owner keeps implicit WRITE_DAC on it.
- **Suggestion:** accept Administrators only when `TokenGroups` contains S-1-5-32-544, enabled or deny-only. Otherwise document this as accepted residual.
- **Impact:** low, because admins can take ownership anyway.

**D2 (medium-low), `credential_acl.rs`, `refuse_links`**
`FILE_ATTRIBUTE_REPARSE_POINT` is refused for every tag.
- **Problem:** Non-link reparse points also carry that attribute. Examples are OneDrive/cloud-files placeholders, WOF/CompactOS and dedup. A data or agent-access directory under OneDrive Known Folder Move can then fail startup closed, with no way out except moving the data directory.
- **Suggestion:** read the tag (`GetFileInformationByHandleEx` with `FileAttributeTagInfo`) and refuse only name-surrogate tags: `IO_REPARSE_TAG_SYMLINK`, `MOUNT_POINT`, or `IsReparseTagNameSurrogate`. If blanket refusal is intended, say so in the error and in the docs.

**D3 (low), `credential_acl.rs`, `restrict_directory_to_current_user`, with `agent_access.rs` issuance**
The directory handle is dropped on return. The next step is `directory.join(..).open(create_new)`, which resolves the path again. Between the two, the directory could be swapped for a junction. That needs write access to the parent, and the file's DACL is narrowed before any token is written, so the exposure is small. Two options:
- Hold the directory handle until the file is created.
- After creating the file, verify with `GetFinalPathNameByHandle` that it lives under the checked directory.

Also, intermediate path components (the data-directory parents) are never link-checked. Only the final component is. That is acceptable, but the doc comment should say so.

**D4 (low), `credential_acl.rs`, `restrict_directory_to_current_user`**
This function has no `verify_owned` pre-check. `restrict_handle` replaces the DACL first and only then discovers a foreign owner. The file path got "check before change" in this delta, but the directory path did not. A foreign-owned `agent-access` whose DACL happens to grant us WRITE_DAC gets rewritten before being refused. Adding `verify_owned(&file)?` after `refuse_links` gives parity.

**D5 (low), `open_with_sharing_retry`**
- **Delete-pending:** A file in delete-pending state (a scanner or a previous instance mid-delete) surfaces as ERROR_ACCESS_DENIED, not 32. It fails immediately and is not retried.
- **Blocking sleep:** `std::thread::sleep` blocks for up to about 1 s. If the issuer runs on an async worker or under a lock, that stalls the runtime or the lock. Please confirm the call context.

**D6 (low), `credential_acl.rs` and `api.rs`, error paths**
- **No remediation in refusals:** `verify_owned` returns "credential file is owned by another account", with no path and no hint. The refusal is deliberately sticky, so a legitimately wedged user (a recreated account, or a restored profile) gets no guidance. Include the path and "delete the file if you trust it".
- **Old wide-ACL content stays:** When the narrowing fails for real (`SetKernelObjectSecurity` errors), the old descriptor keeps its old, possibly wide ACL and its old token. The truncate-first order removed that exposure. This is a defensible trade of exposure for availability, but it should be documented.
- **Empty file on failure:** A file newly created by `OPEN_ALWAYS` and then refused remains as a 0-byte descriptor. The issuer path deletes its file on failure, so the two paths are inconsistent.

**D7 (low-medium), tests: coverage gaps in `credential_acl.rs` tests**
- **Reparse refusal:** There is no test for it. A junction over `agent-access` (`mklink /J`, no privilege needed) would pin both `FILE_FLAG_OPEN_REPARSE_POINT` and `refuse_links` for directories. The hard-link test covers only the file half.
- **Administrators SID:** `the_administrators_group_is_an_accepted_owner` is near-tautological. It feeds `administrators_sid()` into the function that consumes it, so a wrong well-known-SID constant still passes. Pin the bytes to S-1-5-32-544 in production and oracle alike.
- **Directory seam at issuer level:** `FAIL_NEXT_DIRECTORY_RESTRICT` is only exercised at unit level. The reason for the split was the issuer's directory step consuming the file's flag. Add an issuer-level test that a failing directory step aborts issuance and creates no file.
- **Timing margin:** `a_briefly_held_descriptor_handle_is_waited_out` uses 300 ms of hold against a 1 s budget. That could flake on a starved CI runner. Consider a channel-based release.
- **`WinWorldSid` import:** `a_world_sid_is_not_an_accepted_owner` uses `WinWorldSid`. I cannot confirm from the delta that it is imported in the test module. Please verify it compiles.
- **Not covered at all:** an elevated↔unelevated cross-run. That belongs in `NICHT ABGEDECKT`.

**D8 (low), `oneshot.rs`, `make_private_checked`**
Unix parity is only partial.
- `path.is_dir()` and `set_permissions` both follow symlinks, so a planted `agent-access` symlink is not refused. It only fails for a non-owner target, and never for root.
- The mode is picked by `is_dir()`, so a missing path silently selects 0o600 before failing with NotFound.
- Directories are created with the umask mode and only chmod'ed afterwards. `DirBuilder::mode(0o700)` would close that gap.
- Fail-closed now aborts issuance on filesystems where chmod fails (vfat, drvfs, some network mounts). That is consistent with Windows, but it should be noted in the docs.

**D9 (nit), repo hygiene**
- **Review labels in comments:** They read "grok F4", "sonnet F6" and "grok F1 / sonnet F1", and this is the sign of a real problem. The IDs are ambiguous (two F1s) and mean nothing to a future reader of a public repo. Keep the rationale and move the IDs to `.pa/review_*_disposition.md`.
- **Repeated token opens:** `read_security` now opens the token four times per call: `current_user_sid`, `current_user_sid` again inside `owner_accepted`, the token owner, and the Administrators SID. It is harmless but easy to trim.
- **Same name for field and function:** `owner_accepted` names both a struct field and a function in one module, which is legal but confusing.
- **Secrets, personal data and local paths:** I found none in the delta.

## Seams and cleanup proof

Moving `FAIL_NEXT_RESTRICT` into `restrict_to_current_user` means it fires after the DACL is applied and verified. That still proves the issuer's file cleanup. `a_failed_restriction_preserves_the_existing_descriptor` proves restrict-before-truncate and is non-vacuous. It would be red against the old truncate-at-open code. The hard-link test is non-vacuous in the same way. `an_existing_wide_open_descriptor_is_narrowed_on_boot` asserts no explicit precondition. The `protected` flag in `assert_owner_only` makes it non-vacuous anyway, because a plain `fs::write` gives an inherited, unprotected DACL.

## Verdict: approve with conditions

The fixes address the round-A findings without opening a foreign-identity hole.

**Conditions**
- **D2:** Make the reparse check tag-aware, or explicitly accept and document the OneDrive/WOF availability regression.
- **D7:** Add a junction test for the directory, and pin the Administrators SID bytes.
- **D4 and D6:** Either add the directory owner pre-check and path-bearing errors, or record them as accepted in the disposition file.

D1, D3 and D5 can be follow-ups if they are recorded in the disposition.
