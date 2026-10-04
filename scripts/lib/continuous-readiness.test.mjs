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
  appReleaseAttested: true,
};

test('readiness remains fail-closed when observations are missing', () => {
  const report = evaluateContinuousReadiness({ setup: {}, runtime: {}, evidence: {} });
  assert.equal(report.continuousEligible, false);
  assert.equal(report.continuousReleaseEligible, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.appReleaseEligible, false);
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
  assert.equal(report.continuousReleaseEligible, true);
  assert.equal(report.releaseEligible, report.continuousReleaseEligible);
  assert.equal(report.appReleaseEligible, true);
  assert.equal(report.continuousMode, 'eligible-but-disabled-until-explicit-enable');
  assert.deepEqual(report.blockers, []);
});

const appOnly = {
  setup: { setupReady: true },
  runtime: { runtimeReady: true },
};

test('app release is blocked without the user attestation', () => {
  const report = evaluateContinuousReadiness({ ...appOnly, evidence: {} });
  assert.equal(report.appReleaseEligible, false);
  assert.equal(report.appRelease, 'blocked');
  assert.ok(report.blockers.some(blocker => blocker.id === 'attestation:appRelease'));
  const denied = evaluateContinuousReadiness({ ...appOnly, evidence: { appReleaseAttested: false } });
  assert.equal(denied.appReleaseEligible, false);
});

test('app release attestation does not make continuous mode release-eligible', () => {
  const report = evaluateContinuousReadiness({ ...appOnly, evidence: { appReleaseAttested: true } });
  assert.equal(report.appReleaseEligible, true);
  assert.equal(report.appRelease, 'eligible-after-explicit-release');
  assert.equal(report.continuousReleaseEligible, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.continuousEligible, false);
  assert.equal(report.continuousMode, 'blocked');
  assert.ok(!report.blockers.some(blocker => blocker.id === 'attestation:appRelease'));
});

test('app release still needs configuration and machine interface', () => {
  const report = evaluateContinuousReadiness({
    setup: { setupReady: false }, runtime: { runtimeReady: true }, evidence: { appReleaseAttested: true },
  });
  assert.equal(report.appReleaseEligible, false);
});

test('readiness report is schema version 2', () => {
  assert.equal(evaluateContinuousReadiness().schemaVersion, 2);
});

test('continuous audit accepts explicit output flags and rejects accidental execution flags', () => {
  assert.deepEqual(parseArgs(['--json']), { json: true, help: false, attestation: null });
  assert.deepEqual(parseArgs(['--help']), { json: false, help: true, attestation: null });
  assert.match(usage(), /dev:continuous-audit/);
  assert.throws(() => parseArgs(['--evidence', 'observations.json']), /unknown option/);
  assert.equal(parseArgs(['--attestation', 'a.json']).attestation, 'a.json');
  assert.throws(() => parseArgs(['--attestation']), /needs a path/);
});
