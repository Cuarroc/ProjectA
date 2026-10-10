//! Wire event names shared with `src/lib/eventNames.ts`.

pub const WORKER_STATUS: &str = "worker:status";
pub const SUPERVISOR_NOTIFICATION: &str = "supervisor:notification";
pub const PTY_OUTPUT_PREFIX: &str = "pty:output:";
pub const PTY_EXIT_PREFIX: &str = "pty:exit:";

pub fn pty_output(id: &str) -> String {
    format!("{PTY_OUTPUT_PREFIX}{id}")
}

pub fn pty_exit(id: &str) -> String {
    format!("{PTY_EXIT_PREFIX}{id}")
}
