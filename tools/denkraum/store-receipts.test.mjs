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
async function legacyStore() {
  const s = await fresh();
  await writeFile(s.file, JSON.stringify({ schemaVersion: 1, revision: 0, questions: [], answers: [] }));
  return s;
}
const answer = (extra = {}) => ({ questionId: 'E-test', questionRevision: 1, expectedAnswerId: null,
  requestId: 'request-1', action: 'answer', selected: ['a'], note: '', ...extra });

const ROOT = 'test-root-agent';
const rootAgentId = ROOT;
const receiptInput = a => ({ receiptId: 'receipt-1', eventRef: { kind: 'answer', eventId: a.id,
  questionId: a.questionId, questionRevision: a.questionRevision }, transportMessageId: 'mail-parent', rootReplyId: 'mail-reply' });
const verifiedReceipt = async input => ({ ...input, rootAgentId,
  rootAcknowledgedAt: '2026-10-06T17:00:00.000Z', observedProof: 'Root reply body binds the exact event and revision.' });
async function receiptFixture(extra = {}) {
  const legacy = await legacyStore(); await legacy.putQuestion(question()); const a = await legacy.answer(answer(extra));
  await legacy.migrate((await legacy.read()).revision);
  return { s: new DeskStore(legacy.file, { rootAgentId: ROOT, verifyReceipt: verifiedReceipt }), a, input: receiptInput(a) };
}

test('RCPT-1 legacy received and applied preserve inbox semantics across migration and restart without fabricated receipt or execution queue', async () => {
  for (const status of ['received', 'applied']) {
    const s = await legacyStore(); await s.putQuestion(question()); const a = await s.answer(answer());
    await s.ack({ answerId: a.id, status: 'received', actor: 'Root', note: 'Legacy receipt', deliveryReceipt: 'old text' });
    if (status === 'applied') await s.ack({ answerId: a.id, status, actor: 'Root', note: 'Legacy done', evidence: 'old observed artifact' });
    const legacy = await s.read(); const v1Inbox = await new DeskStore(s.file, { rootAgentId: ROOT }).inbox();
    assert.equal(v1Inbox.pending.length, 0); assert.equal(v1Inbox.received.length, status === 'received' ? 1 : 0);
    if (status === 'received') { assert.equal(v1Inbox.received[0].receipt, null); assert.equal(v1Inbox.received[0].legacyAck.status, status); }
    await s.migrate(legacy.revision); let sent = 0;
    const restarted = new DeskStore(s.file, { rootAgentId: ROOT, notifyEvent: async () => { sent++; }, verifyReceipt: verifiedReceipt });
    const state = await restarted.read(); assert.deepEqual(state.answers, legacy.answers); assert.deepEqual(state.receipts, []);
    assert.equal((await restarted.pending()).length, status === 'received' ? 1 : 0);
    const inbox = await restarted.inbox(); assert.equal(inbox.pending.length, status === 'received' ? 1 : 0); assert.equal(inbox.received.length, 0);
    if (status === 'applied') {
      const before = await readFile(s.file, 'utf8'); await restarted.flushNotifications();
      await assert.rejects(restarted.receipt(receiptInput(a)), e => e.status === 409);
      assert.equal(sent, 0); assert.equal(await readFile(s.file, 'utf8'), before);
    }
  }
});

test('RCPT-2 malformed receipt and progress entries fail shared reads and mutations with 503 and unchanged bytes', async () => {
  const s = await fresh(); await s.putQuestion(question()); await s.migrate((await s.read()).revision);
  const good = await s.read();
  for (const bad of [{ receipts: [null] }, { receipts: [false] }, { receipts: [{}] }, { receipts: [{ eventRef: null }] },
    { progress: [null] }, { progress: [{}] }, { progress: [{ eventId: 'x', currentStatus: 'reviewed', progressRevision: 1, history: [null] }] },
    { progress: [{ eventId: 'x', currentStatus: 'unknown', progressRevision: 1, history: [] }] }]) {
    const bytes = JSON.stringify({ ...good, ...bad }); await writeFile(s.file, bytes); let sent = false;
    const corrupted = new DeskStore(s.file, { rootAgentId: ROOT, notifyEvent: async () => { sent = true; } });
    for (const operation of [() => corrupted.read(), () => corrupted.pending(), () => corrupted.inbox(),
      () => corrupted.putQuestion(question('never')), () => corrupted.flushNotifications()])
      await assert.rejects(operation(), e => e instanceof storeModule.DeskError && e.status === 503);
    assert.equal(await readFile(s.file, 'utf8'), bytes); assert.equal(sent, false);
  }
});

