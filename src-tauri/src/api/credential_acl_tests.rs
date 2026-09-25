//! W2-07: the Windows DACL of a scoped run descriptor, read back by an oracle
//! that shares no code with the production writer. Windows only: on unix the
//! 0o600 mode is asserted by `scoped_descriptor_files_are_unique_and_removed_on_revocation`.
#![cfg(windows)]
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::Security::{
    AclSizeInformation, CreateWellKnownSid, EqualSid, GetAce, GetAclInformation, GetFileSecurityW,
    GetLengthSid, GetSecurityDescriptorControl, GetSecurityDescriptorDacl,
    GetSecurityDescriptorOwner, GetTokenInformation, TokenOwner, TokenUser,
    WinBuiltinAdministratorsSid, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION,
    CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, INHERITED_ACE, OBJECT_INHERIT_ACE,
    OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, SECURITY_MAX_SID_SIZE, SE_DACL_PROTECTED,
    TOKEN_INFORMATION_CLASS, TOKEN_OWNER, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

use crate::testutil::TempDir;

const ALLOWED: u8 = 0;
const DENIED: u8 = 1;

/// What the oracle saw in a file's security descriptor.
#[derive(Debug)]
struct Dacl {
    protected: bool,
    /// (ace type, ace flags, SID equals the current user)
    aces: Vec<(u8, u8, bool)>,
    /// The owner SID is one of the identities this process may legitimately
    /// own files as (token user, token default owner, Administrators).
    owner_accepted: bool,
}

/// DWORD-aligned, as a SID must be: `TokenUser` or `TokenOwner` of this
/// process's token.
fn token_sid(class: TOKEN_INFORMATION_CLASS) -> Vec<u32> {
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        assert_ne!(
            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token),
            0
        );
        let mut needed = 0u32;
        GetTokenInformation(token, class, std::ptr::null_mut(), 0, &mut needed);
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        let ok = GetTokenInformation(
            token,
            class,
            buffer.as_mut_ptr().cast(),
            needed,
            &mut needed,
        );
        CloseHandle(token);
        assert_ne!(ok, 0, "{}", std::io::Error::last_os_error());
        let sid = if class == TokenOwner {
            (*(buffer.as_ptr() as *const TOKEN_OWNER)).Owner
        } else {
            (*(buffer.as_ptr() as *const TOKEN_USER)).User.Sid
        };
        let length = GetLengthSid(sid) as usize;
        let mut owned = vec![0u32; length.div_ceil(4)];
        std::ptr::copy_nonoverlapping(sid as *const u8, owned.as_mut_ptr().cast::<u8>(), length);
        owned
    }
}

/// The well-known SID of BUILTIN\Administrators: every object an elevated run
/// creates is owned by this group, and no non-admin can assign it.
fn administrators_sid() -> Vec<u32> {
    unsafe {
        let mut buffer = vec![0u32; (SECURITY_MAX_SID_SIZE as usize).div_ceil(4)];
        let mut size = SECURITY_MAX_SID_SIZE;
        assert_ne!(
            CreateWellKnownSid(
                WinBuiltinAdministratorsSid,
                std::ptr::null_mut(),
                buffer.as_mut_ptr().cast(),
                &mut size
            ),
            0
        );
        buffer
    }
}

/// The owner identities the production check accepts: the token user, the
/// token's default owner and the Administrators group. The oracle must mirror that set exactly, or an
/// elevated run would fail the oracle while production behaves as designed.
fn accepted_owner_sids() -> Vec<Vec<u32>> {
    vec![
        token_sid(TokenUser),
        token_sid(TokenOwner),
        administrators_sid(),
    ]
}

fn read_dacl(path: &Path) -> Dacl {
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut user = token_sid(TokenUser);
    let mut owners: Vec<Vec<u32>> = accepted_owner_sids();
    unsafe {
        let mut needed = 0u32;
        GetFileSecurityW(
            wide.as_ptr(),
            DACL_SECURITY_INFORMATION | OWNER_SECURITY_INFORMATION,
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
                DACL_SECURITY_INFORMATION | OWNER_SECURITY_INFORMATION,
                descriptor,
                needed,
                &mut needed
            ),
            0,
            "{}",
            std::io::Error::last_os_error()
        );
        let mut owner: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut owner_defaulted = 0;
        assert_ne!(
            GetSecurityDescriptorOwner(descriptor, &mut owner, &mut owner_defaulted),
            0
        );
        assert!(!owner.is_null(), "a descriptor without an owner is foreign");
        let owner_accepted = owners
            .iter_mut()
            .any(|accepted| EqualSid(owner, accepted.as_mut_ptr().cast()) != 0);
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
            owner_accepted,
        }
    }
}

/// W2-07/W2-07b shape: protected against inheritance, every ACE decided here
/// grants only the current user, and the file belongs to one of the owner
/// identities of this process (user, token default owner, Administrators).
fn assert_owner_only(dacl: &Dacl) {
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
    assert!(
        dacl.owner_accepted,
        "the file must belong to an owner identity of this process \
         (token user, token default owner, or Administrators): {dacl:?}"
    );
}

