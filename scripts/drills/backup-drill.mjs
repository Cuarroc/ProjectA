// CLI entry of the backup drill (see docs/drills/backup-drill.md).
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { defaultOutDir } from '../lib/drill-kit.mjs';
import { runBackupDrill } from '../lib/backup-drill.mjs';

const { values: v } = parseArgs({
  options: {
    'app-dir': { type: 'string' }, out: { type: 'string' }, 'app-version': { type: 'string' },
    commit: { type: 'string' }, 'process-list': { type: 'string' }, 'allow-running': { type: 'boolean' },
  },
});
if (!v['app-dir']) { console.error('FEHLER: --app-dir fehlt'); process.exit(2); }
const outDir = v.out ?? defaultOutDir('backup-drill');
const manifest = runBackupDrill({
  appDir: v['app-dir'], outDir, appVersion: v['app-version'], commit: v.commit, allowRunning: v['allow-running'],
  processList: v['process-list'] ? readFileSync(v['process-list'], 'utf8') : '',
});
for (const s of manifest.steps) console.log(`${s.exitCode === 0 ? 'OK    ' : 'FEHLER'} ${s.n}. ${s.name}${s.detail ? ` - ${s.detail}` : ''}`);
console.log(`Ergebnis: ${manifest.result}. Beleg-Ordner: ${outDir}`);
process.exit(manifest.result === 'pass' ? 0 : 1);
