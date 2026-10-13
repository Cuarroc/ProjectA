// Local stacks: node scripts/ci/package-size.mjs --base <stack-base> --head HEAD
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const configPath = 'scripts/ci/package-size.json';
const git = (...args) => execFileSync('git', args, {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
function parseConfig(raw) {
  const value = JSON.parse(raw);
  if (!value || value.schemaVersion !== 1 || !Number.isSafeInteger(value.maximumLines) ||
      value.maximumLines < 1 || Object.keys(value).length !== 2) {
    throw new Error('invalid package-size configuration');
  }
  return { schemaVersion: value.schemaVersion, maximumLines: value.maximumLines };
}
function configAt(commit) {
  if (!git('ls-tree', '-z', commit, '--', configPath)) return null;
  return parseConfig(git('show', `${commit}:${configPath}`));
}
function main() {
  const { values } = parseArgs({ options: {
    base: { type: 'string', default: 'origin/main' },
    head: { type: 'string', default: 'HEAD' },
  } });
  const resolveCommit = ref => git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).trim();
  const base = resolveCommit(values.base);
  const head = resolveCommit(values.head);
  const mergeBase = git('merge-base', base, head).trim();
  const trusted = configAt(base);
  let candidate = configAt(head);
  if (trusted) {
    if (!candidate || candidate.maximumLines > trusted.maximumLines) {
      throw new Error('candidate configuration missing or maximumLines raised above base');
    }
  } else {
    candidate ??= parseConfig(readFileSync(new URL('./package-size.json', import.meta.url), 'utf8'));
    // Pin the canonical bootstrap config without duplicating its numeric limit.
    const digest = createHash('sha256').update(JSON.stringify(candidate)).digest('hex');
    if (digest !== '2e33358241c75d19f28411a7b9c9551b55ce448a432e26c50c56c0d9aeb775e6') {
      throw new Error('bootstrap configuration differs from the approved configuration');
    }
  }
  const diff = git('diff', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', mergeBase, head, '--');
  let additions = 0;
  let deletions = 0;
  const binary = [];
  for (const record of diff.split('\0').filter(Boolean)) {
    const fields = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record);
    if (!fields) throw new Error('invalid numstat record');
    if (fields[1] === '-' || fields[2] === '-') binary.push(fields[3]);
    else {
      additions += Number(fields[1]);
      deletions += Number(fields[2]);
    }
  }
  const total = additions + deletions;
  if (!Number.isSafeInteger(total)) throw new Error('numstat count exceeds safe integer range');
  console.log(`package-size: base=${base} mergeBase=${mergeBase} head=${head}`);
  console.log(binary.length
    ? `additions=unmeasurable deletions=unmeasurable total=unmeasurable maximumLines=${candidate.maximumLines}`
    : `additions=${additions} deletions=${deletions} total=${total} maximumLines=${candidate.maximumLines}`);
  if (binary.length) {
    console.error(`BLOCKIERT: diff not numerically measurable (binary): ${binary.map(path => JSON.stringify(path)).join(', ')}`);
    return 1;
  }
  return total > candidate.maximumLines ? 1 : 0;
}

try { process.exitCode = main(); }
catch (error) {
  console.error(`package-size: ${error.message}`);
  process.exitCode = 2;
}
