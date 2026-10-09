import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as store from './store.mjs';

async function fixture() {
  const file = join(await mkdtemp(join(tmpdir(), 'desk-priority-')), 'state.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 1, revision: 0, questions: [], answers: [] }));
  const s = new store.DeskStore(file); await s.migrate(0);
  const idea = await s.putIdea({ requestId: 'idea', expectedRevision: null, title: 'Idea', text: 'Observed idea' });
  const ref = { kind: 'idea', eventId: idea.eventId, ideaId: idea.id, ideaRevision: 1 };
  const input = { id: 'question', mode: 'free', title: 'Question', context: 'Context', owner: 'Interview', category: 'Follow-up', scope: 'Scope', source: 'Idea', uncertainty: 'Unknown',
    sourceRef: ref, contentOrigin: { actor: 'Interview', sourceRefText: 'Saved revision' }, priority: 'blocking' };
  const detail = { blockingDependencies: ['package-dependent'], blockerEvidenceRefs: ['observed-blocker'], criticality: 'high', impact: 'medium', reason: 'Dependency actually awaits this decision', sourceRefs: [ref] };
  const recommendationDetail = { observation: { statement: 'Dependent package failed its prerequisite check', evidenceRefs: ['observed-blocker'], observedAt: '2026-10-06T20:00:00.000Z' },
    hypothesis: 'Answer may resolve dependency', consequences: 'Dependent work can continue', reversibility: 'Question remains historical', patchWindowText: null, authorityRefs: [] };
  return { s, idea, ref, input, detail, recommendationDetail };
}

test('B3 priority import persists canonical detail and CAS revisions without changing authority or answer snapshots', async () => {
  const { s, input, detail, recommendationDetail } = await fixture();
  const q = await s.putQuestion({ ...input, priorityDetail: detail, recommendationDetail, requestId: 'import' });
  assert.deepEqual(q.priorityDetail, detail);
  const answer = await s.answer({ questionId: q.id, questionRevision: 1, requestId: 'answer', expectedAnswerId: null, action: 'answer', selected: [], note: 'Content is not permission' });
  const before = await s.read();
  const updated = await s.putQuestion({ ...input, priorityDetail: { ...detail, impact: 'high' }, expectedRevision: 1, requestId: 'update' });
  assert.equal(updated.revision, 2); assert.equal(updated.createdAt, q.createdAt);
  assert.deepEqual((await s.read()).answers[0], answer); assert.deepEqual((await s.read()).patches, before.patches); assert.deepEqual((await s.read()).receipts, []);
  const bytes = await readFile(s.file, 'utf8');
  assert.deepEqual(await s.putQuestion({ ...input, priorityDetail: detail, recommendationDetail, requestId: 'import' }), q);
  await assert.rejects(s.putQuestion({ ...input, priorityDetail: { ...detail, impact: 'low' }, recommendationDetail, requestId: 'import' }), e => e.status === 409);
  assert.equal(await readFile(s.file, 'utf8'), bytes);
});

test('B3 projection separates observed blockers from labels and unsupported ordinal claims', async () => {
  const { s, input, detail, recommendationDetail } = await fixture();
  const q = await s.putQuestion({ ...input, priorityDetail: detail, recommendationDetail }); const state = await s.read();
  assert.equal(store.projectQuestionPriority(state, q).actualBlocker, true);
  assert.equal(store.projectQuestionPriority(state, q).criticality, 'high');
  for (const patch of [{ reason: '' }, { sourceRefs: [] }]) {
    const p = store.projectQuestionPriority(state, { ...q, priorityDetail: { ...detail, ...patch } });
    assert.equal(p.actualBlocker, false); assert.equal(p.criticality, 'unclassified'); assert.equal(p.impact, 'unclassified');
  }
  assert.equal(store.projectQuestionPriority(state, { ...q, priorityDetail: undefined }).actualBlocker, false);
  for (const patch of [{ blockingDependencies: [] }, { blockerEvidenceRefs: ['opaque-reference'] }])
    assert.equal(store.projectQuestionPriority(state, { ...q, priorityDetail: { ...detail, ...patch } }).actualBlocker, false);
  assert.equal(store.projectQuestionPriority(state, { ...q, recommendationDetail: { ...recommendationDetail, observation: { ...recommendationDetail.observation, observedAt: null } } }).actualBlocker, false);
});

test('B3 stable comparator uses blocker criticality impact creation and ID and never input order or activity', async () => {
  const { s, input, detail, recommendationDetail } = await fixture(); const q = await s.putQuestion({ ...input, priorityDetail: detail, recommendationDetail });
  const state = await s.read();
  const rows = [
    { ...q, id: 'blocker', priorityDetail: { ...detail, criticality: 'low', impact: 'low' } },
    { ...q, id: 'high', priorityDetail: { ...detail, blockingDependencies: [], criticality: 'high', impact: 'low' } },
    { ...q, id: 'impact', priorityDetail: { ...detail, blockingDependencies: [], criticality: 'medium', impact: 'high' } },
    { ...q, id: 'medium', priorityDetail: { ...detail, blockingDependencies: [], criticality: 'medium', impact: 'medium' } },
    { ...q, id: 'z', priorityDetail: undefined, createdAt: '2026-10-06T10:00:00.000Z', activity: 999 },
    { ...q, id: 'a', priorityDetail: undefined, createdAt: '2026-10-06T10:00:00.000Z' },
    { ...q, id: 'old', priorityDetail: undefined, createdAt: '2026-10-05T10:00:00.000Z' }
  ]; state.questions = rows;
  const ordered = list => list.sort((a, b) => store.compareQuestions(state, a, b)).map(q => q.id);
  assert.deepEqual(ordered([...rows].reverse()), ['blocker', 'high', 'impact', 'medium', 'old', 'a', 'z']);
  assert.deepEqual(ordered([...rows]), ordered([...rows].reverse()));
});

test('B3 stale question or source classification becomes unknown and new imports reject mismatched source refs atomically', async () => {
  const { s, idea, input, detail, recommendationDetail } = await fixture(); const q = await s.putQuestion({ ...input, priorityDetail: detail, recommendationDetail });
  const wrong = { ...detail, sourceRefs: [{ ...input.sourceRef, eventId: 'wrong-event' }] }; const before = await readFile(s.file, 'utf8');
  await assert.rejects(s.putQuestion({ ...input, priorityDetail: wrong, expectedRevision: 1 }), e => e.status === 409);
  assert.equal(await readFile(s.file, 'utf8'), before);
  assert.equal(store.projectQuestionPriority(await s.read(), { ...q, revision: 0 }).criticality, 'unclassified');
  await s.putIdea({ id: idea.id, expectedRevision: 1, requestId: 'edit', title: 'Edited', text: 'Edited' });
  const p = store.projectQuestionPriority(await s.read(), q); assert.equal(p.current, false); assert.equal(p.actualBlocker, false); assert.equal(p.impact, 'unclassified');
  await assert.rejects(s.putQuestion({ ...input, priorityDetail: detail, expectedRevision: 1 }), e => e.status === 409);
});

test('B3 malformed detail rejects at import and persisted questions or replay results fail closed without writes', async () => {
  const { s, input, detail } = await fixture();
  for (const patch of [{ criticality: 'urgent' }, { sourceRefs: [null] }, { blockerEvidenceRefs: 'proof' }, { blockingDependencies: [' '] }, { reason: 4 }, { sourceRefs: null }])
    await assert.rejects(s.putQuestion({ ...input, priorityDetail: { ...detail, ...patch } }), e => e.status === 400);
  await s.putQuestion({ ...input, priorityDetail: detail, requestId: 'import' });
  const original = await s.read();
  for (const target of ['question', 'replay']) {
    const state = structuredClone(original); const q = target === 'question' ? state.questions[0] : state.questionImports[0].result;
    q.priorityDetail.sourceRefs = [null]; const bytes = JSON.stringify(state); await writeFile(s.file, bytes);
    await assert.rejects(s.read(), e => e.status === 503); assert.equal(await readFile(s.file, 'utf8'), bytes);
  }
});

test('B3 incomplete classification stays unknown and observed implementation evidence binds only its current event', async () => {
  const { s, input, detail } = await fixture(); const q = await s.putQuestion({ ...input, priorityDetail: { criticality: 'high' } });
  const state = await s.read(); const bytes = await readFile(s.file, 'utf8');
  const unknown = store.projectQuestionPriority(state, q); assert.equal(unknown.criticality, 'unclassified'); assert.equal(unknown.actualBlocker, false);
  const updated = await s.putQuestion({ ...input, priorityDetail: detail, expectedRevision: 1 });
  const current = await s.read(); const p = current.progress.find(p => p.eventId === input.sourceRef.eventId);
  const evidence = { id: 'observed-blocker', eventId: p.eventId, observedAt: '2026-10-06T20:00:00.000Z', artifactRef: 'test-output', check: 'Dependency check', observedResult: 'Dependent work blocked', actor: 'Root' };
  p.history[0].implementationEvidence = evidence;
  assert.equal(store.projectQuestionPriority(current, updated).actualBlocker, true);
  p.history[0].implementationEvidence = { ...evidence, eventId: 'different-event' };
  assert.equal(store.projectQuestionPriority(current, updated).actualBlocker, false);
  const legacy = { ...q, priorityDetail: undefined, createdAt: undefined }; current.questions.push({ ...legacy, id: 'legacy' });
  assert.equal(store.projectQuestionPriority(current, legacy).criticality, 'unclassified');
  assert.equal(store.compareQuestions(current, { ...legacy, id: 'a' }, { ...legacy, id: 'z' }), -1);
  assert.notEqual(await readFile(s.file, 'utf8'), bytes); const committed = await readFile(s.file, 'utf8');
  store.projectQuestionPriority(await s.read(), updated); assert.equal(await readFile(s.file, 'utf8'), committed);
});
