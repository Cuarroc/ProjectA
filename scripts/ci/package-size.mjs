// Local stacks: PA_SIZE_BASE=<stack-base> (or BASE_SHA / --base) enables blocking.
// Without an explicit local base, origin/main is measured as a warning only.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { parseArgs } from 'node:util';

const configPath = 'scripts/ci/package-size.json';
const git = (...args) => execFileSync('git', args, {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
function parseConfig(raw) {
  const value = JSON.parse(raw);
  if (!value || value.schemaVersion !== 1 || !Number.isSafeInteger(value.maximumLines) ||
      value.maximumLines < 1 || Object.keys(value).some(key => !['schemaVersion', 'maximumLines', 'excludedPaths'].includes(key))) {
    throw new Error('invalid package-size configuration');
  }
  const excludedPaths = value.excludedPaths === undefined ? [] : value.excludedPaths;
  if (!Array.isArray(excludedPaths) || excludedPaths.some(path => typeof path !== 'string' ||
      !/^[\w.*?-]+(?:\/[\w.*?-]+)*$/.test(path) || path.split('/').includes('..'))) {
    throw new Error('invalid excludedPaths');
  }
  return { schemaVersion: value.schemaVersion, maximumLines: value.maximumLines, excludedPaths };
}
function configAt(commit) {
  if (!git('ls-tree', '-z', commit, '--', configPath)) return null;
  return parseConfig(git('show', `${commit}:${configPath}`));
}
function main() {
  const event = process.env.GITHUB_EVENT_NAME || process.env.EVENT_NAME;
  if (event && event !== 'pull_request') {
    console.log(`package-size: skipped (${event})`);
    return 0;
  }
  let pr;
  if (event === 'pull_request' && process.env.GITHUB_EVENT_PATH) {
    pr = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request;
  }
  const { values } = parseArgs({ options: {
    base: { type: 'string' },
    head: { type: 'string', default: process.env.HEAD_SHA || 'HEAD' },
  } });
  const explicitBase = event === 'pull_request' ? pr?.base?.sha || process.env.BASE_SHA
    : values.base || process.env.PA_SIZE_BASE || process.env.BASE_SHA;
  if (event === 'pull_request' && !explicitBase) throw new Error('pull_request requires a PR base SHA');
  const resolveCommit = ref => git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).trim();
  const base = resolveCommit(explicitBase || 'origin/main');
  const head = resolveCommit(pr?.head?.sha || values.head);
  const mergeBase = git('merge-base', base, head).trim();
  const trusted = configAt(base);
  let candidate = configAt(head);
  if (trusted) {
    if (!candidate || candidate.maximumLines > trusted.maximumLines ||
        candidate.excludedPaths.some(path => !trusted.excludedPaths.includes(path))) {
      throw new Error('candidate configuration missing or maximumLines/excludedPaths widened above base');
    }
  } else {
    candidate ??= parseConfig(readFileSync(new URL('./package-size.json', import.meta.url), 'utf8'));
    // Pin the canonical bootstrap config without duplicating its numeric limit.
    const digest = createHash('sha256').update(JSON.stringify(candidate)).digest('hex');
    if (digest !== '2be6c579e5fcfed58ad922fe3ce138603401647da16ee39992fe3da97c0a8125') {
      throw new Error('bootstrap configuration differs from the approved configuration');
    }
  }
  const diff = git('diff', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', mergeBase, head, '--');
  let additions = 0;
  let deletions = 0;
  let excludedLines = 0;
  let excludedFiles = 0;
  const binary = [];
  for (const record of diff.split('\0').filter(Boolean)) {
    const fields = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record);
    if (!fields) throw new Error('invalid numstat record');
    if (candidate.excludedPaths.some(pattern => posix.matchesGlob(fields[3], pattern))) {
      excludedFiles++;
      if (fields[1] !== '-' && fields[2] !== '-') excludedLines += Number(fields[1]) + Number(fields[2]);
      continue;
    }
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
    : `additions=${additions} deletions=${deletions} total=${total} maximumLines=${candidate.maximumLines}`,
  `excludedLines=${excludedLines} excludedFiles=${excludedFiles}`);
  if (!explicitBase) {
    console.warn('package-size: WARNING measured against origin/main; set PA_SIZE_BASE to enforce the package limit');
    return 0;
  }
  if (binary.length) {
    console.error(`package-size: BLOCKED: diff not numerically measurable (binary): ${binary.map(path => JSON.stringify(path)).join(', ')}`);
    return 1;
  }
  if (pr?.labels?.some(label => label.name === 'size-exception')) {
    console.log('package-size: exception label present');
    return 0;
  }
  if (total > candidate.maximumLines) {
    console.error(`package-size: BLOCKED: total=${total} exceeds maximumLines=${candidate.maximumLines}`);
    return 1;
  }
  return 0;
}

try { process.exitCode = main(); }
catch (error) {
  console.error(`package-size: ${error.message}`);
  process.exitCode = 2;
}
