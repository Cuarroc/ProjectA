import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Pure preflight: no file access, server start, or secret-source assumptions.
// Only config contains values; errors and notification reasons are safe to print.
export function loadStartConfig(env, { repoRoot }) {
  const errors = [];
  const error = (suffix, reason) => errors.push({ name: `DECISION_DESK_${suffix}`, reason });
  const rootReceiptToken = env.DECISION_DESK_ROOT_RECEIPT_TOKEN;
  const webhookSecret = env.DECISION_DESK_WEBHOOK_SECRET;
  const agent = env.DECISION_DESK_ROOT_AGENT_ID;
  const rootAgentId = typeof agent === "string" && agent.trim() ? agent : null;
  const state = env.DECISION_DESK_STATE;
  const rawPort = env.DECISION_DESK_PORT;
  const port = rawPort === undefined ? 4791 : Number(rawPort);

  if (typeof rootReceiptToken !== "string" || rootReceiptToken.length < 32
      || rootReceiptToken.length > 256 || /[^A-Za-z0-9_-]/u.test(rootReceiptToken)) {
    error("ROOT_RECEIPT_TOKEN", "required; use 32–256 letters, digits, underscores or hyphens");
  }
  if (typeof webhookSecret !== "string" || webhookSecret.length < 32 || /\p{Cc}/u.test(webhookSecret)) {
    error("WEBHOOK_SECRET", "required; use at least 32 characters without control characters");
  } else if (webhookSecret === rootReceiptToken) {
    error("WEBHOOK_SECRET", "must differ from DECISION_DESK_ROOT_RECEIPT_TOKEN");
  }

  let statePath = null;
  if (typeof state !== "string" || !isAbsolute(state) || state.includes("\0")) {
    error("STATE", "required; use an absolute path");
  } else {
    statePath = resolve(state);
    const fromRepo = relative(resolve(repoRoot), statePath);
    if (!isAbsolute(fromRepo) && fromRepo !== ".." && !fromRepo.startsWith(`..${sep}`)) {
      error("STATE", "must be outside the repository after path resolution");
    }
  }
  if (rawPort !== undefined && (typeof rawPort !== "string" || !rawPort
      || /[^0-9]/u.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535)) {
    error("PORT", "must be an integer from 1 to 65535");
  }
  const notifications = {
    enabled: rootAgentId !== null,
    reason: rootAgentId === null ? "DECISION_DESK_ROOT_AGENT_ID: missing; notifications disabled" : null,
  };
  return {
    ok: errors.length === 0,
    config: errors.length ? null : { rootReceiptToken, webhookSecret, rootAgentId, statePath, port, notifications },
    errors,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== "--check") {
    console.error("Usage: node tools/denkraum/config.mjs --check");
    process.exitCode = 1;
  } else {
    const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
    const result = loadStartConfig(process.env, { repoRoot });
    for (const { name, reason } of result.errors) console.error(`${name}: ${reason}`);
    if (result.ok) {
      for (const suffix of ["ROOT_RECEIPT_TOKEN", "WEBHOOK_SECRET", "STATE", "PORT"]) {
        console.log(`DECISION_DESK_${suffix}: valid`);
      }
      console.log(result.config.notifications.reason ?? "DECISION_DESK_ROOT_AGENT_ID: notifications enabled");
    }
    process.exitCode = result.ok ? 0 : 1;
  }
}
