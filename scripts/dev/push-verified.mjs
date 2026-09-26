#!/usr/bin/env node
// SETUP-08a — push-verified: push HEAD, then prove it arrived. The exit code
// of `git push` is not evidence here (hooks and the Windows credential helper
// have reported 1 for pushes that landed, and 0 for pushes that did not);
// `git ls-remote` against the local HEAD is. Bounded retry, never
// --no-verify, never --force.
//
//   npm run dev:push-verified -- [--branch <name>] [--retries 3]
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { EXIT, UsageError, makeRunner, gitIn, isMain, runCli, withExitCodes, parseDuration, SLEEP } from "../lib/dev-tools.mjs";

const HELP = `push-verified — HEAD pushen und per ls-remote belegen

Aufruf:
  npm run dev:push-verified -- [Optionen]

Optionen:
  --worktree <pfad>  Arbeitsbaum (Standard: aktuelles Verzeichnis)
  --remote <name>    Remote (Standard: origin)
  --branch <name>    Ziel-Branch (Standard: der aktuelle Branch)
  --retries <n>      hoechstens n Push-Versuche (Standard: 3, 1..10)
  --delay <dauer>    Pause zwischen Versuchen (Standard: 5s)
  --help             diese Hilfe

Exit-Codes: 0 Remote-SHA == lokaler HEAD, 1 nicht belegt (oder abgelehnt), 2 Aufruffehler.
Der pre-push-Hook laeuft bei jedem Versuch; --no-verify und --force gibt es hier nicht.
Ein abgelehnter Push ([rejected], non-fast-forward) wird nicht wiederholt.
`;

const BRANCH = /^[A-Za-z0-9._/-]+$/;

// Generous per-call limits (M5): a push with hooks may take minutes, a mere
// ls-remote never may. The runner maps a killed call to exit code 124.
const PUSH_TIMEOUT_MS = 15 * 60_000;
const LS_REMOTE_TIMEOUT_MS = 120_000;

function remoteSha(run, cwd, remote, branch) {
  const r = run("git", ["-C", cwd, "ls-remote", remote, `refs/heads/${branch}`], { timeoutMs: LS_REMOTE_TIMEOUT_MS });
  if (r.code !== 0) return { sha: null, error: (r.stderr || r.stdout).trim() };
  const line = r.stdout.split(/\r?\n/).find((l) => l.endsWith(`\trefs/heads/${branch}`));
  return { sha: line ? line.split("\t")[0] : null, error: null };
}

// Not `async` on purpose: argument and precondition violations (UsageError)
// throw synchronously, so callers and tests see them without awaiting.
export function pushVerified({ run, cwd, remote = "origin", branch, retries = 3, delayMs = 5000, sleep = SLEEP, log = () => {} }) {
  const git = gitIn(run, cwd);
  const local = git.ok("rev-parse", "HEAD").trim();
  const sym = branch ? null : git("symbolic-ref", "--short", "HEAD");
  const target = branch || (sym.code === 0 ? sym.stdout.trim() : "");
  if (!target) throw new UsageError("Detached HEAD: --branch <name> ist erforderlich");
  if (!BRANCH.test(target) || target.startsWith("-")) throw new UsageError(`Branch-Name unzulaessig: ${target}`);
  if (git("check-ref-format", "--branch", target).code !== 0) {
    throw new UsageError(`Branch-Name unzulaessig (git check-ref-format): ${target}`);
  }
  return attemptPush({ run, cwd, remote, target, local, retries, delayMs, sleep, log });
}

async function attemptPush({ run, cwd, remote, target, local, retries, delayMs, sleep, log }) {
  let last = { sha: null, error: null };
  let reason = "";
  for (let attempt = 1; attempt <= retries; attempt++) {
    const push = run("git", ["-C", cwd, "push", remote, `HEAD:refs/heads/${target}`], { timeoutMs: PUSH_TIMEOUT_MS });
    last = remoteSha(run, cwd, remote, target);
    log(`Versuch ${attempt}: push-exit=${push.code} remote=${last.sha ? last.sha.slice(0, 7) : "-"} lokal=${local.slice(0, 7)}\n`);
    if (last.sha === local) return { ok: true, attempts: attempt, localSha: local, remoteSha: last.sha, branch: target };
    const text = `${push.stdout}\n${push.stderr}`;
    if (/\[(remote )?rejected\]/.test(text)) {
      reason = `rejected: ${text.split(/\r?\n/).find((l) => /rejected/.test(l))?.trim()}`;
      log(`${reason}\nKein weiterer Versuch: ein abgelehnter Push wird durch Wiederholen nicht besser.\n`);
      return { ok: false, attempts: attempt, localSha: local, remoteSha: last.sha, branch: target, reason };
    }
    reason = last.error ? `ls-remote: ${last.error}` : "Remote-SHA weicht vom lokalen HEAD ab";
    const tail = text.trim().split(/\r?\n/).slice(-5).join("\n");
    if (tail) log(`${tail}\n`);
    if (attempt < retries) await sleep(delayMs);
  }
  return { ok: false, attempts: retries, localSha: local, remoteSha: last.sha, branch: target, reason };
}

export const main = withExitCodes(async (argv, io, deps) => {
  const { values } = parseArgs({
    args: argv,
    options: {
      worktree: { type: "string" },
      remote: { type: "string" },
      branch: { type: "string" },
      retries: { type: "string" },
      delay: { type: "string" },
      help: { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) {
    io.out(HELP);
    return EXIT.OK;
  }
  const retries = values.retries === undefined ? 3 : Number(values.retries);
  if (!Number.isInteger(retries) || retries < 1 || retries > 10) throw new UsageError("--retries erwartet 1..10");
  const res = await pushVerified({
    run: deps.run || makeRunner(),
    cwd: resolve(values.worktree || process.cwd()),
    remote: values.remote || "origin",
    branch: values.branch,
    retries,
    delayMs: values.delay ? parseDuration(values.delay) : 5000,
    sleep: deps.sleep,
    log: io.out,
  });
  if (res.ok) {
    io.out(`belegt: ${res.branch} = ${res.remoteSha}\n`);
    return EXIT.OK;
  }
  io.err(`NICHT belegt: ${res.branch} (${res.reason})\n`);
  return EXIT.FAIL;
});

if (isMain(import.meta.url)) runCli(main);
