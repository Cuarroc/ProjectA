import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES, compareDevelopmentRuns } from './dev-benchmark.mjs';
const rows = (prefix, tokens, elapsedMs) => CASES.map(caseId => ({ caseId, runId: `${prefix}-${caseId}`, source: 'measured', evidence: 'fixture-test-only', tokens, elapsedMs, accepted: true, reviewRejections: 0, rework: 0, escapedRegressions: 0 }));
test('benchmark refuses incomplete or estimated telemetry', () => {
  assert.throws(() => compareDevelopmentRuns([], []), /20/);
  const base = rows('base', 1000, 1000), next = rows('next', 700, 700);
  next[0].tokens = null; assert.throws(() => compareDevelopmentRuns(base, next), /tokens/);
  next[0].tokens = 700; next[0].source = 'estimated'; assert.throws(() => compareDevelopmentRuns(base, next), /measured/);
});
test('benchmark preserves prior routing when quality or speed regresses', () => {
  const base = rows('base', 1000, 1000), next = rows('next', 700, 700);
  assert.equal(compareDevelopmentRuns(base, next).targetAssessment, 'targets-met-unverified');
  assert.equal(compareDevelopmentRuns(base, next).evidenceVerified, false);
  assert.equal(compareDevelopmentRuns(base, next).recommendation, 'retain-previous-policy');
  next[0].escapedRegressions = 1;
  assert.equal(compareDevelopmentRuns(base, next).recommendation, 'retain-previous-policy');
  assert.equal(compareDevelopmentRuns(base, rows('slow', 700, 1100)).recommendation, 'retain-previous-policy');
});
test('benchmark cannot compare one run to itself or trade acceptance between cases', () => {
  const base = rows('base', 1000, 1000);
  assert.throws(() => compareDevelopmentRuns(base, base), /separate/);
  const next = rows('next', 700, 700); base[0].accepted = false; next[1].accepted = false;
  assert.equal(compareDevelopmentRuns(base, next).qualityPreserved, false);
});
