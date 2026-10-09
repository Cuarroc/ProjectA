import assert from 'node:assert/strict';
import { createServer as createPortProbe } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDeskServer, createWebhookNotifier } from './server.mjs';
import { loadStartConfig } from './config.mjs';
import { DeskError, DeskStore } from './store.mjs';

const ROOT = 'test-root-agent';
const TOKEN = 'test-only-root-receipt-token-0123456789';
const WEBHOOK = 'b'.repeat(32);
const serverFile = fileURLToPath(new URL('./server.mjs', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const repoState = fileURLToPath(new URL('../../state.json', import.meta.url));
const env = extra => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DECISION_DESK_'))),
  DECISION_DESK_ROOT_RECEIPT_TOKEN: TOKEN, DECISION_DESK_WEBHOOK_SECRET: WEBHOOK, ...extra });
async function snapshot(dir) {
  const names = (await readdir(dir, { recursive: true })).sort();
  const files = [];
  for (const name of names) files.push([name, await readFile(join(dir, name)).catch(() => null)]);
  return { names, files };
}

test('webhook preflight matches notifier URL rules and redacts invalid URLs at both entries', () => {
  const url = 'https://agentsroom.dev/api/triggers/t_abc123';
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  for (const value of [url, url.replace('https:', 'http:'), url.replace('.dev', '.invalid'),
    url.replace('.dev', '.dev:444'), url.replace('://', '://user:pass@'), `${url}?secret=synthetic`,
    `${url}#synthetic`, `${url}/extra`, 'invalid-synthetic-url']) {
    const ready = env({ DECISION_DESK_STATE: join(tmpdir(), 'synthetic-ledger.json'),
      DECISION_DESK_ROOT_AGENT_ID: ROOT, DECISION_DESK_WEBHOOK_URL: value });
    const result = loadStartConfig(ready, { repoRoot });
    const valid = value === url;
    assert.equal(result.ok, valid);
    if (valid) {
      assert.deepEqual(result.config.notifications, { enabled: true, reason: null });
      assert.equal(typeof createWebhookNotifier({ url: value, secret: ready.DECISION_DESK_WEBHOOK_SECRET }), 'function');
    } else assert.throws(() => createWebhookNotifier({ url: value, secret: ready.DECISION_DESK_WEBHOOK_SECRET }), DeskError);
    for (const args of [[fileURLToPath(new URL('config.mjs', import.meta.url)), '--check'], ...valid ? [] : [[serverFile]]]) {
      const run = spawnSync(process.execPath, args, { env: ready, encoding: 'utf8', timeout: 2000 });
      assert.equal(run.error, undefined);
      assert.equal(run.status, valid ? 0 : 1);
      if (valid) assert.match(run.stdout, /DECISION_DESK_WEBHOOK_URL: notifications enabled/);
      else assert.match(run.stderr, /^DECISION_DESK_WEBHOOK_URL: [^\n]+\n$/);
      assert.ok(!(run.stdout + run.stderr).includes(value));
    }
  }
});
function start(args, extra) {
  const child = spawn(process.execPath, [serverFile, ...args], { env: env(extra) }); let out = ''; let err = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
  const exited = new Promise(resolve => child.on('exit', code => resolve({ code, out, err })));
  const listening = new Promise((resolve, reject) => {
    child.stdout.on('data', () => { const m = /http:\/\/127\.0\.0\.1:\d+/.exec(out); if (m) resolve(m[0]); });
    exited.then(r => reject(new Error(`exit ${r.code}: ${r.err}`)));
  });
  listening.catch(() => {}); // only the start test awaits it
  return { child, exited, listening };
}
async function ledger({ answered = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-server-')); const statePath = join(dir, 'state.json');
  const s = new DeskStore(statePath, { rootAgentId: ROOT });
  await s.putQuestion({ id: 'E-1', title: 'T', context: 'C', owner: 'O', category: 'K', scope: 'S', source: 'Q', uncertainty: 'U',
    recommendation: { optionIds: ['a'], rationale: 'R' }, options: ['a', 'b'].map(id => ({ id, label: id, rationale: 'r', impact: 'i', tradeoff: 't', effort: 'e', reversible: 'ja' })) });
  await s.migrate((await s.read()).revision);
  if (answered) await s.answer({ questionId: 'E-1', questionRevision: 1, expectedAnswerId: null, requestId: 'req-1', action: 'answer', selected: ['a'], note: '' });
  await s.close(); // Release fixture ownership before a child server opens the ledger.
  return { dir, statePath };
}
async function serve(options) {
  const server = createDeskServer(options); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise(resolve => server.close(resolve)) };
}

