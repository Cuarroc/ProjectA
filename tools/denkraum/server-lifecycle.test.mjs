import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import net, { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { createDeskServer } from './server.mjs';
import { DeskStore } from './store.mjs';

const entry = new URL('./server.mjs', import.meta.url);
const strongSecret = () => randomBytes(24).toString('hex');
const question = id => ({ id, title: 'T', context: 'C', owner: 'O', category: 'K', scope: 'S', source: 'Q', uncertainty: 'U',
  recommendation: { optionIds: ['a'], rationale: 'R' }, options: ['a', 'b'].map(o => ({ id: o, label: o, rationale: 'R', impact: 'I', tradeoff: 'T', effort: 'E', reversible: 'Y' })) });
async function ledger(t) {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-lifecycle-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'ledger.json');
}
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), 3000); })]); }
  finally { clearTimeout(timer); }
}
function childRun(t, args, env = process.env) {
  const child = spawn(process.execPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  const done = once(child, 'close').then(([code, signal]) => ({ code, signal, stdout, stderr }));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await done; });
  return { child, done };
}
async function holdChild(t, file) {
  const run = childRun(t, [join(import.meta.dirname, 'store/ownership-contender.fixture.mjs'), file]);
  const ready = await bounded(Promise.race([once(run.child.stdout, 'data').then(([d]) => JSON.parse(d)), run.done]));
  assert.equal(ready.ready, true);
  return async () => { run.child.stdin.write('release\n'); assert.equal((await bounded(run.done)).code, 0); };
}
function desk(t, file, options = {}) {
  const server = createDeskServer({ statePath: file, rootAgentId: 'root-test', ...options });
  t.after(async () => { server.closeAllConnections(); if (server.listening) await new Promise(r => server.close(r)); });
  return server;
}
async function listen(server, port = 0) {
  const ready = once(server, 'listening'); server.listen(port, '127.0.0.1'); await ready;
}
const missing = file => access(file).then(() => false, e => { if (e.code === 'ENOENT') return true; throw e; });
// Release uses async filesystem calls; yield until their completion, bounded by the same watchdog.
async function ownerGone(file) {
  let polling = true;
  try { assert.equal(await bounded((async () => { do { await setImmediate(); } while (polling && !await missing(`${file}.owner`)); return true; })()), true); }
  finally { polling = false; }
}
async function blocker(t) {
  const server = createServer(); await listen(server); t.after(() => new Promise(r => server.close(r))); return server;
}
async function startEntry(t, file, port) {
  for (let attempt = 1; ; attempt++) {
    let selected = port;
    if (selected === undefined) {
      const probe = createServer(); await listen(probe); selected = probe.address().port; await new Promise(r => probe.close(r));
    }
    const env = { ...process.env, DECISION_DESK_STATE: file, DECISION_DESK_PORT: String(selected), DECISION_DESK_ROOT_AGENT_ID: 'root-test',
      DECISION_DESK_ROOT_RECEIPT_TOKEN: strongSecret(), DECISION_DESK_WEBHOOK_SECRET: strongSecret() };
    delete env.DECISION_DESK_WEBHOOK_URL;
    const result = await childRun(t, [fileURLToPath(entry)], env).done;
    if (port === undefined && attempt < 5 && result.stderr.includes('EADDRINUSE')) continue;
    return result;
  }
}

