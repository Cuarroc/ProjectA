// CLI entry of the provider drill (see docs/drills/provider-drill.md).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { defaultOutDir } from '../lib/drill-kit.mjs';
import { runProviderDrill } from '../lib/provider-drill.mjs';

const { values: v } = parseArgs({
  options: {
    adapter: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' }, out: { type: 'string' },
    snapshot: { type: 'string' }, 'snapshot-source': { type: 'string' }, 'snapshot-observed-at': { type: 'string' },
    'app-version': { type: 'string' }, commit: { type: 'string' }, 'process-list': { type: 'string' },
  },
});
if (!v.adapter || !v.before || !v.after) { console.error('FEHLER: --adapter, --before und --after fehlen'); process.exit(2); }
const text = (p) => (p ? readFileSync(p, 'utf8') : '');
const commit = v.commit ?? execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8' }).trim();
const outDir = v.out ?? defaultOutDir(`provider-drill-${v.adapter}`);
const manifest = runProviderDrill({
  adapter: v.adapter, outDir, before: JSON.parse(text(v.before)), after: JSON.parse(text(v.after)),
  snapshot: text(v.snapshot), snapshotSource: v['snapshot-source'] ?? '', snapshotObservedAt: v['snapshot-observed-at'] ?? '',
  appVersion: v['app-version'], commit, processList: text(v['process-list']),
});
for (const s of manifest.steps) console.log(`${s.exitCode === 0 ? 'OK    ' : 'FEHLER'} ${s.n}. ${s.name}${s.detail ? ` - ${s.detail}` : ''}`);
console.log(`Ergebnis: ${manifest.result}. Beleg-Ordner: ${outDir}`);
process.exit(manifest.result === 'pass' ? 0 : 1);
