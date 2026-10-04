// W3-03f: RAM-pressure drill. Samples OS memory and the read-only capacity
// snapshot; thresholds mirror src-tauri/src/store/continuous_capacity.rs.
import { createBundle } from './drill-kit.mjs';
const MIB = 1024 * 1024;
export const MAX_WORKERS = 2;
export const NOT_COVERED = [
  'Admission only exists with Continuous ON; with it OFF (v1.5.0 default) no limit is enforced, so rows of this drill prove nothing about claims.',
  'Unavailable memory measurement cannot be provoked on a PC; fail-closed limit 1 is only checked if a sample happens to show it (Rust unit test covers it).',
  'Worker survival is read from the claim count, not from OS process tracking per worker.',
  'Windows GUI and the installed-app launch are driven by the user; agents never start the app.',
];
// Same decision table as `assess` in continuous_capacity.rs.
export function expectedLimit(total, available) {
  if (!(total > 0) || !(available >= 0) || available > total) return { limit: 1, reason: 'memory_unavailable' };
  if (available < 512 * MIB || available * 100 < total * 5) return { limit: 0, reason: 'critical_memory_pressure' };
  if (available < 2048 * MIB || available * 100 < total * 15) return { limit: 1, reason: 'memory_pressure' };
  return { limit: MAX_WORKERS, reason: 'normal' };
}
// Pull the admission fields out of GET /api/hq/v1/context; null when absent.
export function parseSnapshot(body) {
  const admission = body?.effectiveLimits?.hostAdmission;
  const mem = admission?.memory;
  if (!mem || typeof mem.limit !== 'number') return null;
  return { limit: mem.limit, reason: mem.reason, state: mem.state, totalBytes: mem.totalBytes ?? null,
    availableBytes: mem.availableBytes ?? null, activeClaims: Number(admission.activeClaims ?? 0) };
}
export const stageOf = (limit) => (limit === 0 ? 'critical' : limit === 1 ? 'limited' : 'normal');
// Verdicts over the recorded samples (each: {t, os, snapshots: {project: parsed|null}}).
export function evaluate(samples, continuous) {
  const rows = samples.flatMap((s) => Object.entries(s.snapshots).map(([project, snap]) => ({ t: s.t, project, snap })));
  const seen = rows.filter((r) => r.snap);
  const problems = [];
  const stages = new Set();
  for (const { t, project, snap } of seen) {
    if (snap.state === 'unavailable') {
      if (snap.limit !== 1) problems.push(`${t} ${project}: unavailable measurement gave limit ${snap.limit}, expected 1`);
      stages.add('unavailable'); continue;
    }
    const want = expectedLimit(snap.totalBytes, snap.availableBytes);
    if (snap.limit !== want.limit) problems.push(`${t} ${project}: limit ${snap.limit} for ${snap.availableBytes}/${snap.totalBytes} bytes, expected ${want.limit}`);
    stages.add(stageOf(snap.limit));
  }
  const claims = seen.map((r) => r.snap.activeClaims);
  const critical = seen.filter((r) => r.snap.limit === 0).map((r) => r.snap.activeClaims);
  const apiErrors = rows.length - seen.length;
  if (continuous) {
    if (claims.length && claims[0] < 1) problems.push('no admitted work at start: nothing to observe');
    if (claims.length && claims.at(-1) < claims[0]) problems.push(`claims fell from ${claims[0]} to ${claims.at(-1)}: existing work was reclaimed`);
    if (critical.length && Math.max(...critical) > critical[0]) problems.push(`claim count rose at critical (${critical[0]} -> ${Math.max(...critical)})`);
    for (const st of ['normal', 'limited', 'critical']) if (!stages.has(st)) problems.push(`stage not reached: ${st}`);
  }
  if (apiErrors) problems.push(seen.length ? `${apiErrors} capacity snapshot(s) could not be read` : 'no capacity snapshot could be read');
  return { problems, stages: [...stages], samples: samples.length, apiErrors,
    claimsFirst: claims[0] ?? null, claimsLast: claims.at(-1) ?? null, minOsAvailableBytes: Math.min(...samples.map((s) => s.os.availableBytes)) };
}
export async function runCapacityDrill({ outDir, appVersion, commit, projects, continuous = false, durationSec = 600, intervalMs = 2000,
  readOs, fetchSnapshot, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => new Date(), processList = '' }) {
  const bundle = createBundle({ outDir, drill: 'capacity', appVersion, commit, now });
  if (processList) bundle.addFile('processes.txt', processList);
  const samples = [];
  const end = now().getTime() + Math.min(durationSec, 600) * 1000;
  do {
    const snapshots = {};
    for (const p of projects) { try { snapshots[p] = parseSnapshot(await fetchSnapshot(p)); } catch { snapshots[p] = null; } }
    samples.push({ t: now().toISOString(), os: readOs(), snapshots });
    if (now().getTime() + intervalMs <= end) await sleep(intervalMs); else break;
  } while (true);
  bundle.addFile('samples.json', JSON.stringify(samples, null, 2));
  bundle.step('sample OS memory + capacity snapshot (read-only)', { command: `GET /api/hq/v1/context every ${intervalMs} ms`, detail: `${samples.length} samples, projects: ${projects.length}` });
  const verdict = evaluate(samples, continuous);
  bundle.addFile('verdict.json', JSON.stringify({ continuous, ...verdict }, null, 2));
  bundle.step(continuous ? 'admission limits 2/1/0, no new claim at critical, no reclaim' : 'observation only (Continuous OFF): no admission verdict',
    { exitCode: verdict.apiErrors || (continuous && verdict.problems.length) ? 1 : 0, detail: verdict.problems.join('; ') || `stages: ${verdict.stages.join(',')}` });
  return bundle.finish(continuous ? NOT_COVERED.slice(1) : NOT_COVERED);
}
