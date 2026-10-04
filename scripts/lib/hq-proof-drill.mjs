// W3-08: read-only HQ-v1 proof drill; collects `pa hq runtime|context` output, IDs and screenshots.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createBundle, sha256File } from './drill-kit.mjs';
export const SCREENSHOTS = [
  'hq-hell-komfortabel.png', 'hq-hell-kompakt.png', 'hq-dunkel-komfortabel.png',
  'hq-dunkel-kompakt.png', 'diff-in-app.png',
];
export const MIN_TASKS = 3;
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;
const ID_KEYS = { runId: 'runIds', taskId: 'taskIds' };
// Task/run IDs come from JSON keys (never HTML); PR URLs from any text.
export function extractIds(text) {
  const ids = { runIds: new Set(), taskIds: new Set(), prUrls: new Set(text.match(PR_URL) ?? []) };
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v === null || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (ID_KEYS[k] && typeof x === 'string' && x) ids[ID_KEYS[k]].add(x);
      walk(x);
    }
  };
  try { walk(JSON.parse(text)); } catch { /* plain text: only PR URLs */ }
  return Object.fromEntries(Object.entries(ids).map(([k, s]) => [k, [...s].sort()]));
}
export const mergeIds = (list) => Object.fromEntries(['runIds', 'taskIds', 'prUrls']
  .map((k) => [k, [...new Set(list.flatMap((i) => i[k] ?? []))].sort()]));
const newOnly = (now, before) => Object.fromEntries(Object.entries(now).map(([k, v]) => [k, v.filter((x) => !(before[k] ?? []).includes(x))]));
export function defaultExec(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8', shell: false });
  return { status: r.error ? 127 : r.status ?? 1, stdout: r.stdout ?? '', stderr: r.error ? String(r.error.message) : r.stderr ?? '' };
}
export function runHqProof({ phase, outDir, projectId, paBin = 'pa', beforeDir, screenshotsDir, prUrls = [], appVersion, commit, processList = '', exec = defaultExec }) {
  const bundle = createBundle({ outDir, drill: `hq-proof-${phase}`, appVersion, commit });
  if (processList) bundle.addFile('processes.txt', processList);
  const seen = [{ prUrls }];
  for (const [name, args] of [['runtime', ['hq', 'runtime']], ['context', ['hq', 'context', '--project', projectId]]]) {
    const r = exec(paBin, args);
    bundle.addFile(`pa-hq-${name}.json`, r.stdout);
    if (r.stderr) bundle.addFile(`pa-hq-${name}.stderr.txt`, r.stderr);
    bundle.step(`pa hq ${name} (read-only)`, { command: `pa ${args.join(' ')}`, exitCode: r.status, detail: r.status ? 'pa failed; is the app running?' : '' });
    seen.push(extractIds(r.stdout));
  }
  const ids = mergeIds(seen);
  bundle.addFile('ids.json', JSON.stringify(ids, null, 2));
  if (phase === 'after') {
    const before = beforeDir && existsSync(join(beforeDir, 'ids.json')) ? JSON.parse(readFileSync(join(beforeDir, 'ids.json'), 'utf8')) : null;
    const fresh = before ? newOnly(ids, before) : null;
    if (fresh) bundle.addFile('ids-new.json', JSON.stringify(fresh, null, 2));
    const tasks = fresh ? Math.max(fresh.runIds.length, fresh.taskIds.length) : 0;
    bundle.step(`at least ${MIN_TASKS} new task/run IDs since before`, { exitCode: tasks >= MIN_TASKS ? 0 : 1, detail: before ? `${tasks} new` : 'before bundle (--before) missing or without ids.json' });
    bundle.step(`at least ${MIN_TASKS} new PR URLs`, { exitCode: fresh && fresh.prUrls.length >= MIN_TASKS ? 0 : 1, detail: `${fresh?.prUrls.length ?? 0} new; add missing ones with --pr` });
    const shots = join(outDir, 'screenshots');
    mkdirSync(shots);
    const missing = SCREENSHOTS.filter((f) => !screenshotsDir || !existsSync(join(screenshotsDir, f)) || statSync(join(screenshotsDir, f)).size === 0);
    for (const f of SCREENSHOTS.filter((x) => !missing.includes(x))) {
      copyFileSync(join(screenshotsDir, f), join(shots, f));
      bundle.recordSensitiveFile(`screenshots/${f}`, { bytes: statSync(join(shots, f)).size, sha256: sha256File(join(shots, f)) });
    }
    bundle.step('screenshots present (light/dark x density, diff)', { exitCode: missing.length ? 1 : 0, detail: missing.length ? `missing: ${missing.join(', ')}` : `${SCREENSHOTS.length} files` });
  }
  return bundle.finish(NOT_COVERED);
}
export const NOT_COVERED = [
  'Screenshots are checked for presence only; a human must look at them (readable, density differs).',
  'PR landing through the Mergify queue is not verified here; the URLs are listed, the user checks them on GitHub.',
  'The drill needs the INSTALLED app on the Windows PC; agents never launch it, so no Linux/CI run covers it.',
  'Task quality (the diff does what the template asks) is a human judgement, not scripted.',
];