test('the start is refused without a state path or root agent id and names only the variables', async () => {
  const { code, out, err } = await start([], {}).exited;
  assert.equal(code, 1); assert.equal(out, '');
  assert.match(err, /DECISION_DESK_STATE:/); assert.match(err, /DECISION_DESK_ROOT_AGENT_ID:/); assert.ok(!err.includes(TOKEN));
});

test('the server entry refuses to start without token/webhook secret', async () => {
  const { statePath } = await ledger();
  const ready = { DECISION_DESK_STATE: statePath, DECISION_DESK_ROOT_AGENT_ID: ROOT,
    DECISION_DESK_PORT: '65432', DECISION_DESK_WEBHOOK_SECRET: 'b'.repeat(32) };
  for (const key of ['DECISION_DESK_ROOT_RECEIPT_TOKEN', 'DECISION_DESK_WEBHOOK_SECRET']) {
    for (const value of [undefined, '', 'short']) {
      const run = spawnSync(process.execPath, [serverFile], {
        env: Object.fromEntries(Object.entries(env({ ...ready, [key]: value })).filter(([, v]) => v !== undefined)),
        encoding: 'utf8', timeout: 2000,
      });
      assert.equal(run.status, 1);
      assert.equal(run.stdout, '');
      assert.match(run.stderr, new RegExp(`${key}:`));
      for (const secret of [TOKEN, ready.DECISION_DESK_WEBHOOK_SECRET, statePath]) {
        assert.ok(!run.stderr.includes(secret));
      }
    }
  }
});

test('a state path inside the repository is refused even with a root agent id', async () => {
  const { code, out, err } = await start(['--root-agent-id', ROOT], { DECISION_DESK_STATE: repoState }).exited;
  assert.equal(code, 1); assert.equal(out, ''); assert.match(err, /DECISION_DESK_STATE: must be outside the repository/);
  assert.doesNotMatch(err, /ROOT_AGENT_ID/); assert.ok(!err.includes(repoState));
});

test('an outside state path and a root agent id from the environment start the server', async () => {
  for (const args of [[], ['--root-agent-id', ROOT]]) {
    const { statePath } = await ledger();
    const probe = createPortProbe();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = String(probe.address().port);
    await new Promise(resolve => probe.close(resolve));
    const run = start(args, { DECISION_DESK_STATE: statePath,
      DECISION_DESK_ROOT_AGENT_ID: args.length ? 'invalid/id' : ROOT, DECISION_DESK_PORT: port });
    try {
      const base = await run.listening;
      assert.deepEqual(await (await fetch(`${base}/health`)).json(), { service: 'decision-desk', ok: true });
      assert.equal((await post(base, '/api/receipts', { eventRef: {} })).status, 400);
      assert.match(await (await fetch(`${base}/index.html`)).text(), /content="test-root-agent"/);
    } finally { run.child.kill(); await run.exited; }
  }
});

test('without a root agent id the HTTP paths that need it answer 503 and the page carries no root id', async () => {
  assert.throws(() => createDeskServer({}), e => e instanceof DeskError && e.status === 503);
  const { statePath } = await ledger();
  for (const [rootAgentId, expected] of [[undefined, 503], [ROOT, 200]]) {
    const { base, close } = await serve({ statePath, rootAgentId, rootReceiptToken: TOKEN });
    try {
      assert.equal((await fetch(`${base}/api/pending`)).status, expected);
      assert.equal((await fetch(`${base}/api/inbox`)).status, expected);
      const receipt = await fetch(`${base}/api/receipts`, { method: 'POST', body: JSON.stringify({ eventRef: {} }),
        headers: { 'content-type': 'application/json', 'x-decision-desk': 'agent', authorization: `Bearer ${TOKEN}` } });
      assert.equal(receipt.status, rootAgentId ? 400 : 503);
      const page = await (await fetch(`${base}/index.html`)).text();
      assert.equal(page.includes('name="decision-desk-root-agent-id"'), Boolean(rootAgentId));
      if (rootAgentId) assert.match(page, /<meta name="decision-desk-root-agent-id" content="test-root-agent">\n<\/head>/);
    } finally { await close(); }
  }
});

