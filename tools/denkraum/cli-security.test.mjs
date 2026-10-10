import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './cli.mjs';

const cliUrl = new URL('./cli.mjs', import.meta.url);
const cliPath = fileURLToPath(cliUrl);
const exec = promisify(execFile);

async function runFailure(args, env = {}) {
  const result = await exec(process.execPath, args, {
    env: { ...process.env, ...env }, timeout: 10000,
  }).then(() => assert.fail('CLI must fail'), error => error);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  return result;
}

test('DRSEC: CLI HTTP failures never print endpoint error contents', async t => {
  const token = 'sk-test-synthetic-endpoint-secret';
  let status = 503;
  let body = JSON.stringify({ error: token });
  const server = createServer((_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  for (const response of [[503, body], [502, token], [500, '']]) {
    [status, body] = response;
    const result = await runFailure([cliPath, 'state'], {
      DECISION_DESK_URL: `http://127.0.0.1:${server.address().port}`,
    });
    assert.ok(!`${result.stdout}${result.stderr}`.includes(token), 'endpoint token leaked');
    assert.equal(result.stderr, `HTTP request failed (${status})\n`);
  }
});

test('DRSEC: CLI transport failures never print exception paths', async () => {
  const path = '/synthetic/private/transport-fixture.json';
  const credentialUrl = new URL('https://invalid.example');
  credentialUrl.username = 'fixture';
  credentialUrl.password = 'synthetic-password';
  for (const failure of [path, credentialUrl.href]) {
    // Preload instead of --eval: import.meta.main is false for an imported module.
    const preload = `data:text/javascript,globalThis.fetch=async()=>{throw new Error(${encodeURIComponent(JSON.stringify(failure))})}`;
    const result = await runFailure(['--import', preload, cliPath, 'state']);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(failure), 'exception path or URL leaked');
    assert.equal(result.stderr, 'Transport request failed\n');
  }
});

test('DRSEC: programmatic runCli rejection hides server body from message and enumerable fields', async () => {
  const secret = 'sk-test-programmatic-runcli-body-secret';
  const request = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: secret }),
  });
  await assert.rejects(
    () => runCli(['state'], { DECISION_DESK_URL: 'http://127.0.0.1:9' }, request),
    error => {
      assert.equal(error.message, 'HTTP request failed (403)');
      assert.ok(!error.message.includes(secret), 'message leaked server body');
      for (const value of Object.values(error)) {
        assert.ok(typeof value !== 'string' || !value.includes(secret), 'enumerable field leaked server body');
      }
      return true;
    },
  );
});

async function aliasTo(t, target) {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-alias-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const alias = join(dir, 'alias');
  await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
  return alias;
}

test('SRV-2: cli.mjs started through a junction or symlink prints usage and exits 1', async t => {
  const alias = await aliasTo(t, fileURLToPath(new URL('.', import.meta.url)));
  const result = await runFailure([join(alias, 'cli.mjs')]);
  assert.match(result.stderr, /^Aufruf: /);
});

test('SRV-5: root command uses DECISION_DESK_PORT and never sends the token to a listener that is not decision-desk', async t => {
  const token = 'synthetic-root-token-0123456789abcdef0123456789';
  const listen = async service => {
    const requests = [];
    const server = createServer((req, res) => {
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(req.url === '/health' ? { service, ok: true } : { saved: true }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    return { requests, env: { DECISION_DESK_PORT: String(server.address().port), DECISION_DESK_ROOT_RECEIPT_TOKEN: token } };
  };
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-port-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'patch.json');
  await writeFile(file, '{}');
  const other = await listen('something-else');
  await assert.rejects(runCli(['patch', file], other.env), error => !error.message.includes(token));
  const process_ = await runFailure([cliPath, 'patch', file], other.env);
  assert.ok(!process_.stderr.includes(token));
  assert.deepEqual(other.requests.map(r => r.url), ['/health', '/health']);
  assert.ok(other.requests.every(r => r.authorization === undefined), 'token reached a foreign listener');
  const desk = await listen('decision-desk');
  assert.deepEqual(await runCli(['patch', file], desk.env), { saved: true });
  assert.deepEqual(desk.requests.map(r => [r.method, r.url, r.authorization]), [['GET', '/health', undefined], ['POST', '/api/patches', `Bearer ${token}`]]);
});

test('CLI-PORT: an invalid DECISION_DESK_PORT is rejected before any request', async t => {
  const token = 'synthetic-root-token-0123456789abcdef0123456789';
  const globalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('/synthetic/private/fetch-fixture'); };
  t.after(() => { globalThis.fetch = globalFetch; });
  let injected = 0;
  const request = async () => { injected += 1; throw new Error('/synthetic/private/injected-fixture'); };
  for (const port of ['abc', '12x', '0', '65536', '-1', '']) {
    const env = { DECISION_DESK_PORT: port, DECISION_DESK_ROOT_RECEIPT_TOKEN: token };
    for (const args of [['state'], ['notify']]) {
      for (const transport of [undefined, request]) {
        await assert.rejects(runCli(args, env, transport), error => {
          assert.equal(error.message, 'DECISION_DESK_PORT muss eine Portnummer von 1 bis 65535 sein.');
          assert.ok(!`${error.message}${error.diagnostic}`.includes(token), 'token leaked');
          return true;
        }, `port ${JSON.stringify(port)}`);
      }
    }
  }
  assert.equal(calls, 0, 'global fetch was called for an invalid port');
  assert.equal(injected, 0, 'injected transport was called for an invalid port');
});

test('CLI-HEALTH: an unreachable desk on a root command reports unreachable and sends no token', async t => {
  const token = 'synthetic-root-token-0123456789abcdef0123456789';
  const globalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), authorization: init?.headers?.Authorization });
    throw new Error('/synthetic/private/refused-fixture');
  };
  t.after(() => { globalThis.fetch = globalFetch; });
  const env = { DECISION_DESK_PORT: '4791', DECISION_DESK_ROOT_RECEIPT_TOKEN: token };
  await assert.rejects(runCli(['notify'], env), error => {
    assert.match(error.message, /nicht erreichbar/);
    assert.doesNotMatch(error.message, /nicht der Decision Desk/);
    assert.ok(!`${error.message}${error.diagnostic}`.includes(token), 'token leaked');
    assert.ok(!`${error.message}${error.diagnostic}`.includes('/synthetic/private'), 'transport detail leaked');
    return true;
  });
  assert.deepEqual(seen.map(r => r.url), ['http://127.0.0.1:4791/health']);
  assert.ok(seen.every(r => r.authorization === undefined), 'token was sent');
});
