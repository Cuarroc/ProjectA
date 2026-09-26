# Delta-Review-Auftrag: W2-07 Runde 2 — Umsetzung der Befunde aus Runde 1 (Rust, Nahtstelle `src-tauri/src/api/*`)

Du bist unabhängiger Code-Reviewer. Antworte auf Deutsch. Befunde als
`X<n> — <hoch|mittel|niedrig> — <Stelle>` mit Begründung und Fix, danach
"Geprüft und verworfen" und Gesamturteil (mergebar ja/nein). Prüfe nur das Delta:
ob die Befunde korrekt umgesetzt sind und ob das Delta neue Fehler einführt.

## Kontext

Paket W2-07: scoped Run-Descriptor-Dateien (`agent-access/<32 hex>.json`) bekommen unter
Windows eine geschützte DACL mit genau einem Allow-ACE für den Token-User, die über
dasselbe Handle zurückgelesen und fail-closed verifiziert wird, bevor das Token
geschrieben wird; beim Boot werden verwaiste scoped Descriptor-Dateien eines
Vorgängerprozesses gelöscht. Runde 1 (kimi-k3, deepseek-v4-flash): beide "mergebar ja",
nur niedrige/mittlere Befunde.

## Umgesetzt in diesem Delta

- K-X2 / D-X1 / D-X5: `verify_owner_only` lehnt jetzt **jeden** Deny-ACE ab (ein Deny
  für den User oder eine Gruppe, in der er Mitglied ist — z.B. Everyone — sperrt den
  Agent aus; Gruppenmitgliedschaft ist dort nicht entscheidbar) und einen Allow-ACE für
  den User ohne vollständiges `FILE_GENERIC_READ`.
- D-X3: `current_user_sid` meldet eine fehlende Größe aus dem Sizing-Aufruf explizit
  (der Sizing-Aufruf selbst liefert absichtlich 0 mit ERROR_INSUFFICIENT_BUFFER, daher
  wird nicht sein Rückgabewert, sondern `needed == 0` geprüft).
- K-X7 / D-X4: Test-Seam `FAIL_NEXT_RESTRICT` (thread_local, nur `#[cfg(test)]`) lässt die
  nächste Restriktion nach gesetzter DACL scheitern; neuer Test
  `a_failed_restriction_leaves_no_descriptor_and_no_grant` belegt: Fehler propagiert,
  `agent-access/` leer, kein Grant mehr (bind_session scheitert).
- K-X4a: Orakel-SID als `Vec<u32>`. K-X6: `#![cfg(windows)]` in beiden neuen Dateien.
  K-X1: Kommentar an der Sweep-Aufrufstelle zur Single-Instance-Invariante. K-X5:
  Kommentar zur Namenskopplung an `new_token()` (bestehender Wächtertest).
- Neue Unit-Tests: `a_user_entry_without_read_access_is_refused`, `any_deny_entry_is_refused`
  (Deny für User und für Everyone).

## Bewusst nicht umgesetzt (Begründung)

- D-X2 (MSRV `is_ok_and`): MSRV des Crates ist 1.77, `is_ok_and` ist seit 1.70 stabil.
- K-X4b (Flake auf gehärtetem TEMP): Auch unter einem geschützten Elternverzeichnis tragen
  die vererbten ACEs der neuen Datei das INHERITED-Flag und die Datei selbst ist nicht
  geschützt — der Test bleibt deterministisch rot für geerbte ACLs.
- K-X3 (Diagnose auf Volumes ohne persistente ACLs) und K-X5-Logging: Folgearbeit (api.rs
  hat keinen Logger; Diagnose-Text ist eine eigene Entscheidung).

Ergebnis lokal: `cargo test --bin projecta api::` 99/99, clippy `--all-targets -D warnings` grün.

## Delta-Diff (Runde-1-Stand -> jetzt)

