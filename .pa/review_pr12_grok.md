## Findings

### F1 — High — Owner check breaks across elevation, then sticks
`src-tauri/src/api/credential_acl.rs:118` (`token_owner_sid`), `src-tauri/src/api/credential_acl.rs:262` (`EqualSid` against `TokenOwner`), `src-tauri/src/api/credential_acl.rs:324` (`validate_owner_only`), `src-tauri/src/api.rs:1054` (`truncate(true)` before restrict)

Comparing the file owner to `TokenOwner` is the wrong identity for a desktop process that sometimes runs elevated.

`TokenOwner` is the user SID in a normal token and `BUILTIN\Administrators` in an elevated token. `CreateFile` stamps that same SID as owner and never changes it later. `SetKernelObjectSecurity` in this diff updates only the DACL. So a file or `agent-access/` directory created by this app at one elevation fails `verify_owner_only` at the other:

- Normal launch, then “Run as administrator”: owner is the user, `TokenOwner` is Administrators, startup or issuance returns “owned by another account”.
- Elevated launch first (admin prompt, elevated updater, elevated CI), then a normal launch: owner is Administrators, `TokenOwner` is the user, same refusal.

A different non-admin user’s SID still fails the comparison, so that part of the threat model holds. What the predicate treats as “us” is “whoever this token would assign as owner right now,” which splits one user in two and, while elevated, merges every Administrators-owned object into “us”.

The failure is sticky. `write_descriptor_body` opens with `create(true).truncate(true)`, so `CREATE_ALWAYS` destroys the previous token before `restrict_to_current_user` runs. On owner mismatch the function returns after that truncate and does not delete and recreate. The next start opens the same empty, wrong-owner file and refuses again. `restrict_directory_to_current_user` has the same order: it rewrites the DACL, then `verify_owner_only` fails, and the directory is left in place for the next issuance to refuse. Recovery is a manual delete.

A check that matches the stated threat model (other local users, who have implicit `WRITE_DAC` as owner) accepts an owner that is either the token user or `BUILTIN\Administrators`. Both are SIDs a non-admin cannot assign to a new object. `TokenOwner` alone does not.

### F2 — Medium — Credential opens follow reparse points
`src-tauri/src/api.rs:1047` (`write_descriptor_body` open), `src-tauri/src/api/credential_acl.rs:192` (`restrict_directory_to_current_user` open)

Both new opens use default `CreateFile` semantics. There is no `FILE_FLAG_OPEN_REPARSE_POINT` and no rejection of a symlink or junction. The threat model in the module comment is an overridden data directory whose parent may grant `Users` or `Everyone`. On that parent, an unprivileged account can replace a directory with a junction.

Effects:

- `CREATE_ALWAYS` truncates the target before the owner check. A junction or symlink to another file this user owns is wiped, then receives the API token if its owner SID matches `TokenOwner`.
- A junction for `agent-access/` is what `restrict_directory_to_current_user` locks, because `FILE_FLAG_BACKUP_SEMANTICS` still follows the reparse point. The owner check runs only after `SetKernelObjectSecurity` has already replaced the target’s DACL.

The file critical section after a successful open is sound: share mode 0, DACL replace, read-back, then `write_all`. A handle opened earlier conflicts with share mode 0 and the open fails closed. The hole is the path resolution before that section.

### F3 — Medium — Directory DACL is not held across child creation
`src-tauri/src/api/agent_access.rs:195`, `src-tauri/src/api/credential_acl.rs:194`

`restrict_directory_to_current_user` opens the directory with share mode 0, sets the DACL, verifies, and drops the handle when the `File` ends. `RunCredentialIssuer` then calls `new_token()` and `create_new` on a joined path. The exclusive handle does not cover that gap, and the child is not created relative to the directory handle.

Anyone who can rename or recreate under the parent (the same overridden, broadly writable data directory) can swap `agent-access/` after the lock is released. The issuance then writes into the replacement. Scoped-file narrowing still runs on the new file before the token is written, so this does not by itself hand the token to another account. It does skip the control this PR adds: who may list, plant, or delete in the directory that issuance actually uses. `create_dir_all` and the restrict call have the same gap in the other direction, before the first lock.

Closing it means keeping the directory open and creating the child from that handle (or re-checking the directory’s file id after the swap window), and refusing a reparse point at open (F2).

### F4 — Medium — Unix directory hardening cannot fail the issuer
`src-tauri/src/api/agent_access.rs:197`

The Windows branch propagates `restrict_directory_to_current_user` with `?`. The Unix branch calls `make_private` and ignores the result. This diff does not change `make_private`. The new test requires `agent-access/` to be `0o700`.

