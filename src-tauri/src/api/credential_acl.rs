//! W2-07: a credential file on Windows is readable by the current user and
//! nobody else. W2-07b widens that from the scoped run descriptors to the
//! broad API descriptor and the `agent-access/` directory itself, and adds
//! the ownership check.
//!
//! The unix writers create their files with mode 0o600. Windows has no mode:
//! a new file inherits the ACL of its directory, which under a profile grants
//! SYSTEM, Administrators and whatever else the parent carries - and under an
//! overridden data directory possibly `Users` or `Everyone`. So the writers
//! replace the DACL with a protected one holding a single ACE for the token
//! user, read it back through the same handle and refuse to write the token
//! unless the read-back is exactly that narrow and the file belongs to one of
//! this process's owner identities (fail closed). A generous DACL on a file
//! owned by another account is refused the same way: somebody else planted it.
//!
//! The accepted owner identities are the token user, the token's default
//! owner, and the Administrators group: whatever SID a file this process
//! created can legitimately carry, elevated (Administrators) or not (the
//! user), in any order of runs. A foreign non-admin account can assign none
//! of them, so the threat model - other local users, who as owner hold
//! implicit WRITE_DAC - is unchanged. Note the trade-off: an
//! Administrators-owned file is readable by every elevated local admin, so
//! "user-only" then means "user plus local admins" - defensible, because an
//! admin can take ownership anyway. The owner is checked before the content
//! is truncated, so a refused object is left untouched instead of destroyed.
//!
//! The handle is opened with share mode 0 (with a bounded retry on sharing
//! violations: a scanner or a parallel issuance holds the object for
//! milliseconds, and failing the launch on the first conflict would trade
//! availability for nothing), so between `CreateFileW` and the new DACL no
//! other process can open the still-empty file and keep a handle whose access
//! was checked against the inherited ACL. Reparse points (symlinks,
//! junctions) and files reachable through a second hard link are refused:
//! `CreateFileW` would otherwise follow a planted link and truncate and
//! re-ACL the target.
//!
//! [`restrict_directory_to_current_user`] applies the same rule to the
//! `agent-access/` directory: the directory decides who may list it, plant
//! files in it or delete from it, so narrowing only the files leaves all
//! three open. Its ACE is marked inheritable so a file created inside starts
//! with the user-only grant instead of the creator's default DACL (which
//! would re-add SYSTEM and Administrators); the writer still replaces the
//! DACL of every file before the token touches the disk.
#![cfg(windows)]
use std::fs::File;
use std::os::windows::io::AsRawHandle;
use std::path::Path;

