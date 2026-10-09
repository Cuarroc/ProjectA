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
  const file = join(await mkdtemp(join(tmpdir(), 'desk-free-')), 'state.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 1, revision: 0, questions: [], answers: [], unknown: 'preserved' }));
  const s = new DeskStore(file, { rootAgentId: ROOT }); await s.migrate(0); const idea = await s.putIdea({ requestId: 'idea', expectedRevision: null, title: 'Idea', text: 'User idea' });
  const question = { id: 'free-question', mode: 'free', title: 'Why?', context: 'Observed', owner: 'Interview', category: 'follow-up', scope: 'Existing', source: 'Saved idea', uncertainty: 'Unknown',
    sourceRef: { kind: 'idea', eventId: idea.eventId, ideaId: idea.id, ideaRevision: 1 }, contentOrigin: { actor: 'Interview', sourceRefText: 'Actual revision' } };
  const q = await s.putQuestion(question);
  const answer = { questionId: q.id, questionRevision: 1, expectedAnswerId: null, requestId: 'free-answer', action: 'answer', selected: [], note: 'Install/delete text is not permission.' };
  return { s, idea, question, q, answer };
}
const edit = (s, idea) => s.putIdea({ id: idea.id, expectedRevision: 1, requestId: 'edited-idea', title: 'Changed', text: 'Changed source' });

test('B2 free text answer preserves snapshots and incoming while whitespace choices and malformed inputs reject', async () => {
  const { s, q, answer } = await fixture();
  for (const patch of [{ note: ' ' }, { selected: ['a'] }, { note: null }]) await assert.rejects(s.answer({ ...answer, ...patch }), e => e.status === 400);
  const a = await s.answer(answer); const state = await s.read(); assert.deepEqual(a.question, q); assert.equal(a.note, answer.note); assert.deepEqual(a.selected, []);
  assert.equal(state.progress.find(p => p.eventId === a.id).currentStatus, 'incoming'); assert.deepEqual(state.receipts, []); assert.deepEqual(state.patches, []);
  const bytes = await readFile(s.file, 'utf8'); assert.deepEqual(await new DeskStore(s.file, { rootAgentId: ROOT }).answer(answer), a); assert.equal(await readFile(s.file, 'utf8'), bytes);
  await s.answer({ ...answer, expectedAnswerId: a.id, requestId: 'defer', action: 'defer', note: '' });
  await s.answer({ ...answer, expectedAnswerId: (await s.read()).answers.at(-1).id, requestId: 'clarify', action: 'clarify', note: 'Clarification?' });
});

test('B2 source races atomically reject new answers and imports; old answer replay survives supersession without requeue', async () => {
  const { s, idea, question, answer } = await fixture(); const a = await s.answer(answer); const beforeAnswer = structuredClone(a);
  await edit(s, idea); const before = await readFile(s.file, 'utf8');
  await assert.rejects(s.answer({ ...answer, requestId: 'new-answer', expectedAnswerId: a.id }), e => e.status === 409);
  await assert.rejects(s.putQuestion({ ...question, expectedRevision: 1, requestId: 'stale-import' }), e => e.status === 409);
  await assert.rejects(s.ack({ answerId: a.id, status: 'received', receipt: {} }), e => e.status === 409);
  assert.deepEqual(await s.answer(answer), beforeAnswer); assert.equal(await readFile(s.file, 'utf8'), before);
  assert.deepEqual(await s.pending(), []); assert.equal((await s.inbox()).pending.some(e => e.eventRef.eventId === a.id), false);
  const { s: racing, idea: racingIdea, answer: racingAnswer } = await fixture();
  const results = await Promise.allSettled([edit(racing, racingIdea), racing.answer(racingAnswer)]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].reason.status, 409);
});

test('B2 import canonical request replay keeps server IDs and historical outcomes without writes after restart and edits', async () => {
  const { s, idea, question } = await fixture(); const { id, ...free } = question; const input = { ...free, requestId: 'import-request' };
  const original = await s.putQuestion(input); const replay = await s.putQuestion(Object.fromEntries(Object.entries(input).reverse())); assert.deepEqual(replay, original);
  await s.putQuestion({ ...question, expectedRevision: 1, requestId: 'changed-question', title: 'Different question' }); await edit(s, idea);
  const before = await readFile(s.file, 'utf8'); assert.deepEqual(await new DeskStore(s.file, { rootAgentId: ROOT }).putQuestion(input), original);
  await assert.rejects(s.putQuestion({ ...input, title: 'Changed payload' }), e => e.status === 409);
  assert.equal(await readFile(s.file, 'utf8'), before); assert.equal((await s.read()).unknown, 'preserved');
});

