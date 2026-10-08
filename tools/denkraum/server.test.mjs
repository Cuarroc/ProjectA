import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createDeskServer } from './server.mjs';
import { runCli } from './cli.mjs';
import { Readable } from 'node:stream';
import { writeFile } from 'node:fs/promises';

test('CLI received and applied commands require proof and persist their states', async t => {
  const base = await start(t); const dir = await mkdtemp(join(tmpdir(), 'decision-cli-'));
  const post = (route, body) => fetch(`${base}/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
  await post('questions', q());
  const a = await (await post('answers', { questionId: 'utf8', questionRevision: 1, expectedAnswerId: null, requestId: 'cli-1', action: 'answer', selected: ['a'], note: '' })).json();
  const file = join(dir, 'receipt.json');
  const run = (...args) => runCli(args, { ...process.env, DECISION_DESK_URL: base });
  assert.equal((await run('pending')).length, 1);
  await writeFile(file, JSON.stringify({ answerId: a.id, actor: 'Test', note: 'Bestätigt' }));
  await assert.rejects(run('received', file), /Weitergabebeleg/);
  await writeFile(file, JSON.stringify({ answerId: a.id, actor: 'Test', note: 'Bestätigt', deliveryReceipt: 'msg-123 bestätigt' }));
  assert.equal((await run('received', file)).ack.status, 'received');
  assert.equal((await run('pending')).length, 0);
  await assert.rejects(run('applied', file), /Umsetzungsbeleg/);
  await writeFile(file, JSON.stringify({ answerId: a.id, actor: 'Test', note: 'Bestätigt', evidence: 'commit abc getestet' }));
  assert.equal((await run('applied', file)).ack.status, 'applied');
});

const q = () => ({ id: 'utf8', title: 'Grüße 🧠', context: 'Test', owner: 'Test', category: 'Test', scope: 'Test', source: 'Test', uncertainty: 'Test', recommendation: { optionIds: ['a'], rationale: 'Test' }, options: ['a', 'b'].map(id => ({ id, label: id, rationale: 'Test', impact: 'Test', tradeoff: 'Test', effort: 'Test', reversible: 'Test' })) });

test('HTTP body decodes UTF-8 across every byte boundary', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'decision-utf8-'));
  const server = createDeskServer({ statePath: join(dir, 'state.json'), rootAgentId: 'root-test' });
  t.after(() => server.close());
  const req = Readable.from([...Buffer.from(JSON.stringify(q()))].map(byte => Buffer.from([byte])));
  Object.assign(req, { method: 'POST', url: '/api/questions', headers: { host: '127.0.0.1:4791', origin: 'http://127.0.0.1:4791', 'content-type': 'application/json' } });
  const result = await new Promise(resolve => server.emit('request', req, { socket: { localPort: 4791 }, setHeader() {}, writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } }));
  assert.equal(result.status, 200); assert.equal(result.body.title, q().title);
});

test('nested malformed schemas return clear 400 errors', async t => {
  const base = await start(t);
  for (const options of [[null, {}], [false, {}], ['x', {}]]) {
    const r = await fetch(`${base}/api/questions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ ...q(), options }) });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /Option/);
  }
});

test('invalid revision types return 400 while stale numeric revisions return 409', async t => {
  const base = await start(t);
  const post = (route, body) => fetch(`${base}/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
  await post('questions', q());
  assert.equal((await post('questions', { ...q(), expectedRevision: '1' })).status, 400);
  assert.equal((await post('questions', { ...q(), expectedRevision: 0 })).status, 409);
  const a = { questionId: 'utf8', questionRevision: 1, expectedAnswerId: null, requestId: 'rev-1', action: 'answer', selected: ['a'], note: '' };
  assert.equal((await post('answers', { ...a, questionRevision: '1' })).status, 400);
  assert.equal((await post('answers', { ...a, questionRevision: 2 })).status, 409);
});

test('malformed preview image objects cannot escape schema validation as 500', async t => {
  const base = await start(t); const input = q();
  input.options[0].preview = { text: 'Test', image: { toString: null, valueOf: null } };
  const r = await fetch(`${base}/api/questions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(input) });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /Vorschau/);
});

async function start(t) {
  const dir = await mkdtemp(join(tmpdir(), 'decision-http-'));
  const server = createDeskServer({ statePath: join(dir, 'state.json'), rootAgentId: 'root-test' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
test('reject foreign origins, null origin, DNS rebinding and missing agent header', async t => {
  const base = await start(t);
  for (const headers of [{ Origin: 'https://evil.test' }, { Origin: 'null' }, {}]) {
    const r = await fetch(`${base}/api/questions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
    assert.equal(r.status, 403);
  }
  const status = await new Promise((resolve, reject) => {
    const r = request(`${base}/api/state`, { headers: { Host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode); });
    r.on('error', reject); r.end();
  });
  assert.equal(status, 403);
});
test('local clients can read; malformed mutations and private paths stay blocked', async t => {
  const base = await start(t);
  assert.equal((await fetch(`${base}/api/state`)).status, 200);
  assert.equal((await fetch(`${base}/index.html`)).status, 200);
  assert.equal((await fetch(`${base}/app.js`)).status, 404); // DR-06a allowlist: no /app.js
  assert.equal((await fetch(`${base}/store.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/api/questions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Decision-Desk': 'agent' }, body: '{bad' })).status, 400);
  assert.equal((await fetch(`${base}/api/answers`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: 'null' })).status, 400);
  assert.equal((await fetch(`${base}/api/questions`, { method: 'OPTIONS' })).status, 405);
  assert.equal((await fetch(`${base}/api/state`)).headers.get('access-control-allow-origin'), null);
});
