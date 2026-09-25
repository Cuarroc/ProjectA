//! Shared wire types and private checkpoint handoff. Native session activation
//! remains gated; importing these types does not start a process.
pub use projecta_capture::{checkpoints, host_reply, protocol};
#[cfg(windows)]
pub mod managed;
#[cfg(windows)]
pub use projecta_capture::windows_process;
