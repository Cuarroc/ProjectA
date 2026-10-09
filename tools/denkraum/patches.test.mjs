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
  const file = join(await mkdtemp(join(tmpdir(), 'desk-patches-')), 'state.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 1, revision: 0, questions: [], answers: [], unknown: 'preserved' }));
  const s = new DeskStore(file, { rootAgentId: ROOT, verifyReceipt: async request => ({ ...request, rootAgentId: ROOT,
    rootAcknowledgedAt: '2026-10-06T18:36:00.000Z', observedProof: 'Verified isolated Root reply' }), verifyPatchAuthority: async () => true });
  await s.migrate(0); const a = await s.putIdea({ requestId: 'source', expectedRevision: null, title: 'Install is text', text: 'No execution permission' });
  const ref = { kind: 'idea', eventId: a.eventId, ideaId: a.id, ideaRevision: 1 };
  await s.receipt({ receiptId: 'source-receipt', eventRef: ref, transportMessageId: 'native', rootReplyId: 'reply' });
  const request = { requestId: 'patch-request', expectedRevision: null, label: 'Small patch', windowText: '', sourceRefs: [ref],
    reason: 'Observed scope', authorityEvidenceRefs: ['existing-approved-scope'] };
  return { s, a, ref, request };
}

test('patch revision stores real plan without default schedule or source status mutation', async () => {
  const { s, request } = await fixture(); const before = await s.read(); const p = await s.putPatch(request); const state = await s.read();
  assert.equal(p.revision, 1); assert.equal(p.windowText, ''); assert.equal(state.patches[0].id, p.id);
  assert.deepEqual(state.progress, before.progress); assert.deepEqual(state.ideas, before.ideas); assert.equal(state.unknown, 'preserved');
});

test('patch revisions use CAS and persistent replay before later source edits without changing history', async () => {
  const { s, request, a } = await fixture(); const first = await s.putPatch(request);
  const edits = await Promise.allSettled(['edit-a', 'edit-b'].map(requestId => s.putPatch({ ...request, id: first.id, expectedRevision: 1, requestId })));
  assert.equal(edits.filter(r => r.status === 'fulfilled').length, 1); assert.equal(edits.find(r => r.status === 'rejected').reason.status, 409);
  assert.deepEqual((await s.read()).patches[0], first);
  await s.putIdea({ id: a.id, expectedRevision: 1, requestId: 'new-source', title: 'Changed', text: 'New scope' });
  const restart = new DeskStore(s.file, { rootAgentId: ROOT }); const bytes = await readFile(s.file, 'utf8'); assert.deepEqual(await restart.putPatch(request), first);
  await assert.rejects(restart.putPatch({ ...request, label: 'changed' }), e => e.status === 409);
  await assert.rejects(s.putPatch({ ...request, requestId: 'stale-source' }), e => e.status === 409);
  assert.equal(await readFile(s.file, 'utf8'), bytes);
});

test('patch rejects missing receipt, absent or forged authority, wrong typed source and malformed inputs', async () => {
  const { s, request } = await fixture();
  for (const bad of [{ label: '' }, { windowText: null }, { sourceRefs: [] }, { sourceRefs: [request.sourceRefs[0], request.sourceRefs[0]] },
    { authorityEvidenceRefs: [] }, { authorityEvidenceRefs: [null] }, { expectedRevision: 1 }])
    await assert.rejects(s.putPatch({ ...request, ...bad }), e => e.status === 400);
  const before = await readFile(s.file, 'utf8'); s.io.verifyPatchAuthority = undefined;
  await assert.rejects(s.putPatch(request), e => e.status === 503);
  s.io.verifyPatchAuthority = async () => false; await assert.rejects(s.putPatch(request), e => e.status === 403);
  s.io.verifyPatchAuthority = async () => true;
  await assert.rejects(s.putPatch({ ...request, sourceRefs: [{ ...request.sourceRefs[0], ideaRevision: 2 }] }), e => e.status === 409);
  const state = await s.read(); state.receipts = []; await writeFile(s.file, JSON.stringify(state));
  await assert.rejects(s.putPatch(request), e => e.status === 409); assert.equal((await s.read()).patches.length, 0);
  assert.ok(before.includes('preserved'));
});

test('patch atomic failure retains original bytes and malformed persisted plans fail closed', async () => {
  const { s, request } = await fixture(); const before = await readFile(s.file, 'utf8');
  const broken = new DeskStore(s.file, { rootAgentId: ROOT, verifyPatchAuthority: async () => true, rename: async (from, to) => {
    if (to === s.file) throw new Error('patch interrupted'); return rename(from, to);
  } });
  await assert.rejects(broken.putPatch(request), /patch interrupted/); assert.equal(await readFile(s.file, 'utf8'), before);
  await s.putPatch(request); const state = await s.read(); state.patches.push(null); const corrupt = JSON.stringify(state);
  await writeFile(s.file, corrupt); await assert.rejects(s.read(), e => e.status === 503); assert.equal(await readFile(s.file, 'utf8'), corrupt);
});
test('patch API and CLI require separate local Root authority and never treat browser text as permission', async () => {
  const { s, request } = await fixture(); const token = 'test-only-patch-root-token-not-a-real-secret';
  const server = createDeskServer({ rootAgentId: ROOT, statePath: s.file, rootReceiptToken: token });
  const call = headers => {
    const req = Readable.from([Buffer.from(JSON.stringify(request))]);
    Object.assign(req, { method: 'POST', url: '/api/patches', headers: { host: '127.0.0.1:4791', 'x-decision-desk': 'agent', 'content-type': 'application/json', ...headers } });
    return new Promise(resolve => server.emit('request', req, { socket: { localPort: 4791 }, setHeader() {}, writeHead(status) { this.status = status; },
      end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } }));
  };
  assert.equal((await call({ origin: 'http://127.0.0.1:4791' })).status, 403);
  assert.equal((await call({})).status, 403);
  const result = await call({ authorization: `Bearer ${token}` }); assert.equal(result.status, 200);
  const file = join(s.file, '..', 'patch.json'); await writeFile(file, JSON.stringify(request)); let sent;
  await assert.rejects(runCli(['patch', file], {}, async () => { throw new Error('must not send'); }), /autorität/);
  await runCli(['patch', file], { DECISION_DESK_ROOT_RECEIPT_TOKEN: token }, async (url, options) => {
    sent = { url: String(url), options }; return { ok: true, json: async () => result.body };
  });
  assert.equal(sent.url, 'http://127.0.0.1:4791/api/patches'); assert.equal(sent.options.redirect, 'error');
  assert.equal(sent.options.headers.Authorization, `Bearer ${token}`);
});
