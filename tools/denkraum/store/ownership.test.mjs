import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import {
  OWNERSHIP_HELD,
  OWNERSHIP_MALFORMED,
  OWNERSHIP_RECOVERY_REFUSED,
  OWNERSHIP_RELEASE_MISMATCH,
  OwnershipError,
  acquireOwnership,
  ownerRecordPath,
  recoverOwnership,
  releaseOwnership,
} from './ownership.mjs';

const posix = { skip: process.platform === 'win32' ? 'POSIX mode 0600 is not Windows ACL evidence' : false };
const fixture = join(import.meta.dirname, 'ownership-contender.fixture.mjs');

async function ledger(t) {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-ownership-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'ledger.json');
}

function isDiag(error, code) {
  return error instanceof OwnershipError && error.code === code
    && error.message === code && !/[\\/]/.test(error.message);
}

async function holdChild(ledgerPath) {
  const child = spawn(process.execPath, [fixture, ledgerPath], {
    cwd: import.meta.dirname, stdio: ['pipe', 'pipe', 'inherit'],
  });
  const rl = createInterface({ input: child.stdout });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('contender ready timeout')), 2000);
    rl.once('line', line => { clearTimeout(timer); resolve(JSON.parse(line)); });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`contender exited early: ${code}`)));
  });
  assert.equal(ready.ready, true);
  return {
    async release() {
      child.stdin.write('release\n');
      await new Promise((resolve, reject) => {
        child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
      });
      rl.close();
    },
  };
}

test('DRSEC: second process is refused while ownership is held', async t => {
  const file = await ledger(t);
  const child = await holdChild(file);
  await assert.rejects(acquireOwnership(file), e => isDiag(e, OWNERSHIP_HELD));
  const before = await readFile(ownerRecordPath(file));
  await assert.rejects(acquireOwnership(file), e => isDiag(e, OWNERSHIP_HELD));
  assert.deepEqual(await readFile(ownerRecordPath(file)), before);
  await child.release();
  const session = await acquireOwnership(file);
  await releaseOwnership(file, session.nonce);
});

test('DRSEC: same-process second acquire with a different nonce is refused', async t => {
  const file = await ledger(t);
  const first = await acquireOwnership(file);
  await assert.rejects(acquireOwnership(file), e => isDiag(e, OWNERSHIP_HELD));
  assert.equal(JSON.parse(await readFile(ownerRecordPath(file), 'utf8')).nonce, first.nonce);
  await releaseOwnership(file, first.nonce);
});

test('DRSEC: stale heartbeat does not release ownership', async t => {
  const file = await ledger(t);
  const session = await acquireOwnership(file);
  const path = ownerRecordPath(file);
  const stale = { nonce: session.nonce, pid: session.pid, heartbeatAt: '2000-01-01T00:00:00.000Z' };
  await writeFile(path, JSON.stringify(stale), { mode: 0o600 });
  await assert.rejects(acquireOwnership(file), e => isDiag(e, OWNERSHIP_HELD));
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), stale);
  await releaseOwnership(file, session.nonce);
});

test('DRSEC: malformed owner record fails closed', async t => {
  const file = await ledger(t);
  const path = ownerRecordPath(file);
  for (const bytes of ['', '{', 'null', '{}', '{"nonce":1}', '{"nonce":"x","pid":"y","heartbeatAt":"z"}']) {
    await writeFile(path, bytes, { mode: 0o600 });
    await assert.rejects(acquireOwnership(file), e => isDiag(e, OWNERSHIP_MALFORMED));
    assert.equal(await readFile(path, 'utf8'), bytes);
    await assert.rejects(recoverOwnership(file, { observedExit: true }), e => isDiag(e, OWNERSHIP_RECOVERY_REFUSED));
    assert.equal(await readFile(path, 'utf8'), bytes);
  }
});

test('DRSEC: release with foreign nonce keeps the record', async t => {
  const file = await ledger(t);
  const session = await acquireOwnership(file);
  const path = ownerRecordPath(file);
  const before = await readFile(path);
  await assert.rejects(releaseOwnership(file, 'foreign-nonce'), e => isDiag(e, OWNERSHIP_RELEASE_MISMATCH));
  assert.deepEqual(await readFile(path), before);
  await releaseOwnership(file, session.nonce);
  await assert.rejects(readFile(path), e => e.code === 'ENOENT');
});

test('DRSEC: owner record is created exclusively with mode 0600', posix, async t => {
  const file = await ledger(t);
  const previousUmask = process.umask(0);
  try {
    const session = await acquireOwnership(file);
    assert.equal((await stat(ownerRecordPath(file))).mode & 0o777, 0o600);
    await releaseOwnership(file, session.nonce);
  } finally {
    process.umask(previousUmask);
  }
});
