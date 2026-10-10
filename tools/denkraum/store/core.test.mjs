import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { DeskStore } from './core.mjs';
import { DeskError, migrateState } from './model.mjs';

const fresh = async io => new DeskStore(join(await mkdtemp(join(tmpdir(), 'denkraum-core-')), 'ledger.json'), io);
async function legacyStore() {
  const s = await fresh();
  await writeFile(s.file, JSON.stringify({ schemaVersion: 1, revision: 0, questions: [], answers: [] }));
  return s;
}
const add = (s, id = 'E-1') => s.change(state => { state.questions.push({ id, revision: 1, options: [] }); return id; });
const failRenameTo = file => async (from, to) => { if (to === file) throw new Error('simulated interruption'); return rename(from, to); };
const is503 = e => e instanceof DeskError && e.status === 503;

test('read preserves an existing empty V1 ledger, strips a BOM and never writes', async () => {
  const s = await legacyStore();
  assert.deepEqual(await s.read(), { schemaVersion: 1, revision: 0, questions: [], answers: [] });
  assert.equal(JSON.parse(await readFile(s.file, 'utf8')).schemaVersion, 1);
  const bytes = '﻿' + JSON.stringify({ schemaVersion: 1, revision: 2, questions: [], answers: [], extra: 1 }) + '\r\n';
  await writeFile(s.file, bytes);
  assert.equal((await s.read()).extra, 1);
  assert.equal(await readFile(s.file, 'utf8'), bytes);
});

test('corrupt or malformed ledgers fail reads and changes with 503 and unchanged bytes', async () => {
  const s = await fresh(); const v2 = migrateState({ schemaVersion: 1, revision: 0, questions: [], answers: [] });
  for (const bytes of ['{ not json', JSON.stringify(null), JSON.stringify({ ...v2, schemaVersion: 3 }), JSON.stringify({ ...v2, receipts: {} }),
    JSON.stringify({ ...v2, revision: -1 }), JSON.stringify({ ...v2, answers: [null] })]) {
    await writeFile(s.file, bytes);
    await assert.rejects(s.read(), is503, bytes);
    await assert.rejects(add(s), is503, bytes);
    assert.equal(await readFile(s.file, 'utf8'), bytes);
  }
});

// Serialization covers every joined store instance on the ledger.
test('concurrent changes of one store are serialized, each counted once, and a failed change does not block the queue', async () => {
  const s = await fresh();
  const results = await Promise.allSettled([add(s, 'q1'), s.change(() => { throw new Error('rejected change'); }), add(s, 'q2'), add(s, 'q3')]);
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
  const state = await s.read();
  assert.deepEqual(state.questions.map(q => q.id), ['q1', 'q2', 'q3']);
  assert.equal(state.revision, 3);
});

test('an unchanged state returns the result without writing or incrementing the revision', async () => {
  let writes = 0; const s = await fresh({ writeFile: async (...args) => { writes++; return writeFile(...args); } });
  await add(s); const bytes = await readFile(s.file, 'utf8'); writes = 0;
  assert.equal(await s.change(state => state.questions.length), 1);
  assert.equal(writes, 0); assert.equal(await readFile(s.file, 'utf8'), bytes);
});

test('a change that breaks the ledger contract is rejected before any write', async () => {
  const s = await fresh(); await add(s); const bytes = await readFile(s.file, 'utf8');
  await assert.rejects(s.change(state => { state.answers.push(null); }), is503);
  await assert.rejects(s.change(state => { state.revision = Number.MAX_SAFE_INTEGER; }), is503);
  assert.equal(await readFile(s.file, 'utf8'), bytes);
});

test('a failed atomic replacement preserves committed state and can be retried', async () => {
  const s = await fresh(); await add(s); const before = await readFile(s.file, 'utf8');
  await assert.rejects(add(new DeskStore(s.file, { rename: failRenameTo(s.file) }), 'E-2'), /simulated interruption/);
  assert.equal(await readFile(s.file, 'utf8'), before);
  await add(s, 'E-2');
  assert.equal((await s.read()).questions.length, 2);
  assert.equal(await readFile(`${s.file}.previous`, 'utf8'), before);
});

