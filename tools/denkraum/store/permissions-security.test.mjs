import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DeskStore } from './core.mjs';

const posix = { skip: process.platform === 'win32' ? 'POSIX mode bits do not prove Windows ACL permissions' : false };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-permissions-security-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'ledger.json');
}
const mode = async file => (await stat(file)).mode & 0o777;
const add = store => store.change(state => { state.questions.push({ id: 'question-1', revision: 1, options: [] }); });
const legacy = JSON.stringify({ schemaVersion: 1, revision: 0, questions: [], answers: [] });

test('DRSEC: new ledger temporary and recovery files are created with mode 0600', posix, async t => {
  const file = await fixture(t); const observed = [];
  const store = new DeskStore(file, {
    writeFile: async (path, data, options) => {
      await writeFile(path, data, options); observed.push([path.endsWith('.v1-backup') ? 'backup' : 'temp', await mode(path)]);
    },
    rename: async (from, to) => {
      if (from.endsWith('.previous')) observed.push(['previous-temp', await mode(from)]);
      return rename(from, to);
    },
  });
  const previousUmask = process.umask(0);
  try {
    await add(store); assert.equal(await mode(file), 0o600);
    // Exercise migration recovery separately from the new V2 bootstrap.
    await writeFile(file, JSON.stringify({ schemaVersion: 1, revision: 1, questions: (await store.read()).questions, answers: [] }));
    const original = await readFile(file);
    await store.migrate(1);
    assert.deepEqual(observed, [['temp', 0o600], ['backup', 0o600], ['temp', 0o600], ['previous-temp', 0o600]]);
    for (const path of [file, `${file}.previous`, `${file}.v1-backup`]) assert.equal(await mode(path), 0o600);
    for (const path of [`${file}.previous`, `${file}.v1-backup`]) assert.deepEqual(await readFile(path), original);
    assert.equal((await store.read()).schemaVersion, 2);
  } finally { process.umask(previousUmask); }
});

test('DRSEC: new migration backup and ledger temp stay private with a permissive legacy source', posix, async t => {
  const file = await fixture(t); const observed = [];
  await writeFile(file, legacy); await chmod(file, 0o666);
  const store = new DeskStore(file, { writeFile: async (path, data, options) => {
    await writeFile(path, data, options); observed.push(await mode(path));
  } });
  const previousUmask = process.umask(0);
  try {
    await store.migrate(0);
    assert.deepEqual(observed, [0o600, 0o600]);
    assert.equal(await mode(file), 0o600); assert.equal(await mode(`${file}.v1-backup`), 0o600);
    assert.equal(await readFile(`${file}.v1-backup`, 'utf8'), legacy);
  } finally { process.umask(previousUmask); }
});

test('DRSEC: previous recovery copy from a permissive legacy ledger is owner-only', posix, async t => {
  const file = await fixture(t); const observed = [];
  await writeFile(file, legacy); await chmod(file, 0o666);
  const store = new DeskStore(file, { rename: async (from, to) => {
    if (from.endsWith('.previous')) observed.push(await mode(from));
    return rename(from, to);
  } });
  const previousUmask = process.umask(0);
  try {
    await store.migrate(0);
    assert.equal(await mode(`${file}.previous`), 0o600);
    assert.deepEqual(observed, [0o600]);
    assert.equal(await readFile(`${file}.previous`, 'utf8'), legacy);
    const migrated = await readFile(file, 'utf8');
    await chmod(file, 0o666); await chmod(`${file}.previous`, 0o666);
    await add(store);
    assert.equal(await mode(`${file}.previous`), 0o600);
    assert.deepEqual(observed, [0o600, 0o600]);
    assert.equal(await readFile(`${file}.previous`, 'utf8'), migrated);
  } finally { process.umask(previousUmask); }
});

test('DRSEC: a pre-existing permissive migration backup is secured or rejected', posix, async t => {
  const file = await fixture(t);
  await writeFile(file, legacy, { mode: 0o600 });
  await writeFile(`${file}.v1-backup`, legacy); await chmod(`${file}.v1-backup`, 0o666);
  const store = new DeskStore(file);
  try { await store.migrate(0); } catch (error) {
    assert.equal(error.status, 503); assert.equal(await readFile(file, 'utf8'), legacy); return;
  }
  assert.equal(await mode(`${file}.v1-backup`), 0o600);
  assert.equal(await readFile(`${file}.v1-backup`, 'utf8'), legacy);
  assert.equal((await store.read()).schemaVersion, 2);
});

test('DRSEC: mismatching permissive v1-backup is mode 0600 after 503 rejection', posix, async t => {
  const file = await fixture(t);
  const mismatch = JSON.stringify({ schemaVersion: 1, revision: 99, questions: [{ id: 'stale' }], answers: [] });
  await writeFile(file, legacy, { mode: 0o600 });
  await writeFile(`${file}.v1-backup`, mismatch); await chmod(`${file}.v1-backup`, 0o666);
  const store = new DeskStore(file);
  await assert.rejects(() => store.migrate(0), error => error.status === 503);
  assert.equal(await mode(`${file}.v1-backup`), 0o600);
  assert.equal(await readFile(file, 'utf8'), legacy);
  assert.equal(await readFile(`${file}.v1-backup`, 'utf8'), mismatch);
});
