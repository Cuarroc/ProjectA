import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { evaluate, expectedLimit, parseSnapshot, runCapacityDrill } from './capacity-drill.mjs';
const MIB = 1024 * 1024; const TOTAL = 16384 * MIB;
const snap = (availMiB, claims = 2, extra = {}) => {
  const { limit, reason } = expectedLimit(TOTAL, availMiB * MIB);
  return { effectiveLimits: { hostAdmission: { activeClaims: claims, memory: { limit, reason, state: 'measured', totalBytes: TOTAL, availableBytes: availMiB * MIB, ...extra } } } };
};
test('thresholds give limit 2/1/0 and fail closed to 1', () => {
  assert.equal(expectedLimit(TOTAL, 8000 * MIB).limit, 2);
  assert.equal(expectedLimit(TOTAL, 2047 * MIB).limit, 1);
  assert.equal(expectedLimit(TOTAL, 511 * MIB).limit, 0);
  assert.equal(expectedLimit(0, 0).limit, 1);
  assert.equal(expectedLimit(100 * MIB, 200 * MIB).limit, 1);
  assert.equal(expectedLimit(40000 * MIB, 1900 * MIB).limit, 0, '5 percent rule');
});
test('parseSnapshot reads admission fields and tolerates absence', () => {
  assert.equal(parseSnapshot(snap(8000)).limit, 2);
  assert.equal(parseSnapshot({ error: 'x' }), null);
});
const sample = (mib, claims) => ({ t: 't', os: { totalBytes: TOTAL, availableBytes: mib * MIB }, snapshots: { a: parseSnapshot(snap(mib, claims)), b: parseSnapshot(snap(mib, claims)) } });
test('evaluate passes a full normal to critical and back run with constant claims', () => {
  assert.deepEqual(evaluate([8000, 1500, 300, 8000].map((m) => sample(m, 2)), true).problems, []);
});
test('evaluate flags a reclaimed worker and a claim at critical and a missing stage', () => {
  const p = evaluate([sample(8000, 2), sample(300, 2), sample(300, 3), sample(8000, 1)], true).problems.join('|');
  assert.match(p, /reclaimed/); assert.match(p, /rose at critical/); assert.match(p, /stage not reached: limited/);
});
test('evaluate flags a wrong limit and an unavailable measurement that is not limit 1', () => {
  const bad = parseSnapshot(snap(300)); bad.limit = 2;
  const open = parseSnapshot(snap(8000, 2, { state: 'unavailable' })); open.limit = 2;
  const p = evaluate([{ t: 't', os: { availableBytes: 1 }, snapshots: { a: bad, b: open } }], false).problems.join('|');
  assert.match(p, /expected 0/); assert.match(p, /expected 1/);
});
test('with Continuous off the run is observation only and never fails on admission', async () => {
  const outDir = join(mkdtempSync(join(tmpdir(), 'cap-')), 'b');
  const m = await runCapacityDrill({ outDir, projects: ['a'], continuous: false, durationSec: 1, intervalMs: 5000,
    readOs: () => ({ totalBytes: TOTAL, availableBytes: 8000 * MIB }), fetchSnapshot: async () => snap(8000, 0) });
  assert.equal(m.result, 'pass'); assert.match(m.steps[1].name, /observation only/);
  assert.ok(m.notCovered.some((n) => /Continuous ON/.test(n)));
});
test('API errors are not a pass and bundle text carries no token', async () => {
  const outDir = join(mkdtempSync(join(tmpdir(), 'cap-')), 'b');
  const m = await runCapacityDrill({ outDir, projects: ['a'], continuous: true, durationSec: 1, intervalMs: 5000,
    readOs: () => ({ totalBytes: TOTAL, availableBytes: 8000 * MIB }), fetchSnapshot: async () => { throw new Error('token=dummyvalue'); },
    processList: 'token: dummyvalue' });
  assert.equal(m.result, 'fail');
  assert.ok(!readFileSync(join(outDir, 'processes.txt'), 'utf8').includes('dummyvalue'));
});
