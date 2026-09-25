# Delta Review W2-07b (PR #12) — fixes from review round A

You are reviewing the DELTA of a pull request as an external reviewer. Do NOT
use any tools, do NOT read or modify any files — the complete delta diff is
embedded below. Respond with findings only.

## Context

ProjectA is a public Tauri 2 desktop app (Rust backend). PR #12 (W2-07b)
hardens the Windows ACLs of `projecta-api.json` and the `agent-access/`
directory fail-closed to the current user and verifies the file owner. You (or
a fellow reviewer) reviewed the full diff in round A; the author then fixed
the accepted findings. This delta (two commits, `test` then `fix`) contains
exactly those fixes:

1. **Owner set (round-A finding: cross-elevation false refusal + sticky
   wedge).** The owner check now accepts the token user, the token's default
   owner, AND the BUILTIN\Administrators group (`owner_accepted` in
   `credential_acl.rs`) — the three identities this process's files can
   legitimately carry across elevated/unelevated runs. A foreign non-admin
   account can assign none of them. Auto-delete of foreign-owned files was
   deliberately NOT added: a foreign owner is an attack signal and stays
   fail-closed. Additionally the owner is now checked BEFORE truncation:
   `write_descriptor_body` opens without `truncate`, runs `refuse_links` →
   `verify_owned` → `restrict_to_current_user`, and only then
   `set_len(0)` + write + sync.
2. **Link refusal (round-A: CREATE_ALWAYS follows symlinks/hard links).** Both
   the broad descriptor and the directory are opened with
   `FILE_FLAG_OPEN_REPARSE_POINT`; `refuse_links` rejects reparse points and
   files with more than one hard link via `GetFileInformationByHandle`.
3. **Sharing retry (round-A: share mode 0 vs. scanners/parallel issuance).**
   `open_with_sharing_retry` retries ERROR_SHARING_VIOLATION for ~1 s
   (25 × 40 ms) before failing closed.
4. **Injection seams (round-A: directory step consumed the file's failure
   flag).** `FAIL_NEXT_RESTRICT` moved from the shared `restrict_handle` into
   the file-only `restrict_to_current_user`; the directory has its own
   `FAIL_NEXT_DIRECTORY_RESTRICT`.
5. **Unix parity (round-A: `make_private` error discarded).** The
   `agent-access/` directory chmod on Unix now propagates its error via the
   new `oneshot::make_private_checked` (0o700 for directories).
6. The oracle tests (`credential_acl_tests.rs`) now mirror the production
   owner set, pin the inheritable directory ACE, and add a self-healing pin.

## What to check especially

- Does the owner set {TokenUser, TokenOwner, Administrators} let any FOREIGN
  identity through? Consider who can assign each SID as owner.
- Is the new order in `write_descriptor_body` (open no-truncate → refuse_links
  → verify_owned → restrict → set_len → write) sound? Any window or any error
  path that now leaves a wider or destroyed file than before?
- `refuse_links`: is the link count / reparse check correct for files and
  directories? Anything bypassing it (e.g. a link swapped in AFTER the check,
  before write)?
- `open_with_sharing_retry`: correctness of the retry condition; any error it
  wrongly retries or wrongly aborts.
- The moved injection flags: do the seams still prove the cleanup paths?
- The new/updated tests: do they actually pin the fixed behavior? Any test
  that passes vacuously?
- Anything unfit for a PUBLIC repository (secrets, personal data, local
  paths)?

Output format: findings with ID (D1, D2, ...), severity (high/medium/low),
file:line, reasoning. End with an overall verdict (approve / approve with
conditions / reject).

## Delta diff (base: 0acbaac, the round-A review candidate)