test('B2 import competing requests recover from atomic failures and corrupt replay ledger fails closed', async () => {
  const { s, question } = await fixture(); const input = { ...question, expectedRevision: 1, requestId: 'update-request', title: 'Updated' };
  const before = await readFile(s.file, 'utf8'); const interrupted = new DeskStore(s.file, { rootAgentId: ROOT, rename: async (from, to) => { if (to === s.file) throw new Error('import interrupted'); return rename(from, to); } });
  await assert.rejects(interrupted.putQuestion(input), /import interrupted/); assert.equal(await readFile(s.file, 'utf8'), before);
  const results = await Promise.allSettled([s.putQuestion(input), s.putQuestion(input)]); assert.equal(results[0].status, 'fulfilled'); assert.deepEqual(results[0].value, results[1].value);
  const committed = await readFile(s.file, 'utf8'); await new DeskStore(s.file, { rootAgentId: ROOT }).putQuestion(input); assert.equal(await readFile(s.file, 'utf8'), committed);
  const state = await s.read(); state.questionImports = [null]; const corrupt = JSON.stringify(state); await writeFile(s.file, corrupt);
  await assert.rejects(s.read(), e => e.status === 503); assert.equal(await readFile(s.file, 'utf8'), corrupt);
});
test('B2 malformed persisted import result fails closed and unknown idea source returns 404 without writes', async () => {
  const { s, question, answer } = await fixture(); await s.putQuestion({ ...question, expectedRevision: 1, requestId: 'known-import' });
  const state = await s.read(); state.questionImports[0].result.mode = 'unknown'; const corrupt = JSON.stringify(state); await writeFile(s.file, corrupt);
  await assert.rejects(s.read(), e => e.status === 503); assert.equal(await readFile(s.file, 'utf8'), corrupt);
  const next = await fixture(); const lostSource = await next.s.read(); lostSource.ideas = []; const bytes = JSON.stringify(lostSource); await writeFile(next.s.file, bytes);
  await assert.rejects(next.s.answer(next.answer), e => e.status === 404); assert.equal(await readFile(next.s.file, 'utf8'), bytes);
});

test('B2 existing API and CLI import replay and free answer persist without sockets or automatic idea edits', async () => {
  const { s, question } = await fixture(); const server = createDeskServer({ rootAgentId: ROOT, statePath: s.file, rootReceiptToken: '' });
  const call = (url, input) => { const req = Readable.from([Buffer.from(JSON.stringify(input))]);
    Object.assign(req, { method: 'POST', url, headers: { host: '127.0.0.1:4791', 'x-decision-desk': 'agent', 'content-type': 'application/json' } });
    return new Promise(resolve => server.emit('request', req, { socket: { localPort: 4791 }, setHeader() {}, writeHead(status) { this.status = status; },
      end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } })); };
  const input = { ...question, expectedRevision: 1, requestId: 'api-import' }; const first = await call('/api/questions', input); assert.equal(first.status, 200);
  const bytes = await readFile(s.file, 'utf8'); assert.deepEqual(await call('/api/questions', input), first); assert.equal(await readFile(s.file, 'utf8'), bytes);
  const ideas = structuredClone((await s.read()).ideas); const a = await call('/api/answers', { questionId: question.id, questionRevision: 2,
    requestId: 'api-answer', expectedAnswerId: null, action: 'answer', selected: [], note: 'Actual free text' });
  assert.equal(a.status, 200); assert.equal(a.body.note, 'Actual free text'); assert.deepEqual((await s.read()).ideas, ideas);
  const file = join(s.file, '..', 'import.json'); await writeFile(file, JSON.stringify(input)); let sent;
  await runCli(['question', file], {}, async (url, options) => { sent = { url: String(url), options }; return { ok: true, json: async () => first.body }; });
  assert.equal(sent.url, 'http://127.0.0.1:4791/api/questions'); assert.deepEqual(JSON.parse(sent.options.body), input); assert.equal(sent.options.redirect, 'error');
});
