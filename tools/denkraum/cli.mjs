import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
// Only locally constructed diagnostics may reach the terminal.
class CliError extends Error {
  constructor(message, diagnostic = message) {
    super(message);
    this.diagnostic = diagnostic;
  }
}

export async function runCli(args, env = process.env, request = fetch) {
  const base = env.DECISION_DESK_URL ?? 'http://127.0.0.1:4791'; const [command, file] = args;
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runCli(process.argv.slice(2)), null, 2)); }
  catch (e) { console.error(e instanceof CliError ? e.diagnostic : 'Transport request failed'); process.exitCode = 1; }
}
