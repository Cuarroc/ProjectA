import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs, { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { hostname, tmpdir } from 'node:os';
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
    new Promise(r => setTimeout(r, 2000)),
  ]);
  rl?.close();
}
async function holdChild(t, path) {
  const child = spawn(process.execPath, [fixture, path], { cwd: import.meta.dirname, stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = once(child, 'exit');
  const rl = createInterface({ input: child.stdout });
  let done = false;
  t.after(async () => { if (!done) await joinChild(child, rl); });
  const ready = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('ready timeout')), 2000);
    rl.once('line', line => { clearTimeout(timer); res(JSON.parse(line)); });
    child.once('error', rej);
    child.once('exit', code => rej(new Error(`early exit ${code}`)));
  });
  assert.equal(ready.ready, true);
  return { child, exited,
    async release() {
      child.stdin.write('release\n');
      await Promise.race([
        new Promise((res, rej) => child.once('exit', c => (c === 0 ? res() : rej(new Error(`exit ${c}`))))),
        new Promise((_, rej) => setTimeout(() => rej(new Error('release deadline')), 2000)),
      ]);
      done = true; rl.close();
    },
  };
}
test('DRSEC: second process is refused while ownership is held', async t => {
  const file = await ledger(t), child = await holdChild(t, file);
  await assert.rejects(acquire(file), e => isDiag(e, HELD));
  const before = await readFile(ownerPath(file));
  await assert.rejects(acquire(file), e => isDiag(e, HELD));
  assert.deepEqual(await readFile(ownerPath(file)), before);
  await child.release();
  await release(file, (await acquire(file)).nonce);
});
test('DRSEC: same-process second acquire with a different nonce is refused', async t => {
  const file = await ledger(t), first = await acquire(file);
  await assert.rejects(acquire(file), e => isDiag(e, HELD));
  assert.equal(JSON.parse(await readFile(ownerPath(file), 'utf8')).nonce, first.nonce);
  await release(file, first.nonce);
});
test('DRSEC: stale heartbeat does not release ownership', async t => {
  const file = await ledger(t), session = await acquire(file), path = ownerPath(file);
  const stale = { nonce: session.nonce, pid: session.pid, heartbeatAt: '2000-01-01T00:00:00.000Z' };
  await writeFile(path, JSON.stringify(stale), { mode: 0o600 });
  await assert.rejects(acquire(file), e => isDiag(e, HELD));
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), stale);
  await release(file, session.nonce);
});
test('DRSEC: malformed owner record fails closed', async t => {
  const file = await ledger(t), path = ownerPath(file);
  for (const bytes of ['', '{', 'null', '{}', '{"nonce":1}', '{"nonce":"x","pid":"y","heartbeatAt":"z"}']) {
    await writeFile(path, bytes, { mode: 0o600 });
    await assert.rejects(acquire(file), e => isDiag(e, MALFORMED));
    assert.equal(await readFile(path, 'utf8'), bytes);
    await assert.rejects(recover(file, { observedExit: true }), e => isDiag(e, REFUSED));
    assert.equal(await readFile(path, 'utf8'), bytes);
  }
});
test('DRSEC: release with foreign nonce keeps the record', async t => {
  const file = await ledger(t), session = await acquire(file), path = ownerPath(file), before = await readFile(path);
  await assert.rejects(release(file, 'foreign-nonce'), e => isDiag(e, MISMATCH));
  assert.deepEqual(await readFile(path), before);
  await release(file, session.nonce);
  await assert.rejects(readFile(path), e => e.code === 'ENOENT');
});
test('DRSEC: release of a missing record is a fixed mismatch', async t => {
  await assert.rejects(release(await ledger(t), 'missing-nonce-value'), e => isDiag(e, MISMATCH));
});
test('DRSEC: owner record is created exclusively with mode 0600', posix, async t => {
  const file = await ledger(t), umask = process.umask(0);
  try {
    const session = await acquire(file);
    assert.equal((await stat(ownerPath(file))).mode & 0o777, 0o600);
    await release(file, session.nonce);
  } finally { process.umask(umask); }
});
test('DRSEC: overlapping release cannot unlink a successor record', async t => {
  const file = await ledger(t), owner = await acquire(file), orig = fs.unlink;
  const gate = Promise.withResolvers(), entered = Promise.withResolvers();
  fs.unlink = async p => { entered.resolve(); await gate.promise; return orig(p); };
  syncBuiltinESMExports();
  try {
    const r1 = release(file, owner.nonce);
    await entered.promise;
    const r2 = assert.rejects(release(file, owner.nonce), e => isDiag(e, MISMATCH));
    gate.resolve(); await r1;
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
  for (const p of [join(dir, 'missing-parent', 'l.json'), join(dir, 'not-a-dir', 'l.json')]) {
    await assert.rejects(acquire(p), e => isDiag(e, IO));
    await assert.rejects(release(p, 'synthetic-nonce'), e => isDiag(e, IO));
  }
});
test('DRSEC: failed write after create removes the half-written record', async t => {
  const file = await ledger(t), orig = fs.open;
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
  assert.notEqual(await Promise.race([
    new Promise(res => child.once('exit', res)),
    new Promise((_, rej) => setTimeout(() => rej(new Error('exit deadline')), 2000)),
  ]), 0);
  assert.ok(await readFile(ownerPath(file)));
});
test('DRSEC: second release of a nonce is rejected and keeps the live owner record', async t => {
  const file = await ledger(t);
  const a = await import('./ownership.mjs?a'), b = await import('./ownership.mjs?b');
  const path = a.ownerRecordPath(file), old = await a.acquireOwnership(file);
  const entered = Promise.withResolvers(), resume = Promise.withResolvers();
  t.after(() => { a.setOwnershipReleaseHooks(); b.setOwnershipReleaseHooks(); });
  a.setOwnershipReleaseHooks({ beforeRename: async () => { entered.resolve(); await resume.promise; } });
  const first = a.releaseOwnership(file, old.nonce).then(() => null, error => error);
  await entered.promise;
  try {
    const before = await readFile(path);
    await assert.rejects(b.releaseOwnership(file, old.nonce), e => e?.code === MISMATCH && e.message === MISMATCH);
    assert.deepEqual(await readFile(path), before);
    await assert.rejects(b.acquireOwnership(file), e => e?.code === HELD);
  } finally { resume.resolve(); await first; a.setOwnershipReleaseHooks(); }
  assert.equal(await first, null);
  const successor = await b.acquireOwnership(file), before = await readFile(path);
  await assert.rejects(a.releaseOwnership(file, old.nonce), e => e?.code === MISMATCH);
  assert.deepEqual(await readFile(path), before);
  await assert.rejects(b.acquireOwnership(file), e => e?.code === HELD);
  await b.releaseOwnership(file, successor.nonce);
  const third = await b.acquireOwnership(file), thirdBytes = await readFile(path);
  assert.notEqual(third.nonce, successor.nonce);
  await assert.rejects(b.releaseOwnership(file, successor.nonce), e => e?.code === MISMATCH);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).nonce, third.nonce);
  assert.deepEqual(await readFile(path), thirdBytes);
  await b.releaseOwnership(file, third.nonce);
});