test('static files follow the DR-09/DR-10 allowlist and /app.js is gone', async () => {
  const { dir, statePath } = await ledger(); const assets = join(dir, 'assets'); await mkdir(join(assets, 'app'), { recursive: true });
  for (const f of ['index.html', 'style.css', 'app/questions.js', 'app/ideas.js', 'app.js', 'config.mjs']) await writeFile(join(assets, f), `/* ${f} */`);
  const { base, close } = await serve({ statePath, rootAgentId: ROOT, assets });
  try {
    for (const path of ['/app/questions.js', '/app/ideas.js']) {
      const r = await fetch(base + path); assert.equal(r.status, 200, path); assert.equal(r.headers.get('content-type'), 'text/javascript; charset=utf-8');
    }
    for (const path of ['/app.js', '/config.mjs', '/app/../config.mjs', '/store.mjs']) assert.equal((await fetch(base + path)).status, 404, path);
  } finally { await close(); }
});

const post = (base, path, body) => fetch(base + path, { method: 'POST', body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', 'x-decision-desk': 'agent', authorization: `Bearer ${TOKEN}` } });

test('without a root agent id every root-bound route answers 503 on an empty ledger and for replays (R676-O1)', async () => {
  const { statePath } = await ledger({ answered: false });
  const configured = new DeskStore(statePath, { rootAgentId: ROOT, verifyReceipt: async r => ({ ...r, rootAgentId: ROOT,
    rootAcknowledgedAt: '2026-10-08T12:00:00.000Z', observedProof: 'synthetic proof' }), verifyPatchAuthority: async () => true });
  const a = await configured.answer({ questionId: 'E-1', questionRevision: 1, expectedAnswerId: null, requestId: 'req-1', action: 'answer', selected: ['a'], note: '' });
  const eventRef = { kind: 'answer', eventId: a.id, questionId: 'E-1', questionRevision: 1 };
  const receipt = { receiptId: 'rcpt-1', eventRef, transportMessageId: 'mail-1', rootReplyId: 'reply-1' };
  const patch = { requestId: 'patch-1', expectedRevision: null, label: 'Plan', windowText: 'W', sourceRefs: [eventRef], reason: 'R', authorityEvidenceRefs: ['ok-1'] };
  const empty = await ledger({ answered: false }); await configured.receipt(receipt); await configured.putPatch(patch);
  for (const path of [empty.statePath, statePath]) {
    const { base, close } = await serve({ statePath: path, rootReceiptToken: TOKEN });
    try {
      for (const route of ['/api/pending', '/api/inbox']) assert.equal((await fetch(base + route)).status, 503, route);
      for (const [route, body] of [['/api/notifications/retry', {}], ['/api/receipts', receipt], ['/api/patches', patch], ['/api/progress', {}], ['/api/ack', { answerId: a.id }]])
        assert.equal((await post(base, route, body)).status, 503, route);
    } finally { await close(); }
  }
});

test('a symlinked asset that leaves the asset root is not served (R676-O2)', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-assets-')); const outside = join(dir, 'outside'); const assets = join(dir, 'assets');
  await mkdir(outside); await mkdir(join(assets, 'linked'), { recursive: true }); await writeFile(join(outside, 'questions.js'), 'outside-secret');
  try {
    await symlink(join(outside, 'questions.js'), join(assets, 'style.css'), 'file');
    await symlink(outside, join(assets, 'app'), 'dir');
  } catch (e) { if (e.code === 'EPERM') return t.skip('symlinks need extra rights on this machine'); throw e; }
  const { statePath } = await ledger({ answered: false });
  const { base, close } = await serve({ statePath, rootAgentId: ROOT, assets });
  try {
    for (const path of ['/style.css', '/app/questions.js']) {
      const r = await fetch(base + path); assert.equal(r.status, 404, path); assert.ok(!(await r.text()).includes('outside-secret'), path);
    }
  } finally { await close(); }
});

test('the server entry validates ports and explicit root overrides through the full config', async () => {
  const { statePath } = await ledger();
  const ready = { DECISION_DESK_STATE: statePath, DECISION_DESK_ROOT_AGENT_ID: ROOT };
  for (const [args, extra, name] of [
    [[], { DECISION_DESK_PORT: '0' }, 'PORT'],
    [['--root-agent-id', 'invalid/id'], {}, 'ROOT_AGENT_ID'],
    [['--root-agent-id'], {}, 'ROOT_AGENT_ID'],
    [['--root-agent-id', ROOT], { DECISION_DESK_ROOT_AGENT_ID: '', DECISION_DESK_PORT: '0' }, 'PORT'],
  ]) {
    const run = spawnSync(process.execPath, [serverFile, ...args], {
      env: env({ ...ready, ...extra }), encoding: 'utf8', timeout: 2000,
    });
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, new RegExp(`DECISION_DESK_${name}:`));
    if (name === 'PORT') assert.doesNotMatch(run.stderr, /ROOT_AGENT_ID/);
    for (const value of [TOKEN, statePath, 'invalid/id']) assert.ok(!run.stderr.includes(value));
  }
});

