// CLI entry of the crash drill (see docs/drills/crash-drill.md): phase before|after.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { defaultOutDir } from '../lib/drill-kit.mjs';
import { runAfter, runBefore } from '../lib/crash-drill.mjs';

const { positionals: [phase], values: v } = parseArgs({
  allowPositionals: true,
  options: {
    'app-dir': { type: 'string' }, out: { type: 'string' }, 'app-version': { type: 'string' }, commit: { type: 'string' },
    'process-list': { type: 'string' }, transition: { type: 'string' }, 'before-dir': { type: 'string' },
  },
});
if (!['before', 'after'].includes(phase) || !v['app-dir']) { console.error('FEHLER: crash-drill.mjs before|after --app-dir <ordner>'); process.exit(2); }
const outDir = v.out ?? defaultOutDir(`crash-drill-${phase}`);
const commit = v.commit ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8' }).trim();
const common = { appDir: v['app-dir'], outDir, appVersion: v['app-version'], commit, processList: v['process-list'] ? readFileSync(v['process-list'], 'utf8') : '' };
const manifest = phase === 'before'
  ? runBefore({ ...common, transition: v.transition })
  : runAfter({ ...common, beforeDir: v['before-dir'] ?? '' });
for (const s of manifest.steps) console.log(`${s.exitCode === 0 ? 'OK    ' : 'FEHLER'} ${s.n}. ${s.name}${s.detail ? ` - ${s.detail}` : ''}`);
console.log(`Ergebnis: ${manifest.result}. Beleg-Ordner: ${outDir}`);
process.exit(manifest.result === 'pass' ? 0 : 1);
