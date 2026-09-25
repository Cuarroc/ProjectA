# Review request W5-28: automatic runtime proof (sandbox, queue off)

You are an independent reviewer (not the author; the author is a Kimi model).
Review the diff below for correctness bugs, gaps against the requirements,
and safety regressions. Be concrete: cite file and line, say what breaks and
when. Rate each finding high/medium/low. Do not restate the diff. If
something is fine, say nothing about it. Answer in English or German.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal" (Rust backend in src-tauri/,
public GitHub repo). The app holds a persistent task queue in SQLite; a
dispatcher thread (queue::start, POLL_INTERVAL 30 s) turns ready queue
entries into agent workers. At startup a reattach pass resolves interrupted
claims back to ready but never spawns. The single-instance guard is a mutex
named "<bundle identifier>-sim" (tauri-plugin-single-instance).
PROJECTA_APP_DATA redirects the app data dir (db, log, api descriptor) and
already exists for isolated proof runs. The control api serves
127.0.0.1 with a token from <appdata>/projecta-api.json; POST /api/projects
needs no verdict token when PROJECTA_APP_DATA is set.

## Package requirement (plan wording, translated)

W5-28 "automatic runtime proof": a reproducible local run in a sandbox (own
data directory, queue off) that proves the app starts and no old queued jobs
dispatch agents (automating the "M1" acceptance). Red criterion: the proof is
produced without a real worker starting; a retention limit on proof artifacts
applies. Local/test only; never call real provider CLIs.

## What the candidate does

1. src-tauri/src/queue.rs: PROJECTA_QUEUE=off (or 0/false) makes queue::start
   log a line and return before spawning the dispatcher thread. Unit tests
   pin the evaluation.
2. scripts/runtime-proof.mjs (npm run proof:runtime): refuses while any
   projecta.exe runs (shared mutex) unless --parallel-ok (meant for binaries
   built with TAURI_CONFIG identifier override); phase 1 starts the app with
   PROJECTA_APP_DATA=<run>/appdata and PROJECTA_QUEUE=off, waits for the api
   descriptor, creates a scratch git repo project and seeds two queue
   entries; phase 2 deletes the stale descriptor, restarts on the same
   appdata, waits 70 s (> 2 sweeps), then asserts via the api: entries still
   ready, zero workers; the app log must contain the disabled line; a window
   screenshot is taken; proof.json + log + screenshot land in one run dir;
   only the 10 newest runs are kept (retention).
3. scripts/lib/runtime-proof-lib.mjs: pure layout/verdict/retention
   functions with node:test coverage (7 tests).
4. scripts/window-shot.ps1: gains -TargetPid (two same-titled windows:
   production + proof) and a PrintWindow fallback when the foreground lock
   denies SetForegroundWindow from a background console.
5. src-tauri/src/skills.rs: pure rustfmt re-wrap (the published squash
   c60f267 fails cargo fmt --check with stable rustfmt 1.9; this blocked the
   precommit lane for any src-tauri commit).

## Verified evidence the author claims

- cargo test queue_dispatch_disabled: red at exit 101 before the function
  existed, green after (2 passed).
- node --test scripts/lib/runtime-proof-lib.test.mjs: 7/7 green, exit 0.
- Live proof run with a debug binary built under identifier
  com.projecta.proof (TAURI_CONFIG), production app running the whole time:
  exit 0, proof.json shows descriptorMs 1048/781, 2 seeded entries still
  ready after 70 s, workers [], screenshot ok.

## Questions to answer explicitly

- Does PROJECTA_QUEUE=off really close every path by which an old queue
  entry could reach an agent at startup or later (reattach, claim release,
  other threads)? Anything in the diff that re-opens one?
- Can the driver mistake a stale descriptor, a dead app or a failed seed for
  a pass? Is the verdict function too weak (false PASS) anywhere?
- --parallel-ok and the TAURI_CONFIG identifier override: can this endanger
  the production instance or its data? Is the default (refuse) safe?
- Retention: can selectRunsToDelete/rmSync delete anything outside the proof
  root? Path traversal, symlink, non-run directories under root?
- window-shot.ps1: can the Alt-stroke or PrintWindow fallback produce a
  false or misleading artifact? Any abuse of the production window?
- The rustfmt re-wrap of skills.rs riding along: acceptable or should it be
  rejected?

## Candidate

HEAD 870ba09 (branch claude/w5-28), diff against origin/main:

