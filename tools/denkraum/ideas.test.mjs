import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { DeskStore } from './store.mjs';
import { createDeskServer } from './server.mjs';
import { runCli } from './cli.mjs';
const ROOT = 'test-root-agent'; // D2: synthetic root id, injected (no real id in public tests)

const input = (extra = {}) => ({ requestId: 'idea-request', expectedRevision: null, title: 'Critical idea',
  text: 'Install/delete/run is user text, not authority.', ...extra });
async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'desk-ideas-')); const file = join(dir, 'state.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 1, revision: 7, questions: [], answers: [], extra: { preserved: true } }));
  const s = new DeskStore(file, { rootAgentId: ROOT }); await s.migrate(7); return s;
}

test('ideas save free text without options and atomically start incoming without execution or receipt authority', async () => {
  const s = await fresh(); const a = await s.putIdea(input({ status: 'applied', actor: 'Root' }));
  const state = await new DeskStore(s.file, { rootAgentId: ROOT }).read();
  assert.equal(state.ideas[0].id, a.id); assert.equal(state.ideas[0].revisions[0].text, input().text);
  assert.equal(state.progress[0].eventId, a.eventId); assert.equal(state.progress[0].currentStatus, 'incoming');
  assert.equal(state.progress[0].history.length, 1); assert.deepEqual(state.receipts, []); assert.deepEqual(state.patches, []);
  assert.deepEqual(state.extra, { preserved: true }); assert.equal(state.questions.length, 0); assert.equal(state.answers.length, 0);
});

test('ideas append revisions with CAS and earlier request replay survives restart and supersession', async () => {
  const s = await fresh(); const a = await s.putIdea(input()); const original = structuredClone((await s.read()).ideas[0].revisions[0]);
  const edits = await Promise.allSettled(['second', 'third'].map((name, n) => s.putIdea(input({ id: a.id, expectedRevision: 1, requestId: name, text: `Edit ${n}` }))));
  assert.equal(edits.filter(r => r.status === 'fulfilled').length, 1); assert.equal(edits.find(r => r.status === 'rejected').reason.status, 409);
  const state = await s.read(); assert.equal(state.ideas[0].revisions.length, 2); assert.deepEqual(state.ideas[0].revisions[0], original);
  assert.notEqual(state.ideas[0].revisions[1].eventId, a.eventId); assert.equal(state.progress.length, 2);
  const before = await readFile(s.file, 'utf8'); assert.deepEqual(await new DeskStore(s.file, { rootAgentId: ROOT }).putIdea(input()), a);
  await assert.rejects(s.putIdea(input({ text: 'different request payload' })), e => e.status === 409);
  assert.equal(await readFile(s.file, 'utf8'), before);
});

test('ideas reject malformed or oversized inputs, missing edits and V1 writes without migration', async () => {
  const s = await fresh();
  for (const bad of [{ title: '' }, { text: ' ' }, { text: 'x'.repeat(8001) }, { title: 'x'.repeat(201) },
    { source: [] }, { source: 'x'.repeat(2001) }, { expectedRevision: '1' }, { expectedRevision: 1 }, { requestId: '' }])
    await assert.rejects(s.putIdea(input(bad)), e => e.status === 400);
  await assert.rejects(s.putIdea(input({ id: 'missing', expectedRevision: 1 })), e => e.status === 404);
  const legacy = JSON.stringify({ schemaVersion: 1, revision: 0, questions: [], answers: [] }); await writeFile(s.file, legacy);
  await assert.rejects(s.putIdea(input()), e => e.status === 409); assert.equal(await readFile(s.file, 'utf8'), legacy);
});

test('ideas interrupted commit preserves both content and progress and same request can recover', async () => {
  const s = await fresh(); const before = await readFile(s.file, 'utf8');
  const failing = new DeskStore(s.file, { rootAgentId: ROOT, rename: async (from, to) => { if (to === s.file) throw new Error('idea commit interrupted'); return rename(from, to); } });
  await assert.rejects(failing.putIdea(input()), /idea commit interrupted/);
  assert.equal(await readFile(s.file, 'utf8'), before); await s.putIdea(input());
  assert.equal((await s.read()).ideas.length, 1); assert.equal((await s.read()).progress.length, 1);
  const corrupted = { ...(await s.read()), ideas: [{ id: 'broken', revisions: [null] }] }; const bytes = JSON.stringify(corrupted);
  await writeFile(s.file, bytes); await assert.rejects(s.read(), e => e.status === 503); assert.equal(await readFile(s.file, 'utf8'), bytes);
});

