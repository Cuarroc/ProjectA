// W3-03e: updater drill (success / cancel / failure with a persisted worker row).
// Polls GET /api/updater (W3-04 wire states), tolerates the app going away for
// the relaunch, and compares persisted worker rows and the recovery journal
// (update-recovery.json, W3-02) before and after. Read-only towards the data.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createBundle, sha256 } from './drill-kit.mjs';

export const SCENARIOS = ['success', 'cancel', 'fail'];
const TOKEN_HEADER = 'x-projecta-token';
// The token stays in memory only: callers get the port and a request function.
export function readDescriptor(appDir) {
  const file = join(resolve(appDir), 'projecta-api.json');
  if (!existsSync(file)) return null;
  const { port, token } = JSON.parse(readFileSync(file, 'utf8'));
  return { port, token };
}
export async function httpRequest(descriptor, path) {
  const res = await fetch(`http://127.0.0.1:${descriptor.port}${path}`, {
    headers: { [TOKEN_HEADER]: descriptor.token }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
}
export function summarizeJournal(appDir) {
  const file = join(resolve(appDir), 'update-recovery.json');
  if (!existsSync(file)) return { present: false };
  const raw = readFileSync(file);
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* keep unparsed */ }
  return { present: true, bytes: raw.length, sha256: sha256(raw), parsed: parsed !== null,
    phase: typeof parsed?.phase === 'string' ? parsed.phase : null, keys: parsed ? Object.keys(parsed).sort() : [] };
}
export const workerIds = (workers) => (Array.isArray(workers) ? workers : []).map((w) => String(w.id)).sort();
// "v1.5.1" and "1.5.1" are the same version; compare only through this.
export const normalizeVersion = (v) => String(v ?? '').trim().replace(/^v/i, '');
const sameVersion = (a, b) => normalizeVersion(a) === normalizeVersion(b);
const key = (s) => `${s.phase}|${s.version ?? ''}|${s.message ?? ''}`;
// One poll loop; `down` marks the gap in which the app was unreachable.
export async function watchUpdater({ read, scenario, timeoutMs, intervalMs = 2000, sleep, now = Date.now }) {
  const start = now();
  const transitions = [];
  let down = false, relaunched = false, last = null;
  while (now() - start < timeoutMs) {
    try {
      const s = await read();
      if (down) { relaunched = true; down = false; }
      if (!last || key(s) !== key(last)) transitions.push({ atMs: now() - start, ...s });
      last = s;
    } catch {
      if (!down && last) transitions.push({ atMs: now() - start, phase: 'unreachable' });
      down = down || last !== null;
    }
    const seen = transitions.map((t) => t.phase);
    const after = (p) => seen.slice(seen.indexOf(p) + 1);
    const done = scenario === 'success' ? relaunched && !down
      : scenario === 'fail' ? seen.includes('error')
        : seen.includes('installing') && after('installing').some((p) => ['available', 'idle', 'up-to-date'].includes(p));
    if (done) break;
    await sleep(intervalMs);
  }
  return { transitions, relaunched, elapsedMs: now() - start, last };
}
export function judge(scenario, w, { before, after }, { appVersion, newVersion, newCommit } = {}) {
  const seen = w.transitions.map((t) => t.phase);
  const problems = [];
  if (scenario === 'success') {
    if (!seen.includes('installing') && !seen.includes('ready')) problems.push('no installing/ready phase seen');
    if (!w.relaunched) problems.push('app never came back (no relaunch)');
    if (!['idle', 'up-to-date'].includes(w.last?.phase)) problems.push(`unexpected post-update state (last: ${w.last?.phase})`);
    // A relaunch alone is no update: the version reported afterwards must be the new one.
    const installed = w.last?.version;
    if (!installed) problems.push('no installed version reported after the update');
    else if (sameVersion(installed, appVersion)) problems.push(`version did not change (still ${normalizeVersion(installed)})`);
    else if (newVersion && newVersion !== 'unknown' && !sameVersion(installed, newVersion)) problems.push(`installed version ${normalizeVersion(installed)}, expected ${normalizeVersion(newVersion)}`);
    // The commit is compared only when both sides are known; both are reported on a mismatch.
    const got = w.last?.commit;
    if (newCommit && got && String(got).toLowerCase() !== String(newCommit).toLowerCase()) problems.push(`installed commit ${String(got).toLowerCase()}, expected ${String(newCommit).toLowerCase()}`);
  } else {
    if (w.relaunched) problems.push('app relaunched, but this scenario must not install');
    if (scenario === 'fail' && !w.transitions.some((t) => t.phase === 'error' && t.message)) problems.push('no error phase with a message');
    if (scenario === 'cancel' && !seen.includes('installing')) problems.push('update never started, nothing was cancelled');
    if (scenario === 'cancel' && !['available', 'idle', 'up-to-date'].includes(w.last?.phase)) problems.push(`not back to a resting phase (last: ${w.last?.phase})`);
    // In idle/up-to-date the reported version is the installed one (in `available` it is the offered one).
    const left = w.last?.version;
    if (scenario === 'cancel' && appVersion && left && ['idle', 'up-to-date'].includes(w.last?.phase) && !sameVersion(left, appVersion)) problems.push(`installed version ${normalizeVersion(left)} after cancel, expected ${normalizeVersion(appVersion)}`);
  }
  if (w.timedOut) problems.push('time limit reached');
  const lost = before.filter((id) => !after.includes(id));
  if (before.length === 0) problems.push('no worker record before the drill');
  if (lost.length) problems.push(`worker records missing afterwards: ${lost.join(', ')}`);
  return problems;
}
export async function runUpdaterDrill({ appDir, outDir, scenario, appVersion, newVersion = 'unknown', newCommit, commit, observedUi = '', processList = '',
  timeoutMs = 600000, request = httpRequest, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, intervalMs }) {
  if (!SCENARIOS.includes(scenario)) throw new Error(`scenario must be one of ${SCENARIOS.join(', ')}`);
  const bundle = createBundle({ outDir, drill: `updater-${scenario}`, appVersion, commit });
  const get = (path) => { const d = readDescriptor(appDir); if (!d) throw new Error('projecta-api.json missing'); return request(d, path); };
  const fail = (name, detail) => { bundle.step(name, { exitCode: 1, detail }); return bundle.finish(NOT_COVERED); };
  if (processList) bundle.addFile('processes.txt', processList);
  let before;
  try { before = workerIds(await get('/api/workers')); } catch (e) { return fail('list workers before', `${e.message} (is the app running?)`); }
  const journalBefore = summarizeJournal(appDir);
  bundle.addFile('before.json', JSON.stringify({ appVersion, workers: before, journal: journalBefore }, null, 2));
  bundle.step('snapshot before (read-only API + journal)', { command: 'GET /api/workers', detail: `${before.length} worker record(s), journal ${journalBefore.present ? 'present' : 'absent'}` });
  const w = await watchUpdater({ read: () => get('/api/updater'), scenario, timeoutMs, intervalMs, sleep, now });
  w.timedOut = w.elapsedMs >= timeoutMs;
  bundle.addFile('updater-phases.json', JSON.stringify(w, null, 2));
  bundle.step('watch updater phases', { command: 'GET /api/updater (polling)', detail: w.transitions.map((t) => t.phase).join(' > ') || 'nothing seen' });
  let after = [];
  try { after = workerIds(await get('/api/workers')); } catch (e) { bundle.step('list workers after', { exitCode: 1, detail: e.message }); }
  const journalAfter = summarizeJournal(appDir);
  bundle.addFile('after.json', JSON.stringify({ newVersion, observedUi, workers: after, journal: journalAfter }, null, 2));
  const problems = judge(scenario, w, { before, after }, { appVersion, newVersion, newCommit });
  bundle.step(`judge ${scenario}`, { exitCode: problems.length ? 1 : 0, detail: problems.join('; ') || `ok in ${Math.round(w.elapsedMs / 1000)} s, relaunch ${w.relaunched}` });
  return bundle.finish(NOT_COVERED);
}
export const NOT_COVERED = [
  'Signed production build and signature check (W3-07, user): a beta/dev build proves the flow, not the signed release.',
  'Real network cut for the failure case is done by hand (flight mode); the script only watches the phases.',
  'Recovery journal entries appear only if the installed build already writes update-recovery.json; absent means not wired yet.',
  'Phase text shown in the window and in HQ is typed in by the user (--observed-ui), not read by the script.',
];
