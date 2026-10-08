import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createDeskServer } from './server.mjs';
import { runCli } from './cli.mjs';
import { Readable } from 'node:stream';
import { writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('CLI received and applied commands require proof and persist their states', async t => {
  const base = await start(t); const dir = await tmp(t);
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

test('CLI input failures print fixed diagnostics without path or file content', async t => {
  const dir = await tmp(t);
  const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
  const runFailing = async file => {
    const err = await promisify(execFile)(process.execPath, [cli, 'progress', file]).then(() => assert.fail('CLI must exit 1'), e => e);
    assert.equal(err.code, 1); assert.equal(err.stdout, '');
    return err.stderr;
  };
  const missing = join(dir, 'SYNTHETIC_MISSING_PATH.json');
  const bad = join(dir, 'bad.json');
  await writeFile(bad, 'SYNTHETIC_SECRET_DO_NOT_LOG');
  const missingErr = await runFailing(missing); const badErr = await runFailing(bad);
  for (const out of [missingErr, badErr]) for (const leak of [dir, 'SYNTHETIC_MISSING_PATH', 'bad.json', 'SYNTHETIC_SECRET_DO_NOT_LOG', 'SYNTHETIC_']) assert.ok(!out.includes(leak), `diagnostic leaks ${leak}`);
  assert.match(missingErr, /cannot read input file/); assert.match(badErr, /input is not valid JSON/);
});

test('HTTP body decodes UTF-8 across every byte boundary', async t => {
  let server; const dir = await tmp(t, () => server);
  server = createDeskServer({ statePath: join(dir, 'state.json'), rootAgentId: 'root-test' });
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

// One cleanup per fixture dir: close the server first (if it listens), then remove the dir, also after a failed test.
async function tmp(t, server = () => null) {
  const dir = await mkdtemp(join(tmpdir(), 'decision-'));
  t.after(async () => {
    try { const s = server(); if (s?.listening) await new Promise(resolve => s.close(resolve)); }
    finally { await rm(dir, { recursive: true, force: true }); }
  });
  return dir;
}

async function start(t) {
  let server; const dir = await tmp(t, () => server);
  server = createDeskServer({ statePath: join(dir, 'state.json'), rootAgentId: 'root-test' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
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