test('ideas new content never inherits prior planned progress', async () => {
  const s = await fresh(); const a = await s.putIdea(input()); const state = await s.read(); const progress = state.progress[0];
  for (const to of ['reviewed', 'planned']) { const from = progress.currentStatus; progress.currentStatus = to; progress.progressRevision++;
    progress.history.push({ from, to, progressRevision: progress.progressRevision, actor: 'Root fixture', at: new Date().toISOString(), reason: 'Isolated prior plan fixture' }); }
  await writeFile(s.file, JSON.stringify(state)); const historical = structuredClone(progress);
  const next = await s.putIdea(input({ id: a.id, expectedRevision: 1, requestId: 'new-content', text: 'New independent content' }));
  const updated = await s.read(); assert.deepEqual(updated.progress[0], historical);
  assert.equal(updated.progress.find(p => p.eventId === next.eventId).currentStatus, 'incoming');
});

test('ideas API and CLI bind the same free-text revision contract without opening a server', async () => {
  const s = await fresh(); const server = createDeskServer({ rootAgentId: ROOT, statePath: s.file, rootReceiptToken: '' });
  const req = Readable.from([Buffer.from(JSON.stringify(input()))]);
  Object.assign(req, { method: 'POST', url: '/api/ideas', headers: { host: '127.0.0.1:4791', origin: 'http://127.0.0.1:4791', 'content-type': 'application/json' } });
  const result = await new Promise(resolve => server.emit('request', req, { socket: { localPort: 4791 }, setHeader() {}, writeHead(status) { this.status = status; },
    end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } }));
  assert.equal(result.status, 200); assert.equal(result.body.revision, 1);
  const file = join(dirname(s.file), 'idea.json'); await writeFile(file, JSON.stringify(input()));
  let sent; await runCli(['idea', file], {}, async (url, options) => { sent = { url: String(url), options }; return { ok: true, json: async () => result.body }; });
  assert.equal(sent.url, 'http://127.0.0.1:4791/api/ideas'); assert.equal(sent.options.redirect, 'error'); assert.deepEqual(JSON.parse(sent.options.body), input());
});

const ideaRef = idea => ({ kind: 'idea', eventId: idea.eventId, ideaId: idea.id, ideaRevision: idea.revision });
const verified = async request => ({ ...request, rootAgentId: ROOT,
  rootAcknowledgedAt: '2026-10-06T18:29:00.000Z', observedProof: 'Isolated verified Root message' });
const receiptInput = a => ({ receiptId: 'idea-receipt', eventRef: ideaRef(a), transportMessageId: 'native-msg', rootReplyId: 'root-msg' });

test('typed ideas receipt and inbox remain revision-bound and pending stays answer-only across restart and edits', async () => {
  const s = await fresh(); s.io.verifyReceipt = verified; const a = await s.putIdea(input());
  assert.deepEqual(await s.pending(), []); assert.deepEqual((await s.inbox()).pending[0].eventRef, ideaRef(a));
  const r = await s.receipt(receiptInput(a)); assert.equal(r.eventRef.kind, 'idea');
  const restart = new DeskStore(s.file, { rootAgentId: ROOT, verifyReceipt: verified }); const inbox = await restart.inbox();
  assert.equal(inbox.pending.length, 0); assert.equal(inbox.received[0].receipt.receiptId, r.receiptId);
  assert.equal(inbox.received[0].progress.currentStatus, 'incoming');
  const newer = await restart.putIdea(input({ id: a.id, expectedRevision: 1, requestId: 'edited' }));
  const before = await readFile(s.file, 'utf8'); assert.deepEqual(await restart.receipt(receiptInput(a)), r);
  assert.equal(await readFile(s.file, 'utf8'), before); assert.equal((await restart.inbox()).pending[0].eventRef.eventId, newer.eventId);
  await assert.rejects(restart.receipt({ ...receiptInput(a), receiptId: 'stale' }), e => e.status === 409);
  await assert.rejects(restart.receipt({ ...receiptInput(newer), eventRef: { ...ideaRef(newer), ideaRevision: 1 } }), e => e.status === 409);
  await assert.rejects(restart.receipt({ ...receiptInput(newer), receiptId: 'missing', eventRef: { ...ideaRef(newer), eventId: 'unknown' } }), e => e.status === 404);
});

