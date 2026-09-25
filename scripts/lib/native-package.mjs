import { createHash } from 'node:crypto';
import { globSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function manifestBytes({ version, commit, protocol, hostSha256 }) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(commit)
      || !Number.isSafeInteger(protocol) || protocol < 1 || protocol > 0xffffffff
      || !/^[a-f0-9]{64}$/.test(hostSha256)) throw new Error('Invalid native package identity');
  return Buffer.from(JSON.stringify({ schemaVersion: 1, purpose: 'projecta-native-host-v1',
    appVersion: version, buildCommit: commit, target: 'x86_64-pc-windows-msvc',
    protocolVersion: protocol, hostName: 'pa-capture-host.exe', hostSha256 }), 'utf8');
}

export const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

export function resourceMapping(tauriRoot, resources, documents) {
  if (!Array.isArray(resources)) throw new Error('Native packaging requires the existing resource list format');
  const mapping = {};
  const targets = new Set(['projecta.exe', 'pa.exe', 'pa-capture-host.exe']);
  const add = (source, target) => {
    const normalized = target.replaceAll('\\', '/');
    if (path.isAbsolute(target) || normalized.split('/').some(part => !part || part === '..' || part === '.')
        || targets.has(normalized.toLowerCase())) throw new Error('Conflicting native package resource destination');
    targets.add(normalized.toLowerCase());
    mapping[source] = normalized;
  };
  for (const pattern of resources) {
    if (typeof pattern !== 'string' || path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..')) {
      throw new Error('Unsupported native package resource path');
    }
    const matches = globSync(pattern, { cwd: tauriRoot }).sort();
    if (!matches.length) throw new Error('Native package resource pattern has no matches');
    for (const relative of matches) {
      const source = path.resolve(tauriRoot, relative);
      if (statSync(source).isDirectory()) continue;
      add(source, relative);
    }
  }
  for (const [source, target] of documents) add(source, target);
  return mapping;
}

function run(binary, args, cwd, env, timeout) {
  const result = spawnSync(binary, args, { cwd, env, timeout, encoding: 'utf8',
    windowsHide: true, maxBuffer: 1024 * 1024 });
  // Signer diagnostics are deliberately not echoed: env credentials stay private.
  if (result.error || result.status !== 0) throw new Error('Native package subprocess failed');
  return result.stdout;
}

export function prepareNativePackage(root, profile, commit, env = process.env) {
  if (!['debug', 'release'].includes(profile)) throw new Error('Invalid native package profile');
  if (!env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('Native package signing key unavailable');
  const tauriRoot = path.join(root, 'src-tauri');
  const config = JSON.parse(readFileSync(path.join(tauriRoot, 'tauri.conf.json'), 'utf8'));
  const protocolSource = readFileSync(path.join(tauriRoot, 'src/process_capture/protocol.rs'), 'utf8');
  const versions = [...protocolSource.matchAll(/pub const VERSION:\s*u32\s*=\s*(\d+);/g)];
  if (versions.length !== 1) throw new Error('Native protocol version unavailable');
  const output = path.join(tauriRoot, 'target', profile);
  const host = path.join(output, 'pa-capture-host.exe');
  const manifest = path.join(output, 'pa-native-host.json');
  const signature = `${manifest}.sig`;
  const bytes = manifestBytes({ version: config.version, commit, protocol: Number(versions[0][1]),
    hostSha256: digest(host) });
  writeFileSync(manifest, bytes);
  const passwordArgs = env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ? [] : ['--password', ''];
  run(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'),
    'signer', 'sign', ...passwordArgs, manifest], root, env, 30_000);
  const hashes = { host: digest(host), manifest: digest(manifest), signature: digest(signature) };
  const verificationEnv = { ...env };
  for (const name of Object.keys(verificationEnv)) {
    if (/^TAURI_SIGNING_PRIVATE_KEY(?:_PASSWORD|_PATH)?$/i.test(name)) delete verificationEnv[name];
  }
  const result = JSON.parse(run(host, ['--verify-native-resources'], output, verificationEnv, 15_000));
  assertUnchanged({ host, manifest, signature, hashes });
  if (result.schemaVersion !== 1 || result.state !== 'signed_host_resources_verified'
      || result.hostSha256 !== hashes.host || result.manifestSha256 !== hashes.manifest
      || result.installedAcceptance !== false) throw new Error('Native package verification receipt mismatch');
  const resources = resourceMapping(tauriRoot, config.bundle.resources,
    [[manifest, 'pa-native-host.json'], [signature, 'pa-native-host.json.sig']]);
  const bundleConfig = path.join(output, 'native-bundle-config.json');
  writeFileSync(bundleConfig, JSON.stringify({ bundle: { resources } }));
  return { host, manifest, signature, hashes, bundleConfig };
}

export function assertUnchanged(inputs) {
  for (const name of ['host', 'manifest', 'signature']) {
    if (digest(inputs[name]) !== inputs.hashes[name]) throw new Error(`Native package ${name} changed during bundling`);
  }
}
