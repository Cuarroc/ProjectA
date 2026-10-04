import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SCREENSHOTS, extractIds, runHqProof } from './hq-proof-drill.mjs';
const MANIFEST_DIGEST = 'a'.repeat(64);
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const ctx = (n) => JSON.stringify({ tasks: Array.from({ length: n }, (_, i) => ({ taskId: `t-${i}`, runs: [{ runId: `r-${i}` }], pr: `https://github.com/o/r/pull/${i + 1}` })) });
const runtime = (digest = MANIFEST_DIGEST, apiVersion = 1) => JSON.stringify({ apiVersion, token: 's3cr3tvalue', provenance: { builtinManifestSha256: digest } });
const fakeExec = (n, runtimeText = runtime()) => (_bin, args) => ({ status: 0, stdout: args[1] === 'runtime' ? runtimeText : ctx(n), stderr: '' });
const proof = (options) => runHqProof({ expectedManifestSha256: MANIFEST_DIGEST, ...options });
function shots(names = SCREENSHOTS) {
  const d = tmp('shots-'); for (const f of names) writeFileSync(join(d, f), 'png'); return d;
}
test('extractIds reads JSON keys and PR URLs only', () => {
  const ids = extractIds(ctx(2));
  assert.deepEqual(ids.runIds, ['r-0', 'r-1']);
  assert.deepEqual(ids.taskIds, ['t-0', 't-1']);
  assert.equal(ids.prUrls.length, 2);
  assert.deepEqual(extractIds('<html>see https://github.com/o/r/pull/9</html>').prUrls, ['https://github.com/o/r/pull/9']);
});
test('extractIds reads production HQ context task ids', () => {
  const ids = extractIds(JSON.stringify({ tasks: [{ id: 'ct-1' }, { id: 'ct-2' }], goals: [{ id: 'goal-not-a-task' }] }));
  assert.deepEqual(ids.taskIds, ['ct-1', 'ct-2']);
});
test('runtime proof requires HQ v1 and the matching built-in manifest', () => {
  const mismatch = proof({ phase: 'before', outDir: join(tmp('mismatch-'), 'out'), projectId: 'pj', exec: fakeExec(0, runtime('b'.repeat(64))) });
  assert.equal(mismatch.result, 'fail');
  assert.match(mismatch.steps[0].detail, /manifest/i);
  const incompatible = proof({ phase: 'before', outDir: join(tmp('api-'), 'out'), projectId: 'pj', exec: fakeExec(0, runtime(MANIFEST_DIGEST, 2)) });
  assert.equal(incompatible.result, 'fail');
  assert.match(incompatible.steps[0].detail, /HQ v1/);
});
test('before then after passes with 3 new tasks and token is redacted', () => {
  const b = join(tmp('b-'), 'b');
  assert.equal(proof({ phase: 'before', outDir: b, projectId: 'pj', exec: fakeExec(0) }).result, 'pass');
  const a = join(tmp('a-'), 'a');
  const m = proof({ phase: 'after', outDir: a, projectId: 'pj', beforeDir: b, screenshotsDir: shots(), exec: fakeExec(3) });
  assert.equal(m.result, 'pass', JSON.stringify(m.steps));
  assert.ok(existsSync(join(a, 'screenshots', 'diff-in-app.png')));
  assert.ok(!readFileSync(join(a, 'pa-hq-runtime.json'), 'utf8').includes('s3cr3tvalue'));
  assert.ok(!readFileSync(join(a, 'manifest.json'), 'utf8').includes('s3cr3tvalue'));
});
test('after fails on too few tasks or missing screenshot or failing pa call', () => {
  const b = join(tmp('b-'), 'b');
  proof({ phase: 'before', outDir: b, projectId: 'pj', exec: fakeExec(0) });
  const few = proof({ phase: 'after', outDir: join(tmp('a-'), 'a'), projectId: 'pj', beforeDir: b, screenshotsDir: shots(), exec: fakeExec(2) });
  assert.equal(few.result, 'fail');
  const miss = proof({ phase: 'after', outDir: join(tmp('a-'), 'a'), projectId: 'pj', beforeDir: b, screenshotsDir: shots(SCREENSHOTS.slice(1)), exec: fakeExec(3) });
  assert.match(miss.steps.at(-1).detail, /hq-hell-komfortabel\.png/);
  assert.equal(miss.result, 'fail');
  const down = proof({ phase: 'before', outDir: join(tmp('a-'), 'a'), projectId: 'pj', exec: () => ({ status: 1, stdout: '', stderr: 'no app' }) });
  assert.equal(down.result, 'fail');
});
test('after without a before bundle cannot pass', () => {
  const m = proof({ phase: 'after', outDir: join(tmp('a-'), 'a'), projectId: 'pj', screenshotsDir: shots(), exec: fakeExec(3) });
  assert.equal(m.result, 'fail');
});
