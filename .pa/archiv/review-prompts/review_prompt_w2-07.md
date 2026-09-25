# Review-Auftrag: W2-07 — Windows-ACL-Verifikation der scoped Credentials + Credential-Lebenszyklus im Recovery (Rust, Nahtstelle `src-tauri/src/api.rs` / `api/*`)

Du bist unabhängiger Code-Reviewer. Du hast an diesem Artefakt nicht mitgearbeitet.
Antworte auf Deutsch. Liefere Befunde als `X<n> — <hoch|mittel|niedrig> — <Stelle>` mit
Begründung und konkretem Fix-Vorschlag, danach einen Abschnitt "Geprüft und verworfen"
und ein Gesamturteil (mergebar ja/nein). Bitte besonders prüfen: Unsafe-Win32-Aufrufe
(Puffergrößen, Alignment, Handle-Rechte), ob die Verifikation wirklich fail-closed ist,
ob das Löschen beim Boot eine lebende Instanz schädigen kann, und Plattform-Kompilierung
(unix darf nichts Windows-Spezifisches sehen).

## Kontext

Plan-Paket: "W2-07 Windows-ACL-Verifikation der scoped Credentials · S · Lane api.rs ·
plus Credential-Lebenszyklus im Recovery".

`RunCredentialIssuer::issue_run_descriptor_file` (`api/agent_access.rs`) schreibt für
jeden Entwicklungs-Launch eine Datei `<app-data>/agent-access/<32 hex>.json` mit
`{port, token}` — ein auf einen Run begrenztes Token für die Agent-API. Die Grants
leben nur im Speicher des Prozesses (`RunCredentials`, HashMap). Revokation löscht
Grant und Datei (`revoke_run_credentials`, `observe_exit`, `Drop for ApiServer` ->
`revoke_all`).

Befunde vor diesem Paket:
1. Unix: `OpenOptions::mode(0o600)`. Windows: nichts — die Datei erbt die ACL von
   `agent-access/`. Gemessen im Test (rot vor dem Fix): DACL nicht geschützt, sieben
   geerbte ACEs, davon sechs für andere Prinzipale (SYSTEM, Administratoren, …).
2. Absturz überspringt `Drop` -> `revoke_all` läuft nie -> die Dateien bleiben auf der
   Platte. Die Tokens darin sind tot (ein neuer Prozess hat eine leere Grant-Map, siehe
   Test `expired_and_previous_process_credentials_are_rejected`), aber sie liegen herum.
   Auch ein regulärer App-Exit droppt den Tauri-State nicht zuverlässig.

## Design

**Windows-ACL** (neues `api/credential_acl.rs`, nur `#[cfg(windows)]`, nur bereits
aktivierte `windows-sys`-Features `Win32_Security`, `Win32_System_Threading`,
`Win32_Storage_FileSystem`, `Win32_Foundation` — kein neues Crate, kein neues Feature):
- Datei wird mit `create_new`, `share_mode(0)` und
  `access_mode(GENERIC_WRITE | WRITE_DAC | READ_CONTROL)` geöffnet. Share-Mode 0: bis
  unser Handle geschlossen ist, kann kein anderer Prozess die (noch leere) Datei öffnen
  und ein Handle behalten, dessen Rechte gegen die geerbte ACL geprüft wurden.
- `restrict_to_current_user`: SID des Token-Users (`OpenProcessToken`/`GetTokenInformation(TokenUser)`),
  ACL mit genau einem `FILE_ALL_ACCESS`-Allow-ACE, Security-Descriptor mit
  `SE_DACL_PROTECTED`-Controlbit, `SetKernelObjectSecurity(DACL | PROTECTED_DACL)` auf
  dem Handle. Gemessen: ohne das Controlbit bleibt die DACL ungeschützt, das Flag allein
  greift nicht.
- `verify_owner_only`: liest die DACL über dasselbe Handle zurück und scheitert
  (Err), wenn: nicht geschützt, keine/NULL-DACL, irgendein ACE mit `INHERITED_ACE`,
  ein Allow-ACE für eine andere SID, ein unbekannter ACE-Typ, oder gar kein Allow-ACE für
  den User. Deny-ACEs werden akzeptiert (sie verengen nur).
