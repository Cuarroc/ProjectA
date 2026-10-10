import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadStartConfig } from '../config.mjs';
import { DeskError, DeskStore } from '../store.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-path-security-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function snapshot(dir) {
  const entries = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort();
  const files = [];
  for (const file of entries) files.push([file, await readFile(file)]);
  return { entries: (await readdir(dir, { recursive: true })).sort(), files };
}
const option = id => ({ id, label: id, rationale: 'r', impact: 'i', tradeoff: 't', effort: 'e', reversible: 'yes' });
const question = { id: 'question-1', requestId: 'import-1', title: 'Title', context: 'Context', owner: 'Owner',
  category: 'Category', scope: 'Scope', source: 'Source', uncertainty: 'Unknown', options: [option('a'), option('b')],
  recommendation: { optionIds: ['a'], rationale: 'Reason' } };
const configFor = (repoRoot, state) => loadStartConfig({ DECISION_DESK_STATE: state,
  DECISION_DESK_ROOT_AGENT_ID: 'test-root', DECISION_DESK_ROOT_RECEIPT_TOKEN: randomBytes(24).toString('hex'),
  DECISION_DESK_WEBHOOK_SECRET: randomBytes(24).toString('hex') }, { repoRoot });

test('DRSEC: config rejects physical repository aliases', {
  skip: process.platform === 'win32' ? 'POSIX symlink fixture; Windows requires separate junction/ACL coverage' : false,
}, async t => {
  const dir = await fixture(t); const repoRoot = join(dir, 'repo');
  await mkdir(repoRoot); await writeFile(join(repoRoot, 'ledger.json'), 'repository sentinel');
  try {
    await symlink(repoRoot, join(dir, 'alias'));
    await symlink(join(repoRoot, 'ledger.json'), join(dir, 'leaf.json'));
  } catch (e) {
    if (e.code === 'EPERM') return t.skip('symlinks need extra rights on this machine');
    throw e;
  }
  for (const [name, state] of [['leaf', join(dir, 'leaf.json')], ['directory', join(dir, 'alias', 'ledger.json')],
    ['missing descendant', join(dir, 'alias', 'missing', 'ledger.json')]]) {
    await t.test(name, () => assert.equal(configFor(repoRoot, state).ok, false, 'physical repository alias accepted'));
  }
});

test('DRSEC: traversal identifiers cannot select files or mutate the ledger', async t => {
  const dir = await fixture(t); const ledgerDir = join(dir, 'state');
  await mkdir(ledgerDir); await writeFile(join(dir, 'sentinel'), 'untouched sibling');
  let writes = 0;
  const store = new DeskStore(join(ledgerDir, 'ledger.json'), { rootAgentId: 'test-root',
    writeFile: async (...args) => { writes++; return writeFile(...args); },
    verifyReceipt: async request => ({ ...request, rootAgentId: 'test-root',
      rootAcknowledgedAt: '2026-01-01T00:00:00.000Z', observedProof: 'synthetic proof' }) });
  assert.equal((await store.putQuestion(question)).id, question.id);
  await store.migrate((await store.read()).revision);
  const ideaInput = { requestId: 'idea-1', expectedRevision: null, title: 'Idea', text: 'Text' };
  const idea = await store.putIdea(ideaInput);
  const answerInput = { questionId: question.id, questionRevision: 1, requestId: 'answer-1',
    expectedAnswerId: null, action: 'answer', selected: ['a'], note: '' };
  const answer = await store.answer(answerInput);
  const eventRef = { kind: 'answer', eventId: answer.id, questionId: question.id, questionRevision: 1 };
  const receipt = { receiptId: 'receipt-1', eventRef, transportMessageId: 'message-1', rootReplyId: 'reply-1' };
  const invalidIds = ['../sentinel', '..\\sentinel', 'nested/sentinel', 'nested\\sentinel', '..',
    join(dir, 'sentinel'), 'C:\\sentinel', '%2e%2e%2fsentinel', '%2E%2E%5Csentinel', '%252e%252e%252fsentinel'];
  const cases = [
    ['question.id', id => store.putQuestion({ ...question, id, requestId: 'import-2' })],
    ['question.requestId', requestId => store.putQuestion({ ...question, expectedRevision: 1, requestId })],
    ['idea.id', id => store.putIdea({ ...ideaInput, id, expectedRevision: 1, requestId: 'idea-2' })],
    ['idea.requestId', requestId => store.putIdea({ ...ideaInput, requestId })],
    ['answer.questionId', questionId => store.answer({ ...answerInput, questionId })],
    ['answer.requestId', requestId => store.answer({ ...answerInput, requestId })],
    ['receipt.eventId', eventId => store.receipt({ ...receipt, eventRef: { ...eventRef, eventId } })],
    ['receipt.questionId', questionId => store.receipt({ ...receipt, eventRef: { ...eventRef, questionId } })],
    ['receipt.ideaId', ideaId => store.receipt({ ...receipt,
      eventRef: { kind: 'idea', eventId: idea.eventId, ideaId, ideaRevision: 1 } })],
  ];
  const before = await snapshot(dir); writes = 0;
  for (const [field, invoke] of cases) for (const id of invalidIds) {
    await assert.rejects(async () => invoke(id), e => e instanceof DeskError && e.status === 400, `${field}: ${id}`);
    assert.equal(writes, 0, `${field}: rejected input reached writeFile`);
    assert.deepEqual(await snapshot(dir), before, `${field}: rejected input changed files`);
  }
  assert.equal((await store.receipt(receipt)).eventRef.eventId, answer.id);
  assert.equal((await store.putIdea({ ...ideaInput, id: idea.id, expectedRevision: 1, requestId: 'idea-2' })).revision, 2);
  assert.equal(await readFile(join(dir, 'sentinel'), 'utf8'), 'untouched sibling');
});

test('DRSEC: config rejects lexical repository paths without changing files', async t => {
  const dir = await fixture(t); const repoRoot = join(dir, 'repo');
  await mkdir(repoRoot); await writeFile(join(repoRoot, 'sentinel'), 'repository fixture');
  const before = await snapshot(dir);
  for (const state of [repoRoot, join(repoRoot, 'ledger.json'), join(repoRoot, 'missing', 'ledger.json')]) {
    const result = configFor(repoRoot, state);
    assert.equal(result.ok, false); assert.equal(result.config, null);
    assert.deepEqual(result.errors.map(e => e.name), ['DECISION_DESK_STATE']);
  }
  assert.equal(configFor(repoRoot, join(dir, 'repo-sibling', 'ledger.json')).ok, true);
  assert.deepEqual(await snapshot(dir), before);
});

test('DRSEC: config accepts a symlink alias whose ledger stays outside the repository', {
  skip: process.platform === 'win32' ? 'POSIX symlink fixture; Windows requires separate junction/ACL coverage' : false,
}, async t => {
  const dir = await fixture(t); const repoRoot = join(dir, 'repo'); const external = join(dir, 'external');
  await mkdir(repoRoot); await mkdir(external);
  await writeFile(join(external, 'ledger.json'), 'external sentinel');
  try { await symlink(external, join(dir, 'alias')); }
  catch (e) { if (e.code === 'EPERM') return t.skip('symlinks need extra rights on this machine'); throw e; }
  const before = await snapshot(dir);
  for (const state of [join(external, 'ledger.json'), join(dir, 'alias', 'ledger.json')]) {
    const result = configFor(repoRoot, state);
    assert.equal(result.ok, true); assert.equal(result.config.statePath, state); assert.deepEqual(result.errors, []);
  }
  assert.deepEqual(await snapshot(dir), before);
});
