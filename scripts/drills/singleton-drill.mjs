// CLI entry of the singleton drill (see docs/drills/singleton-drill.md).
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { defaultOutDir } from '../lib/drill-kit.mjs';
import { runSingletonDrill } from '../lib/singleton-drill.mjs';

const { values: v } = parseArgs({ options: { 'app-dir': { type: 'string' }, out: { type: 'string' }, 'app-version': { type: 'string' }, commit: { type: 'string' } } });
if (!v['app-dir']) { console.error('FEHLER: --app-dir fehlt'); process.exit(2); }
const here = fileURLToPath(new URL('.', import.meta.url));
const rl = createInterface({ input: process.stdin, output: process.stdout });
const outDir = v.out ?? defaultOutDir('singleton-drill');
const manifest = await runSingletonDrill({
  outDir, appVersion: v['app-version'], commit: v.commit ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(here, '..', '..'), encoding: 'utf8' }).trim(),
  readDescriptor: () => readFile(join(v['app-dir'], 'projecta-api.json'), 'utf8'),
  scan: () => JSON.parse(execFileSync('pwsh', ['-NoProfile', '-File', join(here, 'singleton-collect.ps1')], { encoding: 'utf8' })),
  callApi: async ({ port, token }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/workers`, { headers: { 'x-projecta-token': token } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  ask: (q) => rl.question(q),
});
rl.close();
for (const s of manifest.steps) console.log(`${s.exitCode === 0 ? 'OK    ' : 'FEHLER'} ${s.n}. ${s.name}${s.detail ? ` - ${s.detail}` : ''}`);
console.log(`Ergebnis: ${manifest.result}. Beleg-Ordner: ${outDir}`);
process.exit(manifest.result === 'pass' ? 0 : 1);
