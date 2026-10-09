import { randomBytes } from 'node:crypto';
import { link, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { hostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
const host = `${hostname()}:${process.platform}`;
export const OWNERSHIP_HELD = 'OWNERSHIP_HELD';
export const OWNERSHIP_MALFORMED = 'OWNERSHIP_MALFORMED';
export const OWNERSHIP_RELEASE_MISMATCH = 'OWNERSHIP_RELEASE_MISMATCH';
export const OWNERSHIP_RECOVERY_REFUSED = 'OWNERSHIP_RECOVERY_REFUSED';
export const OWNERSHIP_IO = 'OWNERSHIP_IO';
export class OwnershipError extends Error {
  // `hint` is an operator note without paths; the message stays the fixed code.
  constructor(code, hint) { super(code); this.name = 'OwnershipError'; this.code = code; if (hint) this.hint = hint; }
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
  return { nonce: value.nonce, pid: value.pid, heartbeatAt: value.heartbeatAt,
    host: typeof value.host === 'string' ? value.host : null };
}
// Precondition: the ledger lives on a local filesystem, host names are unique
// and all processes share one pid namespace. Containers or VMs that share a
// volume with separate pid namespaces are NOT supported (false recovery). On
// win32 config.mjs already refuses Windows namespace and UNC state paths.
function isDead(record) {
  if (record.pid === process.pid && registry.spent.has(record.nonce) && !registry.releasing.has(record.nonce)) return true;
  if (record.host !== host) return false;
  try { process.kill(record.pid, 0); }
  catch (error) { return error?.code === 'ESRCH'; }
  return false;
}
const LEGACY_HINT = 'record without host from an older version; remove manually after checking that no server runs';
// Null when the record is gone (released cleanly in the window).
async function readJudged(path) {
  let raw;
  try { raw = await readFile(path, 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw new OwnershipError(OWNERSHIP_HELD); }
  const record = parseRecord(raw);
  if (!record) throw new OwnershipError(OWNERSHIP_MALFORMED);
  return record;
}
// Recovery is serialized by an exclusive `<owner>.recover` lock so that a
// stale starter can never rename a live successor record. A lock left behind
// by a crash stays held; it is removed manually (no automatic stale logic).
async function recoverDead(path) {
  const record = await readJudged(path);
  if (!record) return; // released in the window: go straight to the retry
  if (!isDead(record)) throw new OwnershipError(OWNERSHIP_HELD, record.host === null ? LEGACY_HINT : undefined);
  const lockPath = `${path}.recover`;
  let lock;
  for (let poll = 0; ; poll++) {
    try { lock = await open(lockPath, 'wx', 0o600); break; }
    catch (error) {
      if (error?.code !== 'EEXIST') ioFail();
      if (poll === 20) throw new OwnershipError(OWNERSHIP_HELD,
        `recovery in progress or orphaned lock ${basename(lockPath)}; remove manually if no start is running`);
      await delay(25);
    }
  }
  try {
    try { await lock.writeFile(JSON.stringify({ pid: process.pid, host, nonce: randomBytes(16).toString('hex') }), 'utf8'); await lock.close(); }
    catch { await lock.close().catch(() => {}); ioFail(); }
    const again = await readJudged(path);
    if (!again) return;
    if (again.nonce !== record.nonce) throw new OwnershipError(OWNERSHIP_HELD);
    try { await releaseOnce(path, record.nonce); }
    catch (error) {
      // The dead record was already removed by someone else.
      if (error?.code !== OWNERSHIP_RELEASE_MISMATCH) throw error;
    }
  } finally { await unlink(lockPath).catch(() => {}); }
}
async function mismatchOrIo(path) {
  try { if (!(await stat(dirname(path))).isDirectory()) ioFail(); }
  catch (e) { if (e instanceof OwnershipError) throw e; ioFail(); }
  throw new OwnershipError(OWNERSHIP_RELEASE_MISMATCH);
}
export async function acquireOwnership(ledgerPath) {
  const path = ownerRecordPath(ledgerPath);
  const nonce = randomBytes(16).toString('hex');
  const record = { nonce, pid: process.pid, heartbeatAt: new Date().toISOString(), host };
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error?.code !== 'EEXIST') ioFail();
    await recoverDead(path);
    // Exactly one fresh exclusive create; never recover a second owner here.
    try { handle = await open(path, 'wx', 0o600); }
    catch (retryError) {
      if (retryError?.code === 'EEXIST') throw new OwnershipError(OWNERSHIP_HELD);
      ioFail();
    }
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
