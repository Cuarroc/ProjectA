// CLI entry of the emergency-stop drill (see docs/drills/estop-drill.md).
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { defaultOutDir } from '../lib/drill-kit.mjs';
import { parseEstopStatus, parseProcessRows, runEstopDrill } from '../lib/estop-drill.mjs';

const { values: v } = parseArgs({
  options: { 'app-dir': { type: 'string' }, pa: { type: 'string' }, out: { type: 'string' }, 'app-version': { type: 'string' }, commit: { type: 'string' }, 'root-name': { type: 'string' } },
});
if (!v['app-dir']) { console.error('FEHLER: --app-dir fehlt'); process.exit(2); }
// `pa estop status` reads the descriptor itself: the token never enters this script.
const getState = async () => parseEstopStatus(execFileSync(v.pa ?? 'pa', ['estop', 'status'],
  { encoding: 'utf8', env: { ...process.env, PROJECTA_APP_DATA: v['app-dir'] } }));
const listProcesses = async () => parseProcessRows(process.platform === 'win32'
  ? execFileSync('pwsh', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  : execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf8' }));
const commit = v.commit ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8' }).trim();
const manifest = await runEstopDrill({
  outDir: v.out ?? defaultOutDir('estop-drill'), appVersion: v['app-version'], commit, rootName: v['root-name'] ?? 'projecta',
  deps: { getState, listProcesses, sleep, now: () => Date.now(), notify: (m) => console.log(`>>> ${m}`) },
});
for (const s of manifest.steps) console.log(`${s.exitCode === 0 ? 'OK    ' : 'FEHLER'} ${s.n}. ${s.name}${s.detail ? ` - ${s.detail}` : ''}`);
console.log(`Ergebnis: ${manifest.result}`);
process.exit(manifest.result === 'pass' ? 0 : 1);
