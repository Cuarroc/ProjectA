import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDeskServer } from './server.mjs';

const rootAgentId = 'security-test-root';
const serverFile = fileURLToPath(new URL('./server.mjs', import.meta.url));

test('DRSEC: production entrypoint binds only IPv4 loopback', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-bind-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // Run the real entrypoint. Only replace its port with an ephemeral one;
  // preserve its host argument and observe the actual listening socket.
  const observer = `
    import { Server } from 'node:net';
    const listen = Server.prototype.listen;
    Server.prototype.listen = function (...args) {
      if (typeof args[0] !== 'number') throw new Error('Expected numeric port');
      args[0] = 0;
      return listen.apply(this, args);
    };
    const emit = Server.prototype.emit;
    Server.prototype.emit = function (event, ...args) {
      const result = emit.call(this, event, ...args);
      if (event === 'listening') {
        console.log('DRSEC_SOCKET=' + JSON.stringify(this.address()));
        this.close();
      }
      return result;
    };
  `;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DECISION_DESK_')));
  const child = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(observer)}`, serverFile], {
    encoding: 'utf8', timeout: 10000,
    env: { ...env, DECISION_DESK_STATE: join(dir, 'ledger.json'), DECISION_DESK_ROOT_AGENT_ID: rootAgentId,
      DECISION_DESK_ROOT_RECEIPT_TOKEN: 'synthetic-root-token-for-security-tests',
      DECISION_DESK_WEBHOOK_SECRET: 'synthetic-webhook-secret-for-security-tests', DECISION_DESK_PORT: '4791' },
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr);
  const sockets = child.stdout.split('\n').filter(line => line.startsWith('DRSEC_SOCKET='));
  assert.equal(sockets.length, 1, 'the production entrypoint must listen exactly once');
  const address = JSON.parse(sockets[0].slice('DRSEC_SOCKET='.length));
  assert.equal(address.address, '127.0.0.1');
  assert.equal(address.family, 'IPv4');
  assert.ok(Number.isInteger(address.port) && address.port > 0);
});

const question = id => ({
  id, title: 'Security fixture', context: 'Test', owner: 'Test', category: 'Test', scope: 'Test',
  source: 'Test', uncertainty: 'Test', recommendation: { optionIds: ['a'], rationale: 'Test' },
  options: ['a', 'b'].map(id => ({ id, label: id, rationale: 'Test', impact: 'Test',
    tradeoff: 'Test', effort: 'Test', reversible: 'Test' })),
});

// node:http preserves an absent Content-Type (fetch would add text/plain).
function send(base, headers, body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const req = request(`${base}/api/questions`, { method, headers, signal: AbortSignal.timeout(3000) }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

test('DRSEC: CSRF guards reject cross-site and non-JSON mutations without writes', { timeout: 20000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-csrf-'));
  const statePath = join(dir, 'ledger.json');
  const server = createDeskServer({ statePath, rootAgentId, rootReceiptToken: 'synthetic-root-token-for-security-tests' });
  t.after(async () => {
    try {
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { 'content-type': 'application/json' };
  const agent = { ...json, 'x-decision-desk': 'agent' };
  const sameOrigin = { ...json, origin: base, 'sec-fetch-site': 'same-origin' };
  const seed = await send(base, sameOrigin, question('seed'));
  assert.equal(seed.status, 200, seed.body);
  const before = await readFile(statePath);
  const revision = JSON.parse(before).revision;

  const cases = [
    ['foreign Origin with agent', { ...agent, origin: 'https://evil.test' }, 403],
    ['opaque Origin with agent', { ...agent, origin: 'null' }, 403],
    ['cross-site with matching Origin and agent', { ...agent, origin: base, 'sec-fetch-site': 'cross-site' }, 403],
    ['cross-site without Origin with agent', { ...agent, 'sec-fetch-site': 'cross-site' }, 403],
    ['missing Origin and agent', json, 403],
    ...['application/x-www-form-urlencoded', 'multipart/form-data; boundary=fixture', 'text/plain'].map(type =>
      [type, { ...sameOrigin, 'content-type': type }, 415]),
    ['missing Content-Type', { origin: base }, 415],
    ['OPTIONS', { origin: base, 'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,x-decision-desk' }, 405, 'OPTIONS'],
  ];
  for (const [index, [label, headers, expected, method]] of cases.entries()) {
    const response = await send(base, headers, question(`rejected-${index}`), method);
    assert.equal(response.status, expected, label);
    assert.equal(response.headers['access-control-allow-origin'], undefined, label);
    assert.equal(response.headers['access-control-allow-methods'], undefined, label);
    assert.equal(response.headers['access-control-allow-headers'], undefined, label);
    const after = await readFile(statePath);
    assert.deepEqual(after, before, `${label}: ledger bytes changed`);
    assert.equal(JSON.parse(after).revision, revision, `${label}: revision changed`);
  }
  // Positive controls use the same payload shape and prove mutations still work.
  for (const [index, headers] of [sameOrigin, agent].entries()) {
    const response = await send(base, headers, question(`accepted-${index}`));
    assert.equal(response.status, 200, response.body);
    assert.equal(JSON.parse(response.body).id, `accepted-${index}`);
  }
  const after = JSON.parse(await readFile(statePath));
  assert.equal(after.revision, revision + 2);
  assert.equal(after.questions.length, 3);
});
