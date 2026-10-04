import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadReleaseAttestation } from './release-attestation.mjs';

const FILE = '.pa/release_attestation_v1.5.0.json';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'attest-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'test');
  writeFileSync(path.join(root, 'a.txt'), 'a');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  mkdirSync(path.join(root, '.pa'));
  return root;
}
const valid = root => ({
  release: 'v1.5.0',
  commit: git(root, 'rev-parse', 'HEAD'),
  rows: Array.from({ length: 26 }, (_, i) => i + 1),
  decidedAt: '2026-10-05T10:00:00Z',
  decidedBy: 'user',
  continuousEnabled: false,
});
const write = (root, value) => writeFileSync(path.join(root, FILE), typeof value === 'string' ? value : JSON.stringify(value));
function refusal(mutate, pattern, { commit = false } = {}) {
  const root = fixture();
  try {
    const data = valid(root);
    const out = mutate(data, root) ?? data;
    write(root, out);
    if (commit) { git(root, 'add', '.'); git(root, 'commit', '-q', '-m', 'att'); }
    const result = loadReleaseAttestation(FILE, root);
    assert.equal(result.attested, false);
    assert.match(result.reason, pattern);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('attestation: missing file is refused with a named reason', () => {
  const root = fixture();
  try {
    const result = loadReleaseAttestation(FILE, root);
    assert.equal(result.attested, false);
    assert.match(result.reason, /unreadable/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('attestation: invalid JSON is refused', () => refusal(() => '{nope', /not JSON/));
test('attestation: non-object JSON is refused', () => refusal(() => '[1]', /JSON object/));
test('attestation: extra key is refused', () => refusal(d => ({ ...d, extra: 1 }), /keys must be exactly/));
test('attestation: missing key is refused', () => refusal(d => { delete d.decidedBy; }, /keys must be exactly/));
test('attestation: wrong release is refused', () => refusal(d => { d.release = 'v1.4.0'; }, /release must be/));
test('attestation: rows must be exactly 1..26', () => refusal(d => { d.rows = d.rows.slice(1); }, /rows must be/));
test('attestation: bad decidedAt is refused', () => refusal(d => { d.decidedAt = 'yesterday'; }, /decidedAt/));
test('attestation: empty decidedBy is refused', () => refusal(d => { d.decidedBy = ' '; }, /decidedBy/));
test('attestation: continuousEnabled true is refused', () => refusal(d => { d.continuousEnabled = true; }, /continuousEnabled/));
test('attestation: commit mismatch is refused', () => refusal(d => { d.commit = 'a'.repeat(40); }, /does not match HEAD/, { commit: true }));
test('attestation: an ignored untracked file is refused', () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, '.gitignore'), '.pa/*\n');
    git(root, 'add', '.gitignore');
    git(root, 'commit', '-q', '-m', 'ignore attestations');
    write(root, valid(root));
    assert.equal(git(root, 'status', '--porcelain'), '');
    const result = loadReleaseAttestation(FILE, root);
    assert.equal(result.attested, false);
    assert.match(result.reason, /committed regular file/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('attestation: a non-ancestor commit is refused', () => {
  const root = fixture();
  try {
    const base = git(root, 'rev-parse', 'HEAD');
    git(root, 'checkout', '-q', '-b', 'sibling');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'sibling');
    const sibling = git(root, 'rev-parse', 'HEAD');
    git(root, 'checkout', '-q', '--detach', base);
    write(root, { ...valid(root), commit: sibling });
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'attest');
    const result = loadReleaseAttestation(FILE, root);
    assert.equal(result.attested, false);
    assert.match(result.reason, /ancestor/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('attestation: dirty work tree is refused', () => {
  const root = fixture();
  try {
    write(root, valid(root));
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'attest');
    writeFileSync(path.join(root, 'a.txt'), 'changed');
    const result = loadReleaseAttestation(FILE, root);
    assert.equal(result.attested, false);
    assert.match(result.reason, /not clean/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('attestation: a non-repository is refused', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'attest-nogit-'));
  try {
    mkdirSync(path.join(root, '.pa'));
    write(root, { ...valid(fixture()), commit: 'a'.repeat(40) });
    const result = loadReleaseAttestation(FILE, root);
    assert.equal(result.attested, false);
    assert.match(result.reason, /git state unavailable/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('attestation: happy path with the attestation itself committed on top', () => {
  const root = fixture();
  try {
    write(root, valid(root));
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'attest');
    assert.deepEqual(loadReleaseAttestation(FILE, root), { attested: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('attestation: a later code commit invalidates it', () => refusal((d, root) => {
  write(root, d);
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'attest');
  writeFileSync(path.join(root, 'a.txt'), 'later');
  git(root, 'commit', '-q', '-am', 'code');
}, /does not match HEAD/));
