import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeskStore } from './store.mjs';
import * as storeModule from './store.mjs';
import { rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const question = (id = 'E-test') => ({ id, title: 'Welche Grenze gilt?', category: 'Sicherheit',
  context: 'Ein begrenzter Testfall.', owner: 'Orchestrator', priority: 'normal', mode: 'single',
  source: 'Test-Fixture', scope: 'Nur der Test', uncertainty: 'Keine Produktionsaussage.',
  recommendation: { optionIds: ['a'], rationale: 'Die begrenzte Variante ist umkehrbar.' },
  options: [{ id: 'a', label: 'Begrenzt', rationale: 'Kleiner Umfang.', impact: 'Nur den Test ändern.',
    tradeoff: 'Weniger Umfang.', effort: 'Gering', reversible: 'Ja' },
  { id: 'b', label: 'Weiter', rationale: 'Mehr Umfang.', impact: 'Mehr Testarbeit.',
    tradeoff: 'Mehr Aufwand.', effort: 'Hoch', reversible: 'Ja' }] });
async function fresh() { const dir = await mkdtemp(join(tmpdir(), 'decision-desk-test-')); return new DeskStore(join(dir, 'state.json'), { rootAgentId: ROOT }); }
const answer = (extra = {}) => ({ questionId: 'E-test', questionRevision: 1, expectedAnswerId: null,
  requestId: 'request-1', action: 'answer', selected: ['a'], note: '', ...extra });

const ROOT = 'test-root-agent';
const rootAgentId = ROOT;
const receiptInput = a => ({ receiptId: 'receipt-1', eventRef: { kind: 'answer', eventId: a.id,
  questionId: a.questionId, questionRevision: a.questionRevision }, transportMessageId: 'mail-parent', rootReplyId: 'mail-reply' });
const verifiedReceipt = async input => ({ ...input, rootAgentId,
  rootAcknowledgedAt: '2026-10-06T17:00:00.000Z', observedProof: 'Root reply body binds the exact event and revision.' });
async function receiptFixture(extra = {}) {
  const legacy = await fresh(); await legacy.putQuestion(question()); const a = await legacy.answer(answer(extra));
  await legacy.migrate((await legacy.read()).revision);
  return { s: new DeskStore(legacy.file, { rootAgentId: ROOT, verifyReceipt: verifiedReceipt }), a, input: receiptInput(a) };
}

test('recommendations never become answers; answers survive a new store instance', async () => {
  const s = await fresh(); await s.putQuestion(question());
  assert.equal((await s.read()).answers.length, 0);
  await s.answer(answer());
  assert.equal((await new DeskStore(s.file, { rootAgentId: ROOT }).read()).answers[0].selected[0], 'a');
});
test('reject stale questions and invalid or duplicate selections', async () => {
  const s = await fresh(); await s.putQuestion(question());
  for (const selected of [[], ['missing'], ['a', 'b'], ['a', 'a']])
    await assert.rejects(s.answer(answer({ selected })), /Auswahl/);
  await s.putQuestion({ ...question(), expectedRevision: 1, context: 'Neuer Geltungsbereich' });
  await assert.rejects(s.answer(answer()), /geändert/);
});
test('concurrent tabs cannot overwrite each other and repeated request is idempotent', async () => {
  const s = await fresh(); await s.putQuestion(question());
  const results = await Promise.allSettled([s.answer(answer()), s.answer(answer({ requestId: 'request-2', selected: ['b'] }))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  await s.answer(answer()); assert.equal((await s.read()).answers.length, 1);
  await assert.rejects(s.answer(answer({ selected: ['b'] })), /Anfrage/);
});
test('multi choice permits a set but not an exclusive alternative combined with others', async () => {
  const s = await fresh(); const q = question(); q.mode = 'multiple'; q.options.push({ ...q.options[1], id: 'none', exclusive: true });
  await s.putQuestion(q); await assert.rejects(s.answer(answer({ selected: ['a', 'none'] })), /Auswahl/);
  await s.answer(answer({ selected: ['a', 'b'] }));
});
test('only the current answer is pending; acknowledgements are not execution', async () => {
  const s = await fresh(); await s.putQuestion(question()); const a = await s.answer(answer());
  await s.ack({ answerId: a.id, status: 'received', actor: 'Interviewer', note: 'Weitergegeben.', deliveryReceipt: 'Orchestrator bestätigt msg-1' });
  assert.equal((await s.pending()).length, 0);
  assert.equal((await s.read()).answers[0].ack.status, 'received');
  await s.putQuestion({ ...question(), expectedRevision: 1, context: 'Geändert.' });
  await assert.rejects(s.ack({ answerId: a.id, status: 'applied', actor: 'Orchestrator', note: 'Umgesetzt.' }), /aktuell/);
});
test('defer and clarification are never approvals; malformed state is not overwritten', async () => {
  const s = await fresh(); await s.putQuestion(question());
  const a = await s.answer(answer({ action: 'defer', selected: [] }));
  await assert.rejects(s.ack({ answerId: a.id, status: 'applied', actor: 'Orchestrator', note: 'Nein' }), /Zustimmung/);
  await writeFile(s.file, '{broken'); await assert.rejects(s.putQuestion(question('second')));
  assert.equal(await readFile(s.file, 'utf8'), '{broken');
});
test('concurrent incoming questions are retained and sources are required', async () => {
  const s = await fresh(); await Promise.all([s.putQuestion(question('one')), s.putQuestion(question('two'))]);
  assert.equal((await s.read()).questions.length, 2);
  await assert.rejects(s.putQuestion({ ...question(), source: '' }), /source/);
});

test('duplicate answers do not write or increment the state revision', async () => {
  const s = await fresh(); await s.putQuestion(question()); await s.answer(answer());
  const before = await readFile(s.file, 'utf8');
  await s.answer(answer());
  assert.equal(await readFile(s.file, 'utf8'), before);
});

test('receipts require confirmed delivery and application requires evidence', async () => {
  const s = await fresh(); await s.putQuestion(question()); const a = await s.answer(answer());
  const receipt = { answerId: a.id, status: 'received', actor: 'Orchestrator', note: 'Weitergegeben' };
  await assert.rejects(s.ack(receipt), /Weitergabebeleg/);
  await assert.rejects(s.ack({ ...receipt, status: 'applied', evidence: 'commit abc' }), /Empfang/);
  await s.ack({ ...receipt, deliveryReceipt: 'Orchestrator bestätigt msg-123' });
  await assert.rejects(s.ack({ ...receipt, status: 'applied' }), /Umsetzungsbeleg/);
  await s.ack({ ...receipt, status: 'applied', evidence: 'commit abc; überprüft' });
  assert.equal((await s.read()).answers[0].ack.evidence, 'commit abc; überprüft');
});

test('a failed atomic replacement preserves committed state and can be retried', async () => {
  const s = await fresh(); await s.putQuestion(question());
  const before = await readFile(s.file, 'utf8');
  const failing = new DeskStore(s.file, { rootAgentId: ROOT, rename: async (from, to) => {
    if (to === s.file) throw new Error('simulated interruption before rename');
    return rename(from, to);
  } });
  await assert.rejects(failing.putQuestion(question('second')), /simulated interruption/);
  assert.equal(await readFile(s.file, 'utf8'), before);
  await s.putQuestion(question('second'));
  assert.equal((await s.read()).questions.length, 2);
  assert.equal(await readFile(`${s.file}.previous`, 'utf8'), before);
});

test('process termination during a partial temporary write preserves the last commit', async () => {
  const s = await fresh(); await s.putQuestion(question()); const before = await readFile(s.file, 'utf8');
  const source = `import { DeskStore } from './store.mjs'; import { writeFile } from 'node:fs/promises';
    const s = new DeskStore(process.argv[1], { writeFile: async (path, data) => {
      await writeFile(path, data.slice(0, 20)); process.exit(42);
    } }); await s.putQuestion(JSON.parse(process.argv[2]));`;
  await assert.rejects(promisify(execFile)(process.execPath, ['--input-type=module', '-e', source, s.file, JSON.stringify(question('second'))], { cwd: import.meta.dirname }), e => e.code === 42);
  assert.equal(await readFile(s.file, 'utf8'), before);
  assert.equal((await new DeskStore(s.file, { rootAgentId: ROOT }).read()).questions.length, 1);
});

test('clarification and defer remain revision-bound and cannot be applied', async () => {
  for (const action of ['clarify', 'defer']) {
    const s = await fresh(); await s.putQuestion(question());
    const a = await s.answer(answer({ action, selected: [], note: 'Warum?' }));
    await assert.rejects(s.ack({ answerId: a.id, status: 'applied', actor: 'Test', note: 'Test', evidence: 'Test' }), e => e.status === 400);
    await assert.rejects(s.putQuestion({ ...question(), expectedRevision: 0 }), e => e.status === 409);
    await s.putQuestion({ ...question(), expectedRevision: 1 });
    await assert.rejects(s.answer(answer({ questionRevision: 1, requestId: 'stale' })), e => e.status === 409);
    assert.equal((await s.pending()).length, 0);
  }
});

test('an update cannot silently create a question missing from restored state', async () => {
  const s = await fresh();
  await assert.rejects(s.putQuestion({ ...question(), expectedRevision: 1 }), e => e.status === 409);
  assert.equal((await s.read()).questions.length, 0);
});

test('V2 migration preserves legacy values and reading never migrates the file', async () => {
  const s = await fresh(); await s.putQuestion(question()); const a = await s.answer(answer());
  await s.ack({ answerId: a.id, status: 'received', actor: 'Test', note: 'Legacy', deliveryReceipt: 'legacy text' });
  const legacy = await s.read(); legacy.extra = { untouched: true };
  const bytes = '\uFEFF' + JSON.stringify(legacy, null, 2) + '\r\n';
  await writeFile(s.file, bytes);
  assert.deepEqual(await s.read(), legacy);
  assert.equal(await readFile(s.file, 'utf8'), bytes);
  const migrated = storeModule.migrateState(legacy);
  assert.equal(migrated.schemaVersion, 2);
  for (const [key, value] of Object.entries(legacy)) if (key !== 'schemaVersion') assert.deepEqual(migrated[key], value);
  for (const key of ['ideas', 'receipts', 'progress', 'patches']) assert.deepEqual(migrated[key], []);
  migrated.answers[0].note = 'changed copy';
  assert.equal(legacy.answers[0].note, '');
  assert.equal(legacy.schemaVersion, 1);
  await s.migrate(legacy.revision);
  assert.equal(await readFile(`${s.file}.v1-backup`, 'utf8'), bytes);
  const v2bytes = await readFile(s.file, 'utf8');
  const v2 = await new DeskStore(s.file, { rootAgentId: ROOT }).read();
  assert.equal(v2.revision, legacy.revision + 1);
  assert.deepEqual(v2.answers, legacy.answers);
  await s.migrate(legacy.revision);
  assert.equal(await readFile(s.file, 'utf8'), v2bytes);
  await s.putQuestion(question('second'));
  assert.equal((await s.read()).schemaVersion, 2);
  assert.equal(await readFile(`${s.file}.v1-backup`, 'utf8'), bytes);
});

test('V2 reader rejects unknown versions and malformed additive arrays without writes', async () => {
  const s = await fresh();
  const v2 = { schemaVersion: 2, revision: 0, questions: [], answers: [], ideas: [], receipts: [], progress: [], patches: [] };
  await writeFile(s.file, JSON.stringify(v2));
  assert.deepEqual(await s.read(), v2);
  for (const bad of [{ ...v2, schemaVersion: 3 }, { ...v2, receipts: {} }, { ...v2, revision: -1 }, null]) {
    const bytes = JSON.stringify(bad); await writeFile(s.file, bytes);
    await assert.rejects(s.read(), e => e.status === 503);
    assert.equal(await readFile(s.file, 'utf8'), bytes);
  }
});

test('migration backup or replacement failure retains the committed V1 bytes', async () => {
  const s = await fresh(); await s.putQuestion(question());
  const before = await readFile(s.file, 'utf8'); const revision = (await s.read()).revision;
  const failingBackup = new DeskStore(s.file, { rootAgentId: ROOT, writeFile: async (path, ...args) => {
    if (path.endsWith('.v1-backup')) throw new Error('backup unavailable');
    return writeFile(path, ...args);
  } });
  await assert.rejects(failingBackup.migrate(revision), /backup unavailable/);
  assert.equal(await readFile(s.file, 'utf8'), before);
  const failingRename = new DeskStore(s.file, { rootAgentId: ROOT, rename: async (from, to) => {
    if (to === s.file) throw new Error('migration rename interrupted');
    return rename(from, to);
  } });
  await assert.rejects(failingRename.migrate(revision), /rename interrupted/);
  assert.equal(await readFile(s.file, 'utf8'), before);
  assert.equal(await readFile(`${s.file}.v1-backup`, 'utf8'), before);
  await s.migrate(revision);
  assert.equal((await s.read()).schemaVersion, 2);
});

test('migration refuses a mismatched permanent backup and stale revision', async () => {
  const s = await fresh(); await s.putQuestion(question());
  const before = await readFile(s.file, 'utf8'); const revision = (await s.read()).revision;
  await assert.rejects(s.migrate(revision - 1), e => e.status === 409);
  await writeFile(`${s.file}.v1-backup`, 'unrelated backup');
  await assert.rejects(s.migrate(revision), e => e.status === 503);
  assert.equal(await readFile(s.file, 'utf8'), before);
  assert.equal(await readFile(`${s.file}.v1-backup`, 'utf8'), 'unrelated backup');
});

test('migration does not overwrite colliding legacy fields or overflow the revision', async () => {
  const s = await fresh();
  const legacy = { schemaVersion: 1, revision: 0, questions: [], answers: [], ideas: null };
  await writeFile(s.file, JSON.stringify(legacy));
  await assert.rejects(s.migrate(0), e => e.status === 503);
  assert.deepEqual(await s.read(), legacy);
  const v2 = storeModule.migrateState({ ...legacy, ideas: [] });
  v2.revision = Number.MAX_SAFE_INTEGER;
  const bytes = JSON.stringify(v2); await writeFile(s.file, bytes);
  await assert.rejects(s.putQuestion(question()), e => e.status === 503);
  assert.equal(await readFile(s.file, 'utf8'), bytes);
});
