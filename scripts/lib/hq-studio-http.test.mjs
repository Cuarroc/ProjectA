import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
let hq, upstream, origin, session;
const root = mkdtempSync(join(tmpdir(), 'hq-studio-http-'));
const received = [];
before(async () => {
  upstream = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push({ path: req.url, token: req.headers['x-projecta-token'], method: req.method, body: body ? JSON.parse(body) : null });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/api/workers') res.end(JSON.stringify({ id: 'fixture-worker', projectId: 'fixture-project', profileId: 'codex' }));
    else if (req.url === '/api/workers/fixture-worker/messages') res.end(JSON.stringify([{ role: 'agent', content: 'Fixture reply', createdAt: 100 }]));
    else res.end('{}');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  mkdirSync(join(root, 'docs', 'dev-hq'), { recursive: true });
  writeFileSync(join(root, 'docs', 'dev-hq', 'index.html'), '<head></head>');
  const descriptor = join(root, 'descriptor.json'); writeFileSync(descriptor, JSON.stringify({ port: upstream.address().port, token: 'fixture-only-secret' }));
  hq = spawn(process.execPath, [fileURLToPath(new URL('../hq-live.mjs', import.meta.url))], { cwd: root, env: { ...process.env, HQ_PORT: '0', HQ_SKIP_SNAPSHOT: '1', PROJECTA_API_DESCRIPTOR: descriptor }, stdio: ['ignore', 'pipe', 'pipe'] });
  origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('HQ fixture startup timed out')), 10000);
    hq.stdout.on('data', chunk => { const match = /http:\/\/127\.0\.0\.1:\d+/.exec(String(chunk)); if (match) { clearTimeout(timeout); resolve(match[0]); } });
    hq.on('error', reject); hq.on('exit', code => { clearTimeout(timeout); reject(new Error('HQ fixture exit ' + code)); });
  });
  const html = await (await fetch(origin)).text(); session = /name="hq-session" content="([^"]+)"/.exec(html)[1];
});
after(async () => { hq?.kill(); if (upstream) { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); } });
function req(path, method = 'GET', body) { return fetch(origin + path, { method, headers: { 'x-hq-session': session, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); }
test('Studio routes retain session protection and persist validated preference revisions', async () => {
  assert.equal((await fetch(origin + '/__hq/studio/routing')).status, 403);
  const config = await (await req('/__hq/studio/routing')).json();
  config.order = ['codex', 'claude'];
  const response = await req('/__hq/studio/routing', 'PUT', config); assert.equal(response.status, 200);
  assert.equal((await response.json()).revision, 1);
  assert.equal((await req('/__hq/studio/routing', 'PUT', config)).status, 409);
  assert.equal((await req('/__hq/studio/catalog', 'POST', {})).status, 405);
  assert.equal((await req('/__hq/studio/missing')).status, 404);
});
test('worker start and transcript use the real proxy transport without exposing its token', async () => {
  const task = { projectId: 'fixture-project', profileId: 'codex', task: 'Plan only' };
  const response = await req('/__hq/api/workers', 'POST', task); assert.equal(response.status, 200);
  const worker = await response.json(); assert.equal(worker.id, 'fixture-worker');
  assert.deepEqual(received.at(-1), { path: '/api/workers', method: 'POST', token: 'fixture-only-secret', body: task });
  const transcript = await (await req('/__hq/api/workers/fixture-worker/messages')).json();
  assert.equal(transcript[0].content, 'Fixture reply'); assert.doesNotMatch(JSON.stringify(worker), /secret/);
});
