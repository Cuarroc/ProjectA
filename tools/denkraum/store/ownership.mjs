import { randomBytes } from 'node:crypto';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
export const OWNERSHIP_HELD = 'OWNERSHIP_HELD';
export const OWNERSHIP_MALFORMED = 'OWNERSHIP_MALFORMED';
export const OWNERSHIP_RELEASE_MISMATCH = 'OWNERSHIP_RELEASE_MISMATCH';
export const OWNERSHIP_RECOVERY_REFUSED = 'OWNERSHIP_RECOVERY_REFUSED';
export const OWNERSHIP_IO = 'OWNERSHIP_IO';
export class OwnershipError extends Error {
  constructor(code) { super(code); this.name = 'OwnershipError'; this.code = code; }
}
export const ownerRecordPath = ledgerPath => `${ledgerPath}.owner`;
const releaseFlight = new Map();
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
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
    await handle.close();
  } catch {
    await handle.close().catch(() => {});
    ioFail();
  }
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
  const tomb = `${path}.${nonce}.tomb`;
  try { await rename(path, tomb); }
  catch (error) {
    if (error && error.code === 'ENOENT') await mismatchOrIo(path);
    ioFail();
  }
  let tombRaw;
  try { tombRaw = await readFile(tomb, 'utf8'); } catch { ioFail(); }
  const tombRec = parseRecord(tombRaw);
  if (!tombRec || tombRec.nonce !== nonce) {
    try { await rename(tomb, path); } catch { ioFail(); }
    throw new OwnershipError(OWNERSHIP_RELEASE_MISMATCH);
  }
  try { await unlink(tomb); } catch { ioFail(); }
}
export async function releaseOwnership(ledgerPath, nonce) {
  const path = ownerRecordPath(ledgerPath);
  const pending = releaseFlight.get(nonce);
  if (pending) {
    await pending.catch(() => {});
    throw new OwnershipError(OWNERSHIP_RELEASE_MISMATCH);
  }
  let finish;
  const gate = new Promise(r => { finish = r; });
  releaseFlight.set(nonce, gate);
  try { await releaseOnce(path, nonce); }
  finally { releaseFlight.delete(nonce); finish(); }
}
/** G1 recovery stub: always refuse and leave the record. */
export async function recoverOwnership() { throw new OwnershipError(OWNERSHIP_RECOVERY_REFUSED); }
