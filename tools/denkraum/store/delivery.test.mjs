import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DeliveryStore } from './delivery.mjs';
import { answerRef, DeskError, validateQuestion } from './model.mjs';

const ROOT = 'test-root-agent';
const DAY = 86400000;
const opt = id => ({ id, label: id, rationale: 'r', impact: 'i', tradeoff: 't', effort: 'e', reversible: 'ja' });
const question = () => ({ ...validateQuestion({ id: 'E-1', title: 'T', context: 'C', owner: 'O', category: 'K', scope: 'S', source: 'Q',
  uncertainty: 'U', recommendation: { optionIds: ['a'], rationale: 'R' }, options: [opt('a'), opt('b')] }), revision: 1 });
const verify = async request => ({ ...request, rootAgentId: ROOT, rootAcknowledgedAt: '2026-10-08T12:00:00.000Z', observedProof: 'synthetic proof' });
const store = (file, config) => new DeliveryStore(file, { rootAgentId: ROOT, verifyReceipt: verify, ...config });
const input = (extra = {}) => ({ questionId: 'E-1', questionRevision: 1, expectedAnswerId: null, requestId: 'req-1', action: 'answer', selected: ['a'], note: 'x', ...extra });
async function fresh({ v2 = true, ...config } = {}) {
  const file = join(await mkdtemp(join(tmpdir(), 'denkraum-delivery-')), 'ledger.json');
  const base = store(file); await base.change(state => { state.questions.push(question()); });
  if (v2) await base.migrate((await base.read()).revision);
  const s = store(file, config); return { s, file, a: await s.answer(input()) };
}
const receiptInput = a => ({ receiptId: 'rcpt-1', eventRef: answerRef(a), transportMessageId: 'mail-1', rootReplyId: 'reply-1' });
const status = code => e => e instanceof DeskError && e.status === code;

test('pending and inbox keep an answer open until Root acknowledges it (V2 receipt, V1 legacy ack)', async () => {
  const { s, a } = await fresh();
  assert.deepEqual((await s.pending()).map(x => x.id), [a.id]);
  let box = await s.inbox();
  assert.deepEqual(box.pending.map(e => e.eventRef), [answerRef(a)]); assert.equal(box.pending[0].progress.currentStatus, 'incoming');
  const r = await s.receipt(receiptInput(a));
  assert.deepEqual(await s.pending(), []); box = await s.inbox();
  assert.equal(box.pending.length, 0); assert.deepEqual(box.received[0].receipt, r);
  const v1 = await fresh({ v2: false });
  assert.equal((await v1.s.pending()).length, 1);
  await v1.s.ack({ answerId: v1.a.id, status: 'received', actor: 'Root', note: 'Beleg', deliveryReceipt: 'weitergegeben' });
  assert.deepEqual(await v1.s.pending(), []); box = await v1.s.inbox();
  assert.equal(box.received[0].legacyAck.status, 'received'); assert.equal(box.received[0].receipt, null);
});

test('flushing without a transport or on a V1 ledger writes nothing and never calls out', async () => {
  const { s, file } = await fresh(); const bytes = await readFile(file, 'utf8');
  assert.equal((await s.flushNotifications()).status, 'not-configured');
  assert.equal(await readFile(file, 'utf8'), bytes);
  const v1 = await fresh({ v2: false }); const v1bytes = await readFile(v1.file, 'utf8'); const calls = [];
  assert.equal((await store(v1.file, { notifyEvent: async event => calls.push(event) }).flushNotifications()).status, 'empty');
  assert.deepEqual(calls, []); assert.equal(await readFile(v1.file, 'utf8'), v1bytes);
});

test('a failed delivery stays pending with a fixed error code and the retry reuses the event id as delivery id', async () => {
  const detail = 'test-only-transport-detail';
  const { s, a, file } = await fresh({ notifyEvent: async () => { throw new Error(detail); } });
  const failed = await s.flushNotifications();
  assert.equal(failed.status, 'pending'); assert.equal(failed.lastError, 'transport-failed'); assert.equal(failed.attempts, 1);
  assert.ok(!(await readFile(file, 'utf8')).includes(detail));
  const calls = []; const restarted = store(file, { notifyEvent: async (event, id) => calls.push({ event, id }) });
  const queued = await restarted.flushNotifications();
  assert.equal(queued.status, 'queued'); assert.equal(queued.attempts, 2); assert.equal(queued.lastError, null);
  assert.deepEqual(calls, [{ event: { type: 'decision-desk.event', eventId: a.id, contentRevision: 1, deliveryId: a.id }, id: a.id }]);
  assert.equal((await restarted.flushNotifications()).status, 'empty', 'a queued event is not sent again');
  assert.equal(calls.length, 1); assert.equal((await restarted.read()).receipts.length, 0);
  assert.equal((await restarted.pending()).length, 1, 'queued is not a Root receipt');
});

