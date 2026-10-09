import { randomBytes } from 'node:crypto';
import { link, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
export const OWNERSHIP_HELD = 'OWNERSHIP_HELD';
export const OWNERSHIP_MALFORMED = 'OWNERSHIP_MALFORMED';
export const OWNERSHIP_RELEASE_MISMATCH = 'OWNERSHIP_RELEASE_MISMATCH';
export const OWNERSHIP_RECOVERY_REFUSED = 'OWNERSHIP_RECOVERY_REFUSED';
export const OWNERSHIP_IO = 'OWNERSHIP_IO';
export class OwnershipError extends Error {
  constructor(code) { super(code); this.name = 'OwnershipError'; this.code = code; }
}
export const ownerRecordPath = ledgerPath => `${ledgerPath}.owner`;
// Shared by independently imported module instances in this process.
const registry = globalThis[Symbol.for('denkraum.ownership')] ??=
  { releasing: new Set(), spent: new Set(), contexts: new Map() };
export function getOwnershipContext(ledgerPath) {
  const key = resolve(ledgerPath);
  if (!registry.contexts.has(key)) registry.contexts.set(key, { queue: Promise.resolve(), session: null, users: 0 });
  return registry.contexts.get(key);
}
const releaseHooks = { beforeRename: null };
export function setOwnershipReleaseHooks(n = {}) {
  releaseHooks.beforeRename = n.beforeRename ?? null;
}
const ioFail = () => { throw new OwnershipError(OWNERSHIP_IO); };
function parseRecord(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.nonce !== 'string' || value.nonce.length < 8 || value.nonce.length > 128) return null;
  if (!Number.isInteger(value.pid) || value.pid <= 0) return null;
  if (typeof value.heartbeatAt !== 'string' || !Number.isFinite(Date.parse(value.heartbeatAt))) return null;
  return { nonce: value.nonce, pid: value.pid, heartbeatAt: value.heartbeatAt };
}
async function refuseExisting(path) {
  let raw;
  try { raw = await readFile(path, 'utf8'); }
  catch { throw new OwnershipError(OWNERSHIP_HELD); }
  if (!parseRecord(raw)) throw new OwnershipError(OWNERSHIP_MALFORMED);
  throw new OwnershipError(OWNERSHIP_HELD);
}
async function mismatchOrIo(path) {
  try { if (!(await stat(dirname(path))).isDirectory()) ioFail(); }
  catch (e) { if (e instanceof OwnershipError) throw e; ioFail(); }
  throw new OwnershipError(OWNERSHIP_RELEASE_MISMATCH);
}
export async function acquireOwnership(ledgerPath) {
  const path = ownerRecordPath(ledgerPath);
  const nonce = randomBytes(16).toString('hex');
  const record = { nonce, pid: process.pid, heartbeatAt: new Date().toISOString() };
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error && error.code === 'EEXIST') await refuseExisting(path);
    ioFail();
  }
  try { await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8'); await handle.close(); }
  catch { await handle.close().catch(() => {}); await unlink(path).catch(() => {}); ioFail(); }
  return { nonce, pid: record.pid, heartbeatAt: record.heartbeatAt };
}
async function releaseOnce(path, nonce) {
  let raw;
  try { raw = await readFile(path, 'utf8'); }
  catch (error) {
    if (error && error.code === 'ENOENT') await mismatchOrIo(path);
    ioFail();
  }
  const record = parseRecord(raw);
  if (!record || record.nonce !== nonce) throw new OwnershipError(OWNERSHIP_RELEASE_MISMATCH);
  registry.spent.add(nonce);
  const tomb = `${path}.${nonce}.${randomBytes(8).toString('hex')}.tomb`;
  if (releaseHooks.beforeRename) await releaseHooks.beforeRename();
  try { await rename(path, tomb); }
  catch (error) {
    if (error && error.code === 'ENOENT') await mismatchOrIo(path);
    ioFail();
  }
  let tombRaw;
  try { tombRaw = await readFile(tomb, 'utf8'); } catch { ioFail(); }
  const tombRec = parseRecord(tombRaw);
  if (!tombRec || tombRec.nonce !== nonce) {
    try { await link(tomb, path); await unlink(tomb); }
    catch (e) { if (e?.code === 'EEXIST') await unlink(tomb).catch(() => {}); else ioFail(); }
    throw new OwnershipError(OWNERSHIP_RELEASE_MISMATCH);
  }
  try { await unlink(tomb); } catch { ioFail(); }
}
// A valid nonce is consumed before any release hook/rename and never retried,
// even after I/O failure. Concurrent duplicates fail immediately (E6b).
export async function releaseOwnership(ledgerPath, nonce) {
  if (registry.releasing.has(nonce) || registry.spent.has(nonce)) throw new OwnershipError(OWNERSHIP_RELEASE_MISMATCH);
  registry.releasing.add(nonce);
  try { await releaseOnce(ownerRecordPath(ledgerPath), nonce); }
  finally { registry.releasing.delete(nonce); }
}
export async function recoverOwnership() { throw new OwnershipError(OWNERSHIP_RECOVERY_REFUSED); }
