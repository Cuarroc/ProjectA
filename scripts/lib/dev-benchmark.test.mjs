import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES } from './dev-benchmark.mjs';

test('w4-01 exposes exactly five fixed benchmark tasks', () => {
  assert.equal(CASES.length, 5);
});