test('NOT-1: rename EPERM twice then success commits and leaves no temp file', async t => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    const s = await fresh(); t.after(() => s.close());
    await add(s); const before = await readFile(s.file);
    const attempts = new Map(); const delays = [];
    s.io.sleep = async ms => { delays.push(ms); };
    s.io.rename = async (from, to) => {
      const count = (attempts.get(to) ?? 0) + 1; attempts.set(to, count);
      if (count <= 2) throw Object.assign(new Error('reader holds file'), { code });
      return rename(from, to);
    };
    assert.equal(await add(s, 'E-2'), 'E-2');
    assert.deepEqual([...attempts.values()], [3, 3]);
    assert.deepEqual(delays, [10, 20, 10, 20]);
    assert.equal((await s.read()).revision, 2);
    assert.deepEqual((await s.read()).questions.map(q => q.id), ['E-1', 'E-2']);
    assert.deepEqual(await readFile(`${s.file}.previous`), before);
    assert.deepEqual((await readdir(dirname(s.file))).filter(f => f.includes('.tmp')), []);
  }
});

test('NOT-1: permanent EPERM rejects and keeps committed bytes and removes the temp file', async t => {
  for (const suffix of ['', '.previous']) {
    const s = await fresh(); t.after(() => s.close());
    await add(s); const before = await readFile(s.file); const delays = []; let attempts = 0;
    const original = Object.assign(new Error('reader holds file'), { code: 'EPERM' });
    s.io.sleep = async ms => { delays.push(ms); };
    s.io.rename = async (from, to) => {
      if (to === `${s.file}${suffix}`) {
        attempts++;
        throw attempts === 1 ? original : Object.assign(new Error('still busy'), { code: 'EPERM' });
      }
      return rename(from, to);
    };
    await assert.rejects(add(s, 'E-2'), error => error === original);
    assert.deepEqual(await readFile(s.file), before);
    assert.deepEqual((await readdir(dirname(s.file))).filter(f => f.includes('.tmp')), []);
    assert.equal(attempts, 6);
    assert.deepEqual(delays, [10, 20, 40, 80, 100]);
  }
});

test('NOT-1: a non-retryable error on a later rename attempt is thrown instead of the first one', async t => {
  for (const failAt of [2, 6]) {
    const s = await fresh(); t.after(() => s.close());
    await add(s); const before = await readFile(s.file); const delays = []; let attempts = 0;
    const first = Object.assign(new Error('reader holds file'), { code: 'EPERM' });
    const last = Object.assign(new Error('source disappeared'), { code: 'ENOENT' });
    s.io.sleep = async ms => { delays.push(ms); };
    s.io.rename = async (from, to) => {
      if (to !== s.file) return rename(from, to);
      throw ++attempts === failAt ? last : first;
    };
    await assert.rejects(add(s, 'E-2'), error => {
      assert.equal(error, last);
      assert.equal(error.cause, first);
      return true;
    });
    assert.equal(attempts, failAt);
    assert.deepEqual(delays, [10, 20, 40, 80, 100].slice(0, failAt - 1));
    assert.deepEqual(await readFile(s.file), before);
    assert.deepEqual((await readdir(dirname(s.file))).filter(f => f.includes('.tmp')), []);
  }
});

test('NOT-1: an ENOENT after EPERM during the previous rotation is tolerated and the commit succeeds', async t => {
  const s = await fresh(); t.after(() => s.close());
  await add(s); const delays = []; let attempts = 0;
  s.io.sleep = async ms => { delays.push(ms); };
  s.io.rename = async (from, to) => {
    if (to !== `${s.file}.previous`) return rename(from, to);
    if (++attempts === 1) throw Object.assign(new Error('reader holds file'), { code: 'EPERM' });
    await s.io.unlink(from);
    throw Object.assign(new Error('source disappeared'), { code: 'ENOENT' });
  };
  assert.equal(await add(s, 'E-2'), 'E-2');
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [10]);
  const state = await s.read();
  assert.equal(state.revision, 2);
  assert.deepEqual(state.questions.map(q => q.id), ['E-1', 'E-2']);
  assert.deepEqual((await readdir(dirname(s.file))).filter(f => f.includes('.tmp')), []);
});