```diff
diff --git a/docs/decisions.md b/docs/decisions.md
index 091ca6c..6be5287 100644
--- a/docs/decisions.md
+++ b/docs/decisions.md
@@ -1352,3 +1352,20 @@ minutes are billed twice on private repos, so Windows alone was ~2850 of
   `scripts/test-red-first-landed.sh` (gate `selftest-red-first`). Reverse
   when: trailers on main stop being gated by red-first (then a trailer there
   would no longer prove anything).
+
+## 2026-09-25 - W5-28: PROJECTA_QUEUE=off und der automatische Laufzeit-Beleg
+
+- `PROJECTA_QUEUE=off` (auch `0`/`false`) laesst `queue::start` vor dem
+  Dispatcher-Thread aussteigen; die App startet sonst vollstaendig — W5-28
+  braucht einen Lauf, in dem alte Queue-Eintraege nachweislich keinen Agenten
+  erreichen, und ein per Sweep gelesener Schalter liesse den Thread
+  weiterlaufen (Beleg im Log statt im Prozessbild) — Zurücknehmen: wenn der
+  Dispatcher selbst einen persistierten Not-Aus bekommt (W5-31b), der Schalter
+  ist bewusst prozesslokal und ohne DB-Zustand.
+- `scripts/runtime-proof.mjs` (npm run proof:runtime) faehrt den Beleg lokal:
+  eigener `PROJECTA_APP_DATA`-Sandbox, zwei Starts, zwei alte Queue-Eintraege,
+  Verdikt aus API-Auskunft (Eintraege `ready`, keine Worker) plus Logzeile und
+  Screenshot, Aufbewahrung der zehn juengsten Laeufe — die M1-Abnahme war
+  manuell und damit nicht wiederholbar — Zurücknehmen: nie das Verdikt als
+  Funktion; der Treiber darf durch einen `pa`-Unterbefehl ersetzt werden,
+  sobald der Daemon (W5-31b) die Sandboxes selbst verwaltet.
diff --git a/package.json b/package.json
index 8a936a0..effa387 100644
--- a/package.json
+++ b/package.json
@@ -30,7 +30,8 @@
     "test:hq:visual": "node --test scripts/lib/hq-visual.browser.mjs",
     "tauri": "tauri",
     "hq:lesson": "node scripts/hq-lesson.mjs",
-    "hq:queue-open-points": "node scripts/hq-queue-open-points.mjs"
+    "hq:queue-open-points": "node scripts/hq-queue-open-points.mjs",
+    "proof:runtime": "node scripts/runtime-proof.mjs"
   },
   "dependencies": {
     "@tauri-apps/api": "^2.1.1",
diff --git a/scripts/lib/runtime-proof-lib.mjs b/scripts/lib/runtime-proof-lib.mjs
new file mode 100644
index 0000000..b931162
--- /dev/null
+++ b/scripts/lib/runtime-proof-lib.mjs
@@ -0,0 +1,63 @@
+// W5-28: the pure decisions behind scripts/runtime-proof.mjs — sandbox
+// layout, the pass/fail verdict, and the retention limit on proof runs.
+// Everything here is free of I/O so node:test can pin it down.
+import { join } from 'node:path';
+
+/// How many proof runs stay on disk; older ones are deleted (the plan's
+// retention limit, so screenshots and logs cannot grow without bound).
+export const KEEP_RUNS = 10;
+
+// The log line the app writes when the dispatcher is switched off
+// (PROJECTA_QUEUE=off, src-tauri/src/queue.rs). The verdict demands it:
+// without the line, "nothing dispatched" could also mean "the dispatcher
+// never looked", and the proof would say nothing about the switch.
+export const DISPATCH_DISABLED_LOG = 'queue dispatcher disabled';
+
+// Filename-safe UTC stamp that sorts like time ('2026-09-25T10-00-00.000Z').
+export function runStamp(date = new Date()) {
+  return date.toISOString().replace(/:/g, '-');
+}
+
+// Every artifact of one run lives under its own directory, so a run can be
+// deleted as one unit and no two runs ever share a file.
+export function proofLayout(root, stamp) {
+  const runDir = join(root, stamp);
+  return {
+    runDir,
+    appData: join(runDir, 'appdata'),
+    scratchRepo: join(runDir, 'scratch-repo'),
+    descriptor: join(runDir, 'appdata', 'projecta-api.json'),
+    proofJson: join(runDir, 'proof.json'),
+    appLog: join(runDir, 'projecta.log'),
+    screenshot: join(runDir, 'window.png'),
+  };
+}
+
+// The M1 acceptance as a pure function over the facts the driver collected:
+// the app started (twice, so the second start faced old queue entries),
+// every seeded entry stayed ready, no worker exists, the log proves the
+// switch was honored, and — when required — the window was photographed.
+export function evaluateProof({ phase1, phase2, logText, screenshot, requireScreenshot }) {
+  const failures = [];
+  if (!phase1?.descriptorSeen) failures.push('phase 1: the app never published its api descriptor');
+  if (!phase2?.descriptorSeen) failures.push('phase 2: the restart never published its api descriptor');
+  if (!phase1?.seeded) failures.push('phase 1: no old queue entries were seeded, the proof is empty');
+  for (const entry of phase2?.entries ?? []) {
+    if (entry.status !== 'ready') failures.push(`queue entry ${entry.id} left ready: ${entry.status}`);
+  }
+  if ((phase2?.workers ?? []).length > 0) failures.push(`${phase2.workers.length} worker(s) exist after the restart`);
+  if (!(logText ?? '').includes(DISPATCH_DISABLED_LOG)) {
+    failures.push(`the app log lacks "${DISPATCH_DISABLED_LOG}" — the queue-off switch is unproven`);
+  }
+  if (requireScreenshot && !screenshot?.ok) {
+    failures.push(`screenshot failed: ${screenshot?.reason ?? 'not attempted'}`);
+  }
+  return { ok: failures.length === 0, failures };
+}
+
+// Retention: names sort like time (runStamp), so the newest `keep` survive
+// and the rest are returned for deletion.
+export function selectRunsToDelete(runNames, keep = KEEP_RUNS) {
+  if (!Number.isSafeInteger(keep) || keep < 1) throw new Error(`keep must be a positive integer, got ${keep}`);
+  return [...runNames].sort().reverse().slice(keep);
+}
diff --git a/scripts/lib/runtime-proof-lib.test.mjs b/scripts/lib/runtime-proof-lib.test.mjs
new file mode 100644
index 0000000..112a519
--- /dev/null
+++ b/scripts/lib/runtime-proof-lib.test.mjs
@@ -0,0 +1,102 @@
+// W5-28: pins the pure decisions of scripts/runtime-proof.mjs — sandbox
+// layout, the pass/fail verdict, and the retention limit on proof runs.
+import test from 'node:test';
+import assert from 'node:assert/strict';
+import { join } from 'node:path';
+import {
+  DISPATCH_DISABLED_LOG,
+  KEEP_RUNS,
+  evaluateProof,
+  proofLayout,
+  runStamp,
+  selectRunsToDelete,
+} from './runtime-proof-lib.mjs';
+
+const goodFacts = () => ({
+  phase1: { descriptorSeen: true, seeded: 2 },
+  phase2: {
+    descriptorSeen: true,
+    entries: [
+      { id: 'tq-1', status: 'ready' },
+      { id: 'tq-2', status: 'ready' },
+    ],
+    workers: [],
+  },
+  logText: `line\nprojecta ${DISPATCH_DISABLED_LOG} (PROJECTA_QUEUE=off)\nline`,
+  screenshot: { ok: true, path: 'shot.png' },
+  requireScreenshot: true,
+});
+
+test('layout keeps every artifact of a run inside its run directory', () => {
+  const stamp = '2026-09-25T10-00-00.000Z';
+  const layout = proofLayout('/proofs', stamp);
+  const runDir = join('/proofs', stamp);
+  assert.equal(layout.runDir, runDir);
+  for (const value of Object.values(layout)) {
+    assert.ok(value.startsWith(runDir), `${value} escapes the run directory`);
+  }
+  assert.equal(new Set(Object.values(layout)).size, Object.values(layout).length);
+});
+
+test('run stamp sorts lexicographically like time and is filename-safe', () => {
+  const a = runStamp(new Date('2026-09-25T10:00:00.000Z'));
+  const b = runStamp(new Date('2026-09-25T10:00:01.000Z'));
+  assert.ok(a < b);
+  assert.match(a, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/);
+});
+
+test('verdict passes only when the app started twice and nothing dispatched and the log proves the switch', () => {
+  const verdict = evaluateProof(goodFacts());
+  assert.equal(verdict.ok, true);
+  assert.deepEqual(verdict.failures, []);
+});
+
+test('verdict fails when a queued entry left ready or a worker exists', () => {
+  const dispatched = goodFacts();
+  dispatched.phase2.entries[0].status = 'dispatched';
+  assert.equal(evaluateProof(dispatched).ok, false);
+  const spawned = goodFacts();
+  spawned.phase2.workers = [{ id: 'wk-1' }];
+  assert.equal(evaluateProof(spawned).ok, false);
+  const unseeded = goodFacts();
+  unseeded.phase1.seeded = 0;
+  assert.equal(evaluateProof(unseeded).ok, false);
+});
+
+test('verdict fails without the disabled log line or a start or a required screenshot', () => {
+  const noLog = goodFacts();
+  noLog.logText = 'nothing relevant';
+  assert.equal(evaluateProof(noLog).ok, false);
+  const noRestart = goodFacts();
+  noRestart.phase2.descriptorSeen = false;
+  assert.equal(evaluateProof(noRestart).ok, false);
+  const noShot = goodFacts();
+  noShot.screenshot = { ok: false, reason: 'window not foreground' };
+  assert.equal(evaluateProof(noShot).ok, false);
+  const optionalShot = goodFacts();
+  optionalShot.screenshot = { ok: false, reason: 'window not foreground' };
+  optionalShot.requireScreenshot = false;
+  assert.equal(evaluateProof(optionalShot).ok, true);
+});
+
+test('retention keeps the newest runs and deletes the rest', () => {
+  const names = ['2026-09-20T00-00-00.000Z', '2026-09-25T09-00-00.000Z', '2026-09-25T10-00-00.000Z'];
+  assert.deepEqual(selectRunsToDelete(names, 2), ['2026-09-20T00-00-00.000Z']);
+  assert.deepEqual(selectRunsToDelete(names, KEEP_RUNS), []);
+  assert.deepEqual(selectRunsToDelete([], KEEP_RUNS), []);
+  assert.throws(() => selectRunsToDelete(names, 0), /keep/);
+});
+
+test('driver parses its flags and rejects unknown ones and bad values', async () => {
+  const { parseArgs } = await import('../runtime-proof.mjs');
+  const options = parseArgs(['--exe', 'app.exe', '--settle', '5', '--no-screenshot', '--parallel-ok']);
+  assert.equal(options.exe, 'app.exe');
+  assert.equal(options.settle, 5);
+  assert.equal(options.screenshot, false);
+  assert.equal(options.parallelOk, true);
+  assert.equal(parseArgs([]).screenshot, true);
+  assert.equal(parseArgs([]).parallelOk, false);
+  assert.throws(() => parseArgs(['--bogus']), /unknown option/);
+  assert.throws(() => parseArgs(['--settle', '0']), /settle/);
+  assert.throws(() => parseArgs(['--keep', '0']), /keep/);
+});
diff --git a/scripts/runtime-proof.mjs b/scripts/runtime-proof.mjs
new file mode 100644
index 0000000..f1f0832
--- /dev/null
+++ b/scripts/runtime-proof.mjs
@@ -0,0 +1,264 @@
+#!/usr/bin/env node
+// W5-28: the automatic runtime proof. Starts the real app twice in a
+// sandbox — its own PROJECTA_APP_DATA, the queue switched off with
+// PROJECTA_QUEUE=off — and proves the M1 acceptance: the app starts, and
+// old queued tasks dispatch no agents. No provider CLI is ever called:
+// the dispatcher never starts, and the seeded tasks stay `ready`.
+//
+//   node scripts/runtime-proof.mjs [--exe path] [--root dir]
+//         [--settle seconds] [--keep n] [--no-screenshot] [--help]
+//
+// Phase 1 seeds two queue entries through the control api; phase 2 restarts
+// the app on the same data directory — the "old jobs" case — and, after
+// more than two dispatcher periods (POLL_INTERVAL is 30 s), asserts through
+// the api that every entry is still `ready` and no worker exists. The proof
+// (proof.json, the app log, a window screenshot) lands in one run directory
+// under the proof root; only the newest KEEP_RUNS runs survive.
+//
+// Local/test only. The single-instance mutex is shared with production, so
+// the proof refuses to run while any projecta.exe is alive — unless
+// `--parallel-ok` is passed, which is only valid for a binary built with a
+// distinct bundle identifier, e.g.
+//   TAURI_CONFIG='{"identifier":"com.projecta.proof"}' cargo build
+// Such a proof binary owns no shared state with production (own mutex, own
+// PROJECTA_APP_DATA, ephemeral ports), so the refusal would protect nothing.
+import { spawn, execFileSync } from 'node:child_process';
+import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, openSync, closeSync } from 'node:fs';
+import { tmpdir } from 'node:os';
+import { join, resolve } from 'node:path';
+import { fileURLToPath } from 'node:url';
+import {
+  KEEP_RUNS,
+  evaluateProof,
+  proofLayout,
+  runStamp,
+  selectRunsToDelete,
+} from './lib/runtime-proof-lib.mjs';
+
+const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
+const DESCRIPTOR_TIMEOUT_MS = 60_000;
+const DEFAULT_SETTLE_S = 70;
+
+export function parseArgs(argv = []) {
+  const options = { exe: null, root: null, settle: DEFAULT_SETTLE_S, keep: KEEP_RUNS, screenshot: true, parallelOk: false, help: false };
+  for (let i = 0; i < argv.length; i += 1) {
+    const arg = argv[i];
+    if (arg === '--help' || arg === '-h') options.help = true;
+    else if (arg === '--no-screenshot') options.screenshot = false;
+    else if (arg === '--parallel-ok') options.parallelOk = true;
+    else if (arg === '--exe') options.exe = argv[++i];
+    else if (arg === '--root') options.root = argv[++i];
+    else if (arg === '--settle') options.settle = Number(argv[++i]);
+    else if (arg === '--keep') options.keep = Number(argv[++i]);
+    else throw new Error(`unknown option: ${arg}`);
+  }
+  if (options.exe === undefined || options.root === undefined) throw new Error('missing value after a flag');
+  if (!Number.isFinite(options.settle) || options.settle < 1) throw new Error('--settle must be seconds >= 1');
+  if (!Number.isSafeInteger(options.keep) || options.keep < 1) throw new Error('--keep must be a positive integer');
+  return options;
+}
+
+export function usage() {
+  return 'usage: node scripts/runtime-proof.mjs [--exe path] [--root dir] [--settle seconds] [--keep n] [--no-screenshot] [--parallel-ok]';
+}
+
+const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
+
+function projectaPids() {
+  if (process.platform === 'win32') {
+    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq projecta.exe', '/NH', '/FO', 'CSV'], { encoding: 'utf8' });
+    return [...out.matchAll(/"projecta\.exe","(\d+)"/gi)].map((match) => Number(match[1]));
+  }
+  try {
+    const out = execFileSync('pgrep', ['-x', 'projecta'], { encoding: 'utf8' });
+    return out.split('\n').filter(Boolean).map(Number);
+  } catch {
+    return [];
+  }
+}
+
+function killProjectA(pid) {
+  if (process.platform === 'win32') {
+    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
+  } else {
+    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
+  }
+}
+
+async function waitGone(pid, timeoutMs = 15_000) {
+  const deadline = Date.now() + timeoutMs;
+  while (Date.now() < deadline) {
+    if (!projectaPids().includes(pid)) return;
+    await sleep(200);
+  }
+  throw new Error(`projecta.exe pid ${pid} did not exit within ${timeoutMs} ms`);
+}
+
+function resolveExe(requested) {
+  const candidates = [
+    requested,
+    process.env.PROJECTA_EXE,
+    join(REPO, 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'projecta.exe' : 'projecta'),
+    join(REPO, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'projecta.exe' : 'projecta'),
+  ].filter(Boolean);
+  const found = candidates.find((candidate) => existsSync(candidate));
+  if (!found) throw new Error(`no projecta binary found; build first (cargo build in src-tauri) or pass --exe`);
+  return found;
+}
+
+function startApp(exe, layout, phase) {
+  const out = openSync(join(layout.runDir, `app-${phase}.stdout.log`), 'w');
+  const err = openSync(join(layout.runDir, `app-${phase}.stderr.log`), 'w');
+  const child = spawn(exe, [], {
+    env: { ...process.env, PROJECTA_APP_DATA: layout.appData, PROJECTA_QUEUE: 'off' },
+    stdio: ['ignore', out, err],
+  });
+  closeSync(out);
+  closeSync(err);
+  return child;
+}
+
+async function waitDescriptor(layout, timeoutMs = DESCRIPTOR_TIMEOUT_MS) {
+  const started = Date.now();
+  const deadline = started + timeoutMs;
+  while (Date.now() < deadline) {
+    if (existsSync(layout.descriptor)) {
+      return { descriptorMs: Date.now() - started, descriptor: JSON.parse(readFileSync(layout.descriptor, 'utf8')) };
+    }
+    await sleep(250);
+  }
+  return { descriptorMs: null, descriptor: null };
+}
+
+async function api(descriptor, method, path, body) {
+  const response = await fetch(`http://127.0.0.1:${descriptor.port}${path}`, {
+    method,
+    headers: { 'x-projecta-token': descriptor.token, 'content-type': 'application/json' },
+    body: body === undefined ? undefined : JSON.stringify(body),
+  });
+  const text = await response.text();
+  let parsed = null;
+  try { parsed = JSON.parse(text); } catch { /* the error body is plain text */ }
+  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${parsed?.error ?? text}`);
+  return parsed;
+}
+
+function takeScreenshot(layout, pid) {
+  const helper = join(REPO, 'scripts', 'window-shot.ps1');
+  if (process.platform !== 'win32' || !existsSync(helper)) return { ok: false, reason: 'screenshot helper is Windows-only' };
+  try {
+    // -TargetPid first: with a proof binary next to production the title alone is
+    // ambiguous, and a photo of the production window is worse than none.
+    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Title', 'ProjectA', '-ProcessName', 'projecta', '-TargetPid', String(pid), '-Out', layout.screenshot], { stdio: 'pipe' });
+    return { ok: existsSync(layout.screenshot), path: layout.screenshot };
+  } catch (error) {
+    return { ok: false, reason: String(error.stderr ?? error.message).trim().slice(0, 300) };
+  }
+}
+
+async function main() {
+  const options = parseArgs(process.argv.slice(2));
+  if (options.help) {
+    console.log(usage());
+    return;
+  }
+  const running = projectaPids();
+  if (running.length > 0 && !options.parallelOk) {
+    throw new Error(`projecta already running (pids ${running.join(',')}); the single-instance mutex is shared — close it first (or use --parallel-ok with a proof binary built under a distinct bundle identifier)`);
+  }
+
+  const exe = resolveExe(options.exe);
+  const root = options.root ?? process.env.PROJECTA_PROOF_DIR ?? join(tmpdir(), 'projecta-runtime-proof');
+  const layout = proofLayout(root, runStamp());
+  mkdirSync(layout.appData, { recursive: true });
+  mkdirSync(layout.scratchRepo, { recursive: true });
+  execFileSync('git', ['init', layout.scratchRepo], { stdio: 'ignore' });
+
+  const proof = {
+    schemaVersion: 1,
+    package: 'W5-28',
+    startedAt: new Date().toISOString(),
+    exe,
+    platform: process.platform,
+    queue: 'off (PROJECTA_QUEUE=off)',
+    appData: layout.appData,
+    settleSeconds: options.settle,
+    phase1: {},
+    phase2: {},
+  };
+
+  let child = null;
+  try {
+    // Phase 1: the app starts; two old queue entries are seeded.
+    child = startApp(exe, layout, 1);
+    const first = await waitDescriptor(layout);
+    if (!first.descriptor) throw new Error(`phase 1: no api descriptor within ${DESCRIPTOR_TIMEOUT_MS / 1000} s`);
+    proof.phase1 = { descriptorMs: first.descriptorMs, port: first.descriptor.port };
+    const project = await api(first.descriptor, 'POST', '/api/projects', { name: 'runtime-proof', repoPath: layout.scratchRepo });
+    const projectId = project.id ?? project.project?.id;
+    if (!projectId) throw new Error(`phase 1: POST /api/projects returned no id: ${JSON.stringify(project).slice(0, 200)}`);
+    await api(first.descriptor, 'POST', '/api/queue', { projectId, rawText: 'proof task A — never dispatched', sharpen: false });
+    await api(first.descriptor, 'POST', '/api/queue', { projectId, rawText: 'proof task B — never dispatched', sharpen: false });
+    const seeded = await api(first.descriptor, 'GET', `/api/queue?projectId=${encodeURIComponent(projectId)}`);
+    proof.phase1.seeded = Array.isArray(seeded) ? seeded.length : 0;
+    proof.phase1.projectId = projectId;
+    killProjectA(child.pid);
+    await waitGone(child.pid);
+    child = null;
+    // The restart mints a fresh token and port: the stale descriptor must
+    // not satisfy phase 2's wait, or the proof would read a dead api.
+    rmSync(layout.descriptor, { force: true });
+
+    // Phase 2: the restart faces the old entries; past two sweep intervals
+    // nothing may have dispatched.
+    child = startApp(exe, layout, 2);
+    const second = await waitDescriptor(layout);
+    if (!second.descriptor) throw new Error(`phase 2: no api descriptor within ${DESCRIPTOR_TIMEOUT_MS / 1000} s on restart`);
+    proof.phase2.descriptorMs = second.descriptorMs;
+    await sleep(options.settle * 1000);
+    const entries = await api(second.descriptor, 'GET', `/api/queue?projectId=${encodeURIComponent(projectId)}`);
+    const workers = await api(second.descriptor, 'GET', `/api/workers?projectId=${encodeURIComponent(projectId)}`);
+    proof.phase2.entries = (Array.isArray(entries) ? entries : []).map((entry) => ({ id: entry.id, status: entry.status }));
+    proof.phase2.workers = Array.isArray(workers) ? workers : [];
+    proof.screenshot = options.screenshot ? takeScreenshot(layout, child.pid) : { ok: false, reason: '--no-screenshot' };
+    killProjectA(child.pid);
+    await waitGone(child.pid);
+    child = null;
+  } finally {
+    if (child) {
+      try { killProjectA(child.pid); } catch { /* already gone */ }
+    }
+  }
+
+  const logSource = join(layout.appData, 'logs', 'projecta.log');
+  const logText = existsSync(logSource) ? readFileSync(logSource, 'utf8') : '';
+  if (existsSync(logSource)) copyFileSync(logSource, layout.appLog);
+
+  const verdict = evaluateProof({
+    phase1: { descriptorSeen: Number.isFinite(proof.phase1.descriptorMs), seeded: proof.phase1.seeded },
+    phase2: { descriptorSeen: Number.isFinite(proof.phase2.descriptorMs), entries: proof.phase2.entries, workers: proof.phase2.workers },
+    logText,
+    screenshot: proof.screenshot,
+    requireScreenshot: options.screenshot,
+  });
+  proof.verdict = verdict;
+  proof.finishedAt = new Date().toISOString();
+  writeFileSync(layout.proofJson, `${JSON.stringify(proof, null, 2)}\n`);
+
+  const siblings = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
+  for (const old of selectRunsToDelete(siblings, options.keep)) {
+    rmSync(join(root, old), { recursive: true, force: true });
+  }
+
+  console.log(`proof: ${verdict.ok ? 'PASS' : 'FAIL'} — ${layout.proofJson}`);
+  for (const failure of verdict.failures) console.log(`  - ${failure}`);
+  console.log(`runs kept under ${root}: ${Math.min(siblings.length, options.keep)} of ${siblings.length}`);
+  if (!verdict.ok) process.exitCode = 1;
+}
+
+if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
+  main().catch((error) => {
+    console.error(`runtime-proof: ${error.message}`);
+    process.exitCode = 1;
+  });
+}
diff --git a/scripts/window-shot.ps1 b/scripts/window-shot.ps1
index b8193b5..ee5a2e6 100644
--- a/scripts/window-shot.ps1
+++ b/scripts/window-shot.ps1
@@ -16,6 +16,7 @@
 param(
     [Parameter(Mandatory = $true)][string]$Title,
     [string]$ProcessName,
+    [int]$TargetPid = 0,
     [string]$Out = "window-shot.png"
 )
 $ErrorActionPreference = 'Stop'
@@ -29,6 +30,8 @@ public class WinShot {
     [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
     [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
     [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
+    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
+    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
     public struct RECT { public int Left, Top, Right, Bottom; }
 }
 "@
@@ -36,9 +39,14 @@ public class WinShot {
 # Exakter Titel schlaegt Teiltreffer. Ohne das gewinnt ein Browser-Tab, der
 # den gesuchten Namen zufaellig im Titel fuehrt - genau so ist dieses Skript
 # beim Installer-Test in einem Chrome-Fenster statt in der App gelandet.
+# -TargetPid schlaegt Titel und Prozessname: zwei gleich betitelte Fenster (etwa
+# Produktiv-App und Proof-Instanz nebeneinander) waeren sonst eine
+# Glueckssache, und das Foto kaeme vom falschen Fenster.
 $candidates = @(Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -like "*$Title*" })
 if ($ProcessName) { $candidates = @($candidates | Where-Object { $_.ProcessName -eq $ProcessName }) }
-$proc = $candidates | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1
+$proc = $null
+if ($TargetPid -gt 0) { $proc = @($candidates | Where-Object { $_.Id -eq $TargetPid }) | Select-Object -First 1 }
+if (-not $proc) { $proc = $candidates | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1 }
 if (-not $proc) { $proc = $candidates | Select-Object -First 1 }
 if (-not $proc) {
     Write-Error "Kein Fenster mit Titel *$Title* gefunden. Offene Fenster: $((Get-Process | Where-Object MainWindowTitle | ForEach-Object MainWindowTitle) -join ' | ')"
@@ -47,21 +55,42 @@ $hwnd = $proc.MainWindowHandle
 
 # 9 = SW_RESTORE: holt auch ein minimiertes Fenster zurück.
 [WinShot]::ShowWindow($hwnd, 9) | Out-Null
+# Ein harmloser Alt-Tastenschlag gibt diesem Prozess das Recht, ein fremdes
+# Fenster nach vorn zu holen; ohne ihn verweigert Windows das aus einer
+# Konsole im Hintergrund heraus (Foreground-Lock).
+[WinShot]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
+[WinShot]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
 [WinShot]::SetForegroundWindow($hwnd) | Out-Null
 Start-Sleep -Milliseconds 400
 
-if ([WinShot]::GetForegroundWindow() -ne $hwnd) {
-    Write-Error "Fenster '$($proc.MainWindowTitle)' liess sich nicht in den Vordergrund holen - Abbruch statt Foto vom falschen Fenster."
-}
-
 $rect = New-Object WinShot+RECT
 [WinShot]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
 $w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
 if ($w -le 0 -or $h -le 0) { Write-Error "Fensterrechteck ist leer ($w x $h)." }
 
-$bmp = New-Object System.Drawing.Bitmap($w, $h)
-$gfx = [System.Drawing.Graphics]::FromImage($bmp)
-$gfx.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
-$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
-$gfx.Dispose(); $bmp.Dispose()
-Write-Output "OK: '$($proc.MainWindowTitle)' ($w x $h) -> $Out"
+if ([WinShot]::GetForegroundWindow() -eq $hwnd) {
+    $method = 'CopyFromScreen'
+    $bmp = New-Object System.Drawing.Bitmap($w, $h)
+    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
+    $gfx.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
+    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
+    $gfx.Dispose(); $bmp.Dispose()
+} else {
+    # Der Vordergrund bleibt verwehrt: statt abzubrechen oder das falsche
+    # Fenster zu fotografieren, rendert PrintWindow das Zielfenster direkt
+    # (2 = PW_RENDERFULLCONTENT, sonst bleiben WebView2-Flaechen schwarz).
+    $method = 'PrintWindow'
+    $bmp = New-Object System.Drawing.Bitmap($w, $h)
+    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
+    $hdc = $gfx.GetHdc()
+    try {
+        if (-not [WinShot]::PrintWindow($hwnd, $hdc, 2)) {
+            Write-Error "PrintWindow auf '$($proc.MainWindowTitle)' fehlgeschlagen - kein Beleg statt falscher Beleg."
+        }
+    } finally {
+        $gfx.ReleaseHdc($hdc)
+    }
+    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
+    $gfx.Dispose(); $bmp.Dispose()
+}
+Write-Output "OK: '$($proc.MainWindowTitle)' ($w x $h, $method) -> $Out"
diff --git a/src-tauri/src/queue.rs b/src-tauri/src/queue.rs
index 6a81a70..6b53533 100644
--- a/src-tauri/src/queue.rs
+++ b/src-tauri/src/queue.rs
@@ -34,6 +34,23 @@ pub const DEFAULT_MAX_CONCURRENT: usize = 4;
 /// The queue is deliberately a slow poller: it is a safety net, not a hot path.
 pub const POLL_INTERVAL: Duration = Duration::from_secs(30);
 
+/// Environment switch that keeps the dispatcher from ever starting
+/// (W5-28). A sandboxed proof run sets `PROJECTA_QUEUE=off` so that no
+/// queued task - above all one left over from an earlier session - can
+/// reach an agent, while the rest of the app starts normally.
+pub const ENV_QUEUE: &str = "PROJECTA_QUEUE";
+
+/// Evaluate [`ENV_QUEUE`]: `off`, `0` and `false` (any case, trimmed)
+/// disable the dispatcher; everything else, including unset, keeps the
+/// historical default of a running dispatcher. A free function so the
+/// switch is testable without a Tauri app.
+pub fn queue_dispatch_disabled(value: Option<&str>) -> bool {
+    matches!(
+        value.map(str::trim).map(str::to_ascii_lowercase).as_deref(),
+        Some("off" | "0" | "false")
+    )
+}
+
 /// How many hops of [`AgentProfile::fallback`] the dispatcher will take before
 /// it gives up and leaves the task queued.
 ///
@@ -480,6 +497,17 @@ pub fn start(
     engine: Arc<StatusEngine>,
     hook_port: u16,
 ) {
+    // W5-28: a proof run starts the app with the queue off. No sweep ever
+    // runs, so no queued task - however old - reaches a launcher. The
+    // startup reattach pass in `main.rs` still resolves interrupted claims;
+    // it only ever hands them back to `ready`, never to a worker.
+    if queue_dispatch_disabled(std::env::var(ENV_QUEUE).ok().as_deref()) {
+        crate::logf!(
+            "app",
+            "queue dispatcher disabled ({ENV_QUEUE}=off); queued tasks stay ready"
+        );
+        return;
+    }
     let launcher = LiveLauncher {
         app,
         store: store.clone(),
@@ -647,6 +675,27 @@ mod tests {
         (dir, store, project.id)
     }
 
+    #[test]
+    fn queue_dispatch_disabled_recognizes_the_off_switches() {
+        for value in ["off", "OFF", " off ", "0", "false", "False"] {
+            assert!(
+                queue_dispatch_disabled(Some(value)),
+                "{value:?} must switch the dispatcher off"
+            );
+        }
+    }
+
+    #[test]
+    fn queue_dispatch_disabled_keeps_the_historical_default() {
+        assert!(!queue_dispatch_disabled(None));
+        for value in ["", "on", "1", "true", "yes", "later"] {
+            assert!(
+                !queue_dispatch_disabled(Some(value)),
+                "{value:?} must keep the dispatcher running"
+            );
+        }
+    }
+
     #[tokio::test]
     async fn enqueue_supports_plain_and_mocked_sharpened_tasks() {
         let (_dir, store, project) = fixture().await;
diff --git a/src-tauri/src/skills.rs b/src-tauri/src/skills.rs
index 59024d0..72cf56e 100644
--- a/src-tauri/src/skills.rs
+++ b/src-tauri/src/skills.rs
@@ -418,7 +418,10 @@ mod tests {
             "ui-ux-pro-max missing from {ids:?}"
         );
         let pack = dev.join("ui-ux-pro-max");
-        assert!(pack.join("SKILL.md").is_file(), "SKILL.md missing from ui-ux-pro-max");
+        assert!(
+            pack.join("SKILL.md").is_file(),
+            "SKILL.md missing from ui-ux-pro-max"
+        );
         let skill = std::fs::read_to_string(pack.join("SKILL.md")).expect("read SKILL.md");
         let (name, description) = parse_front_matter(&skill);
         assert_eq!(name.as_deref(), Some("ui-ux-pro-max"));

```