use windows_sys::Win32::Foundation::{CloseHandle, FALSE, HANDLE, TRUE};
use windows_sys::Win32::Security::{
    AclSizeInformation, AddAccessAllowedAce, CreateWellKnownSid, EqualSid, GetAce,
    GetAclInformation, GetKernelObjectSecurity, GetLengthSid, GetSecurityDescriptorControl,
    GetSecurityDescriptorDacl, GetSecurityDescriptorOwner, GetTokenInformation, InitializeAcl,
    InitializeSecurityDescriptor, IsValidSid, SetKernelObjectSecurity,
    SetSecurityDescriptorControl, SetSecurityDescriptorDacl, TokenOwner, TokenUser,
    WinBuiltinAdministratorsSid, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_REVISION,
    ACL_SIZE_INFORMATION, CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, INHERITED_ACE,
    OBJECT_INHERIT_ACE, OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
    PSECURITY_DESCRIPTOR, SECURITY_DESCRIPTOR, SECURITY_MAX_SID_SIZE, SE_DACL_PROTECTED,
    TOKEN_INFORMATION_CLASS, TOKEN_OWNER, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::Storage::FileSystem::{FILE_ALL_ACCESS, FILE_GENERIC_READ};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

#[cfg(test)]
thread_local! {
    /// Test seam: make the next `restrict_to_current_user` on this thread
    /// fail after the DACL was applied, to prove the issuer's cleanup path.
    /// The file and the directory have separate seams: the directory step
    /// runs first at issuance and must not consume the file's flag (review
    /// round, sonnet F6).
    pub(super) static FAIL_NEXT_RESTRICT: std::cell::Cell<bool> =
        const { std::cell::Cell::new(false) };
    /// Test seam: same injection for `restrict_directory_to_current_user`.
    pub(super) static FAIL_NEXT_DIRECTORY_RESTRICT: std::cell::Cell<bool> =
        const { std::cell::Cell::new(false) };
}

/// `Win32::System::SystemServices` values; that feature is not enabled.
const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
const ACCESS_DENIED_ACE_TYPE: u8 = 1;
const SECURITY_DESCRIPTOR_REVISION: u32 = 1;

fn os_error(what: &str) -> String {
    format!("{what}: {}", std::io::Error::last_os_error())
}

/// Read `class` (`TokenUser` or `TokenOwner`) of this process's token into a
/// DWORD-aligned buffer holding just the SID.
fn token_sid(class: TOKEN_INFORMATION_CLASS, label: &str) -> Result<Vec<u32>, String> {
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(os_error("open process token"));
        }
        let mut needed = 0u32;
        // The sizing call "fails" with ERROR_INSUFFICIENT_BUFFER by design;
        // only a missing size is an error.
        GetTokenInformation(token, class, std::ptr::null_mut(), 0, &mut needed);
        if needed == 0 {
            let error = os_error(label);
            CloseHandle(token);
            return Err(error);
        }
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        let ok = GetTokenInformation(
            token,
            class,
            buffer.as_mut_ptr().cast(),
            needed,
            &mut needed,
        );
        let error = os_error(label);
        CloseHandle(token);
        if ok == 0 {
            return Err(error);
        }
        let sid = if class == TokenOwner {
            (*(buffer.as_ptr() as *const TOKEN_OWNER)).Owner
        } else {
            (*(buffer.as_ptr() as *const TOKEN_USER)).User.Sid
        };
        if sid.is_null() || IsValidSid(sid) == 0 {
            return Err(format!("{label}: SID is invalid"));
        }
        let length = GetLengthSid(sid) as usize;
        let mut owned = vec![0u32; length.div_ceil(4)];
        std::ptr::copy_nonoverlapping(sid as *const u8, owned.as_mut_ptr().cast::<u8>(), length);
        Ok(owned)
    }
}

/// The SID of the user this process runs as.
fn current_user_sid() -> Result<Vec<u32>, String> {
    token_sid(TokenUser, "read token user")
}

/// The SID this process would own new files as: the token's default owner,
/// which is the user normally and the Administrators group under elevation.
/// Comparing against this instead of the user SID keeps elevated runs
/// working without letting a foreign owner through.
fn token_owner_sid() -> Result<Vec<u32>, String> {
    token_sid(TokenOwner, "read token owner")
}

/// The well-known SID of BUILTIN\Administrators: the owner of every object an
/// elevated run creates. No non-admin account can assign it, so accepting it
/// does not widen the threat model (review round: grok F1 / sonnet F1).
fn administrators_sid() -> Result<Vec<u32>, String> {
    unsafe {
        let mut buffer = vec![0u32; (SECURITY_MAX_SID_SIZE as usize).div_ceil(4)];
        let mut size = SECURITY_MAX_SID_SIZE;
        if CreateWellKnownSid(
            WinBuiltinAdministratorsSid,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut size,
        ) == 0
        {
            return Err(os_error("build administrators SID"));
        }
        Ok(buffer)
    }
}

/// The owner identities this process may legitimately find on its own
/// credential files, in any order of elevated and unelevated runs: the token
/// user, the token's default owner, and the Administrators group (an earlier
/// elevated run's files re-read by an unelevated one). A foreign non-admin
/// account can own none of them.
fn owner_accepted(owner: *mut core::ffi::c_void) -> Result<bool, String> {
    let mut user = current_user_sid()?;
    let mut token_owner = token_owner_sid()?;
    let mut admins = administrators_sid()?;
    unsafe {
        Ok(EqualSid(owner, user.as_mut_ptr().cast()) != 0
            || EqualSid(owner, token_owner.as_mut_ptr().cast()) != 0
            || EqualSid(owner, admins.as_mut_ptr().cast()) != 0)
    }
}

/// ERROR_SHARING_VIOLATION: another process holds the object with a
/// conflicting share mode.
const ERROR_SHARING_VIOLATION: i32 = 32;

