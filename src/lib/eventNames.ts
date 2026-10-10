/** Wire event names shared with src-tauri/src/event_names.rs. */
export const WORKER_STATUS = "worker:status";
export const SUPERVISOR_NOTIFICATION = "supervisor:notification";
export const PTY_OUTPUT_PREFIX = "pty:output:";
export const PTY_EXIT_PREFIX = "pty:exit:";

export function ptyOutput(id: string): string {
  return `${PTY_OUTPUT_PREFIX}${id}`;
}

export function ptyExit(id: string): string {
  return `${PTY_EXIT_PREFIX}${id}`;
}
