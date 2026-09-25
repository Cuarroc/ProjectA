//! W2-07: a scoped run descriptor on Windows is readable by the current user
//! and nobody else.
//!
//! The unix writer creates the file with mode 0o600. Windows has no mode: a
//! new file inherits the ACL of `agent-access/`, which under a profile grants
//! SYSTEM, Administrators and whatever else the parent carries - and under an
//! overridden data directory possibly `Users` or `Everyone`. So the writer
//! replaces the DACL with a protected one holding a single ACE for the token
//! user, reads it back through the same handle and refuses to write the token
//! unless the read-back is exactly that narrow (fail closed).
//!
//! The handle is opened with share mode 0, so between `CreateFileW` and the
//! new DACL no other process can open the still-empty file and keep a handle
//! whose access was checked against the inherited ACL.
#![cfg(windows)]
use std::fs::File;
use std::os::windows::io::AsRawHandle;

use windows_sys::Win32::Foundation::{CloseHandle, FALSE, HANDLE, TRUE};
use windows_sys::Win32::Security::{
    AclSizeInformation, AddAccessAllowedAce, EqualSid, GetAce, GetAclInformation,
    GetKernelObjectSecurity, GetLengthSid, GetSecurityDescriptorControl, GetSecurityDescriptorDacl,
    GetTokenInformation, InitializeAcl, InitializeSecurityDescriptor, IsValidSid,
    SetKernelObjectSecurity, SetSecurityDescriptorControl, SetSecurityDescriptorDacl, TokenUser,
    ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_REVISION, ACL_SIZE_INFORMATION,
    DACL_SECURITY_INFORMATION, INHERITED_ACE, PROTECTED_DACL_SECURITY_INFORMATION,
    PSECURITY_DESCRIPTOR, SECURITY_DESCRIPTOR, SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::Storage::FileSystem::{FILE_ALL_ACCESS, FILE_GENERIC_READ};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

#[cfg(test)]
thread_local! {
    /// Test seam: make the next `restrict_to_current_user` on this thread
    /// fail after the DACL was applied, to prove the issuer's cleanup path.
    pub(super) static FAIL_NEXT_RESTRICT: std::cell::Cell<bool> =
        const { std::cell::Cell::new(false) };
}

/// `Win32::System::SystemServices` values; that feature is not enabled.
const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
const ACCESS_DENIED_ACE_TYPE: u8 = 1;
const SECURITY_DESCRIPTOR_REVISION: u32 = 1;

fn os_error(what: &str) -> String {
    format!("{what}: {}", std::io::Error::last_os_error())
}

/// The SID of the user this process runs as, in a DWORD-aligned buffer.
fn current_user_sid() -> Result<Vec<u32>, String> {
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(os_error("open process token"));
        }
        let mut needed = 0u32;
        // The sizing call "fails" with ERROR_INSUFFICIENT_BUFFER by design;
        // only a missing size is an error.
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
        if needed == 0 {
            let error = os_error("size token user");
            CloseHandle(token);
            return Err(error);
        }
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        let ok = GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr().cast(),
            needed,
            &mut needed,
        );
        let error = os_error("read token user");
        CloseHandle(token);
        if ok == 0 {
            return Err(error);
        }
        let sid = (*(buffer.as_ptr() as *const TOKEN_USER)).User.Sid;
        if sid.is_null() || IsValidSid(sid) == 0 {
            return Err("token user SID is invalid".into());
        }
        let length = GetLengthSid(sid) as usize;
        let mut owned = vec![0u32; length.div_ceil(4)];
        std::ptr::copy_nonoverlapping(sid as *const u8, owned.as_mut_ptr().cast::<u8>(), length);
        Ok(owned)
    }
}

/// Replace the DACL on `file` with one protected ACE granting the current
/// user full access, then verify the result. The handle must carry
/// `WRITE_DAC | READ_CONTROL`.
pub(super) fn restrict_to_current_user(file: &File) -> Result<(), String> {
    let mut sid = current_user_sid()?;
    let psid = sid.as_mut_ptr().cast::<core::ffi::c_void>();
    unsafe {
        let size = std::mem::size_of::<ACL>() + std::mem::size_of::<ACCESS_ALLOWED_ACE>()
            - std::mem::size_of::<u32>()
            + GetLengthSid(psid) as usize;
        let mut acl_buffer = vec![0u32; size.div_ceil(4)];
        let acl = acl_buffer.as_mut_ptr().cast::<ACL>();
        if InitializeAcl(acl, (acl_buffer.len() * 4) as u32, ACL_REVISION) == 0 {
            return Err(os_error("initialize scoped descriptor ACL"));
        }
        if AddAccessAllowedAce(acl, ACL_REVISION, FILE_ALL_ACCESS, psid) == 0 {
            return Err(os_error("add owner ACE"));
        }
        let mut descriptor: SECURITY_DESCRIPTOR = std::mem::zeroed();
        let pdescriptor: PSECURITY_DESCRIPTOR =
            (&mut descriptor as *mut SECURITY_DESCRIPTOR).cast();
        // Both the control bit and PROTECTED_DACL_SECURITY_INFORMATION: measured
        // here, SetKernelObjectSecurity drops the flag without the bit.
        if InitializeSecurityDescriptor(pdescriptor, SECURITY_DESCRIPTOR_REVISION) == 0
            || SetSecurityDescriptorDacl(pdescriptor, TRUE, acl, FALSE) == 0
            || SetSecurityDescriptorControl(pdescriptor, SE_DACL_PROTECTED, SE_DACL_PROTECTED) == 0
        {
            return Err(os_error("build scoped descriptor security"));
        }
        if SetKernelObjectSecurity(
            file.as_raw_handle() as HANDLE,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            pdescriptor,
        ) == 0
        {
            return Err(os_error("restrict scoped descriptor ACL"));
        }
    }
    #[cfg(test)]
    if FAIL_NEXT_RESTRICT.with(|fail| fail.replace(false)) {
        return Err("injected scoped descriptor ACL failure".into());
    }
    verify_owner_only(file)
}

