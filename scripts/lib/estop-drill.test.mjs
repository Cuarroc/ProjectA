import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseEstopStatus, parseProcessRows, runEstopDrill, workerInventory } from './estop-drill.mjs';

const rows = [
  { pid: 1, ppid: 0, name: 'projecta.exe' }, { pid: 2, ppid: 1, name: 'claude.exe' },
  { pid: 3, ppid: 2, name: 'node.exe' }, { pid: 4, ppid: 1, name: 'msedgewebview2.exe' },
  { pid: 5, ppid: 99, name: 'claude.exe' },
];
test('workerInventory keeps descendants of the app but not the app or web view or strangers', () => {
  assert.deepEqual(workerInventory(rows).map((r) => r.pid), [2, 3]);
});
test('parseProcessRows reads ps text and Win32_Process JSON', () => {
  assert.deepEqual(parseProcessRows(' 12  1 claude\n'), [{ pid: 12, ppid: 1, name: 'claude' }]);
  assert.deepEqual(parseProcessRows('{"ProcessId":7,"ParentProcessId":2,"Name":"a.exe"}'), [{ pid: 7, ppid: 2, name: 'a.exe' }]);
});
test('parseEstopStatus reads the pa output and rejects anything else', () => {
  assert.deepEqual(parseEstopStatus('emergency stop: ACTIVE (no new dispatch)\n'), { active: true });
  assert.deepEqual(parseEstopStatus('emergency stop: off\n'), { active: false });
  assert.throws(() => parseEstopStatus('error: no descriptor'));
});

// Fake clock world: the stop is acknowledged at t=500 ms, workers vanish `dieAfter` ms later
// (never when null), and the user releases 12 s after the trigger.
function world({ dieAfter, workers = rows.slice(0, 3) }) {
  let t = 0;
  const triggered = () => t >= 500;
  return {
    outDir: join(mkdtempSync(join(tmpdir(), 'estop-')), 'out'), appVersion: '1.4.1', commit: 'abc',
    deps: {
      now: () => t, sleep: async (ms) => { t += ms; }, notify: () => {},
      getState: async () => ({ active: triggered() && t < 12500 }),
      listProcesses: async () => (triggered() && dieAfter !== null && t >= 500 + dieAfter ? [rows[0]] : workers.concat(rows[0])),
    },
  };
}
test('drill passes when workers are gone within 10 s and records release', async () => {
  const w = world({ dieAfter: 2000 });
  const m = await runEstopDrill(w);
  assert.equal(m.result, 'pass');
  assert.equal(JSON.parse(readFileSync(join(w.outDir, 'state-after-release.json'), 'utf8')).active, false);
});
test('drill fails and lists the residual process when a worker stays alive', async () => {
  const w = world({ dieAfter: null });
  const m = await runEstopDrill(w);
  assert.equal(m.result, 'fail');
  assert.match(readFileSync(join(w.outDir, 'processes-after.txt'), 'utf8'), /claude\.exe pid=2 parent=1/);
});
test('drill keeps tracking an affected descendant after its parent exits', async () => {
  let t = 0;
  const root = rows[0];
  const orphan = rows[2];
  const w = {
    outDir: join(mkdtempSync(join(tmpdir(), 'estop-')), 'out'), appVersion: '1.4.1', commit: 'abc',
    deps: {
      now: () => t, sleep: async (ms) => { t += ms; }, notify: () => {},
      getState: async () => ({ active: t >= 500 && t < 12500 }),
      listProcesses: async () => (t < 500 ? [root, rows[1], orphan] : [root, orphan]),
    },
  };
  const m = await runEstopDrill(w);
  assert.equal(m.result, 'fail');
  assert.match(readFileSync(join(w.outDir, 'processes-after.txt'), 'utf8'), /node\.exe pid=3 parent=2/);
});
test('trigger polling cannot hide a stop that exceeds ten seconds', async () => {
  let t = 0;
  const w = {
    outDir: join(mkdtempSync(join(tmpdir(), 'estop-')), 'out'), appVersion: '1.4.1', commit: 'abc',
    deps: {
      now: () => t, sleep: async (ms) => { t += ms; }, notify: () => {},
      getState: async () => ({ active: t >= 501 && t < 12500 }),
      listProcesses: async () => (t < 10501 ? rows.slice(0, 3) : [rows[0]]),
    },
  };
  const m = await runEstopDrill(w);
  assert.equal(m.result, 'fail');
  assert.match(m.steps.find((step) => step.name.includes('within 10 s')).detail, /10250 ms/);
});
test('drill fails when workers need longer than 10 s', async () => {
  const m = await runEstopDrill(world({ dieAfter: 11000 }));
  assert.equal(m.result, 'fail');
});
test('drill refuses to run without workers', async () => {
  const m = await runEstopDrill(world({ dieAfter: 0, workers: [] }));
  assert.equal(m.result, 'fail');
  assert.match(m.steps.at(-1).detail, /start several workers/);
});