test('explicit migration rejects a disappearing V1 source and works after restoring that source', async () => {
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
  s.read = read;
  await rename(`${s.file}.removed-source`, s.file);
  await s.putQuestion(question()); assert.equal((await s.read()).schemaVersion, 1);
  await s.migrate((await s.read()).revision); assert.equal((await s.read()).schemaVersion, 2);
});

test('exact receipts reject missing provenance, wrong identities and mismatched revisions without writes', async () => {
  const { s, a, input } = await receiptFixture(); const before = await readFile(s.file, 'utf8');
  await assert.rejects(new DeskStore(s.file, { rootAgentId: ROOT }).receipt(input), e => e.status === 503);
  for (const proof of [{ ...(await verifiedReceipt(input)), rootAgentId: 'pretend-root' },
    { ...(await verifiedReceipt(input)), eventRef: { ...input.eventRef, eventId: 'other' } },
    { ...(await verifiedReceipt(input)), rootAcknowledgedAt: 'not a date' },
    { ...(await verifiedReceipt(input)), observedProof: '' }]) {
    await assert.rejects(new DeskStore(s.file, { rootAgentId: ROOT, verifyReceipt: async () => proof }).receipt(input));
  }
  await assert.rejects(s.receipt({ ...input, eventRef: { ...input.eventRef, questionRevision: 2 } }), e => e.status === 409);
  await assert.rejects(s.receipt({ ...input, eventRef: { ...input.eventRef, questionId: 'other' } }), e => e.status === 409);
  await assert.rejects(s.receipt({ ...input, eventRef: { ...input.eventRef, eventId: 'missing' } }), e => e.status === 404);
  await assert.rejects(s.ack({ answerId: a.id, status: 'received', actor: 'Root', note: 'Read', deliveryReceipt: 'Root said so' }));
  await assert.rejects(s.ack({ answerId: a.id, status: 'applied', actor: 'Root', note: 'Done', evidence: 'claim' }), e => e.status === 409);
  for (const bad of [{ ...input, receiptId: '' }, { ...input, rootReplyId: undefined },
    { ...input, eventRef: { ...input.eventRef, kind: 'idea' } },
    { ...input, eventRef: { ...input.eventRef, questionRevision: 1.5 } }]) await assert.rejects(s.receipt(bad), e => e.status === 400);
  assert.equal(await readFile(s.file, 'utf8'), before);
});

test('exact receipt concurrent replay is byte-identical and payload or event uniqueness conflicts', async () => {
  const { s, input } = await receiptFixture();
  const [first, duplicate] = await Promise.all([s.receipt(input), s.receipt(input)]);
  assert.deepEqual(first, duplicate); const before = await readFile(s.file, 'utf8');
  assert.deepEqual(await new DeskStore(s.file, { rootAgentId: ROOT }).receipt(input), first);
  await assert.rejects(s.receipt({ ...input, rootReplyId: 'different' }), e => e.status === 409);
  await assert.rejects(s.receipt({ ...input, receiptId: 'receipt-2' }), e => e.status === 409);
  assert.equal(await readFile(s.file, 'utf8'), before);
  const state = await s.read(); assert.equal(state.receipts.length, 1);
  assert.equal(state.answers[0].ack, null); assert.deepEqual(state.answers[0].acknowledgements, []);
});

