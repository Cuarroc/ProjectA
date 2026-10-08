import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ProgressStore } from './progress.mjs';
import { answerRef, DeskError, validateQuestion } from './model.mjs';

const ROOT = 'test-root-agent';
const opt = id => ({ id, label: id, rationale: 'r', impact: 'i', tradeoff: 't', effort: 'e', reversible: 'ja' });
const question = id => ({ ...validateQuestion({ id, title: 'T', context: 'C', owner: 'O', category: 'K', scope: 'S', source: 'Q',
  uncertainty: 'U', recommendation: { optionIds: ['a'], rationale: 'R' }, options: [opt('a'), opt('b')] }), revision: 1 });
const verifyReceipt = async request => ({ ...request, rootAgentId: ROOT, rootAcknowledgedAt: '2026-10-08T12:00:00.000Z', observedProof: 'synthetic proof' });
const verified = { verifyReceipt, verifyProgressEvidence: async () => true, verifyPatchAuthority: async () => true };
const store = (file, config) => new ProgressStore(file, { rootAgentId: ROOT, ...verified, ...config });
const status = code => e => e instanceof DeskError && e.status === code;
async function fresh({ v2 = true } = {}) {
  const file = join(await mkdtemp(join(tmpdir(), 'denkraum-progress-')), 'ledger.json'); const s = store(file);
  await s.change(state => { state.questions.push(question('E-1'), question('E-2')); });
  if (v2) await s.migrate((await s.read()).revision);
  const answer = (questionId, action = 'answer') => s.answer({ questionId, questionRevision: 1, expectedAnswerId: null, requestId: `req-${questionId}`,
    action, selected: action === 'answer' ? ['a'] : [], note: 'n' });
  const receive = (a, n = 1) => s.receipt({ receiptId: `rcpt-${n}`, eventRef: answerRef(a), transportMessageId: `mail-${n}`, rootReplyId: `reply-${n}` });
  return { s, file, answer, receive };
}
const step = (a, extra) => ({ requestId: `${extra.from}-${extra.to}`, eventRef: answerRef(a), expectedProgressRevision: 1, from: 'incoming',
  to: 'reviewed', reason: 'geprüft', evidenceRefs: ['check-1'], ...extra });
const patch = (a, extra = {}) => ({ requestId: 'patch-1', expectedRevision: null, label: 'Plan', windowText: 'Fenster', sourceRefs: [answerRef(a)],
  reason: 'geplant', authorityEvidenceRefs: ['approval-1'], ...extra });
const evidence = (eventId, id = 'impl-1') => ({ id, eventId, artifactRef: 'commit', observedAt: '2026-10-08T12:30:00.000Z', check: 'tests', observedResult: 'pass', actor: 'Root' });

test('progress needs the exact Root receipt and walks to applied through a patch plan and the acknowledgement hook', async () => {
  const { s, answer, receive } = await fresh(); const a = await answer('E-1');
  await assert.rejects(s.putProgress(step(a, { from: 'incoming', to: 'reviewed' })), status(409), 'no receipt yet');
  await receive(a);
  const reviewed = await s.putProgress(step(a, { from: 'incoming', to: 'reviewed' }));
  assert.equal(reviewed.currentStatus, 'reviewed'); assert.equal(reviewed.progressRevision, 2); assert.equal(reviewed.transition.actor, ROOT);
  const bytes = await readFile(s.file, 'utf8');
  assert.deepEqual(await s.putProgress(step(a, { from: 'incoming', to: 'reviewed' })), reviewed, 'replay returns the stored transition');
  await assert.rejects(s.putProgress(step(a, { from: 'incoming', to: 'reviewed', reason: 'anders' })), status(409));
  assert.equal(await readFile(s.file, 'utf8'), bytes);
  await assert.rejects(s.putProgress(step(a, { from: 'reviewed', to: 'planned', expectedProgressRevision: 2 })), status(400), 'patch plan required');
  const plan = await s.putPatch(patch(a));
  assert.equal(plan.revision, 1); assert.equal(plan.authorityMode, 'configured-verifier-attestation');
  const planned = await s.putProgress(step(a, { from: 'reviewed', to: 'planned', expectedProgressRevision: 2, patchId: plan.id }));
  assert.deepEqual(planned.transition.patchRef, { id: plan.id, revision: 1 });
  const applied = step(a, { from: 'planned', to: 'applied', expectedProgressRevision: 3 });
  await assert.rejects(s.putProgress(applied), status(400), 'observed implementation evidence required');
  await assert.rejects(s.putProgress({ ...applied, implementationEvidence: evidence('other-event') }), status(409));
  const done = await s.ack({ answerId: a.id, status: 'applied', progress: { ...applied, implementationEvidence: evidence(a.id) } });
  assert.equal(done.progress.currentStatus, 'applied'); assert.equal(done.progress.transition.implementationEvidence.id, 'impl-1');
  assert.deepEqual((await s.read()).progress[0].history.map(h => h.to), ['incoming', 'reviewed', 'planned', 'applied']);
});