test('typed ideas receipt rejects fabricated proof and interrupted commit recovers with same key', async () => {
  const s = await fresh(); const a = await s.putIdea(input()); const before = await readFile(s.file, 'utf8');
  await assert.rejects(s.receipt(receiptInput(a)), e => e.status === 503);
  s.io.verifyReceipt = async request => ({ ...await verified(request), eventRef: { kind: 'answer', eventId: a.eventId, questionId: a.id, questionRevision: 1 } });
  await assert.rejects(s.receipt(receiptInput(a)), e => e.status === 403); assert.equal(await readFile(s.file, 'utf8'), before);
  const interrupted = new DeskStore(s.file, { rootAgentId: ROOT, verifyReceipt: verified, rename: async (from, to) => {
    if (to === s.file) throw new Error('typed receipt interrupted'); return rename(from, to);
  } });
  await assert.rejects(interrupted.receipt(receiptInput(a)), /typed receipt interrupted/); assert.equal(await readFile(s.file, 'utf8'), before);
  await new DeskStore(s.file, { rootAgentId: ROOT, verifyReceipt: verified }).receipt(receiptInput(a)); assert.equal((await s.read()).receipts.length, 1);
});

test('typed ideas outbox preserves exact revisions and race guards while queued is not Root reception', async () => {
  const s = await fresh(); const a = await s.putIdea(input()); const calls = [];
  s.io.notifyEvent = async (event, delivery) => calls.push({ event, delivery });
  assert.equal((await s.flushNotifications()).status, 'queued'); assert.equal(calls[0].event.eventId, a.eventId);
  assert.equal(calls[0].event.contentRevision, 1); assert.equal(calls[0].delivery, a.eventId);
  assert.equal((await s.inbox()).pending.length, 1); assert.equal((await s.read()).receipts.length, 0);
  const next = await s.putIdea(input({ id: a.id, expectedRevision: 1, requestId: 'next' }));
  s.io.notifyEvent = async () => { await s.putIdea(input({ id: a.id, expectedRevision: 2, requestId: 'race' })); };
  assert.equal((await s.flushNotifications(next.eventId)).status, 'superseded');
  assert.equal((await s.read()).ideas[0].revisions[1].webhookDelivery.status, 'pending');
});

test('typed ideas API delivery and Root-only receipt share the exact contract without sockets or live proof claims', async () => {
  const s = await fresh(); const token = 'test-only-typed-root-authority-not-a-real-secret'; const deliveries = [];
  const server = createDeskServer({ rootAgentId: ROOT, statePath: s.file, rootReceiptToken: token, notifyEvent: async event => deliveries.push(event) });
  const call = (url, payload, headers = {}) => {
    const req = Readable.from([Buffer.from(JSON.stringify(payload))]);
    Object.assign(req, { method: 'POST', url, headers: { host: '127.0.0.1:4791', 'content-type': 'application/json', 'x-decision-desk': 'agent', ...headers } });
    return new Promise(resolve => server.emit('request', req, { socket: { localPort: 4791 }, setHeader() {}, writeHead(status) { this.status = status; },
      end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } }));
  };
  const created = await call('/api/ideas', input()); assert.equal(created.status, 200); assert.equal(created.body.savedAcceptance, true);
  assert.equal(deliveries[0].eventId, created.body.eventId); assert.equal(deliveries[0].contentRevision, 1);
  const request = { ...receiptInput(created.body), proof: { rootAcknowledgedAt: '2026-10-06T18:29:00.000Z', observedProof: 'Local test attestation only' } };
  assert.equal((await call('/api/receipts', request)).status, 403);
  const accepted = await call('/api/receipts', request, { authorization: `Bearer ${token}` });
  assert.equal(accepted.status, 200); assert.equal(accepted.body.verificationMode, 'trusted-local-root-attestation');
  assert.equal((await s.inbox()).received.length, 1); assert.deepEqual(await s.pending(), []);
});

