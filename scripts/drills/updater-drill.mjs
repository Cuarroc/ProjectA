// CLI entry of the updater drill (see docs/drills/updater-drill.md).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { defaultOutDir } from '../lib/drill-kit.mjs';
import { runUpdaterDrill } from '../lib/updater-drill.mjs';

const { values: v } = parseArgs({
  options: {
    'app-dir': { type: 'string' }, out: { type: 'string' }, scenario: { type: 'string' },
    'old-version': { type: 'string' }, 'new-version': { type: 'string' }, 'new-commit': { type: 'string' }, commit: { type: 'string' },
    'observed-ui': { type: 'string' }, 'process-list': { type: 'string' }, 'timeout-min': { type: 'string' },
  },
});
if (!v['app-dir'] || !v.scenario) { console.error('FEHLER: --app-dir und --scenario (success|cancel|fail) sind Pflicht'); process.exit(2); }
const commit = v.commit ?? execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8' }).trim();
const manifest = await runUpdaterDrill({
  appDir: v['app-dir'], outDir: v.out ?? defaultOutDir(`updater-${v.scenario}`), scenario: v.scenario,
  appVersion: v['old-version'], newVersion: v['new-version'], newCommit: v['new-commit'], commit, observedUi: v['observed-ui'] ?? '',
  timeoutMs: Number(v['timeout-min'] ?? 10) * 60000,
  processList: v['process-list'] ? readFileSync(v['process-list'], 'utf8') : '',
});
for (const s of manifest.steps) console.log(`${s.exitCode === 0 ? 'OK    ' : 'FEHLER'} ${s.n}. ${s.name}${s.detail ? ` - ${s.detail}` : ''}`);
console.log(`Ergebnis: ${manifest.result}. Beleg-Ordner: ${v.out ?? '(Zeitstempel-Ordner)'}`);
process.exit(manifest.result === 'pass' ? 0 : 1);
