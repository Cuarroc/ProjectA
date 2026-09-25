#!/usr/bin/env node
import { existsSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, dirname, win32, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { readDevConfig } from './lib/dev-config.mjs';

const providers = ['claude', 'codex', 'kimi', 'opencode', 'ollama'];
const manifestRelativePath = 'src-tauri/resources/agent-defaults.json';

// Same contract as `profiles::builtin_manifest_sha256` in Rust: an autocrlf
// checkout on Windows must not read as a different manifest than the build.
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}
export function discoverExecutable(name, { env = process.env, platform = process.platform, stat = statSync } = {}) {
  const windows = platform === 'win32';
  const paths = [...new Set([env.PATH, env.Path].filter(Boolean).flatMap(value => value.split(windows ? ';' : ':')))];
  const path = windows ? win32 : posix;
  if (windows && env.APPDATA) paths.push(path.join(env.APPDATA, 'npm'));
  if (windows && env.LOCALAPPDATA && name === 'ollama') paths.push(path.join(env.LOCALAPPDATA, 'Programs', 'Ollama'));
  const suffixes = windows ? ['.exe', '.cmd', '.bat', ''] : [''];
  let inaccessible = false;
  for (const directory of paths.filter(Boolean)) for (const suffix of suffixes) {
    const candidate = path.join(directory.replace(/^"|"$/g, ''), name + suffix);
    try { if (stat(candidate).isFile()) return { path: candidate, state: 'found-unverified' }; }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) inaccessible = true; }
  }
  return { path: null, state: inaccessible ? 'unavailable-to-inspect' : 'not-found' };
}
export function doctor(root, probe = spawnSync) {
  const checks = [];
  const add = (id, state, detail) => checks.push({ id, state, detail });
  const guide = join(root, '.pa', 'HQ-START.md');
  const expectedGuide = '# Agent start\n\nRead AGENTS.md, then use `pa hq runtime` and `pa hq context --project <id>`.\nUse `npm run dev:doctor -- --json` for local setup diagnostics.\nDo not infer live capabilities from installed executables.\n';
  const command = (name, args) => probe(name, args, { cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true });
  add('node', Number(process.versions.node.split('.')[0]) >= 24 ? 'ok' : 'fail', process.version);
  add('dependencies', existsSync(join(root, 'node_modules')) ? 'ok' : 'fail', 'Run npm ci when dependencies are missing.');
  try { const value = readDevConfig(join(root, 'projecta.dev.json')); add('configuration', 'ok', `schema ${value.schemaVersion}; continuous requested=${value.continuous.enabled}; runtime acceptance is separate`); }
  catch (error) { add('configuration', 'fail', error.message); }
  const manifest = join(root, ...manifestRelativePath.split('/'));
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    if (!Array.isArray(parsed.profiles) && !Array.isArray(parsed)) throw new Error('profiles must be an array');
    add('profile-manifest', 'ok', `shipped agent manifest sha256=${sha256File(manifest)}`);
  } catch (error) { add('profile-manifest', 'fail', `Invalid or missing shipped agent manifest: ${error.message}`); }
  if (!existsSync(guide)) add('setup-guide', 'fail', 'Missing .pa/HQ-START.md; run npm run dev:setup -- --apply.');
  else {
    let actual = '';
    try { actual = readFileSync(guide, 'utf8'); } catch (error) { add('setup-guide', 'fail', `Cannot read .pa/HQ-START.md: ${error.message}`); }
    if (actual) add('setup-guide', actual === expectedGuide ? 'ok' : 'fail', actual === expectedGuide ? 'generated guide matches the setup contract' : 'Stale .pa/HQ-START.md; run npm run dev:setup -- --apply.');
  }
  const git = command('git', ['config', '--get', 'core.hooksPath']);
  add('hooks', git.status === 0 && git.stdout.trim() === '.githooks' ? 'ok' : 'warn', 'Expected clone-local core.hooksPath=.githooks');
  const cargo = command('cargo', ['--version']);
  add('cargo', cargo.status === 0 ? 'ok' : 'warn', cargo.status === 0 ? cargo.stdout.trim() : 'Rust toolchain unavailable');
  const rust = command('rustc', ['--version']);
  const version = rust.stdout?.match(/rustc (\d+)\.(\d+)\.(\d+)/);
  const supported = rust.status === 0 && version && (Number(version[1]) > 1 || (Number(version[1]) === 1 && Number(version[2]) >= 89));
  add('rustc', supported ? 'ok' : 'fail', supported ? rust.stdout.trim() : 'Rust 1.89 or newer is required for crash-released journal locks.');
  for (const name of providers) {
    const found = discoverExecutable(name);
    add(`provider:${name}`, found.state === 'not-found' ? 'fail' : 'warn', found.path ? `Executable found at ${found.path}; authentication, billing, model and tool capabilities are not attested.` : found.state === 'not-found' ? 'Executable not found in the inspected paths.' : 'Executable availability is unknown: one or more candidate paths are inaccessible.');
  }
  add('runtime', 'warn', 'Use pa hq runtime against the running app. This doctor does not launch ProjectA or providers.');
  const setupReady = checks.filter(c => !c.id.startsWith('provider:') && c.id !== 'runtime').every(c => c.state === 'ok');
  return { schemaVersion: 1, observedAt: new Date().toISOString(), source: 'local-read-only-probes', ready: setupReady, setupReady, runtimeReady: false, providersAttested: false, checks };
}

