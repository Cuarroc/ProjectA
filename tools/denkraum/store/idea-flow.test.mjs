import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { DeskStore } from '../store.mjs';
const root = { role: 'root', rootAgentId: 'test-root' };
const idea = extra => ({ requestId: 'idea', expectedRevision: null, title: 'T'.repeat(200), text: 'Original', ...extra });
const ref = i => ({ kind: 'idea', ideaId: i.id, ideaRevision: i.revision, eventId: i.eventId });
const status = code => e => e.status === code;
async function fresh(t) {
  const file = join(await mkdtemp(join(tmpdir(), 'idea-flow-')), 'ledger.json');
  const s = new DeskStore(file, root); t.after(() => s.close()); return s;
}
test('DR2 submission stores mode and durable notification atomically', async t => {
  const s = await fresh(t); const i = await s.putIdea(idea({ mode: 'dialog' }));
  assert.deepEqual(i.flow, { version: 1, mode: 'dialog', revision: 0, events: [] });
  await s.close(); const reopened = new DeskStore(s.file, root); t.after(() => reopened.close());
  const state = await reopened.read(); assert.deepEqual(state.ideas[0].revisions[0].flow, i.flow);
  assert.equal(state.ideas[0].revisions[0].webhookDelivery.status, 'pending');
  assert.equal(state.progress[0].currentStatus, 'incoming'); assert.equal(i.title.length, 200);
  assert.deepEqual(await reopened.putIdea(idea({ mode: 'dialog' })), i);
  await assert.rejects(reopened.putIdea(idea({ mode: 'solo' })), status(409));
  await assert.rejects(reopened.putIdea(idea({ mode: 'unknown' })), status(400));
  assert.equal((await reopened.putIdea(idea({ requestId: 'legacy' }))).flow, undefined);
  const before = await readFile(s.file, 'utf8');
  const failing = new DeskStore(s.file, { ...root, rename: async (a, b) => { if (b === s.file) throw Error('interrupted'); return rename(a, b); } });
  t.after(() => failing.close()); await assert.rejects(failing.putIdea(idea({ requestId: 'failed', mode: 'solo' })), /interrupted/);
  assert.equal(await readFile(s.file, 'utf8'), before);
});
test('DR2 flow rejects stale turns and preserves replay', async t => {
  const s = await fresh(t); const i = await s.putIdea(idea({ mode: 'dialog' }));
  assert.equal(typeof s.putIdeaFlow, 'function');
  const command = (command, n, extra = {}) => ({ command, requestId: `${command}-${n}`, ideaRef: ref(i), expectedFlowRevision: n, turnId: 'turn', jobId: 'job', ...extra });
  const send = (c, n, extra) => s.putIdeaFlow(command(c, n, extra), root);
  await assert.rejects(s.putIdeaFlow(command('reserve', 0, { role: 'root' })), status(403));
  await assert.rejects(s.putIdeaFlow(command('reserve', 0), { ...root, rootAgentId: 'other' }), status(403));
  await assert.rejects(send('reserve', 0, { ideaRef: { ...ref(i), ideaId: 'missing' } }), status(404));
  await assert.rejects(send('started', 0, { startProof: 'process observed' }), status(409));
  await assert.rejects(send('reserve', 0, { mode: 'invalid' }), status(400));
  const race = await Promise.allSettled(['a', 'b'].map(requestId => send('reserve', 0, { requestId, mode: 'dialog' })));
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1); assert.equal(race.find(r => r.status === 'rejected').reason.status, 409);
  await assert.rejects(send('reserve', 1), status(409));
  await assert.rejects(send('started', 1), status(400));
  await assert.rejects(send('started', 1, { startProof: 'observed', jobId: 'old' }), status(409));
  const started = await send('started', 1, { startProof: 'process observed' }); assert.equal(started.actor, 'agent');
  await assert.rejects(send('started', 2, { startProof: 'observed' }), status(409));
  const q = await s.putQuestion({ id: 'question', mode: 'free', title: 'Why?', context: 'C', owner: 'O', category: 'K', scope: 'S', source: 'Q', uncertainty: 'U', sourceRef: ref(i), contentOrigin: { actor: 'agent', sourceRefText: 'idea' } });
  const questionRef = { questionId: q.id, questionRevision: q.revision };
  await assert.rejects(send('answered', 2, { answerId: 'missing' }), status(404));
  await assert.rejects(send('asked', 2, { questionRef: { ...questionRef, questionRevision: 2 } }), status(409));
  const asked = await send('asked', 2, { questionRef }); assert.equal(asked.phase, 'awaiting_user');
  await assert.rejects(send('asked', 3, { questionRef }), status(409));
  const answerInput = { questionId: q.id, questionRevision: 1, requestId: 'answer', expectedAnswerId: null, action: 'answer', selected: [], note: 'Free answer' };
  const a = await s.answer(answerInput); const b = await s.answer({ ...answerInput, requestId: 'answer2', expectedAnswerId: a.id });
  await assert.rejects(send('answered', 3, { answerId: a.id }), status(409));
  const answered = await send('answered', 3, { answerId: b.id }); assert.equal(answered.phase, 'elaborating'); assert.equal(answered.text, b.note);
  await assert.rejects(send('answered', 4, { answerId: b.id }), status(409));
  await assert.rejects(send('reserve', 4), status(409));
  await send('reserve', 4, { turnId: 'next', jobId: 'next', mode: 'solo' });
  await send('started', 5, { turnId: 'next', jobId: 'next', startProof: 'observed' });
  await assert.rejects(send('asked', 6, { turnId: 'next', jobId: 'next', questionRef }), status(409));
  const history = (await s.read()).ideas[0].revisions[0];
  await s.putIdea(idea({ id: i.id, expectedRevision: 1, requestId: 'edit', mode: 'dialog' }));
  await s.close(); const restarted = new DeskStore(s.file, root); t.after(() => restarted.close());
  assert.deepEqual(await restarted.putIdeaFlow(command('started', 1, { startProof: 'process observed' }), root), started);
  await assert.rejects(restarted.putIdeaFlow(command('started', 1, { startProof: 'changed' }), root), status(409));
  await assert.rejects(restarted.putIdeaFlow(command('answered', 6, { answerId: b.id }), root), status(409));
  const state = await restarted.read(); assert.deepEqual(state.ideas[0].revisions[0], history);
  assert.deepEqual(state.receipts, []); assert.deepEqual(state.patches, []); assert.ok(state.progress.every(p => p.currentStatus === 'incoming'));
  for (const mutate of [f => { f.version = 2; }, f => { f.events[0].command = 'accepted'; }, f => { f.revision++; }, f => { f.events[1].startProof = ''; }, f => { const e = f.events[3]; e.answerId = 'missing'; e.payload = JSON.stringify({ ...JSON.parse(e.payload), answerId: 'missing' }); }]) {
    const bad = structuredClone(state); mutate(bad.ideas[0].revisions[0].flow); const bytes = JSON.stringify(bad); await writeFile(s.file, bytes);
    await assert.rejects(restarted.read(), status(503)); await assert.rejects(restarted.putIdea(idea({ requestId: 'blocked' })), status(503)); assert.equal(await readFile(s.file, 'utf8'), bytes);
  }
});
test('DR2 flow validates the transition matrix and bounded history', async t => {
  const s = await fresh(t); const i = await s.putIdea(idea({ mode: 'dialog' })); let n = 0;
  const call = (command, extra = {}) => s.putIdeaFlow({ command, requestId: `request-${n}-${command}`, ideaRef: ref(i), expectedFlowRevision: n, turnId: `turn-${Math.floor(n / 4)}`, jobId: `job-${Math.floor(n / 4)}`, ...extra }, root);
  const q = await s.putQuestion({ mode: 'free', title: 'Q'.repeat(4000), context: 'C', owner: 'O', category: 'K', scope: 'S', source: 'Q', uncertainty: 'U', sourceRef: ref(i), contentOrigin: { actor: 'agent', sourceRefText: 'idea' } });
  const questionRef = { questionId: q.id, questionRevision: 1 }; const startProof = 'proof';
  for (const command of ['completed', 'handedOver', 'accepted', 'rejected']) await assert.rejects(call(command), status(400));
  const matrix = [['started', 'asked', 'answered'], ['reserve', 'asked', 'answered'], ['reserve', 'started', 'answered'], ['reserve', 'started', 'asked']];
  for (let turn = 0; turn < 25; turn++) {
    const question = turn === 0 ? q : await s.putQuestion({ ...q, id: `q-${turn}`, expectedRevision: undefined });
    questionRef.questionId = question.id;
    for (const command of ['reserve', 'started', 'asked', 'answered']) {
      const bytes = await readFile(s.file, 'utf8');
      for (const forbidden of matrix[n % 4]) await assert.rejects(call(forbidden, { startProof, questionRef, answerId: 'missing' }), e => [404, 409].includes(e.status));
      assert.equal(await readFile(s.file, 'utf8'), bytes);
      let answerId;
      if (command === 'answered') {
        const input = { questionId: question.id, questionRevision: 1, expectedAnswerId: null, requestId: `a-${turn}`, action: 'answer', selected: [], note: 'A'.repeat(4001) };
        const long = await s.answer(input); await assert.rejects(call(command, { answerId: long.id }), status(400));
        answerId = (await s.answer({ ...input, requestId: `short-${turn}`, expectedAnswerId: long.id, note: 'A'.repeat(4000) })).id;
      }
      await call(command, { startProof, questionRef, answerId }); n++;
    }
  }
  assert.equal((await s.read()).ideas[0].revisions[0].flow.events.length, 100);
  await assert.rejects(call('reserve'), status(409));
  const bytes = await readFile(s.file, 'utf8'); await assert.rejects(call('reserve', { expectedFlowRevision: -1 }), status(400)); assert.equal(await readFile(s.file, 'utf8'), bytes);
  const legacy = await fresh(t); await writeFile(legacy.file, JSON.stringify({ schemaVersion: 1, revision: 0, questions: [], answers: [], unknown: { kept: true } }));
  await legacy.migrate(0); assert.deepEqual((await legacy.read()).unknown, { kept: true }); assert.deepEqual((await legacy.read()).ideas, []);
});
test('DR2 returned flow events cannot poison later transactions', async t => {
  const s = await fresh(t); const i = await s.putIdea(idea({ mode: 'dialog' }));
  const input = { command: 'reserve', requestId: 'reserve', ideaRef: ref(i), expectedFlowRevision: 0, turnId: 'turn', jobId: 'job' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const event = await s.putIdeaFlow(input, root);
    assert.notEqual(event, (await s.read()).ideas[0].revisions[0].flow.events[0]);
    event.command = 'corrupt'; event.ideaRef.ideaId = 'corrupt';
    assert.equal((await s.read()).ideas[0].revisions[0].flow.events[0].command, 'reserve');
  }
  await s.putIdea(idea({ requestId: 'other' }));
  await s.putIdeaFlow({ ...input, command: 'started', requestId: 'started', expectedFlowRevision: 1, startProof: 'observed' }, root);
  await s.close(); const reopened = new DeskStore(s.file, root); t.after(() => reopened.close());
  assert.equal((await reopened.read()).ideas[0].revisions[0].flow.events.length, 2);
});
test('DR2 asked accepts deferred or clarified questions but rejects answers', async t => {
  for (const action of ['defer', 'clarify', 'answer']) {
    const s = await fresh(t); const i = await s.putIdea(idea({ mode: 'dialog' }));
    const q = await s.putQuestion({ id: 'question', mode: 'free', title: 'Why?', context: 'C', owner: 'O', category: 'K', scope: 'S', source: 'Q', uncertainty: 'U', sourceRef: ref(i), contentOrigin: { actor: 'agent', sourceRefText: 'idea' } });
    await s.answer({ questionId: q.id, questionRevision: 1, requestId: 'answer', expectedAnswerId: null, action, selected: [], note: 'Note' });
    const input = { ideaRef: ref(i), turnId: 'turn', jobId: 'job' };
    await s.putIdeaFlow({ ...input, command: 'reserve', requestId: 'reserve', expectedFlowRevision: 0 }, root);
    await s.putIdeaFlow({ ...input, command: 'started', requestId: 'started', expectedFlowRevision: 1, startProof: 'observed' }, root);
    const asked = s.putIdeaFlow({ ...input, command: 'asked', requestId: 'asked', expectedFlowRevision: 2, questionRef: { questionId: q.id, questionRevision: 1 } }, root);
    if (action === 'answer') await assert.rejects(asked, status(409));
    else assert.equal((await asked).phase, 'awaiting_user');
  }
});
test('DR2 corrupt flow retains its diagnostic cause', async t => {
  const s = await fresh(t); await s.putIdea(idea({ mode: 'dialog' }));
  const state = await s.read(); state.ideas[0].revisions[0].flow.version = 2;
  await writeFile(s.file, JSON.stringify(state));
  await assert.rejects(s.read(), e => e.status === 503 && e.cause?.message === 'Ungültige Ablaufversion/-revision.');
});
test('DR2 flow loads through either module entry order', () => {
  for (const entry of ['model', 'idea-flow']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      await import('./tools/denkraum/store/${entry}.mjs');
      const { newIdeaFlow, validateIdeaFlow } = await import('./tools/denkraum/store/idea-flow.mjs');
      if (validateIdeaFlow(newIdeaFlow('dialog'), {}, { answers: [] }).phase !== 'submitted') throw Error('invalid phase');
    `], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});