- Aufruf in `issue_run_descriptor_file` nach Registrierung von `descriptor_file` am
  Grant und **vor** `write_all(token)`. Ein Fehler läuft in den bestehenden Fehlerpfad:
  Grant wird entfernt, Datei gelöscht (das Handle ist dann schon gedroppt, weil
  `file` im Closure lebt). Launch scheitert -> `with_launch_reconciliation`.

**Recovery** (`agent_access::sweep_orphaned_descriptor_files`, aufgerufen in
`api::boot` nach `write_descriptor`): löscht in `<dir>/agent-access/` alle regulären
Dateien mit Namen `<genau 32 kleine Hex>.json`. Begründung: Grants sind reiner
Prozessspeicher, beim Boot gehört jede solche Datei einem abgestürzten oder gerade
endenden Vorgänger (Single-Instance-Guard; beim Updater-Relaunch kann der Vorgänger
noch im Exit-Handler sein, dort werden seine PTYs gerade gekillt — seine Tokens sterben
ohnehin mit ihm). Best effort: nicht löschbar heißt nur, ein totes Token bleibt liegen.
Fremde Dateinamen bleiben unberührt.

**Unix** unverändert (`mode(0o600)`, bestehender cfg(unix)-Assert). Die
`#[cfg(unix)]`-Tests kompilieren lokal unter Windows nicht (KI-7), CI deckt sie ab.

## Tests / Beleg rot -> grün

- Commit 1 (rot, Produktcode unverändert): `api/credential_acl_tests.rs` (Windows) —
  unabhängiges Win32-Orakel (`GetFileSecurityW` per Pfad, teilt keinen Code mit dem
  Produktionsschreiber) prüft protected, keine geerbten ACEs, nur Allow für den User.
  Rot: `inheritance from the parent directory must be cut: Dacl { protected: false,
  aces: [(0,16,false) x6, (0,16,true)] }`. Und
  `api::tests::orphaned_scoped_descriptor_files_are_swept_at_boot` — rot: die
  Vorgänger-Datei überlebt den Boot. Beide Exit 101.
- Commit 2 (Fix): beide grün; dazu Unit-Tests in `credential_acl.rs`: geerbte ACL wird
  abgelehnt; geschützte ACL mit User + `Everyone`-Read wird abgelehnt; restrict +
  verify auf frischer Datei ok. `cargo test --bin projecta api::` 96/96,
  `workers::` 150 ok (2 ignoriert), clippy `--all-targets -D warnings` grün.

## Bekannte, bewusst nicht enthaltene Folgearbeiten

- Die breite Descriptor-Datei `projecta-api.json` (`write_descriptor`) bekommt unter
  Windows weiterhin keine ACL (Paket nennt nur scoped Credentials).
- Das Verzeichnis `agent-access/` selbst wird nicht verengt; ein Junction-Tausch des
  Verzeichnisses durch einen Prozess desselben Users wird nicht abgewehrt.
- Abgelaufene Grants werden erst beim nächsten `issue`/`revoke` samt Datei entfernt
  (Token ist ab Ablauf bereits abgelehnt).
- Owner der Datei wird nicht geprüft (Owner hat implizit `WRITE_DAC`; bei elevierter
  Ausführung kann der Owner die Administratoren-Gruppe sein).
- Die `#[ignore]`-Native-Host-Tests (`store/native_managed_tests.rs`), die ein Kind die
  Datei lesen lassen, wurden nicht ausgeführt (brauchen gebauten `pa-capture-host`).

## Vollständiger Diff gegen origin/main

