import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DeskStore } from './store.mjs';
import { Readable } from 'node:stream';
import { createDeskServer } from './server.mjs';
import { runCli } from './cli.mjs';
const ROOT = 'test-root-agent'; // D2: synthetic root id, injected (no real id in public tests)

async function fixture() {
  const file = join(await mkdtemp(join(tmpdir(), 'desk-progress-')), 'state.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 1, revision: 0, questions: [], answers: [] }));
  const s = new DeskStore(file, { rootAgentId: ROOT, verifyReceipt: async request => ({ ...request, rootAgentId: ROOT,
    rootAcknowledgedAt: '2026-10-06T18:45:00.000Z', observedProof: 'Isolated exact Root receipt' }),
    verifyPatchAuthority: async () => true, verifyProgressEvidence: async () => true });
  await s.migrate(0); const idea = await s.putIdea({ requestId: 'idea', expectedRevision: null, title: 'Critical', text: 'Install/delete is text' });
  const ref = { kind: 'idea', eventId: idea.eventId, ideaId: idea.id, ideaRevision: 1 };
  await s.receipt({ receiptId: 'root', eventRef: ref, transportMessageId: 'native', rootReplyId: 'root-reply' });
  const patch = await s.putPatch({ requestId: 'patch', expectedRevision: null, label: 'Real plan', windowText: '', sourceRefs: [ref], reason: 'Existing scope', authorityEvidenceRefs: ['approved-scope'] });
  const request = (from, to, expectedProgressRevision, extra = {}) => ({ requestId: `${from}-${to}-${expectedProgressRevision}`, eventRef: ref,
    expectedProgressRevision, from, to, reason: 'Observed review and existing authorized scope', evidenceRefs: ['review-proof'], ...extra });
  const evidence = { id: 'artifact-evidence', eventId: ref.eventId, artifactRef: 'isolated-file.sha256:observed-hash',
    observedAt: '2026-10-06T18:45:00.000Z', check: 'node --test isolated.test.mjs', observedResult: 'Exit0 observed fixture', actor: 'implementer' };
  return { s, idea, ref, patch, request, evidence };
}

test('progress exact review plan and immutable implementation complete without any automatic execution', async () => {
  const { s, request, patch, evidence } = await fixture();
  await s.putProgress(request('incoming', 'reviewed', 1)); await s.putProgress(request('reviewed', 'planned', 2, { patchId: patch.id }));
  const planned = structuredClone((await s.read()).progress[0]);
  const result = await s.putProgress(request('planned', 'applied', 3, { implementationEvidence: evidence }));
  assert.equal(result.currentStatus, 'applied'); const state = await new DeskStore(s.file, { rootAgentId: ROOT }).read();
  assert.deepEqual(state.progress[0].history.slice(0, 3), planned.history); assert.deepEqual(state.progress[0].history.at(-1).implementationEvidence, evidence);
  assert.deepEqual(await s.inbox(), { pending: [], received: [] });
  await assert.rejects(s.putProgress(request('applied', 'reviewed', 4)), e => e.status === 409);
});

test('progress guards CAS skips missing receipt missing plan and missing observed implementation', async () => {
  const { s, request, patch, evidence } = await fixture(); const initial = await readFile(s.file, 'utf8');
  await assert.rejects(s.putProgress(request('incoming', 'applied', 1, { implementationEvidence: evidence })), e => e.status === 409);
  await assert.rejects(s.putProgress(request('incoming', 'reviewed', 2)), e => e.status === 409);
  s.io.verifyProgressEvidence = undefined; await assert.rejects(s.putProgress(request('incoming', 'reviewed', 1)), e => e.status === 503);
  s.io.verifyProgressEvidence = async () => false; await assert.rejects(s.putProgress(request('incoming', 'reviewed', 1)), e => e.status === 403);
  assert.equal(await readFile(s.file, 'utf8'), initial); s.io.verifyProgressEvidence = async () => true;
  await s.putProgress(request('incoming', 'reviewed', 1));
  await assert.rejects(s.putProgress(request('reviewed', 'planned', 2)), e => e.status === 400);
  await s.putProgress(request('reviewed', 'planned', 2, { patchId: patch.id }));
  await assert.rejects(s.putProgress(request('planned', 'applied', 3)), e => e.status === 400);
  await assert.rejects(s.putProgress(request('planned', 'applied', 3, { implementationEvidence: { ...evidence, eventId: 'different' } })), e => e.status === 409);
});

test('progress CAS and request replay survive rollback restart and content supersession without status inheritance', async () => {
  const { s, request, patch, idea } = await fixture(); const review = request('incoming', 'reviewed', 1);
  const races = await Promise.allSettled([s.putProgress(review), s.putProgress({ ...review, requestId: 'racing-review' })]);
  assert.equal(races.filter(r => r.status === 'fulfilled').length, 1); assert.equal(races.find(r => r.status === 'rejected').reason.status, 409);
  const first = races[0].value; await s.putProgress(request('reviewed', 'planned', 2, { patchId: patch.id }));
  await s.putProgress(request('planned', 'reviewed', 3, { reason: 'Plan deferred after new observation' }));
  const next = await s.putIdea({ id: idea.id, expectedRevision: 1, requestId: 'edited', title: 'New content', text: 'Independent' });
  const bytes = await readFile(s.file, 'utf8'); assert.deepEqual(await new DeskStore(s.file, { rootAgentId: ROOT }).putProgress(review), first);
  await assert.rejects(s.putProgress({ ...review, reason: 'Changed payload' }), e => e.status === 409);
  await assert.rejects(s.putProgress(request('reviewed', 'planned', 4, { patchId: patch.id })), e => e.status === 409);
  assert.equal(await readFile(s.file, 'utf8'), bytes); assert.equal((await s.read()).progress.find(p => p.eventId === next.eventId).currentStatus, 'incoming');
});

test('progress interrupted commit preserves state and malformed implementation history fails closed', async () => {
  const { s, request } = await fixture(); const bytes = await readFile(s.file, 'utf8');
  const broken = new DeskStore(s.file, { rootAgentId: ROOT, verifyProgressEvidence: async () => true, rename: async (from, to) => {
    if (to === s.file) throw new Error('progress interrupted'); return rename(from, to);
  } });
  await assert.rejects(broken.putProgress(request('incoming', 'reviewed', 1)), /progress interrupted/); assert.equal(await readFile(s.file, 'utf8'), bytes);
  await s.putProgress(request('incoming', 'reviewed', 1)); const state = await s.read(); state.progress[0].history.at(-1).implementationEvidence = {};
  const corrupt = JSON.stringify(state); await writeFile(s.file, corrupt); await assert.rejects(s.read(), e => e.status === 503);
  assert.equal(await readFile(s.file, 'utf8'), corrupt);
});
test('progress shared answer save is atomically incoming and legacy ack cannot bypass exact plan and evidence', async () => {
  const { s } = await fixture(); const q = { id: 'answer-source', title: 'Test', context: 'Test', owner: 'Test', category: 'Test', scope: 'Test',
    source: 'Test', uncertainty: 'Test', recommendation: { optionIds: ['a'], rationale: 'Test' },
    options: ['a', 'b'].map(id => ({ id, label: id, rationale: 'Test', impact: 'Test', tradeoff: 'Test', effort: 'Test', reversible: 'Test' })) };
  await s.putQuestion(q); const a = await s.answer({ questionId: q.id, questionRevision: 1, requestId: 'answer', expectedAnswerId: null, action: 'answer', selected: ['a'], note: '' });
  assert.equal((await s.read()).progress.find(p => p.eventId === a.id)?.currentStatus, 'incoming');
  const ref = { kind: 'answer', eventId: a.id, questionId: q.id, questionRevision: 1 };
  const progress = (from, to, expectedProgressRevision, extra = {}) => ({ requestId: `answer-${to}-${expectedProgressRevision}`, eventRef: ref,
    expectedProgressRevision, from, to, reason: 'Observed answer scope', evidenceRefs: ['observed-proof'], ...extra });
  await assert.rejects(s.putProgress(progress('incoming', 'reviewed', 1)), e => e.status === 409);
  await s.receipt({ receiptId: 'answer-root', eventRef: ref, transportMessageId: 'answer-native', rootReplyId: 'answer-reply' });
  await assert.rejects(s.ack({ answerId: a.id, status: 'applied', actor: 'Root', evidence: 'free text' }), e => e.status === 409);
  await assert.rejects(s.ack({ answerId: a.id, status: 'applied', progress: progress('incoming', 'applied', 1) }), e => e.status === 409);
  await s.putProgress(progress('incoming', 'reviewed', 1));
  const patch = await s.putPatch({ requestId: 'answer-plan', expectedRevision: null, label: 'Bound plan', windowText: '', sourceRefs: [ref], reason: 'Scope', authorityEvidenceRefs: ['approved-scope'] });
  await s.putProgress(progress('reviewed', 'planned', 2, { patchId: patch.id }));
  const applied = progress('planned', 'applied', 3, { implementationEvidence: { id: 'answer-artifact', eventId: a.id,
    artifactRef: 'isolated-file:hash', observedAt: '2026-10-06T18:45:00.000Z', check: 'isolated check', observedResult: 'Exit0 observed', actor: 'implementer' } });
  assert.equal((await s.ack({ answerId: a.id, status: 'applied', progress: applied })).progress.currentStatus, 'applied');
  assert.equal((await s.inbox()).received.some(e => e.eventRef.eventId === a.id), false);
});

test('progress implementation replay is canonical across property order and API CLI enforce Root-only access', async () => {
  const { s, request, patch, evidence } = await fixture(); const token = 'test-only-progress-root-token-not-a-real-secret';
  const server = createDeskServer({ rootAgentId: ROOT, statePath: s.file, rootReceiptToken: token });
  const review = request('incoming', 'reviewed', 1);
  const invoke = headers => { const req = Readable.from([Buffer.from(JSON.stringify(review))]);
    Object.assign(req, { method: 'POST', url: '/api/progress', headers: { host: '127.0.0.1:4791', 'x-decision-desk': 'agent', 'content-type': 'application/json', ...headers } });
    return new Promise(resolve => server.emit('request', req, { socket: { localPort: 4791 }, setHeader() {}, writeHead(status) { this.status = status; },
      end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } })); };
  assert.equal((await invoke({ origin: 'http://127.0.0.1:4791' })).status, 403);
  const reviewed = await invoke({ authorization: `Bearer ${token}` }); assert.equal(reviewed.status, 200);
  const file = join(s.file, '..', 'progress.json'); await writeFile(file, JSON.stringify(review)); let sent;
  await runCli(['progress', file], { DECISION_DESK_ROOT_RECEIPT_TOKEN: token }, async (url, options) => {
    sent = { url: String(url), options }; return { ok: true, json: async () => reviewed.body };
  }); assert.equal(sent.url, 'http://127.0.0.1:4791/api/progress'); assert.equal(sent.options.redirect, 'error');
  await s.putProgress(request('reviewed', 'planned', 2, { patchId: patch.id }));
  const applied = request('planned', 'applied', 3, { implementationEvidence: evidence }); const result = await s.putProgress(applied);
  const reordered = Object.fromEntries(Object.entries(evidence).reverse()); const bytes = await readFile(s.file, 'utf8');
  assert.deepEqual(await new DeskStore(s.file, { rootAgentId: ROOT }).putProgress({ ...applied, implementationEvidence: reordered }), result);
  assert.equal(await readFile(s.file, 'utf8'), bytes);
});
