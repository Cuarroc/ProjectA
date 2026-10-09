import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DeskStore, DeskError, migrateState } from '../store.mjs';

const emptyV1 = () => ({ schemaVersion: 1, revision: 0, questions: [], answers: [] });
const idea = () => ({ requestId: 'fresh-idea', expectedRevision: null, title: 'First idea', text: 'Keep this thought.' });
async function fresh(t) {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-fresh-v2-'));
  const s = new DeskStore(join(dir, 'ledger.json'), { rootAgentId: 'test-root-agent' });
  t.after(() => s.close());
  return { s, dir };
}

test('DR-FRESH-V2: missing ledger reads as empty V2 without filesystem writes', async t => {
  const { s, dir } = await fresh(t);
  assert.deepEqual(await s.read(), migrateState(emptyV1()));
  assert.deepEqual(await s.read(false), migrateState(emptyV1()));
  assert.deepEqual(await readdir(dir), []);
});

test('DR-FRESH-V2: first idea on a missing ledger persists V2 with incoming progress', async t => {
  const { s } = await fresh(t);
  await assert.rejects(readFile(s.file), { code: 'ENOENT' });
  const saved = await s.putIdea(idea());
  const state = JSON.parse(await readFile(s.file, 'utf8'));
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.revision, 1);
  assert.equal(state.ideas[0].id, saved.id);
  assert.equal(state.ideas[0].revisions[0].text, idea().text);
  assert.equal(state.progress[0].eventId, saved.eventId);
  assert.equal(state.progress[0].currentStatus, 'incoming');
  await assert.rejects(readFile(`${s.file}.v1-backup`), { code: 'ENOENT' });
  await s.close();
  assert.deepEqual(await new DeskStore(s.file).read(), state);
});

test('DR-FRESH-V2: existing V1 refuses ideas until explicit migration and preserves original bytes', async t => {
  const { s } = await fresh(t);
  const bytes = '\uFEFF' + JSON.stringify(emptyV1(), null, 2) + '\r\n';
  await writeFile(s.file, bytes);
  assert.deepEqual(await s.read(), emptyV1());
  await assert.rejects(s.putIdea(idea()), e => e instanceof DeskError && e.status === 409);
  assert.equal(await readFile(s.file, 'utf8'), bytes);
  await assert.rejects(readFile(`${s.file}.v1-backup`), { code: 'ENOENT' });
  await s.migrate(0);
  await s.putIdea(idea());
  assert.equal(JSON.parse(await readFile(s.file, 'utf8')).schemaVersion, 2);
  assert.equal(await readFile(`${s.file}.v1-backup`, 'utf8'), bytes);
});
