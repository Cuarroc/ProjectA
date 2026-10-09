import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import fs, { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { DeskStore } from './core.mjs';
import * as o from './ownership.mjs';
const empty = { schemaVersion: 1, revision: 0, questions: [], answers: [] };
const add = (store, id) => store.change(s => { s.questions.push({ id, revision: 1, options: [] }); });
async function ledger(t) {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-concurrency-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'ledger.json');
}
async function holdChild(t, file) {
  const child = spawn(process.execPath, [join(import.meta.dirname, 'ownership-contender.fixture.mjs'), file]);
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; });
  const [ready] = await once(child.stdout, 'data', { signal: AbortSignal.timeout(5000) });
  assert.equal(JSON.parse(ready).ready, true);
  return async () => { child.stdin.write('release\n'); assert.deepEqual(await exited, [0, null]); };
}

test('DRSEC: mutation without held ownership context fails closed before any write', async t => {
  const file = await ledger(t), release = await holdChild(t, file);
  const owner = await readFile(o.ownerRecordPath(file));
  let writes = 0, entered = false;
  const store = new DeskStore(file, { writeFile: async (...args) => { writes++; return writeFile(...args); } });
  await assert.rejects(store.change(() => { entered = true; }), e => e.code === o.OWNERSHIP_HELD);
  assert.equal(entered, false); assert.equal(writes, 0);
  await assert.rejects(readFile(file), e => e.code === 'ENOENT');
  await writeFile(file, JSON.stringify(empty));
  await assert.rejects(store.migrate(0), e => e.code === o.OWNERSHIP_HELD);
  assert.equal(writes, 0); assert.deepEqual(JSON.parse(await readFile(file)), empty);
  assert.deepEqual((await readdir(join(file, '..'))).sort(), ['ledger.json', 'ledger.json.owner']);
  assert.deepEqual(await readFile(o.ownerRecordPath(file)), owner);
  await release();
});

test('DRSEC: two same-process store instances share one ledger queue', async t => {
  const file = await ledger(t); await writeFile(file, JSON.stringify(empty));
  const a = new DeskStore(file), b = new DeskStore(file);
  // A synchronous disk snapshot makes the unprotected interleaving deterministic.
  b.read = async () => JSON.parse(readFileSync(file, 'utf8'));
  const entered = Promise.withResolvers(), gate = Promise.withResolvers();
  const first = a.change(async s => {
    s.questions.push({ id: 'q1', revision: 1, options: [] }); entered.resolve(); await gate.promise;
  });
  await entered.promise;
  const second = add(b, 'q2');
  await setImmediate(); gate.resolve(); await Promise.all([first, second]);
  assert.deepEqual((await a.read()).questions.map(q => q.id), ['q1', 'q2']);
  assert.equal((await a.read()).revision, 2);
  await a.close(); await b.close();
});

test('DRSEC: lost ownership blocks mutation and migration without touching ledger bytes', async t => {
  const file = await ledger(t), store = new DeskStore(file);
  await add(store, 'q1'); const before = await readFile(file);
  await writeFile(o.ownerRecordPath(file), 'invalid owner');
  for (const mutate of [() => add(store, 'q2'), () => store.migrate(1)]) {
    await assert.rejects(mutate(), e => e.code === o.OWNERSHIP_RELEASE_MISMATCH);
    assert.deepEqual(await readFile(file), before);
    await assert.rejects(readFile(`${file}.v1-backup`), e => e.code === 'ENOENT');
  }
});