// P3 residual: entrypoint cases only proven at config.mjs before (#750/#809).
test('DRSEC: startup applies all secret and port preflight failures before listening', async () => {
  const { dir, statePath } = await ledger();
  const before = await snapshot(dir);
  const ready = { DECISION_DESK_STATE: statePath, DECISION_DESK_ROOT_AGENT_ID: ROOT, DECISION_DESK_PORT: '65432' };
  for (const [key, value, name] of [
    ['DECISION_DESK_ROOT_RECEIPT_TOKEN', `${TOKEN}!`, 'ROOT_RECEIPT_TOKEN'],
    ['DECISION_DESK_WEBHOOK_SECRET', `${WEBHOOK}\n`, 'WEBHOOK_SECRET'],
    ['DECISION_DESK_WEBHOOK_SECRET', TOKEN, 'WEBHOOK_SECRET'],
    ['DECISION_DESK_PORT', '65536', 'PORT'],
  ]) {
    const run = spawnSync(process.execPath, [serverFile], {
      env: Object.fromEntries(Object.entries(env({ ...ready, [key]: value })).filter(([, v]) => v !== undefined)),
      encoding: 'utf8', timeout: 2000,
    });
    assert.equal(run.status, 1, name);
    assert.equal(run.stdout, '');
    assert.doesNotMatch(run.stdout + run.stderr, /http:\/\/127\.0\.0\.1/);
    assert.match(run.stderr, new RegExp(`DECISION_DESK_${name}:`));
    for (const secret of [TOKEN, WEBHOOK, `${TOKEN}!`, statePath]) assert.ok(!(run.stdout + run.stderr).includes(secret));
  }
  assert.deepEqual(await snapshot(dir), before);
});

// P6 residual: config-level physical aliases are covered; this asserts the server entry.
test('DRSEC: startup rejects physical state aliases into the repository', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'denkraum-p6-'));
  const alias = join(fixture, 'into-repo');
  try { await symlink(repoRoot, alias, 'dir'); }
  catch (e) { if (e.code === 'EPERM') return t.skip('symlinks need extra rights on this machine'); throw e; }
  const external = join(fixture, 'external'); await mkdir(external);
  // Top-level only: recursive readdir would follow the repo alias.
  const before = [(await readdir(fixture)).sort(), await readdir(external)];
  for (const state of [join(alias, 'ledger.json'), join(alias, 'missing', 'nested', 'ledger.json')]) {
    const run = spawnSync(process.execPath, [serverFile], {
      env: env({ DECISION_DESK_STATE: state, DECISION_DESK_ROOT_AGENT_ID: ROOT, DECISION_DESK_PORT: '65432' }),
      encoding: 'utf8', timeout: 2000,
    });
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.doesNotMatch(run.stdout + run.stderr, /http:\/\/127\.0\.0\.1/);
    assert.match(run.stderr, /DECISION_DESK_STATE: must be outside the repository/);
    for (const value of [state, alias, repoRoot, fixture]) assert.ok(!(run.stdout + run.stderr).includes(value));
  }
  assert.deepEqual([(await readdir(fixture)).sort(), await readdir(external)], before);
  const ok = spawnSync(process.execPath, [serverFile], {
    env: env({ DECISION_DESK_STATE: join(external, 'ledger.json'), DECISION_DESK_ROOT_AGENT_ID: ROOT, DECISION_DESK_PORT: '0' }),
    encoding: 'utf8', timeout: 2000,
  });
  assert.equal(ok.status, 1);
  assert.match(ok.stderr, /DECISION_DESK_PORT:/);
  assert.doesNotMatch(ok.stderr, /DECISION_DESK_STATE:/);
});
