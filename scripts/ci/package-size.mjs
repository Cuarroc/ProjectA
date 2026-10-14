// Labels (PR event only, both leave config validation and measurement intact):
//   size-fix-round  raises the ceiling from maximumLines to fixRoundMaximumLines
//                   (AGENTS.md rule 1: a review-forced fix round may reach 400 lines;
//                   the PR report records the overrun and the finding IDs).
//   size-exception  waives the ceiling entirely, including binary changes that
//                   cannot be counted (assets such as png/woff2); binaries are listed.
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
      value.maximumLines < 1 || Object.keys(value).some(key => !['schemaVersion', 'maximumLines', 'fixRoundMaximumLines', 'excludedPaths'].includes(key))) {
    throw new Error('invalid package-size configuration');
  }
  const fixRound = value.fixRoundMaximumLines ?? value.maximumLines;
  if (!Number.isSafeInteger(fixRound) || fixRound < value.maximumLines) throw new Error('invalid fixRoundMaximumLines');
  const excludedPaths = value.excludedPaths === undefined ? [] : value.excludedPaths;
  if (!Array.isArray(excludedPaths) || excludedPaths.some(path => typeof path !== 'string' ||
      !/^[\w.*?-]+(?:\/[\w.*?-]+)*$/.test(path) || path.split('/').includes('..'))) {
    throw new Error('invalid excludedPaths');
  }
  return { schemaVersion: value.schemaVersion, maximumLines: value.maximumLines, fixRoundMaximumLines: fixRound, excludedPaths };
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
        candidate.fixRoundMaximumLines > trusted.fixRoundMaximumLines ||
        candidate.excludedPaths.some(path => !trusted.excludedPaths.includes(path))) {
      throw new Error('candidate configuration missing or maximumLines/fixRoundMaximumLines/excludedPaths widened above base');
    }
  } else {
    candidate ??= parseConfig(readFileSync(new URL('./package-size.json', import.meta.url), 'utf8'));
    // Pin the canonical bootstrap config without duplicating its numeric limit.
    const digest = createHash('sha256').update(JSON.stringify(candidate)).digest('hex');
    if (digest !== '7889f4257db513ec06aae4afd8882673ad31d8cbf52e528efe5f038319991dfb') {
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
  const labeled = name => pr?.labels?.some(label => label.name === name);
  if (labeled('size-exception')) {
    console.log(`package-size: exception label present${binary.length ? ` (unmeasured binary: ${binary.map(path => JSON.stringify(path)).join(', ')})` : ''}`);
    return 0;
  }
  if (binary.length) {
    console.error(`package-size: BLOCKED: diff not numerically measurable (binary): ${binary.map(path => JSON.stringify(path)).join(', ')}`);
    return 1;
  }
  const fixRound = labeled('size-fix-round');
  const ceiling = fixRound ? candidate.fixRoundMaximumLines : candidate.maximumLines;
  if (total > ceiling) {
    console.error(`package-size: BLOCKED: total=${total} exceeds ${fixRound ? 'fixRoundMaximumLines' : 'maximumLines'}=${ceiling}`);
    return 1;
  }
  if (fixRound && total > candidate.maximumLines) console.log(`package-size: fix round label present (total=${total} <= ${ceiling})`);
  return 0;
}

try { process.exitCode = main(); }
catch (error) {
  console.error(`package-size: ${error.message}`);
  process.exitCode = 2;
}
