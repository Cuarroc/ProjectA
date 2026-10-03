import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CASES, TASKS, runDevelopmentBenchmark } from './dev-benchmark.mjs';
import { runTask } from '../fixtures/benchmark-worker.mjs';

test('w4-01 exposes exactly five fixed benchmark tasks', () => {
  assert.deepEqual(CASES, [
    'config-validation', 'dependency-order', 'budget-exhaustion',
    'review-invalidation', 'provider-unavailable',
  ]);
  assert.equal(TASKS.length, 5);
});

test('fixture adapter produces five passing results with durations', async () => {
  const result = await runDevelopmentBenchmark(runTask, 'fixture');
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.summary.passed, 5);
  assert.equal(result.summary.total, 5);
  assert.ok(result.summary.durationMs >= 0);
  assert.ok(result.tasks.every(({ passed, durationMs }) => passed && durationMs >= 0));
});

test('adapter errors and wrong answers are recorded without stopping later tasks', async () => {
  const result = await runDevelopmentBenchmark(async ({ id }) => {
    if (id === CASES[0]) throw new Error('fixture outage');
    return id === CASES[1] ? ['wrong'] : TASKS.find(task => task.id === id).expected;
  });
  assert.equal(result.summary.passed, 3);
  assert.equal(result.tasks[0].error, 'fixture outage');
  assert.equal(result.tasks[1].passed, false);
  assert.equal(result.tasks[4].passed, true);
});

test('cli writes the fixture result as JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecta-benchmark-'));
  const output = join(dir, 'result.json');
  try {
    const run = spawnSync(process.execPath, [
      'scripts/dev-benchmark.mjs', '--adapter', 'scripts/fixtures/benchmark-worker.mjs', '--output', output,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(result.summary.passed, 5);
    assert.equal(result.tasks.length, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