```diff
diff --git a/src-tauri/src/api.rs b/src-tauri/src/api.rs
index a9cc625..e9a5dfa 100644
--- a/src-tauri/src/api.rs
+++ b/src-tauri/src/api.rs
@@ -1036,24 +1036,36 @@ fn write_descriptor(dir: &Path, port: u16, token: &str) -> Result<PathBuf, Strin
 
 /// Windows: the broad descriptor holds the same key to the app as a scoped
 /// one, so it gets the same treatment (W2-07b). The file is opened with share
-/// mode 0 and its DACL is narrowed to the current user before the token
-/// touches the disk; a file that cannot be narrowed or that belongs to
-/// another account fails startup closed instead of being trusted.
+/// mode 0 (with a bounded retry on sharing violations), planted links and a
+/// foreign owner are refused before a byte changes, and its DACL is narrowed
+/// to the current user before the token touches the disk; a file that cannot
+/// be narrowed fails startup closed instead of being trusted.
 #[cfg(windows)]
 fn write_descriptor_body(path: &Path, body: &[u8]) -> Result<(), String> {
     use std::os::windows::fs::OpenOptionsExt;
     use windows_sys::Win32::Foundation::GENERIC_WRITE;
-    use windows_sys::Win32::Storage::FileSystem::{READ_CONTROL, WRITE_DAC};
-    let mut file = std::fs::OpenOptions::new()
-        .write(true)
-        .create(true)
-        .truncate(true)
-        .access_mode(GENERIC_WRITE | WRITE_DAC | READ_CONTROL)
-        .share_mode(0)
-        .open(path)
-        .map_err(|e| format!("failed to open {}: {e}", path.display()))?;
+    use windows_sys::Win32::Storage::FileSystem::{
+        FILE_FLAG_OPEN_REPARSE_POINT, READ_CONTROL, WRITE_DAC,
+    };
+    let mut file = credential_acl::open_with_sharing_retry(
+        &format!("failed to open {}", path.display()),
+        || {
+            std::fs::OpenOptions::new()
+                .write(true)
+                .create(true)
+                .access_mode(GENERIC_WRITE | WRITE_DAC | READ_CONTROL)
+                .share_mode(0)
+                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
+                .open(path)
+        },
+    )?;
+    // No truncate at open: a refused file keeps its previous content (the
+    // running instance's descriptor), and only a verified file is emptied.
+    credential_acl::refuse_links(&file, &path.display().to_string())?;
+    credential_acl::verify_owned(&file)?;
     credential_acl::restrict_to_current_user(&file)?;
-    file.write_all(body)
+    file.set_len(0)
+        .and_then(|()| file.write_all(body))
         .and_then(|()| file.sync_all())
         .map_err(|e| format!("failed to write {}: {e}", path.display()))
 }
diff --git a/src-tauri/src/api/agent_access.rs b/src-tauri/src/api/agent_access.rs
index bd3eacf..9ab0bac 100644
--- a/src-tauri/src/api/agent_access.rs
+++ b/src-tauri/src/api/agent_access.rs
@@ -194,8 +194,11 @@ impl RunCredentialIssuer {
             // three open. Fail closed like the file restriction below.
             #[cfg(windows)]
             super::credential_acl::restrict_directory_to_current_user(&directory)?;
+            // Unix parity (0o700), fail closed like the Windows branch: an
+            // unchanged, still-group-readable directory must abort the
+            // issuance, not sail on (W2-07b review round, grok F4).
             #[cfg(unix)]
-            crate::oneshot::make_private(&directory);
+            crate::oneshot::make_private_checked(&directory)?;
             let path = directory.join(format!("{}.json", new_token()?));
             let mut options = std::fs::OpenOptions::new();
             options.write(true).create_new(true);
diff --git a/src-tauri/src/api/credential_acl.rs b/src-tauri/src/api/credential_acl.rs
index bca9ae2..80e1c25 100644
--- a/src-tauri/src/api/credential_acl.rs
+++ b/src-tauri/src/api/credential_acl.rs
@@ -9,13 +9,30 @@
 //! overridden data directory possibly `Users` or `Everyone`. So the writers
 //! replace the DACL with a protected one holding a single ACE for the token
 //! user, read it back through the same handle and refuse to write the token
-//! unless the read-back is exactly that narrow and the file belongs to this
-//! process's owner identity (fail closed). A generous DACL on a file owned by
-//! another account is refused the same way: somebody else planted it.
+//! unless the read-back is exactly that narrow and the file belongs to one of
+//! this process's owner identities (fail closed). A generous DACL on a file
+//! owned by another account is refused the same way: somebody else planted it.
 //!
-//! The handle is opened with share mode 0, so between `CreateFileW` and the
-//! new DACL no other process can open the still-empty file and keep a handle
-//! whose access was checked against the inherited ACL.
+//! The accepted owner identities are the token user, the token's default
+//! owner, and the Administrators group: whatever SID a file this process
+//! created can legitimately carry, elevated (Administrators) or not (the
+//! user), in any order of runs. A foreign non-admin account can assign none
+//! of them, so the threat model - other local users, who as owner hold
+//! implicit WRITE_DAC - is unchanged. Note the trade-off: an
+//! Administrators-owned file is readable by every elevated local admin, so
+//! "user-only" then means "user plus local admins" - defensible, because an
+//! admin can take ownership anyway. The owner is checked before the content
+//! is truncated, so a refused object is left untouched instead of destroyed.
+//!
+//! The handle is opened with share mode 0 (with a bounded retry on sharing
+//! violations: a scanner or a parallel issuance holds the object for
+//! milliseconds, and failing the launch on the first conflict would trade
+//! availability for nothing), so between `CreateFileW` and the new DACL no
+//! other process can open the still-empty file and keep a handle whose access
+//! was checked against the inherited ACL. Reparse points (symlinks,
+//! junctions) and files reachable through a second hard link are refused:
+//! `CreateFileW` would otherwise follow a planted link and truncate and
+//! re-ACL the target.
 //!
 //! [`restrict_directory_to_current_user`] applies the same rule to the
 //! `agent-access/` directory: the directory decides who may list it, plant
@@ -31,15 +48,16 @@ use std::path::Path;
 
 use windows_sys::Win32::Foundation::{CloseHandle, FALSE, HANDLE, TRUE};
 use windows_sys::Win32::Security::{
-    AclSizeInformation, AddAccessAllowedAce, EqualSid, GetAce, GetAclInformation,
-    GetKernelObjectSecurity, GetLengthSid, GetSecurityDescriptorControl, GetSecurityDescriptorDacl,
-    GetSecurityDescriptorOwner, GetTokenInformation, InitializeAcl, InitializeSecurityDescriptor,
-    IsValidSid, SetKernelObjectSecurity, SetSecurityDescriptorControl, SetSecurityDescriptorDacl,
-    TokenOwner, TokenUser, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_REVISION, ACL_SIZE_INFORMATION,
-    CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, INHERITED_ACE, OBJECT_INHERIT_ACE,
-    OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
-    SECURITY_DESCRIPTOR, SE_DACL_PROTECTED, TOKEN_INFORMATION_CLASS, TOKEN_OWNER, TOKEN_QUERY,
-    TOKEN_USER,
+    AclSizeInformation, AddAccessAllowedAce, CreateWellKnownSid, EqualSid, GetAce,
+    GetAclInformation, GetKernelObjectSecurity, GetLengthSid, GetSecurityDescriptorControl,
+    GetSecurityDescriptorDacl, GetSecurityDescriptorOwner, GetTokenInformation, InitializeAcl,
+    InitializeSecurityDescriptor, IsValidSid, SetKernelObjectSecurity,
+    SetSecurityDescriptorControl, SetSecurityDescriptorDacl, TokenOwner, TokenUser,
+    WinBuiltinAdministratorsSid, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_REVISION,
+    ACL_SIZE_INFORMATION, CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, INHERITED_ACE,
+    OBJECT_INHERIT_ACE, OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
+    PSECURITY_DESCRIPTOR, SECURITY_DESCRIPTOR, SECURITY_MAX_SID_SIZE, SE_DACL_PROTECTED,
+    TOKEN_INFORMATION_CLASS, TOKEN_OWNER, TOKEN_QUERY, TOKEN_USER,
 };
 use windows_sys::Win32::Storage::FileSystem::{FILE_ALL_ACCESS, FILE_GENERIC_READ};
 use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
@@ -48,8 +66,14 @@ use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken}
 thread_local! {
     /// Test seam: make the next `restrict_to_current_user` on this thread
     /// fail after the DACL was applied, to prove the issuer's cleanup path.
+    /// The file and the directory have separate seams: the directory step
+    /// runs first at issuance and must not consume the file's flag (review
+    /// round, sonnet F6).
     pub(super) static FAIL_NEXT_RESTRICT: std::cell::Cell<bool> =
         const { std::cell::Cell::new(false) };
+    /// Test seam: same injection for `restrict_directory_to_current_user`.
+    pub(super) static FAIL_NEXT_DIRECTORY_RESTRICT: std::cell::Cell<bool> =
+        const { std::cell::Cell::new(false) };
 }
 
 /// `Win32::System::SystemServices` values; that feature is not enabled.
@@ -119,6 +143,96 @@ fn token_owner_sid() -> Result<Vec<u32>, String> {
     token_sid(TokenOwner, "read token owner")
 }
 
+/// The well-known SID of BUILTIN\Administrators: the owner of every object an
+/// elevated run creates. No non-admin account can assign it, so accepting it
+/// does not widen the threat model (review round: grok F1 / sonnet F1).
+fn administrators_sid() -> Result<Vec<u32>, String> {
+    unsafe {
+        let mut buffer = vec![0u32; (SECURITY_MAX_SID_SIZE as usize).div_ceil(4)];
+        let mut size = SECURITY_MAX_SID_SIZE;
+        if CreateWellKnownSid(
+            WinBuiltinAdministratorsSid,
+            std::ptr::null_mut(),
+            buffer.as_mut_ptr().cast(),
+            &mut size,
+        ) == 0
+        {
+            return Err(os_error("build administrators SID"));
+        }
+        Ok(buffer)
+    }
+}
+
+/// The owner identities this process may legitimately find on its own
+/// credential files, in any order of elevated and unelevated runs: the token
+/// user, the token's default owner, and the Administrators group (an earlier
+/// elevated run's files re-read by an unelevated one). A foreign non-admin
+/// account can own none of them.
+fn owner_accepted(owner: *mut core::ffi::c_void) -> Result<bool, String> {
+    let mut user = current_user_sid()?;
+    let mut token_owner = token_owner_sid()?;
+    let mut admins = administrators_sid()?;
+    unsafe {
+        Ok(EqualSid(owner, user.as_mut_ptr().cast()) != 0
+            || EqualSid(owner, token_owner.as_mut_ptr().cast()) != 0
+            || EqualSid(owner, admins.as_mut_ptr().cast()) != 0)
+    }
+}
+
+/// ERROR_SHARING_VIOLATION: another process holds the object with a
+/// conflicting share mode.
+const ERROR_SHARING_VIOLATION: i32 = 32;
+
+/// Open with a bounded retry on sharing violations: an AV scanner, an
+/// indexer or a parallel issuance holds the object for milliseconds, and
+/// failing the launch on the first conflict would trade availability for
+/// nothing. After about a second the open still fails closed (review round:
+/// grok F6 / sonnet F3).
+pub(super) fn open_with_sharing_retry(
+    what: &str,
+    mut open: impl FnMut() -> std::io::Result<File>,
+) -> Result<File, String> {
+    let mut attempts = 0u32;
+    loop {
+        match open() {
+            Ok(file) => return Ok(file),
+            Err(error) => {
+                if error.raw_os_error() == Some(ERROR_SHARING_VIOLATION) && attempts < 25 {
+                    attempts += 1;
+                    std::thread::sleep(std::time::Duration::from_millis(40));
+                    continue;
+                }
+                return Err(format!("{what}: {error}"));
+            }
+        }
+    }
+}
+
+/// Refuse an object that is not what its path claims: a reparse point
+/// (symlink or junction - opened as itself thanks to
+/// `FILE_FLAG_OPEN_REPARSE_POINT`) or a file reachable through a second hard
+/// link. Otherwise a planted link would have the writer truncate and re-ACL
+/// the link's target (review round: grok F2 / sonnet F4).
+pub(super) fn refuse_links(file: &File, what: &str) -> Result<(), String> {
+    use windows_sys::Win32::Storage::FileSystem::{
+        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_REPARSE_POINT,
+    };
+    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
+    if unsafe { GetFileInformationByHandle(file.as_raw_handle() as HANDLE, &mut info) } == 0 {
+        return Err(os_error("inspect credential object"));
+    }
+    if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
+        return Err(format!("{what} is a link (reparse point), refusing"));
+    }
+    if info.nNumberOfLinks > 1 {
+        return Err(format!(
+            "{what} is reachable through {} hard links, refusing",
+            info.nNumberOfLinks
+        ));
+    }
+    Ok(())
+}
+
 /// Replace the DACL on `file` with one protected ACE granting the current
 /// user full access, then verify the result. The handle must carry
 /// `WRITE_DAC | READ_CONTROL`. `inherit_children` marks the ACE so objects
@@ -166,10 +280,6 @@ fn restrict_handle(file: &File, inherit_children: bool) -> Result<(), String> {
             return Err(os_error("restrict credential ACL"));
         }
     }
-    #[cfg(test)]
-    if FAIL_NEXT_RESTRICT.with(|fail| fail.replace(false)) {
-        return Err("injected credential ACL failure".into());
-    }
     verify_owner_only(file)
 }
 
@@ -177,7 +287,12 @@ fn restrict_handle(file: &File, inherit_children: bool) -> Result<(), String> {
 /// user full access, then verify the result. The handle must carry
 /// `WRITE_DAC | READ_CONTROL`.
 pub(super) fn restrict_to_current_user(file: &File) -> Result<(), String> {
-    restrict_handle(file, false)
+    restrict_handle(file, false)?;
+    #[cfg(test)]
+    if FAIL_NEXT_RESTRICT.with(|fail| fail.replace(false)) {
+        return Err("injected credential ACL failure".into());
+    }
+    Ok(())
 }
 
 /// W2-07b: narrow the `agent-access/` directory itself. The directory decides
@@ -186,16 +301,26 @@ pub(super) fn restrict_to_current_user(file: &File) -> Result<(), String> {
 pub(super) fn restrict_directory_to_current_user(dir: &Path) -> Result<(), String> {
     use std::os::windows::fs::OpenOptionsExt;
     use windows_sys::Win32::Storage::FileSystem::{
-        FILE_FLAG_BACKUP_SEMANTICS, READ_CONTROL, WRITE_DAC,
+        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, READ_CONTROL, WRITE_DAC,
     };
-    // FILE_FLAG_BACKUP_SEMANTICS is what lets CreateFile open a directory.
-    let file = std::fs::OpenOptions::new()
-        .access_mode(WRITE_DAC | READ_CONTROL)
-        .share_mode(0)
-        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
-        .open(dir)
-        .map_err(|e| format!("open credential directory: {e}"))?;
-    restrict_handle(&file, true)
+    // FILE_FLAG_BACKUP_SEMANTICS is what lets CreateFile open a directory;
+    // FILE_FLAG_OPEN_REPARSE_POINT opens a junction as itself so
+    // `refuse_links` can refuse it instead of re-ACLing its target.
+    let what = format!("open credential directory {}", dir.display());
+    let file = open_with_sharing_retry(&what, || {
+        std::fs::OpenOptions::new()
+            .access_mode(WRITE_DAC | READ_CONTROL)
+            .share_mode(0)
+            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
+            .open(dir)
+    })?;
+    refuse_links(&file, &what)?;
+    restrict_handle(&file, true)?;
+    #[cfg(test)]
+    if FAIL_NEXT_DIRECTORY_RESTRICT.with(|fail| fail.replace(false)) {
+        return Err("injected credential directory ACL failure".into());
+    }
+    Ok(())
 }
 
 /// One ACE as the read-back saw it.
@@ -208,23 +333,33 @@ struct AceRead {
 
 /// What the read-back saw on a file: ownership, control bits, DACL.
 struct SecurityRead {
-    owner_is_token_owner: bool,
+    owner_accepted: bool,
     control: u16,
     dacl_present: bool,
     aces: Vec<AceRead>,
 }
 
-/// Fail closed unless `file` is owned by this process's owner identity and
-/// its DACL is protected, non-null, carries no inherited ACE, and consists of
-/// at least one allow ACE, each for the current user and each granting read.
-/// Any deny or other ACE type is refused.
+/// Fail closed unless `file` is owned by one of this process's owner
+/// identities and its DACL is protected, non-null, carries no inherited ACE,
+/// and consists of at least one allow ACE, each for the current user and each
+/// granting read. Any deny or other ACE type is refused.
 pub(super) fn verify_owner_only(file: &File) -> Result<(), String> {
     validate_owner_only(&read_security(file)?)
 }
 
+/// Owner pre-check without touching the DACL or the content: a foreign-owned
+/// object is refused before anything about it changes (review round: grok
+/// F1 - the truncate-first order used to destroy a rejected descriptor before
+/// the refusal).
+pub(super) fn verify_owned(file: &File) -> Result<(), String> {
+    if !read_security(file)?.owner_accepted {
+        return Err("credential file is owned by another account".into());
+    }
+    Ok(())
+}
+
 fn read_security(file: &File) -> Result<SecurityRead, String> {
     let mut user = current_user_sid()?;
-    let mut owner = token_owner_sid()?;
     let psid = user.as_mut_ptr().cast::<core::ffi::c_void>();
     let handle = file.as_raw_handle() as HANDLE;
     unsafe {
@@ -259,8 +394,7 @@ fn read_security(file: &File) -> Result<SecurityRead, String> {
         if owner_sid.is_null() {
             return Err("credential file has no owner".into());
         }
-        let owner_is_token_owner =
-            EqualSid(owner_sid, owner.as_mut_ptr().cast::<core::ffi::c_void>()) != 0;
+        let owner_accepted = owner_accepted(owner_sid)?;
         let mut control = 0u16;
         let mut revision = 0u32;
         if GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) == 0 {
@@ -312,7 +446,7 @@ fn read_security(file: &File) -> Result<SecurityRead, String> {
             }
         }
         Ok(SecurityRead {
-            owner_is_token_owner,
+            owner_accepted,
             control,
             dacl_present,
             aces,
@@ -321,7 +455,7 @@ fn read_security(file: &File) -> Result<SecurityRead, String> {
 }
 
 fn validate_owner_only(read: &SecurityRead) -> Result<(), String> {
-    if !read.owner_is_token_owner {
+    if !read.owner_accepted {
         return Err("credential file is owned by another account".into());
     }
     if read.control & SE_DACL_PROTECTED == 0 {
@@ -509,12 +643,13 @@ mod tests {
         verify_owner_only(&file).unwrap();
     }
 
-    /// A crafted read-back: an otherwise perfect ACL on a file owned by
-    /// another account. Building this on disk would need SeTakeOwnership, so
-    /// the validation runs on the parsed snapshot directly.
-    fn crafted(owner_is_token_owner: bool) -> SecurityRead {
+    /// A crafted read-back: an otherwise perfect ACL on a file whose owner
+    /// is or is not one of the accepted identities. Building this on disk
+    /// would need SeTakeOwnership, so the validation runs on the parsed
+    /// snapshot directly.
+    fn crafted(owner_accepted: bool) -> SecurityRead {
         SecurityRead {
-            owner_is_token_owner,
+            owner_accepted,
             control: SE_DACL_PROTECTED,
             dacl_present: true,
             aces: vec![AceRead {
@@ -533,10 +668,49 @@ mod tests {
     }
 
     #[test]
-    fn the_token_owner_passes_the_owner_check() {
+    fn an_accepted_owner_passes_the_owner_check() {
         validate_owner_only(&crafted(true)).unwrap();
     }
 
+    /// Review round (grok F1 / sonnet F1): the owner set is the token user,
+    /// the token's default owner, and the Administrators group - the three
+    /// identities this process's files can legitimately carry, in any order
+    /// of elevated and unelevated runs.
+    #[test]
+    fn the_token_user_and_token_owner_are_accepted_owners() {
+        let mut user = current_user_sid().unwrap();
+        assert!(owner_accepted(user.as_mut_ptr().cast::<core::ffi::c_void>()).unwrap());
+        let mut owner = token_owner_sid().unwrap();
+        assert!(owner_accepted(owner.as_mut_ptr().cast::<core::ffi::c_void>()).unwrap());
+    }
+
+    #[test]
+    fn the_administrators_group_is_an_accepted_owner() {
+        // A file an earlier elevated run created, re-read by an unelevated
+        // one, is owned by BUILTIN\Administrators; no non-admin can assign
+        // that owner, so accepting it lets no foreign user through.
+        let mut admins = administrators_sid().unwrap();
+        assert!(owner_accepted(admins.as_mut_ptr().cast::<core::ffi::c_void>()).unwrap());
+    }
+
+    #[test]
+    fn a_world_sid_is_not_an_accepted_owner() {
+        let mut world = vec![0u32; (SECURITY_MAX_SID_SIZE as usize).div_ceil(4)];
+        let mut size = SECURITY_MAX_SID_SIZE;
+        unsafe {
+            assert_ne!(
+                CreateWellKnownSid(
+                    WinWorldSid,
+                    std::ptr::null_mut(),
+                    world.as_mut_ptr().cast(),
+                    &mut size
+                ),
+                0
+            );
+        }
+        assert!(!owner_accepted(world.as_mut_ptr().cast::<core::ffi::c_void>()).unwrap());
+    }
+
     #[test]
     fn a_restricted_directory_passes_the_same_check() {
         let dir = crate::testutil::TempDir::new("api-w207b-dir-restrict");
@@ -548,4 +722,87 @@ mod tests {
         let file = open(&inner.join("child.json"));
         restrict_to_current_user(&file).unwrap();
     }
+
+    /// W2-07b review round (grok F2 / sonnet F4): a planted second hard link
+    /// at the descriptor path must be refused before anything is truncated or
+    /// re-ACL'd, and the original file must stay byte-identical.
+    #[test]
+    fn a_second_hard_link_to_the_descriptor_is_refused_and_the_target_untouched() {
+        let dir = crate::testutil::TempDir::new("api-w207b-hardlink");
+        let victim = dir.path().join("victim.json");
+        std::fs::write(&victim, b"precious").unwrap();
+        let planted = dir.path().join("projecta-api.json");
+        std::fs::hard_link(&victim, &planted).unwrap();
+        let error = crate::api::write_descriptor_body(&planted, b"new-token").unwrap_err();
+        assert!(error.contains("hard link"), "{error}");
+        assert_eq!(std::fs::read(&victim).unwrap(), b"precious");
+    }
+
+    /// W2-07b review round (grok F1): when the restriction fails, the previous
+    /// descriptor content must survive - the owner and the fresh DACL are
+    /// verified before any truncation, so a refused write never destroys the
+    /// running instance's descriptor.
+    #[test]
+    fn a_failed_restriction_preserves_the_existing_descriptor() {
+        let dir = crate::testutil::TempDir::new("api-w207b-keep");
+        let path = dir.path().join("projecta-api.json");
+        std::fs::write(&path, b"old-token").unwrap();
+        FAIL_NEXT_RESTRICT.with(|fail| fail.set(true));
+        let error = crate::api::write_descriptor_body(&path, b"new-token").unwrap_err();
+        assert!(error.contains("injected"), "{error}");
+        assert_eq!(std::fs::read(&path).unwrap(), b"old-token");
+    }
+
+    /// W2-07b review round (grok F6 / sonnet F3): an AV scan or a parallel
+    /// issuance holding the descriptor for a few hundred milliseconds must not
+    /// fail the launch; the open retries a bounded time before failing closed.
+    #[test]
+    fn a_briefly_held_descriptor_handle_is_waited_out() {
+        let dir = crate::testutil::TempDir::new("api-w207b-busy");
+        let path = dir.path().join("projecta-api.json");
+        std::fs::write(&path, b"old-token").unwrap();
+        let blocker = std::fs::OpenOptions::new()
+            .read(true)
+            .share_mode(0)
+            .open(&path)
+            .unwrap();
+        let release = std::thread::spawn(move || {
+            std::thread::sleep(std::time::Duration::from_millis(300));
+            drop(blocker);
+        });
+        crate::api::write_descriptor_body(&path, b"new-token").unwrap();
+        release.join().unwrap();
+        assert_eq!(std::fs::read(&path).unwrap(), b"new-token");
+    }
+
+    /// W2-07b review round (sonnet F6): the failure-injection seam for the
+    /// credential FILE must survive a directory restriction - the directory
+    /// step runs first at issuance and must not consume the file's flag.
+    #[test]
+    fn the_directory_restrict_does_not_consume_the_file_injection_flag() {
+        let dir = crate::testutil::TempDir::new("api-w207b-seam");
+        let inner = dir.path().join("agent-access");
+        std::fs::create_dir(&inner).unwrap();
+        FAIL_NEXT_RESTRICT.with(|fail| fail.set(true));
+        restrict_directory_to_current_user(&inner).unwrap();
+        let file = open(&inner.join("child.json"));
+        let error = restrict_to_current_user(&file).unwrap_err();
+        assert!(error.contains("injected"), "{error}");
+    }
+
+    /// W2-07b review round (sonnet F6): the directory step has its own
+    /// injection seam, so a failing directory restriction stays testable
+    /// without touching the file flag.
+    #[test]
+    fn the_directory_injection_flag_is_separate_from_the_file_flag() {
+        let dir = crate::testutil::TempDir::new("api-w207b-dirfail");
+        let inner = dir.path().join("agent-access");
+        std::fs::create_dir(&inner).unwrap();
+        FAIL_NEXT_DIRECTORY_RESTRICT.with(|fail| fail.set(true));
+        let error = restrict_directory_to_current_user(&inner).unwrap_err();
+        assert!(error.contains("injected credential directory"), "{error}");
+        // The file flag was never armed: the next file restrict works.
+        let file = open(&inner.join("child.json"));
+        restrict_to_current_user(&file).unwrap();
+    }
 }
diff --git a/src-tauri/src/api/credential_acl_tests.rs b/src-tauri/src/api/credential_acl_tests.rs
index 17fbf48..99f5921 100644
--- a/src-tauri/src/api/credential_acl_tests.rs
+++ b/src-tauri/src/api/credential_acl_tests.rs
@@ -7,11 +7,13 @@ use std::path::Path;
 
 use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
 use windows_sys::Win32::Security::{
-    AclSizeInformation, EqualSid, GetAce, GetAclInformation, GetFileSecurityW,
-    GetSecurityDescriptorControl, GetSecurityDescriptorDacl, GetSecurityDescriptorOwner,
-    GetTokenInformation, TokenUser, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION,
-    DACL_SECURITY_INFORMATION, INHERITED_ACE, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
-    SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
+    AclSizeInformation, CreateWellKnownSid, EqualSid, GetAce, GetAclInformation, GetFileSecurityW,
+    GetLengthSid, GetSecurityDescriptorControl, GetSecurityDescriptorDacl,
+    GetSecurityDescriptorOwner, GetTokenInformation, TokenOwner, TokenUser,
+    WinBuiltinAdministratorsSid, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION,
+    CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, INHERITED_ACE, OBJECT_INHERIT_ACE,
+    OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, SECURITY_MAX_SID_SIZE, SE_DACL_PROTECTED,
+    TOKEN_INFORMATION_CLASS, TOKEN_OWNER, TOKEN_QUERY, TOKEN_USER,
 };
 use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
 
@@ -26,12 +28,14 @@ struct Dacl {
     protected: bool,
     /// (ace type, ace flags, SID equals the current user)
     aces: Vec<(u8, u8, bool)>,
-    /// The owner SID equals the current user.
-    owner_is_user: bool,
+    /// The owner SID is one of the identities this process may legitimately
+    /// own files as (token user, token default owner, Administrators).
+    owner_accepted: bool,
 }
 
-/// DWORD-aligned, as a SID must be.
-fn current_user_sid() -> Vec<u32> {
+/// DWORD-aligned, as a SID must be: `TokenUser` or `TokenOwner` of this
+/// process's token.
+fn token_sid(class: TOKEN_INFORMATION_CLASS) -> Vec<u32> {
     unsafe {
         let mut token: HANDLE = std::ptr::null_mut();
         assert_ne!(
@@ -39,36 +43,68 @@ fn current_user_sid() -> Vec<u32> {
             0
         );
         let mut needed = 0u32;
-        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
+        GetTokenInformation(token, class, std::ptr::null_mut(), 0, &mut needed);
         let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
         let ok = GetTokenInformation(
             token,
-            TokenUser,
+            class,
             buffer.as_mut_ptr().cast(),
             needed,
             &mut needed,
         );
         CloseHandle(token);
         assert_ne!(ok, 0, "{}", std::io::Error::last_os_error());
-        let user = &*(buffer.as_ptr() as *const TOKEN_USER);
-        let length = windows_sys::Win32::Security::GetLengthSid(user.User.Sid) as usize;
+        let sid = if class == TokenOwner {
+            (*(buffer.as_ptr() as *const TOKEN_OWNER)).Owner
+        } else {
+            (*(buffer.as_ptr() as *const TOKEN_USER)).User.Sid
+        };
+        let length = GetLengthSid(sid) as usize;
         let mut owned = vec![0u32; length.div_ceil(4)];
-        std::ptr::copy_nonoverlapping(
-            user.User.Sid as *const u8,
-            owned.as_mut_ptr().cast::<u8>(),
-            length,
-        );
+        std::ptr::copy_nonoverlapping(sid as *const u8, owned.as_mut_ptr().cast::<u8>(), length);
         owned
     }
 }
 
+/// The well-known SID of BUILTIN\Administrators: every object an elevated run
+/// creates is owned by this group, and no non-admin can assign it.
+fn administrators_sid() -> Vec<u32> {
+    unsafe {
+        let mut buffer = vec![0u32; (SECURITY_MAX_SID_SIZE as usize).div_ceil(4)];
+        let mut size = SECURITY_MAX_SID_SIZE;
+        assert_ne!(
+            CreateWellKnownSid(
+                WinBuiltinAdministratorsSid,
+                std::ptr::null_mut(),
+                buffer.as_mut_ptr().cast(),
+                &mut size
+            ),
+            0
+        );
+        buffer
+    }
+}
+
+/// The owner identities the production check accepts (W2-07b review round,
+/// grok F1 / sonnet F2): the token user, the token's default owner and the
+/// Administrators group. The oracle must mirror that set exactly, or an
+/// elevated run would fail the oracle while production behaves as designed.
+fn accepted_owner_sids() -> Vec<Vec<u32>> {
+    vec![
+        token_sid(TokenUser),
+        token_sid(TokenOwner),
+        administrators_sid(),
+    ]
+}
+
 fn read_dacl(path: &Path) -> Dacl {
     let wide: Vec<u16> = path
         .as_os_str()
         .encode_wide()
         .chain(std::iter::once(0))
         .collect();
-    let mut user = current_user_sid();
+    let mut user = token_sid(TokenUser);
+    let mut owners: Vec<Vec<u32>> = accepted_owner_sids();
     unsafe {
         let mut needed = 0u32;
         GetFileSecurityW(
@@ -100,7 +136,9 @@ fn read_dacl(path: &Path) -> Dacl {
             0
         );
         assert!(!owner.is_null(), "a descriptor without an owner is foreign");
-        let owner_is_user = EqualSid(owner, user.as_mut_ptr().cast()) != 0;
+        let owner_accepted = owners
+            .iter_mut()
+            .any(|accepted| EqualSid(owner, accepted.as_mut_ptr().cast()) != 0);
         let mut control = 0u16;
         let mut revision = 0u32;
         assert_ne!(
@@ -146,13 +184,14 @@ fn read_dacl(path: &Path) -> Dacl {
         Dacl {
             protected: control & SE_DACL_PROTECTED != 0,
             aces,
-            owner_is_user,
+            owner_accepted,
         }
     }
 }
 
 /// W2-07/W2-07b shape: protected against inheritance, every ACE decided here
-/// grants only the current user, and the file belongs to that user.
+/// grants only the current user, and the file belongs to one of the owner
+/// identities of this process (user, token default owner, Administrators).
 fn assert_owner_only(dacl: &Dacl) {
     assert!(
         dacl.protected,
@@ -172,8 +211,9 @@ fn assert_owner_only(dacl: &Dacl) {
         "the agent runs as the current user and must still read it: {dacl:?}"
     );
     assert!(
-        dacl.owner_is_user,
-        "the file must belong to the current user: {dacl:?}"
+        dacl.owner_accepted,
+        "the file must belong to an owner identity of this process \
+         (token user, token default owner, or Administrators): {dacl:?}"
     );
 }
 
@@ -217,6 +257,33 @@ fn agent_access_directory_grants_only_the_current_user() {
         .unwrap();
     let dacl = read_dacl(&dir.path().join("agent-access"));
     assert_owner_only(&dacl);
+    // W2-07b review round (grok F5 / sonnet F7): the user ACE on the
+    // directory must be inheritable, or files created inside would re-inherit
+    // SYSTEM/Administrators from the creator's default DACL.
+    assert!(
+        dacl.aces
+            .iter()
+            .any(|&(kind, flags, is_user)| kind == ALLOWED
+                && is_user
+                && u32::from(flags) & (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE)
+                    == (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE)),
+        "the user ACE on the directory must be inheritable: {dacl:?}"
+    );
+}
+
+/// W2-07b review round (sonnet F7): a broad descriptor left behind with a
+/// wide, inherited ACL is narrowed on the next boot (self-healing pin).
+#[test]
+fn an_existing_wide_open_descriptor_is_narrowed_on_boot() {
+    let dir = TempDir::new("api-w207b-heal");
+    std::fs::write(
+        dir.path().join(crate::api::DESCRIPTOR_FILE),
+        b"{\"port\":1,\"token\":\"old\"}",
+    )
+    .unwrap();
+    let server = crate::api::tests::native_server(dir.path(), "run-acl", "owner", 1);
+    let dacl = read_dacl(server.descriptor_path());
+    assert_owner_only(&dacl);
 }
 
 /// A failed restriction refuses the launch and leaves neither the file nor
diff --git a/src-tauri/src/oneshot.rs b/src-tauri/src/oneshot.rs
index c53711b..5289651 100644
--- a/src-tauri/src/oneshot.rs
+++ b/src-tauri/src/oneshot.rs
@@ -99,6 +99,17 @@ pub fn make_private(path: &Path) {
     let _ = path;
 }
 
+/// The fail-closed sibling of [`make_private`] for credential directories
+/// (W2-07b review round, grok F4): a key directory whose mode cannot be set
+/// must abort the issuance, not sail on group-readable.
+#[cfg(unix)]
+pub fn make_private_checked(path: &Path) -> Result<(), String> {
+    use std::os::unix::fs::PermissionsExt;
+    let mode = if path.is_dir() { 0o700 } else { 0o600 };
+    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
+        .map_err(|e| format!("failed to narrow {}: {e}", path.display()))
+}
+
 /// Put `command`'s child in a process group of its own, so that a later
 /// [`ProcessTree::kill`] can end the group instead of only its leader.
 ///
@@ -896,4 +907,24 @@ mod tests {
         .expect_err("a missing skill source must fail");
         assert!(err.contains("failed to read"), "{err}");
     }
+
+    /// W2-07b review round (grok F4): the fail-closed sibling of
+    /// `make_private` narrows a credential directory to 0o700 and reports a
+    /// path it cannot narrow instead of sailing on.
+    #[cfg(unix)]
+    #[test]
+    fn make_private_checked_narrows_a_directory_and_fails_closed() {
+        use std::os::unix::fs::PermissionsExt;
+        let dir = TempDir::new("oneshot-private");
+        let inner = dir.path().join("agent-access");
+        std::fs::create_dir(&inner).unwrap();
+        std::fs::set_permissions(&inner, std::fs::Permissions::from_mode(0o755)).unwrap();
+        make_private_checked(&inner).unwrap();
+        assert_eq!(
+            std::fs::metadata(&inner).unwrap().permissions().mode() & 0o777,
+            0o700
+        );
+        let error = make_private_checked(&dir.path().join("missing")).unwrap_err();
+        assert!(error.contains("failed to narrow"), "{error}");
+    }
 }
```
