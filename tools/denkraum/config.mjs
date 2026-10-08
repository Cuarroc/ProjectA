import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { lstatSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { validId } from "./store/model.mjs";

const isInside = (root, path) => {
  const fromRoot = relative(root, path);
  return !isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`);
};
function physicalAncestor(path) {
  for (;;) {
    try { return realpathSync(path); }
    catch (error) {
      if (error.code !== "ENOENT" || dirname(path) === path) throw error;
      // An existing broken link is not an absent directory: do not skip it.
      if (lstatSync(path, { throwIfNoEntry: false })) throw error;
      path = dirname(path);
    }
  }
}

// Read-only preflight; no server start or secret-source assumptions.
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
  if (rootAgentId === null) error("ROOT_AGENT_ID", "required");
  else if (!validId(rootAgentId) || rootAgentId !== rootAgentId.trim()) {
    error("ROOT_AGENT_ID", "use 1–80 letters, digits, underscores or hyphens; start with a letter or digit");
  }

  let statePath = null;
  if (typeof state !== "string" || !isAbsolute(state) || state.includes("\0")) {
    error("STATE", "required; use an absolute path");
  } else {
    statePath = resolve(state);
    if (process.platform === "win32" && statePath.startsWith("\\\\")) {
      error("STATE", "Windows namespace and UNC state paths are not supported");
    } else if (isInside(resolve(repoRoot), statePath)) {
      error("STATE", "must be outside the repository after path resolution");
    } else {
      try {
        if (isInside(realpathSync(repoRoot), physicalAncestor(statePath))) {
          error("STATE", "must be outside the repository after physical path resolution");
        }
      } catch {
        error("STATE", "physical path resolution failed");
      }
    }
  }
  if (rawPort !== undefined && (typeof rawPort !== "string" || !rawPort
      || /[^0-9]/u.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535)) {
    error("PORT", "must be an integer from 1 to 65535");
  }
  const notifications = { enabled: true, reason: null };
  return {
    ok: errors.length === 0,
    config: errors.length ? null : { rootReceiptToken, webhookSecret, rootAgentId, statePath, port, notifications },
    errors,
  };
}

let isCliEntry = import.meta.main;
// Node 24.0/24.1 lack import.meta.main; resolve the CLI entry for those versions.
if (isCliEntry === undefined && process.argv[1]
    && !process.execArgv.some((arg) => /^(?:--(?:eval|print)(?:=|$)|-[ep])/u.test(arg))) {
  try {
    isCliEntry = createRequire(import.meta.url).resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    isCliEntry = false;
  }
}
if (isCliEntry) {
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