export function setup(root, probe = spawnSync) {
  readDevConfig(join(root, 'projecta.dev.json'));
  const guide = join(root, '.pa', 'HQ-START.md');
  const text = '# Agent start\n\nRead AGENTS.md, then use `pa hq runtime` and `pa hq context --project <id>`.\nUse `npm run dev:doctor -- --json` for local setup diagnostics.\nDo not infer live capabilities from installed executables.\n';
  const changed = [];
  if (!existsSync(guide) || readFileSync(guide, 'utf8') !== text) { mkdirSync(dirname(guide), { recursive: true }); writeFileSync(guide, text); changed.push('.pa/HQ-START.md'); }
  const before = probe('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (before.status !== 0 || before.stdout.trim() !== '.githooks') {
    const result = probe('git', ['config', '--local', 'core.hooksPath', '.githooks'], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error('Cannot set clone-local hooks path');
    changed.push('core.hooksPath');
  }
  return { schemaVersion: 1, changed, continuousEnabled: false };
}

export async function inspectRuntime(env = process.env, request = fetch, root = process.cwd()) {
  const candidates = env.PROJECTA_API_DESCRIPTOR ? [env.PROJECTA_API_DESCRIPTOR] : env.PROJECTA_APP_DATA ? [join(env.PROJECTA_APP_DATA, 'projecta-api.json')] : [
    env.PROJECTA_APP_DATA && join(env.PROJECTA_APP_DATA, 'projecta-api.json'),
    env.APPDATA && join(env.APPDATA, 'com.projecta.app', 'projecta-api.json'),
    join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'com.projecta.app', 'projecta-api.json'),
    join(homedir(), 'Library', 'Application Support', 'com.projecta.app', 'projecta-api.json')].filter(Boolean);
  const path = candidates.find(candidate => existsSync(candidate));
  if (!path) return { id: 'runtime', state: 'warn', detail: 'No running-app descriptor found; ProjectA was not started.' };
  try {
    const descriptor = JSON.parse(readFileSync(path, 'utf8'));
    if (!Number.isInteger(descriptor.port) || descriptor.port < 1 || descriptor.port > 65535 || typeof descriptor.token !== 'string' || !descriptor.token) throw new Error('invalid descriptor');
    const response = await request(`http://127.0.0.1:${descriptor.port}/api/hq/v1/runtime`, { headers: { 'x-projecta-token': descriptor.token }, redirect: 'error', signal: AbortSignal.timeout(2500) });
    if (!response.ok) return { id: 'runtime', state: 'warn', detail: `HQ v1 runtime answered HTTP ${response.status}; start the compatible build when safe.` };
    const runtime = await response.json();
    if (runtime.apiVersion !== 1) throw new Error('incompatible API version');
    const localManifest = join(root, ...manifestRelativePath.split('/'));
    const localDigest = existsSync(localManifest) ? sha256File(localManifest) : null;
    const runtimeDigest = runtime.provenance?.builtinManifestSha256 || null;
    const manifestState = runtimeDigest && localDigest ? (runtimeDigest === localDigest ? 'matched' : 'mismatch') : 'unavailable';
    if (manifestState === 'mismatch') return { id: 'runtime', state: 'warn', detail: 'HQ v1 API reachable, but the running build uses a different agent manifest; restart or rebuild before trusting profile capabilities.', profilesPath: runtime.profilesPath || null, capabilities: runtime.capabilities || {}, manifest: { state: manifestState, localSha256: localDigest, runtimeSha256: runtimeDigest } };
    return { id: 'runtime', state: 'ok', detail: 'HQ v1 API reachable; provider attestation is a separate gate.', profilesPath: runtime.profilesPath || null, capabilities: runtime.capabilities || {}, manifest: { state: manifestState, localSha256: localDigest, runtimeSha256: runtimeDigest } };
  } catch {
    return { id: 'runtime', state: 'warn', detail: 'Descriptor is invalid, app is unreachable, or HQ API is incompatible; no app was started.' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some(x => !['--apply', '--json'].includes(x))) throw new Error('Usage: dev-setup.mjs [--apply] [--json]');
    const result = args.includes('--apply') ? setup(process.cwd()) : doctor(process.cwd());
    if (!args.includes('--apply')) {
      const runtime = await inspectRuntime();
      result.checks = result.checks.map(check => check.id === 'runtime' ? runtime : check);
      result.runtimeReady = runtime.state === 'ok';
    }
    console.log(JSON.stringify(result, null, 2));
    if (result.checks?.some(c => c.state === 'fail')) process.exitCode = 1;
  } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}
