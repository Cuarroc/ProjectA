# Full Review W2-07b — Windows ACL hardening for projecta-api.json and agent-access/ (PR #12)

You are reviewing a pull request as an external reviewer. Do NOT use any tools,
do NOT read or modify any files — the complete substantive diff is embedded
below. Respond with findings only.

## Context

ProjectA is a public Tauri 2 desktop app (Rust backend + React/Vite frontend).
W2-07b is a security follow-up to W2-07 (which already hardened the scoped-run
descriptors). This package extends the same fail-closed hardening to:

- `projecta-api.json` (the broad API descriptor), in
  `src-tauri/src/api.rs` (`write_descriptor`): on Windows the file is opened
  with share mode 0 and its DACL is replaced by a protected one granting full
  control to the current user only — BEFORE the token touches disk. If the
  file cannot be narrowed or belongs to a foreign account, startup fails
  closed. Unix stays unchanged (`0o600` via `make_private`).
- `agent-access/` directory, in `src-tauri/src/api/agent_access.rs`: the
  directory itself gets the same protected user-only DACL at every descriptor
  issuance (idempotent, self-healing); the ACE is marked inheritable so newly
  created children do not re-inherit SYSTEM/Administrators from the creator's
  default DACL. Unix parity: `0o700` via `make_private`.
- Owner verification, in `src-tauri/src/api/credential_acl.rs`:
  `verify_owner_only` now also reads the owner (`OWNER_SECURITY_INFORMATION`)
  and compares it against the process token's default owner (`TokenOwner` —
  normally the user; under elevation the Administrators group, so elevated
  runs keep working without letting foreign owners through). Validation is
  factored over a read snapshot so the owner refusal is testable without
  `SeTakeOwnership` privileges. Existing DACL rules (protected, no inherited
  ACE, no deny ACE, only user-allow with read) are unchanged.

Tests live in `src-tauri/src/api/credential_acl_tests.rs` (code-independent
oracle via `GetFileSecurityW`, additionally checking `owner_is_user` for the
broad descriptor, the directory, and the scoped file). One new Unix assertion
(`agent-access/` is `0o700`) compiles only under `#[cfg(unix)]` and runs in
the Linux half of CI.

Author of this change: Kimi K3. You are one of two independent reviewers.

## What to check especially

- ACL correctness: share mode 0, DACL replacement order (narrow before
  write), protected flag, inheritance flags on the directory ACE.
- Owner check: is comparing against `TokenOwner` (not `TokenUser`) sound?
  Any way a foreign-owned file passes? Any false rejection of legitimate
  elevated/unprivileged runs?
- TOCTOU: between narrowing the ACL and writing the token, can another
  process (or a redirected handle) still read or swap the file? Same question
  for the directory between ACL set and child creation.
- Fail-closed paths: any error that is logged but swallowed, any fallback
  that continues with a wide ACL?
- Test gaps: what attack or regression is NOT covered by the oracle tests?
- Cross-platform: does any `#[cfg(windows)]` change alter Unix behavior?
- Anything in the diff that must not go into a PUBLIC repository (secrets,
  personal data, local machine paths)?

Output format: findings with ID (F1, F2, ...), severity (high/medium/low),
file:line, reasoning. End with an overall verdict (approve / approve with
conditions / reject).

## Diff (base: origin/main)

