import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertUnchanged, prepareNativePackage } from './lib/native-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (process.platform !== 'win32' || process.arch !== 'x64'
    || args.some(arg => arg !== '--debug') || args.length > 1) {
  throw new Error('Usage on Windows x64: node scripts/build-signed-windows.mjs [--debug]');
}
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('Signing key unavailable');
const git = (...command) => {
  const result = spawnSync('git', command, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Cannot establish source identity');
  return result.stdout.trim();
};
const dirtyAtStart = git('status', '--porcelain');
if (dirtyAtStart) {
  // Name the offending paths: a blind refusal cannot be diagnosed from CI
  // logs (first seen 2026-09-15 on the windows-2025-vs2026 runner image).
  console.error(`Signed packaging requires a clean checkout; dirty:
${dirtyAtStart}`);
  throw new Error('Signed packaging requires a clean checkout');
}
const commit = git('rev-parse', 'HEAD');
const env = { ...process.env, PROJECTA_BUILD_COMMIT: commit };
const cli = path.join(root, 'node_modules/@tauri-apps/cli/tauri.js');
const invoke = (...command) => {
  const result = spawnSync(process.execPath, [cli, ...command], { cwd: root, env,
    stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error('Signed package build failed');
};
invoke('build', '--no-bundle', ...args);
if (git('rev-parse', 'HEAD') !== commit) {
  throw new Error('Source identity changed before native signing: HEAD moved');
}
const dirtyAfterBuild = git('status', '--porcelain');
if (dirtyAfterBuild) {
  console.error(`Source identity changed before native signing; dirty:
${dirtyAfterBuild}`);
  throw new Error('Source identity changed before native signing');
}
const inputs = prepareNativePackage(root, args.length ? 'debug' : 'release', commit, env);
invoke('bundle', '--config', inputs.bundleConfig, ...args);
assertUnchanged(inputs);
if (git('rev-parse', 'HEAD') !== commit || git('status', '--porcelain')) {
  throw new Error('Source identity changed during bundling');
}
console.log(JSON.stringify({ schemaVersion: 1, state: 'native_bundle_inputs_unchanged',
  buildCommit: commit, ...inputs.hashes, packagedPayloadBytesVerified: false }));