test('DRSEC: second releaseOwnership of a spent nonce is rejected and never removes a live successor', async t => {
  const file = await ledger(t);
  const a = await import('./ownership.mjs?spent-a'), b = await import('./ownership.mjs?spent-b');
  const path = a.ownerRecordPath(file), old = await a.acquireOwnership(file);
  const original = await readFile(path);
  await a.releaseOwnership(file, old.nonce);
  await assert.rejects(b.releaseOwnership(file, old.nonce), e => e?.code === a.OWNERSHIP_RELEASE_MISMATCH);
  const live = await b.acquireOwnership(file), before = await readFile(path);
  await assert.rejects(a.releaseOwnership(file, old.nonce), e => e?.code === a.OWNERSHIP_RELEASE_MISMATCH);
  assert.deepEqual(await readFile(path), before);
  await writeFile(path, original);
  await assert.rejects(b.releaseOwnership(file, old.nonce), e => e?.code === b.OWNERSHIP_RELEASE_MISMATCH);
  assert.deepEqual(await readFile(path), original);
  await writeFile(path, before); await b.releaseOwnership(file, live.nonce);
});

test('DRSEC: close drains queued changes and only the last joined store releases ownership', async t => {
  const file = await ledger(t), a = new DeskStore(file), b = new DeskStore(file);
  const entered = Promise.withResolvers(), gate = Promise.withResolvers();
  const first = a.change(async s => {
    entered.resolve(); await gate.promise; s.questions.push({ id: 'q1', revision: 1, options: [] });
  });
  await entered.promise;
  const second = add(b, 'q2'), owner = await readFile(o.ownerRecordPath(file));
  const closing = a.close(); assert.equal(a.close(), closing);
  await assert.rejects(add(a, 'closed'), e => e.code === o.OWNERSHIP_RELEASE_MISMATCH);
  assert.deepEqual(await readFile(o.ownerRecordPath(file)), owner);
  gate.resolve(); await Promise.all([first, second, closing]);
  assert.deepEqual(await readFile(o.ownerRecordPath(file)), owner);
  await add(b, 'q3'); await b.close();
  await assert.rejects(readFile(o.ownerRecordPath(file)), e => e.code === 'ENOENT');
  const successor = new DeskStore(file); await add(successor, 'q4');
  assert.deepEqual((await successor.read()).questions.map(q => q.id), ['q1', 'q2', 'q3', 'q4']);
  assert.equal((await successor.read()).revision, 4); await successor.close();
});

test('DRSEC: failed first mutation releases its new ownership and leaves the ledger untouched', async t => {
  const file = await ledger(t), store = new DeskStore(file);
  await assert.rejects(store.change(async () => {
    assert.ok(await readFile(o.ownerRecordPath(file)));
    throw new Error('rejected change');
  }), /rejected change/);
  await assert.rejects(readFile(file), e => e.code === 'ENOENT');
  await assert.rejects(readFile(o.ownerRecordPath(file)), e => e.code === 'ENOENT');
  const next = await o.acquireOwnership(file); await o.releaseOwnership(file, next.nonce);
  await add(store, 'retry'); assert.equal((await store.read()).revision, 1); await store.close();
});

test('DRSEC: closed child server releases ownership for the next process', async t => {
  const file = await ledger(t);
  const script = `import { createDeskServer } from ${JSON.stringify(new URL('../server.mjs', import.meta.url).href)};
    const server = createDeskServer({ statePath: process.argv[1] });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const body = { id: 'q-' + process.pid, title: 'T', context: 'C', owner: 'O', category: 'K', scope: 'S', source: 'Q', uncertainty: 'U',
      recommendation: { optionIds: ['a'], rationale: 'R' }, options: ['a', 'b'].map(id => ({ id, label: id, rationale: 'R', impact: 'I', tradeoff: 'T', effort: 'E', reversible: 'Y' })) };
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/questions', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-decision-desk': 'agent' }, body: JSON.stringify(body) });
    if (response.status !== 200) throw new Error('write status ' + response.status);
    await response.text(); await new Promise(r => server.close(r));
    if ((await import('node:fs')).existsSync(process.argv[1] + '.owner')) throw new Error('close left ownership held');`;
  for (let i = 0; i < 2; i++) {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script, file], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 0, run.stderr);
  }
  assert.equal(JSON.parse(await readFile(file)).revision, 2);
});

