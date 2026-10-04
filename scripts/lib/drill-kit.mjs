// W3-03: the shared evidence-bundle writer for the packaged drills (backup
// here, singleton and crash/power-loss in W3-03b/c). One drill = one folder
// holding manifest.json plus the sanitized files it lists with their hashes.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MANIFEST_VERSION = 1;
const MASK = '[REDACTED]';

// Tokens never reach a bundle: JSON/`key=value` secrets, bearer headers and
// the user's home directory (a profile name is personal data).
export function redact(text) {
  return String(text)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${MASK}`)
    .replace(
      /("?(?:[\w-]*(?:token|secret|password|api[_-]?key|authorization)[\w-]*)"?\s*[:=]\s*)("[^"]*"|[^\s,}]+)/gi,
      (_m, key, value) => `${key}${value.startsWith('"') ? `"${MASK}"` : MASK}`,
    )
    .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, '%USERPROFILE%')
    .replace(/\/home\/[^/\s"']+/g, '~');
}

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const sha256File = (path) => sha256(readFileSync(path));
export function defaultOutDir(drill, cwd = process.cwd(), now = new Date()) {
  return join(cwd, `${drill}-${now.toISOString().replace(/[:.]/g, '-')}`);
}

export function createBundle({ outDir, drill, appVersion = 'unknown', commit = 'unknown', platform = process.platform, now = () => new Date() }) {
  mkdirSync(outDir, { recursive: true });
  const startedAt = now().toISOString();
  const steps = [];
  const files = [];
  return {
    outDir,
    step(name, { command = '', exitCode = 0, detail = '' } = {}) {
      steps.push({ n: steps.length + 1, name, command: redact(command), exitCode, detail: redact(detail), at: now().toISOString() });
    },
    addFile(name, content) {
      const clean = redact(content);
      writeFileSync(join(outDir, name), clean);
      files.push({ name, bytes: Buffer.byteLength(clean), sha256: sha256(clean) });
    },
    finish(notCovered = []) {
      const failed = steps.filter((s) => s.exitCode !== 0);
      const manifest = {
        manifestVersion: MANIFEST_VERSION, drill, appVersion, commit, platform,
        startedAt, endedAt: now().toISOString(), steps, files,
        result: failed.length === 0 && steps.length > 0 ? 'pass' : 'fail',
        notCovered,
      };
      writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      return manifest;
    },
  };
}
