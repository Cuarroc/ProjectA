import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as desk from './server.mjs';

const entry = new URL('./server.mjs', import.meta.url).pathname;
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

// Windows closes the process about 10 s after the close event: the drain budget must fit inside it.
test('DR-WIN-STOP: the drain budget (first wait plus forced-close wait) fits the Windows 10 s close grace', () => {
  assert.ok(desk.DRAIN_TIMEOUT_MS + Math.min(desk.DRAIN_TIMEOUT_MS, 1000) < 10_000);
});

test('DR-WIN-STOP: an OWNERSHIP_HELD start prints the code and one German hint naming only the owner file basename', async t => {
  const dir = await tempDir(t), file = join(dir, 'ledger.json');
  // A live foreign PID (the parent) stands in for a stale record whose PID was reused.
  await writeFile(`${file}.owner`, `${JSON.stringify({ nonce: 'n'.repeat(16), pid: process.pid, heartbeatAt: new Date().toISOString() })}\n`);
  const child = spawn(process.execPath, [entry], { env: entryEnv(file, await freePort()), stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  const code = await new Promise(resolve => child.once('close', resolve));
  assert.equal(code, 1, stderr);
  assert.match(stderr, /konnte nicht starten: OWNERSHIP_HELD\n/);
  const hints = stderr.split('\n').filter(line => line.startsWith('Hinweis:'));
  assert.equal(hints.length, 1, stderr);
  assert.match(hints[0], /ledger\.json\.owner/);
  assert.ok(!stderr.includes(dir), 'no absolute path in the hint');
});
