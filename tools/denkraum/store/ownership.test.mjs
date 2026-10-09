import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs, { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import * as o from './ownership.mjs';
const {
  OWNERSHIP_HELD: HELD, OWNERSHIP_MALFORMED: MALFORMED, OWNERSHIP_RECOVERY_REFUSED: REFUSED,
  OWNERSHIP_RELEASE_MISMATCH: MISMATCH, OwnershipError, acquireOwnership: acquire,
  ownerRecordPath: ownerPath, recoverOwnership: recover, releaseOwnership: release,
} = o;
const IO = o.OWNERSHIP_IO ?? 'OWNERSHIP_IO';
const posix = { skip: process.platform === 'win32' ? 'POSIX mode 0600 is not Windows ACL evidence' : false };
const fixture = join(import.meta.dirname, 'ownership-contender.fixture.mjs');
async function ledger(t) {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-ownership-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'ledger.json');
}
function isDiag(e, code) {
  return e instanceof OwnershipError && e.code === code && e.message === code
    && e.cause == null && !Object.values(e).some(v => typeof v === 'string' && /[\\/]/.test(v));
}
async function joinChild(child, rl) {
  try { child.stdin.end(); } catch { /* ignore */ }
  if (child.exitCode == null && child.signalCode == null) try { child.kill('SIGKILL'); } catch { /* ignore */ }
  await Promise.race([
    new Promise(r => (child.exitCode != null || child.signalCode != null ? r() : child.once('exit', r))),
    new Promise((_, j) => setTimeout(() => j(new Error('join deadline')), 2000)),
  ]).catch(() => {});
  rl?.close();
}
async function holdChild(t, path) {
  const child = spawn(process.execPath, [fixture, path], { cwd: import.meta.dirname, stdio: ['pipe', 'pipe', 'inherit'] });
  const rl = createInterface({ input: child.stdout });
  let done = false;
  t.after(async () => { if (!done) await joinChild(child, rl); });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ready timeout')), 2000);
    rl.once('line', line => { clearTimeout(timer); resolve(JSON.parse(line)); });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`early exit ${code}`)));
  });
  assert.equal(ready.ready, true);
  return {
    async release() {
      child.stdin.write('release\n');
      await Promise.race([
        new Promise((res, rej) => child.once('exit', c => (c === 0 ? res() : rej(new Error(`exit ${c}`))))),
        new Promise((_, rej) => setTimeout(() => rej(new Error('release deadline')), 2000)),
      ]);
      done = true;
      rl.close();
    },
  };
}
test('DRSEC: second process is refused while ownership is held', async t => {
  const file = await ledger(t);
  const child = await holdChild(t, file);
  await assert.rejects(acquire(file), e => isDiag(e, HELD));
  const before = await readFile(ownerPath(file));
  await assert.rejects(acquire(file), e => isDiag(e, HELD));
  assert.deepEqual(await readFile(ownerPath(file)), before);
  await child.release();
  await release(file, (await acquire(file)).nonce);
});
test('DRSEC: same-process second acquire with a different nonce is refused', async t => {
  const file = await ledger(t);
  const first = await acquire(file);
  await assert.rejects(acquire(file), e => isDiag(e, HELD));
  assert.equal(JSON.parse(await readFile(ownerPath(file), 'utf8')).nonce, first.nonce);
  await release(file, first.nonce);
});
test('DRSEC: stale heartbeat does not release ownership', async t => {
  const file = await ledger(t);
  const session = await acquire(file);
  const path = ownerPath(file);
  const stale = { nonce: session.nonce, pid: session.pid, heartbeatAt: '2000-01-01T00:00:00.000Z' };
  await writeFile(path, JSON.stringify(stale), { mode: 0o600 });
  await assert.rejects(acquire(file), e => isDiag(e, HELD));
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), stale);
  await release(file, session.nonce);
});
test('DRSEC: malformed owner record fails closed', async t => {
  const file = await ledger(t);
  const path = ownerPath(file);
  for (const bytes of ['', '{', 'null', '{}', '{"nonce":1}', '{"nonce":"x","pid":"y","heartbeatAt":"z"}']) {
    await writeFile(path, bytes, { mode: 0o600 });
    await assert.rejects(acquire(file), e => isDiag(e, MALFORMED));
    assert.equal(await readFile(path, 'utf8'), bytes);
    await assert.rejects(recover(file, { observedExit: true }), e => isDiag(e, REFUSED));
    assert.equal(await readFile(path, 'utf8'), bytes);
  }
});
test('DRSEC: release with foreign nonce keeps the record', async t => {
  const file = await ledger(t);
  const session = await acquire(file);
  const path = ownerPath(file);
  const before = await readFile(path);
  await assert.rejects(release(file, 'foreign-nonce'), e => isDiag(e, MISMATCH));
  assert.deepEqual(await readFile(path), before);
  await release(file, session.nonce);
  await assert.rejects(readFile(path), e => e.code === 'ENOENT');
});
test('DRSEC: owner record is created exclusively with mode 0600', posix, async t => {
  const file = await ledger(t);
  const umask = process.umask(0);
  try {
    const session = await acquire(file);
    assert.equal((await stat(ownerPath(file))).mode & 0o777, 0o600);
    await release(file, session.nonce);
  } finally { process.umask(umask); }
});
test('DRSEC: overlapping release cannot unlink a successor record', async t => {
  const file = await ledger(t);
  const owner = await acquire(file);
  const orig = fs.unlink;
  const gate = Promise.withResolvers();
  const entered = Promise.withResolvers();
  fs.unlink = async p => { entered.resolve(); await gate.promise; return orig(p); };
  syncBuiltinESMExports();
  try {
    const r1 = release(file, owner.nonce);
    await entered.promise;
    const r2 = assert.rejects(release(file, owner.nonce), e => isDiag(e, MISMATCH));
    gate.resolve();
    await r1;
    const successor = await acquire(file);
    await r2;
    assert.equal(JSON.parse(await readFile(ownerPath(file), 'utf8')).nonce, successor.nonce);
    await release(file, successor.nonce);
  } finally { fs.unlink = orig; syncBuiltinESMExports(); }
});
test('DRSEC: filesystem failures use fixed diagnostics without paths', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-ownership-io-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'not-a-dir'), 'x');
  for (const path of [join(dir, 'missing-parent', 'l.json'), join(dir, 'not-a-dir', 'l.json')]) {
    await assert.rejects(acquire(path), e => isDiag(e, IO));
    await assert.rejects(release(path, 'synthetic-nonce'), e => isDiag(e, IO));
  }
});
test('DRSEC: failed write after create removes the half-written record', async t => {
  const file = await ledger(t);
  const orig = fs.open;
  fs.open = async (...args) => {
    const h = await orig(...args);
    if (args[1] === 'wx') h.writeFile = async () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); };
    return h;
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(acquire(file), e => isDiag(e, IO));
    await assert.rejects(readFile(ownerPath(file)), e => e.code === 'ENOENT');
  } finally { fs.open = orig; syncBuiltinESMExports(); }
});
test('DRSEC: fixture exits non-zero when stdin closes without release', async t => {
  const file = await ledger(t);
  const child = spawn(process.execPath, [fixture, file], { cwd: import.meta.dirname, stdio: ['pipe', 'pipe', 'inherit'] });
  const rl = createInterface({ input: child.stdout });
  t.after(() => joinChild(child, rl));
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('ready timeout')), 2000);
    rl.once('line', () => { clearTimeout(timer); res(); });
  });
  child.stdin.end();
  const code = await Promise.race([
    new Promise(res => child.once('exit', res)),
    new Promise((_, rej) => setTimeout(() => rej(new Error('exit deadline')), 2000)),
  ]);
  assert.notEqual(code, 0);
  assert.ok(await readFile(ownerPath(file)));
});