test('exact receipt recovery retains received unprocessed events and legacy text stays pending', async () => {
  const legacy = await legacyStore(); await legacy.putQuestion(question()); const a = await legacy.answer(answer());
  await legacy.ack({ answerId: a.id, status: 'received', actor: 'Root', note: 'Legacy', deliveryReceipt: 'unverified text' });
  await legacy.migrate((await legacy.read()).revision); const s = new DeskStore(legacy.file, { rootAgentId: ROOT, verifyReceipt: verifiedReceipt });
  assert.equal((await s.pending()).length, 1); assert.equal((await s.inbox()).pending.length, 1);
  const receipt = await s.receipt(receiptInput(a)); const inbox = await new DeskStore(s.file, { rootAgentId: ROOT }).inbox();
  assert.equal(inbox.pending.length, 0); assert.equal(inbox.received.length, 1);
  assert.equal(inbox.received[0].eventRef.eventId, a.id); assert.deepEqual(inbox.received[0].receipt, receipt);
  assert.equal(inbox.received[0].progress, null); assert.equal((await s.pending()).length, 0);
  assert.equal((await s.read()).answers[0].ack.deliveryReceipt, 'unverified text');
});

test('exact receipt stale replay has no effect but new receipts and old ack cannot target superseded answers', async () => {
  const { s, a, input } = await receiptFixture(); const first = await s.receipt(input);
  await s.answer(answer({ requestId: 'new-answer', expectedAnswerId: a.id, selected: ['b'] }));
  const before = await readFile(s.file, 'utf8'); assert.deepEqual(await s.receipt(input), first);
  await assert.rejects(s.receipt({ ...input, receiptId: 'new-receipt' }), e => e.status === 409);
  await assert.rejects(s.ack({ answerId: a.id, status: 'received', receipt: input }), e => e.status === 409);
  assert.equal(await readFile(s.file, 'utf8'), before); assert.equal((await s.inbox()).received.length, 0);
  const active = (await s.read()).answers.at(-1); await s.putQuestion({ ...question(), expectedRevision: 1 });
  await assert.rejects(s.receipt(receiptInput(active)), e => e.status === 409);
});

test('exact receipt shared ack route cannot bypass event binding or imply implementation', async () => {
  const { s, a, input } = await receiptFixture({ action: 'defer', selected: [] });
  await assert.rejects(s.ack({ answerId: 'missing', status: 'received', receipt: input }), e => e.status === 404);
  await s.ack({ answerId: a.id, status: 'received', receipt: input });
  const before = await readFile(s.file, 'utf8');
  await s.ack({ answerId: a.id, status: 'received', receipt: input });
  await assert.rejects(s.ack({ answerId: a.id, status: 'applied', evidence: 'claim', actor: 'Root', note: 'Done' }));
  assert.equal(await readFile(s.file, 'utf8'), before); assert.equal((await s.read()).receipts.length, 1);
});

test('exact receipt interrupted commit is recoverable with the same key and no uncommitted receipt', async () => {
  const { s, input } = await receiptFixture(); const before = await readFile(s.file, 'utf8');
  const failing = new DeskStore(s.file, { rootAgentId: ROOT, verifyReceipt: verifiedReceipt, rename: async (from, to) => {
    if (to === s.file) throw new Error('receipt interrupted'); return rename(from, to);
  } });
  await assert.rejects(failing.receipt(input), /receipt interrupted/);
  assert.equal(await readFile(s.file, 'utf8'), before); assert.equal((await s.inbox()).pending.length, 1);
  await s.receipt(input); assert.equal((await new DeskStore(s.file, { rootAgentId: ROOT }).inbox()).received.length, 1);
});

test('exact receipt verifier failure recovers the queue and other-answer ack cannot bind a valid proof', async () => {
  const { s, input } = await receiptFixture(); const before = await readFile(s.file, 'utf8'); let unavailable = true;
  const guarded = new DeskStore(s.file, { rootAgentId: ROOT, verifyReceipt: async request => {
    if (unavailable) throw new Error('mailbox offline'); return verifiedReceipt(request);
  } });
  await assert.rejects(guarded.receipt(input), /mailbox offline/);
  assert.equal(await readFile(s.file, 'utf8'), before);
  unavailable = false; await guarded.receipt(input);
  await s.putQuestion(question('other-question'));
  const other = await s.answer(answer({ questionId: 'other-question', requestId: 'other-request' }));
  await assert.rejects(s.ack({ answerId: other.id, status: 'received', receipt: input }), e => e.status === 409);
  assert.equal((await s.read()).receipts.length, 1);
  assert.equal((await s.inbox()).pending.length, 1); assert.equal((await s.inbox()).received.length, 1);
});