test('progress refuses unverified evidence, illegal jumps, stale revisions and approval from a deferred answer', async () => {
  const { s, file, answer, receive } = await fresh(); const a = await answer('E-1'); const d = await answer('E-2', 'defer');
  await receive(a, 1); await receive(d, 2); const bytes = await readFile(file, 'utf8');
  await assert.rejects(store(file, { verifyProgressEvidence: undefined }).putProgress(step(a, { from: 'incoming', to: 'reviewed' })), status(503));
  await assert.rejects(store(file, { verifyProgressEvidence: async () => false }).putProgress(step(a, { from: 'incoming', to: 'reviewed' })), status(403));
  await assert.rejects(s.putProgress(step(a, { from: 'incoming', to: 'applied', implementationEvidence: evidence(a.id) })), status(409));
  await assert.rejects(s.putProgress(step(a, { from: 'incoming', to: 'reviewed', expectedProgressRevision: 2 })), status(409));
  await assert.rejects(s.putProgress(step(a, { from: 'incoming', to: 'reviewed', implementationEvidence: evidence(a.id) })), status(400));
  assert.equal(await readFile(file, 'utf8'), bytes);
  await s.putProgress(step(d, { requestId: 'd-reviewed', from: 'incoming', to: 'reviewed' }));
  await assert.rejects(s.putProgress(step(d, { requestId: 'd-planned', from: 'reviewed', to: 'planned', expectedProgressRevision: 2, patchId: 'x' })), status(409));
});

test('patches need received current approving sources and a verified authority; revisions are checked', async () => {
  const { s, file, answer, receive } = await fresh(); const a = await answer('E-1'); const d = await answer('E-2', 'defer');
  await assert.rejects(s.putPatch(patch(a)), status(409), 'source not received');
  await receive(a, 1); await receive(d, 2); const bytes = await readFile(file, 'utf8');
  await assert.rejects(s.putPatch(patch(a, { sourceRefs: [answerRef(d)] })), status(409), 'defer approves nothing');
  await assert.rejects(s.putPatch(patch(a, { sourceRefs: [answerRef(a), answerRef(a)] })), status(400));
  await assert.rejects(store(file, { verifyPatchAuthority: undefined }).putPatch(patch(a)), status(503));
  await assert.rejects(store(file, { verifyPatchAuthority: async () => false }).putPatch(patch(a)), status(403));
  await assert.rejects(s.putPatch(patch(a, { id: 'missing', expectedRevision: 1 })), status(404));
  assert.equal(await readFile(file, 'utf8'), bytes);
  const first = await s.putPatch(patch(a));
  assert.deepEqual(await s.putPatch(patch(a)), first); await assert.rejects(s.putPatch(patch(a, { label: 'Anders' })), status(409));
  await assert.rejects(s.putPatch(patch(a, { requestId: 'patch-2', id: first.id, expectedRevision: 2 })), status(409));
  const second = await s.putPatch(patch(a, { requestId: 'patch-2', id: first.id, expectedRevision: 1, label: 'Plan 2' }));
  assert.equal(second.id, first.id); assert.equal(second.revision, 2);
  const v1 = await fresh({ v2: false }); const a1 = await v1.answer('E-1');
  await assert.rejects(v1.s.putPatch(patch(a1)), status(409)); await assert.rejects(v1.s.putProgress(step(a1, { from: 'incoming', to: 'reviewed' })), status(409));
});

test('progress and patches fail closed without a configured root agent id', async () => {
  const { s, file, answer, receive } = await fresh(); const a = await answer('E-1'); await receive(a);
  const bytes = await readFile(file, 'utf8'); const rootless = new ProgressStore(file, verified);
  await assert.rejects(rootless.putProgress(step(a, { from: 'incoming', to: 'reviewed' })), status(503));
  await assert.rejects(rootless.putPatch(patch(a)), status(503));
  assert.equal(await readFile(file, 'utf8'), bytes);
  assert.equal((await s.putProgress(step(a, { from: 'incoming', to: 'reviewed' }))).transition.actor, ROOT);
});

test('replayed progress and patch requests refuse a missing root agent id like new ones (R671-O1)', async () => {
  const { s, file, answer, receive } = await fresh(); const a = await answer('E-1'); await receive(a);
  await s.putProgress(step(a, { from: 'incoming', to: 'reviewed' })); await s.putPatch(patch(a));
  const bytes = await readFile(file, 'utf8'); const rootless = new ProgressStore(file, verified);
  await assert.rejects(rootless.putProgress(step(a, { from: 'incoming', to: 'reviewed' })), status(503), 'progress replay');
  await assert.rejects(rootless.putPatch(patch(a)), status(503), 'patch replay');
  await assert.rejects(rootless.putProgress({}), status(503), 'the root check comes before input validation');
  assert.equal(await readFile(file, 'utf8'), bytes);
});
