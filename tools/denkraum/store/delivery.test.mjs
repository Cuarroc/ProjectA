import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import { getOwnershipContext, ownerRecordPath, OWNERSHIP_HELD, STORE_CLOSED } from './ownership.mjs';
import { mkdtemp, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DeliveryStore, MAX_DELIVERY_ATTEMPTS } from './delivery.mjs';
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
  if (!v2) await writeFile(file, JSON.stringify({ schemaVersion: 1, revision: 0, questions: [], answers: [] }));
  const base = store(file); await base.change(state => { state.questions.push(question()); });
  if (v2) await base.migrate((await base.read()).revision);
  await base.close();
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
  await assert.rejects(() => new DeliveryStore(file).flushNotifications(), status(503), 'rootless V2 refuses before not-configured');
});

test('rootless V2 without transport refuses notification flush with 503', async () => {
  const { file } = await fresh(); const bytes = await readFile(file, 'utf8');
  await assert.rejects(() => new DeliveryStore(file).flushNotifications(), status(503));
  assert.equal(await readFile(file, 'utf8'), bytes);
});

// A send barrier holds A inside the transport; B's synchronous read and a core
// queue checkpoint expose a competing selection without timing-based sleeps.
async function competingFlush(t, loseResponse = false) {
  const entered = Promise.withResolvers(), gate = Promise.withResolvers(), calls = [];
  const { s: a, file, a: answer } = await fresh({ notifyEvent: async (event, id) => {
    calls.push({ eventId: event.eventId, id }); entered.resolve(); await gate.promise;
    if (loseResponse) throw new Error('response lost');
  } });
  const b = store(file, { notifyEvent: async (event, id) => calls.push({ eventId: event.eventId, id }) });
  b.read = async () => JSON.parse(readFileSync(file, 'utf8'));
  const first = a.flushNotifications(); await entered.promise;
  const second = b.flushNotifications();
  t.after(async () => { gate.resolve(); await Promise.allSettled([first, second]); await a.close(); await b.close(); });
  await setImmediate(); await b.change(() => {});
  return { a, b, answer, file, calls, first, second, release: gate.resolve };
}

test('DRSEC: two local stores serialize flush while a send is unresolved', async t => {
  const f = await competingFlush(t);
  assert.deepEqual(f.calls, [{ eventId: f.answer.id, id: f.answer.id }]);
  f.release();
  assert.equal((await f.first).status, 'queued'); assert.equal((await f.second).status, 'empty');
  assert.equal(f.calls.length, 1);
  assert.equal((await f.a.read()).answers[0].webhookDelivery.attempts, 1);
});

test('DRSEC: an ordinary receipt commits during an unresolved exclusive send', async t => {
  const f = await competingFlush(t);
  const receipt = await f.b.receipt(receiptInput(f.answer));
  const before = await readFile(f.file, 'utf8');
  assert.equal(JSON.parse(before).receipts[0].receiptId, receipt.receiptId);
  assert.equal(f.calls.length, 1, 'B must not send before the receipt commits');
  f.release();
  assert.equal((await f.first).status, 'received'); assert.equal((await f.second).status, 'empty');
  assert.equal(await readFile(f.file, 'utf8'), before);
});

test('DRSEC: serialized retry after a lost response reuses the same event ID', async t => {
  const f = await competingFlush(t, true);
  assert.equal(f.calls.length, 1, 'retry must wait for the unresolved first response');
  f.release();
  assert.equal((await f.first).status, 'pending'); assert.equal((await f.second).status, 'queued');
  assert.deepEqual(f.calls, Array(2).fill({ eventId: f.answer.id, id: f.answer.id }));
  assert.equal((await f.a.read()).answers[0].webhookDelivery.attempts, 2);
});

