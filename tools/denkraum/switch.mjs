#!/usr/bin/env node
// DR-16a: pause → backup → switch way-back helper. Stdout is JSON lines only.
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateState } from './store/model.mjs';
const ROLLBACK = 'Rückweg = vollständige Pause; älteren Stand nie zurückspielen.';
const emit = obj => { process.stdout.write(`${JSON.stringify(obj)}\n`); };
const fail = (code, error) => { emit({ ok: false, error }); process.exitCode = code; };
function diagnose(error) {
  // JSON parser excerpts and filesystem paths can contain ledger data or credentials.
  let message = error instanceof SyntaxError
    ? `Invalid JSON${error.message.match(/ at position \d+(?: \(line \d+ column \d+\))?/)?.[0] ?? ''}`
    : String(error?.message ?? error);
  for (const path of [error?.path, error?.dest]) {
    if (typeof path === 'string' && path) message = message.split(path).join(basename(path));
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (/TOKEN|SECRET|PASSWORD|KEY/i.test(name) && value) message = message.split(value).join('[redacted]');
  }
  process.stderr.write(`${message}\n`);
}
const check = condition => { if (!condition) throw new Error('nicht ruhend'); };
const arg = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const abs = (value, label) => {
  if (typeof value !== 'string' || !value || !isAbsolute(value) || value.includes('\0')) {
    throw Object.assign(new Error(`Ungültiger ${label}-Pfad`), { exitCode: 2 });
  }
  return resolve(value);
};
const digest = buf => createHash('sha256').update(buf).digest('hex');
async function healthUp(port) {
  // free port is necessary, not sufficient; PID proof is DR-16b
  try { await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) }); return true; }
  catch (error) {
    // Quiescent writer (ECONNREFUSED) is the happy path; do not diagnose it.
    if (error.cause?.code !== 'ECONNREFUSED') diagnose(error);
    return error.cause?.code !== 'ECONNREFUSED';
  }
}
function sidecars(statePath) {
  return ['', '.previous', '.v1-backup'].map(suffix => ({ name: basename(statePath) + suffix, path: statePath + suffix, required: !suffix }));
}
async function hashTree(statePath) {
  const files = [];
  for (const entry of sidecars(statePath)) {
    let buf;
    try { buf = await readFile(entry.path); }
    catch (e) { if (e.code === 'ENOENT' && !entry.required) continue; throw e; }
    files.push({ name: entry.name, bytes: buf.length, sha256: digest(buf) });
  }
  return files;
}
async function readValidated(path) {
  const state = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
  validateState(state); return state;
}
async function backup(args) {
  const statePath = abs(arg(args, '--state'), 'state'), out = abs(arg(args, '--out'), 'out');
  const defaultPort = !args.includes('--port'), port = Number(defaultPort ? 4791 : arg(args, '--port'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fail(2, 'Ungültiger Port');
  if (await healthUp(port)) return fail(3, 'Schreiber läuft noch');
  let names; try { names = await readdir(dirname(statePath)); } catch (error) { diagnose(error); names = []; }
  const prefix = `${basename(statePath)}.`;
  for (const name of names) if (name.startsWith(prefix)
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.tmp(?:\.previous)?$/i.test(name.slice(prefix.length))) emit({ warn: 'tmp', name });
  const before = await hashTree(statePath), state = await readValidated(statePath);
  try { await mkdir(out, { mode: 0o700 }); }
  catch (error) {
    diagnose(error);
    return fail(4, error.code === 'EEXIST' ? 'Ausgabeverzeichnis existiert bereits' : 'Ausgabeverzeichnis kann nicht erstellt werden');
  }
  for (const entry of sidecars(statePath)) {
    if (before.some(f => f.name === entry.name)) await copyFile(entry.path, join(out, entry.name));
  }
  const after = await hashTree(statePath);
  check(after.length === before.length && after.every((f, i) => f.sha256 === before[i].sha256 && f.bytes === before[i].bytes));
  for (const file of before) {
    const copy = await readFile(join(out, file.name));
    check(copy.length === file.bytes && digest(copy) === file.sha256);
  }
  const manifest = { utc: new Date().toISOString(), schemaVersion: state.schemaVersion, revision: state.revision, files: before };
  await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  emit({ ok: true, cmd: 'backup', proof: 'port-only', port, defaultPort, schemaVersion: state.schemaVersion, revision: state.revision, files: before.length });
}
async function verifiedManifest(dir) {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  check(manifest && Number.isSafeInteger(manifest.revision) && Number.isSafeInteger(manifest.schemaVersion) && Array.isArray(manifest.files));
  const names = new Set(); let primary;
  for (const file of manifest.files) {
    check(file && typeof file.name === 'string' && file.name && basename(file.name) === file.name && !/[\\/]/.test(file.name) && !names.has(file.name));
    names.add(file.name);
    const buf = await readFile(join(dir, file.name));
    check(buf.length === file.bytes && digest(buf) === file.sha256);
    if (!file.name.endsWith('.previous') && !file.name.endsWith('.v1-backup')) {
      check(!primary); primary = join(dir, file.name);
    }
  }
  check(primary);
  const state = await readValidated(primary);
  check(state.revision === manifest.revision && state.schemaVersion === manifest.schemaVersion);
  return manifest;
}
async function inspect(args, cmd) {
  const dir = abs(arg(args, '--backup'), 'backup');
  const statePath = cmd === 'compare' ? abs(arg(args, '--state'), 'state') : null;
  const manifest = await verifiedManifest(dir), current = statePath ? await readValidated(statePath) : manifest;
  if (current.schemaVersion < manifest.schemaVersion || (current.schemaVersion === manifest.schemaVersion && current.revision < manifest.revision)) {
    return fail(5, 'Datenverlust-Verdacht');
  }
  emit({ ok: true, cmd, schemaVersion: current.schemaVersion, revision: current.revision });
}
export async function runSwitch([cmd, ...args]) {
  try {
    if (cmd === 'backup') return await backup(args);
    if (cmd === 'verify' || cmd === 'compare') return await inspect(args, cmd);
    return fail(2, ROLLBACK);
  } catch (error) { diagnose(error); return fail(error.exitCode ?? 4, error.exitCode === 2 ? error.message : 'nicht ruhend'); }
}
function isEntry() {
  if (!process.argv[1]) return false;
  const here = fileURLToPath(import.meta.url);
  try { return realpathSync.native(here) === realpathSync.native(process.argv[1]); }
  catch (error) {
    diagnose(error);
    const resolved = resolve(process.argv[1]);
    const matched = process.platform === 'win32'
      ? here.toLowerCase() === resolved.toLowerCase()
      : here === resolved;
    if (matched) return true;
    fail(4, 'nicht ruhend');
    return false;
  }
}
if (isEntry()) {
  runSwitch(process.argv.slice(2)).catch(error => { diagnose(error); fail(4, 'nicht ruhend'); });
}
