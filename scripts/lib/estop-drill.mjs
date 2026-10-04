// W3-03d: emergency-stop drill. Times "Not-Aus acknowledged by the API" until
// the observed worker process inventory is empty. Read-only towards the app:
// only `pa estop status` (GET /api/emergency-stop); the user triggers and releases the stop.
import { createBundle } from './drill-kit.mjs';

export const POLL_MS = 250;
export const LIMIT_MS = 15000;
export const PASS_MS = 10000;
// Children of the app that are not agent workers (the web view).
const IGNORED = /^(msedgewebview2|webview2|crashpad)/i;

// Output of `pa estop status`: "emergency stop: ACTIVE (...)" or "emergency stop: off".
export function parseEstopStatus(text) {
  if (/emergency stop: ACTIVE/.test(text)) return { active: true };
  if (/emergency stop: off/.test(text)) return { active: false };
  throw new Error('unrecognised `pa estop status` output');
}

// Rows: [{pid, ppid, name}]. Worker = any descendant of the app root process.
export function workerInventory(rows, rootName = 'projecta') {
  const roots = rows.filter((r) => r.name.toLowerCase().replace(/\.exe$/, '') === rootName.toLowerCase()).map((r) => r.pid);
  const known = new Set(roots);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows) if (!known.has(r.pid) && known.has(r.ppid)) { known.add(r.pid); grew = true; }
  }
  return rows.filter((r) => known.has(r.pid) && !roots.includes(r.pid) && !IGNORED.test(r.name));
}

// `ps -eo pid=,ppid=,comm=` or the JSON of Win32_Process (ProcessId, ParentProcessId, Name).
export function parseProcessRows(text) {
  const t = text.trim();
  if (t.startsWith('[') || t.startsWith('{')) {
    return [].concat(JSON.parse(t)).map((r) => ({ pid: r.ProcessId, ppid: r.ParentProcessId, name: String(r.Name) }));
  }
  return t.split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), name: m[3] }));
}

const fmt = (list) => list.map((p) => `${p.name} pid=${p.pid} parent=${p.ppid}`);
const processKey = (process) => `${process.pid}\0${process.name.toLowerCase()}`;

// deps: { getState(): Promise<{active}>, listProcesses(): Promise<row[]>, sleep(ms), now(): ms, notify(msg) }
export async function runEstopDrill({ outDir, appVersion, commit, rootName, deps, waitTriggerMs = 120000 }) {
  const { getState, listProcesses, sleep, now, notify } = deps;
  const bundle = createBundle({ outDir, drill: 'estop', appVersion, commit });
  const done = () => bundle.finish(NOT_COVERED);
  const fail = (name, detail) => { bundle.step(name, { exitCode: 1, detail }); return done(); };
  const before = await getState();
  const baseline = workerInventory(await listProcesses(), rootName);
  bundle.addFile('state-before.json', JSON.stringify(before));
  bundle.addFile('processes-before.txt', fmt(baseline).join('\n'));
  if (before.active) return fail('check stop is off before the drill', 'Not-Aus is already active; release it first');
  if (baseline.length === 0) return fail('check workers are running', 'no worker process under the app: start several workers first');
  const affected = new Set(baseline.map(processKey));
  bundle.step('snapshot before (API state, worker inventory)', { command: 'pa estop status', detail: `active=false, ${baseline.length} worker process(es)` });
  notify('Jetzt Not-Aus ausloesen (Knopf in der App oder `pa estop on`).');
  let t0 = now();
  let active = false;
  for (const start = t0; !active && now() - start < waitTriggerMs;) {
    const pollStartedAt = now();
    active = (await getState()).active;
    if (!active) { t0 = pollStartedAt; await sleep(POLL_MS); }
  }
  if (!active) return fail('wait for trigger acknowledgement', `no active=true within ${waitTriggerMs / 1000}s`);
  const triggerAt = new Date().toISOString();
  bundle.step('Not-Aus acknowledged by API', { command: 'pa estop status', detail: `active=true at ${triggerAt}` });
  let left = baseline;
  let elapsed = 0;
  const samples = [];
  for (;;) {
    const rows = await listProcesses();
    for (const process of workerInventory(rows, rootName)) affected.add(processKey(process));
    left = rows.filter((process) => affected.has(processKey(process)));
    elapsed = now() - t0;
    samples.push({ ms: elapsed, workers: left.length });
    if (left.length === 0 || elapsed >= LIMIT_MS) break;
    await sleep(POLL_MS);
  }
  bundle.addFile('processes-after.txt', fmt(left).join('\n'));
  bundle.addFile('samples.json', JSON.stringify(samples));
  const empty = left.length === 0;
  const ok = empty && elapsed <= PASS_MS;
  bundle.step('worker inventory empty within 10 s', {
    command: `poll every ${POLL_MS} ms up to ${LIMIT_MS / 1000} s`, exitCode: ok ? 0 : 1,
    detail: empty ? `empty after ${elapsed} ms (limit ${PASS_MS} ms)` : `${left.length} residual after ${elapsed} ms: ${fmt(left).join('; ')}`,
  });
  notify('Jetzt Not-Aus aufheben (Knopf oder `pa estop off --verdict-token ...`).');
  let release = await getState();
  for (const start = now(); release.active && now() - start < waitTriggerMs;) { await sleep(POLL_MS); release = await getState(); }
  bundle.addFile('state-after-release.json', JSON.stringify(release));
  bundle.step('Not-Aus state after release', { command: 'pa estop status', exitCode: release.active ? 1 : 0, detail: `active=${release.active}` });
  return done();
}

export const NOT_COVERED = [
  'The drill reads the process table only; it does not prove agents ended cleanly or that no work was lost.',
  'Timing starts at the beginning of the last status poll before active=true; it can conservatively overstate the duration by one poll plus status-call latency.',
  'Linux/macOS and the Tauri GUI are not exercised by tests; the Windows run is done by the user with the installed app.',
];
