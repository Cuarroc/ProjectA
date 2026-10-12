import { invoke } from "@tauri-apps/api/core";
export function logFrontendError(message: string, stackFrame: string, route: string): Promise<void> {
  return invoke("log_frontend_error", { message, stackFrame, route });
}
export function logFrontendFeedback(message: string, expected: string, route: string, context: string): Promise<void> {
  return invoke("log_frontend_error", { message, stackFrame: expected, route, kind: "feedback", context });
}
