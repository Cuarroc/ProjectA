// Fail-closed phase evaluation for the continuous-development contract.
// This module only combines observations supplied by trusted callers; it
// never upgrades an unavailable observation into a passing gate.

const PHASES = Object.freeze([
  ['configuration', 'Shared configuration and setup doctor'],
  ['machineInterface', 'Versioned HQ and pa machine interface'],
  ['runtime', 'Durable scheduler, teams and provider routing'],
  ['delivery', 'Candidate integration and staged delivery'],
  ['rollout', 'Measured rollout and quality comparison'],
]);

const ATTESTATION_LABELS = Object.freeze({
  providers: 'Provider adapters',
  scheduler: 'Continuous scheduler',
  reviewAuthority: 'Review authority',
  recovery: 'Update recovery',
  benchmark: 'Benchmark comparison',
});

const state = (value, reason) => ({ state: value, ...(reason ? { reason } : {}) });

function observed(value, key) {
  return value && typeof value === 'object' && value[key] === true;
}

function explicitState(value, key, label) {
  if (!value || typeof value !== 'object') return state('unavailable', `${label} observation missing`);
  if (value[key] === true) return state('ready');
  if (value[key] === false) return state('blocked', `${label} is not attested`);
  return state('unavailable', `${label} observation is unavailable`);
}

/**
 * Derive a bounded readiness report from independently observed inputs.
 * `evidence` is intentionally caller supplied so this function cannot imply
 * that local setup or a reachable API proves provider/release acceptance.
 */
export function evaluateContinuousReadiness({ setup, runtime, evidence = {} } = {}) {
  const phases = {
    configuration: explicitState(setup, 'setupReady', 'setup'),
    machineInterface: explicitState(runtime, 'runtimeReady', 'HQ runtime'),
    runtime: explicitState(evidence, 'runtimeAccepted', 'runtime execution'),
    delivery: explicitState(evidence, 'deliveryAccepted', 'staged delivery'),
    rollout: explicitState(evidence, 'rolloutAccepted', 'rollout measurement'),
  };

  const providerState = explicitState(evidence, 'providersAttested', 'provider adapters');
  const schedulerState = explicitState(evidence, 'schedulerAccepted', 'continuous scheduler');
  const reviewState = explicitState(evidence, 'reviewAuthorityAccepted', 'review authority');
  const recoveryState = explicitState(evidence, 'recoveryAccepted', 'update recovery');
  const benchmarkState = explicitState(evidence, 'benchmarkAccepted', 'benchmark comparison');

  // A runtime endpoint can be reachable while execution remains unsafe. The
  // phase stays blocked until every required attestation is independently
  // recorded in the supplied evidence bundle.
  if (phases.runtime.state === 'ready') {
    for (const requirement of [providerState, schedulerState, reviewState]) {
      if (requirement.state !== 'ready') {
        phases.runtime = requirement.state === 'unavailable'
          ? state('unavailable', requirement.reason)
          : state('blocked', requirement.reason);
        break;
      }
    }
  }
  if (phases.delivery.state === 'ready' && recoveryState.state !== 'ready') {
    phases.delivery = recoveryState.state === 'unavailable'
      ? state('unavailable', recoveryState.reason)
      : state('blocked', recoveryState.reason);
  }
  if (phases.rollout.state === 'ready' && benchmarkState.state !== 'ready') {
    phases.rollout = benchmarkState.state === 'unavailable'
      ? state('unavailable', benchmarkState.reason)
      : state('blocked', benchmarkState.reason);
  }

  const allReady = Object.values(phases).every(phase => phase.state === 'ready');
  const continuousEligible = allReady && observed(evidence, 'continuousExecutionEnabled');
  const releaseEligible = continuousEligible && observed(evidence, 'stablePromotionAuthorized');
  const attestations = {
    providers: providerState,
    scheduler: schedulerState,
    reviewAuthority: reviewState,
    recovery: recoveryState,
    benchmark: benchmarkState,
  };
  const blockers = [];
  const seenBlockers = new Set();
  for (const [id, value] of Object.entries(phases)) {
    if (value.state === 'ready') continue;
    const blocker = { id, label: PHASES.find(([phase]) => phase === id)?.[1] ?? id, ...value };
    const key = `${blocker.state}|${blocker.reason ?? ''}`;
    if (!seenBlockers.has(key)) {
      seenBlockers.add(key);
      blockers.push(blocker);
    }
  }
  for (const [id, value] of Object.entries(attestations)) {
    if (value.state === 'ready') continue;
    const blocker = { id: `attestation:${id}`, label: ATTESTATION_LABELS[id] ?? id, ...value };
    const key = `${blocker.state}|${blocker.reason ?? ''}`;
    if (!seenBlockers.has(key)) {
      seenBlockers.add(key);
      blockers.push(blocker);
    }
  }
  return {
    schemaVersion: 1,
    source: 'local-read-only-observations',
    phases: PHASES.map(([id, label]) => ({ id, label, ...phases[id] })),
    attestations,
    blockers,
    continuousEligible,
    releaseEligible,
    continuousMode: continuousEligible ? 'eligible-but-disabled-until-explicit-enable' : 'blocked',
    stableRelease: releaseEligible ? 'eligible-after-explicit-release' : 'blocked',
  };
}
