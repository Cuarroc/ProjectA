import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { evaluatePhase, parseDescriptor, runSingletonDrill, summarizeProcesses, summarizeWorkers } from './singleton-drill.mjs';

const TOKEN = 'aaaa-bbbb-aaaa-bbbb';
const desc = JSON.stringify({ port: 4001, token: TOKEN });
const scanOf = (pids) => ({ processes: [...pids.map((pid) => ({ pid, name: 'ProjectA' })), { pid: 9, name: 'msedgewebview2' }], listeners: pids.map((pid) => ({ pid, port: 4001 })) });
const workers = [{ id: 'wk-2', status: 'idle', task: 'private text' }, { id: 'wk-1', status: 'working' }];
function drill(scans) {
  const outDir = join(mkdtempSync(join(tmpdir(), 'sd-')), 'b');
  const queue = [...scans];
  return { outDir, run: () => runSingletonDrill({ outDir, appVersion: '1.4.1', commit: 'abc', readDescriptor: async () => desc, scan: async () => queue.shift(), callApi: async () => workers, ask: async () => 'j' }) };
}
test('descriptor parsing rejects a missing token or port', () => {
  assert.deepEqual(parseDescriptor(desc), { port: 4001, token: TOKEN });
  assert.throws(() => parseDescriptor('{"port":4001}'));
  assert.throws(() => parseDescriptor('{"port":0,"token":"x"}'));
});
test('summaries keep only worker ids and status plus app processes and ports', () => {
  assert.deepEqual(summarizeWorkers(workers), [{ id: 'wk-1', status: 'working' }, { id: 'wk-2', status: 'idle' }]);
  assert.deepEqual(summarizeProcesses(scanOf([5])), { app: [{ pid: 5, startedAt: null }], ports: [4001] });
});
test('a surviving second process fails the second-start phase', () => {
  const s = (pids) => ({ processes: summarizeProcesses(scanOf(pids)), descriptor: { port: 4001 }, api: { workers: summarizeWorkers(workers), error: '' } });
  assert.deepEqual(evaluatePhase('second-start', s([5]), s([5])), []);
  assert.match(evaluatePhase('second-start', s([5, 6]), s([5])).join(), /exactly 1 ProjectA process/);
});
test('after a crash the sessions must still be listed and the PID must differ', () => {
  const base = { processes: summarizeProcesses(scanOf([5])), descriptor: { port: 4001 }, api: { workers: summarizeWorkers(workers), error: '' } };
  const after = { ...base, processes: summarizeProcesses(scanOf([7])), api: { workers: [{ id: 'wk-1', status: 'idle' }], error: '' } };
  assert.match(evaluatePhase('crash', after, base).join(), /wk-2/);
  assert.match(evaluatePhase('crash', base, base).join(), /not ended/);
});
test('a baseline without sessions fails closed', () => {
  const baseline = { processes: summarizeProcesses(scanOf([5])), descriptor: { port: 4001 }, api: { workers: [], error: '' } };
  assert.match(evaluatePhase('baseline', baseline, null).join(), /at least one session/);
});
test('a full pass writes a bundle that never contains the token or task text', async () => {
  const d = drill([scanOf([5]), scanOf([5]), scanOf([8]), scanOf([9])]);
  const m = await d.run();
  assert.equal(m.result, 'pass', JSON.stringify(m.steps));
  assert.equal(m.steps.length, 4);
  for (const f of readdirSync(d.outDir)) { const t = readFileSync(join(d.outDir, f), 'utf8'); assert.ok(!t.includes(TOKEN) && !t.includes('private text'), f); }
});
