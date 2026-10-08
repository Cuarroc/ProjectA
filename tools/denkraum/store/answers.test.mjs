import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AnswerStore } from './answers.mjs';
import { answerRef, DeskError, validateQuestion } from './model.mjs';

const ROOT = 'test-root-agent';
const opt = id => ({ id, label: id, rationale: 'r', impact: 'i', tradeoff: 't', effort: 'e', reversible: 'ja' });
const question = () => ({ ...validateQuestion({ id: 'E-1', title: 'T', context: 'C', owner: 'O', category: 'K', scope: 'S', source: 'Q',
  uncertainty: 'U', recommendation: { optionIds: ['a'], rationale: 'R' }, options: [opt('a'), opt('b')] }), revision: 1 });
const verify = root => async request => ({ ...request, rootAgentId: root, rootAcknowledgedAt: '2026-10-08T12:00:00.000Z', observedProof: 'synthetic proof' });
async function fresh({ v2 = true, ...config } = {}) {
  const s = new AnswerStore(join(await mkdtemp(join(tmpdir(), 'denkraum-answers-')), 'ledger.json'), { rootAgentId: ROOT, verifyReceipt: verify(ROOT), ...config });
  await s.change(state => { state.questions.push(question()); });
  if (v2) await s.migrate((await s.read()).revision);
  return s;
}
const input = (extra = {}) => ({ questionId: 'E-1', questionRevision: 1, expectedAnswerId: null, requestId: 'req-1', action: 'answer', selected: ['a'], note: '', ...extra });
const receiptInput = a => ({ receiptId: 'rcpt-1', eventRef: answerRef(a), transportMessageId: 'mail-1', rootReplyId: 'reply-1' });
const status = code => e => e instanceof DeskError && e.status === code;

test('an answer is saved once per request id and conflicting or stale requests change nothing', async () => {
  const s = await fresh(); const a = await s.answer(input()); const bytes = await readFile(s.file, 'utf8');
  assert.deepEqual(await s.answer(input()), a, 'identical replay returns the saved answer');
  await assert.rejects(s.answer(input({ selected: ['b'] })), status(409));
  await assert.rejects(s.answer(input({ requestId: 'req-2', questionRevision: 2 })), status(409));
  await assert.rejects(s.answer(input({ requestId: 'req-2' })), status(409), 'expectedAnswerId must name the latest answer');
  assert.equal(await readFile(s.file, 'utf8'), bytes);
  const b = await s.answer(input({ requestId: 'req-2', expectedAnswerId: a.id, selected: ['b'] }));
  assert.equal((await s.read()).answers.at(-1).id, b.id);
});

test('answers reject invalid selections and keep defer or clarify free of approval', async () => {
  const s = await fresh();
  for (const bad of [{ selected: ['x'] }, { selected: ['a', 'b'] }, { selected: [] }, { action: 'defer' }, { action: 'clarify', selected: [], note: ' ' },
    { action: 'approve' }, { note: 'x'.repeat(8001) }]) await assert.rejects(s.answer(input(bad)), status(400), JSON.stringify(bad));
  await assert.rejects(s.answer(input({ questionId: 'missing' })), status(404));
  const d = await s.answer(input({ action: 'defer', selected: [] }));
  await assert.rejects(s.ack({ answerId: d.id, status: 'applied' }), status(409));
});

test('V2 answers start incoming progress and a pending outbox entry; V1 answers do not', async () => {
  const v2 = await (await fresh()).answer(input());
  assert.deepEqual(v2.webhookDelivery, { status: 'pending', attempts: 0, lastAttemptAt: null, queuedAt: null, lastError: null });
  const s1 = await fresh({ v2: false }); const v1 = await s1.answer(input());
  assert.equal(Object.hasOwn(v1, 'webhookDelivery'), false); assert.equal((await s1.read()).progress, undefined);
});

test('a receipt binds the exact current event to the configured root and replays without writing', async () => {
  const s = await fresh(); const a = await s.answer(input());
  const r = await s.receipt(receiptInput(a));
  assert.equal(r.rootAgentId, ROOT); assert.deepEqual(r.eventRef, answerRef(a));
  const bytes = await readFile(s.file, 'utf8');
  assert.deepEqual(await s.receipt(receiptInput(a)), r);
  await assert.rejects(s.receipt({ ...receiptInput(a), rootReplyId: 'reply-2' }), status(409), 'receipt id reused with other content');
  await assert.rejects(s.receipt({ ...receiptInput(a), receiptId: 'rcpt-2' }), status(409), 'event already acknowledged');
  assert.equal(await readFile(s.file, 'utf8'), bytes);
});

test('receipts fail closed without V2, verifier, matching proof or configured root and write nothing', async () => {
  const v1 = await fresh({ v2: false }); const a1 = await v1.answer(input());
  await assert.rejects(v1.receipt(receiptInput(a1)), status(409));
  const s = await fresh(); const a = await s.answer(input()); const bytes = await readFile(s.file, 'utf8');
  const cases = [[{ verifyReceipt: undefined }, 503], [{ verifyReceipt: verify('other-root') }, 403], [{ rootAgentId: undefined }, 503],
    [{ verifyReceipt: async request => ({ ...(await verify(ROOT)(request)), rootAcknowledgedAt: 'yesterday' }) }, 400]];
  for (const [config, code] of cases) {
    await assert.rejects(new AnswerStore(s.file, { rootAgentId: ROOT, verifyReceipt: verify(ROOT), ...config }).receipt(receiptInput(a)), status(code));
  }
  await assert.rejects(s.receipt({ ...receiptInput(a), eventRef: { ...answerRef(a), questionRevision: 2 } }), status(409));
  assert.equal(await readFile(s.file, 'utf8'), bytes);
});

test('V1 acknowledgements go received before applied and never downgrade', async () => {
  const s = await fresh({ v2: false }); const a = await s.answer(input());
  const proof = { actor: 'Root', note: 'Beleg' };
  await assert.rejects(s.ack({ answerId: a.id, status: 'applied', ...proof, evidence: 'e' }), status(400));
  await s.ack({ answerId: a.id, status: 'received', ...proof, deliveryReceipt: 'weitergegeben' });
  const done = await s.ack({ answerId: a.id, status: 'applied', ...proof, evidence: 'umgesetzt' });
  assert.deepEqual(done.acknowledgements.map(x => x.status), ['received', 'applied']);
  await assert.rejects(s.ack({ answerId: a.id, status: 'received', ...proof, deliveryReceipt: 'x' }), status(409));
});

test('V2 acknowledgement records a bound receipt and refuses implementation without a progress module', async () => {
  const s = await fresh(); const a = await s.answer(input());
  await assert.rejects(s.ack({ answerId: a.id, status: 'received', receipt: { ...receiptInput(a), eventRef: { ...answerRef(a), eventId: 'other' } } }), status(409));
  const acked = await s.ack({ answerId: a.id, status: 'received', receipt: receiptInput(a) });
  assert.equal(acked.receipt.rootAgentId, ROOT);
  await assert.rejects(s.ack({ answerId: a.id, status: 'applied' }), status(409));
  await assert.rejects(s.ack({ answerId: a.id, status: 'applied', progress: { eventRef: answerRef(a), to: 'applied' } }), status(503));
});
