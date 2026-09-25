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
    webview: join(runDir, 'webview-profile'),
    descriptor: join(runDir, 'appdata', 'projecta-api.json'),
    proofJson: join(runDir, 'proof.json'),
    appLog: join(runDir, 'projecta.log'),
    screenshot: join(runDir, 'window.png'),
  };
}

// The environment one sandboxed app start needs. Besides the queue switch
// and the app-data redirect this pins the WebView2 user data folder into
// the run directory (grok G1): wry passes no user-data-folder when
// tauri.conf.json has no dataDirectory, so without this override WebView2
// falls back to a profile keyed only by the bundle identifier — a
// default-identifier proof binary would read and write the production
// profile (localStorage) and taskkill /F would be an unclean exit against
// it. WEBVIEW2_USER_DATA_FOLDER applies exactly when no folder is passed,
// which is this app's case.
export function proofEnv(layout) {
  return {
    PROJECTA_APP_DATA: layout.appData,
    PROJECTA_QUEUE: 'off',
    WEBVIEW2_USER_DATA_FOLDER: layout.webview,
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
  // glm-5.2 F1: a non-array or short answer must never pass — with zero
  // entries the loop below would find nothing to complain about, which is
  // exactly the "old jobs vanished into an agent" case the proof excludes.
  if (!Array.isArray(phase2?.entries)) {
    failures.push('phase 2: the queue answer was not an array — the proof read garbage');
  } else {
    if (phase2.entries.length < (phase1?.seeded ?? 0)) {
      failures.push(`phase 2: ${phase2.entries.length} entries came back, ${phase1?.seeded ?? 0} were seeded — old jobs are missing`);
    }
    for (const entry of phase2.entries) {
      if (entry.status !== 'ready') failures.push(`queue entry ${entry.id} left ready: ${entry.status}`);
    }
  }
  if (!Array.isArray(phase2?.workers)) {
    failures.push('phase 2: the workers answer was not an array — the proof read garbage');
  } else if (phase2.workers.length > 0) {
    failures.push(`${phase2.workers.length} worker(s) exist after the restart`);
  }
  if (!(logText ?? '').includes(DISPATCH_DISABLED_LOG)) {
    failures.push(`the app log lacks "${DISPATCH_DISABLED_LOG}" — the queue-off switch is unproven`);
  }
  if (requireScreenshot && !screenshot?.ok) {
    failures.push(`screenshot failed: ${screenshot?.reason ?? 'not attempted'}`);
  }
  return { ok: failures.length === 0, failures };
}

// A run directory is named by runStamp; anything else under the proof root
// is not ours and retention must not touch it (glm-5.2 F2).
export const RUN_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/;

// Retention: names sort like time (runStamp), so the newest `keep` survive
// and the rest are returned for deletion.
export function selectRunsToDelete(runNames, keep = KEEP_RUNS) {
  if (!Number.isSafeInteger(keep) || keep < 1) throw new Error(`keep must be a positive integer, got ${keep}`);
  const runs = runNames.filter((name) => RUN_NAME_PATTERN.test(name));
  return [...runs].sort().reverse().slice(keep);
}
