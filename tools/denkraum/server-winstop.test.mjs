import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as desk from './server.mjs';

const entry = fileURLToPath(new URL('./server.mjs', import.meta.url));
const stopSignals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'];
async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-winstop-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer().once('error', reject).listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const entryEnv = (statePath, port) => {
  const env = { ...process.env, DECISION_DESK_STATE: statePath, DECISION_DESK_PORT: String(port), DECISION_DESK_ROOT_AGENT_ID: 'root-test',
    DECISION_DESK_ROOT_RECEIPT_TOKEN: 'r'.repeat(40), DECISION_DESK_WEBHOOK_SECRET: 'w'.repeat(40) };
  delete env.DECISION_DESK_WEBHOOK_URL;
  return env;
};

// Windows raises SIGHUP when the console window or tab closes and SIGBREAK on Ctrl+Break; without a listener
// the process dies at once, skips the drain and leaves <state>.owner behind. The listeners exist on every platform.
test('DR-WIN-STOP: the stop path listens for SIGINT SIGTERM SIGHUP and SIGBREAK on every platform', () => {
  const proc = new EventEmitter(), stop = () => {};
  desk.registerStopSignals(stop, proc);
  for (const signal of stopSignals) assert.deepEqual(proc.listeners(signal), [stop], signal);
});

test('DR-WIN-STOP: the real entry registers the stop listeners for SIGHUP and SIGBREAK', async t => {
  const dir = await tempDir(t);
  const probe = 'setTimeout(()=>{process.stderr.write("LISTENERS "+JSON.stringify(["SIGHUP","SIGBREAK"].map(s=>process.listenerCount(s)))+"\\n")},400)';
  const child = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(probe)}`, entry],
    { env: entryEnv(join(dir, 'ledger.json'), await freePort()), stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const counts = await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`no listener report: ${stderr}`)), 5000);
    child.stderr.on('data', d => { stderr += d; const m = /LISTENERS (\[[\d,]+\])/.exec(stderr); if (m) { clearTimeout(timer); resolve(JSON.parse(m[1])); } });
  });
  assert.deepEqual(counts, [1, 1]);
});

test('DR-WIN-STOP: the drain budget (first wait plus forced-close wait) fits the Windows 10 s close grace', () => {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    const { first, forced } = desk.drainBudget(desk.DRAIN_TIMEOUT_MS, signal);
    assert.ok(first + forced < 10_000, `${signal}: ${first} + ${forced}`);
  }
});

// Windows ends the process about 10 s (Node docs) or about 5 s (SetConsoleCtrlHandler docs) after a console close
// event: the effective budget a stop really asks its timers for must stay at 4 s there, and unchanged for SIGINT/SIGTERM.
test('DR-WIN-STOP: console-close signals cap the observed drain at 4 s while SIGINT and SIGTERM keep the full budget', async t => {
  const observed = async signal => {
    const dir = await tempDir(t), asked = [];
    const timers = { setTimeout: (fn, ms) => { asked.push(ms); return setTimeout(fn, ms); }, clearTimeout };
    const server = desk.createDeskServer({ statePath: join(dir, 'ledger.json'), rootAgentId: 'root-test', timers });
    desk.limitDrainForSignal(server, signal);
    await new Promise(resolve => server.close(resolve));
    return asked;
  };
  for (const signal of ['SIGHUP', 'SIGBREAK']) {
    const asked = await observed(signal);
    assert.deepEqual(asked, [3000], signal);
    assert.ok(asked[0] + 1000 <= 4000, signal); // plus at most 1000 ms for the forced close
    assert.equal(desk.drainBudget(desk.DRAIN_TIMEOUT_MS, signal).forced, 1000);
  }
  for (const signal of ['SIGINT', 'SIGTERM']) assert.deepEqual(await observed(signal), [desk.DRAIN_TIMEOUT_MS], signal);
  assert.deepEqual(desk.drainBudget(200, 'SIGHUP'), { first: 200, forced: 200 }); // never raises a smaller budget
});

test('DR-WIN-STOP: an OWNERSHIP_HELD start prints the code and one German hint naming only the owner file basename', async t => {
  const dir = await tempDir(t), file = join(dir, 'ledger.json');
  // A live foreign PID (the parent) on this host stands in for a stale record whose PID was reused;
  // the host field keeps it out of the legacy-record branch added by #896 (c49c3510).
  const host = `${hostname()}:${process.platform}`;
  await writeFile(`${file}.owner`, `${JSON.stringify({ nonce: 'n'.repeat(16), pid: process.pid, heartbeatAt: new Date().toISOString(), host })}\n`);
  const child = spawn(process.execPath, [entry], { env: entryEnv(file, await freePort()), stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no exit: ${stderr}`)), 5000);
    child.once('close', c => { clearTimeout(timer); resolve(c); });
  });
  assert.equal(code, 1, stderr);
  assert.match(stderr, /konnte nicht starten: OWNERSHIP_HELD\n/);
  const hints = stderr.split('\n').filter(line => line.startsWith('Hinweis:'));
  assert.equal(hints.length, 1, stderr);
  assert.match(hints[0], /ledger\.json\.owner/);
  assert.ok(!stderr.includes(dir), 'no absolute path in the hint');
});