/// Open with a bounded retry on sharing violations: an AV scanner, an
/// indexer or a parallel issuance holds the object for milliseconds, and
/// failing the launch on the first conflict would trade availability for
/// nothing. After about a second the open still fails closed (review round:
/// grok F6 / sonnet F3).
pub(super) fn open_with_sharing_retry(
    what: &str,
    mut open: impl FnMut() -> std::io::Result<File>,
) -> Result<File, String> {
    let mut attempts = 0u32;
    loop {
        match open() {
            Ok(file) => return Ok(file),
            Err(error) => {
                if error.raw_os_error() == Some(ERROR_SHARING_VIOLATION) && attempts < 25 {
                    attempts += 1;
                    std::thread::sleep(std::time::Duration::from_millis(40));
                    continue;
                }
                return Err(format!("{what}: {error}"));
            }
        }
    }
}

/// Refuse an object that is not what its path claims: a reparse point
/// (symlink or junction - opened as itself thanks to
/// `FILE_FLAG_OPEN_REPARSE_POINT`) or a file reachable through a second hard
/// link. Otherwise a planted link would have the writer truncate and re-ACL
/// the link's target (review round: grok F2 / sonnet F4).
pub(super) fn refuse_links(file: &File, what: &str) -> Result<(), String> {
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_REPARSE_POINT,
    };
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(file.as_raw_handle() as HANDLE, &mut info) } == 0 {
        return Err(os_error("inspect credential object"));
    }
    if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(format!("{what} is a link (reparse point), refusing"));
    }
    if info.nNumberOfLinks > 1 {
        return Err(format!(
            "{what} is reachable through {} hard links, refusing",
            info.nNumberOfLinks
        ));
    }
    Ok(())
}

/// Replace the DACL on `file` with one protected ACE granting the current
/// user full access, then verify the result. The handle must carry
/// `WRITE_DAC | READ_CONTROL`. `inherit_children` marks the ACE so objects
/// created below a directory inherit this grant.
fn restrict_handle(file: &File, inherit_children: bool) -> Result<(), String> {
    let mut sid = current_user_sid()?;
    let psid = sid.as_mut_ptr().cast::<core::ffi::c_void>();
    unsafe {
        let size = std::mem::size_of::<ACL>() + std::mem::size_of::<ACCESS_ALLOWED_ACE>()
            - std::mem::size_of::<u32>()
            + GetLengthSid(psid) as usize;
        let mut acl_buffer = vec![0u32; size.div_ceil(4)];
        let acl = acl_buffer.as_mut_ptr().cast::<ACL>();
        if InitializeAcl(acl, (acl_buffer.len() * 4) as u32, ACL_REVISION) == 0 {
            return Err(os_error("initialize credential ACL"));
        }
        if AddAccessAllowedAce(acl, ACL_REVISION, FILE_ALL_ACCESS, psid) == 0 {
            return Err(os_error("add owner ACE"));
        }
        if inherit_children {
            let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
            if GetAce(acl, 0, &mut ace) == 0 || ace.is_null() {
                return Err(os_error("mark owner ACE inheritable"));
            }
            (*(ace as *mut ACE_HEADER)).AceFlags =
                (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) as u8;
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
            return Err(os_error("build credential security"));
        }
        if SetKernelObjectSecurity(
            file.as_raw_handle() as HANDLE,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            pdescriptor,
        ) == 0
        {
            return Err(os_error("restrict credential ACL"));
        }
    }
    verify_owner_only(file)
}

/// Replace the DACL on `file` with one protected ACE granting the current
/// user full access, then verify the result. The handle must carry
/// `WRITE_DAC | READ_CONTROL`.
pub(super) fn restrict_to_current_user(file: &File) -> Result<(), String> {
    restrict_handle(file, false)?;
    #[cfg(test)]
    if FAIL_NEXT_RESTRICT.with(|fail| fail.replace(false)) {
        return Err("injected credential ACL failure".into());
    }
    Ok(())
}

/// W2-07b: narrow the `agent-access/` directory itself. The directory decides
/// who may list it, plant files in it or delete from it; restricting only the
/// files leaves all three open. Fails closed like the file variant.
pub(super) fn restrict_directory_to_current_user(dir: &Path) -> Result<(), String> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, READ_CONTROL, WRITE_DAC,
    };
    // FILE_FLAG_BACKUP_SEMANTICS is what lets CreateFile open a directory;
    // FILE_FLAG_OPEN_REPARSE_POINT opens a junction as itself so
    // `refuse_links` can refuse it instead of re-ACLing its target.
    let what = format!("open credential directory {}", dir.display());
    let file = open_with_sharing_retry(&what, || {
        std::fs::OpenOptions::new()
            .access_mode(WRITE_DAC | READ_CONTROL)
            .share_mode(0)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(dir)
    })?;
    refuse_links(&file, &what)?;
    restrict_handle(&file, true)?;
    #[cfg(test)]
    if FAIL_NEXT_DIRECTORY_RESTRICT.with(|fail| fail.replace(false)) {
        return Err("injected credential directory ACL failure".into());
    }
    Ok(())
}