If that helper is the existing file chmod to `0o600`, the directory has no search bit, opening `agent-access/<token>.json` fails, and the new assertion fails on Linux. If the helper is best-effort and a chmod error is discarded, issuance continues with the `create_dir_all` mode (typically `0o755` under umask `022`): list, plant, and delete stay open to the group or to everyone, which is the failure mode the Windows path now refuses.

The Unix file write itself is unchanged (`write_descriptor_body` is `std::fs::write` under `#[cfg(not(windows))]`). No Windows-only change leaks into the Unix file path.

### F5 — Medium — Oracle and unit tests do not lock the owner or inheritance claims
`src-tauri/src/api/credential_acl_tests.rs:102` (owner `EqualSid` against the `TokenUser` buffer), `src-tauri/src/api/credential_acl_tests.rs:175` (`assert_owner_only`), `src-tauri/src/api/credential_acl.rs:515` (`crafted`), `src-tauri/src/api/credential_acl.rs:141` (inherit flags)

The production owner check uses `TokenOwner`. The oracle sets `owner_is_user` by comparing `GetSecurityDescriptorOwner` to `TokenUser`, and `assert_owner_only` requires that flag for the broad descriptor, the directory, and the scoped file. Whenever the process is elevated those SIDs differ: production accepts an Administrators-owned file it just created, and the oracle fails it. Windows CI runners are commonly elevated, so this new assertion can fail jobs that the old DACL-only oracle passed. A run that is not elevated never notices F1.

`a_foreign_owner_is_refused_even_with_a_narrow_acl` only flips `owner_is_token_owner` on a hand-built `SecurityRead`. It does not call `read_security`, so a broken `GetSecurityDescriptorOwner` / `EqualSid` path still passes. Nothing in the suite creates an Administrators-owned object, toggles elevation, or checks a real foreign owner (the comment correctly notes `SeTakeOwnership` is unavailable). The snapshot test would still pass if the live compare were hardcoded.

`restrict_handle(..., true)` sets `OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE`, but `validate_owner_only` does not require those flags, and `assert_owner_only` does not either. `a_restricted_directory_passes_the_same_check` creates `child.json` and immediately calls `restrict_to_current_user`, so a child that inherited `SYSTEM` / `Administrators` from the creator default DACL is never observed. Dropping the inherit bits would leave the directory user-only (listing and planting still fail for other users) while new files briefly inherit the token default DACL. File narrowing still runs before the token write, so this is defense in depth, and it is currently untested.

Also untested: broad-descriptor restrict failure (scoped issuance has an injection test; `write_descriptor_body` does not), share mode 0, and reparse refusal.

### F6 — Low — Share mode 0 on the directory fails closed against harmless openers
`src-tauri/src/api/credential_acl.rs:194`

Share mode 0 is the right exclusive section for the credential **file**, where the handle is held from open through `sync_all`. On `agent-access/` the same mode is taken on every issuance and then dropped. Any existing opener of that directory — indexer, Defender, Explorer, a second issuance in this process — makes `CreateFile` fail, and the `?` aborts credential issuance. The open cannot tell an attacker holding a pre-narrowing handle from the shell. For a long-lived directory that is re-locked on every run, that is a standing availability failure. File opens are unaffected.

### F7 — Low — `make_private` runs again after the Windows narrow
`src-tauri/src/api.rs:1032`

`write_descriptor` still calls `make_private(&path)` after `write_descriptor_body` returns. The handle with share mode 0 is already closed; the token is on disk under the DACL just verified. This diff does not show `make_private`. A Windows implementation that reopens the path and resets the DACL would run after the fail-closed narrow, and the call site does not check a result. A no-op on Windows is fine. Worth confirming in `oneshot`, because this PR’s comment says the Windows work is already finished inside `write_descriptor_body`.

No secrets, personal data, machine SIDs, or local paths appear in the diff. Test directory prefixes are generic (`api-w207b-broad`, `api-w207b-dir`). Nothing here is unfit for a public repository on content grounds.

The broad-descriptor write order that is in scope is otherwise right: share mode 0, `WRITE_DAC | READ_CONTROL`, `restrict_to_current_user`, then `write_all` + `sync_all`, with every Windows error returned. Existing DACL rules (protected, no inherited ACE, no deny, user allow with read) are intact. The directory ACE is `OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE` without `INHERIT_ONLY`, so the directory itself stays user-only and new children inherit that grant instead of the token default DACL.

## Verdict

**Approve with conditions.** Do not merge until F1 is fixed: accept owner ∈ {token user, Administrators}, and on mismatch delete and recreate (or check owner before truncate) so a rejected object cannot wedge startup. F2 and F3 should land in the same change if the overridden data directory is a real configuration. F4 and F5 need a green Linux mode check and an oracle that uses the same owner predicate as production, including one elevated and one unelevated case.
