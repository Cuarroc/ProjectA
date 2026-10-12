import { logFrontendError, logFrontendFeedback } from "../lib/ipc/frontendErrors";
import { buildInfo } from "../dev/buildInfo";

const encoder = new TextEncoder();
let recent: { signature: string; at: number }[] = [];
const signatures: string[] = [];
function text(value: unknown): string {
  try { return String(value); } catch { return "Unknown frontend error"; }
}
function bounded(value: string, bytes: number): string {
  let result = "";
  for (const char of value) {
    const size = encoder.encode(char).length;
    if (size > bytes) break;
    result += char;
    bytes -= size;
  }
  return result;
}
export function reportFrontendError(error: unknown, componentStack?: string | null): void {
  try {
    let message = text(error), stackFrame = "";
    try {
      if (error instanceof Error) {
        message = text(error.message);
        stackFrame = error.stack?.split("\n").find(line => /^\s*at\s|@/.test(line))?.trim() ?? "";
      }
    } catch { /* Thrown proxies and hostile accessors must not break reporting. */ }
    message = bounded(message, 2048);
    stackFrame = bounded([stackFrame, componentStack].filter(Boolean).join(" | "), 512);
    const route = bounded(window.location.pathname, 256);
    const signature = JSON.stringify([message, stackFrame, route]);
    const now = performance.now();
    recent = recent.filter(entry => now - entry.at < 60_000);
    if (recent.length >= 50 || recent.some(entry => entry.signature === signature && now - entry.at < 10_000)) return;
    recent.push({ signature, at: now });
    signatures.push(bounded(stackFrame ? `${message} @ ${stackFrame}` : message, 160));
    if (signatures.length > 20) signatures.shift();
    void logFrontendError(message, stackFrame, route).catch(() => {});
  } catch { /* Logging is best effort, including when the IPC bridge is absent. */ }
}
/** Signatures of the most recently logged errors — bounded one-liners, never payloads. */
export function recentErrorSignatures(): string[] {
  return [...signatures];
}
/** Write one user feedback entry through the frontend error log path. */
export function reportFrontendFeedback(what: string, expected: string): void {
  try {
    const context = bounded(
      `sha="${buildInfo().sha}" at="${new Date().toISOString()}" recent="${signatures.join(" | ")}"`,
      2048,
    );
    void logFrontendFeedback(
      bounded(what, 2048),
      bounded(expected, 1024),
      bounded(window.location.pathname, 256),
      context,
    ).catch(() => {});
  } catch { /* Feedback is best effort, including when the IPC bridge is absent. */ }
}
export function installFrontendErrorHandlers(): () => void {
  const onError = (event: ErrorEvent) => reportFrontendError(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => reportFrontendError(event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
