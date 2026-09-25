// W5-28: the pure decisions behind scripts/runtime-proof.mjs — sandbox
// layout, the pass/fail verdict, and the retention limit on proof runs.
// Everything here is free of I/O so node:test can pin it down.
import { join } from 'node:path';

/// How many proof runs stay on disk; older ones are deleted (the plan's
// retention limit, so screenshots and logs cannot grow without bound).
export const KEEP_RUNS = 10;

// The log line the app writes when the dispatcher is switched off
// (PROJECTA_QUEUE=off, src-tauri/src/queue.rs). The verdict demands it:
// without the line, "nothing dispatched" could also mean "the dispatcher
// never looked", and the proof would say nothing about the switch.
export const DISPATCH_DISABLED_LOG = 'queue dispatcher disabled';

// Filename-safe UTC stamp that sorts like time ('2026-09-25T10-00-00.000Z').
export function runStamp(date = new Date()) {
  return date.toISOString().replace(/:/g, '-');
}

// Every artifact of one run lives under its own directory, so a run can be
// deleted as one unit and no two runs ever share a file.
export function proofLayout(root, stamp) {
  const runDir = join(root, stamp);
  return {
    runDir,
    appData: join(runDir, 'appdata'),
    scratchRepo: join(runDir, 'scratch-repo'),
    descriptor: join(runDir, 'appdata', 'projecta-api.json'),
    proofJson: join(runDir, 'proof.json'),
    appLog: join(runDir, 'projecta.log'),
    screenshot: join(runDir, 'window.png'),
  };
}

// The M1 acceptance as a pure function over the facts the driver collected:
// the app started (twice, so the second start faced old queue entries),
// every seeded entry stayed ready, no worker exists, the log proves the
// switch was honored, and — when required — the window was photographed.
export function evaluateProof({ phase1, phase2, logText, screenshot, requireScreenshot }) {
  const failures = [];
  if (!phase1?.descriptorSeen) failures.push('phase 1: the app never published its api descriptor');
  if (!phase2?.descriptorSeen) failures.push('phase 2: the restart never published its api descriptor');
  if (!phase1?.seeded) failures.push('phase 1: no old queue entries were seeded, the proof is empty');
  for (const entry of phase2?.entries ?? []) {
    if (entry.status !== 'ready') failures.push(`queue entry ${entry.id} left ready: ${entry.status}`);
  }
  if ((phase2?.workers ?? []).length > 0) failures.push(`${phase2.workers.length} worker(s) exist after the restart`);
  if (!(logText ?? '').includes(DISPATCH_DISABLED_LOG)) {
    failures.push(`the app log lacks "${DISPATCH_DISABLED_LOG}" — the queue-off switch is unproven`);
  }
  if (requireScreenshot && !screenshot?.ok) {
    failures.push(`screenshot failed: ${screenshot?.reason ?? 'not attempted'}`);
  }
  return { ok: failures.length === 0, failures };
}

// Retention: names sort like time (runStamp), so the newest `keep` survive
// and the rest are returned for deletion.
export function selectRunsToDelete(runNames, keep = KEEP_RUNS) {
  if (!Number.isSafeInteger(keep) || keep < 1) throw new Error(`keep must be a positive integer, got ${keep}`);
  return [...runNames].sort().reverse().slice(keep);
}
