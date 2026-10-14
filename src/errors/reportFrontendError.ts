import { logFrontendError, logFrontendFeedback } from "../lib/ipc/frontendErrors";

const encoder = new TextEncoder();
const SEPARATOR_BYTES = encoder.encode(" | ").length;
const ELLIPSIS_BYTES = encoder.encode("…").length;
let recent: { signature: string; at: number }[] = [];
const signatures: string[] = [];
function text(value: unknown): string {
  try { return String(value); } catch { return "Unknown frontend error"; }
}
function bounded(value: string, bytes: number, escaped = false): string {
  let result = "";
  for (const char of value) {
    const size = encoder.encode(char).length + (escaped && (char === '"' || char === "\\") ? 1 : 0);
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
/** Write one user feedback entry through the frontend error log path. */
export function reportFrontendFeedback(what: string, expected: string): Promise<boolean> {
  try {
    // buildInfo is dev-only code: load it lazily so the production error
    // handlers above never depend on it at module-load time.
    return import("../dev/buildInfo").then(({ buildInfo }) => {
      // Reserve the native field's escaped bytes, including metadata and separators.
      // Share the remainder across the ring so the newest entries always survive.
      const prefix = `sha="${bounded(buildInfo().sha, 64, true)}" at="${new Date().toISOString()}" recent="`;
      const overhead = encoder.encode(`${prefix}"`.replace(/["\\]/g, "\\$&")).length;
      const perSignature = Math.floor((2048 - overhead - Math.max(0, signatures.length - 1) * SEPARATOR_BYTES) / Math.max(1, signatures.length));
      const entries = signatures.map(signature => {
        const full = bounded(signature, perSignature, true);
        return full === signature ? full : `${bounded(signature, perSignature - ELLIPSIS_BYTES, true)}…`;
      });
      const context = `${prefix}${entries.join(" | ")}"`;
      return logFrontendFeedback(
        bounded(what, 2048, true),
        bounded(expected, 1024, true),
        bounded(window.location.pathname, 256),
        context,
      );
    }).catch(() => false);
  } catch { return Promise.resolve(false); }
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