#[test]
fn scoped_descriptor_file_grants_only_the_current_user() {
    let dir = TempDir::new("api-w207-acl");
    let server = crate::api::tests::native_server(dir.path(), "run-acl", "owner", 1);
    let path = server
        .issue_run_descriptor_file("run-acl", "owner", 1, 60)
        .unwrap();
    let dacl = read_dacl(&path);
    assert_owner_only(&dacl);
    // The launcher still reads what it wrote.
    let descriptor: crate::api::Descriptor =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(descriptor.port, server.port());
}

/// W2-07b: the broad descriptor holds the same key to the app as a scoped one
/// and must be narrowed the same way.
#[test]
fn broad_descriptor_grants_only_the_current_user() {
    let dir = TempDir::new("api-w207b-broad");
    let server = crate::api::tests::native_server(dir.path(), "run-acl", "owner", 1);
    let dacl = read_dacl(server.descriptor_path());
    assert_owner_only(&dacl);
    // The CLI still reads what the app wrote.
    let descriptor: crate::api::Descriptor =
        serde_json::from_slice(&std::fs::read(server.descriptor_path()).unwrap()).unwrap();
    assert_eq!(descriptor.port, server.port());
}

/// W2-07b: the directory itself decides who may list it, plant files in it,
/// or delete from it - a narrow DACL on the files alone leaves all three open.
#[test]
fn agent_access_directory_grants_only_the_current_user() {
    let dir = TempDir::new("api-w207b-dir");
    let server = crate::api::tests::native_server(dir.path(), "run-acl", "owner", 1);
    server
        .issue_run_descriptor_file("run-acl", "owner", 1, 60)
        .unwrap();
    let dacl = read_dacl(&dir.path().join("agent-access"));
    assert_owner_only(&dacl);
    // the user ACE on the
    // directory must be inheritable, or files created inside would re-inherit
    // SYSTEM/Administrators from the creator's default DACL.
    assert!(
        dacl.aces
            .iter()
            .any(|&(kind, flags, is_user)| kind == ALLOWED
                && is_user
                && u32::from(flags) & (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE)
                    == (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE)),
        "the user ACE on the directory must be inheritable: {dacl:?}"
    );
}

/// A broad descriptor left behind with a
/// wide, inherited ACL is narrowed on the next boot (self-healing pin).
#[test]
fn an_existing_wide_open_descriptor_is_narrowed_on_boot() {
    let dir = TempDir::new("api-w207b-heal");
    std::fs::write(
        dir.path().join(crate::api::DESCRIPTOR_FILE),
        b"{\"port\":1,\"token\":\"old\"}",
    )
    .unwrap();
    let server = crate::api::tests::native_server(dir.path(), "run-acl", "owner", 1);
    let dacl = read_dacl(server.descriptor_path());
    assert_owner_only(&dacl);
}

/// A file created inside the narrowed directory
/// inherits exactly the user grant - nothing from the creator's default DACL
/// (which would re-add SYSTEM and Administrators).
#[test]
fn a_child_inherits_only_the_user_grant_from_the_narrowed_directory() {
    let dir = TempDir::new("api-w207b-inherit");
    let inner = dir.path().join("agent-access");
    std::fs::create_dir(&inner).unwrap();
    crate::api::credential_acl::restrict_directory_to_current_user(&inner).unwrap();
    std::fs::write(inner.join("child.json"), b"x").unwrap();
    let dacl = read_dacl(&inner.join("child.json"));
    // The kernel does not flag the inherited ACE INHERITED_ACE (that needs the
    // auto-inherit APIs), so the pin is the ACE list itself: one allow ACE for
    // the user, nothing from the creator's default DACL.
    assert!(
        matches!(dacl.aces.as_slice(), [(ALLOWED, _, true)]),
        "only the inherited user grant is expected: {dacl:?}"
    );
}

/// A failing directory restriction aborts the
/// issuance and leaves neither a file nor a grant behind (issuer-level proof
/// for the split injection seam).
#[test]
fn a_failed_directory_restriction_aborts_the_issuance() {
    let dir = TempDir::new("api-w207b-dirfail-issue");
    let server = crate::api::tests::native_server(dir.path(), "run-acl", "owner", 1);
    crate::api::credential_acl::FAIL_NEXT_DIRECTORY_RESTRICT.with(|fail| fail.set(true));
    let error = server
        .issue_run_descriptor_file("run-acl", "owner", 1, 60)
        .unwrap_err();
    assert!(error.contains("injected credential directory"), "{error}");
    let left: Vec<_> = std::fs::read_dir(dir.path().join("agent-access"))
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .collect();
    assert!(left.is_empty(), "{left:?}");
    assert!(server
        .run_credential_issuer()
        .bind_session("run-acl", "session")
        .is_err());
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
