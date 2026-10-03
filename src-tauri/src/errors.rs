//! Error-prefix vocabulary shared by the store and the worker layer.
//!
//! Lives in its own module so `store` can use the prefixes without importing
//! `workers`. `workers` re-exports both, and its module documentation
//! describes the whole error vocabulary.

/// Opens every error where the caller named something that does not exist.
/// See the module documentation of `workers` for the whole vocabulary.
pub const ERR_UNKNOWN: &str = "unknown ";

/// Opens every error where what the caller named exists but may not be used
/// the way it was asked for.
pub const ERR_REFUSED: &str = "refused: ";
