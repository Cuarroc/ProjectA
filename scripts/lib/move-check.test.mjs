// scripts/lib/move-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { moveCheck } from './move-check.mjs';

const PREFIX = 'fn main() {}\n\n';
const BODY = '    use super::*;\n\n    #[test]\n    fn a() {\n        assert!(true);\n    }\n';
const BASE = {
  'src/main.rs': `${PREFIX}#[cfg(test)]\nmod tests {\n${BODY}}\n`,
  'scripts/ci/seam-budget.json': '{\n  "schemaVersion": 1,\n  "seams": [\n    { "path": "src/main.rs", "maxLines": 11 },\n    { "path": "src/api.rs", "maxLines": 99 }\n  ]\n}\n',
  'scripts/ci/x.allow': 'src/main.rs::moved_test\nsrc/main.rs::prod_fn\n',
};
const STUB = '#[cfg(test)]\n#[rustfmt::skip]\n#[path = "main_tests.rs"]\nmod tests;\n';
const GOOD = { 'src/main.rs': PREFIX + STUB, 'src/main_tests.rs': BODY };
const BUDGET = (n) => BASE['scripts/ci/seam-budget.json'].replace('11', String(n));
const OPTS = { from: 'src/main.rs', to: 'src/main_tests.rs' };

// Builds a temp repo with a base commit and a head commit; returns a checker for it.
function check(head, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'move-check-'));
  const git = (...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_DIR: undefined, GIT_INDEX_FILE: undefined } });
  const commit = (files, msg) => {
    for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); }
    git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', msg);
  };
  git('init', '-q'); commit(BASE, 'base');
  const base = git('rev-parse', 'HEAD').trim();
  commit(head, 'head');
  try { return { out: moveCheck({ base, cwd: dir, ...OPTS, ...opts }) }; } catch (e) { return { err: e.message }; } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('an identical move passes and prints the evidence line', () => {
  const r = check(GOOD);
  assert.match(r.out, /^move-check: OK src\/main\.rs:\d+-\d+ \(6 lines\) -> src\/main_tests\.rs byte-identical sha256:[0-9a-f]{16}; stub 4 lines; src\/main\.rs 11 -> 6; /);
});

test('one trailing space in the moved body fails', () => {
  assert.match(check({ ...GOOD, 'src/main_tests.rs': BODY.replace('fn a() {', 'fn a() { ') }).err, /main_tests\.rs:4 differs from src\/main\.rs:8/);
});

test('a renamed test fn fails', () => {
  assert.match(check({ ...GOOD, 'src/main_tests.rs': BODY.replace('fn a()', 'fn b()') }).err, /differs/);
});

test('a missing final newline in the new file fails', () => {
  assert.match(check({ ...GOOD, 'src/main_tests.rs': BODY.trimEnd() }).err, /final newline/);
});

test('a changed line in the production prefix fails', () => {
  assert.match(check({ ...GOOD, 'src/main.rs': `fn main() { }\n\n${STUB}` }).err, /prefix of src\/main\.rs changed/);
});

test('a stray extra file in the diff fails', () => {
  assert.match(check({ ...GOOD, 'README.md': 'x\n' }).err, /unexpected files changed: README\.md/);
});

test('a target that already exists at base fails', () => {
  const r = check({ 'src/main.rs': 'changed\n', 'scripts/ci/x.allow': 'y\n' }, { from: 'scripts/ci/x.allow', to: 'src/main.rs' });
  assert.match(r.err, /already exists at base/);
});

test('a stub with code in it fails', () => {
  assert.match(check({ ...GOOD, 'src/main.rs': `${PREFIX}#[cfg(test)]\nmod tests;\nfn extra() {}\n` }).err, /stub shape/);
  assert.match(check({ ...GOOD, 'src/main.rs': `${PREFIX}#[cfg(test)]\n#[allow(dead_code)]\nmod tests;\n` }).err, /stub shape/);
});

test('--stub-allow admits one extra stub line', () => {
  const r = check({ ...GOOD, 'src/main.rs': `${PREFIX}#[cfg(test)]\n#[allow(dead_code)]\nmod tests;\n` }, { stubAllow: '^#\\[allow\\(dead_code\\)\\]$' });
  assert.match(r.out, /^move-check: OK/);
});

test('a dedent fails strict and passes with --ignore-indent', () => {
  const dedented = { ...GOOD, 'src/main_tests.rs': BODY.replace(/^ {4}/gm, '') };
  assert.match(check(dedented).err, /differs/);
  assert.match(check(dedented, { ignoreIndent: true }).out, /identical modulo indentation/);
});

test('--rewrite applies when the hit count matches and fails otherwise', () => {
  const moved = { ...GOOD, 'src/main_tests.rs': BODY.replace('assert!(true)', 'assert!(false)') };
  assert.match(check(moved, { rewrite: ['assert!(true)=>assert!(false):1'] }).out, /^move-check: OK/);
  assert.match(check(moved, { rewrite: ['assert!(true)=>assert!(false):2'] }).err, /1 hits, expected 2/);
});

test('seam-budget must drop to the new line count and nothing else', () => {
  const edit = { allowEdit: ['scripts/ci/seam-budget.json'] };
  const budget = (j) => ({ ...GOOD, 'scripts/ci/seam-budget.json': j });
  assert.match(check(budget(BUDGET(6)), edit).out, /^move-check: OK/);
  assert.match(check(budget(BUDGET(7)), edit).err, /maxLines may change, to 6 without raising it \(was 11, is 7\)/);
  assert.match(check(budget(BUDGET(6).replace('99', '98')), edit).err, /only src\/main\.rs maxLines may change/);
});

test('allow-file edits must be pure path swaps', () => {
  const edit = { allowEdit: ['scripts/ci/x.allow'] };
  const swap = { ...GOOD, 'scripts/ci/x.allow': 'src/main_tests.rs::moved_test\nsrc/main.rs::prod_fn\n' };
  assert.match(check(swap, edit).out, /^move-check: OK/);
  assert.match(check({ ...swap, 'scripts/ci/x.allow': 'src/main_tests.rs::other\nsrc/main.rs::prod_fn\n' }, edit).err, /not a pure/);
  assert.match(check(swap, { allowEdit: ['scripts/ci/other.allow'] }).err, /unexpected files changed: scripts\/ci\/x\.allow/);
});
