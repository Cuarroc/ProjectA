#!/usr/bin/env node
// W5-28: the automatic runtime proof. Starts the real app twice in a
// sandbox — its own PROJECTA_APP_DATA, the queue switched off with
// PROJECTA_QUEUE=off — and proves the M1 acceptance: the app starts, and
// old queued tasks dispatch no agents. No provider CLI is ever called:
// the dispatcher never starts, and the seeded tasks stay `ready`.
//
//   node scripts/runtime-proof.mjs [--exe path] [--root dir]
//         [--settle seconds] [--keep n] [--no-screenshot] [--help]
//
// Phase 1 seeds two queue entries through the control api; phase 2 restarts
// the app on the same data directory — the "old jobs" case — and, after
// more than two dispatcher periods (POLL_INTERVAL is 30 s), asserts through
// the api that every entry is still `ready` and no worker exists. The proof
// (proof.json, the app log, a window screenshot) lands in one run directory
// under the proof root; only the newest KEEP_RUNS runs survive.
//
// Local/test only. The single-instance mutex is shared with production, so
// the proof refuses to run while any projecta.exe is alive.
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KEEP_RUNS,
  evaluateProof,
  proofLayout,
  runStamp,
  selectRunsToDelete,
} from './lib/runtime-proof-lib.mjs';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DESCRIPTOR_TIMEOUT_MS = 60_000;
const DEFAULT_SETTLE_S = 70;

export function parseArgs(argv = []) {
  const options = { exe: null, root: null, settle: DEFAULT_SETTLE_S, keep: KEEP_RUNS, screenshot: true, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--no-screenshot') options.screenshot = false;
    else if (arg === '--exe') options.exe = argv[++i];
    else if (arg === '--root') options.root = argv[++i];
    else if (arg === '--settle') options.settle = Number(argv[++i]);
    else if (arg === '--keep') options.keep = Number(argv[++i]);
    else throw new Error(`unknown option: ${arg}`);
  }
  if (options.exe === undefined || options.root === undefined) throw new Error('missing value after a flag');
  if (!Number.isFinite(options.settle) || options.settle < 1) throw new Error('--settle must be seconds >= 1');
  if (!Number.isSafeInteger(options.keep) || options.keep < 1) throw new Error('--keep must be a positive integer');
  return options;
}

export function usage() {
  return 'usage: node scripts/runtime-proof.mjs [--exe path] [--root dir] [--settle seconds] [--keep n] [--no-screenshot]';
}

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function projectaPids() {
  if (process.platform === 'win32') {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq projecta.exe', '/NH', '/FO', 'CSV'], { encoding: 'utf8' });
    return [...out.matchAll(/"projecta\.exe","(\d+)"/gi)].map((match) => Number(match[1]));
  }
  try {
    const out = execFileSync('pgrep', ['-x', 'projecta'], { encoding: 'utf8' });
    return out.split('\n').filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

function killProjectA(pid) {
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

async function waitGone(pid, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!projectaPids().includes(pid)) return;
    await sleep(200);
  }
  throw new Error(`projecta.exe pid ${pid} did not exit within ${timeoutMs} ms`);
}

function resolveExe(requested) {
  const candidates = [
    requested,
    process.env.PROJECTA_EXE,
    join(REPO, 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'projecta.exe' : 'projecta'),
    join(REPO, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'projecta.exe' : 'projecta'),
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`no projecta binary found; build first (cargo build in src-tauri) or pass --exe`);
  return found;
}

function startApp(exe, layout, phase) {
  const out = openSync(join(layout.runDir, `app-${phase}.stdout.log`), 'w');
  const err = openSync(join(layout.runDir, `app-${phase}.stderr.log`), 'w');
  const child = spawn(exe, [], {
    env: { ...process.env, PROJECTA_APP_DATA: layout.appData, PROJECTA_QUEUE: 'off' },
    stdio: ['ignore', out, err],
  });
  closeSync(out);
  closeSync(err);
  return child;
}

async function waitDescriptor(layout, timeoutMs = DESCRIPTOR_TIMEOUT_MS) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(layout.descriptor)) {
      return { descriptorMs: Date.now() - started, descriptor: JSON.parse(readFileSync(layout.descriptor, 'utf8')) };
    }
    await sleep(250);
  }
  return { descriptorMs: null, descriptor: null };
}