```diff
diff --git a/src-tauri/src/api.rs b/src-tauri/src/api.rs
index 08876e1..8ef999f 100644
--- a/src-tauri/src/api.rs
+++ b/src-tauri/src/api.rs
@@ -944,6 +944,9 @@ fn boot(
     let verdict_token = new_token()?;
     let descriptor = write_descriptor(dir, port, &token)?;
     // Restart revoked every scoped grant; their files must not outlive it.
+    // Safe only because the single-instance guard (main.rs) is held before
+    // `api::start`: every scoped file here belongs to a dead process, or to
+    // one in its exit handler whose agents are being killed (F1-SI-1).
     agent_access::sweep_orphaned_descriptor_files(dir);
 
     let inner = Arc::new(Inner {
diff --git a/src-tauri/src/api/agent_access.rs b/src-tauri/src/api/agent_access.rs
index e8e83e8..b52a763 100644
--- a/src-tauri/src/api/agent_access.rs
+++ b/src-tauri/src/api/agent_access.rs
@@ -279,7 +279,9 @@ pub(super) const ACCESS_DIR: &str = "agent-access";
 /// never ran) or exiting (its agents are being killed). Their tokens are
 /// already dead; the files go too. Only names this module mints
 /// (`<32 lowercase hex>.json`, regular files) are touched. Best effort: a
-/// file that cannot be removed holds a token no server honours.
+/// file that cannot be removed holds a token no server honours. The name
+/// shape is `new_token()`'s (`{:032x}`), guarded by
+/// `new_token_has_the_shape_redact_expects_to_mask`.
 pub(super) fn sweep_orphaned_descriptor_files(api_dir: &Path) -> usize {
     let Ok(entries) = std::fs::read_dir(api_dir.join(ACCESS_DIR)) else {
         return 0;
diff --git a/src-tauri/src/api/credential_acl.rs b/src-tauri/src/api/credential_acl.rs
index 3856f43..d22997c 100644
--- a/src-tauri/src/api/credential_acl.rs
+++ b/src-tauri/src/api/credential_acl.rs
@@ -12,6 +12,7 @@
 //! The handle is opened with share mode 0, so between `CreateFileW` and the
 //! new DACL no other process can open the still-empty file and keep a handle
 //! whose access was checked against the inherited ACL.
+#![cfg(windows)]
 use std::fs::File;
 use std::os::windows::io::AsRawHandle;
 
@@ -25,9 +26,17 @@ use windows_sys::Win32::Security::{
     DACL_SECURITY_INFORMATION, INHERITED_ACE, PROTECTED_DACL_SECURITY_INFORMATION,
     PSECURITY_DESCRIPTOR, SECURITY_DESCRIPTOR, SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
 };
-use windows_sys::Win32::Storage::FileSystem::FILE_ALL_ACCESS;
+use windows_sys::Win32::Storage::FileSystem::{FILE_ALL_ACCESS, FILE_GENERIC_READ};
 use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
 
+#[cfg(test)]
+thread_local! {
+    /// Test seam: make the next `restrict_to_current_user` on this thread
+    /// fail after the DACL was applied, to prove the issuer's cleanup path.
+    pub(super) static FAIL_NEXT_RESTRICT: std::cell::Cell<bool> =
+        const { std::cell::Cell::new(false) };
+}
+
 /// `Win32::System::SystemServices` values; that feature is not enabled.
 const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
 const ACCESS_DENIED_ACE_TYPE: u8 = 1;
@@ -45,8 +54,15 @@ fn current_user_sid() -> Result<Vec<u32>, String> {
             return Err(os_error("open process token"));
         }
         let mut needed = 0u32;
+        // The sizing call "fails" with ERROR_INSUFFICIENT_BUFFER by design;
+        // only a missing size is an error.
         GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
-        let mut buffer = vec![0u64; (needed as usize).div_ceil(8).max(1)];
+        if needed == 0 {
+            let error = os_error("size token user");
+            CloseHandle(token);
+            return Err(error);
+        }
+        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
         let ok = GetTokenInformation(
             token,
             TokenUser,
@@ -108,12 +124,16 @@ pub(super) fn restrict_to_current_user(file: &File) -> Result<(), String> {
             return Err(os_error("restrict scoped descriptor ACL"));
         }
     }
+    #[cfg(test)]
+    if FAIL_NEXT_RESTRICT.with(|fail| fail.replace(false)) {
+        return Err("injected scoped descriptor ACL failure".into());
+    }
     verify_owner_only(file)
 }
 
 /// Fail closed unless the DACL on `file` is protected, non-null, carries no
-/// inherited ACE, and allows nobody but the current user. Deny ACEs only
-/// narrow access and are accepted; any other ACE type is refused.
+/// inherited ACE, and consists of at least one allow ACE, each for the
+/// current user and each granting read. Any deny or other ACE type is refused.
 pub(super) fn verify_owner_only(file: &File) -> Result<(), String> {
     let mut sid = current_user_sid()?;
     let psid = sid.as_mut_ptr().cast::<core::ffi::c_void>();
@@ -180,15 +200,24 @@ pub(super) fn verify_owner_only(file: &File) -> Result<(), String> {
                 return Err("scoped descriptor ACL carries an inherited entry".into());
             }
             match header.AceType {
-                ACCESS_DENIED_ACE_TYPE => {}
+                // The writer never adds one. A deny cannot widen access, but
+                // one for the user or a group it belongs to (Everyone, Users)
+                // locks the agent out of its own credential, and group
+                // membership is not decidable here: refuse them all.
+                ACCESS_DENIED_ACE_TYPE => {
+                    return Err("scoped descriptor ACL carries a deny entry".into());
+                }
                 ACCESS_ALLOWED_ACE_TYPE => {
-                    let ace_sid =
-                        std::ptr::addr_of!((*(ace as *const ACCESS_ALLOWED_ACE)).SidStart);
-                    if EqualSid(ace_sid as *mut _, psid) == 0 {
+                    let body = ace as *const ACCESS_ALLOWED_ACE;
+                    let sid = std::ptr::addr_of!((*body).SidStart);
+                    if EqualSid(sid as *mut _, psid) == 0 {
                         return Err(
                             "scoped descriptor ACL grants access beyond the current user".into(),
                         );
                     }
+                    if (*body).Mask & FILE_GENERIC_READ != FILE_GENERIC_READ {
+                        return Err("scoped descriptor ACL does not let the user read it".into());
+                    }
                     owner_allowed = true;
                 }
                 other => {
@@ -210,8 +239,12 @@ mod tests {
     use super::*;
     use std::os::windows::fs::OpenOptionsExt;
     use windows_sys::Win32::Foundation::GENERIC_WRITE;
-    use windows_sys::Win32::Security::{CreateWellKnownSid, WinWorldSid, SECURITY_MAX_SID_SIZE};
-    use windows_sys::Win32::Storage::FileSystem::{FILE_GENERIC_READ, READ_CONTROL, WRITE_DAC};
+    use windows_sys::Win32::Security::{
+        AddAccessDeniedAce, CreateWellKnownSid, WinWorldSid, SECURITY_MAX_SID_SIZE,
+    };
+    use windows_sys::Win32::Storage::FileSystem::{
+        FILE_GENERIC_WRITE, FILE_READ_DATA, READ_CONTROL, WRITE_DAC,
+    };
 
     fn open(path: &std::path::Path) -> File {
         std::fs::OpenOptions::new()
@@ -223,8 +256,13 @@ mod tests {
             .unwrap()
     }
 
-    /// Apply a protected DACL: the current user plus `Everyone` read.
-    fn widen_to_everyone(file: &File) {
+    enum Who {
+        User,
+        Everyone,
+    }
+
+    /// Apply a protected DACL built from `(allow, mask, who)` entries.
+    fn apply(file: &File, entries: &[(bool, u32, Who)]) {
         let mut user = current_user_sid().unwrap();
         let mut world = vec![0u32; (SECURITY_MAX_SID_SIZE as usize).div_ceil(4)];
         let mut world_size = SECURITY_MAX_SID_SIZE;
@@ -238,22 +276,21 @@ mod tests {
                 ),
                 0
             );
-            let mut acl_buffer = vec![0u32; 64];
+            let mut acl_buffer = vec![0u32; 128];
             let acl = acl_buffer.as_mut_ptr().cast::<ACL>();
-            assert_ne!(InitializeAcl(acl, 256, ACL_REVISION), 0);
-            assert_ne!(
-                AddAccessAllowedAce(acl, ACL_REVISION, FILE_ALL_ACCESS, user.as_mut_ptr().cast()),
-                0
-            );
-            assert_ne!(
-                AddAccessAllowedAce(
-                    acl,
-                    ACL_REVISION,
-                    FILE_GENERIC_READ,
-                    world.as_mut_ptr().cast()
-                ),
-                0
-            );
+            assert_ne!(InitializeAcl(acl, 512, ACL_REVISION), 0);
+            for (allow, mask, who) in entries {
+                let sid = match who {
+                    Who::User => user.as_mut_ptr().cast(),
+                    Who::Everyone => world.as_mut_ptr().cast(),
+                };
+                let added = if *allow {
+                    AddAccessAllowedAce(acl, ACL_REVISION, *mask, sid)
+                } else {
+                    AddAccessDeniedAce(acl, ACL_REVISION, *mask, sid)
+                };
+                assert_ne!(added, 0);
+            }
             let mut descriptor: SECURITY_DESCRIPTOR = std::mem::zeroed();
             let pdescriptor: PSECURITY_DESCRIPTOR =
                 (&mut descriptor as *mut SECURITY_DESCRIPTOR).cast();
@@ -279,6 +316,13 @@ mod tests {
         }
     }
 
+    fn refused(label: &str, entries: &[(bool, u32, Who)]) -> String {
+        let dir = crate::testutil::TempDir::new(label);
+        let file = open(&dir.path().join("probe.json"));
+        apply(&file, entries);
+        verify_owner_only(&file).unwrap_err()
+    }
+
     #[test]
     fn an_inherited_acl_is_refused() {
         let dir = crate::testutil::TempDir::new("api-w207-inherited");
@@ -289,13 +333,43 @@ mod tests {
 
     #[test]
     fn a_protected_acl_that_also_grants_everyone_is_refused() {
-        let dir = crate::testutil::TempDir::new("api-w207-everyone");
-        let file = open(&dir.path().join("wide.json"));
-        widen_to_everyone(&file);
-        let error = verify_owner_only(&file).unwrap_err();
+        let error = refused(
+            "api-w207-everyone",
+            &[
+                (true, FILE_ALL_ACCESS, Who::User),
+                (true, FILE_GENERIC_READ, Who::Everyone),
+            ],
+        );
         assert!(error.contains("beyond the current user"), "{error}");
     }
 
+    #[test]
+    fn a_user_entry_without_read_access_is_refused() {
+        let error = refused(
+            "api-w207-no-read",
+            &[(true, FILE_GENERIC_WRITE | READ_CONTROL, Who::User)],
+        );
+        assert!(error.contains("does not let the user read"), "{error}");
+    }
+
+    #[test]
+    fn any_deny_entry_is_refused() {
+        // Even a deny for Everyone locks the user out: the user is a member.
+        for (label, who) in [
+            ("api-w207-deny-user", Who::User),
+            ("api-w207-deny-all", Who::Everyone),
+        ] {
+            let error = refused(
+                label,
+                &[
+                    (false, FILE_READ_DATA, who),
+                    (true, FILE_ALL_ACCESS, Who::User),
+                ],
+            );
+            assert!(error.contains("deny entry"), "{error}");
+        }
+    }
+
     #[test]
     fn restricting_narrows_an_inherited_acl_to_the_owner() {
         let dir = crate::testutil::TempDir::new("api-w207-restrict");
diff --git a/src-tauri/src/api/credential_acl_tests.rs b/src-tauri/src/api/credential_acl_tests.rs
index e804145..f19e380 100644
--- a/src-tauri/src/api/credential_acl_tests.rs
+++ b/src-tauri/src/api/credential_acl_tests.rs
@@ -1,6 +1,7 @@
 //! W2-07: the Windows DACL of a scoped run descriptor, read back by an oracle
 //! that shares no code with the production writer. Windows only: on unix the
 //! 0o600 mode is asserted by `scoped_descriptor_files_are_unique_and_removed_on_revocation`.
+#![cfg(windows)]
 use std::os::windows::ffi::OsStrExt;
 use std::path::Path;
 
@@ -26,7 +27,8 @@ struct Dacl {
     aces: Vec<(u8, u8, bool)>,
 }
 
-fn current_user_sid() -> Vec<u8> {
+/// DWORD-aligned, as a SID must be.
+fn current_user_sid() -> Vec<u32> {
     unsafe {
         let mut token: HANDLE = std::ptr::null_mut();
         assert_ne!(
@@ -47,7 +49,13 @@ fn current_user_sid() -> Vec<u8> {
         assert_ne!(ok, 0, "{}", std::io::Error::last_os_error());
         let user = &*(buffer.as_ptr() as *const TOKEN_USER);
         let length = windows_sys::Win32::Security::GetLengthSid(user.User.Sid) as usize;
-        std::slice::from_raw_parts(user.User.Sid as *const u8, length).to_vec()
+        let mut owned = vec![0u32; length.div_ceil(4)];
+        std::ptr::copy_nonoverlapping(
+            user.User.Sid as *const u8,
+            owned.as_mut_ptr().cast::<u8>(),
+            length,
+        );
+        owned
     }
 }
 
@@ -161,3 +169,27 @@ fn scoped_descriptor_file_grants_only_the_current_user() {
         serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
     assert_eq!(descriptor.port, server.port());
 }
+
+/// A failed restriction refuses the launch and leaves neither the file nor
+/// the grant behind (the handle is closed before the cleanup deletes it).
+#[test]
+fn a_failed_restriction_leaves_no_descriptor_and_no_grant() {
+    let dir = TempDir::new("api-w207-acl-fail");
+    let server = crate::api::tests::native_server(dir.path(), "run-acl", "owner", 1);
+    crate::api::credential_acl::FAIL_NEXT_RESTRICT.with(|fail| fail.set(true));
+    let error = server
+        .issue_run_descriptor_file("run-acl", "owner", 1, 60)
+        .unwrap_err();
+    assert!(error.contains("injected"), "{error}");
+    let left: Vec<_> = std::fs::read_dir(dir.path().join("agent-access"))
+        .unwrap()
+        .flatten()
+        .map(|entry| entry.path())
+        .collect();
+    assert!(left.is_empty(), "{left:?}");
+    // No grant for the run survived: there is nothing to bind a session to.
+    assert!(server
+        .run_credential_issuer()
+        .bind_session("run-acl", "session")
+        .is_err());
+}
```
