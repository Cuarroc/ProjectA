// Run with a freshly built pa binary: node scripts/smoke-verdict-token.mjs <path-to-pa>
// Uses only a local fake API, temporary descriptor and generated test tokens.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute, resolve } from 'node:path';

assert.ok(process.argv[2], 'pass the path of the candidate pa binary');
const binary = resolve(process.argv[2]);
const directory = mkdtempSync(join(tmpdir(), 'projecta-verdict-smoke-'));
const descriptor = join(directory, 'projecta-api.json');
const tokenFile = join(directory, 'verdict.txt');
const token = randomBytes(16).toString('hex');
const requests = [];
const server = createServer((request, response) => {
  requests.push({ path: request.url, token: request.headers['x-verdict-token'] });
  request.resume();
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end('{}');
});

async function invoke(source, input) {
  const args = ['learnings', 'approve', 'lr-smoke', '--text', 'isolated smoke', '--verdict-token', source];
  assert.ok(!args.some(arg => arg.includes(token)), 'test token must never enter child argv');
  const env = { ...process.env, PROJECTA_API_FILE: descriptor };
  delete env.PA_VERDICT_TOKEN;
  const child = spawn(binary, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', data => { stdout += data; });
  child.stderr.setEncoding('utf8').on('data', data => { stderr += data; });
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    const completion = once(child, 'close');
    child.stdin.end(input);
    const [code, signal] = await completion;
    assert.equal(signal, null, 'CLI must finish without timeout');
    assert.ok(!stdout.includes(token) && !stderr.includes(token), 'CLI output must not reveal token');
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  writeFileSync(descriptor, JSON.stringify({ port: server.address().port, token: 'fake-api-token' }));
  writeFileSync(tokenFile, `${token}\nignored-second-line\n`, { mode: 0o600 });
  for (const [source, input] of [['-', `${token}\nignored-second-line\n`], [`@${tokenFile}`, '']]) {
    const result = await invoke(source, input);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /approved lr-smoke/);
    assert.deepEqual(requests.at(-1), { path: '/api/learnings/lr-smoke/approve', token });
  }
  assert.equal(requests.length, 2);
  const empty = await invoke('-', '');
  assert.notEqual(empty.code, 0);
  assert.match(empty.stderr, /standard input.*empty/);
  const malformed = await invoke('-', 'bad token\n');
  assert.notEqual(malformed.code, 0);
  assert.match(malformed.stderr, /whitespace or control/);
  assert.equal(requests.length, 2, 'invalid sources must never reach the API');
  console.log('PASS: real pa subprocess: stdin, file, empty and malformed input; no token in argv/output');
} finally {
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  const cleanupPath = realpathSync(directory);
  const underTemp = relative(realpathSync(tmpdir()), cleanupPath);
  assert.ok(underTemp && !underTemp.startsWith('..') && !isAbsolute(underTemp));
  rmSync(cleanupPath, { recursive: true, force: true });
}