test('L0 ideas persist flat defaults on new revisions without changing omitted canonical payload', async () => {
  const s = await fresh(); const a = await s.putIdea(input());
  assert.equal(a.category, ''); assert.equal(a.userPriority, 'normal');
  assert.equal(a.payload, JSON.stringify({ id: null, expectedRevision: null, title: input().title, text: input().text, source: null }));
  const reopened = new DeskStore(s.file, { rootAgentId: ROOT });
  assert.deepEqual(await reopened.putIdea(input()), a);
  assert.equal((await reopened.read()).ideas[0].revisions[0].category, '');
});

for (const userPriority of ['urgent', 'high', 'normal', 'later']) {
  test(`L0 ideas persist priority ${userPriority} and trimmed UTF16 category boundary`, async () => {
    const s = await fresh(); const category = '😀'.repeat(40);
    const request = input({ category: `  ${category}  `, userPriority, source: 'Agent/PLAN fixture; no human approval' });
    const a = await s.putIdea(request);
    assert.equal(a.category, category); assert.equal(a.userPriority, userPriority);
    assert.equal(a.source, request.source); assert.equal(a.text, request.text);
    assert.equal(JSON.parse(a.payload).category, category);
    assert.deepEqual(await new DeskStore(s.file, { rootAgentId: ROOT }).putIdea(request), a);
  });
}

test('L0 ideas reject invalid metadata without writing and reject corrupted persisted metadata', async () => {
  const s = await fresh(); const before = await readFile(s.file, 'utf8');
  for (const bad of [{ category: '😀'.repeat(40) + 'x' }, { category: null }, { category: [] },
    { userPriority: 'blocking' }, { userPriority: null }, { userPriority: '' }]) {
    await assert.rejects(s.putIdea(input(bad)), e => e.status === 400);
    assert.equal(await readFile(s.file, 'utf8'), before);
  }
  const a = await s.putIdea(input({ category: '   ', userPriority: 'normal' }));
  assert.equal(a.category, '');
  const state = JSON.parse(await readFile(s.file, 'utf8'));
  for (const bad of [{ category: ' padded ' }, { category: 'x'.repeat(81) }, { userPriority: 'blocking' }]) {
    const broken = structuredClone(state); Object.assign(broken.ideas[0].revisions[0], bad);
    const bytes = JSON.stringify(broken); await writeFile(s.file, bytes);
    await assert.rejects(new DeskStore(s.file, { rootAgentId: ROOT }).read(), e => e.status === 503);
    assert.equal(await readFile(s.file, 'utf8'), bytes);
  }
});

test('L0 legacy projection never rewrites historical snapshots or historical replay bytes', async () => {
  const s = await fresh(); const a = await s.putIdea(input()); const state = JSON.parse(await readFile(s.file, 'utf8'));
  const legacy = state.ideas[0].revisions[0]; delete legacy.category; delete legacy.userPriority;
  const expected = { id: a.id, ...structuredClone(legacy) }; const bytes = JSON.stringify(state);
  await writeFile(s.file, bytes); const reopened = new DeskStore(s.file, { rootAgentId: ROOT });
  assert.equal((await reopened.read()).ideas[0].revisions[0].userPriority, 'normal');
  assert.equal((await reopened.inbox()).pending[0].content.category, '');
  assert.equal(await readFile(s.file, 'utf8'), bytes);
  assert.equal(JSON.stringify(await reopened.putIdea(input())), JSON.stringify(expected));
  assert.equal(await readFile(s.file, 'utf8'), bytes);
  await reopened.putIdea(input({ requestId: 'sibling', title: 'Independent synthetic sibling' }));
  const after = JSON.parse(await readFile(s.file, 'utf8'));
  assert.deepEqual(after.ideas[0].revisions[0], legacy);
  for (const key of ['questions', 'answers', 'receipts', 'patches', 'extra'])
    assert.deepEqual(after[key], state[key]);
});

