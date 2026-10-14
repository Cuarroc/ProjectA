#!/usr/bin/env node
// AP-9 S0: the IPC command names must agree on both sides. Rust registers them
// in `tauri::generate_handler![...]` (main.rs); the frontend calls them with
// `invoke("name")`. Today a rename on one side only surfaces at runtime. This
// gate reads both sides as text (no build, no new dependency) and fails when
//   - a TS caller names a command that is not registered, or
//   - a registered command is neither called nor on UNCALLED below, or
//   - an UNCALLED entry is stale (unregistered, or called after all).
// `plugin:*` calls belong to Tauri plugins and are ignored.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HANDLER_FILE = 'src-tauri/src/main.rs';

// Registered commands that have no TS caller yet, each with the reason.
export const UNCALLED = {
  enable_continuous_activation: 'continuous mode is frozen until M4 (AGENTS.md)',
  get_continuous_activation: 'continuous mode is frozen until M4 (AGENTS.md)',
  get_landing_page: 'landing page has no UI caller yet',
  set_landing_page: 'landing page has no UI caller yet',
};

const stripRust = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const stripTs = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

/** Names inside `generate_handler![ ... ]`; `api::x` counts as `x`. */
export function parseHandlers(rust) {
  const code = stripRust(rust);
  const start = code.indexOf('generate_handler![');
  if (start < 0) throw new Error('no generate_handler![ block found');
  const open = start + 'generate_handler!['.length;
  let depth = 1;
  let end = open;
  for (; end < code.length && depth > 0; end++) {
    if (code[end] === '[') depth++;
    else if (code[end] === ']') depth--;
  }
  if (depth > 0) throw new Error('generate_handler![ block is not closed');
  return code
    .slice(open, end - 1)
    .replace(/#\[[^\]]*\]/g, '')
    .split(',')
    .map(entry => entry.trim().split('::').pop())
    .filter(Boolean);
}

/** Literal command names of `invoke("name")` / `invoke<T>("name")`, plugins excluded. */
export function parseInvokeNames(ts) {
  const names = new Set();
  for (const m of stripTs(ts).matchAll(/\binvoke\s*(?:<[^()]*>)?\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
    if (!m[1].startsWith('plugin:')) names.add(m[1]);
  }
  return [...names];
}

/** One finding per line; an empty list means both sides agree. */
export function findDrift(handlers, called, uncalled = UNCALLED) {
  const registered = new Set(handlers);
  const used = new Set(called);
  const findings = [];
  const dup = handlers.filter((n, i) => handlers.indexOf(n) !== i);
  for (const n of new Set(dup)) findings.push(`registered twice in generate_handler!: ${n}`);
  for (const n of [...used].sort()) {
    if (!registered.has(n)) findings.push(`invoke("${n}") has no handler in generate_handler!`);
  }
  for (const n of [...registered].sort()) {
    if (!used.has(n) && !(n in uncalled)) {
      findings.push(`handler ${n} has no invoke() caller; call it or add it to UNCALLED with a reason`);
    }
  }
  for (const n of Object.keys(uncalled)) {
    if (!registered.has(n)) findings.push(`UNCALLED entry ${n} is not registered any more; remove it`);
    else if (used.has(n)) findings.push(`UNCALLED entry ${n} is called now; remove it`);
  }
  return findings;
}

const isTest = p => /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|test)\//.test(p);

function* walk(dir, rel = '') {
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walk(dir, p);
    else if (/\.[cm]?[jt]sx?$/.test(e.name) && !isTest(p)) yield p;
  }
}

export function checkTree(root) {
  const handlers = parseHandlers(readFileSync(join(root, HANDLER_FILE), 'utf8'));
  const called = new Set();
  for (const f of walk(join(root, 'src'))) {
    for (const n of parseInvokeNames(readFileSync(join(root, 'src', f), 'utf8'))) called.add(n);
  }
  return { handlers, called: [...called], findings: findDrift(handlers, [...called]) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { handlers, called, findings } = checkTree(process.cwd());
  if (findings.length) {
    console.log(findings.map(f => `ipc-names: ${f}`).join('\n'));
    process.exit(1);
  }
  console.log(`ipc-names: ok (${handlers.length} handlers, ${called.length} called names, ${Object.keys(UNCALLED).length} allowlisted)`);
}
