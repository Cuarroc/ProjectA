import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { DeskStore } from './store.mjs';
import { createDeskServer } from './server.mjs';
import { runCli } from './cli.mjs';
const ROOT = 'test-root-agent'; // D2: synthetic root id, injected (no real id in public tests)

const base = { id: 'question', title: 'What matters?', context: 'Observed idea', owner: 'Interview', category: 'follow-up',
  scope: 'Existing authorized scope', source: 'Saved idea', uncertainty: 'Unknown', priority: 'normal' };
const detail = { observation: { statement: 'Not yet observed', evidenceRefs: [], observedAt: null }, hypothesis: 'A testable hypothesis',
  consequences: 'Possible consequence', reversibility: 'Reversible', patchWindowText: null, authorityRefs: [] };
async function fixture() {
  const file = join(await mkdtemp(join(tmpdir(), 'desk-import-')), 'state.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 1, revision: 0, questions: [], answers: [], unknown: { keep: true } }));
  const s = new DeskStore(file, { rootAgentId: ROOT }); await s.migrate(0); const idea = await s.putIdea({ requestId: 'idea', expectedRevision: null, title: 'Idea', text: 'Free user content' });
  const sourceRef = { kind: 'idea', eventId: idea.eventId, ideaId: idea.id, ideaRevision: 1 };
  return { s, idea, input: { ...base, mode: 'free', sourceRef, contentOrigin: { actor: 'Interview', sourceRefText: 'Saved revision' }, recommendationDetail: detail } };
}

test('B1 free import needs no choices and preserves exact origin and honest recommendation without authority', async () => {
  const { s, input } = await fixture(); const before = await s.read(); const q = await s.putQuestion(input);
  assert.equal(q.mode, 'free'); assert.deepEqual(q.sourceRef, input.sourceRef); assert.deepEqual(q.contentOrigin, input.contentOrigin);
  assert.deepEqual(q.recommendationDetail, detail); assert.equal(q.recommendationDetail.observation.observedAt, null); assert.equal(q.recommendationDetail.patchWindowText, null);
  const state = await new DeskStore(s.file, { rootAgentId: ROOT }).read(); assert.deepEqual(state.receipts, before.receipts); assert.deepEqual(state.progress, before.progress); assert.deepEqual(state.patches, []);
  assert.deepEqual(state.unknown, { keep: true });
  const { id, ...newQuestion } = input; const generated = await s.putQuestion(newQuestion); assert.match(generated.id, /^[a-f0-9-]{36}$/);
});

test('B1 semantic revisions preserve legacy snapshots and unknown fields without silently following an idea edit', async () => {
  const { s, idea, input } = await fixture(); const legacy = { ...base, mode: 'single', recommendation: { optionIds: ['a'], rationale: 'Legacy' },
    options: ['a', 'b'].map(id => ({ id, label: id, rationale: 'Old', impact: 'Old', tradeoff: 'Old', effort: 'Old', reversible: 'Old' })) };
  await s.putQuestion(legacy); await s.answer({ questionId: base.id, questionRevision: 1, requestId: 'legacy-answer', expectedAnswerId: null, action: 'answer', selected: ['a'], note: '' });
  const state = await s.read(); state.questions[0].unknownQuestionField = 'retain'; await writeFile(s.file, JSON.stringify(state)); const oldAnswer = structuredClone(state.answers[0]);
  const updated = await s.putQuestion({ ...input, expectedRevision: 1 }); assert.equal(updated.revision, 2); assert.equal(updated.unknownQuestionField, 'retain');
  assert.deepEqual((await s.read()).answers[0], oldAnswer);
  await s.putIdea({ id: idea.id, expectedRevision: 1, requestId: 'edit-idea', title: 'New', text: 'New semantic content' });
  assert.deepEqual((await s.read()).questions[0].sourceRef, input.sourceRef);
  await assert.rejects(s.putQuestion({ ...input, expectedRevision: 2 }), e => e.status === 409);
  const latest = (await s.read()).ideas[0].revisions.at(-1);
  const revised = await s.putQuestion({ ...input, expectedRevision: 2, sourceRef: { ...input.sourceRef, eventId: latest.eventId, ideaRevision: latest.revision }, recommendationDetail: { ...detail, hypothesis: 'Changed hypothesis' } });
  assert.equal(revised.revision, 3); assert.deepEqual((await s.read()).answers[0], oldAnswer);
});

test('B1 malformed provenance and recommendation fail with unchanged bytes; unknown or mismatched revisions reject', async () => {
  const { s, input } = await fixture(); const before = await readFile(s.file, 'utf8');
  for (const patch of [{ sourceRef: null }, { sourceRef: { ...input.sourceRef, ideaRevision: '1' } }, { contentOrigin: [] },
    { recommendationDetail: { ...detail, observation: { ...detail.observation, observedAt: 'yesterday' } } },
    { recommendationDetail: { ...detail, authorityRefs: [null] } }, { recommendationDetail: { ...detail, patchWindowText: 1800 } }])
    await assert.rejects(s.putQuestion({ ...input, ...patch }), e => e.status === 400);
  await assert.rejects(s.putQuestion({ ...input, sourceRef: { ...input.sourceRef, ideaId: 'missing' } }), e => e.status === 404);
  await assert.rejects(s.putQuestion({ ...input, sourceRef: { ...input.sourceRef, eventId: 'different-event' } }), e => e.status === 409);
  assert.equal(await readFile(s.file, 'utf8'), before);
  const broken = new DeskStore(s.file, { rootAgentId: ROOT, rename: async (from, to) => { if (to === s.file) throw new Error('import interrupted'); return rename(from, to); } });
  await assert.rejects(broken.putQuestion(input), /import interrupted/); assert.equal(await readFile(s.file, 'utf8'), before);
});

test('B1 existing question API and CLI import carry new fields without sockets or new service', async () => {
  const { s, input } = await fixture(); const server = createDeskServer({ rootAgentId: ROOT, statePath: s.file, rootReceiptToken: '' });
  const req = Readable.from([Buffer.from(JSON.stringify(input))]); Object.assign(req, { method: 'POST', url: '/api/questions',
    headers: { host: '127.0.0.1:4791', 'content-type': 'application/json', 'x-decision-desk': 'agent' } });
  const saved = await new Promise(resolve => server.emit('request', req, { socket: { localPort: 4791 }, setHeader() {}, writeHead(status) { this.status = status; },
    end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } })); assert.equal(saved.status, 200);
  const file = join(s.file, '..', 'question.json'); await writeFile(file, JSON.stringify(input)); let sent;
  await runCli(['question', file], {}, async (url, options) => { sent = { url: String(url), options }; return { ok: true, json: async () => saved.body }; });
  assert.equal(sent.url, 'http://127.0.0.1:4791/api/questions'); assert.deepEqual(JSON.parse(sent.options.body), input); assert.equal(sent.options.redirect, 'error');
});
test('B1 explicitly rebound source never inherits an omitted old recommendation and corrupt import metadata fails closed', async () => {
  const { s, input, idea } = await fixture(); await s.putQuestion(input);
  const newer = await s.putIdea({ id: idea.id, expectedRevision: 1, requestId: 'new-source', title: 'New', text: 'New content' });
  const { recommendationDetail, ...question } = input;
  const next = await s.putQuestion({ ...question, expectedRevision: 1, sourceRef: { kind: 'idea', eventId: newer.eventId, ideaId: newer.id, ideaRevision: 2 } });
  assert.equal(next.recommendationDetail, undefined); assert.equal(next.sourceRef.eventId, newer.eventId);
  const state = await s.read(); state.questions[0].contentOrigin = null; const bytes = JSON.stringify(state); await writeFile(s.file, bytes);
  await assert.rejects(s.read(), e => e.status === 503); assert.equal(await readFile(s.file, 'utf8'), bytes);
});
