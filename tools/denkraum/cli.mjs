import { readFile } from 'node:fs/promises';
import { isEntry } from './entry.mjs';
// Only locally constructed diagnostics may reach the terminal.
class CliError extends Error {
  constructor(message, diagnostic = message) {
    super(message);
    this.diagnostic = diagnostic;
  }
}

// The Root bearer may only go to a listener that identifies itself as the desk.
// The probe runs only when the global fetch is used; an injected transport
// (tests, programmatic callers) is trusted and not probed.
// Full mutual authentication of the desk is parked (SRV-5).
async function assertDeskService(url, request) {
  const unreachable = new CliError('Decision Desk nicht erreichbar; es wurde kein Token gesendet.');
  const refuse = () => new CliError('Der Dienst am Loopback-Port ist nicht der Decision Desk; es wurde kein Token gesendet.');
  const reply = await request(new URL('/health', url), { signal: AbortSignal.timeout(5000), redirect: 'error' }).catch(() => { throw unreachable; });
  const health = reply.ok ? await reply.json().catch(() => null) : null;
  if (health?.service !== 'decision-desk') throw refuse();
}

export async function runCli(args, env = process.env, request = fetch) {
  const port = env.DECISION_DESK_PORT ?? '4791';
  if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new CliError('DECISION_DESK_PORT muss eine Portnummer von 1 bis 65535 sein.');
  const base = env.DECISION_DESK_URL ?? `http://127.0.0.1:${port}`; const [command, file] = args;
  const routes = { state: '/api/state', pending: '/api/pending', inbox: '/api/inbox', receipt: '/api/receipts', notify: '/api/notifications/retry', progress: '/api/progress', patch: '/api/patches', idea: '/api/ideas', question: '/api/questions', ack: '/api/ack', received: '/api/ack', applied: '/api/ack' };
  const mutation = ['progress', 'patch', 'idea', 'question', 'ack', 'received', 'applied', 'receipt', 'notify'].includes(command);
  const needsFile = mutation && command !== 'notify';
  if (!Object.hasOwn(routes, command) || (needsFile && !file) || args.length > (needsFile ? 2 : 1)) throw new CliError('Aufruf: node cli.mjs state|pending|inbox|notify|receipt <JSON-Datei>|progress <JSON-Datei>|patch <JSON-Datei>|idea <JSON-Datei>|question <JSON-Datei>|received <JSON-Datei>|applied <JSON-Datei>|ack <JSON-Datei>');
  let body = command === 'notify' ? '{}' : undefined; let needsRoot = ['progress', 'patch', 'receipt', 'notify'].includes(command);
  if (needsFile) {
    const text = await readFile(file, 'utf8').catch(() => { throw new CliError('cannot read input file'); });
    let input; try { input = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new CliError('input is not valid JSON'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CliError('JSON-Objekt erforderlich.');
    if (['received', 'applied'].includes(command)) {
      if (input.status && input.status !== command) throw new CliError('Status widerspricht dem CLI-Befehl.');
      input.status = command;
    }
    body = JSON.stringify(input);
    needsRoot ||= input.status === 'received' && input.receipt !== undefined || input.status === 'applied' && input.progress !== undefined;
  }
  const url = new URL(routes[command], base); const authority = {};
  if (needsRoot) {
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw new CliError('Root-Quittierung nur über IPv4-Loopback.');
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(env.DECISION_DESK_ROOT_RECEIPT_TOKEN ?? '')) throw new CliError('Lokale Root-Quittierungsautorität fehlt.');
    if (request === fetch) await assertDeskService(url, request);
    authority.Authorization = `Bearer ${env.DECISION_DESK_ROOT_RECEIPT_TOKEN}`;
  }
  const response = await request(url, mutation ? {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Decision-Desk': 'agent', ...authority },
    body, signal: AbortSignal.timeout(5000), redirect: 'error',
  } : { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    const status = response.status;
    const diagnostic = Number.isInteger(status) && status >= 100 && status <= 599
      ? `HTTP request failed (${status})` : 'HTTP request failed';
    // Fixed rejection for programmatic callers; do not surface server body text.
    throw new CliError(diagnostic, diagnostic);
  }
  return response.json();
}
if (isEntry(import.meta.url, import.meta)) {
  try { console.log(JSON.stringify(await runCli(process.argv.slice(2)), null, 2)); }
  catch (e) { console.error(e instanceof CliError ? e.diagnostic : 'Transport request failed'); process.exitCode = 1; }
}