```diff
diff --git a/src-tauri/src/api.rs b/src-tauri/src/api.rs
index d6728b9..a9cc625 100644
--- a/src-tauri/src/api.rs
+++ b/src-tauri/src/api.rs
@@ -1025,14 +1025,44 @@ fn write_descriptor(dir: &Path, port: u16, token: &str) -> Result<PathBuf, Strin
         token: token.to_string(),
     })
     .map_err(|e| format!("failed to render the api descriptor: {e}"))?;
-    std::fs::write(&path, body).map_err(|e| format!("failed to write {}: {e}", path.display()))?;
+    write_descriptor_body(&path, body.as_bytes())?;
 
-    // The token is a key to this app; on unix the file says so.
+    // The token is a key to this app; on unix the file says so. On Windows
+    // `write_descriptor_body` already narrowed the DACL fail-closed.
     crate::oneshot::make_private(&path);
 
     Ok(path)
 }
 
+/// Windows: the broad descriptor holds the same key to the app as a scoped
+/// one, so it gets the same treatment (W2-07b). The file is opened with share
+/// mode 0 and its DACL is narrowed to the current user before the token
+/// touches the disk; a file that cannot be narrowed or that belongs to
+/// another account fails startup closed instead of being trusted.
+#[cfg(windows)]
+fn write_descriptor_body(path: &Path, body: &[u8]) -> Result<(), String> {
+    use std::os::windows::fs::OpenOptionsExt;
+    use windows_sys::Win32::Foundation::GENERIC_WRITE;
+    use windows_sys::Win32::Storage::FileSystem::{READ_CONTROL, WRITE_DAC};
+    let mut file = std::fs::OpenOptions::new()
+        .write(true)
+        .create(true)
+        .truncate(true)
+        .access_mode(GENERIC_WRITE | WRITE_DAC | READ_CONTROL)
+        .share_mode(0)
+        .open(path)
+        .map_err(|e| format!("failed to open {}: {e}", path.display()))?;
+    credential_acl::restrict_to_current_user(&file)?;
+    file.write_all(body)
+        .and_then(|()| file.sync_all())
+        .map_err(|e| format!("failed to write {}: {e}", path.display()))
+}
+
+#[cfg(not(windows))]
+fn write_descriptor_body(path: &Path, body: &[u8]) -> Result<(), String> {
+    std::fs::write(path, body).map_err(|e| format!("failed to write {}: {e}", path.display()))
+}
+
 /// A 128 bit hex token, drawn from the operating system's random source.
 ///
 /// This token is the only thing between another process on this machine and an
@@ -4393,6 +4423,17 @@ pub(crate) mod tests {
                 std::fs::metadata(&first).unwrap().permissions().mode() & 0o777,
                 0o600
             );
+            // W2-07b parity with the Windows directory ACL.
+            let access = fx
+                .server
+                .descriptor_path()
+                .parent()
+                .unwrap()
+                .join("agent-access");
+            assert_eq!(
+                std::fs::metadata(&access).unwrap().permissions().mode() & 0o777,
+                0o700
+            );
         }
         fx.server.revoke_run_credentials("run-a").unwrap();
         assert!(!first.exists());
diff --git a/src-tauri/src/api/agent_access.rs b/src-tauri/src/api/agent_access.rs
index baa14a8..bd3eacf 100644
--- a/src-tauri/src/api/agent_access.rs
+++ b/src-tauri/src/api/agent_access.rs
@@ -189,6 +189,13 @@ impl RunCredentialIssuer {
                 .join(ACCESS_DIR);
             std::fs::create_dir_all(&directory)
                 .map_err(|e| format!("create scoped descriptor directory: {e}"))?;
+            // W2-07b: the directory decides who may list it, plant files in
+            // it or delete from it - narrowing only the files leaves all
+            // three open. Fail closed like the file restriction below.
+            #[cfg(windows)]
+            super::credential_acl::restrict_directory_to_current_user(&directory)?;
+            #[cfg(unix)]
+            crate::oneshot::make_private(&directory);
             let path = directory.join(format!("{}.json", new_token()?));
             let mut options = std::fs::OpenOptions::new();
             options.write(true).create_new(true);
diff --git a/src-tauri/src/api/credential_acl.rs b/src-tauri/src/api/credential_acl.rs
index d22997c..bca9ae2 100644
--- a/src-tauri/src/api/credential_acl.rs
+++ b/src-tauri/src/api/credential_acl.rs
@@ -1,30 +1,45 @@
-//! W2-07: a scoped run descriptor on Windows is readable by the current user
-//! and nobody else.
+//! W2-07: a credential file on Windows is readable by the current user and
+//! nobody else. W2-07b widens that from the scoped run descriptors to the
+//! broad API descriptor and the `agent-access/` directory itself, and adds
+//! the ownership check.
 //!
-//! The unix writer creates the file with mode 0o600. Windows has no mode: a
-//! new file inherits the ACL of `agent-access/`, which under a profile grants
+//! The unix writers create their files with mode 0o600. Windows has no mode:
+//! a new file inherits the ACL of its directory, which under a profile grants
 //! SYSTEM, Administrators and whatever else the parent carries - and under an
-//! overridden data directory possibly `Users` or `Everyone`. So the writer
-//! replaces the DACL with a protected one holding a single ACE for the token
-//! user, reads it back through the same handle and refuses to write the token
-//! unless the read-back is exactly that narrow (fail closed).
+//! overridden data directory possibly `Users` or `Everyone`. So the writers
+//! replace the DACL with a protected one holding a single ACE for the token
+//! user, read it back through the same handle and refuse to write the token
+//! unless the read-back is exactly that narrow and the file belongs to this
+//! process's owner identity (fail closed). A generous DACL on a file owned by
+//! another account is refused the same way: somebody else planted it.
 //!
 //! The handle is opened with share mode 0, so between `CreateFileW` and the
 //! new DACL no other process can open the still-empty file and keep a handle
 //! whose access was checked against the inherited ACL.
+//!
+//! [`restrict_directory_to_current_user`] applies the same rule to the
+//! `agent-access/` directory: the directory decides who may list it, plant
+//! files in it or delete from it, so narrowing only the files leaves all
+//! three open. Its ACE is marked inheritable so a file created inside starts
+//! with the user-only grant instead of the creator's default DACL (which
+//! would re-add SYSTEM and Administrators); the writer still replaces the
+//! DACL of every file before the token touches the disk.
 #![cfg(windows)]
 use std::fs::File;
 use std::os::windows::io::AsRawHandle;
+use std::path::Path;
 
 use windows_sys::Win32::Foundation::{CloseHandle, FALSE, HANDLE, TRUE};
 use windows_sys::Win32::Security::{
     AclSizeInformation, AddAccessAllowedAce, EqualSid, GetAce, GetAclInformation,
     GetKernelObjectSecurity, GetLengthSid, GetSecurityDescriptorControl, GetSecurityDescriptorDacl,
-    GetTokenInformation, InitializeAcl, InitializeSecurityDescriptor, IsValidSid,
-    SetKernelObjectSecurity, SetSecurityDescriptorControl, SetSecurityDescriptorDacl, TokenUser,
-    ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_REVISION, ACL_SIZE_INFORMATION,
-    DACL_SECURITY_INFORMATION, INHERITED_ACE, PROTECTED_DACL_SECURITY_INFORMATION,
-    PSECURITY_DESCRIPTOR, SECURITY_DESCRIPTOR, SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
+    GetSecurityDescriptorOwner, GetTokenInformation, InitializeAcl, InitializeSecurityDescriptor,
+    IsValidSid, SetKernelObjectSecurity, SetSecurityDescriptorControl, SetSecurityDescriptorDacl,
+    TokenOwner, TokenUser, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_REVISION, ACL_SIZE_INFORMATION,
+    CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, INHERITED_ACE, OBJECT_INHERIT_ACE,
+    OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
+    SECURITY_DESCRIPTOR, SE_DACL_PROTECTED, TOKEN_INFORMATION_CLASS, TOKEN_OWNER, TOKEN_QUERY,
+    TOKEN_USER,
 };
 use windows_sys::Win32::Storage::FileSystem::{FILE_ALL_ACCESS, FILE_GENERIC_READ};
 use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
@@ -46,8 +61,9 @@ fn os_error(what: &str) -> String {
     format!("{what}: {}", std::io::Error::last_os_error())
 }
 
-/// The SID of the user this process runs as, in a DWORD-aligned buffer.
-fn current_user_sid() -> Result<Vec<u32>, String> {
+/// Read `class` (`TokenUser` or `TokenOwner`) of this process's token into a
+/// DWORD-aligned buffer holding just the SID.
+fn token_sid(class: TOKEN_INFORMATION_CLASS, label: &str) -> Result<Vec<u32>, String> {
     unsafe {
         let mut token: HANDLE = std::ptr::null_mut();
         if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
@@ -56,28 +72,32 @@ fn current_user_sid() -> Result<Vec<u32>, String> {
         let mut needed = 0u32;
         // The sizing call "fails" with ERROR_INSUFFICIENT_BUFFER by design;
         // only a missing size is an error.
-        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
+        GetTokenInformation(token, class, std::ptr::null_mut(), 0, &mut needed);
         if needed == 0 {
-            let error = os_error("size token user");
+            let error = os_error(label);
             CloseHandle(token);
             return Err(error);
         }
         let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
         let ok = GetTokenInformation(
             token,
-            TokenUser,
+            class,
             buffer.as_mut_ptr().cast(),
             needed,
             &mut needed,
         );
-        let error = os_error("read token user");
+        let error = os_error(label);
         CloseHandle(token);
         if ok == 0 {
             return Err(error);
         }
-        let sid = (*(buffer.as_ptr() as *const TOKEN_USER)).User.Sid;
+        let sid = if class == TokenOwner {
+            (*(buffer.as_ptr() as *const TOKEN_OWNER)).Owner
+        } else {
+            (*(buffer.as_ptr() as *const TOKEN_USER)).User.Sid
+        };
         if sid.is_null() || IsValidSid(sid) == 0 {
-            return Err("token user SID is invalid".into());
+            return Err(format!("{label}: SID is invalid"));
         }
         let length = GetLengthSid(sid) as usize;
         let mut owned = vec![0u32; length.div_ceil(4)];
@@ -86,10 +106,24 @@ fn current_user_sid() -> Result<Vec<u32>, String> {
     }
 }
 
+/// The SID of the user this process runs as.
+fn current_user_sid() -> Result<Vec<u32>, String> {
+    token_sid(TokenUser, "read token user")
+}
+
+/// The SID this process would own new files as: the token's default owner,
+/// which is the user normally and the Administrators group under elevation.
+/// Comparing against this instead of the user SID keeps elevated runs
+/// working without letting a foreign owner through.
+fn token_owner_sid() -> Result<Vec<u32>, String> {
+    token_sid(TokenOwner, "read token owner")
+}
+
 /// Replace the DACL on `file` with one protected ACE granting the current
 /// user full access, then verify the result. The handle must carry
-/// `WRITE_DAC | READ_CONTROL`.
-pub(super) fn restrict_to_current_user(file: &File) -> Result<(), String> {
+/// `WRITE_DAC | READ_CONTROL`. `inherit_children` marks the ACE so objects
+/// created below a directory inherit this grant.
+fn restrict_handle(file: &File, inherit_children: bool) -> Result<(), String> {
     let mut sid = current_user_sid()?;
     let psid = sid.as_mut_ptr().cast::<core::ffi::c_void>();
     unsafe {
@@ -99,11 +133,19 @@ pub(super) fn restrict_to_current_user(file: &File) -> Result<(), String> {
         let mut acl_buffer = vec![0u32; size.div_ceil(4)];
         let acl = acl_buffer.as_mut_ptr().cast::<ACL>();
         if InitializeAcl(acl, (acl_buffer.len() * 4) as u32, ACL_REVISION) == 0 {
-            return Err(os_error("initialize scoped descriptor ACL"));
+            return Err(os_error("initialize credential ACL"));
         }
         if AddAccessAllowedAce(acl, ACL_REVISION, FILE_ALL_ACCESS, psid) == 0 {
             return Err(os_error("add owner ACE"));
         }
+        if inherit_children {
+            let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
+            if GetAce(acl, 0, &mut ace) == 0 || ace.is_null() {
+                return Err(os_error("mark owner ACE inheritable"));
+            }
+            (*(ace as *mut ACE_HEADER)).AceFlags =
+                (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) as u8;
+        }
         let mut descriptor: SECURITY_DESCRIPTOR = std::mem::zeroed();
         let pdescriptor: PSECURITY_DESCRIPTOR =
             (&mut descriptor as *mut SECURITY_DESCRIPTOR).cast();
@@ -113,7 +155,7 @@ pub(super) fn restrict_to_current_user(file: &File) -> Result<(), String> {
             || SetSecurityDescriptorDacl(pdescriptor, TRUE, acl, FALSE) == 0
             || SetSecurityDescriptorControl(pdescriptor, SE_DACL_PROTECTED, SE_DACL_PROTECTED) == 0
         {
-            return Err(os_error("build scoped descriptor security"));
+            return Err(os_error("build credential security"));
         }
         if SetKernelObjectSecurity(
             file.as_raw_handle() as HANDLE,
@@ -121,116 +163,205 @@ pub(super) fn restrict_to_current_user(file: &File) -> Result<(), String> {
             pdescriptor,
         ) == 0
         {
-            return Err(os_error("restrict scoped descriptor ACL"));
+            return Err(os_error("restrict credential ACL"));
         }
     }
     #[cfg(test)]
     if FAIL_NEXT_RESTRICT.with(|fail| fail.replace(false)) {
-        return Err("injected scoped descriptor ACL failure".into());
+        return Err("injected credential ACL failure".into());
     }
     verify_owner_only(file)
 }
 
-/// Fail closed unless the DACL on `file` is protected, non-null, carries no
-/// inherited ACE, and consists of at least one allow ACE, each for the
-/// current user and each granting read. Any deny or other ACE type is refused.
+/// Replace the DACL on `file` with one protected ACE granting the current
+/// user full access, then verify the result. The handle must carry
+/// `WRITE_DAC | READ_CONTROL`.
+pub(super) fn restrict_to_current_user(file: &File) -> Result<(), String> {
+    restrict_handle(file, false)
+}
+
+/// W2-07b: narrow the `agent-access/` directory itself. The directory decides
+/// who may list it, plant files in it or delete from it; restricting only the
+/// files leaves all three open. Fails closed like the file variant.
+pub(super) fn restrict_directory_to_current_user(dir: &Path) -> Result<(), String> {
+    use std::os::windows::fs::OpenOptionsExt;
+    use windows_sys::Win32::Storage::FileSystem::{
+        FILE_FLAG_BACKUP_SEMANTICS, READ_CONTROL, WRITE_DAC,
+    };
+    // FILE_FLAG_BACKUP_SEMANTICS is what lets CreateFile open a directory.
+    let file = std::fs::OpenOptions::new()
+        .access_mode(WRITE_DAC | READ_CONTROL)
+        .share_mode(0)
+        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
+        .open(dir)
+        .map_err(|e| format!("open credential directory: {e}"))?;
+    restrict_handle(&file, true)
+}
+
+/// One ACE as the read-back saw it.
+struct AceRead {
+    ace_type: u8,
+    inherited: bool,
+    is_token_user: bool,
+    grants_read: bool,
+}
+
+/// What the read-back saw on a file: ownership, control bits, DACL.
+struct SecurityRead {
+    owner_is_token_owner: bool,
+    control: u16,
+    dacl_present: bool,
+    aces: Vec<AceRead>,
+}
+
+/// Fail closed unless `file` is owned by this process's owner identity and
+/// its DACL is protected, non-null, carries no inherited ACE, and consists of
+/// at least one allow ACE, each for the current user and each granting read.
+/// Any deny or other ACE type is refused.
 pub(super) fn verify_owner_only(file: &File) -> Result<(), String> {
-    let mut sid = current_user_sid()?;
-    let psid = sid.as_mut_ptr().cast::<core::ffi::c_void>();
+    validate_owner_only(&read_security(file)?)
+}
+
+fn read_security(file: &File) -> Result<SecurityRead, String> {
+    let mut user = current_user_sid()?;
+    let mut owner = token_owner_sid()?;
+    let psid = user.as_mut_ptr().cast::<core::ffi::c_void>();
     let handle = file.as_raw_handle() as HANDLE;
     unsafe {
         let mut needed = 0u32;
         GetKernelObjectSecurity(
             handle,
-            DACL_SECURITY_INFORMATION,
+            DACL_SECURITY_INFORMATION | OWNER_SECURITY_INFORMATION,
             std::ptr::null_mut(),
             0,
             &mut needed,
         );
         if needed == 0 {
-            return Err(os_error("read scoped descriptor ACL size"));
+            return Err(os_error("read credential security size"));
         }
         let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
         let descriptor: PSECURITY_DESCRIPTOR = buffer.as_mut_ptr().cast();
         if GetKernelObjectSecurity(
             handle,
-            DACL_SECURITY_INFORMATION,
+            DACL_SECURITY_INFORMATION | OWNER_SECURITY_INFORMATION,
             descriptor,
             needed,
             &mut needed,
         ) == 0
         {
-            return Err(os_error("read scoped descriptor ACL"));
+            return Err(os_error("read credential security"));
+        }
+        let mut owner_sid: *mut core::ffi::c_void = std::ptr::null_mut();
+        let mut owner_defaulted = FALSE;
+        if GetSecurityDescriptorOwner(descriptor, &mut owner_sid, &mut owner_defaulted) == 0 {
+            return Err(os_error("read credential owner"));
         }
+        if owner_sid.is_null() {
+            return Err("credential file has no owner".into());
+        }
+        let owner_is_token_owner =
+            EqualSid(owner_sid, owner.as_mut_ptr().cast::<core::ffi::c_void>()) != 0;
         let mut control = 0u16;
         let mut revision = 0u32;
         if GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) == 0 {
-            return Err(os_error("read scoped descriptor control"));
-        }
-        if control & SE_DACL_PROTECTED == 0 {
-            return Err("scoped descriptor ACL still inherits from its directory".into());
+            return Err(os_error("read credential security control"));
         }
         let mut present = FALSE;
         let mut defaulted = FALSE;
         let mut acl: *mut ACL = std::ptr::null_mut();
         if GetSecurityDescriptorDacl(descriptor, &mut present, &mut acl, &mut defaulted) == 0 {
-            return Err(os_error("read scoped descriptor DACL"));
+            return Err(os_error("read credential DACL"));
         }
-        if present == FALSE || acl.is_null() {
-            return Err("scoped descriptor has no DACL and is open to everyone".into());
-        }
-        let mut size: ACL_SIZE_INFORMATION = std::mem::zeroed();
-        if GetAclInformation(
-            acl,
-            (&mut size as *mut ACL_SIZE_INFORMATION).cast(),
-            std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
-            AclSizeInformation,
-        ) == 0
-        {
-            return Err(os_error("read scoped descriptor ACL entries"));
-        }
-        let mut owner_allowed = false;
-        for index in 0..size.AceCount {
-            let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
-            if GetAce(acl, index, &mut ace) == 0 || ace.is_null() {
-                return Err(os_error("read scoped descriptor ACE"));
+        let dacl_present = present != FALSE && !acl.is_null();
+        let mut aces = Vec::new();
+        if dacl_present {
+            let mut size: ACL_SIZE_INFORMATION = std::mem::zeroed();
+            if GetAclInformation(
+                acl,
+                (&mut size as *mut ACL_SIZE_INFORMATION).cast(),
+                std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
+                AclSizeInformation,
+            ) == 0
+            {
+                return Err(os_error("read credential ACL entries"));
             }
-            let header = *(ace as *const ACE_HEADER);
-            if u32::from(header.AceFlags) & INHERITED_ACE != 0 {
-                return Err("scoped descriptor ACL carries an inherited entry".into());
-            }
-            match header.AceType {
-                // The writer never adds one. A deny cannot widen access, but
-                // one for the user or a group it belongs to (Everyone, Users)
-                // locks the agent out of its own credential, and group
-                // membership is not decidable here: refuse them all.
-                ACCESS_DENIED_ACE_TYPE => {
-                    return Err("scoped descriptor ACL carries a deny entry".into());
+            for index in 0..size.AceCount {
+                let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
+                if GetAce(acl, index, &mut ace) == 0 || ace.is_null() {
+                    return Err(os_error("read credential ACE"));
                 }
-                ACCESS_ALLOWED_ACE_TYPE => {
+                let header = *(ace as *const ACE_HEADER);
+                let inherited = u32::from(header.AceFlags) & INHERITED_ACE != 0;
+                if header.AceType == ACCESS_ALLOWED_ACE_TYPE {
                     let body = ace as *const ACCESS_ALLOWED_ACE;
                     let sid = std::ptr::addr_of!((*body).SidStart);
-                    if EqualSid(sid as *mut _, psid) == 0 {
-                        return Err(
-                            "scoped descriptor ACL grants access beyond the current user".into(),
-                        );
-                    }
-                    if (*body).Mask & FILE_GENERIC_READ != FILE_GENERIC_READ {
-                        return Err("scoped descriptor ACL does not let the user read it".into());
-                    }
-                    owner_allowed = true;
-                }
-                other => {
-                    return Err(format!(
-                        "scoped descriptor ACL carries an unsupported entry type {other}"
-                    ))
+                    aces.push(AceRead {
+                        ace_type: header.AceType,
+                        inherited,
+                        is_token_user: EqualSid(sid as *mut _, psid) != 0,
+                        grants_read: (*body).Mask & FILE_GENERIC_READ == FILE_GENERIC_READ,
+                    });
+                } else {
+                    aces.push(AceRead {
+                        ace_type: header.AceType,
+                        inherited,
+                        is_token_user: false,
+                        grants_read: false,
+                    });
                 }
             }
         }
-        if !owner_allowed {
-            return Err("scoped descriptor ACL does not grant the current user".into());
+        Ok(SecurityRead {
+            owner_is_token_owner,
+            control,
+            dacl_present,
+            aces,
+        })
+    }
+}
+
+fn validate_owner_only(read: &SecurityRead) -> Result<(), String> {
+    if !read.owner_is_token_owner {
+        return Err("credential file is owned by another account".into());
+    }
+    if read.control & SE_DACL_PROTECTED == 0 {
+        return Err("credential ACL still inherits from its directory".into());
+    }
+    if !read.dacl_present {
+        return Err("credential file has no DACL and is open to everyone".into());
+    }
+    let mut owner_allowed = false;
+    for ace in &read.aces {
+        if ace.inherited {
+            return Err("credential ACL carries an inherited entry".into());
+        }
+        match ace.ace_type {
+            // The writers never add one. A deny cannot widen access, but one
+            // for the user or a group it belongs to (Everyone, Users) locks
+            // the agent out of its own credential, and group membership is
+            // not decidable here: refuse them all.
+            ACCESS_DENIED_ACE_TYPE => {
+                return Err("credential ACL carries a deny entry".into());
+            }
+            ACCESS_ALLOWED_ACE_TYPE => {
+                if !ace.is_token_user {
+                    return Err("credential ACL grants access beyond the current user".into());
+                }
+                if !ace.grants_read {
+                    return Err("credential ACL does not let the user read it".into());
+                }
+                owner_allowed = true;
+            }
+            other => {
+                return Err(format!(
+                    "credential ACL carries an unsupported entry type {other}"
+                ))
+            }
         }
     }
+    if !owner_allowed {
+        return Err("credential ACL does not grant the current user".into());
+    }
     Ok(())
 }
 
@@ -377,4 +508,44 @@ mod tests {
         restrict_to_current_user(&file).unwrap();
         verify_owner_only(&file).unwrap();
     }
+
+    /// A crafted read-back: an otherwise perfect ACL on a file owned by
+    /// another account. Building this on disk would need SeTakeOwnership, so
+    /// the validation runs on the parsed snapshot directly.
+    fn crafted(owner_is_token_owner: bool) -> SecurityRead {
+        SecurityRead {
+            owner_is_token_owner,
+            control: SE_DACL_PROTECTED,
+            dacl_present: true,
+            aces: vec![AceRead {
+                ace_type: ACCESS_ALLOWED_ACE_TYPE,
+                inherited: false,
+                is_token_user: true,
+                grants_read: true,
+            }],
+        }
+    }
+
+    #[test]
+    fn a_foreign_owner_is_refused_even_with_a_narrow_acl() {
+        let error = validate_owner_only(&crafted(false)).unwrap_err();
+        assert!(error.contains("owned by another account"), "{error}");
+    }
+
+    #[test]
+    fn the_token_owner_passes_the_owner_check() {
+        validate_owner_only(&crafted(true)).unwrap();
+    }
+
+    #[test]
+    fn a_restricted_directory_passes_the_same_check() {
+        let dir = crate::testutil::TempDir::new("api-w207b-dir-restrict");
+        let inner = dir.path().join("agent-access");
+        std::fs::create_dir(&inner).unwrap();
+        restrict_directory_to_current_user(&inner).unwrap();
+        // A file created inside inherits the user-only grant, and the writer
+        // still replaces its DACL like any other credential file.
+        let file = open(&inner.join("child.json"));
+        restrict_to_current_user(&file).unwrap();
+    }
 }
diff --git a/src-tauri/src/api/credential_acl_tests.rs b/src-tauri/src/api/credential_acl_tests.rs
index f19e380..17fbf48 100644
--- a/src-tauri/src/api/credential_acl_tests.rs
+++ b/src-tauri/src/api/credential_acl_tests.rs
@@ -8,9 +8,10 @@ use std::path::Path;
 use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
 use windows_sys::Win32::Security::{
     AclSizeInformation, EqualSid, GetAce, GetAclInformation, GetFileSecurityW,
-    GetSecurityDescriptorControl, GetSecurityDescriptorDacl, GetTokenInformation, TokenUser,
-    ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION, DACL_SECURITY_INFORMATION,
-    INHERITED_ACE, PSECURITY_DESCRIPTOR, SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
+    GetSecurityDescriptorControl, GetSecurityDescriptorDacl, GetSecurityDescriptorOwner,
+    GetTokenInformation, TokenUser, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION,
+    DACL_SECURITY_INFORMATION, INHERITED_ACE, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
+    SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
 };
 use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
 
@@ -19,12 +20,14 @@ use crate::testutil::TempDir;
 const ALLOWED: u8 = 0;
 const DENIED: u8 = 1;
 
-/// What the oracle saw in a file's DACL.
+/// What the oracle saw in a file's security descriptor.
 #[derive(Debug)]
 struct Dacl {
     protected: bool,
     /// (ace type, ace flags, SID equals the current user)
     aces: Vec<(u8, u8, bool)>,
+    /// The owner SID equals the current user.
+    owner_is_user: bool,
 }
 
 /// DWORD-aligned, as a SID must be.
@@ -70,7 +73,7 @@ fn read_dacl(path: &Path) -> Dacl {
         let mut needed = 0u32;
         GetFileSecurityW(
             wide.as_ptr(),
-            DACL_SECURITY_INFORMATION,
+            DACL_SECURITY_INFORMATION | OWNER_SECURITY_INFORMATION,
             std::ptr::null_mut(),
             0,
             &mut needed,
@@ -81,7 +84,7 @@ fn read_dacl(path: &Path) -> Dacl {
         assert_ne!(
             GetFileSecurityW(
                 wide.as_ptr(),
-                DACL_SECURITY_INFORMATION,
+                DACL_SECURITY_INFORMATION | OWNER_SECURITY_INFORMATION,
                 descriptor,
                 needed,
                 &mut needed
@@ -90,6 +93,14 @@ fn read_dacl(path: &Path) -> Dacl {
             "{}",
             std::io::Error::last_os_error()
         );
+        let mut owner: *mut core::ffi::c_void = std::ptr::null_mut();
+        let mut owner_defaulted = 0;
+        assert_ne!(
+            GetSecurityDescriptorOwner(descriptor, &mut owner, &mut owner_defaulted),
+            0
+        );
+        assert!(!owner.is_null(), "a descriptor without an owner is foreign");
+        let owner_is_user = EqualSid(owner, user.as_mut_ptr().cast()) != 0;
         let mut control = 0u16;
         let mut revision = 0u32;
         assert_ne!(
@@ -135,18 +146,14 @@ fn read_dacl(path: &Path) -> Dacl {
         Dacl {
             protected: control & SE_DACL_PROTECTED != 0,
             aces,
+            owner_is_user,
         }
     }
 }
 
-#[test]
-fn scoped_descriptor_file_grants_only_the_current_user() {
-    let dir = TempDir::new("api-w207-acl");
-    let server = crate::api::tests::native_server(dir.path(), "run-acl", "owner", 1);
-    let path = server
-        .issue_run_descriptor_file("run-acl", "owner", 1, 60)
-        .unwrap();
-    let dacl = read_dacl(&path);
+/// W2-07/W2-07b shape: protected against inheritance, every ACE decided here
+/// grants only the current user, and the file belongs to that user.
+fn assert_owner_only(dacl: &Dacl) {
     assert!(
         dacl.protected,
         "inheritance from the parent directory must be cut: {dacl:?}"
@@ -164,12 +171,54 @@ fn scoped_descriptor_file_grants_only_the_current_user() {
             .any(|&(kind, _, is_user)| kind == ALLOWED && is_user),
         "the agent runs as the current user and must still read it: {dacl:?}"
     );
+    assert!(
+        dacl.owner_is_user,
+        "the file must belong to the current user: {dacl:?}"
+    );
+}
+
+#[test]
+fn scoped_descriptor_file_grants_only_the_current_user() {
+    let dir = TempDir::new("api-w207-acl");
+    let server = crate::api::tests::native_server(dir.path(), "run-acl", "owner", 1);
+    let path = server
+        .issue_run_descriptor_file("run-acl", "owner", 1, 60)
+        .unwrap();
+    let dacl = read_dacl(&path);
+    assert_owner_only(&dacl);
     // The launcher still reads what it wrote.
     let descriptor: crate::api::Descriptor =
         serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
     assert_eq!(descriptor.port, server.port());
 }
 
+/// W2-07b: the broad descriptor holds the same key to the app as a scoped one
+/// and must be narrowed the same way.
+#[test]
+fn broad_descriptor_grants_only_the_current_user() {
+    let dir = TempDir::new("api-w207b-broad");
+    let server = crate::api::tests::native_server(dir.path(), "run-acl", "owner", 1);
+    let dacl = read_dacl(server.descriptor_path());
+    assert_owner_only(&dacl);
+    // The CLI still reads what the app wrote.
+    let descriptor: crate::api::Descriptor =
+        serde_json::from_slice(&std::fs::read(server.descriptor_path()).unwrap()).unwrap();
+    assert_eq!(descriptor.port, server.port());
+}
+
+/// W2-07b: the directory itself decides who may list it, plant files in it,
+/// or delete from it - a narrow DACL on the files alone leaves all three open.
+#[test]
+fn agent_access_directory_grants_only_the_current_user() {
+    let dir = TempDir::new("api-w207b-dir");
+    let server = crate::api::tests::native_server(dir.path(), "run-acl", "owner", 1);
+    server
+        .issue_run_descriptor_file("run-acl", "owner", 1, 60)
+        .unwrap();
+    let dacl = read_dacl(&dir.path().join("agent-access"));
+    assert_owner_only(&dacl);
+}
+
 /// A failed restriction refuses the launch and leaves neither the file nor
 /// the grant behind (the handle is closed before the cleanup deletes it).
 #[test]
```
