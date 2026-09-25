// scripts/lib/dev-tools.mjs — shared plumbing for the scripts/dev/* helpers
// (SETUP-B). Every external program is started through a runner that takes
// an argument ARRAY (spawnSync without a shell): no command strings, no
// quoting bugs, identical on Windows and Linux. Tests inject a fake runner.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// Exit codes shared by all dev helpers (documented in scripts/dev/README.md).
export const EXIT = Object.freeze({
  OK: 0, // done / everything green
  FAIL: 1, // the checked result is negative (push not on remote, CI red, findings with --strict)
  USAGE: 2, // wrong arguments
  REFUSED: 3, // precondition not met, nothing was changed (dirty tree, PR not merged, ...)
  TIMEOUT: 4, // bounded wait ran out
});

export class UsageError extends Error {}
export class RefusedError extends Error {}

// Variables that would silently redirect `git -C <path>` to another
// repository (a hook environment sets them). gates.sh strips the same list.
const GIT_REDIRECTS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"];

export function cleanEnv(base = process.env) {
  const env = { ...base };
  for (const name of GIT_REDIRECTS) delete env[name];
  // No credential-helper GUI and no terminal prompt may ever block a helper:
  // git asks nobody, the Git Credential Manager answers "never" (M5).
  env.GIT_TERMINAL_PROMPT = "0";
  env.GCM_INTERACTIVE = "never";
  return env;
}

// run(cmd, args, {cwd, input, timeoutMs}) -> {code, stdout, stderr}. Never
// throws for a non-zero exit: callers decide. A missing program yields code
// 127, a killed time-out yields 124 (like GNU timeout). The default is no
// time limit (timeoutMs 0) — pre-push hooks legitimately run for minutes;
// callers that talk to the network pass an explicit per-call limit.
export function makeRunner({ env = cleanEnv(), timeoutMs = 0 } = {}) {
  return function run(cmd, args = [], opts = {}) {
    const limit = opts.timeoutMs ?? timeoutMs;
    const r = spawnSync(cmd, args, {
      cwd: opts.cwd,
      env,
      input: opts.input,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: limit,
      windowsHide: true,
    });
    if (r.error && r.error.code === "ENOENT") return { code: 127, stdout: "", stderr: `${cmd}: nicht gefunden` };
    if (r.error && r.error.code === "ETIMEDOUT") {
      return { code: 124, stdout: r.stdout || "", stderr: `${cmd}: Zeitlimit ueberschritten (${limit} ms)` };
    }
    if (r.error) return { code: 1, stdout: r.stdout || "", stderr: String(r.error.message || r.error) };
    return { code: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" };
  };
}

// git(cwd)(...args) -> result; gitOk throws a readable error on failure.
export function gitIn(run, cwd) {
  const git = (...args) => run("git", ["-C", cwd, ...args]);
  git.ok = (...args) => {
    const r = git(...args);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")} (Exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
    return r.stdout;
  };
  return git;
}

// gh with JSON output; throws on failure or unparsable output.
export function ghJson(run, args, { cwd } = {}) {
  const r = run("gh", args, { cwd });
  if (r.code !== 0 && !r.stdout.trim().startsWith("[") && !r.stdout.trim().startsWith("{")) {
    throw new Error(`gh ${args.join(" ")} (Exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  }
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(`gh ${args.join(" ")}: keine gueltige JSON-Ausgabe`);
  }
}

// "90s", "45m", "2h", "500ms" or plain seconds -> milliseconds.
export function parseDuration(text) {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(text).trim());
  if (!m) throw new UsageError(`Dauer nicht lesbar: ${text} (Beispiele: 30s, 45m, 2h)`);
  const n = Number(m[1]);
  const unit = m[2] || "s";
  return Math.round(n * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit]);
}

// A number as Windows prints it in a German locale ("3,25") or as C prints it
// ("3.25"). Thousands separators are not expected (callers pass plain values).
export function parseLocaleNumber(text) {
  const t = String(text).trim().replace(/\s/g, "");
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return NaN;
  return Number(t.replace(",", "."));
}

export function isMain(importMetaUrl) {
  return Boolean(process.argv[1]) && importMetaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

// Wraps a CLI body so that thrown errors become exit codes: UsageError and
// node:util parseArgs errors -> 2, RefusedError -> 3, anything else -> 1.
export function withExitCodes(body) {
  return async function main(argv, io, deps = {}) {
    try {
      return (await body(argv, io, deps)) ?? EXIT.OK;
    } catch (e) {
      if (e instanceof UsageError || String(e?.code || "").startsWith("ERR_PARSE_ARGS")) {
        io.err(`Fehler: ${e.message}\n(--help zeigt die Aufrufe)\n`);
        return EXIT.USAGE;
      }
      if (e instanceof RefusedError) {
        io.err(`Abgelehnt: ${e.message}\n`);
        return EXIT.REFUSED;
      }
      io.err(`Fehler: ${e?.message || e}\n`);
      return EXIT.FAIL;
    }
  };
}

export async function runCli(main, argv = process.argv.slice(2)) {
  const io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) };
  process.exitCode = await main(argv, io);
}

export const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
