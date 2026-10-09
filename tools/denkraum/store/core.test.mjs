import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