/// Fail closed unless the DACL on `file` is protected, non-null, carries no
/// inherited ACE, and consists of at least one allow ACE, each for the
/// current user and each granting read. Any deny or other ACE type is refused.
pub(super) fn verify_owner_only(file: &File) -> Result<(), String> {
    let mut sid = current_user_sid()?;
    let psid = sid.as_mut_ptr().cast::<core::ffi::c_void>();
    let handle = file.as_raw_handle() as HANDLE;
    unsafe {
        let mut needed = 0u32;
        GetKernelObjectSecurity(
            handle,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            0,
            &mut needed,
        );
        if needed == 0 {
            return Err(os_error("read scoped descriptor ACL size"));
        }
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        let descriptor: PSECURITY_DESCRIPTOR = buffer.as_mut_ptr().cast();
        if GetKernelObjectSecurity(
            handle,
            DACL_SECURITY_INFORMATION,
            descriptor,
            needed,
            &mut needed,
        ) == 0
        {
            return Err(os_error("read scoped descriptor ACL"));
        }
        let mut control = 0u16;
        let mut revision = 0u32;
        if GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) == 0 {
            return Err(os_error("read scoped descriptor control"));
        }
        if control & SE_DACL_PROTECTED == 0 {
            return Err("scoped descriptor ACL still inherits from its directory".into());
        }
        let mut present = FALSE;
        let mut defaulted = FALSE;
        let mut acl: *mut ACL = std::ptr::null_mut();
        if GetSecurityDescriptorDacl(descriptor, &mut present, &mut acl, &mut defaulted) == 0 {
            return Err(os_error("read scoped descriptor DACL"));
        }
        if present == FALSE || acl.is_null() {
            return Err("scoped descriptor has no DACL and is open to everyone".into());
        }
        let mut size: ACL_SIZE_INFORMATION = std::mem::zeroed();
        if GetAclInformation(
            acl,
            (&mut size as *mut ACL_SIZE_INFORMATION).cast(),
            std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
            AclSizeInformation,
        ) == 0
        {
            return Err(os_error("read scoped descriptor ACL entries"));
        }
        let mut owner_allowed = false;
        for index in 0..size.AceCount {
            let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
            if GetAce(acl, index, &mut ace) == 0 || ace.is_null() {
                return Err(os_error("read scoped descriptor ACE"));
            }
            let header = *(ace as *const ACE_HEADER);
            if u32::from(header.AceFlags) & INHERITED_ACE != 0 {
                return Err("scoped descriptor ACL carries an inherited entry".into());
            }
            match header.AceType {
                // The writer never adds one. A deny cannot widen access, but
                // one for the user or a group it belongs to (Everyone, Users)
                // locks the agent out of its own credential, and group
                // membership is not decidable here: refuse them all.
                ACCESS_DENIED_ACE_TYPE => {
                    return Err("scoped descriptor ACL carries a deny entry".into());
                }
                ACCESS_ALLOWED_ACE_TYPE => {
                    let body = ace as *const ACCESS_ALLOWED_ACE;
                    let sid = std::ptr::addr_of!((*body).SidStart);
                    if EqualSid(sid as *mut _, psid) == 0 {
                        return Err(
                            "scoped descriptor ACL grants access beyond the current user".into(),
                        );
                    }
                    if (*body).Mask & FILE_GENERIC_READ != FILE_GENERIC_READ {
                        return Err("scoped descriptor ACL does not let the user read it".into());
                    }
                    owner_allowed = true;
                }
                other => {
                    return Err(format!(
                        "scoped descriptor ACL carries an unsupported entry type {other}"
                    ))
                }
            }
        }
        if !owner_allowed {
            return Err("scoped descriptor ACL does not grant the current user".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Foundation::GENERIC_WRITE;
    use windows_sys::Win32::Security::{
        AddAccessDeniedAce, CreateWellKnownSid, WinWorldSid, SECURITY_MAX_SID_SIZE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_GENERIC_WRITE, FILE_READ_DATA, READ_CONTROL, WRITE_DAC,
    };

    fn open(path: &std::path::Path) -> File {
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .access_mode(GENERIC_WRITE | WRITE_DAC | READ_CONTROL)
            .share_mode(0)
            .open(path)
            .unwrap()
    }

    enum Who {
        User,
        Everyone,
    }

    /// Apply a protected DACL built from `(allow, mask, who)` entries.
    fn apply(file: &File, entries: &[(bool, u32, Who)]) {
        let mut user = current_user_sid().unwrap();
        let mut world = vec![0u32; (SECURITY_MAX_SID_SIZE as usize).div_ceil(4)];
        let mut world_size = SECURITY_MAX_SID_SIZE;
        unsafe {
            assert_ne!(
                CreateWellKnownSid(
                    WinWorldSid,
                    std::ptr::null_mut(),
                    world.as_mut_ptr().cast(),
                    &mut world_size
                ),
                0
            );
            let mut acl_buffer = vec![0u32; 128];
            let acl = acl_buffer.as_mut_ptr().cast::<ACL>();
            assert_ne!(InitializeAcl(acl, 512, ACL_REVISION), 0);
            for (allow, mask, who) in entries {
                let sid = match who {
                    Who::User => user.as_mut_ptr().cast(),
                    Who::Everyone => world.as_mut_ptr().cast(),
                };
                let added = if *allow {
                    AddAccessAllowedAce(acl, ACL_REVISION, *mask, sid)
                } else {
                    AddAccessDeniedAce(acl, ACL_REVISION, *mask, sid)
                };
                assert_ne!(added, 0);
            }
            let mut descriptor: SECURITY_DESCRIPTOR = std::mem::zeroed();
            let pdescriptor: PSECURITY_DESCRIPTOR =
                (&mut descriptor as *mut SECURITY_DESCRIPTOR).cast();
            assert_ne!(
                InitializeSecurityDescriptor(pdescriptor, SECURITY_DESCRIPTOR_REVISION),
                0
            );
            assert_ne!(SetSecurityDescriptorDacl(pdescriptor, TRUE, acl, FALSE), 0);
            // SetKernelObjectSecurity ignores PROTECTED_DACL_SECURITY_INFORMATION
            // on its own; the control bit on the descriptor is what sticks.
            assert_ne!(
                SetSecurityDescriptorControl(pdescriptor, SE_DACL_PROTECTED, SE_DACL_PROTECTED),
                0
            );
            assert_ne!(
                SetKernelObjectSecurity(
                    file.as_raw_handle() as HANDLE,
                    DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                    pdescriptor,
                ),
                0
            );
        }
    }

    fn refused(label: &str, entries: &[(bool, u32, Who)]) -> String {
        let dir = crate::testutil::TempDir::new(label);
        let file = open(&dir.path().join("probe.json"));
        apply(&file, entries);
        verify_owner_only(&file).unwrap_err()
    }

    #[test]
    fn an_inherited_acl_is_refused() {
        let dir = crate::testutil::TempDir::new("api-w207-inherited");
        let file = open(&dir.path().join("inherited.json"));
        let error = verify_owner_only(&file).unwrap_err();
        assert!(error.contains("inherits"), "{error}");
    }

    #[test]
    fn a_protected_acl_that_also_grants_everyone_is_refused() {
        let error = refused(
            "api-w207-everyone",
            &[
                (true, FILE_ALL_ACCESS, Who::User),
                (true, FILE_GENERIC_READ, Who::Everyone),
            ],
        );
        assert!(error.contains("beyond the current user"), "{error}");
    }

    #[test]
    fn a_user_entry_without_read_access_is_refused() {
        let error = refused(
            "api-w207-no-read",
            &[(true, FILE_GENERIC_WRITE | READ_CONTROL, Who::User)],
        );
        assert!(error.contains("does not let the user read"), "{error}");
    }

    #[test]
    fn any_deny_entry_is_refused() {
        // Even a deny for Everyone locks the user out: the user is a member.
        for (label, who) in [
            ("api-w207-deny-user", Who::User),
            ("api-w207-deny-all", Who::Everyone),
        ] {
            let error = refused(
                label,
                &[
                    (false, FILE_READ_DATA, who),
                    (true, FILE_ALL_ACCESS, Who::User),
                ],
            );
            assert!(error.contains("deny entry"), "{error}");
        }
    }

    #[test]
    fn restricting_narrows_an_inherited_acl_to_the_owner() {
        let dir = crate::testutil::TempDir::new("api-w207-restrict");
        let file = open(&dir.path().join("narrow.json"));
        restrict_to_current_user(&file).unwrap();
        verify_owner_only(&file).unwrap();
    }
}
