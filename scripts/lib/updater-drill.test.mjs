import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { normalizeVersion, readDescriptor, runUpdaterDrill, summarizeJournal } from './updater-drill.mjs';

const TOKEN = 's3cr3t-token-value';
function fixture(journal) {
  const appDir = mkdtempSync(join(tmpdir(), 'upd-app-'));
  writeFileSync(join(appDir, 'projecta-api.json'), JSON.stringify({ port: 1, token: TOKEN }));
  if (journal) writeFileSync(join(appDir, 'update-recovery.json'), JSON.stringify(journal));
  return { appDir, outDir: join(mkdtempSync(join(tmpdir(), 'upd-out-')), 'b') };
}
// `script` entries: a phase object, or null = app unreachable (relaunch gap).
function fake(script, workers = [{ id: 'w1' }]) {
  let i = 0; let clock = 0;
  return {
    request: async (_d, path) => {
      if (path === '/api/workers') return workers;
      const s = script[Math.min(i++, script.length - 1)];
      if (s === null) throw new Error('ECONNREFUSED');
      return s;
    },
    sleep: async (ms) => { clock += ms; }, now: () => clock,
  };
}
const run = (scenario, script, opts = {}, workers) => {
  const fx = fixture(opts.journal);
  return runUpdaterDrill({ ...fx, scenario, appVersion: '0.9.0', commit: 'abc', timeoutMs: 60000, ...fake(script, workers) })
    .then((m) => ({ m, ...fx }));
};

