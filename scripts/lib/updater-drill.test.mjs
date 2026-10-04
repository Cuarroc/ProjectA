import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readDescriptor, runUpdaterDrill, summarizeJournal } from './updater-drill.mjs';

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
  assert.match(none.m.steps.at(-1).detail, /no active session/);
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