test('NOT-1: the backup temp write goes through the io seam', async t => {
  const s = await fresh(); t.after(() => s.close());
  await add(s); const before = await readFile(s.file); const paths = [];
  const write = s.io.writeFile;
  s.io.writeFile = async (path, ...args) => { paths.push(path); return write(path, ...args); };
  assert.equal(await add(s, 'E-2'), 'E-2');
  assert.ok(paths.some(path => path.startsWith(`${s.file}.`) && path.endsWith('.tmp.previous')),
    `backup temp must use io.writeFile, got ${JSON.stringify(paths)}`);
  assert.deepEqual(await readFile(`${s.file}.previous`), before);
});

test('NOT-1: a held temp file is unlinked after a retry', async t => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    const s = await fresh(); t.after(() => s.close());
    await add(s); const before = await readFile(s.file); const delays = [];
    const unlinkAttempts = new Map();
    s.io.sleep = async ms => { delays.push(ms); };
    s.io.rename = async (from, to) => {
      if (to === s.file) throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
      return rename(from, to);
    };
    const unlink = s.io.unlink;
    s.io.unlink = async path => {
      const count = (unlinkAttempts.get(path) ?? 0) + 1; unlinkAttempts.set(path, count);
      if (path.startsWith(`${s.file}.`) && path.endsWith('.tmp') && count === 1)
        throw Object.assign(new Error('reader holds temp'), { code });
      return unlink(path);
    };
    await assert.rejects(add(s, 'E-2'), error => error.code === 'ENOSPC');
    assert.deepEqual(await readFile(s.file), before);
    assert.deepEqual(delays, [10]);
    assert.equal([...unlinkAttempts.values()].some(count => count >= 2), true);
    assert.deepEqual((await readdir(dirname(s.file))).filter(f => f.includes('.tmp')), []);
  }
});

test('process termination during a partial temporary write preserves the last commit', async () => {
  const s = await fresh(); await add(s); const before = await readFile(s.file, 'utf8');
  await s.close(); // Hand off ownership before the child deliberately terminates.
  const source = `import { DeskStore } from './core.mjs'; import { writeFile } from 'node:fs/promises';
    const s = new DeskStore(process.argv[1], { writeFile: async (path, data) => { await writeFile(path, data.slice(0, 20)); process.exit(42); } });
    await s.change(state => { state.questions.push({ id: 'E-2', revision: 1, options: [] }); });`;
  await assert.rejects(promisify(execFile)(process.execPath, ['--input-type=module', '-e', source, s.file], { cwd: import.meta.dirname }), e => e.code === 42);
  assert.equal(await readFile(s.file, 'utf8'), before);
  assert.equal((await new DeskStore(s.file).read()).questions.length, 1);
});

test('migration rejects a nonexistent source with 404 and creates neither state nor backup', async t => {
  const s = await fresh(); t.after(() => s.close());
  await assert.rejects(s.migrate(0), e => e instanceof DeskError && e.status === 404
    && e.message === 'Migrationsquelle fehlt; explizite Migration abgelehnt.');
  await assert.rejects(readFile(s.file), e => e.code === 'ENOENT');
  await assert.rejects(readFile(`${s.file}.v1-backup`), e => e.code === 'ENOENT');
});

test('R912-FU-1: migrate on a source deleted between read and callback still rejects 404 without stat', async t => {
  for (const recreate of [true, false]) {
    const s = await legacyStore(); t.after(() => s.close());
    const original = await readFile(s.file); let reads = 0;
    s.io.readFile = async (path, ...args) => {
      if (path !== s.file || ++reads !== 1) return readFile(path, ...args);
      await rename(s.file, `${s.file}.removed-source`);
      if (!recreate) return original.toString('utf8');
      try { return await readFile(path, ...args); }
      finally { await writeFile(s.file, original); }
    };
    await assert.rejects(s.migrate(0), error => error instanceof DeskError && error.status === 404
      && error.message === 'Migrationsquelle fehlt; explizite Migration abgelehnt.');
    assert.ok(reads > 0, 'migration must use the injected read hook');
    await assert.rejects(readFile(`${s.file}.v1-backup`), error => error.code === 'ENOENT');
    if (recreate) assert.deepEqual(await readFile(s.file), original);
    else await assert.rejects(readFile(s.file), error => error.code === 'ENOENT');
    const state = await s.read();
    assert.equal(Object.hasOwn(state, 'existed'), false);
    assert.equal(Object.hasOwn(state, 'state'), false);
  }
});

