// CLI entry of the HQ-v1 proof drill (see docs/drills/hq-proof-drill.md).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { defaultOutDir, sha256File } from '../lib/drill-kit.mjs';
import { runHqProof } from '../lib/hq-proof-drill.mjs';

const { values: v } = parseArgs({
  options: {
    phase: { type: 'string' }, project: { type: 'string' }, pa: { type: 'string' }, out: { type: 'string' },
    before: { type: 'string' }, screenshots: { type: 'string' }, pr: { type: 'string', multiple: true },
    'app-version': { type: 'string' }, commit: { type: 'string' }, 'process-list': { type: 'string' },
  },
});
if (!['before', 'after'].includes(v.phase) || !v.project) { console.error('FEHLER: --phase before|after und --project <id> sind Pflicht'); process.exit(2); }
const commit = v.commit ?? execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8' }).trim();
const expectedManifestSha256 = sha256File(fileURLToPath(new URL('../../src-tauri/resources/agent-defaults.json', import.meta.url)));
const outDir = v.out ?? defaultOutDir(`hq-proof-${v.phase}`);
const manifest = runHqProof({
  phase: v.phase, outDir, projectId: v.project, paBin: v.pa ?? 'pa', beforeDir: v.before, screenshotsDir: v.screenshots,
  prUrls: v.pr ?? [], appVersion: v['app-version'], commit,
  expectedManifestSha256,
  processList: v['process-list'] ? readFileSync(v['process-list'], 'utf8') : '',
});
for (const s of manifest.steps) console.log(`${s.exitCode === 0 ? 'OK    ' : 'FEHLER'} ${s.n}. ${s.name}${s.detail ? ` - ${s.detail}` : ''}`);
console.log(`Ergebnis: ${manifest.result}. Beleg-Ordner: ${outDir}`);
process.exit(manifest.result === 'pass' ? 0 : 1);
