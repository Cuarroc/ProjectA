import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { UNCALLED, checkTree, findDrift, parseHandlers, parseInvokeNames } from './ipc-names.mjs';

const script = resolve('scripts/ci/ipc-names.mjs');
const RUST = `fn main() {
    builder
        .invoke_handler(tauri::generate_handler![
            api::log_frontend_error,
            spawn_pty, // trailing comment, with a comma
            #[cfg(debug_assertions)]
            debug_only,
            list_projects
        ])
        .build();
}`;
const TS = `import { invoke } from "@tauri-apps/api/core";
export const a = () => invoke<void>("spawn_pty", { id });
export const b = () => invoke<Record<string, boolean>>(
  "list_projects",
);
export const c = () => invoke("plugin:opener|open_url", { url });
// invoke("commented_out")
`;

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'ipc-names-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test('parseHandlers reads paths, attributes and comments', () => {
  assert.deepEqual(parseHandlers(RUST), ['log_frontend_error', 'spawn_pty', 'debug_only', 'list_projects']);
});

test('parseInvokeNames reads generics and multi-line calls, skips plugins and comments', () => {
  assert.deepEqual(parseInvokeNames(TS).sort(), ['list_projects', 'spawn_pty']);
});

test('a renamed Rust command is reported on both sides', () => {
  const renamed = parseHandlers(RUST).map(n => (n === 'spawn_pty' ? 'spawn_pty_v2' : n));
  const findings = findDrift(renamed, ['spawn_pty', 'list_projects'], { log_frontend_error: 'x', debug_only: 'x' });
  assert.deepEqual(findings, [
    'invoke("spawn_pty") has no handler in generate_handler!',
    'handler spawn_pty_v2 has no invoke() caller; call it or add it to UNCALLED with a reason',
  ]);
});

test('allowlist entries must stay accurate', () => {
  const findings = findDrift(['a', 'b'], ['b'], { a: 'x', b: 'x', gone: 'x' });
  assert.deepEqual(findings, [
    'UNCALLED entry b is called now; remove it',
    'UNCALLED entry gone is not registered any more; remove it',
  ]);
});

test('a handler listed twice is reported', () => {
  assert.deepEqual(findDrift(['a', 'a'], ['a'], {}), ['registered twice in generate_handler!: a']);
});

test('the CLI exits 1 on a renamed command and 0 once fixed', t => {
  const rust = RUST.replace('list_projects\n', `list_projects, ${Object.keys(UNCALLED).join(', ')}\n`);
  const root = fixture(t, {
    'src-tauri/src/main.rs': rust.replace('spawn_pty,', 'spawn_pty_v2,'),
    'src/lib/ipc.ts': TS,
    'src/lib/ipc.test.ts': 'invoke("only_in_a_test");',
  });
  const run = cwd => spawnSync(process.execPath, [script, 'check'], { cwd, encoding: 'utf8' });
  const red = run(root);
  assert.equal(red.status, 1);
  assert.match(red.stdout, /invoke\("spawn_pty"\) has no handler/);
  assert.doesNotMatch(red.stdout, /only_in_a_test/);
  writeFileSync(join(root, 'src-tauri/src/main.rs'), rust);
  writeFileSync(join(root, 'src/lib/ipc.ts'), `${TS}\ninvoke("log_frontend_error"); invoke("debug_only");`);
  assert.equal(run(root).status, 0);
});

test('the real tree has no IPC name drift', () => {
  const { handlers, findings } = checkTree(process.cwd());
  assert.ok(handlers.length > 100, `parsed only ${handlers.length} handlers`);
  assert.deepEqual(findings, []);
});
