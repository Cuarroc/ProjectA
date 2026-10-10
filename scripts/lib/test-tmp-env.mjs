// Preload for `node --test --import`: gives every test process a private temp
// dir and removes it on exit, so tests that call mkdtemp(os.tmpdir()) no longer
// leave directories behind (KI-TMP: ~200k leaked dirs exhausted /tmp inodes).
import { mkdtempSync, rmSync, chmodSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sandbox = mkdtempSync(join(realpathSync(tmpdir()), 'pa-test-'));
process.env.TMPDIR = process.env.TMP = process.env.TEMP = sandbox;

// A test may leave a mode-000 dir behind; make it removable first.
function unlock(dir) {
  try {
    chmodSync(dir, 0o700);
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (lstatSync(p).isDirectory()) unlock(p);
    }
  } catch { /* best effort */ }
}

process.on('exit', () => {
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { unlock(sandbox); try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* leave it */ } }
});
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(sig, () => process.exit(code));
