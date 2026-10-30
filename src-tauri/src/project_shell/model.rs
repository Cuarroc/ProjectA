//! PF-1 input snapshots, not trusted authority or proof of installed layout.
//! File zones do not specify action risk, authorization, execution place or acceptance.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SchemaVersion(pub u32);

impl SchemaVersion {
    pub const V1: Self = Self(1);
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Layout {
    Legacy,
    Separated {
        wrapper_root: String,
        control_root: String,
    },
    Unknown,
}

/// Caller-supplied labels, including checksums, never authenticate their source.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum UnverifiedMetadata {
    #[default]
    Unknown,
    Unverified(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SafetyMetadata {
    pub policy_origin: UnverifiedMetadata,
    pub root_identity: UnverifiedMetadata,
}

/// Names for file zones only; none of these variants grants permission.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileZone {
    Blocked,
    OrchestratorOnly,
    Free,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectShell {
    project_id: String,
    repo_path: String,
    pub schema_version: SchemaVersion,
    pub layout: Layout,
    pub safety: SafetyMetadata,
}

fn malformed_path(path: &str) -> bool {
    path.trim().is_empty() || path.chars().any(char::is_control)
}

impl ProjectShell {
    /// Preserves the existing identity and product repo verbatim. This only checks
    /// strings: aliases, links, case, UNC, Git administration and TOCTOU need guards.
    pub fn new(
        project_id: &str,
        repo_path: &str,
        schema_version: SchemaVersion,
        layout: Layout,
        safety: SafetyMetadata,
    ) -> Result<Self, &'static str> {
        if schema_version != SchemaVersion::V1 {
            return Err("ERR_REFUSED: unsupported project shell schema");
        }
        if project_id.is_empty()
            || project_id
                .chars()
                .any(|c| c.is_control() || c.is_whitespace())
        {
            return Err("ERR_REFUSED: malformed project identity");
        }
        if malformed_path(repo_path) {
            return Err("ERR_REFUSED: malformed product repo path");
        }
        if let Layout::Separated {
            wrapper_root,
            control_root,
        } = &layout
        {
            if malformed_path(wrapper_root)
                || malformed_path(control_root)
                || wrapper_root == repo_path
                || control_root == repo_path
                || wrapper_root == control_root
            {
                return Err("ERR_REFUSED: malformed separated roots");
            }
        }
        Ok(Self {
            project_id: project_id.to_owned(),
            repo_path: repo_path.to_owned(),
            schema_version,
            layout,
            safety,
        })
    }

    pub fn project_id(&self) -> &str {
        &self.project_id
    }

    /// Always the product Git repository, never the wrapper or control root.
    pub fn repo_path(&self) -> &str {
        &self.repo_path
    }
}

#[cfg(test)]
mod tests {
    use super::{
        FileZone, Layout, ProjectShell, SafetyMetadata, SchemaVersion, UnverifiedMetadata,
    };

    #[test]
    fn keeps_existing_product_repo_and_legacy_state_distinct() {
        assert_ne!(FileZone::Blocked, FileZone::OrchestratorOnly);
        assert_ne!(FileZone::OrchestratorOnly, FileZone::Free);
        assert_ne!(FileZone::Blocked, FileZone::Free);
        // Literal PF-1 roles: produkt/ and sibling .projecta/; legacy stays put.
        let legacy = ProjectShell::new(
            "pj_alpha",
            "/existing/alpha",
            SchemaVersion(1),
            Layout::Legacy,
            SafetyMetadata::default(),
        )
        .unwrap();
        assert_eq!(legacy.project_id(), "pj_alpha");
        assert_eq!(legacy.repo_path(), "/existing/alpha");
        assert_eq!(legacy.schema_version, SchemaVersion(1));
        assert_eq!(legacy.layout, Layout::Legacy);
        assert_eq!(legacy.safety.policy_origin, UnverifiedMetadata::Unknown);
        assert_eq!(legacy.safety.root_identity, UnverifiedMetadata::Unknown);

        let separated = ProjectShell::new(
            "pj_beta",
            "/projects/beta/produkt",
            SchemaVersion(1),
            Layout::Separated {
                wrapper_root: "/projects/beta".into(),
                control_root: "/projects/beta/.projecta".into(),
            },
            SafetyMetadata {
                policy_origin: UnverifiedMetadata::Unverified("editable-policy".into()),
                root_identity: UnverifiedMetadata::Unverified("claimed-git-id".into()),
            },
        )
        .unwrap();
        assert_eq!(separated.project_id(), "pj_beta");
        assert_eq!(separated.repo_path(), "/projects/beta/produkt");
        assert_eq!(
            separated.layout,
            Layout::Separated {
                wrapper_root: "/projects/beta".into(),
                control_root: "/projects/beta/.projecta".into(),
            }
        );
        assert_eq!(
            separated.safety.policy_origin,
            UnverifiedMetadata::Unverified("editable-policy".into())
        );
        assert_eq!(
            separated.safety.root_identity,
            UnverifiedMetadata::Unverified("claimed-git-id".into())
        );
        assert_eq!(legacy.repo_path(), "/existing/alpha");

        let unknown = ProjectShell::new(
            "pj_unknown",
            "/existing/unknown",
            SchemaVersion(1),
            Layout::Unknown,
            SafetyMetadata::default(),
        )
        .unwrap();
        assert_eq!(unknown.layout, Layout::Unknown);
        assert_eq!(unknown.safety.policy_origin, UnverifiedMetadata::Unknown);
        assert_eq!(
            ProjectShell::new(
                "pj_alpha",
                "/existing/alpha",
                SchemaVersion(99),
                Layout::Legacy,
                SafetyMetadata::default(),
            ),
            Err("ERR_REFUSED: unsupported project shell schema")
        );
        for path in ["", " ", "bad\0path", "bad\npath"] {
            assert_eq!(
                ProjectShell::new(
                    "pj_alpha",
                    path,
                    SchemaVersion(1),
                    Layout::Legacy,
                    SafetyMetadata::default(),
                ),
                Err("ERR_REFUSED: malformed product repo path")
            );
        }
        for (wrapper, control) in [
            ("", "/b/.projecta"),
            ("/b", ""),
            ("/b", "/b/produkt"),
            ("/b/produkt", "/b/.projecta"),
            ("/b", "/b"),
        ] {
            assert_eq!(
                ProjectShell::new(
                    "pj_beta",
                    "/b/produkt",
                    SchemaVersion(1),
                    Layout::Separated {
                        wrapper_root: wrapper.into(),
                        control_root: control.into()
                    },
                    SafetyMetadata::default(),
                ),
                Err("ERR_REFUSED: malformed separated roots")
            );
        }
        for identity in ["pj bad", "pj_\0bad", " ", ""] {
            assert_eq!(
                ProjectShell::new(
                    identity,
                    "/existing/alpha",
                    SchemaVersion(1),
                    Layout::Legacy,
                    SafetyMetadata::default(),
                ),
                Err("ERR_REFUSED: malformed project identity")
            );
        }
    }
}