test('migration rejects a disappearing V1 source and creates neither state nor backup', async () => {
  const s = await legacyStore();
  const read = s.read.bind(s);
  s.read = async (...args) => {
    const state = await read(...args);
    await rename(s.file, `${s.file}.removed-source`);
    return state;
  };
  await assert.rejects(s.migrate(0), e => e.status === 404 && /Migrationsquelle/.test(e.message));
  await assert.rejects(readFile(s.file), e => e.code === 'ENOENT');
  await assert.rejects(readFile(`${s.file}.v1-backup`), e => e.code === 'ENOENT');
  assert.throws(() => s.migrate(-1), e => e instanceof DeskError && e.status === 400);
});

test('migration keeps the exact V1 bytes as permanent backup and repeating it is a no-op', async () => {
  const s = await legacyStore(); await add(s); const legacy = await s.read();
  const bytes = '﻿' + JSON.stringify(legacy, null, 2) + '\r\n'; await writeFile(s.file, bytes);
  await s.migrate(legacy.revision);
  assert.equal(await readFile(`${s.file}.v1-backup`, 'utf8'), bytes);
  const v2 = await new DeskStore(s.file).read(); const v2bytes = await readFile(s.file, 'utf8');
  assert.equal(v2.schemaVersion, 2); assert.equal(v2.revision, legacy.revision + 1); assert.deepEqual(v2.questions, legacy.questions);
  await s.migrate(legacy.revision);
  assert.equal(await readFile(s.file, 'utf8'), v2bytes);
  await add(s, 'E-2');
  assert.equal(await readFile(`${s.file}.v1-backup`, 'utf8'), bytes);
});

test('migration backup or replacement failure retains the committed V1 bytes', async () => {
  const s = await legacyStore(); await add(s); const before = await readFile(s.file, 'utf8'); const { revision } = await s.read();
  const noBackup = new DeskStore(s.file, { writeFile: async (path, ...args) => {
    if (path.endsWith('.v1-backup')) throw new Error('backup unavailable');
    return writeFile(path, ...args);
  } });
  await assert.rejects(noBackup.migrate(revision), /backup unavailable/);
  assert.equal(await readFile(s.file, 'utf8'), before);
  await assert.rejects(new DeskStore(s.file, { rename: failRenameTo(s.file) }).migrate(revision), /simulated interruption/);
  assert.equal(await readFile(s.file, 'utf8'), before);
  assert.equal(await readFile(`${s.file}.v1-backup`, 'utf8'), before);
  await s.migrate(revision);
  assert.equal((await s.read()).schemaVersion, 2);
});

test('migration refuses a stale revision, a mismatched backup and colliding legacy fields', async () => {
  const s = await legacyStore(); await add(s); const before = await readFile(s.file, 'utf8'); const { revision } = await s.read();
  await assert.rejects(s.migrate(revision - 1), e => e.status === 409);
  await writeFile(`${s.file}.v1-backup`, 'unrelated backup');
  await assert.rejects(s.migrate(revision), is503);
  assert.equal(await readFile(s.file, 'utf8'), before);
  assert.equal(await readFile(`${s.file}.v1-backup`, 'utf8'), 'unrelated backup');
  const other = await fresh(); const colliding = JSON.stringify({ schemaVersion: 1, revision: 0, questions: [], answers: [], ideas: null });
  await writeFile(other.file, colliding);
  await assert.rejects(other.migrate(0), is503);
  assert.equal(await readFile(other.file, 'utf8'), colliding);
});

test('the root agent id is taken only from explicit configuration', async () => {
  assert.equal((await fresh({ rootAgentId: 'configured-root' })).rootAgentId, 'configured-root');
  const s = await fresh();
  assert.equal(s.rootAgentId, undefined);
  assert.equal(Object.hasOwn(s.io, 'rootAgentId'), false);
});
