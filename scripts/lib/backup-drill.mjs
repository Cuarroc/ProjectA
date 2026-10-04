// W3-03a: copy db + WAL set, restore only in temp, and prove live hashes stay equal.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBundle, sha256File } from './drill-kit.mjs';
const SIDES = ['', '-wal', '-shm'];
export const REQUIRED_TABLES = ['workers', 'projects', 'messages'];
export function snapshotSet(db) {
  return Object.fromEntries(SIDES.filter((s) => existsSync(db + s))
    .map((s) => [`projecta.db${s}`, { bytes: statSync(db + s).size, sha256: sha256File(db + s) }]));
}
export function probeDatabase(path) {
  const con = new DatabaseSync(path);
  try {
    const integrity = con.prepare('PRAGMA integrity_check').get().integrity_check;
    const tables = con.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
    const counts = {};
    for (const t of REQUIRED_TABLES) counts[t] = tables.includes(t) ? con.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n : null;
    const problems = [];
    if (integrity !== 'ok') problems.push(`integrity_check: ${integrity}`);
    if (tables.length === 0) problems.push('no tables');
    for (const t of REQUIRED_TABLES) if (!counts[t]) problems.push(`count(${t}) is ${counts[t] ?? 'missing'}`);
    return { integrity, tables, counts, problems };
  } finally {
    con.close();
  }
}
export function runBackupDrill({ appDir, outDir, appVersion, commit, allowRunning = false, processList = '' }) {
  const live = join(resolve(appDir), 'projecta.db');
  const bundle = createBundle({ outDir, drill: 'backup', appVersion, commit });
  const fail = (name, detail) => { bundle.step(name, { exitCode: 1, detail }); return bundle.finish(NOT_COVERED); };
  if (processList) bundle.addFile('processes.txt', processList);
  if (!existsSync(live)) return fail('find live database', `${live} not found`);
  if (existsSync(join(appDir, 'projecta-api.json')) && !allowRunning) {
    return fail('check app is closed', 'projecta-api.json exists: the app is still running; close it (the drain) and retry');
  }
  bundle.step('check app is closed', { detail: allowRunning ? 'skipped by --allow-running' : 'no projecta-api.json' });
  const before = snapshotSet(live);
  bundle.addFile('snapshot-before.json', JSON.stringify(before, null, 2));
  bundle.step('snapshot live files (read-only)', { detail: Object.keys(before).join(', ') });
  const backupDir = join(resolve(outDir), 'backup');
  mkdirSync(backupDir, { recursive: true });
  for (const s of SIDES) if (existsSync(live + s)) copyFileSync(live + s, join(backupDir, `projecta.db${s}`));
  const backup = snapshotSet(join(backupDir, 'projecta.db'));
  const same = Object.keys(before).every((k) => backup[k]?.sha256 === before[k].sha256);
  for (const [name, metadata] of Object.entries(backup)) bundle.recordSensitiveFile(`backup/${name}`, metadata);
  bundle.addFile('snapshot-backup.json', JSON.stringify(backup, null, 2));
  bundle.step('copy db + wal + shm set', { command: 'copy projecta.db[-wal|-shm] -> backup/', exitCode: same ? 0 : 1, detail: same ? 'hashes match' : 'backup hashes differ from live' });
  const tmp = mkdtempSync(join(tmpdir(), 'projecta-restore-'));
  try {
    for (const s of SIDES) if (existsSync(join(backupDir, `projecta.db${s}`))) copyFileSync(join(backupDir, `projecta.db${s}`), join(tmp, `projecta.db${s}`));
    const probe = probeDatabase(join(tmp, 'projecta.db'));
    bundle.addFile('probe.json', JSON.stringify(probe, null, 2));
    bundle.step('restore into isolated temp + integrity/table/count checks', { command: 'PRAGMA integrity_check; count(workers, projects, messages)', exitCode: probe.problems.length ? 1 : 0, detail: probe.problems.join('; ') || `integrity ok, ${probe.tables.length} tables` });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const after = snapshotSet(live);
  const untouched = JSON.stringify(after) === JSON.stringify(before);
  bundle.addFile('snapshot-after.json', JSON.stringify(after, null, 2));
  bundle.step('live files unchanged', { exitCode: untouched ? 0 : 1, detail: untouched ? 'hashes equal before/after' : 'LIVE FILES CHANGED' });
  return bundle.finish(NOT_COVERED);
}
export const NOT_COVERED = [
  'Drain via the app: enter_maintenance is a Tauri command with no button/API/CLI trigger yet; the drain here is "app closed" (no projecta-api.json).',
  'Running-app online backup and restore over the live database are not exercised.',
];