async function duplicateListen(t, phase) {
  const file = await ledger(t), server = desk(t, file), ready = listen(server);
  if (phase === 'listening') await ready;
  try { assert.throws(() => server.listen(0, '127.0.0.1'), { code: 'ERR_SERVER_ALREADY_LISTEN' }); }
  finally { await ready; }
  assert.equal(await missing(`${file}.owner`), false);
  const owner = await readFile(`${file}.owner`, 'utf8');
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/questions`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-decision-desk': 'agent' }, body: JSON.stringify(question('duplicate')) });
  assert.equal(response.status, 200, await response.text());
  assert.equal(await readFile(`${file}.owner`, 'utf8'), owner);
}
test('DRSEC-G4b: duplicate listen while admitting preserves ownership and writes', t => duplicateListen(t, 'admitting'));
test('DRSEC-G4b: duplicate listen while listening preserves ownership and writes', t => duplicateListen(t, 'listening'));

test('DRSEC-G4b: unhandled admission and bind errors exit non-zero with their code', async t => {
  const file = await ledger(t), owner = desk(t, file); await listen(owner);
  for (const code of ['OWNERSHIP_HELD', 'EADDRINUSE']) {
    const target = code === 'OWNERSHIP_HELD' ? file : await ledger(t);
    const port = code === 'EADDRINUSE' ? owner.address().port : 0;
    const script = `import { createDeskServer } from ${JSON.stringify(entry.href)};
      createDeskServer({ statePath: process.argv[1] }).listen(Number(process.argv[2]), '127.0.0.1');`;
    const result = await bounded(childRun(t, ['--input-type=module', '-e', script, target, String(port)]).done);
    assert.equal(result.code, 1, result.stderr); assert.match(result.stderr, new RegExp(code));
    if (code === 'EADDRINUSE') assert.ok(await missing(`${target}.owner`));
  }
});

test('DRSEC-G4b: listen after close rejects without admission including close during admission', async t => {
  const change = t.mock.method(DeskStore.prototype, 'change');
  for (const duringAdmission of [false, true]) {
    const file = await ledger(t), server = desk(t, file);
    if (duringAdmission) server.listen(0, '127.0.0.1');
    assert.equal((await bounded(new Promise(r => server.close(r)))).code, 'ERR_SERVER_NOT_RUNNING');
    const calls = change.mock.callCount(), failed = once(server, 'error');
    server.listen(0, '127.0.0.1');
    assert.equal((await bounded(failed))[0]?.code, 'ERR_SERVER_NOT_RUNNING');
    assert.equal(change.mock.callCount(), calls); assert.equal(server.listening, false);
    assert.ok(await missing(`${file}.owner`));
  }
});

test('DRSEC-G4b: listen is refused with OWNERSHIP_HELD while a foreign process holds the ledger', async t => {
  const file = await ledger(t), release = await holdChild(t, file), server = desk(t, file);
  const failed = once(server, 'error').then(([e]) => e);
  const outcome = Promise.race([failed, once(server, 'listening').then(() => ({ code: 'LISTENING' }), e => e)]);
  server.listen(0, '127.0.0.1');
  assert.equal((await bounded(outcome)).code, 'OWNERSHIP_HELD');
  assert.equal(server.listening, false); assert.equal(server.address(), null); await release();
});

test('DRSEC-G4b: a listening server owns the ledger before its first write and a second process cannot listen', async t => {
  const file = await ledger(t), server = desk(t, file); await listen(server);
  assert.equal(await missing(`${file}.owner`), false, 'listening must already hold ownership');
  assert.equal(JSON.parse(await readFile(`${file}.owner`)).pid, process.pid);
  const script = `import { createDeskServer } from ${JSON.stringify(entry.href)};
    const s = createDeskServer({ statePath: process.argv[1] });
    s.on('error', e => console.log(JSON.stringify({ listening: s.listening, code: e.code })));
    s.listen(0, '127.0.0.1', () => { console.log(JSON.stringify({ listening: s.listening })); s.close(); });`;
  const result = await bounded(childRun(t, ['--input-type=module', '-e', script, file]).done);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { listening: false, code: 'OWNERSHIP_HELD' });
  assert.equal(await new Promise(r => server.close(r)), undefined); assert.ok(await missing(`${file}.owner`));
});

test('DRSEC-G4b: the CLI entry exits 1 and never prints an address while another process owns the ledger', async t => {
  const file = await ledger(t), release = await holdChild(t, file);
  const result = await bounded(startEntry(t, file));
  assert.equal(result.code, 1); assert.match(result.stderr, /konnte nicht starten: OWNERSHIP_HELD/);
  assert.doesNotMatch(result.stdout, /http:\/\//); await release();
});

test('DRSEC-G4b: stop aborts a stalled request after the drain deadline and still releases ownership', async t => {
  const file = await ledger(t), server = desk(t, file, { drainTimeoutMs: 200 }); await listen(server);
  const socket = connect(server.address().port, '127.0.0.1'); t.after(() => socket.destroy());
  const socketClosed = once(socket, 'close'); await once(socket, 'connect');
  const received = once(server, 'request');
  socket.write(`POST /api/questions HTTP/1.1\r\nHost: 127.0.0.1:${server.address().port}\r\nContent-Type: application/json\r\nX-Decision-Desk: agent\r\nContent-Length: 10\r\n\r\n`);
  await received;
  assert.equal(await bounded(new Promise(r => server.close(r))), undefined);
  assert.notEqual(await bounded(socketClosed), 'timeout'); assert.ok(await missing(`${file}.owner`));
});

test('DRSEC-G4b: stop with an unresolved notification send reports DRAIN_TIMEOUT and keeps the owner record', async t => {
  const file = await ledger(t), store = new DeskStore(file, { rootAgentId: 'root-test' });
  await store.putQuestion(question('q1')); await store.migrate((await store.read()).revision);
  await store.answer({ questionId: 'q1', questionRevision: 1, expectedAnswerId: null, requestId: 'req1', action: 'answer', selected: ['a'], note: 'x' });
  await store.close();
  const entered = Promise.withResolvers();
  const server = desk(t, file, { drainTimeoutMs: 200, notifyEvent: () => { entered.resolve(true); return new Promise(() => {}); } });
  await listen(server); assert.equal(await bounded(entered.promise), true);
  const failure = await bounded(new Promise(r => server.close(r)));
  assert.equal(failure?.code, 'DRAIN_TIMEOUT'); assert.equal(await missing(`${file}.owner`), false);
});

test('DRSEC-G4b: a failed bind after admission leaves no owner record', async t => {
  const file = await ledger(t), port = (await blocker(t)).address().port, server = desk(t, file);
  const failed = once(server, 'error'); server.listen(port, '127.0.0.1');
  assert.equal((await failed)[0].code, 'EADDRINUSE');
  await ownerGone(file);
});

test('DRSEC-G4b: a failed CLI bind releases ownership so a second process can write', async t => {
  const file = await ledger(t), port = (await blocker(t)).address().port;
  const failed = await bounded(startEntry(t, file, port));
  assert.equal(failed.code, 1); assert.match(failed.stderr, /konnte nicht starten: EADDRINUSE/);
  const script = `import { createDeskServer } from ${JSON.stringify(entry.href)};
    const s = createDeskServer({ statePath: process.argv[1] }); s.on('error', e => { throw e; });
    s.listen(0, '127.0.0.1', async () => {
      const r = await fetch('http://127.0.0.1:' + s.address().port + '/api/questions', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-decision-desk': 'agent' }, body: ${JSON.stringify(JSON.stringify(question('restart')))} });
      console.log(r.status); await r.text(); s.close(e => { if (e) throw e; });
    });`;
  const second = await bounded(childRun(t, ['--input-type=module', '-e', script, file]).done);
  assert.equal(second.code, 0, second.stderr); assert.equal(second.stdout.trim(), '200'); assert.ok(await missing(`${file}.owner`));
});

async function freePort() {
  const probe = createServer(); await listen(probe); const { port } = probe.address(); await new Promise(r => probe.close(r)); return port;
}
const refused = port => new Promise(resolve => {
  const socket = connect(port, '127.0.0.1', () => { socket.destroy(); resolve('connected'); });
  socket.on('error', e => resolve(e.code));
});

test('DRSEC-G4b: close during the bind window never serves and leaves no owner record', async t => {
  const file = await ledger(t), port = await freePort(), realListen = net.Server.prototype.listen, parked = Promise.withResolvers(); let bind;
  // createDeskServer captures server.listen at creation, so the stub must be installed before it (and after freePort).
  t.mock.method(net.Server.prototype, 'listen', function (...args) { bind = () => realListen.apply(this, args); parked.resolve(); return this; });
  const server = desk(t, file);
  server.listen(port, '127.0.0.1'); await bounded(parked.promise);
  assert.equal(await missing(`${file}.owner`), false, 'admission completed before the bind is parked');
  assert.equal((await bounded(new Promise(r => server.close(r))))?.code, 'ERR_SERVER_NOT_RUNNING');
  const bound = once(server, 'listening'); bind(); await bounded(bound);
  assert.equal(server.listening, false); assert.equal(await refused(port), 'ECONNREFUSED');
  assert.ok(await missing(`${file}.owner`));
});

test('DRSEC-G4b: a second listen after a failed bind rejects with ERR_SERVER_NOT_RUNNING', async t => {
  const file = await ledger(t), port = (await blocker(t)).address().port, server = desk(t, file);
  const failed = once(server, 'error'); server.listen(port, '127.0.0.1');
  assert.equal((await bounded(failed))[0].code, 'EADDRINUSE');
  const again = once(server, 'error'); server.listen(0, '127.0.0.1');
  assert.equal((await bounded(again))[0]?.code, 'ERR_SERVER_NOT_RUNNING'); assert.equal(server.listening, false);
  await ownerGone(file);
});

test('DRSEC-G4b: a double close releases the store once and prints nothing', async t => {
  const file = await ledger(t), server = desk(t, file); await listen(server);
  const storeClose = t.mock.method(DeskStore.prototype, 'close'), stderr = t.mock.method(console, 'error', () => {});
  server.close(); await bounded(new Promise(r => server.close(r)));
  assert.equal(storeClose.mock.callCount(), 1); assert.equal(stderr.mock.callCount(), 0);
  assert.ok(await missing(`${file}.owner`));
});
