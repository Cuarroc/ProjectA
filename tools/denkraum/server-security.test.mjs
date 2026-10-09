import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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

const bodyLimit = 128 * 1024;
const bodyHeaders = { 'content-type': 'application/json', 'x-decision-desk': 'agent' };

async function bodyFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-body-'));
  const statePath = join(dir, 'ledger.json');
  const server = createDeskServer({ statePath, rootAgentId });
  t.after(async () => {
    try {
      const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const base = `http://127.0.0.1:${server.address().port}`;
  const seed = await send(base, bodyHeaders, question('seed'));
  assert.equal(seed.status, 200, seed.body);
  const snapshot = async () => {
    const files = (await readdir(dir)).sort();
    return Promise.all(files.map(async name => [name, await readFile(join(dir, name))]));
  };
  return { base, statePath, snapshot, before: await snapshot() };
}

// Keep wire bytes intact, including malformed UTF-8. A chunked producer can
// deliberately leave the request unfinished until the server rejects it.
function sendBytes(base, body, chunked = false) {
  return new Promise((resolve, reject) => {
    let response;
    const req = request(`${base}/api/questions`, {
      method: 'POST', agent: false, signal: AbortSignal.timeout(3000),
      headers: { ...bodyHeaders, ...(chunked ? { 'transfer-encoding': 'chunked' } : { 'content-length': body.length }) },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        response = { status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()),
          requestFinished: req.writableEnded };
      });
    });
    req.on('error', reject);
    req.on('close', () => response ? resolve(response) : reject(new Error('Connection closed without a complete HTTP response')));
    if (chunked) {
      for (let offset = 0; offset < body.length; offset += 16384) req.write(body.subarray(offset, offset + 16384));
      // No end marker or remaining payload: rejection must precede those bytes.
    } else req.end(body);
  });
}

function paddedQuestion(id, bytes) {
  // Multibyte text distinguishes a byte limit from a character limit; JSON
  // whitespace reaches the exact boundary without hitting a field-size limit.
  const json = Buffer.from(JSON.stringify({ ...question(id), title: 'Grenze ä 😀' }));
  return Buffer.concat([json, Buffer.alloc(bytes - json.length, 0x20)]);
}

test('DRSEC: a fixed body over 128 KiB returns 413 without a state write', { timeout: 10000 }, async t => {
  const f = await bodyFixture(t);
  const response = await sendBytes(f.base, paddedQuestion('overflow', bodyLimit + 1));
  assert.equal(response.status, 413);
  assert.deepEqual(response.body, { error: 'Anfrage zu groß.' });
  assert.deepEqual(await f.snapshot(), f.before, 'ledger, backups and file listing must remain unchanged');
});

test('DRSEC: a body exactly at 128 KiB is accepted and committed once', { timeout: 10000 }, async t => {
  const f = await bodyFixture(t);
  const body = paddedQuestion('boundary', bodyLimit);
  assert.equal(body.length, 131072);
  assert.ok(body.toString().length < body.length, 'fixture must contain multibyte UTF-8');
  const before = JSON.parse(await readFile(f.statePath));
  const response = await sendBytes(f.base, body);
  assert.equal(response.status, 200);
  assert.equal(response.body.id, 'boundary');
  const after = JSON.parse(await readFile(f.statePath));
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.questions.length, before.questions.length + 1);
  assert.equal(after.questions.find(q => q.id === 'boundary').title, 'Grenze ä 😀');
});

test('DRSEC: chunked overflow is rejected before the whole body arrives without a state write', { timeout: 10000 }, async t => {
  const f = await bodyFixture(t);
  const response = await sendBytes(f.base, paddedQuestion('chunked-overflow', bodyLimit + 1), true);
  assert.equal(response.status, 413);
  assert.deepEqual(response.body, { error: 'Anfrage zu groß.' });
  assert.equal(response.requestFinished, false, 'reject before the client ends or sends any remaining body');
  assert.deepEqual(await f.snapshot(), f.before);
  const recovery = await send(f.base, bodyHeaders, question('after-overflow'));
  assert.equal(recovery.status, 200, recovery.body);
  assert.equal(JSON.parse(await readFile(f.statePath)).revision, 2);
});

test('DRSEC: invalid UTF-8 is rejected with a fixed diagnostic without a state write', { timeout: 10000 }, async t => {
  const f = await bodyFixture(t);
  const json = JSON.stringify({ ...question('invalid-utf8'), title: 'MARKER' });
  const [prefix, suffix] = json.split('MARKER');
  for (const invalid of [[0xff], [0xc0, 0xaf], [0xe2, 0x82]]) {
    // Replacement decoding would turn this into a valid, writable question.
    const body = Buffer.concat([Buffer.from(prefix), Buffer.from(invalid), Buffer.from(suffix)]);
    assert.doesNotThrow(() => JSON.parse(body.toString()));
    const response = await sendBytes(f.base, body);
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Ungültiges JSON oder UTF-8.' });
    assert.deepEqual(await f.snapshot(), f.before);
  }
});

function get(base, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method: 'GET', headers, signal: AbortSignal.timeout(3000) }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

function assertSecurityHeaders(response, label) {
  const h = Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), v]));
  assert.equal(h['cache-control'], 'no-store', label);
  assert.equal(h['x-content-type-options'], 'nosniff', label);
  assert.equal(h['referrer-policy'], 'no-referrer', label);
  const csp = h['content-security-policy'];
  assert.ok(typeof csp === 'string' && csp.length > 0, `${label}: CSP missing`);
  assert.match(csp, /frame-ancestors\s+'none'/, label);
  assert.match(csp, /base-uri\s+'none'/, label);
  assert.match(csp, /script-src\s+'self'/, label);
  assert.match(csp, /connect-src\s+'self'/, label);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, `${label}: no inline scripts`);
  assert.doesNotMatch(csp, /script-src[^;]*\*|connect-src[^;]*\*/, `${label}: no wildcard script/connect`);
  assert.equal(h['access-control-allow-origin'], undefined, `${label}: no CORS grant`);
}

test('DRSEC: security headers protect successful and rejected responses', { timeout: 20000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-headers-'));
  const server = createDeskServer({
    statePath: join(dir, 'ledger.json'), rootAgentId,
    rootReceiptToken: 'synthetic-root-token-for-security-tests',
  });
  t.after(async () => {
    try {
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const base = `http://127.0.0.1:${server.address().port}`;
  const cases = [
    ['index', await get(base, '/'), 200],
    ['api state', await get(base, '/api/state'), 200],
    ['static css', await get(base, '/style.css'), 200],
    ['denied path', await get(base, '/app.js'), 404],
    ['rejected host', await get(base, '/api/state', { host: 'evil.test' }), 403],
    ['rejected origin mutation', await send(base, {
      'content-type': 'application/json', origin: 'https://evil.test',
    }, question('cors-probe')), 403],
  ];
  for (const [label, response, status] of cases) {
    assert.equal(response.status, status, label);
    assertSecurityHeaders(response, label);
  }
});
