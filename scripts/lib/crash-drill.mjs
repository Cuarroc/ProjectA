// W3-03c: crash drill. Snapshot run/launch/delivery state from a temp copy of the
// live database (the live files are never opened), then judge the restart.
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBundle, sha256File } from './drill-kit.mjs';
export const TRANSITIONS = ['claimed', 'intent', 'process-starting', 'input-delivery', 'checkpoint', 'completion'];
const OPEN = ['intent', 'launched'];
const QUERIES = {
  runs: 'SELECT id, task_id, status, claim_fence, process_id, terminal_detail FROM development_runs ORDER BY id',
  launches: 'SELECT run_id, state, exit_code FROM development_launches ORDER BY run_id',
  deliveries: 'SELECT run_id, state FROM development_deliveries ORDER BY run_id',
  checkpoints: 'SELECT run_id, COUNT(*) AS n FROM development_capture_checkpoints GROUP BY run_id ORDER BY run_id',
};
export function snapshotState(dbPath) {
  const tmp = mkdtempSync(join(tmpdir(), 'projecta-crash-'));
  try {
    for (const s of ['', '-wal', '-shm']) if (existsSync(dbPath + s)) copyFileSync(dbPath + s, join(tmp, `projecta.db${s}`));
    const con = new DatabaseSync(join(tmp, 'projecta.db'), { readOnly: true });
    try {
      const tables = new Set(con.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
      return Object.fromEntries(Object.entries(QUERIES).map(([k, sql]) => [k, tables.has(sql.match(/FROM (\w+)/)[1]) ? con.prepare(sql).all().map((r) => ({ ...r })) : []]));
    } finally { con.close(); }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
// Judge a restart. `before` is the state left by the kill, `after` the state once
// the restarted app has settled. Every problem is one line; none means pass.
export function judgeRestart(before, after) {
  const problems = [];
  const open = before.runs.filter((r) => OPEN.includes(r.status));
  if (!open.length) problems.push('no open run (intent/launched) at the kill: the interrupt hit no transition');
  const now = new Map(after.runs.map((r) => [r.id, r]));
  for (const r of open) {
    const a = now.get(r.id);
    if (!a) problems.push(`run ${r.id} vanished`);
    else if (a.status === 'reconciling') continue;
    else if (a.status === 'failed' && a.terminal_detail) continue;
    else problems.push(`run ${r.id}: ${r.status} -> ${a.status}; expected reconciling (or failed with a reason)`);
  }
  const blocked = new Set(after.runs.filter((r) => r.status === 'reconciling').map((r) => r.task_id));
  const known = new Set(before.runs.map((r) => r.id));
  for (const r of after.runs) if (!known.has(r.id) && blocked.has(r.task_id)) problems.push(`redispatch: new run ${r.id} for task ${r.task_id} while an earlier run is reconciling`);
  const delivery = new Map(after.deliveries.map((d) => [d.run_id, d.state]));
  for (const d of before.deliveries) if (d.state === 'started' && delivery.get(d.run_id) === 'enqueued') problems.push(`run ${d.run_id}: delivery went started -> enqueued without a live process`);
  for (const r of before.runs) if (!OPEN.includes(r.status) && now.get(r.id)?.status !== r.status) problems.push(`run ${r.id}: ${r.status} -> ${now.get(r.id)?.status} (silent change)`);
  return problems;
}
export function runBefore({ appDir, outDir, appVersion, commit, transition, processList = '' }) {
  const bundle = createBundle({ outDir, drill: 'crash-before', appVersion, commit });
  const live = join(resolve(appDir), 'projecta.db');
  if (!TRANSITIONS.includes(transition)) bundle.step('check --transition', { exitCode: 1, detail: `one of: ${TRANSITIONS.join(', ')}` });
  else if (!existsSync(live)) bundle.step('find live database', { exitCode: 1, detail: `${live} not found` });
  else {
    const state = snapshotState(live);
    bundle.addFile('state.json', JSON.stringify({ transition, ...state }, null, 2));
    bundle.step('snapshot state after the kill (copy, read-only)', { detail: `transition ${transition}; ${state.runs.length} runs` });
  }
  if (processList) bundle.addFile('processes-before.txt', processList);
  return bundle.finish(NOT_COVERED);
}
export function runAfter({ appDir, beforeDir, outDir, appVersion, commit, processList = '' }) {
  const bundle = createBundle({ outDir, drill: 'crash', appVersion, commit });
  const live = join(resolve(appDir), 'projecta.db');
  const stateFile = join(beforeDir, 'state.json');
  if (!existsSync(stateFile) || !existsSync(live)) { bundle.step('find inputs', { exitCode: 1, detail: 'state.json of the before step or the database is missing' }); return bundle.finish(NOT_COVERED); }
  const hash = sha256File(live);
  const before = JSON.parse(readFileSync(stateFile, 'utf8'));
  const after = snapshotState(live);
  bundle.addFile('state-before.json', JSON.stringify(before, null, 2));
  bundle.addFile('state-after.json', JSON.stringify(after, null, 2));
  if (processList) bundle.addFile('processes-after.txt', processList);
  const problems = judgeRestart(before, after);
  bundle.step('judge restart: reconciling, no redispatch, no silent change', { command: `transition ${before.transition}`, exitCode: problems.length ? 1 : 0, detail: problems.join('; ') || 'ok' });
  bundle.step('live database file untouched by the script', { exitCode: sha256File(live) === hash ? 0 : 1, detail: 'main file hash equal during the check (the running app may still write its own WAL)' });
  return bundle.finish(NOT_COVERED);
}
export const NOT_COVERED = [
  'Real power loss: killing the process is the accepted proxy; OS/disk caches are not exercised.',
  'Transitions claimed, intent recorded, checkpoint and completion only exist for development runs, which need Continuous ON (frozen until M4); with Continuous OFF the drill only proves the failure to find an open run.',
  'Whether the restarted app has finished its own recovery pass is judged from one snapshot, not a time series.',
];
