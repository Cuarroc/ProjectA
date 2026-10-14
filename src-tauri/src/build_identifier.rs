//! The bundle identifier this binary was built with.
//!
//! The Dev preview build ("ProjectA Dev", `docs/setup/dev-build.md`) carries
//! the identifier `com.projecta.dev`, so its app-data directory, database and
//! hooks directory never collide with the stable app. Tauri hands that
//! identifier to the app at runtime, but code paths without an `AppHandle`
//! (the `pa` CLI, the hooks settings directory) cannot ask Tauri — they read
//! the identifier the build embedded through `PROJECTA_IDENTIFIER` here, from
//! one shared source.

/// What the build embedded, or the stable identifier when nothing usable was
/// embedded (local builds, the release pipeline). An empty or path-like value
/// would become a path segment of the app-data directory, so it is ignored;
/// the app's startup check then reports the mismatch with the Tauri config.
pub(crate) const fn resolve_build_identifier(embedded: Option<&'static str>) -> &'static str {
    match embedded {
        Some(identifier) if is_plain_identifier(identifier) => identifier,
        _ => "com.projecta.app",
    }
}

/// Letters, digits, `.`, `-` and `_`, with at least one letter or digit.
const fn is_plain_identifier(identifier: &str) -> bool {
    let bytes = identifier.as_bytes();
    let mut has_alphanumeric = false;
    let mut i = 0;
    while i < bytes.len() {
        let byte = bytes[i];
        if byte.is_ascii_alphanumeric() {
            has_alphanumeric = true;
        } else if !matches!(byte, b'.' | b'-' | b'_') {
            return false;
        }
        i += 1;
    }
    has_alphanumeric
}

/// The identifier of this build. The dev-build workflow sets
/// `PROJECTA_IDENTIFIER` to `com.projecta.dev`; everything else falls back to
/// the stable identifier.
pub(crate) const IDENTIFIER: &str = resolve_build_identifier(option_env!("PROJECTA_IDENTIFIER"));

#[cfg(test)]
mod tests {
    use super::resolve_build_identifier;

    /// R1290-C2: an empty or path-like `PROJECTA_IDENTIFIER` must never become
    /// a path segment of the app-data directory.
    #[test]
    fn unusable_embedded_identifier_falls_back_to_stable() {
        assert_eq!(
            resolve_build_identifier(Some("com.projecta.dev")),
            "com.projecta.dev"
        );
        for bad in ["", "..", "a/b", "a\\b", "com projecta"] {
            assert_eq!(
                resolve_build_identifier(Some(bad)),
                "com.projecta.app",
                "{bad:?}"
            );
        }
    }
}
