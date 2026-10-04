import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { newRuns, runProviderDrill, summarizeRun } from './provider-drill.mjs';

const route = (provider, transport) => JSON.stringify({
  selection: { resolved: { provider } }, invocationModel: 'm-1', preparedInvocation: { transport },
  executionObservation: { state: 'unavailable' },
});
const record = (id, {
  provider = 'codex', identity = 'recorded', assessment = 'observed',
  observedProvider = provider, observedModel = 'm-1', usage,
} = {}) => ({
  run: { id }, launch: { routeJson: route(provider, 'native_json') },
  executionIdentity: { state: identity, assessment, identity: { observed: {
    status: assessment, identity: { provider: observedProvider, model: observedModel, family: 'openai' },
  } } },
  usage: usage ?? { state: 'measured', tokens: 120, ledgerState: 'settled', reservedTokens: 500,
    provenance: { collector: 'codex_native_json', source: 'codex_native_json:sha256:ab', observedAt: 1700000000 } },
});
const NOT_REPORTED = { state: 'not_reported', reason: 'not reported by adapter: no collector', ledgerState: 'started',
  reservedTokens: 500, provenance: { collector: null, measurement: 'none', observedAt: 1700000000 } };
const out = () => join(mkdtempSync(join(tmpdir(), 'pdrill-')), 'b');
const snap = { snapshot: 'Usage 3%', snapshotSource: 'provider usage page', snapshotObservedAt: '2026-10-05T10:00Z' };

test('only runs absent from the before capture count as the drill run', () => {
  assert.deepEqual(newRuns([record('a')], { runs: [record('a'), record('b')] }).map((r) => r.run.id), ['b']);
});
test('summary keeps route and observed identity and reservation and collector source apart', () => {
  const s = summarizeRun(record('r1'));
  assert.deepEqual(s.configured, { provider: 'codex', model: 'm-1', transport: 'native_json' });
  assert.equal(s.identity.observed.identity.model, 'm-1');
  assert.deepEqual(s.reservation, { ledgerState: 'settled', reservedTokens: 500 });
  assert.equal(s.usage.source, 'codex_native_json:sha256:ab');
  assert.equal(s.usage.observedAt, 1700000000);
});
test('measured run with a provider snapshot passes', () => {
  const m = runProviderDrill({ adapter: 'codex', outDir: out(), before: [], after: [record('r1')], ...snap });
  assert.equal(m.result, 'pass', JSON.stringify(m.steps));
});
test('not_reported without tokens passes and tokens are never filled in', () => {
  const o = out();
  const m = runProviderDrill({ adapter: 'claude', outDir: o, before: [], after: [record('r1', { provider: 'claude', usage: NOT_REPORTED })], ...snap });
  assert.equal(m.result, 'pass', JSON.stringify(m.steps));
  assert.equal(JSON.parse(readFileSync(join(o, 'run-summary.json'), 'utf8')).usage.tokens, null);
});
test('unobserved identity or wrong provider or invented tokens fail', () => {
  for (const r of [record('r1', { identity: 'unavailable' }), record('r1', { provider: 'claude' }),
    record('r1', { usage: { state: 'measured', tokens: 9, provenance: {} } })]) {
    assert.equal(runProviderDrill({ adapter: 'codex', outDir: out(), before: [], after: [r], ...snap }).result, 'fail');
  }
});
test('recorded identity without an observed provider and model fails', () => {
  for (const r of [record('r1', { assessment: 'unknown' }), record('r1', { observedProvider: 'claude' }),
    record('r1', { observedModel: null })]) {
    assert.equal(runProviderDrill({ adapter: 'codex', outDir: out(), before: [], after: [r], ...snap }).result, 'fail');
  }
});
test('missing provider snapshot or no new run fails', () => {
  assert.equal(runProviderDrill({ adapter: 'codex', outDir: out(), before: [], after: [record('r1')] }).result, 'fail');
  assert.equal(runProviderDrill({ adapter: 'codex', outDir: out(), before: [record('r1')], after: [record('r1')], ...snap }).result, 'fail');
});
test('tokens and the user profile path are redacted from the bundle', () => {
  const o = out();
  const r = record('r1'); r.launch.worktreePath = 'C:\\Users\\someone\\work'; r.launch.apiToken = `tok-${'abcdefgh'}${'12345'}`;
  runProviderDrill({ adapter: 'codex', outDir: o, before: [], after: [r], ...snap, snapshot: 'token=s3cr3tvalue123' });
  const all = ['run-record.json', 'provider-snapshot.txt', 'manifest.json'].map((f) => readFileSync(join(o, f), 'utf8')).join('');
  assert.ok(!/s3cr3tvalue|tok-abcdefgh|someone/.test(all));
});
test('CLI writes the bundle and exits 0 on pass', () => {
  const d = mkdtempSync(join(tmpdir(), 'pdrill-cli-'));
  writeFileSync(join(d, 'b.json'), '[]'); writeFileSync(join(d, 'a.json'), JSON.stringify([record('r1')]));
  writeFileSync(join(d, 's.txt'), 'Usage 3%');
  const cli = fileURLToPath(new URL('../drills/provider-drill.mjs', import.meta.url));
  const res = spawnSync(process.execPath, [cli, '--adapter', 'codex', '--before', join(d, 'b.json'), '--after', join(d, 'a.json'),
    '--snapshot', join(d, 's.txt'), '--snapshot-source', 'usage page', '--snapshot-observed-at', 'now', '--commit', 'abc', '--out', join(d, 'o')], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.ok(existsSync(join(d, 'o', 'manifest.json')));
});
