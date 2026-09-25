#!/usr/bin/env node
import { evaluateContinuousReadiness } from './lib/continuous-readiness.mjs';
import { doctor, inspectRuntime } from './dev-setup.mjs';
import { fileURLToPath } from 'node:url';

export function parseArgs(argv = []) {
  const options = { json: false, help: false };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

export function usage() {
  return 'usage: npm run dev:continuous-audit [-- --json|--help]';
}

export async function buildReport(root = process.cwd()) {
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
    },
  });
  return {
    schemaVersion: 1,
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
  const report = await buildReport();
  console.log(JSON.stringify(report, null, options.json ? 2 : 0));
  return report.continuousEligible && report.releaseEligible ? 0 : 1;
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
