import { createServer } from 'node:http';
import { writeSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, extname, relative, isAbsolute, sep } from 'node:path';
import { DeskStore, DeskError } from './store.mjs';
import { timingSafeEqual, createHmac } from 'node:crypto';
import { validId } from './store/model.mjs';
import { loadStartConfig } from './config.mjs';

const root = dirname(fileURLToPath(import.meta.url));
// R676-O1: every route that reads or writes Root receipts needs a valid root id before the store is called.
const rootBound = ['/api/pending', '/api/inbox', '/api/notifications/retry', '/api/progress', '/api/patches', '/api/receipts', '/api/ack'];
const attribute = v => v.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
export function createWebhookNotifier({ url, secret, request = fetch, clock = Date.now, timeoutMs = 3000 } = {}) {
  if (!url || !secret) return undefined;
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new DeskError('Webhook-Konfiguration ungültig.', 503); }
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'agentsroom.dev' || endpoint.port || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash || !/^\/api\/triggers\/t_[a-f0-9]+$/.test(endpoint.pathname) || typeof secret !== 'string' || secret.length < 32)
    throw new DeskError('Webhook-Konfiguration ungültig.', 503);
  return async (event, deliveryId) => {
    if (event.type !== 'decision-desk.event' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(event.eventId)
      || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(deliveryId) || !Number.isSafeInteger(event.contentRevision) || event.contentRevision < 0)
      throw new DeskError('Webhook-Ereignis ungültig.');
    const body = JSON.stringify({ type: event.type, eventId: event.eventId, contentRevision: event.contentRevision });
    const timestamp = String(Math.floor(clock() / 1000));
    const signature = createHmac('sha256', secret).update(`v1:${timestamp}:${deliveryId}:${body}`).digest('hex');
    let response;
    try {
      response = await request(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), body,
        headers: { 'Content-Type': 'application/json', 'X-AgentsRoom-Timestamp': timestamp, 'X-AgentsRoom-Delivery': deliveryId, 'X-AgentsRoom-Signature': `v1=${signature}` } });
    } catch { throw new DeskError('Webhook-Übertragung fehlgeschlagen.', 503); }
    try { await response.body?.cancel(); } catch { /* Releasing the body cannot change delivery acceptance. */ }
    if (!response.ok) throw new DeskError('Webhook-Übertragung fehlgeschlagen.', 503);
  };
}
// H2: no state default inside the repository. D2: the root agent id is injected; without it every
// root-bound route answers 503 from the store and the page gets no root meta tag.
/** Attach an error listener before listen(); create a new server after a failed bind. */
export function createDeskServer({ statePath, rootAgentId, assets = root,
  rootReceiptToken = process.env.DECISION_DESK_ROOT_RECEIPT_TOKEN, notifyEvent, clock = Date.now, drainTimeoutMs = 5000, timers = { setTimeout, clearTimeout } } = {}) {
  if (typeof statePath !== 'string' || !statePath) throw new DeskError('Datenpfad fehlt; Start abgelehnt.', 503);
  const authorityConfigured = typeof rootReceiptToken === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(rootReceiptToken);
  const store = new DeskStore(statePath, { rootAgentId, notifyEvent, clock, verifyProgressEvidence: authorityConfigured ? async () => true : undefined, verifyPatchAuthority: authorityConfigured ? async () => true : undefined, verifyReceipt: authorityConfigured ? async (request, proof) => ({ ...request,
    rootAgentId, rootAcknowledgedAt: proof?.rootAcknowledgedAt,
    observedProof: proof?.observedProof, verificationMode: 'trusted-local-root-attestation' }) : undefined });
  const requireRootAuthority = req => {
    if (!authorityConfigured) throw new DeskError('Lokale Root-Quittierungsautorität nicht eingerichtet.', 503);
    const actual = Buffer.from(req.headers.authorization ?? ''); const expected = Buffer.from(`Bearer ${rootReceiptToken}`);
    if (req.headers.origin || req.headers['sec-fetch-site'] || actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new DeskError('Lokale Root-Quittierungsautorität erforderlich; Browserzugriff ausgeschlossen.', 403);
  };
  const pending = new Set();
  const track = work => {
    pending.add(work); work.then(() => pending.delete(work), () => pending.delete(work)); return work;
  };
  const handle = async (req, res) => {
    const port = res.socket.localPort;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (!hosts.includes(req.headers.host)) throw new DeskError('Zugriff nur über die lokale Adresse.', 403);
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) throw new DeskError('Fremde Herkunft nicht erlaubt.', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new DeskError('Fremde Website nicht erlaubt.', 403);
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (rootBound.includes(url.pathname) && !validId(rootAgentId)) throw new DeskError('Root-Agent-ID ist nicht konfiguriert; Empfangsprüfung abgelehnt.', 503);
      if (req.method === 'GET') {
        if (url.pathname === '/health') return json(200, { service: 'decision-desk', ok: true });
        if (url.pathname === '/api/state') return json(200, await store.read());
        if (url.pathname === '/api/pending') return json(200, await store.pending());
        if (url.pathname === '/api/inbox') return json(200, await store.inbox());
        const path = url.pathname === '/' ? '/index.html' : url.pathname;
        if (!['/index.html', '/app/questions.js', '/app/ideas.js', '/style.css'].includes(path) && !/^\/previews\/[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(path)) throw new DeskError('Nicht gefunden.', 404);
        const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
        // R676-O2: the allowlist names URLs; the resolved file must also stay physically inside the asset root (no symlink escape).
        const file = await realpath(join(assets, path.slice(1))); const inside = relative(await realpath(assets), file);
        if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new DeskError('Nicht gefunden.', 404);
        let body = await readFile(file);
        if (path === '/index.html' && validId(rootAgentId)) body = Buffer.from(String(body).replace('</head>',
          `  <meta name="decision-desk-root-agent-id" content="${attribute(rootAgentId)}">\n</head>`));
        res.writeHead(200, { 'Content-Type': mime[extname(path)] }); return res.end(body);
      }
      if (req.method !== 'POST') throw new DeskError('Methode nicht erlaubt.', 405);
      if (!origin && req.headers['x-decision-desk'] !== 'agent') throw new DeskError('Lokale Agentenkennung fehlt.', 403);
      if ((req.headers['content-type'] ?? '').split(';')[0] !== 'application/json') throw new DeskError('JSON erforderlich.', 415);
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 128 * 1024) throw new DeskError('Anfrage zu groß.', 413);
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)).replace(/^\uFEFF/, '')); } catch { throw new DeskError('Ungültiges JSON oder UTF-8.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DeskError('JSON-Objekt erforderlich.');
      if (url.pathname === '/api/questions') return json(200, await store.putQuestion(input));
      if (['/api/answers', '/api/ideas'].includes(url.pathname)) {
        const saved = url.pathname === '/api/ideas' ? await store.putIdea(input) : await store.answer(input);
        if (saved.webhookDelivery?.attempts === 0) {
          try { await store.flushNotifications(saved.eventId ?? saved.id); } catch { /* Answer remains committed; the durable outbox permits retry. */ }
        }
        return json(200, { ...saved, savedAcceptance: true });
      }
      if (url.pathname === '/api/notifications/retry') { requireRootAuthority(req); return json(200, await store.flushNotifications()); }
      if (url.pathname === '/api/progress') { requireRootAuthority(req); return json(200, await store.putProgress(input)); }
      if (url.pathname === '/api/patches') { requireRootAuthority(req); return json(200, await store.putPatch(input)); }
      if (url.pathname === '/api/receipts') { requireRootAuthority(req); return json(200, await store.receipt(input)); }
      if (url.pathname === '/api/ack') {
        if (input.status === 'received' && input.receipt !== undefined || input.status === 'applied' && input.progress !== undefined) requireRootAuthority(req);
        return json(200, await store.ack(input));
      }
      throw new DeskError('Nicht gefunden.', 404);
    } catch (e) {
      json(e.code === 'ENOENT' ? 404 : e.status ?? 500, { error: e instanceof DeskError ? e.message : e.code === 'ENOENT' ? 'Nicht gefunden.' : 'Speichern oder Laden fehlgeschlagen. Daten bleiben erhalten; bitte erneut versuchen.' });
    }
  };
  const server = createServer((req, res) => { track(handle(req, res)); });
  let timer; let running = false; let closed = false; let admitting = false; let backoff = 1000;
  const schedule = delay => {
    if (closed || running || timer || typeof notifyEvent !== 'function') return;
    timer = timers.setTimeout(async () => {
      timer = undefined; if (closed || running) return; running = true;
      let result;
      try { result = await track(store.flushNotifications()); } catch { result = { status: 'pending' }; }
      running = false;
      backoff = result.status === 'queued' ? 1000 : Math.min(backoff * 2, 60000);
      schedule(result.status === 'queued' ? 250 : backoff);
    }, delay);
    timer?.unref?.();
  };
  server.on('listening', () => { if (closed) close.call(server); else schedule(0); });
  const stopTimer = () => { closed = true; if (timer) timers.clearTimeout(timer); timer = undefined; };
  server.on('close', stopTimer);
  const listen = server.listen;
  server.listen = (...args) => {
    if (closed) {
      process.nextTick(() => server.emit('error', Object.assign(new Error('Server is closed'), { code: 'ERR_SERVER_NOT_RUNNING' })));
      return server;
    }
    if (server.listening) return listen.apply(server, args);
    if (admitting) throw Object.assign(new Error('Listen already called'), { code: 'ERR_SERVER_ALREADY_LISTEN' });
    admitting = true;
    track(store.change(() => undefined).then(() => {
      if (closed) return;
      const admitted = () => { admitting = false; server.removeListener('error', release); };
      const release = error => {
        admitting = false; server.removeListener('listening', admitted);
        const unhandled = server.listenerCount('error') === 0;
        store.close().catch(e => console.error(`Entscheidungsseite: Speicher nicht freigegeben: ${e?.code ?? 'Fehler'}`))
          .then(() => { if (unhandled) process.nextTick(() => { throw error; }); });
      };
      server.prependOnceListener('error', release);
      server.once('listening', admitted);
      listen.apply(server, args);
    }).catch(error => { admitting = false; process.nextTick(() => server.emit('error', error)); }));
    return server;
  };
  const within = async (work, ms) => {
    let deadline;
    try { return await Promise.race([work.then(() => true), new Promise(resolve => { deadline = timers.setTimeout(() => resolve(false), ms); })]); }
    finally { timers.clearTimeout(deadline); }
  };
  const close = server.close;
  // A failed release goes to the callback, else to one stderr line; never to 'error' (no listener, no crash).
  server.close = callback => {
    stopTimer();
    let error;
    const native = new Promise(resolve => close.call(server, e => { error = e; resolve(); }));
    const drained = (async () => { await native; while (pending.size) await Promise.allSettled([...pending]); })();
    (async () => {
      if (!await within(drained, drainTimeoutMs)) {
        server.closeAllConnections();
        if (!await within(drained, Math.min(drainTimeoutMs, 1000)))
          throw Object.assign(new Error('Server drain timed out'), { code: 'DRAIN_TIMEOUT' });
      }
      await store.close();
    })().then(() => callback?.(error), failure => {
      if (error) { try { failure.cause ??= error; } catch { /* Preserve even immutable thrown values. */ } }
      if (callback) callback(failure); else console.error(`Entscheidungsseite: Speicher nicht freigegeben: ${failure?.code ?? 'Fehler'}`);
    });
    return server;
  };
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flag = process.argv.indexOf('--root-agent-id');
  const env = flag > 1 ? { ...process.env, DECISION_DESK_ROOT_AGENT_ID: process.argv[flag + 1] } : process.env;
  const { config, errors } = loadStartConfig(env, { repoRoot: join(root, '..', '..') });
  for (const { name, reason } of errors) console.error(`${name}: ${reason}`);
  if (errors.length) process.exitCode = 1;
  else {
    const { port, statePath, rootAgentId, rootReceiptToken, webhookSecret, webhookUrl } = config;
    const server = createDeskServer({ statePath, rootAgentId, rootReceiptToken, notifyEvent: createWebhookNotifier({
      url: webhookUrl, secret: webhookSecret }) });
    server.on('error', e => {
      try { writeSync(2, `Entscheidungsseite konnte nicht starten: ${e.code ?? e.message}\n`); } catch { /* stderr gone */ }
      process.exitCode = 1;
    });
    let listening = false;
    server.listen(port, '127.0.0.1', () => { listening = true; console.log(`Entscheidungsseite: http://127.0.0.1:${server.address().port}`); });
    // Stop by signal releases the ledger ownership before exit; a second signal while closing exits at once.
    let stopping = false;
    const stop = () => {
      if (stopping) process.exit(1);
      stopping = true;
      server.close(failure => {
        // R872-K4: only a server that was listening may report a clean stop. R872-K3: the line is written
        // synchronously so a pipe cannot lose it to the immediate exit.
        if (failure || !listening) {
          try { writeSync(2, `Entscheidungsseite: Beenden fehlgeschlagen: ${failure?.code ?? 'nicht gestartet'}\n`); } catch { /* stderr gone; the exit code still reports it */ }
          process.exit(1);
        }
        process.exit(0);
      });
    };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    // R872-K1: a closed terminal or ssh session sends SIGHUP; Windows cannot deliver it.
    if (process.platform !== 'win32') process.on('SIGHUP', stop);
  }
}
