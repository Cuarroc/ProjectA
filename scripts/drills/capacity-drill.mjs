// CLI entry of the RAM-pressure drill (see docs/drills/capacity-drill.md).
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { defaultOutDir } from '../lib/drill-kit.mjs';
import { runCapacityDrill } from '../lib/capacity-drill.mjs';

const { values: v } = parseArgs({
  options: { pa: { type: 'string', default: 'pa' }, project: { type: 'string', multiple: true }, out: { type: 'string' },
    'app-version': { type: 'string' }, commit: { type: 'string' }, 'process-list': { type: 'string' },
    continuous: { type: 'string', default: 'off' }, seconds: { type: 'string', default: '600' } },
});
if (!v.project?.length) { console.error('FEHLER: mindestens ein --project fehlt'); process.exit(2); }
// The pa CLI is the canonical HQ client: it reads the API descriptor itself, so no token passes through here.
const run = promisify(execFile);
const commit = v.commit ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8' }).trim();
const outDir = v.out ?? defaultOutDir('capacity-drill');
const manifest = await runCapacityDrill({
  outDir, appVersion: v['app-version'], commit, projects: v.project,
  continuous: v.continuous === 'on', durationSec: Number(v.seconds),
  readOs: () => ({ totalBytes: totalmem(), availableBytes: freemem() }),
  fetchSnapshot: async (p) => JSON.parse((await run(v.pa, ['hq', 'context', '--project', p, '--cursor', '0'], { timeout: 5000 })).stdout),
  processList: v['process-list'] ? readFileSync(v['process-list'], 'utf8') : '',
});
for (const s of manifest.steps) console.log(`${s.exitCode === 0 ? 'OK    ' : 'FEHLER'} ${s.n}. ${s.name}${s.detail ? ` - ${s.detail}` : ''}`);
console.log(`Ergebnis: ${manifest.result}${v.continuous === 'on' ? '' : ' (nur Beobachtung, KEIN Nachweis fuer Matrixzeile 10)'}. Beleg-Ordner: ${outDir}`);
process.exit(manifest.result === 'pass' ? 0 : 1);
