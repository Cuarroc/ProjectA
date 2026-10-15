import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ts = /^src\/.*\.tsx?$/;
// Escaped marker literals avoid adding suppressions through the scanner itself.
export const counters = [
  { name: 'ts-suppress', pathFilter: ts, regex: /@ts-(?:ignore|expect-error)\b/g,
    reason: 'Keep TypeScript diagnostic suppressions from growing.' },
  { name: 'eslint\u002ddisable', pathFilter: /^(?:src\/.*|scripts\/.*\.mjs)$/,
    regex: /eslint\x2ddisable/g, reason: 'Keep lint suppressions from growing.' },
  { name: 'rust-allow', pathFilter: /^src-tauri\/src\/.*\.rs$/, regex: /#!?\[allow\(/g,
    reason: 'Keep Rust lint allowances from growing.' },
  { name: 'ts-any', pathFilter: /^src\/(?:.*\/)?(?![^/]*\.test\.)[^/]+\.tsx?$/, regex: /:\s*any\b|\bas\s+any\b/g,
    reason: 'Keep explicit any annotations and assertions out of production growth.' },
  { name: 'state-token', pathFilter: /^src\/(?!design\/)/, regex: /--state-/g,
    reason: 'Keep the state dictionary in src/design: no new --state- definition or use outside it.' },
];

// Pure: files are [repository-relative path, source text] pairs; count occurrences.
export function countFiles(files) {
  const result = Object.fromEntries(counters.map(c => [c.name, []]));
  for (const [path, source] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    for (const counter of counters.filter(c => c.pathFilter.test(path))) {
      source.split(/\r?\n/).forEach((text, index) => {
        for (const match of text.matchAll(counter.regex)) {
          result[counter.name].push({ path, line: index + 1, column: match.index + 1, text });
        }
      });
    }
  }
  return result;
}

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
export function countTracked(cwd) {
  const paths = [...new Set(git(cwd, 'ls-files', '-z').split('\0').filter(Boolean))];
  return countFiles(paths.filter(path => counters.some(c => c.pathFilter.test(path))).flatMap(path => {
    try { return [[path, readFileSync(join(cwd, path), 'utf8')]]; }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }));
}

function newFindings(cwd, findings) {
  const ranges = new Map();
  for (const path of new Set(findings.map(f => f.path))) {
    const diff = git(cwd, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--text',
      '--unified=0', '--inter-hunk-context=0', 'origin/main', '--', `:(literal)${path}`);
    ranges.set(path, [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)]
      .map(m => [Number(m[1]), Number(m[2] ?? 1)]));
  }
  return findings.filter(f => ranges.get(f.path).some(([start, size]) => f.line >= start && f.line < start + size));
}

export function main(mode = 'check', cwd = process.cwd()) {
  if (mode === '--list') {
    for (const c of counters) console.log(`${c.name}\t${c.pathFilter}\t${c.regex}\t${c.reason}`);
    return 0;
  }
  if (!['check', 'update'].includes(mode)) throw new Error('usage: ratchet.mjs check | update | --list');
  cwd = git(cwd, 'rev-parse', '--show-toplevel').trim();
  const configPath = join(cwd, 'scripts/ci/ratchets.json');
  const raw = readFileSync(configPath, 'utf8');
  if (!raw.trim()) throw new Error('keine Zähler');
  const ceilings = JSON.parse(raw);
  if (!ceilings || !Object.keys(ceilings).length) throw new Error('keine Zähler');
  const names = counters.map(c => c.name);
  if (Array.isArray(ceilings) || Object.keys(ceilings).length !== names.length ||
      names.some(name => !Number.isSafeInteger(ceilings[name]) || ceilings[name] < 0)) {
    throw new Error('invalid ceilings: provide one nonnegative integer per registered counter');
  }
  const counts = countTracked(cwd);
  let failed = false;
  for (const name of names) {
    const findings = counts[name], value = findings.length, ceiling = ceilings[name];
    console.log(`${name}: ${value} ${value > ceiling ? '>' : value < ceiling ? '<' : '='} ${ceiling}`);
    if (value > ceiling) {
      failed = true;
      const ref = spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/main'], { cwd });
      if (ref.error || ![0, 1].includes(ref.status)) throw new Error('cannot inspect origin/main');
      if (ref.status === 1) console.log('origin/main unavailable: all findings');
      const added = ref.status === 0 ? newFindings(cwd, findings) : findings;
      if (!added.length) console.log('No added findings relative to origin/main; ceiling still exceeded.');
      for (const f of added) console.log(`  ${f.path}:${f.line}:${f.column} ${f.text.trim()}`);
    } else if (value < ceiling) {
      console.log('Grenze senken: node scripts/ci/ratchet.mjs update');
    }
  }
  // Reject an over-budget update atomically; never raise any ceiling.
  if (mode === 'update' && !failed) {
    writeFileSync(configPath, JSON.stringify(Object.fromEntries(names.map(name =>
      [name, Math.min(ceilings[name], counts[name].length)])), null, 2) + '\n');
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv[2]); }
  catch (error) { console.error(`ratchet: ${error.message}`); process.exitCode = 1; }
}