```diff
diff --git a/src-tauri/src/api.rs b/src-tauri/src/api.rs
index e3f7d50..08876e1 100644
--- a/src-tauri/src/api.rs
+++ b/src-tauri/src/api.rs
@@ -185,6 +185,12 @@ pub const DESCRIPTOR_FILE: &str = "projecta-api.json";
 #[path = "api/agent_access.rs"]
 mod agent_access;
 pub use agent_access::{CandidateInput, RunCredentialIssuer};
+#[cfg(windows)]
+#[path = "api/credential_acl.rs"]
+mod credential_acl;
+#[cfg(all(test, windows))]
+#[path = "api/credential_acl_tests.rs"]
+mod credential_acl_tests;
 
 /// Header carrying the shared token. Lower case: header names are compared
 /// case-insensitively, and this is the form the CLI sends.
@@ -937,6 +943,8 @@ fn boot(
     // same token twice.
     let verdict_token = new_token()?;
     let descriptor = write_descriptor(dir, port, &token)?;
+    // Restart revoked every scoped grant; their files must not outlive it.
+    agent_access::sweep_orphaned_descriptor_files(dir);
 
     let inner = Arc::new(Inner {
         journal_waits: crate::http_util::connection_limiter_with(8),
@@ -4263,6 +4271,39 @@ pub(crate) mod tests {
         );
     }
 
+    /// W2-07: a crash skips `Drop`, so `revoke_all` never deleted the scoped
+    /// descriptors of the dead process. Their tokens are no longer honoured,
+    /// but they must not stay on disk either: the next boot sweeps them.
+    #[test]
+    fn orphaned_scoped_descriptor_files_are_swept_at_boot() {
+        let dir = TempDir::new("api-run-orphans");
+        let access = dir.path().join("agent-access");
+        std::fs::create_dir_all(&access).unwrap();
+        let orphan = access.join(format!("{}.json", "0123456789abcdef".repeat(2)));
+        std::fs::write(&orphan, r#"{"port":1,"token":"placeholder"}"#).unwrap();
+        let foreign = access.join("notes.txt");
+        std::fs::write(&foreign, "not a descriptor").unwrap();
+        let server = boot(
+            Arc::new(FakeBackend::default()) as Arc<dyn ControlBackend>,
+            dir.path(),
+            false,
+        )
+        .expect("start api");
+        assert!(
+            !orphan.exists(),
+            "a predecessor's scoped descriptor survived boot"
+        );
+        assert!(
+            foreign.exists(),
+            "only files named like a descriptor are ours"
+        );
+        // The fresh server's own descriptors are unaffected by the sweep.
+        let fresh = server
+            .issue_run_descriptor_file("run-a", "worker-a", 7, 60)
+            .unwrap();
+        assert!(fresh.exists());
+    }
+
     #[test]
     fn exited_session_revokes_credentials_even_when_persistence_fails() {
         let fx = fixture("api-run-exit-failure");
diff --git a/src-tauri/src/api/agent_access.rs b/src-tauri/src/api/agent_access.rs
index 58ab68a..e8e83e8 100644
--- a/src-tauri/src/api/agent_access.rs
+++ b/src-tauri/src/api/agent_access.rs
@@ -178,7 +178,7 @@ impl RunCredentialIssuer {
                 .descriptor
                 .parent()
                 .ok_or("API descriptor has no parent")?
-                .join("agent-access");
+                .join(ACCESS_DIR);
             std::fs::create_dir_all(&directory)
                 .map_err(|e| format!("create scoped descriptor directory: {e}"))?;
             let path = directory.join(format!("{}.json", new_token()?));
@@ -189,6 +189,17 @@ impl RunCredentialIssuer {
                 use std::os::unix::fs::OpenOptionsExt;
                 options.mode(0o600);
             }
+            // Windows: no mode; the DACL is replaced below. Share mode 0 keeps
+            // every other opener out until the narrow DACL is in place.
+            #[cfg(windows)]
+            {
+                use std::os::windows::fs::OpenOptionsExt;
+                use windows_sys::Win32::Foundation::GENERIC_WRITE;
+                use windows_sys::Win32::Storage::FileSystem::{READ_CONTROL, WRITE_DAC};
+                options
+                    .access_mode(GENERIC_WRITE | WRITE_DAC | READ_CONTROL)
+                    .share_mode(0);
+            }
             let mut file = options
                 .open(&path)
                 .map_err(|e| format!("create scoped descriptor: {e}"))?;
@@ -202,6 +213,10 @@ impl RunCredentialIssuer {
                 .get_mut(&descriptor.token)
                 .ok_or("run credential revoked before provisioning")?;
             grant.descriptor_file = Some(path.clone());
+            // Fail closed before the token touches the disk: an ACL that is
+            // wider than the current user refuses the whole launch.
+            #[cfg(windows)]
+            super::credential_acl::restrict_to_current_user(&file)?;
             let body = serde_json::to_vec(&descriptor)
                 .map_err(|e| format!("encode scoped descriptor: {e}"))?;
             file.write_all(&body)
@@ -256,6 +271,37 @@ impl RunCredentials {
     }
 }
 
+/// Directory next to the broad descriptor that holds scoped descriptors.
+pub(super) const ACCESS_DIR: &str = "agent-access";
+
+/// Recovery: grants live only in this process's memory, so at boot every
+/// scoped descriptor on disk belongs to a predecessor - crashed (its `Drop`
+/// never ran) or exiting (its agents are being killed). Their tokens are
+/// already dead; the files go too. Only names this module mints
+/// (`<32 lowercase hex>.json`, regular files) are touched. Best effort: a
+/// file that cannot be removed holds a token no server honours.
+pub(super) fn sweep_orphaned_descriptor_files(api_dir: &Path) -> usize {
+    let Ok(entries) = std::fs::read_dir(api_dir.join(ACCESS_DIR)) else {
+        return 0;
+    };
+    let mut removed = 0;
+    for entry in entries.flatten() {
+        let name = entry.file_name();
+        let Some(stem) = name.to_str().and_then(|n| n.strip_suffix(".json")) else {
+            continue;
+        };
+        let minted = stem.len() == 32
+            && stem
+                .bytes()
+                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
+        let regular = entry.file_type().is_ok_and(|kind| kind.is_file());
+        if minted && regular && std::fs::remove_file(entry.path()).is_ok() {
+            removed += 1;
+        }
+    }
+    removed
+}
+
 fn remove_grant_file(grant: &RunGrant) {
     if let Some(path) = &grant.descriptor_file {
         let _ = std::fs::remove_file(path);
diff --git a/src-tauri/src/api/credential_acl.rs b/src-tauri/src/api/credential_acl.rs
new file mode 100644
index 0000000..3856f43
--- /dev/null
+++ b/src-tauri/src/api/credential_acl.rs
@@ -0,0 +1,306 @@
+//! W2-07: a scoped run descriptor on Windows is readable by the current user
+//! and nobody else.
+//!
+//! The unix writer creates the file with mode 0o600. Windows has no mode: a
+//! new file inherits the ACL of `agent-access/`, which under a profile grants
+//! SYSTEM, Administrators and whatever else the parent carries - and under an
+//! overridden data directory possibly `Users` or `Everyone`. So the writer
+//! replaces the DACL with a protected one holding a single ACE for the token
+//! user, reads it back through the same handle and refuses to write the token
+//! unless the read-back is exactly that narrow (fail closed).
+//!
+//! The handle is opened with share mode 0, so between `CreateFileW` and the
+//! new DACL no other process can open the still-empty file and keep a handle
+//! whose access was checked against the inherited ACL.
+use std::fs::File;
+use std::os::windows::io::AsRawHandle;
+
+use windows_sys::Win32::Foundation::{CloseHandle, FALSE, HANDLE, TRUE};
+use windows_sys::Win32::Security::{
+    AclSizeInformation, AddAccessAllowedAce, EqualSid, GetAce, GetAclInformation,
+    GetKernelObjectSecurity, GetLengthSid, GetSecurityDescriptorControl, GetSecurityDescriptorDacl,
+    GetTokenInformation, InitializeAcl, InitializeSecurityDescriptor, IsValidSid,
+    SetKernelObjectSecurity, SetSecurityDescriptorControl, SetSecurityDescriptorDacl, TokenUser,
+    ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_REVISION, ACL_SIZE_INFORMATION,
+    DACL_SECURITY_INFORMATION, INHERITED_ACE, PROTECTED_DACL_SECURITY_INFORMATION,
+    PSECURITY_DESCRIPTOR, SECURITY_DESCRIPTOR, SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
+};
+use windows_sys::Win32::Storage::FileSystem::FILE_ALL_ACCESS;
+use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
+
+/// `Win32::System::SystemServices` values; that feature is not enabled.
+const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
+const ACCESS_DENIED_ACE_TYPE: u8 = 1;
+const SECURITY_DESCRIPTOR_REVISION: u32 = 1;
+
+fn os_error(what: &str) -> String {
+    format!("{what}: {}", std::io::Error::last_os_error())
+}
+
+/// The SID of the user this process runs as, in a DWORD-aligned buffer.
+fn current_user_sid() -> Result<Vec<u32>, String> {
+    unsafe {
+        let mut token: HANDLE = std::ptr::null_mut();
+        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
+            return Err(os_error("open process token"));
+        }
+        let mut needed = 0u32;
+        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
+        let mut buffer = vec![0u64; (needed as usize).div_ceil(8).max(1)];
+        let ok = GetTokenInformation(
+            token,
+            TokenUser,
+            buffer.as_mut_ptr().cast(),
+            needed,
+            &mut needed,
+        );
+        let error = os_error("read token user");
+        CloseHandle(token);
+        if ok == 0 {
+            return Err(error);
+        }
+        let sid = (*(buffer.as_ptr() as *const TOKEN_USER)).User.Sid;
+        if sid.is_null() || IsValidSid(sid) == 0 {
+            return Err("token user SID is invalid".into());
+        }
+        let length = GetLengthSid(sid) as usize;
+        let mut owned = vec![0u32; length.div_ceil(4)];
+        std::ptr::copy_nonoverlapping(sid as *const u8, owned.as_mut_ptr().cast::<u8>(), length);
+        Ok(owned)
+    }
+}
+
+/// Replace the DACL on `file` with one protected ACE granting the current
+/// user full access, then verify the result. The handle must carry
+/// `WRITE_DAC | READ_CONTROL`.
+pub(super) fn restrict_to_current_user(file: &File) -> Result<(), String> {
+    let mut sid = current_user_sid()?;
+    let psid = sid.as_mut_ptr().cast::<core::ffi::c_void>();
+    unsafe {
+        let size = std::mem::size_of::<ACL>() + std::mem::size_of::<ACCESS_ALLOWED_ACE>()
+            - std::mem::size_of::<u32>()
+            + GetLengthSid(psid) as usize;
+        let mut acl_buffer = vec![0u32; size.div_ceil(4)];
+        let acl = acl_buffer.as_mut_ptr().cast::<ACL>();
+        if InitializeAcl(acl, (acl_buffer.len() * 4) as u32, ACL_REVISION) == 0 {
+            return Err(os_error("initialize scoped descriptor ACL"));
+        }
+        if AddAccessAllowedAce(acl, ACL_REVISION, FILE_ALL_ACCESS, psid) == 0 {
+            return Err(os_error("add owner ACE"));
+        }
+        let mut descriptor: SECURITY_DESCRIPTOR = std::mem::zeroed();
+        let pdescriptor: PSECURITY_DESCRIPTOR =
+            (&mut descriptor as *mut SECURITY_DESCRIPTOR).cast();
+        // Both the control bit and PROTECTED_DACL_SECURITY_INFORMATION: measured
+        // here, SetKernelObjectSecurity drops the flag without the bit.
+        if InitializeSecurityDescriptor(pdescriptor, SECURITY_DESCRIPTOR_REVISION) == 0
+            || SetSecurityDescriptorDacl(pdescriptor, TRUE, acl, FALSE) == 0
+            || SetSecurityDescriptorControl(pdescriptor, SE_DACL_PROTECTED, SE_DACL_PROTECTED) == 0
+        {
+            return Err(os_error("build scoped descriptor security"));
+        }
+        if SetKernelObjectSecurity(
+            file.as_raw_handle() as HANDLE,
+            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
+            pdescriptor,
+        ) == 0
+        {
+            return Err(os_error("restrict scoped descriptor ACL"));
+        }
+    }
+    verify_owner_only(file)
+}
+
+/// Fail closed unless the DACL on `file` is protected, non-null, carries no
+/// inherited ACE, and allows nobody but the current user. Deny ACEs only
+/// narrow access and are accepted; any other ACE type is refused.
+pub(super) fn verify_owner_only(file: &File) -> Result<(), String> {
+    let mut sid = current_user_sid()?;
+    let psid = sid.as_mut_ptr().cast::<core::ffi::c_void>();
+    let handle = file.as_raw_handle() as HANDLE;
+    unsafe {
+        let mut needed = 0u32;
+        GetKernelObjectSecurity(
+            handle,
+            DACL_SECURITY_INFORMATION,
+            std::ptr::null_mut(),
+            0,
+            &mut needed,
+        );
+        if needed == 0 {
+            return Err(os_error("read scoped descriptor ACL size"));
+        }
+        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
+        let descriptor: PSECURITY_DESCRIPTOR = buffer.as_mut_ptr().cast();
+        if GetKernelObjectSecurity(
+            handle,
+            DACL_SECURITY_INFORMATION,
+            descriptor,
+            needed,
+            &mut needed,
+        ) == 0
+        {
+            return Err(os_error("read scoped descriptor ACL"));
+        }
+        let mut control = 0u16;
+        let mut revision = 0u32;
+        if GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) == 0 {
+            return Err(os_error("read scoped descriptor control"));
+        }
+        if control & SE_DACL_PROTECTED == 0 {
+            return Err("scoped descriptor ACL still inherits from its directory".into());
+        }
+        let mut present = FALSE;
+        let mut defaulted = FALSE;
+        let mut acl: *mut ACL = std::ptr::null_mut();
+        if GetSecurityDescriptorDacl(descriptor, &mut present, &mut acl, &mut defaulted) == 0 {
+            return Err(os_error("read scoped descriptor DACL"));
+        }
+        if present == FALSE || acl.is_null() {
+            return Err("scoped descriptor has no DACL and is open to everyone".into());
+        }
+        let mut size: ACL_SIZE_INFORMATION = std::mem::zeroed();
+        if GetAclInformation(
+            acl,
+            (&mut size as *mut ACL_SIZE_INFORMATION).cast(),
+            std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
+            AclSizeInformation,
+        ) == 0
+        {
+            return Err(os_error("read scoped descriptor ACL entries"));
+        }
+        let mut owner_allowed = false;
+        for index in 0..size.AceCount {
+            let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
+            if GetAce(acl, index, &mut ace) == 0 || ace.is_null() {
+                return Err(os_error("read scoped descriptor ACE"));
+            }
+            let header = *(ace as *const ACE_HEADER);
+            if u32::from(header.AceFlags) & INHERITED_ACE != 0 {
+                return Err("scoped descriptor ACL carries an inherited entry".into());
+            }
+            match header.AceType {
+                ACCESS_DENIED_ACE_TYPE => {}
+                ACCESS_ALLOWED_ACE_TYPE => {
+                    let ace_sid =
+                        std::ptr::addr_of!((*(ace as *const ACCESS_ALLOWED_ACE)).SidStart);
+                    if EqualSid(ace_sid as *mut _, psid) == 0 {
+                        return Err(
+                            "scoped descriptor ACL grants access beyond the current user".into(),
+                        );
+                    }
+                    owner_allowed = true;
+                }
+                other => {
+                    return Err(format!(
+                        "scoped descriptor ACL carries an unsupported entry type {other}"
+                    ))
+                }
+            }
+        }
+        if !owner_allowed {
+            return Err("scoped descriptor ACL does not grant the current user".into());
+        }
+    }
+    Ok(())
+}
+
+#[cfg(test)]
+mod tests {
+    use super::*;
+    use std::os::windows::fs::OpenOptionsExt;
+    use windows_sys::Win32::Foundation::GENERIC_WRITE;
+    use windows_sys::Win32::Security::{CreateWellKnownSid, WinWorldSid, SECURITY_MAX_SID_SIZE};
+    use windows_sys::Win32::Storage::FileSystem::{FILE_GENERIC_READ, READ_CONTROL, WRITE_DAC};
+
+    fn open(path: &std::path::Path) -> File {
+        std::fs::OpenOptions::new()
+            .write(true)
+            .create_new(true)
+            .access_mode(GENERIC_WRITE | WRITE_DAC | READ_CONTROL)
+            .share_mode(0)
+            .open(path)
+            .unwrap()
+    }
+
+    /// Apply a protected DACL: the current user plus `Everyone` read.
+    fn widen_to_everyone(file: &File) {
+        let mut user = current_user_sid().unwrap();
+        let mut world = vec![0u32; (SECURITY_MAX_SID_SIZE as usize).div_ceil(4)];
+        let mut world_size = SECURITY_MAX_SID_SIZE;
+        unsafe {
+            assert_ne!(
+                CreateWellKnownSid(
+                    WinWorldSid,
+                    std::ptr::null_mut(),
+                    world.as_mut_ptr().cast(),
+                    &mut world_size
+                ),
+                0
+            );
+            let mut acl_buffer = vec![0u32; 64];
+            let acl = acl_buffer.as_mut_ptr().cast::<ACL>();
+            assert_ne!(InitializeAcl(acl, 256, ACL_REVISION), 0);
+            assert_ne!(
+                AddAccessAllowedAce(acl, ACL_REVISION, FILE_ALL_ACCESS, user.as_mut_ptr().cast()),
+                0
+            );
+            assert_ne!(
+                AddAccessAllowedAce(
+                    acl,
+                    ACL_REVISION,
+                    FILE_GENERIC_READ,
+                    world.as_mut_ptr().cast()
+                ),
+                0
+            );
+            let mut descriptor: SECURITY_DESCRIPTOR = std::mem::zeroed();
+            let pdescriptor: PSECURITY_DESCRIPTOR =
+                (&mut descriptor as *mut SECURITY_DESCRIPTOR).cast();
+            assert_ne!(
+                InitializeSecurityDescriptor(pdescriptor, SECURITY_DESCRIPTOR_REVISION),
+                0
+            );
+            assert_ne!(SetSecurityDescriptorDacl(pdescriptor, TRUE, acl, FALSE), 0);
+            // SetKernelObjectSecurity ignores PROTECTED_DACL_SECURITY_INFORMATION
+            // on its own; the control bit on the descriptor is what sticks.
+            assert_ne!(
+                SetSecurityDescriptorControl(pdescriptor, SE_DACL_PROTECTED, SE_DACL_PROTECTED),
+                0
+            );
+            assert_ne!(
+                SetKernelObjectSecurity(
+                    file.as_raw_handle() as HANDLE,
+                    DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
+                    pdescriptor,
+                ),
+                0
+            );
+        }
+    }
+
+    #[test]
+    fn an_inherited_acl_is_refused() {
+        let dir = crate::testutil::TempDir::new("api-w207-inherited");
+        let file = open(&dir.path().join("inherited.json"));
+        let error = verify_owner_only(&file).unwrap_err();
+        assert!(error.contains("inherits"), "{error}");
+    }
+
+    #[test]
+    fn a_protected_acl_that_also_grants_everyone_is_refused() {
+        let dir = crate::testutil::TempDir::new("api-w207-everyone");
+        let file = open(&dir.path().join("wide.json"));
+        widen_to_everyone(&file);
+        let error = verify_owner_only(&file).unwrap_err();
+        assert!(error.contains("beyond the current user"), "{error}");
+    }
+
+    #[test]
+    fn restricting_narrows_an_inherited_acl_to_the_owner() {
+        let dir = crate::testutil::TempDir::new("api-w207-restrict");
+        let file = open(&dir.path().join("narrow.json"));
+        restrict_to_current_user(&file).unwrap();
+        verify_owner_only(&file).unwrap();
+    }
+}
diff --git a/src-tauri/src/api/credential_acl_tests.rs b/src-tauri/src/api/credential_acl_tests.rs
new file mode 100644
index 0000000..e804145
--- /dev/null
+++ b/src-tauri/src/api/credential_acl_tests.rs
@@ -0,0 +1,163 @@
+//! W2-07: the Windows DACL of a scoped run descriptor, read back by an oracle
+//! that shares no code with the production writer. Windows only: on unix the
+//! 0o600 mode is asserted by `scoped_descriptor_files_are_unique_and_removed_on_revocation`.
+use std::os::windows::ffi::OsStrExt;
+use std::path::Path;
+
+use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
+use windows_sys::Win32::Security::{
+    AclSizeInformation, EqualSid, GetAce, GetAclInformation, GetFileSecurityW,
+    GetSecurityDescriptorControl, GetSecurityDescriptorDacl, GetTokenInformation, TokenUser,
+    ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION, DACL_SECURITY_INFORMATION,
+    INHERITED_ACE, PSECURITY_DESCRIPTOR, SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
+};
+use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
+
+use crate::testutil::TempDir;
+
+const ALLOWED: u8 = 0;
+const DENIED: u8 = 1;
+
+/// What the oracle saw in a file's DACL.
+#[derive(Debug)]
+struct Dacl {
+    protected: bool,
+    /// (ace type, ace flags, SID equals the current user)
+    aces: Vec<(u8, u8, bool)>,
+}
+
+fn current_user_sid() -> Vec<u8> {
+    unsafe {
+        let mut token: HANDLE = std::ptr::null_mut();
+        assert_ne!(
+            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token),
+            0
+        );
+        let mut needed = 0u32;
+        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
+        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
+        let ok = GetTokenInformation(
+            token,
+            TokenUser,
+            buffer.as_mut_ptr().cast(),
+            needed,
+            &mut needed,
+        );
+        CloseHandle(token);
+        assert_ne!(ok, 0, "{}", std::io::Error::last_os_error());
+        let user = &*(buffer.as_ptr() as *const TOKEN_USER);
+        let length = windows_sys::Win32::Security::GetLengthSid(user.User.Sid) as usize;
+        std::slice::from_raw_parts(user.User.Sid as *const u8, length).to_vec()
+    }
+}
+
+fn read_dacl(path: &Path) -> Dacl {
+    let wide: Vec<u16> = path
+        .as_os_str()
+        .encode_wide()
+        .chain(std::iter::once(0))
+        .collect();
+    let mut user = current_user_sid();
+    unsafe {
+        let mut needed = 0u32;
+        GetFileSecurityW(
+            wide.as_ptr(),
+            DACL_SECURITY_INFORMATION,
+            std::ptr::null_mut(),
+            0,
+            &mut needed,
+        );
+        assert!(needed > 0, "{}", std::io::Error::last_os_error());
+        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
+        let descriptor: PSECURITY_DESCRIPTOR = buffer.as_mut_ptr().cast();
+        assert_ne!(
+            GetFileSecurityW(
+                wide.as_ptr(),
+                DACL_SECURITY_INFORMATION,
+                descriptor,
+                needed,
+                &mut needed
+            ),
+            0,
+            "{}",
+            std::io::Error::last_os_error()
+        );
+        let mut control = 0u16;
+        let mut revision = 0u32;
+        assert_ne!(
+            GetSecurityDescriptorControl(descriptor, &mut control, &mut revision),
+            0
+        );
+        let mut present = 0;
+        let mut defaulted = 0;
+        let mut acl: *mut ACL = std::ptr::null_mut();
+        assert_ne!(
+            GetSecurityDescriptorDacl(descriptor, &mut present, &mut acl, &mut defaulted),
+            0
+        );
+        assert!(
+            present != 0 && !acl.is_null(),
+            "a NULL DACL grants everyone everything"
+        );
+        let mut size = ACL_SIZE_INFORMATION {
+            AceCount: 0,
+            AclBytesInUse: 0,
+            AclBytesFree: 0,
+        };
+        assert_ne!(
+            GetAclInformation(
+                acl,
+                (&mut size as *mut ACL_SIZE_INFORMATION).cast(),
+                std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
+                AclSizeInformation,
+            ),
+            0
+        );
+        let mut aces = Vec::new();
+        for index in 0..size.AceCount {
+            let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
+            assert_ne!(GetAce(acl, index, &mut ace), 0);
+            let header = &*(ace as *const ACE_HEADER);
+            let is_user = matches!(header.AceType, ALLOWED | DENIED) && {
+                let sid = std::ptr::addr_of!((*(ace as *const ACCESS_ALLOWED_ACE)).SidStart);
+                EqualSid(sid as *mut _, user.as_mut_ptr().cast()) != 0
+            };
+            aces.push((header.AceType, header.AceFlags, is_user));
+        }
+        Dacl {
+            protected: control & SE_DACL_PROTECTED != 0,
+            aces,
+        }
+    }
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
+    assert!(
+        dacl.protected,
+        "inheritance from the parent directory must be cut: {dacl:?}"
+    );
+    assert!(
+        dacl.aces
+            .iter()
+            .all(|&(kind, flags, is_user)| flags & INHERITED_ACE as u8 == 0
+                && (kind == DENIED || (kind == ALLOWED && is_user))),
+        "only the current user may be granted access: {dacl:?}"
+    );
+    assert!(
+        dacl.aces
+            .iter()
+            .any(|&(kind, _, is_user)| kind == ALLOWED && is_user),
+        "the agent runs as the current user and must still read it: {dacl:?}"
+    );
+    // The launcher still reads what it wrote.
+    let descriptor: crate::api::Descriptor =
+        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
+    assert_eq!(descriptor.port, server.port());
+}
```
