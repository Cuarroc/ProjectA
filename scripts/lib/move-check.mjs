#!/usr/bin/env node
// Proves that a Rust test-module move out of a seam file is a pure move (E1): the module body
// is byte-identical in the new file, the old file keeps only a short `mod` stub, and the only
// other edits are the declared budget/allow-file updates. Not a gate; its output is PR evidence.
// Usage: node scripts/lib/move-check.mjs --base <ref> [--head <ref>] --from <path> --to <path>
//   [--stub-allow <regex>] [--rewrite 'old=>new:count']... [--allow-edit <path>[:budget|:paths]]...
//   [--ignore-indent]      exit 0 = OK line on stdout, 1 = not a pure move, 2 = usage/git error
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

class Fail extends Error {}
const fail = (m) => { throw new Fail(m); };
const lines = (s) => (s === '' ? [] : s.replace(/\n$/, '').split('\n'));
const MOD_OPEN = /^(pub(\(crate\))? )?mod \w+ \{$/;
const MOD_STUB = /^(pub\(crate\) )?mod \w+;$/;
const STUB_LINE = /^#\[(cfg\(test\)|rustfmt::skip|path = "[^"]+")\]$/;

// First line where `got` differs from `want`, as a message; undefined when equal.
const firstDiff = (want, got, wf, gf, off, norm = (l) => l) => {
  for (let k = 0; k < Math.max(want.length, got.length); k++) {
    if (norm(want[k]) !== norm(got[k])) return `${gf}:${k + 1} differs from ${wf}:${off + k + 1}\n  - ${want[k]}\n  + ${got[k]}`;
  }
};

// Allow-edit rules: each checked exactly, not just "may change".
const RULES = {
  budget(b, h, { from, count, f }) {
    const strip = (t) => { const j = JSON.parse(t); const e = j.seams.find((x) => x.path === from); j.seams = j.seams.filter((x) => x !== e); return [JSON.stringify(j), e?.maxLines]; };
    const [[rb, old], [rh, now]] = [strip(b), strip(h)];
    if (rb !== rh || now !== count || !(count <= old)) fail(`${f}: only ${from} maxLines may change, to ${count} without raising it (was ${old}, is ${now})`);
  },
  paths(b, h, { from, to, f }) {
    const hl = lines(h);
    const want = lines(b).map((l, k) => (hl[k] === l ? l : l.replaceAll(from, to)));
    const msg = firstDiff(want, hl, f, f, 0);
    if (msg) fail(`${f}: not a pure ${from} -> ${to} path swap: ${msg}`);
  },
};
const ruleOf = (p) => (p.endsWith('seam-budget.json') ? 'budget' : p.endsWith('.allow') ? 'paths' : fail(`--allow-edit ${p} needs :budget or :paths`));

export function moveCheck({ base, head = 'HEAD', from, to, stubAllow, rewrite = [], allowEdit = [], ignoreIndent = false, cwd = process.cwd() }) {
  if (!base || !from || !to) throw new Error('usage: --base <ref> [--head <ref>] --from <path> --to <path> [options]');
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  const git = (...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
  const show = (ref, p) => git('show', `${ref}:${p}`);
  const allow = new Map(allowEdit.map((e) => { const m = /^(.*):(budget|paths)$/.exec(e); return m ? [m[1], m[2]] : [e, ruleOf(e)]; }));

  // 1. nothing else changed
  const changed = git('diff', '--no-renames', '--name-only', base, head).split('\n').filter(Boolean);
  const extra = changed.filter((f) => f !== from && f !== to && !allow.has(f));
  if (extra.length) fail(`unexpected files changed: ${extra.join(', ')}`);
  if (!changed.includes(to)) fail(`${to} is not in the diff`);
  if (git('ls-tree', '--name-only', base, '--', to).trim()) fail(`${to} already exists at base`);

  // 2. removed region = last top-level `#[cfg(test)]` + `mod X {` ... EOF
  const [rawB, rawH, rawT] = [show(base, from), show(head, from), show(head, to)];
  const [B, H, T] = [lines(rawB), lines(rawH), lines(rawT)];
  let s = -1;
  B.forEach((l, k) => { if (l === '#[cfg(test)]' && MOD_OPEN.test(B[k + 1] ?? '')) s = k; });
  if (s < 0 || B.at(-1) !== '}') fail(`no trailing #[cfg(test)] mod block in ${from} at base`);
  const body = B.slice(s + 2, -1);

  // 3. head(from) = base prefix + declared stub
  const msg = firstDiff(B.slice(0, s), H.slice(0, s), from, from, 0);
  if (msg) fail(`prefix of ${from} changed: ${msg}`);
  const stub = H.slice(s);
  const extraOk = stubAllow ? new RegExp(stubAllow) : null;
  if (stub[0] !== '#[cfg(test)]' || !MOD_STUB.test(stub.at(-1) ?? '') || stub.length > 5 || !stub.every((l) => STUB_LINE.test(l) || MOD_STUB.test(l) || extraOk?.test(l))) fail(`stub shape: ${JSON.stringify(stub)}`);
  if (rawB.endsWith('\n') !== rawH.endsWith('\n') || !rawT.endsWith('\n')) fail('final newline differs');

  // 4. moved text identical, after the declared rewrites
  for (const r of rewrite) {
    const m = /^(.+)=>(.*):(\d+)$/.exec(r) ?? fail(`bad --rewrite ${r}`);
    let n = 0;
    body.forEach((l, k) => { const parts = l.split(m[1]); n += parts.length - 1; body[k] = parts.join(m[2]); });
    if (n !== Number(m[3])) fail(`--rewrite ${m[1]}: ${n} hits, expected ${m[3]}`);
  }
  const moved = firstDiff(body, T, from, to, s + 2, ignoreIndent ? (l) => l?.trimStart() : undefined);
  if (moved) fail(moved);

  // 5. declared edits to other files
  for (const f of changed.filter((x) => allow.has(x))) RULES[allow.get(f)](show(base, f), show(head, f), { from, to, f, count: H.length });

  const sha = createHash('sha256').update(body.join('\n')).digest('hex').slice(0, 16);
  const how = ignoreIndent ? 'identical modulo indentation' : 'byte-identical';
  return `move-check: OK ${from}:${s + 3}-${B.length - 1} (${body.length} lines) -> ${to} ${how} sha256:${sha}; stub ${stub.length} lines; ${from} ${B.length} -> ${H.length}; ${git('diff', '--shortstat', base, head).trim()}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { values: v } = parseArgs({ options: {
      base: { type: 'string' }, head: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
      'stub-allow': { type: 'string' }, rewrite: { type: 'string', multiple: true }, 'allow-edit': { type: 'string', multiple: true }, 'ignore-indent': { type: 'boolean' },
    } });
    console.log(moveCheck({ base: v.base, head: v.head, from: v.from, to: v.to, stubAllow: v['stub-allow'], rewrite: v.rewrite, allowEdit: v['allow-edit'], ignoreIndent: v['ignore-indent'] }));
  } catch (e) {
    console.error(`move-check: ${e instanceof Fail ? 'FAIL' : 'ERROR'} ${e.message}`);
    process.exit(e instanceof Fail ? 1 : 2);
  }
}
