import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LedgerStore } from './ledger.mjs';
import { DeskError } from './model.mjs';
import * as surface from '../store.mjs';

const ROOT = 'test-root-agent';
const status = code => e => e instanceof DeskError && e.status === code;
const opt = id => ({ id, label: id, rationale: 'r', impact: 'i', tradeoff: 't', effort: 'e', reversible: 'ja' });
const question = (extra = {}) => ({ id: 'E-1', title: 'T', context: 'C', owner: 'O', category: 'K', scope: 'S', source: 'Q', uncertainty: 'U',
  recommendation: { optionIds: ['a'], rationale: 'R' }, options: [opt('a'), opt('b')], ...extra });
const idea = (extra = {}) => ({ requestId: 'idea-1', expectedRevision: null, title: 'Idee', text: 'Beschreibung', ...extra });
async function fresh({ v2 = true, ...config } = {}) {
  const s = new LedgerStore(join(await mkdtemp(join(tmpdir(), 'denkraum-ledger-')), 'ledger.json'), { rootAgentId: ROOT, ...config });
  if (v2) { await s.putQuestion(question({ id: 'seed' })); await s.migrate((await s.read()).revision); }
  return s;
}

test('an idea revision starts incoming progress and a pending outbox entry and keeps its metadata', async () => {
  const calls = []; const s = await fresh({ notifyEvent: async (event, id) => calls.push({ event, id }) });
  const first = await s.putIdea(idea({ category: '  Werkzeug ', userPriority: 'high' }));
  assert.equal(first.revision, 1); assert.equal(first.category, 'Werkzeug'); assert.equal(first.userPriority, 'high');
  assert.deepEqual(first.webhookDelivery, { status: 'pending', attempts: 0, lastAttemptAt: null, queuedAt: null, lastError: null });
  const state = await s.read();
  assert.deepEqual(state.progress.map(p => [p.eventId, p.currentStatus]), [[first.eventId, 'incoming']]);
  assert.equal((await s.inbox()).pending[0].eventRef.ideaId, first.id);
  assert.equal((await s.flushNotifications()).status, 'queued');
  assert.deepEqual(calls[0].event, { type: 'decision-desk.event', eventId: first.eventId, contentRevision: 1, deliveryId: first.eventId });
  const second = await s.putIdea(idea({ requestId: 'idea-2', id: first.id, expectedRevision: 1, title: 'Idee 2' }));
  assert.equal(second.revision, 2); assert.equal(second.category, 'Werkzeug', 'unchanged metadata carries over');
  assert.equal(second.userPriority, 'high');
  const third = await s.putIdea(idea({ requestId: 'idea-3', id: first.id, expectedRevision: 2, category: '', userPriority: 'later' }));
  assert.equal(third.category, ''); assert.equal(third.userPriority, 'later');
});

test('ideas replay by request id and refuse conflicting reuse, stale or unknown revisions, bad metadata and V1 ledgers', async () => {
  const s = await fresh(); const first = await s.putIdea(idea()); const bytes = await readFile(s.file, 'utf8');
  assert.deepEqual(await s.putIdea(idea()), first);
  await assert.rejects(s.putIdea(idea({ title: 'Anders' })), status(409));
  await assert.rejects(s.putIdea(idea({ requestId: 'idea-2', id: first.id, expectedRevision: 2 })), status(409));
  await assert.rejects(s.putIdea(idea({ requestId: 'idea-2', id: 'missing', expectedRevision: 1 })), status(404));
  for (const bad of [{ category: 'x'.repeat(81) }, { category: 7 }, { userPriority: 'sofort' }, { expectedRevision: 1 }, { title: ' ' }])
    await assert.rejects(s.putIdea(idea({ requestId: 'idea-bad', ...bad })), status(400), JSON.stringify(bad));
  assert.equal(await readFile(s.file, 'utf8'), bytes);
  assert.equal((await s.putIdea(idea({ requestId: 'idea-80', category: 'x'.repeat(80) }))).category.length, 80);
  await assert.rejects((await fresh({ v2: false })).putIdea(idea()), status(409));
});

test('questions are created and revised only against the current revision; imports replay by request id', async () => {
  const s = await fresh({ v2: false });
  const created = await s.putQuestion(question());
  assert.equal(created.revision, 1); assert.equal(created.createdAt, created.updatedAt);
  await assert.rejects(s.putQuestion(question({ id: 'E-2', expectedRevision: 1 })), status(409), 'no question for this revision');
  await assert.rejects(s.putQuestion(question({ title: 'T2' })), status(409), 'revision required for an update');
  await assert.rejects(s.putQuestion(question({ title: 'T2', expectedRevision: 2 })), status(409));
  const revised = await s.putQuestion(question({ title: 'T2', expectedRevision: 1 }));
  assert.equal(revised.revision, 2); assert.equal(revised.createdAt, created.createdAt);
  const imported = await s.putQuestion(question({ id: 'E-3', requestId: 'import-1' })); const bytes = await readFile(s.file, 'utf8');
  assert.deepEqual(await s.putQuestion(question({ id: 'E-3', requestId: 'import-1' })), imported);
  await assert.rejects(s.putQuestion(question({ id: 'E-3', requestId: 'import-1', title: 'Anders' })), status(409));
  assert.equal(await readFile(s.file, 'utf8'), bytes);
  await assert.rejects(s.putQuestion(question({ options: [opt('a')] })), status(400));
});

test('a question bound to an idea needs the current idea revision', async () => {
  const s = await fresh(); const i = await s.putIdea(idea());
  const sourceRef = { kind: 'idea', eventId: i.eventId, ideaId: i.id, ideaRevision: 1 };
  assert.deepEqual((await s.putQuestion(question({ sourceRef }))).sourceRef, sourceRef);
  await assert.rejects(s.putQuestion(question({ id: 'E-2', sourceRef: { ...sourceRef, ideaId: 'missing' } })), status(404));
  await s.putIdea(idea({ requestId: 'idea-2', id: i.id, expectedRevision: 1, text: 'Neu' }));
  await assert.rejects(s.putQuestion(question({ id: 'E-2', sourceRef })), status(409), 'outdated idea revision');
});

test('store.mjs exposes the P1 surface with every operation on one store', async () => {
  assert.deepEqual(Object.keys(surface).sort(), ['DeskError', 'DeskStore', 'compareQuestions', 'latestAnswer', 'migrateState', 'projectQuestionPriority']);
  assert.equal(surface.DeskStore, LedgerStore);
  for (const op of ['read', 'change', 'migrate', 'answer', 'receipt', 'ack', 'pending', 'inbox', 'flushNotifications', 'putProgress', 'putPatch', 'putIdea', 'putQuestion'])
    assert.equal(typeof LedgerStore.prototype[op], 'function', op);
});
