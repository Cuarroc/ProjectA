import { invoke } from "@tauri-apps/api/core";
export function logFrontendError(message: string, stackFrame: string, route: string): Promise<void> {
  return invoke("log_frontend_error", { message, stackFrame, route });
}