test('DRSEC: a second process cannot send while the closing owner has an unresolved send', async t => {
  const entered = Promise.withResolvers(), gate = Promise.withResolvers();
  const { s, file, a } = await fresh({ notifyEvent: async () => { entered.resolve(); await gate.promise; } });
  const sending = s.flushNotifications(); await entered.promise;
  const closing = s.close();
  t.after(async () => { gate.resolve(); await Promise.allSettled([sending, closing]); });
  // Drain core work already accepted by close; do not wait for the held send.
  await getOwnershipContext(file).queue;
  const script = `import { DeliveryStore } from ${JSON.stringify(new URL('./delivery.mjs', import.meta.url).href)};
    let sends = 0, code = null;
    const s = new DeliveryStore(process.argv[1], { rootAgentId: 'test-root-agent', notifyEvent: async () => { sends++; } });
    try { await s.flushNotifications(); } catch (e) { code = e.code; }
    await s.close(); process.stdout.write(JSON.stringify({ sends, code }));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, file], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { sends: 0, code: OWNERSHIP_HELD });
  gate.resolve(); assert.equal((await sending).status, 'queued'); await closing;
  const persisted = await store(file).read();
  assert.equal(persisted.answers[0].webhookDelivery.deliveryId, a.id);
  assert.equal(persisted.answers[0].webhookDelivery.attempts, 1);
  await assert.rejects(s.flushNotifications(), e => e.code === STORE_CLOSED);
});

test('DRSEC: a same-file store cannot start a send once another store began closing', async t => {
  const entered = Promise.withResolvers(), gate = Promise.withResolvers(), calls = [];
  const { s: a, file } = await fresh({ notifyEvent: async () => { entered.resolve(); await gate.promise; } });
  const b = store(file, { notifyEvent: async (event, id) => calls.push({ eventId: event.eventId, id }) });
  const sending = a.flushNotifications(); await entered.promise;
  const closing = a.close();
  let late;
  t.after(async () => { gate.resolve(); await Promise.allSettled([sending, closing, late]); await b.close(); });
  // Without the guard B queues behind A's captured tail and stays pending here.
  late = b.flushNotifications();
  const outcome = await Promise.race([late.then(() => 'resolved', e => e.code), delay(50).then(() => 'pending')]);
  assert.equal(outcome, STORE_CLOSED);
  await stat(ownerRecordPath(file)); // ownership is held while A's send is unresolved
  gate.resolve(); assert.equal((await sending).status, 'queued'); await closing;
  assert.deepEqual(calls, [], 'B never sent');
  await assert.rejects(stat(ownerRecordPath(file)), { code: 'ENOENT' });
  // The closing window ends with the close: a fresh store flushes again.
  assert.equal((await store(file, { notifyEvent: async () => {} }).flushNotifications()).status, 'empty');
});

test('NOT-2: after 10 failed attempts the entry is failed and flush sends nothing', async () => {
  assert.equal(MAX_DELIVERY_ATTEMPTS, 10);
  let calls = 0;
  const { s, file } = await fresh({ notifyEvent: async () => { calls++; throw new Error('offline'); } });
  let last;
  for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) last = await s.flushNotifications();
  assert.equal(last.status, 'failed'); assert.equal(last.attempts, MAX_DELIVERY_ATTEMPTS);
  assert.equal(last.lastError, 'transport-failed'); assert.equal(calls, MAX_DELIVERY_ATTEMPTS);
  assert.equal((await s.read()).answers[0].webhookDelivery.status, 'failed');
  const before = await readFile(file, 'utf8');
  assert.equal((await s.flushNotifications()).status, 'empty');
  assert.equal(calls, MAX_DELIVERY_ATTEMPTS); assert.equal(await readFile(file, 'utf8'), before);
});

test('NOT-3: a V1 legacy-received answer is not re-notified after migration', async () => {
  const v1 = await fresh({ v2: false });
  await v1.s.ack({ answerId: v1.a.id, status: 'received', actor: 'Root', note: 'Beleg', deliveryReceipt: 'weitergegeben' });
  await v1.s.migrate((await v1.s.read()).revision); await v1.s.close();
  const calls = [];
  const s = store(v1.file, { notifyEvent: async event => calls.push(event) });
  const before = await readFile(v1.file, 'utf8');
  assert.equal((await s.flushNotifications()).status, 'empty');
  assert.deepEqual(calls, []); assert.equal(await readFile(v1.file, 'utf8'), before);
  // Still listed in pending so a V2 receipt can be attached; only webhook delivery is skipped.
  assert.equal((await s.pending()).length, 1);
});

test('NOT-3: a V1 legacy-applied answer is not re-notified after migration', async () => {
  const v1 = await fresh({ v2: false });
  await v1.s.ack({ answerId: v1.a.id, status: 'received', actor: 'Root', note: 'Beleg', deliveryReceipt: 'weitergegeben' });
  await v1.s.ack({ answerId: v1.a.id, status: 'applied', actor: 'Root', note: 'Umgesetzt', evidence: 'Beleg beobachtet' });
  await v1.s.migrate((await v1.s.read()).revision); await v1.s.close();
  const calls = [];
  const s = store(v1.file, { notifyEvent: async event => calls.push(event) });
  const before = await readFile(v1.file, 'utf8');
  assert.equal((await s.flushNotifications()).status, 'empty');
  assert.deepEqual(calls, []); assert.equal(await readFile(v1.file, 'utf8'), before);
  assert.equal((await s.pending()).length, 0);
});

test('NOT-2: a legacy pending entry already at the cap is reported as failed and never sent', async () => {
  let calls = 0;
  const { s, file } = await fresh({ notifyEvent: async () => { calls++; } });
  await s.change(state => {
    const a = state.answers[0];
    a.webhookDelivery = { status: 'pending', attempts: MAX_DELIVERY_ATTEMPTS, lastAttemptAt: '2026-10-08T12:00:00.000Z',
      queuedAt: null, lastError: 'transport-failed', deliveryId: a.id };
  });
  const failed = await s.flushNotifications();
  assert.equal(failed.status, 'failed'); assert.equal(failed.attempts, MAX_DELIVERY_ATTEMPTS);
  assert.equal(failed.lastError, 'transport-failed'); assert.equal(calls, 0);
  assert.equal((await s.read()).answers[0].webhookDelivery.status, 'failed');
  const after = await readFile(file, 'utf8');
  assert.equal((await s.flushNotifications()).status, 'empty');
  assert.equal(calls, 0); assert.equal(await readFile(file, 'utf8'), after);
});

test('NOT-2: an answer that fails three times then succeeds is delivered and stops being eligible', async () => {
  let calls = 0;
  const { s } = await fresh({ notifyEvent: async () => { calls++; if (calls <= 3) throw new Error('offline'); } });
  for (let i = 1; i <= 3; i++) {
    const last = await s.flushNotifications();
    assert.equal(last.status, 'pending'); assert.equal(last.attempts, i); assert.equal(last.lastError, 'transport-failed');
  }
  const queued = await s.flushNotifications();
  assert.equal(queued.status, 'queued'); assert.equal(queued.attempts, 4); assert.equal(queued.lastError, null);
  assert.equal(calls, 4);
  assert.equal((await s.flushNotifications()).status, 'empty');
  assert.equal(calls, 4);
});
