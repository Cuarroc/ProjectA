// Fail-closed loader for the user's app release attestation (E20).
// Only the user writes .pa/release_attestation_v1.5.0.json; no agent does.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const ATTESTATION_RELEASE = 'v1.5.0';
const KEYS = ['commit', 'continuousEnabled', 'decidedAt', 'decidedBy', 'release', 'rows'];
const ROWS = Array.from({ length: 26 }, (_, i) => i + 1);
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const no = reason => ({ attested: false, reason });

/** Returns `{ attested, reason? }`; never throws. */
export function loadReleaseAttestation(file, root = process.cwd()) {
  try {
    const rel = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
    if (!rel || rel === '..' || rel.startsWith('../')) return no('attestation path must be inside the repository');
    let data;
    try {
      data = JSON.parse(readFileSync(path.resolve(root, file), 'utf8'));
    } catch (error) {
      return no(`attestation file unreadable or not JSON: ${error.code ?? 'parse error'}`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return no('attestation must be a JSON object');
    const keys = Object.keys(data).sort();
    if (keys.join() !== KEYS.join()) return no(`attestation keys must be exactly ${KEYS.join(', ')}`);
    if (data.release !== ATTESTATION_RELEASE) return no(`release must be ${ATTESTATION_RELEASE}`);
    if (JSON.stringify(data.rows) !== JSON.stringify(ROWS)) return no('rows must be exactly 1..26');
    if (typeof data.decidedAt !== 'string' || !ISO_8601.test(data.decidedAt) || Number.isNaN(Date.parse(data.decidedAt))) {
      return no('decidedAt must be an ISO 8601 timestamp');
    }
    if (typeof data.decidedBy !== 'string' || data.decidedBy.trim() === '') return no('decidedBy must be non-empty');
    if (data.continuousEnabled !== false) return no('continuousEnabled must be false');
    if (typeof data.commit !== 'string' || data.commit === '') return no('commit must be a non-empty string');
    let head;
    try {
      head = git(root, ['rev-parse', 'HEAD']).trim();
      const tracked = git(root, ['ls-files', '--stage', '--', rel]).trim();
      if (!/^100(?:644|755) [0-9a-f]+ 0\t/.test(tracked)) {
        return no('attestation file unreadable: it must be a committed regular file');
      }
      if (git(root, ['status', '--porcelain']).trim() !== '') return no('work tree is not clean');
      const committed = JSON.parse(git(root, ['show', `HEAD:${rel}`]));
      if (JSON.stringify(data) !== JSON.stringify(committed)) {
        return no('attestation file does not match its committed content');
      }
    } catch {
      return no('git state unavailable (not a repository or no commit)');
    }
    if (data.commit !== head) {
      try {
        git(root, ['merge-base', '--is-ancestor', data.commit, head]);
      } catch {
        return no('commit does not match HEAD: it must be an ancestor');
      }
      // Committing the attestation itself moves HEAD by one commit; accept
      // exactly the commits that touch nothing but the attestation file.
      let changed = null;
      try {
        changed = git(root, ['diff', '--name-only', `${data.commit}..${head}`]).split('\n').filter(Boolean);
      } catch { /* unknown commit: falls through to the mismatch */ }
      if (!changed || changed.length === 0 || changed.some(name => name !== rel)) {
        return no('commit does not match HEAD');
      }
    }
    return { attested: true };
  } catch (error) {
    return no(`attestation check failed: ${error.message}`);
  }
}
