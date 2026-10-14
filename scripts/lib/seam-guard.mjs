// PreToolUse: deny seam edits unless PA_SEAM_ALLOW lists the repo-relative path or glob.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXACT = new Set(['src-tauri/src/api.rs', 'src-tauri/src/main.rs', 'src-tauri/src/store.rs', 'src-tauri/src/bin/pa.rs']);
const STORE = 'src-tauri/src/store/';
const PHRASE = 'seam file: set PA_SEAM_ALLOW only with an explicit seam assignment (AGENTS.md rule 6)';

function repoRelative(filePath) {
  const parts = [];
  for (const seg of String(filePath).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  const flat = parts.join('/');
  const at = flat.lastIndexOf('src-tauri/src/');
  if (at < 0 || (at > 0 && flat[at - 1] !== '/')) return null;
  return flat.slice(at);
}

function covers(rel, allow) {
  if (!allow) return false;
  return allow.split(',').some((raw) => {
    const pattern = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!pattern) return false;
    const body = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*');
    return new RegExp(`^${body}$`).test(rel);
  });
}

function decision(payload, allow) {
  const input = payload && payload.tool_input;
  const file = input && (input.file_path || input.notebook_path);
  if (typeof file !== 'string' || !file) return null;
  const rel = repoRelative(file);
  const seam = rel && (EXACT.has(rel) || (rel.startsWith(STORE) && rel.length > STORE.length));
  if (!seam || covers(rel, allow)) return null;
  return `${rel}: ${PHRASE}`;
}

function main() {
  let payload;
  try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch {
    process.stderr.write('seam-guard: malformed JSON input; allowing\n');
    return 0;
  }
  try {
    const reason = decision(payload, process.env.PA_SEAM_ALLOW);
    if (reason) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
      }));
    }
  } catch { process.stderr.write('seam-guard: internal error; allowing\n'); }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