test('DRSEC: release failure preserves the mutation error and clears the session', async t => {
  const file = await ledger(t), store = new DeskStore(file);
  await assert.rejects(store.change(async () => { await rm(o.ownerRecordPath(file)); throw new Error('orig'); }),
    e => e.message === 'orig' && e.cause?.code === o.OWNERSHIP_RELEASE_MISMATCH);
  await store.close();
  const next = new DeskStore(file); await add(next, 'retry'); await next.close();
});

test('DRSEC: rejected close clears the session for a fresh store', async t => {
  const file = await ledger(t), next = new DeskStore(file); await add(next, 'first');
  await rm(o.ownerRecordPath(file));
  await assert.rejects(next.close(), e => e.code === o.OWNERSHIP_RELEASE_MISMATCH);
  const last = new DeskStore(file); await assert.doesNotReject(add(last, 'after-close-error')); await last.close();
  await assert.rejects(readFile(o.ownerRecordPath(file)), e => e.code === 'ENOENT');
});

test('DRSEC: failed acquisition does not retain a user when the store is dropped', async t => {
  const file = await ledger(t), release = await holdChild(t, file);
  await assert.rejects(add(new DeskStore(file), 'blocked'), e => e.code === o.OWNERSHIP_HELD);
  await release();
  const next = new DeskStore(file); await add(next, 'retry'); await next.close();
  await assert.rejects(readFile(o.ownerRecordPath(file)), e => e.code === 'ENOENT');
});

test('DRSEC: a failed release no longer locks the same process out of its own ledger', async t => {
  const file = await ledger(t), store = new DeskStore(file), orig = fs.rename;
  await add(store, 'first'); const before = JSON.parse(await readFile(o.ownerRecordPath(file), 'utf8'));
  fs.rename = async (from, to) => {
    if (from !== o.ownerRecordPath(file) || !to.startsWith(`${from}.`) || !to.endsWith('.tomb')) return orig(from, to);
    fs.rename = orig; syncBuiltinESMExports();
    throw Object.assign(new Error('rename failed'), { code: 'EIO' });
  };
  syncBuiltinESMExports();
  try { await assert.rejects(store.close(), e => e.code === o.OWNERSHIP_IO); }
  finally { fs.rename = orig; syncBuiltinESMExports(); }
  const next = new DeskStore(file); await add(next, 'second');
  assert.notEqual(JSON.parse(await readFile(o.ownerRecordPath(file), 'utf8')).nonce, before.nonce);
  assert.deepEqual((await next.read()).questions.map(q => q.id), ['first', 'second']);
  await next.close(); await assert.rejects(readFile(o.ownerRecordPath(file)), e => e.code === 'ENOENT');
});
test('DRSEC-G6: a never-opened sibling mutation waits for closing and acquires a fresh session', async t => {
  const file = await ledger(t), a = new DeskStore(file), b = new DeskStore(file);
  await add(a, 'first'); const before = await readFile(o.ownerRecordPath(file));
  const entered = Promise.withResolvers(), resume = Promise.withResolvers();
  o.setOwnershipReleaseHooks({ beforeRename: async () => { entered.resolve(); await resume.promise; } });
  const closing = a.close(); await entered.promise;
  let mutated = false;
  const mutation = b.change(s => { mutated = true; s.questions.push({ id: 'second', revision: 1, options: [] }); });
  try {
    await setImmediate(); assert.equal(mutated, false);
    assert.deepEqual(await readFile(o.ownerRecordPath(file)), before);
  } finally { resume.resolve(); await closing; o.setOwnershipReleaseHooks(); }
  await mutation;
  assert.notEqual(JSON.parse(await readFile(o.ownerRecordPath(file), 'utf8')).nonce, JSON.parse(before).nonce);
  assert.deepEqual((await b.read()).questions.map(q => q.id), ['first', 'second']);
  await b.close(); await assert.rejects(readFile(o.ownerRecordPath(file)), e => e.code === 'ENOENT');
});
