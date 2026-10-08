import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DeskStore } from './store.mjs';
import { createDeskServer } from './server.mjs';
const ROOT = 'test-root-agent'; // D2: synthetic root id, injected (no real id in public tests)

const token = 'test-only-root-authority-not-a-real-secret';
const question = { id: 'api-question', title: 'Test', context: 'Test', owner: 'Test', category: 'Test',
  scope: 'Test', source: 'Test', uncertainty: 'Test', recommendation: { optionIds: ['a'], rationale: 'Test' },
  options: ['a', 'b'].map(id => ({ id, label: id, rationale: 'Test', impact: 'Test', tradeoff: 'Test', effort: 'Test', reversible: 'Test' })) };
async function fixture(rootReceiptToken = token) {
  const dir = await mkdtemp(join(tmpdir(), 'desk-api-')); const statePath = join(dir, 'state.json');
  const store = new DeskStore(statePath, { rootAgentId: ROOT }); await store.putQuestion(question);
  const a = await store.answer({ questionId: question.id, questionRevision: 1, requestId: 'api-request',
    expectedAnswerId: null, action: 'answer', selected: ['a'], note: '' });
  await store.migrate((await store.read()).revision);
  const body = { receiptId: 'api-receipt', eventRef: { kind: 'answer', eventId: a.id, questionId: a.questionId,
    questionRevision: a.questionRevision }, transportMessageId: 'mail-parent', rootReplyId: 'mail-reply',
    proof: { rootAcknowledgedAt: '2026-10-06T17:00:00.000Z', observedProof: 'Root explicitly attests this exact received event.' } };
  return { statePath, a, body, server: createDeskServer({ rootAgentId: ROOT, statePath, rootReceiptToken }) };
}
function invoke(server, method, url, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method, url, headers: { host: '127.0.0.1:4791', 'content-type': 'application/json',
    'x-decision-desk': 'agent', ...headers } });
  return new Promise(resolve => server.emit('request', req, { socket: { localPort: 4791 }, setHeader() {},
    writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } }));
}
const authorized = { authorization: `Bearer ${token}` };

test('API receipt authority rejects browser, missing or wrong credentials and unconfigured authority', async () => {
  const { server, body, statePath } = await fixture(); const before = await readFile(statePath, 'utf8');
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { ...authorized, origin: 'http://127.0.0.1:4791' },
    { ...authorized, 'sec-fetch-site': 'same-origin' }])
    assert.equal((await invoke(server, 'POST', '/api/receipts', body, headers)).status, 403);
  const missing = await fixture('');
  assert.equal((await invoke(missing.server, 'POST', '/api/receipts', missing.body, authorized)).status, 503);
  const absentBefore = await readFile(missing.statePath, 'utf8');
  const ack = await invoke(missing.server, 'POST', '/api/ack', { answerId: missing.a.id, status: 'received', receipt: missing.body }, authorized);
  assert.equal(ack.status, 503); assert.match(ack.body.error, /Root-Quittierungsautorität/);
  assert.equal(await readFile(missing.statePath, 'utf8'), absentBefore);
  assert.equal(await readFile(statePath, 'utf8'), before);
});

for (const status of [307, 308]) test(`API CLI all mutations refuse ${status} redirects before replay at another host`, async () => {
  const cli = await import('./cli.mjs'); const dir = await mkdtemp(join(tmpdir(), 'desk-redirect-'));
  const file = join(dir, 'input.json'); await writeFile(file, '{}');
  // R731-K2: progress, patch and idea are the sibling mutations; progress and patch carry the Root bearer.
  for (const command of ['question', 'ack', 'received', 'applied', 'receipt', 'notify', 'progress', 'patch', 'idea']) {
    const calls = []; const request = async (url, options) => {
      calls.push(String(url));
      if (options.redirect === 'error') throw new TypeError(`Redirect ${status} refused`);
      calls.push('https://redirected.test'); return { ok: true, json: async () => ({ replayed: true }) };
    };
    await assert.rejects(cli.runCli(command === 'notify' ? [command] : [command, file], { DECISION_DESK_ROOT_RECEIPT_TOKEN: token }, request), /Redirect/);
    assert.equal(calls.length, 1);
  }
});