test('L0 metadata edits inherit omitted fields only after replay and CAS, preserving original history', async () => {
  const s = await fresh(); const a = await s.putIdea(input({ category: 'Systems', userPriority: 'high' }));
  const old = JSON.parse(await readFile(s.file, 'utf8')).ideas[0].revisions[0];
  const request = input({ id: a.id, expectedRevision: 1, requestId: 'metadata-edit', userPriority: 'urgent' });
  const b = await s.putIdea(request); assert.equal(b.category, 'Systems'); assert.equal(b.userPriority, 'urgent');
  assert.equal(b.text, a.text); assert.equal(b.source, a.source); assert.notEqual(b.eventId, a.eventId);
  const c = await s.putIdea(input({ id: a.id, expectedRevision: 2, requestId: 'omit-edit', category: '' }));
  assert.equal(c.category, ''); assert.equal(c.userPriority, 'urgent');
  const before = await readFile(s.file, 'utf8'); const restarted = new DeskStore(s.file, { rootAgentId: ROOT });
  assert.equal(JSON.stringify(await restarted.putIdea(request)), JSON.stringify(b));
  await assert.rejects(restarted.putIdea({ ...request, userPriority: 'later' }), e => e.status === 409);
  await assert.rejects(restarted.putIdea({ ...request, category: 'Systems' }), e => e.status === 409);
  await assert.rejects(restarted.putIdea({ ...request, requestId: 'stale-new' }), e => e.status === 409);
  assert.equal(await readFile(s.file, 'utf8'), before);
  assert.deepEqual(JSON.parse(before).ideas[0].revisions[0], old);
  assert.equal((await restarted.inbox()).pending[0].content.userPriority, 'urgent');
});

test('L0 competing metadata revisions keep one winner and atomic failure can reopen and retry', async () => {
  const s = await fresh(); const a = await s.putIdea(input({ category: 'Original', userPriority: 'later' }));
  const before = await readFile(s.file, 'utf8');
  const request = input({ id: a.id, expectedRevision: 1, requestId: 'fault-edit', category: 'Recovered' });
  const failing = new DeskStore(s.file, { rootAgentId: ROOT, rename: async (from, to) => {
    if (to === s.file) throw new Error('L0 interrupted rename'); return rename(from, to);
  } });
  await assert.rejects(failing.putIdea(request), /L0 interrupted rename/);
  assert.equal(await readFile(s.file, 'utf8'), before);
  const reopened = new DeskStore(s.file, { rootAgentId: ROOT }); const b = await reopened.putIdea(request);
  assert.equal(b.category, 'Recovered'); assert.equal(b.userPriority, 'later');
  const results = await Promise.allSettled(['urgent', 'high'].map(userPriority =>
    reopened.putIdea(input({ id: a.id, expectedRevision: 2, requestId: `cas-${userPriority}`, userPriority }))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  const state = await reopened.read(); assert.equal(state.ideas[0].revisions.length, 3);
  assert.equal(state.progress.length, 3); assert.equal(state.receipts.length, 0); assert.equal(state.patches.length, 0);
  assert.deepEqual(await new DeskStore(s.file, { rootAgentId: ROOT }).putIdea(request), b);
});

test('L0 existing API and CLI transport preserve flat fields and provide read defaults without a socket', async () => {
  const s = await fresh(); const server = createDeskServer({ rootAgentId: ROOT, statePath: s.file, rootReceiptToken: '' });
  const request = input({ category: '  API  ', userPriority: 'high' });
  const req = Readable.from([Buffer.from(JSON.stringify(request))]);
  Object.assign(req, { method: 'POST', url: '/api/ideas', headers: {
    host: '127.0.0.1:4791', origin: 'http://127.0.0.1:4791', 'content-type': 'application/json' } });
  const result = await new Promise(resolve => server.emit('request', req, {
    socket: { localPort: 4791 }, setHeader() {}, writeHead(status) { this.status = status; },
    end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } }));
  assert.equal(result.status, 200); assert.equal(result.body.category, 'API');
  assert.equal(result.body.userPriority, 'high'); assert.equal(result.body.savedAcceptance, true);
  const file = join(dirname(s.file), 'metadata-request.json'); await writeFile(file, JSON.stringify(request));
  let sent; await runCli(['idea', file], {}, async (url, options) => {
    sent = options; return { ok: true, json: async () => result.body };
  });
  assert.deepEqual(JSON.parse(sent.body), request); assert.equal(sent.redirect, 'error');
});
