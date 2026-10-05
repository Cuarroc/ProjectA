#!/usr/bin/env node
import { evaluateContinuousReadiness } from './lib/continuous-readiness.mjs';
import { loadReleaseAttestation } from './lib/release-attestation.mjs';
import { doctor, inspectRuntime } from './dev-setup.mjs';
import { fileURLToPath } from 'node:url';

export function parseArgs(argv = []) {
  const options = { json: false, help: false, attestation: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--attestation') {
      options.attestation = argv[++i];
      if (!options.attestation) throw new Error('--attestation needs a path');
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

export function usage() {
  return 'usage: npm run dev:continuous-audit [-- --json|--help|--attestation <path>]';
}

export async function buildReport(root = process.cwd(), { attestation = null } = {}) {
  const appRelease = attestation
    ? loadReleaseAttestation(attestation, root)
    : { attested: false, reason: 'no --attestation given' };
  const setup = doctor(root);
  const runtime = await inspectRuntime();
  const readiness = evaluateContinuousReadiness({
    setup,
    runtime: { runtimeReady: runtime.state === 'ok' },
    evidence: {
      // These are deliberately absent until the corresponding trusted
      // operational evidence exists. Installed executables and a reachable
      // API are not provider or scheduler attestations.
      providersAttested: false,
      runtimeAccepted: false,
      schedulerAccepted: false,
      reviewAuthorityAccepted: false,
      deliveryAccepted: false,
      recoveryAccepted: false,
      rolloutAccepted: false,
      benchmarkAccepted: false,
      continuousExecutionEnabled: false,
      stablePromotionAuthorized: false,
      // Written only by the user in .pa/release_attestation_v1.5.1.json (E20).
      appReleaseAttested: appRelease.attested,
    },
  });
  if (!appRelease.attested) {
    const blocker = readiness.blockers.find(item => item.id === 'attestation:appRelease');
    if (blocker) blocker.reason = appRelease.reason;
    readiness.attestations.appRelease.reason = appRelease.reason;
  }
  return {
    generatedAt: new Date().toISOString(),
    command: 'dev:continuous-audit',
    ...readiness,
    setup,
    runtime,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const report = await buildReport(process.cwd(), options);
  console.log(JSON.stringify(report, null, options.json ? 2 : 0));
  return report.appReleaseEligible ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const exitCode = await main();
    if (exitCode) process.exitCode = exitCode;
  } catch (error) {
    console.error(JSON.stringify({ error: error.message, usage: usage() }));
    process.exitCode = 1;
  }
}
