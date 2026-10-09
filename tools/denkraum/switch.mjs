#!/usr/bin/env node
// DR-16a: pause → backup → switch way-back helper. Stdout is JSON lines only.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateState } from './store/model.mjs';
const DEFAULT_PORT = 4791;
const ROLLBACK = 'Rückweg = vollständige Pause; älteren Stand nie zurückspielen.';
const emit = obj => { process.stdout.write(`${JSON.stringify(obj)}\n`); };
const fail = (code, error, extra = {}) => { emit({ ok: false, error, ...extra }); process.exitCode = code; };
const arg = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const abs = (value, label) => {
  if (typeof value !== 'string' || !value || !isAbsolute(value) || value.includes('\0')) {
    fail(2, `Ungültiger ${label}-Pfad`); return null;
  }
  return resolve(value);
};
const digest = buf => createHash('sha256').update(buf).digest('hex');
async function healthUp(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch { return false; }
}
function sidecars(statePath) {
  const name = basename(statePath);
  return [
    { name, path: statePath, required: true },
    { name: `${name}.previous`, path: `${statePath}.previous` },
    { name: `${name}.v1-backup`, path: `${statePath}.v1-backup` },
  ];
}
async function hashTree(statePath) {
  const files = [];
  for (const entry of sidecars(statePath)) {
    let buf;
    try { buf = await readFile(entry.path); }
    catch (e) {
      if (e.code === 'ENOENT') { if (entry.required) throw Object.assign(new Error('missing'), { code: 'MISSING' }); continue; }
      throw e;
    }
    files.push({ name: entry.name, bytes: buf.length, sha256: digest(buf) });
  }
  return files;
}
async function warnTmp(statePath) {
  let names; try { names = await readdir(dirname(statePath)); } catch { return; }
  for (const name of names) if (name.endsWith('.tmp')) emit({ warn: 'tmp', name });
}
async function readValidated(path) {
  const state = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
  validateState(state);
  return state;
}
async function backup(args) {
  const statePath = abs(arg(args, '--state'), 'state');
  const out = abs(arg(args, '--out'), 'out');
  if (!statePath || !out) return;
  const portRaw = arg(args, '--port');
  const port = portRaw === undefined ? DEFAULT_PORT : Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fail(2, 'Ungültiger Port');
  if (await healthUp(port)) return fail(3, 'Schreiber läuft noch');
  await warnTmp(statePath);
  let before, state;
  try { before = await hashTree(statePath); state = await readValidated(statePath); }
  catch { return fail(4, 'nicht ruhend'); }
  try { await mkdir(out); } catch { return fail(4, 'nicht ruhend'); }
  for (const entry of sidecars(statePath)) {
    if (!before.some(f => f.name === entry.name)) continue;
    await copyFile(entry.path, join(out, entry.name));
  }
  let after;
  try { after = await hashTree(statePath); } catch { return fail(4, 'nicht ruhend'); }
  if (after.length !== before.length || after.some((f, i) => f.sha256 !== before[i].sha256 || f.bytes !== before[i].bytes)) {
    return fail(4, 'nicht ruhend');
  }
  for (const file of before) {
    const copy = await readFile(join(out, file.name));
    if (copy.length !== file.bytes || digest(copy) !== file.sha256) return fail(4, 'nicht ruhend');
  }
  const manifest = {
    utc: new Date().toISOString(), schemaVersion: state.schemaVersion, revision: state.revision,
    files: before.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })),
  };
  await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  emit({ ok: true, cmd: 'backup', schemaVersion: manifest.schemaVersion, revision: manifest.revision, files: manifest.files.length });
}
async function verify(args) {
  const dir = abs(arg(args, '--backup'), 'backup');
  if (!dir) return;
  let manifest;
  try { manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')); }
  catch { return fail(4, 'nicht ruhend'); }
  if (!manifest || !Array.isArray(manifest.files)) return fail(4, 'nicht ruhend');
  let primary;
  for (const file of manifest.files) {
    if (!file || typeof file.name !== 'string') return fail(4, 'nicht ruhend');
    let buf;
    try { buf = await readFile(join(dir, file.name)); } catch { return fail(4, 'nicht ruhend'); }
    if (buf.length !== file.bytes || digest(buf) !== file.sha256) return fail(4, 'nicht ruhend');
    if (!file.name.endsWith('.previous') && !file.name.endsWith('.v1-backup')) primary = join(dir, file.name);
  }
  if (!primary) return fail(4, 'nicht ruhend');
  try { await readValidated(primary); } catch { return fail(4, 'nicht ruhend'); }
  emit({ ok: true, cmd: 'verify', schemaVersion: manifest.schemaVersion, revision: manifest.revision });
}
async function compare(args) {
  const dir = abs(arg(args, '--backup'), 'backup');
  const statePath = abs(arg(args, '--state'), 'state');
  if (!dir || !statePath) return;
  let manifest, current;
  try { manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')); }
  catch { return fail(4, 'nicht ruhend'); }
  try { current = await readValidated(statePath); } catch { return fail(4, 'nicht ruhend'); }
  if (current.revision < manifest.revision || current.schemaVersion < manifest.schemaVersion) {
    return fail(5, 'Datenverlust-Verdacht');
  }
  emit({ ok: true, cmd: 'compare', schemaVersion: current.schemaVersion, revision: current.revision });
}
export async function runSwitch(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'backup') return backup(rest);
  if (cmd === 'verify') return verify(rest);
  if (cmd === 'compare') return compare(rest);
  return fail(2, ROLLBACK);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSwitch(process.argv.slice(2)).catch(() => fail(4, 'nicht ruhend'));
}