test('API trusted local Root attestation is distinct, replay safe and restart recoverable', async () => {
  const { server, body, statePath } = await fixture();
  const first = await invoke(server, 'POST', '/api/receipts', body, authorized);
  assert.equal(first.status, 200); assert.equal(first.body.verificationMode, 'trusted-local-root-attestation');
  assert.equal(first.body.rootAgentId, ROOT);
  const before = await readFile(statePath, 'utf8');
  const restarted = createDeskServer({ rootAgentId: ROOT, statePath, rootReceiptToken: token });
  assert.deepEqual(await invoke(restarted, 'POST', '/api/receipts', body, authorized), first);
  assert.equal(await readFile(statePath, 'utf8'), before); assert.ok(!before.includes(token));
  assert.equal((await invoke(restarted, 'POST', '/api/receipts', { ...body, proof: { ...body.proof, observedProof: 'changed' } }, authorized)).status, 409);
  const inbox = await invoke(restarted, 'GET', '/api/inbox');
  assert.equal(inbox.body.pending.length, 0); assert.equal(inbox.body.received.length, 1);
  assert.equal((await invoke(restarted, 'GET', '/api/pending')).body.length, 0);
});

test('API shared ack has the same authority and exact revision guards', async () => {
  const { server, body, a } = await fixture(); const ack = { answerId: a.id, status: 'received', receipt: body };
  assert.equal((await invoke(server, 'POST', '/api/ack', ack)).status, 403);
  assert.equal((await invoke(server, 'POST', '/api/receipts', { ...body, eventRef: { ...body.eventRef, questionRevision: 2 } }, authorized)).status, 409);
  assert.equal((await invoke(server, 'POST', '/api/receipts', { ...body, proof: { observedProof: 'claim' } }, authorized)).status, 400);
  assert.equal((await invoke(server, 'POST', '/api/ack', ack, authorized)).status, 200);
  assert.equal((await invoke(server, 'POST', '/api/ack', { answerId: a.id, status: 'applied' }, authorized)).status, 409);
});

test('API CLI inbox and receipt IO are testable without a server or subprocess and reject token exfiltration', async () => {
  const cli = await import('./cli.mjs'); const dir = await mkdtemp(join(tmpdir(), 'desk-cli-'));
  const file = join(dir, 'receipt.json'); await writeFile(file, JSON.stringify({ receiptId: 'test' }));
  const calls = []; const request = async (url, options) => { calls.push({ url: String(url), options }); return { ok: true, json: async () => ({ ok: true }) }; };
  const env = { DECISION_DESK_URL: 'http://127.0.0.1:4791', DECISION_DESK_ROOT_RECEIPT_TOKEN: token };
  await cli.runCli(['inbox'], env, request); await cli.runCli(['receipt', file], env, request);
  assert.equal(calls[0].url, env.DECISION_DESK_URL + '/api/inbox');
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(JSON.parse(calls[1].options.body).receiptId, 'test');
  await assert.rejects(cli.runCli(['receipt', file], { ...env, DECISION_DESK_URL: 'https://evil.test' }, request), /Loopback/);
  await assert.rejects(cli.runCli(['receipt', file], { DECISION_DESK_URL: env.DECISION_DESK_URL }, request), /Root/);
  await assert.rejects(cli.runCli(['inbox', file], env, request), /Aufruf/);
  await assert.rejects(cli.runCli(['state'], env, async () => ({ ok: false, json: async () => ({ error: 'offline' }) })), /offline/);
  assert.equal(calls.length, 2);
  for (const command of ['state', 'pending', 'inbox']) { // R731-K2: reads never send the Root bearer, so a followed redirect cannot leak it
    let sent; await cli.runCli([command], env, async (url, options) => { sent = options; return { ok: true, json: async () => ({}) }; });
    assert.ok(!JSON.stringify(sent).includes(token));
  }
});
