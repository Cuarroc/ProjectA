// W5-28: pins the pure decisions of scripts/runtime-proof.mjs — sandbox
// layout, the pass/fail verdict, and the retention limit on proof runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  DISPATCH_DISABLED_LOG,
  KEEP_RUNS,
  evaluateProof,
  proofEnv,
  proofLayout,
  runStamp,
  selectRunsToDelete,
} from './runtime-proof-lib.mjs';

const goodFacts = () => ({
  phase1: { descriptorSeen: true, seeded: 2 },
  phase2: {
    descriptorSeen: true,
    entries: [
      { id: 'tq-1', status: 'ready' },
      { id: 'tq-2', status: 'ready' },
    ],
    workers: [],
  },
  logText: `line\nprojecta ${DISPATCH_DISABLED_LOG} (PROJECTA_QUEUE=off)\nline`,
  screenshot: { ok: true, path: 'shot.png' },
  requireScreenshot: true,
});

test('layout keeps every artifact of a run inside its run directory', () => {
  const stamp = '2026-09-25T10-00-00.000Z';
  const layout = proofLayout('/proofs', stamp);
  const runDir = join('/proofs', stamp);
  assert.equal(layout.runDir, runDir);
  for (const value of Object.values(layout)) {
    assert.ok(value.startsWith(runDir), `${value} escapes the run directory`);
  }
  assert.equal(new Set(Object.values(layout)).size, Object.values(layout).length);
});

test('run stamp sorts lexicographically like time and is filename-safe', () => {
  const a = runStamp(new Date('2026-09-25T10:00:00.000Z'));
  const b = runStamp(new Date('2026-09-25T10:00:01.000Z'));
  assert.ok(a < b);
  assert.match(a, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/);
});

test('the sandbox env puts the WebView2 profile inside the run directory', () => {
  const stamp = '2026-09-25T10-00-00.000Z';
  const layout = proofLayout('/proofs', stamp);
  const env = proofEnv(layout);
  assert.equal(env.PROJECTA_APP_DATA, layout.appData);
  assert.equal(env.PROJECTA_QUEUE, 'off');
  // grok G1: wry passes no user-data-folder when tauri.conf.json has no
  // dataDirectory, so WebView2 falls back to a profile keyed only by the
  // bundle identifier — a default-identifier proof binary would share the
  // production profile (localStorage writes, unclean taskkill). The env
  // override applies exactly when no folder is passed, which is our case.
  assert.equal(env.WEBVIEW2_USER_DATA_FOLDER, layout.webview);
  assert.ok(env.WEBVIEW2_USER_DATA_FOLDER.startsWith(layout.runDir));
});

test('verdict passes only when the app started twice and nothing dispatched and the log proves the switch', () => {
  const verdict = evaluateProof(goodFacts());
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.failures, []);
});

test('verdict fails when a queued entry left ready or a worker exists', () => {
  const dispatched = goodFacts();
  dispatched.phase2.entries[0].status = 'dispatched';
  assert.equal(evaluateProof(dispatched).ok, false);
  const spawned = goodFacts();
  spawned.phase2.workers = [{ id: 'wk-1' }];
  assert.equal(evaluateProof(spawned).ok, false);
  const unseeded = goodFacts();
  unseeded.phase1.seeded = 0;
  assert.equal(evaluateProof(unseeded).ok, false);
});

test('verdict fails when fewer entries come back than were seeded', () => {
  const vanished = goodFacts();
  vanished.phase2.entries = [];
  assert.equal(evaluateProof(vanished).ok, false);
  const garbage = goodFacts();
  garbage.phase2.entries = null;
  assert.equal(evaluateProof(garbage).ok, false);
});

test('retention ignores directories that are not proof runs', () => {
  const names = ['keepme', '2026-09-20T00-00-00.000Z', '2026-09-25T09-00-00.000Z'];
  assert.deepEqual(selectRunsToDelete(names, 1), ['2026-09-20T00-00-00.000Z']);
  assert.deepEqual(selectRunsToDelete(['keepme', 'other'], 1), []);
});

test('verdict fails without the disabled log line or a start or a required screenshot', () => {
  const noLog = goodFacts();
  noLog.logText = 'nothing relevant';
  assert.equal(evaluateProof(noLog).ok, false);
  const noRestart = goodFacts();
  noRestart.phase2.descriptorSeen = false;
  assert.equal(evaluateProof(noRestart).ok, false);
  const noShot = goodFacts();
  noShot.screenshot = { ok: false, reason: 'window not foreground' };
  assert.equal(evaluateProof(noShot).ok, false);
  const optionalShot = goodFacts();
  optionalShot.screenshot = { ok: false, reason: 'window not foreground' };
  optionalShot.requireScreenshot = false;
  assert.equal(evaluateProof(optionalShot).ok, true);
});

test('retention keeps the newest runs and deletes the rest', () => {
  const names = ['2026-09-20T00-00-00.000Z', '2026-09-25T09-00-00.000Z', '2026-09-25T10-00-00.000Z'];
  assert.deepEqual(selectRunsToDelete(names, 2), ['2026-09-20T00-00-00.000Z']);
  assert.deepEqual(selectRunsToDelete(names, KEEP_RUNS), []);
  assert.deepEqual(selectRunsToDelete([], KEEP_RUNS), []);
  assert.throws(() => selectRunsToDelete(names, 0), /keep/);
});

test('driver parses its flags and rejects unknown ones and bad values', async () => {
  const { parseArgs } = await import('../runtime-proof.mjs');
  const options = parseArgs(['--exe', 'app.exe', '--settle', '5', '--no-screenshot', '--parallel-ok']);
  assert.equal(options.exe, 'app.exe');
  assert.equal(options.settle, 5);
  assert.equal(options.screenshot, false);
  assert.equal(options.parallelOk, true);
  assert.equal(parseArgs([]).screenshot, true);
  assert.equal(parseArgs([]).parallelOk, false);
  assert.throws(() => parseArgs(['--bogus']), /unknown option/);
  assert.throws(() => parseArgs(['--settle', '0']), /settle/);
  assert.throws(() => parseArgs(['--keep', '0']), /keep/);
});
