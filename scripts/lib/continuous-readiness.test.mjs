import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateContinuousReadiness } from './continuous-readiness.mjs';
import { parseArgs, usage } from '../continuous-audit.mjs';

const ready = {
  setupReady: true,
  runtimeAccepted: true,
  providersAttested: true,
  schedulerAccepted: true,
  reviewAuthorityAccepted: true,
  deliveryAccepted: true,
  recoveryAccepted: true,
  rolloutAccepted: true,
  benchmarkAccepted: true,
  continuousExecutionEnabled: true,
  stablePromotionAuthorized: true,
};

test('readiness remains fail-closed when observations are missing', () => {
  const report = evaluateContinuousReadiness({ setup: {}, runtime: {}, evidence: {} });
  assert.equal(report.continuousEligible, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.phases[0].state, 'unavailable');
  assert.equal(report.attestations.providers.state, 'unavailable');
  assert.ok(report.blockers.some(blocker => blocker.id === 'configuration'));
  const providerBlocker = report.blockers.find(blocker => blocker.id === 'attestation:providers');
  assert.equal(providerBlocker.label, 'Provider adapters');
  assert.ok(report.blockers.every(blocker => blocker.label.length > 0));
  const keys = report.blockers.map(blocker => `${blocker.state}|${blocker.reason ?? ''}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('a reachable runtime does not bypass provider, review or recovery gates', () => {
  const report = evaluateContinuousReadiness({
    setup: { setupReady: true },
    runtime: { runtimeReady: true },
    evidence: { runtimeAccepted: true, providersAttested: false, schedulerAccepted: true },
  });
  assert.equal(report.phases.find(phase => phase.id === 'runtime').state, 'blocked');
  assert.equal(report.continuousEligible, false);
  assert.ok(report.blockers.some(blocker => blocker.id === 'attestation:reviewAuthority'));
});

test('all attested gates still require explicit enable and promotion decisions', () => {
  const report = evaluateContinuousReadiness({ setup: ready, runtime: { runtimeReady: true }, evidence: ready });
  assert.equal(report.continuousEligible, true);
  assert.equal(report.releaseEligible, true);
  assert.equal(report.continuousMode, 'eligible-but-disabled-until-explicit-enable');
  assert.deepEqual(report.blockers, []);
});

test('continuous audit accepts explicit output flags and rejects accidental execution flags', () => {
  assert.deepEqual(parseArgs(['--json']), { json: true, help: false });
  assert.deepEqual(parseArgs(['--help']), { json: false, help: true });
  assert.match(usage(), /dev:continuous-audit/);
  assert.throws(() => parseArgs(['--evidence', 'observations.json']), /unknown option/);
});