test('successful update passes after phases and relaunch with surviving sessions', async () => {
  const { m, outDir } = await run('success', [{ phase: 'available', version: '1.0.0' }, { phase: 'installing', version: '1.0.0' }, null, null, { phase: 'up-to-date', version: '1.0.0' }]);
  assert.equal(m.result, 'pass', JSON.stringify(m.steps));
  assert.match(m.steps.find((s) => s.name === 'watch updater phases').detail, /installing > unreachable > up-to-date/);
  assert.ok(!readFileSync(join(outDir, 'manifest.json'), 'utf8').includes(TOKEN));
});
test('successful update fails when the installed version did not change', async () => {
  const { m } = await run('success', [{ phase: 'installing', version: '0.9.0' }, null, { phase: 'up-to-date', version: '0.9.0' }]);
  assert.equal(m.result, 'fail');
  assert.match(m.steps.at(-1).detail, /version did not change/);
});
test('successful update fails when the installed version is not the expected new one', async () => {
  const fx = fixture();
  const script = [{ phase: 'installing', version: '1.0.0' }, null, { phase: 'up-to-date', version: '1.0.0' }];
  const m = await runUpdaterDrill({ ...fx, scenario: 'success', appVersion: '0.9.0', newVersion: '1.1.0', commit: 'abc', timeoutMs: 60000, ...fake(script) });
  assert.equal(m.result, 'fail');
  assert.match(m.steps.at(-1).detail, /expected 1\.1\.0/);
});
test('successful update fails when no installed version is reported', async () => {
  const { m } = await run('success', [{ phase: 'installing' }, null, { phase: 'up-to-date' }]);
  assert.equal(m.result, 'fail');
  assert.match(m.steps.at(-1).detail, /no installed version/);
});
test('a leading v and whitespace do not count as a version mismatch', async () => {
  assert.equal(normalizeVersion(' v1.5.1 '), '1.5.1');
  const fx = fixture();
  const script = [{ phase: 'installing', version: 'v1.5.1' }, null, { phase: 'up-to-date', version: 'v1.5.1' }];
  const m = await runUpdaterDrill({ ...fx, scenario: 'success', appVersion: 'v1.5.0', newVersion: '1.5.1', commit: 'abc', timeoutMs: 60000, ...fake(script) });
  assert.equal(m.result, 'pass', JSON.stringify(m.steps));
  const same = await runUpdaterDrill({ ...fixture(), scenario: 'success', appVersion: 'v1.5.1', commit: 'abc', timeoutMs: 60000, ...fake([{ phase: 'installing', version: '1.5.1' }, null, { phase: 'up-to-date', version: '1.5.1' }]) });
  assert.match(same.steps.at(-1).detail, /version did not change/);
});
test('successful update compares the commit when expected and reported are known', async () => {
  const script = [{ phase: 'installing', version: '1.0.0' }, null, { phase: 'up-to-date', version: '1.0.0', commit: 'AAA111' }];
  const bad = await runUpdaterDrill({ ...fixture(), scenario: 'success', appVersion: '0.9.0', newCommit: 'bbb222', commit: 'abc', timeoutMs: 60000, ...fake(script) });
  assert.equal(bad.result, 'fail');
  assert.match(bad.steps.at(-1).detail, /installed commit aaa111, expected bbb222/);
  const ok = await runUpdaterDrill({ ...fixture(), scenario: 'success', appVersion: '0.9.0', newCommit: 'aaa111', commit: 'abc', timeoutMs: 60000, ...fake(script) });
  assert.equal(ok.result, 'pass', JSON.stringify(ok.steps));
});
test('cancelled update fails when the installed version changed anyway', async () => {
  const bad = await run('cancel', [{ phase: 'installing' }, { phase: 'idle', version: 'v1.0.0' }]);
  assert.equal(bad.m.result, 'fail');
  assert.match(bad.m.steps.at(-1).detail, /installed version 1\.0\.0 after cancel, expected 0\.9\.0/);
  const ok = await run('cancel', [{ phase: 'installing' }, { phase: 'idle', version: 'v0.9.0' }]);
  assert.equal(ok.m.result, 'pass', JSON.stringify(ok.m.steps));
});
test('successful update rejects an error state after relaunch', async () => {
  const { m } = await run('success', [{ phase: 'installing', version: '1.0.0' }, null, { phase: 'error', message: 'startup failed' }]);
  assert.equal(m.result, 'fail');
  assert.match(m.steps.at(-1).detail, /post-update state/);
});
test('failed update needs an error phase with a message and no relaunch', async () => {
  const ok = await run('fail', [{ phase: 'installing', version: '1.0.0' }, { phase: 'error', message: 'offline' }]);
  assert.equal(ok.m.result, 'pass', JSON.stringify(ok.m.steps));
  const bad = await run('fail', [{ phase: 'available' }]);
  assert.equal(bad.m.result, 'fail');
});
test('cancelled update must return to a resting phase without relaunch', async () => {
  const ok = await run('cancel', [{ phase: 'installing' }, { phase: 'available', version: '1.0.0' }]);
  assert.equal(ok.m.result, 'pass', JSON.stringify(ok.m.steps));
  const bad = await run('cancel', [{ phase: 'installing' }, null, { phase: 'idle' }]);
  assert.equal(bad.m.result, 'fail');
});
test('a missing session fails the drill', async () => {
  const none = await run('fail', [{ phase: 'error', message: 'x' }], {}, []);
  assert.equal(none.m.result, 'fail');
  assert.match(none.m.steps.at(-1).detail, /no worker record/);
});
test('worker evidence does not claim that an inactive row is a live session', async () => {
  const inactive = [{ id: 'w1', status: 'exited', sessionId: null }];
  const { m } = await run('fail', [{ phase: 'error', message: 'x' }], {}, inactive);
  assert.equal(m.result, 'pass', JSON.stringify(m.steps));
  assert.ok(!JSON.stringify(m).includes('active session'));
});
test('an unreachable app fails before any step', async () => {
  const fx = fixture();
  const m = await runUpdaterDrill({ ...fx, scenario: 'cancel', request: async () => { throw new Error(`refused`); } });
  assert.equal(m.result, 'fail');
  assert.equal(readDescriptor(fx.appDir).token, TOKEN);
});
test('journal summary records phase and hash but never the content', () => {
  const { appDir } = fixture({ version: 1, phase: 'installing', backup: 'C:\\Users\\someone\\x' });
  const j = summarizeJournal(appDir);
  assert.deepEqual([j.present, j.phase, j.keys], [true, 'installing', ['backup', 'phase', 'version']]);
  assert.ok(!JSON.stringify(j).includes('someone'));
  assert.deepEqual(summarizeJournal(fixture().appDir), { present: false });
});