async function api(descriptor, method, path, body) {
  const response = await fetch(`http://127.0.0.1:${descriptor.port}${path}`, {
    method,
    headers: { 'x-projecta-token': descriptor.token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* the error body is plain text */ }
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${parsed?.error ?? text}`);
  return parsed;
}

function takeScreenshot(layout) {
  const helper = join(REPO, 'scripts', 'window-shot.ps1');
  if (process.platform !== 'win32' || !existsSync(helper)) return { ok: false, reason: 'screenshot helper is Windows-only' };
  try {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Title', 'ProjectA', '-ProcessName', 'projecta', '-Out', layout.screenshot], { stdio: 'pipe' });
    return { ok: existsSync(layout.screenshot), path: layout.screenshot };
  } catch (error) {
    return { ok: false, reason: String(error.stderr ?? error.message).trim().slice(0, 300) };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const running = projectaPids();
  if (running.length > 0) throw new Error(`projecta already running (pids ${running.join(',')}); the single-instance mutex is shared — close it first`);

  const exe = resolveExe(options.exe);
  const root = options.root ?? process.env.PROJECTA_PROOF_DIR ?? join(tmpdir(), 'projecta-runtime-proof');
  const layout = proofLayout(root, runStamp());
  mkdirSync(layout.appData, { recursive: true });
  mkdirSync(layout.scratchRepo, { recursive: true });
  execFileSync('git', ['init', layout.scratchRepo], { stdio: 'ignore' });

  const proof = {
    schemaVersion: 1,
    package: 'W5-28',
    startedAt: new Date().toISOString(),
    exe,
    platform: process.platform,
    queue: 'off (PROJECTA_QUEUE=off)',
    appData: layout.appData,
    settleSeconds: options.settle,
    phase1: {},
    phase2: {},
  };

  let child = null;
  try {
    // Phase 1: the app starts; two old queue entries are seeded.
    child = startApp(exe, layout, 1);
    const first = await waitDescriptor(layout);
    if (!first.descriptor) throw new Error(`phase 1: no api descriptor within ${DESCRIPTOR_TIMEOUT_MS / 1000} s`);
    proof.phase1 = { descriptorMs: first.descriptorMs, port: first.descriptor.port };
    const project = await api(first.descriptor, 'POST', '/api/projects', { name: 'runtime-proof', repoPath: layout.scratchRepo });
    const projectId = project.id ?? project.project?.id;
    if (!projectId) throw new Error(`phase 1: POST /api/projects returned no id: ${JSON.stringify(project).slice(0, 200)}`);
    await api(first.descriptor, 'POST', '/api/queue', { projectId, rawText: 'proof task A — never dispatched', sharpen: false });
    await api(first.descriptor, 'POST', '/api/queue', { projectId, rawText: 'proof task B — never dispatched', sharpen: false });
    const seeded = await api(first.descriptor, 'GET', `/api/queue?projectId=${encodeURIComponent(projectId)}`);
    proof.phase1.seeded = Array.isArray(seeded) ? seeded.length : 0;
    proof.phase1.projectId = projectId;
    killProjectA(child.pid);
    await waitGone(child.pid);
    child = null;
    // The restart mints a fresh token and port: the stale descriptor must
    // not satisfy phase 2's wait, or the proof would read a dead api.
    rmSync(layout.descriptor, { force: true });

    // Phase 2: the restart faces the old entries; past two sweep intervals
    // nothing may have dispatched.
    child = startApp(exe, layout, 2);
    const second = await waitDescriptor(layout);
    if (!second.descriptor) throw new Error(`phase 2: no api descriptor within ${DESCRIPTOR_TIMEOUT_MS / 1000} s on restart`);
    proof.phase2.descriptorMs = second.descriptorMs;
    await sleep(options.settle * 1000);
    const entries = await api(second.descriptor, 'GET', `/api/queue?projectId=${encodeURIComponent(projectId)}`);
    const workers = await api(second.descriptor, 'GET', `/api/workers?projectId=${encodeURIComponent(projectId)}`);
    proof.phase2.entries = (Array.isArray(entries) ? entries : []).map((entry) => ({ id: entry.id, status: entry.status }));
    proof.phase2.workers = Array.isArray(workers) ? workers : [];
    proof.screenshot = options.screenshot ? takeScreenshot(layout) : { ok: false, reason: '--no-screenshot' };
    killProjectA(child.pid);
    await waitGone(child.pid);
    child = null;
  } finally {
    if (child) {
      try { killProjectA(child.pid); } catch { /* already gone */ }
    }
  }

  const logSource = join(layout.appData, 'logs', 'projecta.log');
  const logText = existsSync(logSource) ? readFileSync(logSource, 'utf8') : '';
  if (existsSync(logSource)) copyFileSync(logSource, layout.appLog);

  const verdict = evaluateProof({
    phase1: { descriptorSeen: Number.isFinite(proof.phase1.descriptorMs), seeded: proof.phase1.seeded },
    phase2: { descriptorSeen: Number.isFinite(proof.phase2.descriptorMs), entries: proof.phase2.entries, workers: proof.phase2.workers },
    logText,
    screenshot: proof.screenshot,
    requireScreenshot: options.screenshot,
  });
  proof.verdict = verdict;
  proof.finishedAt = new Date().toISOString();
  writeFileSync(layout.proofJson, `${JSON.stringify(proof, null, 2)}\n`);

  const siblings = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  for (const old of selectRunsToDelete(siblings, options.keep)) {
    rmSync(join(root, old), { recursive: true, force: true });
  }

  console.log(`proof: ${verdict.ok ? 'PASS' : 'FAIL'} — ${layout.proofJson}`);
  for (const failure of verdict.failures) console.log(`  - ${failure}`);
  console.log(`runs kept under ${root}: ${Math.min(siblings.length, options.keep)} of ${siblings.length}`);
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`runtime-proof: ${error.message}`);
    process.exitCode = 1;
  });
}
