import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

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
    const script = `
      globalThis.fetch = async () => { throw new Error(${JSON.stringify(failure)}); };
      process.argv = [process.execPath, ${JSON.stringify(cliPath)}, 'state'];
      await import(${JSON.stringify(cliUrl.href)});
    `;
    const result = await runFailure(['--input-type=module', '--eval', script]);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(failure), 'exception path or URL leaked');
    assert.equal(result.stderr, 'Transport request failed\n');
  }
});
