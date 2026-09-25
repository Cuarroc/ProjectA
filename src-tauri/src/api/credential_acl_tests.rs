//! W2-07: the Windows DACL of a scoped run descriptor, read back by an oracle
//! that shares no code with the production writer. Windows only: on unix the
//! 0o600 mode is asserted by `scoped_descriptor_files_are_unique_and_removed_on_revocation`.
#![cfg(windows)]
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::Security::{
    AclSizeInformation, EqualSid, GetAce, GetAclInformation, GetFileSecurityW,
    GetSecurityDescriptorControl, GetSecurityDescriptorDacl, GetTokenInformation, TokenUser,
    ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION, DACL_SECURITY_INFORMATION,
    INHERITED_ACE, PSECURITY_DESCRIPTOR, SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

use crate::testutil::TempDir;

const ALLOWED: u8 = 0;
const DENIED: u8 = 1;

/// What the oracle saw in a file's DACL.
#[derive(Debug)]
struct Dacl {
    protected: bool,
    /// (ace type, ace flags, SID equals the current user)
    aces: Vec<(u8, u8, bool)>,
}

/// DWORD-aligned, as a SID must be.
fn current_user_sid() -> Vec<u32> {
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        assert_ne!(
            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token),
            0
        );
        let mut needed = 0u32;
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        let ok = GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr().cast(),
            needed,
            &mut needed,
        );
        CloseHandle(token);
        assert_ne!(ok, 0, "{}", std::io::Error::last_os_error());
        let user = &*(buffer.as_ptr() as *const TOKEN_USER);
        let length = windows_sys::Win32::Security::GetLengthSid(user.User.Sid) as usize;
        let mut owned = vec![0u32; length.div_ceil(4)];
        std::ptr::copy_nonoverlapping(
            user.User.Sid as *const u8,
            owned.as_mut_ptr().cast::<u8>(),
            length,
        );
        owned
    }
}

fn read_dacl(path: &Path) -> Dacl {
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut user = current_user_sid();
    unsafe {
        let mut needed = 0u32;
        GetFileSecurityW(
            wide.as_ptr(),
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            0,
            &mut needed,
        );
        assert!(needed > 0, "{}", std::io::Error::last_os_error());
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        let descriptor: PSECURITY_DESCRIPTOR = buffer.as_mut_ptr().cast();
        assert_ne!(
            GetFileSecurityW(
                wide.as_ptr(),
                DACL_SECURITY_INFORMATION,
                descriptor,
                needed,
                &mut needed
            ),
            0,
            "{}",
            std::io::Error::last_os_error()
        );
        let mut control = 0u16;
        let mut revision = 0u32;
        assert_ne!(
            GetSecurityDescriptorControl(descriptor, &mut control, &mut revision),
            0
        );
        let mut present = 0;
        let mut defaulted = 0;
        let mut acl: *mut ACL = std::ptr::null_mut();
        assert_ne!(
            GetSecurityDescriptorDacl(descriptor, &mut present, &mut acl, &mut defaulted),
            0
        );
        assert!(
            present != 0 && !acl.is_null(),
            "a NULL DACL grants everyone everything"
        );
        let mut size = ACL_SIZE_INFORMATION {
            AceCount: 0,
            AclBytesInUse: 0,
            AclBytesFree: 0,
        };
        assert_ne!(
            GetAclInformation(
                acl,
                (&mut size as *mut ACL_SIZE_INFORMATION).cast(),
                std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
                AclSizeInformation,
            ),
            0
        );
        let mut aces = Vec::new();
        for index in 0..size.AceCount {
            let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
            assert_ne!(GetAce(acl, index, &mut ace), 0);
            let header = &*(ace as *const ACE_HEADER);
            let is_user = matches!(header.AceType, ALLOWED | DENIED) && {
                let sid = std::ptr::addr_of!((*(ace as *const ACCESS_ALLOWED_ACE)).SidStart);
                EqualSid(sid as *mut _, user.as_mut_ptr().cast()) != 0
            };
            aces.push((header.AceType, header.AceFlags, is_user));
        }
        Dacl {
            protected: control & SE_DACL_PROTECTED != 0,
            aces,
        }
    }
}

#[test]
fn scoped_descriptor_file_grants_only_the_current_user() {
    let dir = TempDir::new("api-w207-acl");
    let server = crate::api::tests::native_server(dir.path(), "run-acl", "owner", 1);
    let path = server
        .issue_run_descriptor_file("run-acl", "owner", 1, 60)
        .unwrap();
    let dacl = read_dacl(&path);
    assert!(
        dacl.protected,
        "inheritance from the parent directory must be cut: {dacl:?}"
    );
    assert!(
        dacl.aces
            .iter()
            .all(|&(kind, flags, is_user)| flags & INHERITED_ACE as u8 == 0
                && (kind == DENIED || (kind == ALLOWED && is_user))),
        "only the current user may be granted access: {dacl:?}"
    );
    assert!(
        dacl.aces
            .iter()
            .any(|&(kind, _, is_user)| kind == ALLOWED && is_user),
        "the agent runs as the current user and must still read it: {dacl:?}"
    );
    // The launcher still reads what it wrote.
    let descriptor: crate::api::Descriptor =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(descriptor.port, server.port());
}

/// A failed restriction refuses the launch and leaves neither the file nor
/// the grant behind (the handle is closed before the cleanup deletes it).
#[test]
fn a_failed_restriction_leaves_no_descriptor_and_no_grant() {
    let dir = TempDir::new("api-w207-acl-fail");
    let server = crate::api::tests::native_server(dir.path(), "run-acl", "owner", 1);
    crate::api::credential_acl::FAIL_NEXT_RESTRICT.with(|fail| fail.set(true));
    let error = server
        .issue_run_descriptor_file("run-acl", "owner", 1, 60)
        .unwrap_err();
    assert!(error.contains("injected"), "{error}");
    let left: Vec<_> = std::fs::read_dir(dir.path().join("agent-access"))
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .collect();
    assert!(left.is_empty(), "{left:?}");
    // No grant for the run survived: there is nothing to bind a session to.
    assert!(server
        .run_credential_issuer()
        .bind_session("run-acl", "session")
        .is_err());
}
