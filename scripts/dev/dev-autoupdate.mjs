import * as fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isMain, makeRunner } from '../lib/dev-tools.mjs';

const repo = 'Cuarroc/ProjectA';
const config = fileURLToPath(new URL('../../.gitleaks.toml', import.meta.url));
const hash = text => createHash('sha256').update(text).digest('hex');
// logging.rs emits UTC seconds; also accept fractional UTC seconds and unstamped input.
const stamp = /^\d{4}-\d\d-\d\dT[\d:.]+Z\s*/;
const message = line => line.replace(stamp, '').replace(/^\[panic\]\s*/, '');
const paths = /(?:[A-Za-z]:[\\/]|\\\\|\/|(?:[\w.-]+[\\/]))[^\s"'<>]+/g;
const psQuote = text => `'${text.replaceAll("'", "''")}'`;
class StepError extends Error {}
function checked(run, cmd, args, input) {
  const result = run(cmd, args, { input, timeoutMs: 240_000 });
  if (result.code !== 0) throw new StepError(`${cmd === 'gh' ? 'GitHub' : 'process'} step failed (${result.code})`);
  return result.stdout;
}
const powershell = (run, script) => checked(run, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; ${script}`]);
function processes(run) {
  const list = JSON.parse(powershell(run, '@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath) | ConvertTo-Json -Compress'));
  if (!Array.isArray(list) || !list.every(p => Number.isInteger(p.ProcessId) && Number.isInteger(p.ParentProcessId))) throw new StepError('invalid process inventory');
  if (list.some(p => /^projecta(?: dev)?\.exe$/i.test(p.Name) && !p.ExecutablePath)) throw new StepError('unreadable app process path');
  return list;
}
const devApps = list => list.filter(p => /[\\/]ProjectA Dev[\\/]projecta(?: dev)?\.exe$/i.test(p.ExecutablePath ?? ''));
// NSIS can match the shared executable name: defer while stable is open too.
const busy = list => list.some(p => /^projecta(?: dev)?\.exe$/i.test(p.Name) && !devApps([p]).length)
  || devApps(list).some(app => list.some(p => p.ParentProcessId === app.ProcessId));

export function update(state, { run, folder, save = () => {} }) {
  const latest = JSON.parse(checked(run, 'gh', ['run', 'list', '--repo', repo, '--workflow', 'dev-build.yml', '--branch', 'main', '--status', 'success', '--limit', '1', '--json', 'databaseId,headSha']))[0];
  if (!latest) return 'no successful build';
  if (!/^[a-f0-9]{40}$/.test(latest.headSha) || !Number.isSafeInteger(latest.databaseId)) throw new StepError('invalid build identity');
  if (latest.headSha === state.sha) return 'up to date';
  if (busy(processes(run))) return 'busy, retry next run';
  const download = fs.mkdtempSync(join(folder, 'download-'));
  const closed = [];
  let installed = false;
  try {
    checked(run, 'gh', ['run', 'download', String(latest.databaseId), '--repo', repo, '--name', `projecta-dev-${latest.headSha.slice(0, 7)}`, '--dir', download]);
    const installers = fs.readdirSync(download, { recursive: true }).filter(p => /^ProjectA[ _]Dev_.+_(?:x64|arm64|x86)-setup\.exe$/i.test(p.split(/[\\/]/).at(-1)));
    if (installers.length !== 1) throw new StepError('expected exactly one Dev NSIS installer');
    const current = processes(run);
    if (busy(current)) return 'busy, retry next run';
    for (const app of devApps(current)) {
      const exe = psQuote(app.ExecutablePath);
      // Recheck identity and children immediately before requesting a graceful close.
      powershell(run, `$p=Get-Process -Id ${app.ProcessId}; if ($p.Path -ne ${exe}) { throw 'identity changed' }; if (@(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${app.ProcessId}').Count) { throw 'busy' }; if (!$p.CloseMainWindow()) { throw 'close refused' }; if (!$p.WaitForExit(10000)) { throw 'still running' }`);
      closed.push(app.ExecutablePath);
    }
    const final = processes(run);
    if (devApps(final).length || busy(final)) throw new StepError('app started before install');
    checked(run, join(download, installers[0]), ['/S']);
    state.sha = latest.headSha;
    state.installedAt = new Date().toISOString();
    save();
    installed = true;
  } finally {
    try {
      let restartFailed = false;
      for (const exe of closed) {
        try { powershell(run, `Start-Process -FilePath ${psQuote(exe)}`); }
        catch { restartFailed = true; }
      }
      if (installed && restartFailed) throw new StepError('installed, restart failed');
    } finally {
      fs.rmSync(download, { recursive: true, force: true });
    }
  }
  return 'installed';
}

// Secret ranges come from the same scanner/configuration as secret-scan.sh.
export function scrub(text, env = {}, findings = []) {
  const lines = text.split('\n');
  for (const f of findings) {
    if (!Number.isInteger(f.StartLine) || !Number.isInteger(f.EndLine) || f.StartLine < 1 || f.EndLine < f.StartLine || f.EndLine > lines.length) throw new StepError('invalid secret scan range');
    for (let i = f.StartLine - 1; i < f.EndLine; i++) lines[i] = '[redacted secret line]';
  }
  let safe = lines.join('\n');
  for (const home of [env.USERPROFILE, env.HOME]) {
    if (home) safe = safe.replace(new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\r\\n]*', 'gi'), '[path]');
  }
  safe = safe.replace(paths, '[path]');
  for (const value of [env.USERPROFILE, env.HOME, env.USERNAME, env.USER]) {
    if (value) safe = safe.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[user]');
  }
  return safe;
}
export function group(lines, devSha, now) {
  const groups = new Map();
  for (const line of lines) {
    const signature = message(line).replace(paths, '[path]').replace(/\d+/g, '#');
    const seen = line.match(stamp)?.[0].trim() ?? now;
    const record = groups.get(signature) ?? { signature, firstSeen: seen, lastSeen: seen, count: 0, devSha, context: [] };
    record.firstSeen = record.firstSeen < seen ? record.firstSeen : seen;
    record.lastSeen = record.lastSeen > seen ? record.lastSeen : seen;
    record.count++;
    if (record.context.length < 40) record.context.push(line);
    groups.set(signature, record);
  }
  return [...groups.values()];
}
function read(path) {
  try { return fs.readFileSync(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; }
}
function write(path, value) {
  fs.writeFileSync(`${path}.tmp`, JSON.stringify(value));
  fs.renameSync(`${path}.tmp`, path);
}
export function collect(state, { run, appData, inbox, env, now = new Date().toISOString() }) {
  const logDir = join(appData, 'logs');
  let names = [];
  try { names = fs.readdirSync(logDir).filter(n => /^projecta(?:[_.].*)?\.log(?:\.\d+)?$/.test(n)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const occurrences = new Map(), feedback = new Map(), panicMessages = new Set(), seen = { ...state.seen }, seenFeedback = { ...state.seenFeedback };
  const add = (bucket, line) => {
    const key = hash(line), entry = bucket.get(key) ?? { line, count: 0 };
    entry.count++; bucket.set(key, entry);
  };
  for (const name of names) for (const line of read(join(logDir, name)).split(/\r?\n/)) {
    // logging.rs emits one [component]/[target] tag; panic hooks always add a detail.
    const envelope = line.replace(stamp, '');
    const panic = /^\[panic\] /.test(envelope);
    if (/^\[frontend\] FEEDBACK /.test(envelope)) add(feedback, line);
    else if (panic || /^(?:\[[^\]\r\n]+\] )?ERROR\b/.test(envelope)) {
      add(occurrences, line);
      if (panic) panicMessages.add(hash(message(line)));
    }
  }
  for (const name of ['.panic-last', '.panic-previous']) {
    const marker = read(join(appData, name)).trim();
    if (marker && !panicMessages.has(hash(marker))) { add(occurrences, marker); panicMessages.add(hash(marker)); }
    else if (marker) seen[hash(marker)] = 1;
  }
  const flush = (bucket, seenBucket, target) => {
    const fresh = [];
    for (const [key, { line, count }] of bucket) {
      for (let n = seenBucket[key] ?? 0; n < count; n++) fresh.push(line);
      seenBucket[key] = Math.max(seenBucket[key] ?? 0, count);
    }
    if (!fresh.length) return;
    const raw = fresh.join('\n');
    const scan = run('gitleaks', ['stdin', '--config', config, '--report-format', 'json', '--report-path', '-', '--redact', '--no-banner', '--ignore-gitleaks-allow'], { input: raw, timeoutMs: 60_000 });
    if (![0, 1].includes(scan.code)) throw new StepError('secret scanner unavailable or failed');
    const findings = JSON.parse(scan.stdout || '[]');
    if (!Array.isArray(findings) || (scan.code === 1 && !findings.length)) throw new StepError('invalid secret scan report');
    fs.mkdirSync(target, { recursive: true });
    for (const record of group(scrub(raw, env, findings).split('\n'), state.sha ?? null, now)) {
      const path = join(target, `${hash(record.signature)}.json`), old = read(path);
      if (old) {
        const previous = JSON.parse(old);
        record.firstSeen = previous.firstSeen;
        record.count += previous.count;
        record.context = [...previous.context, ...record.context].slice(-40);
      }
      write(path, record);
    }
  };
  flush(occurrences, seen, inbox);
  flush(feedback, seenFeedback, join(inbox, 'feedback'));
  state.seen = seen;
  state.seenFeedback = seenFeedback;
}
export function main({ env = process.env, platform = process.platform, run = makeRunner() } = {}) {
  let folder, lock, result = 'nothing to do', code = 0, phase = 'setup';
  try {
    if (platform !== 'win32' || !env.LOCALAPPDATA || !env.APPDATA || !env.USERPROFILE) throw new StepError('Windows profile required');
    folder = join(env.LOCALAPPDATA, 'projecta-dev-autoupdate');
    fs.mkdirSync(folder, { recursive: true });
    lock = fs.openSync(join(folder, 'running.lock'), 'wx');
    const path = join(folder, 'state.json'), state = JSON.parse(read(path) || '{}');
    const save = () => write(path, state);
    phase = 'collect';
    collect(state, { run, env, appData: join(env.APPDATA, 'com.projecta.dev'), inbox: env.PA_CRASH_INBOX || join(env.USERPROFILE, 'pa-orch', 'crash-inbox') });
    save();
    phase = 'update';
    result = update(state, { run, folder, save });
  } catch (e) {
    code = 2;
    result = `${phase} failed (${e.code ?? e.name}): ${e instanceof StepError ? e.message : 'invalid data or filesystem operation'}`;
  } finally {
    if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(join(folder, 'running.lock')); }
    const line = `${new Date().toISOString()} exit=${code} ${result}\n`;
    try { if (folder) fs.appendFileSync(join(folder, 'runs.log'), line); }
    catch { process.stderr.write('Could not append runs.log\n'); }
    process.stdout.write(line);
  }
  return code;
}
if (isMain(import.meta.url)) process.exitCode = main();
