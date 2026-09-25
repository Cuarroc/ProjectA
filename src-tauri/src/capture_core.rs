//! Shared native capture implementation for the application and isolated host.
//! The library owns no app state, scheduler, credentials or database services.
#[path = "process_capture/checkpoints.rs"]
pub mod checkpoints;
#[path = "process_capture/events.rs"]
pub mod host_events;
#[path = "process_capture/host_reply.rs"]
pub mod host_reply;
#[path = "workers/native_resources.rs"]
pub mod native_resources;
#[path = "process_capture/protocol.rs"]
pub mod protocol;
#[path = "process_capture/stream_guard.rs"]
pub mod stream_guard;
#[cfg(windows)]
#[path = "process_capture/windows_image.rs"]
pub mod windows_image;
#[cfg(windows)]
#[path = "process_capture/windows_process.rs"]
pub mod windows_process;
