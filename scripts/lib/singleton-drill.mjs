// W3-03b: singleton / multi-start drill. Pure evaluators plus a runner whose
// side effects (process scan, API call, prompts) are injected, so tests need no app.
import { createBundle } from './drill-kit.mjs';

export const PROCESS_NAME = /^projecta(\.exe)?$/i;
export const parseDescriptor = (text) => {
  const d = JSON.parse(text);
  if (!Number.isInteger(d.port) || d.port < 1 || d.port > 65535 || typeof d.token !== 'string' || !d.token) throw new Error('descriptor needs port and token');
  return { port: d.port, token: d.token };
};
// Keep ids and status only: task text and paths are private user data.
export const summarizeWorkers = (body) => (Array.isArray(body) ? body : [])
  .map((w) => ({ id: String(w.id), status: String(w.status ?? '') })).sort((a, b) => a.id.localeCompare(b.id));
export function summarizeProcesses({ processes = [], listeners = [] }) {
  const app = processes.filter((p) => PROCESS_NAME.test(p.name)).map((p) => ({ pid: p.pid, startedAt: p.startedAt ?? null }));
  const pids = new Set(app.map((p) => p.pid));
  const ports = [...new Set(listeners.filter((l) => pids.has(l.pid)).map((l) => l.port))].sort((a, b) => a - b);
  return { app, ports };
}
// One phase is judged on its own; `base` (the baseline) is only needed to compare.
export function evaluatePhase(phase, snap, base) {
  const problems = [];
  const { app, ports } = snap.processes;
  if (app.length !== 1) problems.push(`expected exactly 1 ProjectA process, found ${app.length}`);
  if (!snap.descriptor) problems.push('projecta-api.json missing');
  else if (!ports.includes(snap.descriptor.port)) problems.push('API descriptor port is not a listening port of the app');
  if (snap.api.error) problems.push(`API call failed: ${snap.api.error}`);
  if (base && phase === 'second-start') {
    if (app[0] && base.processes.app[0] && app[0].pid !== base.processes.app[0].pid) problems.push('the first process was replaced');
    if (JSON.stringify(ports) !== JSON.stringify(base.processes.ports)) problems.push('listening ports changed after the second start');
  }
  if (base && phase !== 'second-start') {
    const now = new Set(snap.api.workers.map((w) => w.id));
    const lost = base.api.workers.filter((w) => !now.has(w.id)).map((w) => w.id);
    if (lost.length) problems.push(`sessions no longer listed: ${lost.join(', ')}`);
  }
  if (phase === 'crash' && base && app[0] && app[0].pid === base.processes.app[0]?.pid) problems.push('same PID as before the crash: the process was not ended');
  return problems;
}
export const PHASES = [
  ['baseline', 'Starte ProjectA EINMAL und warte, bis das Fenster offen ist.'],
  ['second-start', 'Starte ProjectA ein ZWEITES Mal (Startmenue oder Desktop-Symbol). Es soll nur das alte Fenster nach vorn holen.'],
  ['crash', 'Beende ProjectA im Task-Manager (Rechtsklick, Task beenden). Starte es danach neu und warte, bis das Fenster offen ist.'],
  ['update-relaunch', 'Nur falls ein Update angeboten wird: Update installieren und "Neu starten" waehlen. Warte, bis das Fenster offen ist. Gibt es keines: Enter ohne Eingabe ueberspringt.', true],
];
export async function runSingletonDrill({ outDir, appVersion, commit, readDescriptor, scan, callApi, ask, now }) {
  const bundle = createBundle({ outDir, drill: 'singleton', appVersion, commit, ...(now && { now }) });
  const snaps = {};
  for (const [phase, text, optional] of PHASES) {
    if (optional && (await ask(`${text}\n[j = ausgefuehrt, Enter = ueberspringen]: `)).trim().toLowerCase() !== 'j') {
      bundle.step(`${phase} (skipped)`, { detail: 'no update was available' }); continue;
    }
    if (!optional) await ask(`${text}\n[Enter, wenn fertig]: `);
    const snap = { processes: summarizeProcesses(await scan()), descriptor: null, api: { workers: [], error: '' } };
    try {
      const d = parseDescriptor(await readDescriptor());
      snap.descriptor = { port: d.port };
      snap.api.workers = summarizeWorkers(await callApi(d));
    } catch (e) { snap.api.error = e.code === 'ENOENT' ? 'no descriptor file' : String(e.message ?? e); }
    snaps[phase] = snap;
    bundle.addFile(`snapshot-${phase}.json`, JSON.stringify(snap, null, 2));
    const problems = evaluatePhase(phase, snap, phase === 'baseline' ? null : snaps.baseline);
    bundle.step(phase, { command: 'process scan; GET /api/workers (read-only)', exitCode: problems.length ? 1 : 0,
      detail: problems.join('; ') || `1 process, ports ${snap.processes.ports.join(',')}, ${snap.api.workers.length} sessions` });
    if (phase === 'baseline' && problems.length) break;
  }
  return bundle.finish(NOT_COVERED);
}
export const NOT_COVERED = [
  'Screenshots (window raised, Task Manager) are taken by the user and are not part of the machine bundle.',
  'The update relaunch runs only if an update was offered; otherwise it is recorded as skipped.',
  'Only the installed Windows build is covered; other platforms and the portable build are not.',
];