/// One ACE as the read-back saw it.
struct AceRead {
    ace_type: u8,
    inherited: bool,
    is_token_user: bool,
    grants_read: bool,
}

/// What the read-back saw on a file: ownership, control bits, DACL.
struct SecurityRead {
    owner_accepted: bool,
    control: u16,
    dacl_present: bool,
    aces: Vec<AceRead>,
}

/// Fail closed unless `file` is owned by one of this process's owner
/// identities and its DACL is protected, non-null, carries no inherited ACE,
/// and consists of at least one allow ACE, each for the current user and each
/// granting read. Any deny or other ACE type is refused.
pub(super) fn verify_owner_only(file: &File) -> Result<(), String> {
    validate_owner_only(&read_security(file)?)
}

/// Owner pre-check without touching the DACL or the content: a foreign-owned
/// object is refused before anything about it changes (review round: grok
/// F1 - the truncate-first order used to destroy a rejected descriptor before
/// the refusal).
pub(super) fn verify_owned(file: &File) -> Result<(), String> {
    if !read_security(file)?.owner_accepted {
        return Err("credential file is owned by another account".into());
    }
    Ok(())
}

fn read_security(file: &File) -> Result<SecurityRead, String> {
    let mut user = current_user_sid()?;
    let psid = user.as_mut_ptr().cast::<core::ffi::c_void>();
    let handle = file.as_raw_handle() as HANDLE;
    unsafe {
        let mut needed = 0u32;
        GetKernelObjectSecurity(
            handle,
            DACL_SECURITY_INFORMATION | OWNER_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            0,
            &mut needed,
        );
        if needed == 0 {
            return Err(os_error("read credential security size"));
        }
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        let descriptor: PSECURITY_DESCRIPTOR = buffer.as_mut_ptr().cast();
        if GetKernelObjectSecurity(
            handle,
            DACL_SECURITY_INFORMATION | OWNER_SECURITY_INFORMATION,
            descriptor,
            needed,
            &mut needed,
        ) == 0
        {
            return Err(os_error("read credential security"));
        }
        let mut owner_sid: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut owner_defaulted = FALSE;
        if GetSecurityDescriptorOwner(descriptor, &mut owner_sid, &mut owner_defaulted) == 0 {
            return Err(os_error("read credential owner"));
        }
        if owner_sid.is_null() {
            return Err("credential file has no owner".into());
        }
        let owner_accepted = owner_accepted(owner_sid)?;
        let mut control = 0u16;
        let mut revision = 0u32;
        if GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) == 0 {
            return Err(os_error("read credential security control"));
        }
        let mut present = FALSE;
        let mut defaulted = FALSE;
        let mut acl: *mut ACL = std::ptr::null_mut();
        if GetSecurityDescriptorDacl(descriptor, &mut present, &mut acl, &mut defaulted) == 0 {
            return Err(os_error("read credential DACL"));
        }
        let dacl_present = present != FALSE && !acl.is_null();
        let mut aces = Vec::new();
        if dacl_present {
            let mut size: ACL_SIZE_INFORMATION = std::mem::zeroed();
            if GetAclInformation(
                acl,
                (&mut size as *mut ACL_SIZE_INFORMATION).cast(),
                std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
                AclSizeInformation,
            ) == 0
            {
                return Err(os_error("read credential ACL entries"));
            }
            for index in 0..size.AceCount {
                let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
                if GetAce(acl, index, &mut ace) == 0 || ace.is_null() {
                    return Err(os_error("read credential ACE"));
                }
                let header = *(ace as *const ACE_HEADER);
                let inherited = u32::from(header.AceFlags) & INHERITED_ACE != 0;
                if header.AceType == ACCESS_ALLOWED_ACE_TYPE {
                    let body = ace as *const ACCESS_ALLOWED_ACE;
                    let sid = std::ptr::addr_of!((*body).SidStart);
                    aces.push(AceRead {
                        ace_type: header.AceType,
                        inherited,
                        is_token_user: EqualSid(sid as *mut _, psid) != 0,
                        grants_read: (*body).Mask & FILE_GENERIC_READ == FILE_GENERIC_READ,
                    });
                } else {
                    aces.push(AceRead {
                        ace_type: header.AceType,
                        inherited,
                        is_token_user: false,
                        grants_read: false,
                    });
                }
            }
        }
        Ok(SecurityRead {
            owner_accepted,
            control,
            dacl_present,
            aces,
        })
    }
}

