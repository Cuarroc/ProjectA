import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DeskStore } from './store.mjs';

// The CLI entry has no drain-budget knob (drainTimeoutMs stays at its 5 s default and no flag may be added),
// so the timeout case waits out the real budget (5 s + 1 s abort grace) with a notifier that never answers.
const entry = fileURLToPath(new URL('./server.mjs', import.meta.url));
const posixOnly = process.platform === 'win32' ? 'SIGTERM is not delivered to Node on Windows' : false;
const question = id => ({ id, title: 'T', context: 'C', owner: 'O', category: 'K', scope: 'S', source: 'Q', uncertainty: 'U',
  recommendation: { optionIds: ['a'], rationale: 'R' }, options: ['a', 'b'].map(o => ({ id: o, label: o, rationale: 'R', impact: 'I', tradeoff: 'T', effort: 'E', reversible: 'Y' })) });
const missing = file => access(file).then(() => false, e => { if (e.code === 'ENOENT') return true; throw e; });
const within = (promise, ms) => {
  let timer;
  return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), ms); })]).finally(() => clearTimeout(timer));
};
async function workdir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-drain-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function freePort() {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const { port } = probe.address(); await new Promise(r => probe.close(r)); return port;
}
async function startEntry(t, file, { webhook = false, args = [] } = {}) {
  const port = await freePort();
  const env = { ...process.env, DECISION_DESK_STATE: file, DECISION_DESK_PORT: String(port), DECISION_DESK_ROOT_AGENT_ID: 'root-test',
    DECISION_DESK_ROOT_RECEIPT_TOKEN: 'r'.repeat(40), DECISION_DESK_WEBHOOK_SECRET: 'w'.repeat(40) };
  delete env.DECISION_DESK_WEBHOOK_URL;
  if (webhook) env.DECISION_DESK_WEBHOOK_URL = 'https://agentsroom.dev/api/triggers/t_abc123';
  const child = spawn(process.execPath, [...args, entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = { stdout: '', stderr: '' }, waiters = [];
  const feed = (key, d) => { out[key] += d; for (const w of waiters) w(); };
  child.stdout.on('data', d => feed('stdout', d)); child.stderr.on('data', d => feed('stderr', d));
  const done = once(child, 'close').then(([code, signal]) => ({ code, signal, ...out }));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await done; });
  const output = (re, ms = 10000) => within(new Promise(resolve => {
    const check = () => { if (re.test(out.stdout)) resolve(true); };
    waiters.push(check); check();
  }), ms);
  return { child, done, port, output, out };
}

test('DRSEC-G4b: SIGTERM lets an in-flight request finish within the budget and exits 0 and removes the owner record', { skip: posixOnly }, async t => {
  const file = join(await workdir(t), 'ledger.json'), run = await startEntry(t, file);
  assert.equal(await run.output(/http:\/\/127\.0\.0\.1:\d+/), true, run.out.stderr);
  const body = JSON.stringify(question('slow'));
  const socket = connect(run.port, '127.0.0.1'); t.after(() => socket.destroy());
  let reply = ''; socket.on('data', d => { reply += d; });
  await once(socket, 'connect');
  // Expect: 100-continue makes the server answer as soon as the request handler runs, so the request is provably in flight.
  socket.write(`POST /api/questions HTTP/1.1\r\nHost: 127.0.0.1:${run.port}\r\nContent-Type: application/json\r\nX-Decision-Desk: agent\r\nExpect: 100-continue\r\nConnection: close\r\nContent-Length: ${body.length}\r\n\r\n`);
  await within(new Promise(resolve => { const poll = setInterval(() => { if (reply.includes('100 Continue')) { clearInterval(poll); resolve(); } }, 10); }), 5000);
  assert.match(reply, /100 Continue/);
  run.child.kill('SIGTERM');
  // Closing stops the listener first; once connections are refused the stop is under way while the request is still open.
  let refused = false;
  for (let i = 0; i < 300 && !refused; i++) {
    refused = await new Promise(resolve => { const probe = connect(run.port, '127.0.0.1', () => { probe.destroy(); resolve(false); }); probe.on('error', () => resolve(true)); });
    if (!refused) await new Promise(r => setTimeout(r, 10));
  }
  assert.equal(refused, true, 'the listener must be closed while the request is still open');
  assert.equal(await missing(`${file}.owner`), false, 'ownership is held until the request is drained');
  const released = Date.now(); socket.write(body);
  const result = await within(run.done, 10000);
  // Connection: close lets the drain end with the request; a keep-alive socket would idle until the 5 s abort.
  assert.ok(Date.now() - released < 3000, 'the stop must finish by draining, not by the abort deadline');
  assert.equal(result.code, 0, result.stderr); assert.match(reply, /HTTP\/1\.1 200 /);
  assert.ok(await missing(`${file}.owner`));
});

test('DRSEC-G4b: SIGTERM with a notification send that never answers prints one short line and exits non-zero and keeps the owner record', { skip: posixOnly }, async t => {
  const dir = await workdir(t), file = join(dir, 'ledger.json'), store = new DeskStore(file, { rootAgentId: 'root-test' });
  await store.putQuestion(question('q1')); await store.migrate((await store.read()).revision);
  await store.answer({ questionId: 'q1', questionRevision: 1, expectedAnswerId: null, requestId: 'req1', action: 'answer', selected: ['a'], note: 'x' });
  await store.close();
  // The webhook transport is the global fetch; this preload makes it announce itself and never settle.
  const preload = join(dir, 'hang-fetch.mjs');
  await writeFile(preload, "globalThis.fetch = () => { process.stdout.write('SEND-STARTED\\n'); return new Promise(() => {}); };\n");
  const run = await startEntry(t, file, { webhook: true, args: ['--import', pathToFileURL(preload).href] });
  assert.equal(await run.output(/SEND-STARTED/), true);
  run.child.kill('SIGTERM');
  const result = await within(run.done, 20000);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.stderr.trim().split('\n').length, 1, result.stderr);
  assert.match(result.stderr, /^Entscheidungsseite: Beenden fehlgeschlagen: DRAIN_TIMEOUT$/m);
  assert.equal(await missing(`${file}.owner`), false, 'a stuck send keeps the owner record (intended)');
});