async function killedOwner(t, file) {
  const owner = await holdChild(t, file), before = JSON.parse(await readFile(ownerPath(file), 'utf8'));
  owner.child.kill('SIGKILL'); await owner.exited;
  return before;
}
test('DRSEC-G6: a record left by a killed owner is recovered by the next acquire on this host', async t => {
  const file = await ledger(t), before = await killedOwner(t, file);
  const session = await acquire(file), record = JSON.parse(await readFile(ownerPath(file), 'utf8'));
  assert.equal(record.pid, process.pid); assert.notEqual(record.nonce, before.nonce);
  assert.equal(record.host, `${hostname()}:${process.platform}`);
  await release(file, session.nonce);
  await assert.rejects(readFile(ownerPath(file)), e => e.code === 'ENOENT');
});
test('DRSEC-G6: two starters after a crash admit exactly one', async t => {
  const file = await ledger(t); await killedOwner(t, file);
  const contenders = [0, 1].map(() => {
    const child = spawn(process.execPath, [fixture, file]);
    const exited = once(child, 'exit'), rl = createInterface({ input: child.stdout });
    t.after(() => joinChild(child, rl));
    const outcome = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('contender deadline')), 5000);
      rl.once('line', line => { clearTimeout(timer); resolve(JSON.parse(line).ready); });
      child.once('exit', () => { clearTimeout(timer); resolve(false); });
      child.once('error', reject);
    });
    return { child, exited, outcome };
  });
  const ready = await Promise.all(contenders.map(c => c.outcome));
  assert.equal(ready.filter(Boolean).length, 1);
  for (const [i, c] of contenders.entries()) {
    if (ready[i]) c.child.stdin.write('release\n');
    const [code] = await c.exited;
    if (ready[i]) assert.equal(code, 0); else assert.notEqual(code, 0);
  }
  await assert.rejects(readFile(ownerPath(file)), e => e.code === 'ENOENT');
});
test('DRSEC-G6: a record from another host or an unknown pid state is never recovered', async t => {
  const file = await ledger(t), dead = await killedOwner(t, file), orig = process.kill;
  try {
    for (const host of ['other-host:linux', undefined, null, 42, `${hostname()}:${process.platform}`]) {
      const bytes = JSON.stringify({ ...dead, host });
      await writeFile(ownerPath(file), bytes, { mode: 0o600 });
      process.kill = host === `${hostname()}:${process.platform}`
        ? () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); } : orig;
      await assert.rejects(acquire(file), e => isDiag(e, HELD));
      assert.equal(await readFile(ownerPath(file), 'utf8'), bytes);
    }
  } finally { process.kill = orig; }
});
test('DRSEC-G6: release restores a record that was replaced between read and rename', async t => {
  const file = await ledger(t), session = await acquire(file);
  const foreign = JSON.stringify({ nonce: 'foreign-record', pid: process.pid, heartbeatAt: new Date().toISOString() });
  o.setOwnershipReleaseHooks({ beforeRename: () => writeFile(ownerPath(file), foreign) });
  try {
    await assert.rejects(release(file, session.nonce), e => isDiag(e, MISMATCH));
    assert.equal(await readFile(ownerPath(file), 'utf8'), foreign);
    assert.equal((await readdir(join(file, '..'))).some(n => n.endsWith('.tomb')), false);
  } finally { o.setOwnershipReleaseHooks(); }
});
test('DRSEC-G6: a successor appearing during restore keeps the successor and drops the tomb', async t => {
  const file = await ledger(t), session = await acquire(file), orig = fs.link;
  const foreign = JSON.stringify({ nonce: 'foreign-record', pid: process.pid, heartbeatAt: new Date().toISOString() });
  const successor = foreign.replace('foreign-record', 'live-successor');
  o.setOwnershipReleaseHooks({ beforeRename: () => writeFile(ownerPath(file), foreign) });
  fs.link = async (_from, to) => {
    await writeFile(to, successor, { flag: 'wx', mode: 0o600 });
    throw Object.assign(new Error('exists'), { code: 'EEXIST' });
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(release(file, session.nonce), e => isDiag(e, MISMATCH));
    assert.equal(await readFile(ownerPath(file), 'utf8'), successor);
    assert.equal((await readdir(join(file, '..'))).some(n => n.endsWith('.tomb')), false);
  } finally { o.setOwnershipReleaseHooks(); fs.link = orig; syncBuiltinESMExports(); }
});
test('DRSEC-G6: a hard second-signal exit leaves an owner that the next start recovers', async t => {
  const file = await ledger(t);
  // Emit signal events through stdin for portability; pause close before the rename.
  const script = `import * as o from ${JSON.stringify(new URL('./ownership.mjs', import.meta.url).href)};
    import { createInterface } from 'node:readline';
    const file = process.argv[1], session = await o.acquireOwnership(file);
    o.setOwnershipReleaseHooks({ beforeRename: async () => {
      console.log('closing'); await new Promise(() => {});
    } });
    let stopping = false;
    process.on('SIGTERM', () => {
      if (stopping) process.exit(1);
      stopping = true; o.releaseOwnership(file, session.nonce).then(() => process.exit(0));
    });
    createInterface({ input: process.stdin }).on('line', () => process.emit('SIGTERM'));
    console.log('ready');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, file]);
  const exited = once(child, 'exit'), rl = createInterface({ input: child.stdout });
  t.after(() => joinChild(child, rl));
  const line = () => once(rl, 'line', { signal: AbortSignal.timeout(5000) });
  assert.deepEqual(await line(), ['ready']);
  const before = JSON.parse(await readFile(ownerPath(file), 'utf8')), closing = line();
  child.stdin.write('signal\n'); assert.deepEqual(await closing, ['closing']);
  child.stdin.write('signal\n'); assert.deepEqual(await exited, [1, null]);
  const session = await acquire(file); assert.notEqual(session.nonce, before.nonce);
  await release(file, session.nonce);
});
