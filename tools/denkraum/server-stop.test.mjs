import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeskServer } from './server.mjs';
import { DeskStore } from './store.mjs';
import { ownerRecordPath, OWNERSHIP_RELEASE_MISMATCH } from './store/ownership.mjs';

const entry = fileURLToPath(new URL('./server.mjs', import.meta.url));
const question = id => ({ id, title: 'T', context: 'C', owner: 'O', category: 'K', scope: 'S', source: 'Q', uncertainty: 'U',
  recommendation: { optionIds: ['a'], rationale: 'R' }, options: ['a', 'b'].map(o => ({ id: o, label: o, rationale: 'R', impact: 'I', tradeoff: 'T', effort: 'E', reversible: 'Y' })) });
const gone = path => access(path).then(() => false, e => e.code === 'ENOENT');
async function ledger(t) {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-stop-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'ledger.json');
}
const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer().once('error', reject).listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
// Starts the real CLI entry, waits until it listens and writes one question through HTTP. The probed port can be
// taken by a parallel process before the child binds it; that EADDRINUSE start is retried on a fresh port.
async function startEntry(t, statePath, id) {
  for (let attempt = 1; ; attempt++) {
    const port = await freePort();
    const env = { ...process.env, DECISION_DESK_STATE: statePath, DECISION_DESK_PORT: String(port), DECISION_DESK_ROOT_AGENT_ID: 'root-test',
      DECISION_DESK_ROOT_RECEIPT_TOKEN: 'r'.repeat(40), DECISION_DESK_WEBHOOK_SECRET: 'w'.repeat(40) };
    delete env.DECISION_DESK_WEBHOOK_URL;
    const child = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    let stdout = '', stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    const exited = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal, stderr })));
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('entry start timed out')), 3000);
        const finish = () => { clearTimeout(timer); resolve(); };
        child.stdout.on('data', d => { stdout += d; if (stdout.includes('http://')) finish(); });
        exited.then(() => { clearTimeout(timer); reject(new Error(`entry exited early: ${stderr}`)); });
      });
    } catch (error) {
      if (attempt < 5 && stderr.includes('EADDRINUSE')) continue;
      throw error;
    }
    const response = await fetch(`http://127.0.0.1:${port}/api/questions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-decision-desk': 'agent' }, body: JSON.stringify(question(id)) });
    assert.equal(response.status, 200, await response.text());
    return { child, exited };
  }
}

const posix = { skip: process.platform === 'win32' && 'POSIX signals differ on Windows' };
async function stopCase(t, signal) {
  const file = await ledger(t);
  const first = await startEntry(t, file, 'q-first');
  first.child.kill(signal);
  const result = await first.exited;
  assert.deepEqual({ code: result.code, signal: result.signal }, { code: 0, signal: null }, result.stderr);
  assert.ok(await gone(ownerRecordPath(file)), 'owner record must be released');
  const second = await startEntry(t, file, 'q-second');
  second.child.kill(signal);
  assert.equal((await second.exited).code, 0);
}
test('DRSEC-G4a: SIGTERM stop releases ownership and the next process can write', posix, t => stopCase(t, 'SIGTERM'));
test('DRSEC-G4a: SIGINT stop releases ownership and the next process can write', posix, t => stopCase(t, 'SIGINT'));
test('DRSEC-G4a: SIGHUP stop releases ownership and the next process can write', posix, t => stopCase(t, 'SIGHUP'));

test('DRSEC-G4a: a stop after a failed listen exits non-zero', posix, async t => {
  const blocker = createServer();
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => blocker.close());
  const env = { ...process.env, DECISION_DESK_STATE: await ledger(t), DECISION_DESK_PORT: String(blocker.address().port),
    DECISION_DESK_ROOT_AGENT_ID: 'root-test', DECISION_DESK_ROOT_RECEIPT_TOKEN: 'r'.repeat(40), DECISION_DESK_WEBHOOK_SECRET: 'w'.repeat(40) };
  delete env.DECISION_DESK_WEBHOOK_URL;
  // The preload keeps the event loop alive so the stop signal arrives while the process is still up after the failed listen.
  const child = spawn(process.execPath, ['--import', 'data:text/javascript,setInterval(()=>{},1e6)', entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stderr = '';
  const exited = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('listen error timed out')), 3000);
    child.stderr.on('data', d => { stderr += d; if (stderr.includes('konnte nicht starten')) { clearTimeout(timer); resolve(); } });
    exited.then(() => { clearTimeout(timer); reject(new Error(`entry exited early: ${stderr}`)); });
  });
  assert.match(stderr, /konnte nicht starten: EADDRINUSE/);
  child.kill('SIGTERM');
  const result = await exited;
  assert.deepEqual(result, { code: 1, signal: null }, stderr);
});

test('DRSEC-G4a: a failing release on signal stop exits non-zero with a short stderr line', posix, async t => {
  const file = await ledger(t);
  const { child, exited } = await startEntry(t, file, 'q-fail');
  await rm(ownerRecordPath(file));
  child.kill('SIGTERM');
  const result = await exited;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Beenden fehlgeschlagen: OWNERSHIP_RELEASE_MISMATCH/);
});

test('DRSEC-G4a: close without callback and failing release logs once and does not crash', async t => {
  const file = await ledger(t);
  const server = createDeskServer({ statePath: file, rootAgentId: 'root-test' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/questions`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-decision-desk': 'agent' }, body: JSON.stringify(question('q-log')) });
  assert.equal(response.status, 200); await response.text();
  await rm(ownerRecordPath(file));
  const errors = []; t.mock.method(console, 'error', line => errors.push(line));
  let emitted = false; server.on('error', () => { emitted = true; });
  server.close();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(emitted, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], new RegExp(OWNERSHIP_RELEASE_MISMATCH));
});

test('DRSEC-G4a: dual close failure keeps the native error as cause of the release failure', async t => {
  const file = await ledger(t);
  const server = createDeskServer({ statePath: file, rootAgentId: 'root-test' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/questions`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-decision-desk': 'agent' }, body: JSON.stringify(question('q-dual')) });
  assert.equal(response.status, 200); await response.text();
  await rm(ownerRecordPath(file));
  const close = () => new Promise(resolve => server.close(resolve));
  await close();
  const failure = await close(); // Native close now fails with ERR_SERVER_NOT_RUNNING; the store release failed first.
  assert.equal(failure.code, OWNERSHIP_RELEASE_MISMATCH);
  assert.equal(failure.cause?.code, 'ERR_SERVER_NOT_RUNNING');
});

test('DRSEC-G4a: a release failure does not overwrite the cause of the mutation error', async t => {
  const file = await ledger(t), store = new DeskStore(file), original = new Error('orig', { cause: 'kept' });
  await assert.rejects(store.change(async () => { await rm(ownerRecordPath(file)); throw original; }),
    e => e === original && e.cause === 'kept');
  await store.close();
});
