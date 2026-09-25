import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateDevConfig } from './dev-config.mjs';
import { doctor, setup, discoverExecutable } from '../dev-setup.mjs';
const source = readFileSync('projecta.dev.json', 'utf8');
const config = () => JSON.parse(source);

test('token allowances are bounded and old configuration does not acquire one silently', () => {
  const legacy = config(); delete legacy.tokens;
  assert.equal(validateDevConfig(legacy).tokens, undefined);
  for (const tokens of [{ maxPerGoal: 200001, verificationReserve: 1 }, { maxPerGoal: 10, verificationReserve: 11 }, { maxPerGoal: 10, verificationReserve: 0 }, { maxPerGoal: 10, verificationReserve: 1, extra: true }]) {
    assert.throws(() => validateDevConfig({ ...config(), tokens }));
  }
});

test('development policy rejects unknown fields, unsafe spending and widened limits', () => {
  assert.equal(validateDevConfig(config()).schemaVersion, 1);
  for (const edit of [c => { c.extra = true; }, c => { c.schemaVersion = 2; }, c => { c.routing.additionalPaidApi = true; }, c => { c.continuous.maxAttemptsPerTask = 100; }, c => { c.continuous.enabled = 'false'; }, c => { c.routing.quotaReservePercent = 0; }, c => { c.providers.push('unknown'); }]) {
    const value = config(); edit(value); assert.throws(() => validateDevConfig(value));
  }
});

test('optional admission and escalation can be disabled without enabling execution', () => {
  const value = config();
  value.continuous.maxEscalations = 0;
  value.continuous.discoveryRunsPerDay = 0;
  value.continuous.maxAutonomousGoals = 0;
  assert.equal(validateDevConfig(value), value);
  value.continuous.enabled = true;
  assert.throws(() => validateDevConfig(value));
});

test('doctor is read-only and distinguishes installed tools from attested capabilities', t => {
  const root = mkdtempSync(join(tmpdir(), 'projecta-doctor-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'projecta.dev.json'), source);
  const before = readdirSync(root);
  const calls = [];
  const result = doctor(root, (name, args) => { calls.push({ name, args }); return { status: 0, stdout: args.includes('core.hooksPath') ? '.githooks\n' : 'available\n' }; });
  assert.deepEqual(readdirSync(root), before);
  assert.ok(calls.every(c => !['claude', 'codex', 'kimi', 'opencode', 'ollama'].includes(c.name)));
  assert.ok(result.checks.filter(c => c.id.startsWith('provider:')).every(c => c.state !== 'ok'));
});

test('doctor detects a missing or stale generated HQ start guide', t => {
  const root = mkdtempSync(join(tmpdir(), 'projecta-guide-doctor-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'projecta.dev.json'), source);
  const probe = () => ({ status: 0, stdout: '.githooks\n' });
  assert.equal(doctor(root, probe).checks.find(c => c.id === 'setup-guide').state, 'fail');
  setup(root, probe);
  assert.equal(doctor(root, probe).checks.find(c => c.id === 'setup-guide').state, 'ok');
  writeFileSync(join(root, '.pa', 'HQ-START.md'), 'stale\n');
  const check = doctor(root, probe).checks.find(c => c.id === 'setup-guide');
  assert.equal(check.state, 'fail');
  assert.match(check.detail, /Stale/);
});

test('Windows shim discovery handles PATH casing and reports inaccessible paths honestly', () => {
  const found = discoverExecutable('codex', { platform: 'win32', env: { Path: 'C:\\Tools' }, stat: path => {
    if (path === 'C:\\Tools\\codex.cmd') return { isFile: () => true };
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  } });
  assert.equal(found.path, 'C:\\Tools\\codex.cmd');
  assert.equal(discoverExecutable('ollama', { platform: 'win32', env: { Path: 'C:\\Private' }, stat: () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); } }).state, 'unavailable-to-inspect');
});

test('doctor refuses a Rust compiler older than the declared lock API floor', t => {
  const root = mkdtempSync(join(tmpdir(), 'projecta-rust-doctor-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'projecta.dev.json'), source);
  const inspect = version => doctor(root, name => ({ status: 0, stdout: name === 'rustc' ? `rustc ${version}` : '.githooks\n' })).checks.find(c => c.id === 'rustc');
  assert.equal(inspect('1.88.0').state, 'fail');
  assert.equal(inspect('1.89.0').state, 'ok');
});

test('explicit setup is idempotent and never enables continuous execution', t => {
  const root = mkdtempSync(join(tmpdir(), 'projecta-setup-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'projecta.dev.json'), source);
  const probe = () => ({ status: 0, stdout: '.githooks\n' });
  assert.deepEqual(setup(root, probe).changed, ['.pa/HQ-START.md']);
  assert.deepEqual(setup(root, probe).changed, []);
  assert.equal(JSON.parse(readFileSync(join(root, 'projecta.dev.json'))).continuous.enabled, false);
  assert.equal(readFileSync(join(root, 'projecta.dev.json'), 'utf8'), source);
});