test('an interrupted queue commit retries the same delivery id and concurrent flushes do not duplicate it', async () => {
  const { file, a } = await fresh(); let commits = 0; const ids = [];
  const interrupted = store(file, { notifyEvent: async (event, id) => ids.push(id), rename: async (from, to) => {
    if (to === file && ++commits === 2) throw new Error('metadata interrupted'); return rename(from, to);
  } });
  await assert.rejects(interrupted.flushNotifications(), /metadata interrupted/);
  assert.equal((await store(file).read()).answers[0].webhookDelivery.status, 'pending');
  const restarted = store(file, { notifyEvent: async (event, id) => ids.push(id) });
  await Promise.all([restarted.flushNotifications(), restarted.flushNotifications()]);
  assert.deepEqual(ids, [a.id, a.id]);
});

test('a receipt or a newer answer arriving during delivery wins over the queue update', async () => {
  for (const race of ['receipt', 'supersession']) {
    const { s, a, file } = await fresh(); let before;
    s.io.notifyEvent = async () => {
      if (race === 'receipt') await s.receipt(receiptInput(a));
      else await s.answer(input({ requestId: 'race', expectedAnswerId: a.id, action: 'defer', selected: [] }));
      before = await readFile(file, 'utf8');
    };
    assert.equal((await s.flushNotifications()).status, race === 'receipt' ? 'received' : 'superseded');
    assert.equal(await readFile(file, 'utf8'), before);
  }
});

test('a queued delivery older than seven days gets a new delivery id for the same event and stops after the Root receipt', async () => {
  let clock = Date.parse('2026-10-08T12:00:00.000Z'); const calls = [];
  const { s, a } = await fresh({ clock: () => clock,
    notifyEvent: async (event, id) => { calls.push({ event, id }); if (calls.length === 2) throw new Error('offline'); } });
  await s.flushNotifications(); clock += 7 * DAY - 1;
  assert.equal((await s.flushNotifications()).status, 'empty'); clock++;
  assert.equal((await s.flushNotifications()).status, 'pending');
  assert.equal(calls[1].event.eventId, a.id); assert.notEqual(calls[1].id, a.id);
  await s.flushNotifications(); assert.equal(calls[2].id, calls[1].id, 'a failed renewal keeps its new id');
  assert.equal((await s.read()).answers[0].webhookDelivery.attempts, 3);
  await s.receipt(receiptInput(a)); clock += 31 * DAY;
  assert.equal((await s.flushNotifications()).status, 'empty'); assert.equal(calls.length, 3);
});

test('V2 pending inbox and delivery fail closed without a configured root agent id', async () => {
  const { file } = await fresh(); const bytes = await readFile(file, 'utf8'); const calls = [];
  const rootless = new DeliveryStore(file, { notifyEvent: async event => calls.push(event) });
  for (const call of [() => rootless.pending(), () => rootless.inbox(), () => rootless.flushNotifications()]) await assert.rejects(call(), status(503));
  assert.deepEqual(calls, []); assert.equal(await readFile(file, 'utf8'), bytes);
  const v1 = await fresh({ v2: false });
  assert.equal((await new DeliveryStore(v1.file).pending()).length, 1, 'V1 has no receipts; the DR-02 model binds D2 to V2 only');
});

test('V2 reads and delivery refuse a missing root agent id even when no event needs a receipt check (R669-O1)', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'denkraum-delivery-')), 'ledger.json'); const base = store(file);
  await base.change(state => { state.questions.push(question()); }); await base.migrate((await base.read()).revision);
  const calls = []; const bytes = await readFile(file, 'utf8');
  const rootless = new DeliveryStore(file, { notifyEvent: async event => calls.push(event) });
  for (const call of [() => rootless.pending(), () => rootless.inbox(), () => rootless.flushNotifications(), () => rootless.flushNotifications('other-event')])
    await assert.rejects(call(), status(503));
  assert.deepEqual(calls, []); assert.equal(await readFile(file, 'utf8'), bytes);
  assert.equal((await new DeliveryStore(file).flushNotifications()).status, 'not-configured', 'P1: no transport is reported before any ledger read');
});

test('rootless V2 without transport refuses notification flush with 503', async () => {
  const { file } = await fresh(); const bytes = await readFile(file, 'utf8');
  await assert.rejects(() => new DeliveryStore(file).flushNotifications(), status(503));
  assert.equal(await readFile(file, 'utf8'), bytes);
});
