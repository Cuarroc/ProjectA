//! The bundle identifier this binary was built with.
//!
//! The Dev preview build ("ProjectA Dev", `docs/setup/dev-build.md`) carries
//! the identifier `com.projecta.dev`, so its app-data directory, database and
//! hooks directory never collide with the stable app. Tauri hands that
//! identifier to the app at runtime, but code paths without an `AppHandle`
//! (the `pa` CLI, the hooks settings directory) cannot ask Tauri — they read
//! the identifier the build embedded through `PROJECTA_IDENTIFIER` here, from
//! one shared source.

/// What the build embedded, or the stable identifier when nothing was
/// embedded (local builds, the release pipeline).
pub(crate) const fn resolve_build_identifier(embedded: Option<&'static str>) -> &'static str {
    match embedded {
        Some(identifier) => identifier,
        None => "com.projecta.app",
    }
}

/// The identifier of this build. The dev-build workflow sets
/// `PROJECTA_IDENTIFIER` to `com.projecta.dev`; everything else falls back to
/// the stable identifier.
pub(crate) const IDENTIFIER: &str = resolve_build_identifier(option_env!("PROJECTA_IDENTIFIER"));
