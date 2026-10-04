import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { runBackupDrill, snapshotSet } from './backup-drill.mjs';

// A WAL database whose newest rows live only in the -wal file (connection open).
function fixture() {
  const appDir = mkdtempSync(join(tmpdir(), 'drill-app-'));
  const con = new DatabaseSync(join(appDir, 'projecta.db'));
  con.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
  for (const t of ['workers', 'projects', 'messages']) con.exec(`CREATE TABLE ${t}(id INTEGER); INSERT INTO ${t} VALUES (1);`);
  return { appDir, con, outDir: join(mkdtempSync(join(tmpdir(), 'drill-out-')), 'b') };
}

test('backup drill restores the WAL set in isolation and leaves live files untouched', () => {
  const { appDir, con, outDir } = fixture();
  const before = snapshotSet(join(appDir, 'projecta.db'));
  assert.ok(before['projecta.db-wal'].bytes > 0, 'fixture must keep data in the WAL');
  const m = runBackupDrill({ appDir, outDir, appVersion: '1.4.1', commit: 'abc' });
  con.close();
  assert.equal(m.result, 'pass', JSON.stringify(m.steps));
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'probe.json'), 'utf8')).counts, { workers: 1, projects: 1, messages: 1 });
  assert.ok(existsSync(join(outDir, 'backup', 'projecta.db-wal')));
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'snapshot-before.json'), 'utf8')), before);
});

test('backup drill refuses while projecta-api.json says the app runs', () => {
  const { appDir, con, outDir } = fixture();
  writeFileSync(join(appDir, 'projecta-api.json'), '{"port":1,"token":"s3cr3t-token-value"}');
  const m = runBackupDrill({ appDir, outDir });
  con.close();
  assert.equal(m.result, 'fail');
  assert.ok(!existsSync(join(outDir, 'backup')));
  assert.ok(!readFileSync(join(outDir, 'manifest.json'), 'utf8').includes('s3cr3t'));
});

test('an empty required table fails the probe', () => {
  const { appDir, con, outDir } = fixture();
  con.exec('DELETE FROM messages');
  const m = runBackupDrill({ appDir, outDir });
  con.close();
  assert.equal(m.result, 'fail');
  assert.match(m.steps.at(-2).detail, /count\(messages\)/);
});

test('backup artifacts are explicitly marked as sensitive', () => {
  const { appDir, con, outDir } = fixture();
  const m = runBackupDrill({ appDir, outDir });
  con.close();
  assert.deepEqual(m.sensitiveFiles.map((f) => f.name).sort(), [
    'backup/projecta.db', 'backup/projecta.db-shm', 'backup/projecta.db-wal',
  ]);
});

test('backup drill refuses a reused non-empty output folder', () => {
  const { appDir, con, outDir } = fixture();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'stale.txt'), 'old run');
  assert.throws(() => runBackupDrill({ appDir, outDir }), /not empty/);
  con.close();
});

test('CLI binds the evidence manifest to the repository commit', () => {
  const { appDir, con, outDir } = fixture();
  const cli = fileURLToPath(new URL('../drills/backup-drill.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [cli, '--app-dir', appDir, '--out', outDir], { encoding: 'utf8' });
  con.close();
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(readFileSync(join(outDir, 'manifest.json'))).commit, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
});