fn validate_owner_only(read: &SecurityRead) -> Result<(), String> {
    if !read.owner_accepted {
        return Err("credential file is owned by another account".into());
    }
    if read.control & SE_DACL_PROTECTED == 0 {
        return Err("credential ACL still inherits from its directory".into());
    }
    if !read.dacl_present {
        return Err("credential file has no DACL and is open to everyone".into());
    }
    let mut owner_allowed = false;
    for ace in &read.aces {
        if ace.inherited {
            return Err("credential ACL carries an inherited entry".into());
        }
        match ace.ace_type {
            // The writers never add one. A deny cannot widen access, but one
            // for the user or a group it belongs to (Everyone, Users) locks
            // the agent out of its own credential, and group membership is
            // not decidable here: refuse them all.
            ACCESS_DENIED_ACE_TYPE => {
                return Err("credential ACL carries a deny entry".into());
            }
            ACCESS_ALLOWED_ACE_TYPE => {
                if !ace.is_token_user {
                    return Err("credential ACL grants access beyond the current user".into());
                }
                if !ace.grants_read {
                    return Err("credential ACL does not let the user read it".into());
                }
                owner_allowed = true;
            }
            other => {
                return Err(format!(
                    "credential ACL carries an unsupported entry type {other}"
                ))
            }
        }
    }
    if !owner_allowed {
        return Err("credential ACL does not grant the current user".into());
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

    /// A crafted read-back: an otherwise perfect ACL on a file whose owner
    /// is or is not one of the accepted identities. Building this on disk
    /// would need SeTakeOwnership, so the validation runs on the parsed
    /// snapshot directly.
    fn crafted(owner_accepted: bool) -> SecurityRead {
        SecurityRead {
            owner_accepted,
            control: SE_DACL_PROTECTED,
            dacl_present: true,
            aces: vec![AceRead {
                ace_type: ACCESS_ALLOWED_ACE_TYPE,
                inherited: false,
                is_token_user: true,
                grants_read: true,
            }],
        }
    }

    #[test]
    fn a_foreign_owner_is_refused_even_with_a_narrow_acl() {
        let error = validate_owner_only(&crafted(false)).unwrap_err();
        assert!(error.contains("owned by another account"), "{error}");
    }

    #[test]
    fn an_accepted_owner_passes_the_owner_check() {
        validate_owner_only(&crafted(true)).unwrap();
    }

    /// Review round (grok F1 / sonnet F1): the owner set is the token user,
    /// the token's default owner, and the Administrators group - the three
    /// identities this process's files can legitimately carry, in any order
    /// of elevated and unelevated runs.
    #[test]
    fn the_token_user_and_token_owner_are_accepted_owners() {
        let mut user = current_user_sid().unwrap();
        assert!(owner_accepted(user.as_mut_ptr().cast::<core::ffi::c_void>()).unwrap());
        let mut owner = token_owner_sid().unwrap();
        assert!(owner_accepted(owner.as_mut_ptr().cast::<core::ffi::c_void>()).unwrap());
    }

    #[test]
    fn the_administrators_group_is_an_accepted_owner() {
        // A file an earlier elevated run created, re-read by an unelevated
        // one, is owned by BUILTIN\Administrators; no non-admin can assign
        // that owner, so accepting it lets no foreign user through.
        let mut admins = administrators_sid().unwrap();
        assert!(owner_accepted(admins.as_mut_ptr().cast::<core::ffi::c_void>()).unwrap());
    }

    #[test]
    fn a_world_sid_is_not_an_accepted_owner() {
        let mut world = vec![0u32; (SECURITY_MAX_SID_SIZE as usize).div_ceil(4)];
        let mut size = SECURITY_MAX_SID_SIZE;
        unsafe {
            assert_ne!(
                CreateWellKnownSid(
                    WinWorldSid,
                    std::ptr::null_mut(),
                    world.as_mut_ptr().cast(),
                    &mut size
                ),
                0
            );
        }
        assert!(!owner_accepted(world.as_mut_ptr().cast::<core::ffi::c_void>()).unwrap());
    }

    #[test]
    fn a_restricted_directory_passes_the_same_check() {
        let dir = crate::testutil::TempDir::new("api-w207b-dir-restrict");
        let inner = dir.path().join("agent-access");
        std::fs::create_dir(&inner).unwrap();
        restrict_directory_to_current_user(&inner).unwrap();
        // A file created inside inherits the user-only grant, and the writer
        // still replaces its DACL like any other credential file.
        let file = open(&inner.join("child.json"));
        restrict_to_current_user(&file).unwrap();
    }

    /// W2-07b review round (grok F2 / sonnet F4): a planted second hard link
    /// at the descriptor path must be refused before anything is truncated or
    /// re-ACL'd, and the original file must stay byte-identical.
    #[test]
    fn a_second_hard_link_to_the_descriptor_is_refused_and_the_target_untouched() {
        let dir = crate::testutil::TempDir::new("api-w207b-hardlink");
        let victim = dir.path().join("victim.json");
        std::fs::write(&victim, b"precious").unwrap();
        let planted = dir.path().join("projecta-api.json");
        std::fs::hard_link(&victim, &planted).unwrap();
        let error = crate::api::write_descriptor_body(&planted, b"new-token").unwrap_err();
        assert!(error.contains("hard link"), "{error}");
        assert_eq!(std::fs::read(&victim).unwrap(), b"precious");
    }

    /// W2-07b review round (grok F1): when the restriction fails, the previous
    /// descriptor content must survive - the owner and the fresh DACL are
    /// verified before any truncation, so a refused write never destroys the
    /// running instance's descriptor.
    #[test]
    fn a_failed_restriction_preserves_the_existing_descriptor() {
        let dir = crate::testutil::TempDir::new("api-w207b-keep");
        let path = dir.path().join("projecta-api.json");
        std::fs::write(&path, b"old-token").unwrap();
        FAIL_NEXT_RESTRICT.with(|fail| fail.set(true));
        let error = crate::api::write_descriptor_body(&path, b"new-token").unwrap_err();
        assert!(error.contains("injected"), "{error}");
        assert_eq!(std::fs::read(&path).unwrap(), b"old-token");
    }

    /// W2-07b review round (grok F6 / sonnet F3): an AV scan or a parallel
    /// issuance holding the descriptor for a few hundred milliseconds must not
    /// fail the launch; the open retries a bounded time before failing closed.
    #[test]
    fn a_briefly_held_descriptor_handle_is_waited_out() {
        let dir = crate::testutil::TempDir::new("api-w207b-busy");
        let path = dir.path().join("projecta-api.json");
        std::fs::write(&path, b"old-token").unwrap();
        let blocker = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        let release = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            drop(blocker);
        });
        crate::api::write_descriptor_body(&path, b"new-token").unwrap();
        release.join().unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new-token");
    }

    /// W2-07b review round (sonnet F6): the failure-injection seam for the
    /// credential FILE must survive a directory restriction - the directory
    /// step runs first at issuance and must not consume the file's flag.
    #[test]
    fn the_directory_restrict_does_not_consume_the_file_injection_flag() {
        let dir = crate::testutil::TempDir::new("api-w207b-seam");
        let inner = dir.path().join("agent-access");
        std::fs::create_dir(&inner).unwrap();
        FAIL_NEXT_RESTRICT.with(|fail| fail.set(true));
        restrict_directory_to_current_user(&inner).unwrap();
        let file = open(&inner.join("child.json"));
        let error = restrict_to_current_user(&file).unwrap_err();
        assert!(error.contains("injected"), "{error}");
    }

    /// W2-07b review round (sonnet F6): the directory step has its own
    /// injection seam, so a failing directory restriction stays testable
    /// without touching the file flag.
    #[test]
    fn the_directory_injection_flag_is_separate_from_the_file_flag() {
        let dir = crate::testutil::TempDir::new("api-w207b-dirfail");
        let inner = dir.path().join("agent-access");
        std::fs::create_dir(&inner).unwrap();
        FAIL_NEXT_DIRECTORY_RESTRICT.with(|fail| fail.set(true));
        let error = restrict_directory_to_current_user(&inner).unwrap_err();
        assert!(error.contains("injected credential directory"), "{error}");
        // The file flag was never armed: the next file restrict works.
        let file = open(&inner.join("child.json"));
        restrict_to_current_user(&file).unwrap();
    }
}
