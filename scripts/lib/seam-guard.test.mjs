import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./seam-guard.mjs', import.meta.url));
const PHRASE = 'seam file: set PA_SEAM_ALLOW only with an explicit seam assignment (AGENTS.md rule 6)';

function run(payload, allow) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const env = { ...process.env };
  if (allow === undefined) delete env.PA_SEAM_ALLOW; else env.PA_SEAM_ALLOW = allow;
  return spawnSync(process.execPath, [cli], { input, encoding: 'utf8', env });
}

function edit(file, tool = 'Edit') {
  const tool_input = tool === 'NotebookEdit' ? { notebook_path: file } : { file_path: file };
  return { hook_event_name: 'PreToolUse', tool_name: tool, tool_input };
}

function denied(result, file) {
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout).hookSpecificOutput;
  assert.deepEqual(out, { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `${file}: ${PHRASE}` });
}

function allowed(result) {
  assert.deepEqual([result.status, result.stdout], [0, '']);
}

test('denies an unassigned edit of src-tauri/src/api.rs', () => {
  denied(run(edit('/repo/src-tauri/src/api.rs')), 'src-tauri/src/api.rs');
});

test('allows api.rs when PA_SEAM_ALLOW lists that path', () => {
  allowed(run(edit('/repo/src-tauri/src/api.rs', 'Write'), 'src-tauri/src/api.rs'));
});

test('denies a store/ subfile unless the allow glob matches', () => {
  const rel = 'src-tauri/src/store/migrations.rs';
  denied(run(edit(`/repo/${rel}`, 'MultiEdit'), 'src-tauri/src/store.rs,src-tauri/src/*.rs'), rel);
  allowed(run(edit(`/repo/${rel}`), 'src-tauri/src/store/**'));
});

test('allows a non-seam file', () => {
  const result = run(edit('/repo/README.md'));
  assert.deepEqual([result.status, result.stdout, result.stderr], [0, '', '']);
});

test('handles absolute Windows and POSIX paths and backslashes', () => {
  denied(run(edit('/opt/ProjectA/src-tauri/src/main.rs')), 'src-tauri/src/main.rs');
  denied(run(edit('C:\\work\\ProjectA\\src-tauri\\src\\main.rs')), 'src-tauri/src/main.rs');
  denied(run(edit('/c/work/ProjectA/src-tauri/src/bin/pa.rs')), 'src-tauri/src/bin/pa.rs');
  denied(run(edit('D:\\wt\\src-tauri\\src\\store\\mod.rs', 'NotebookEdit')), 'src-tauri/src/store/mod.rs');
  allowed(run(edit('C:\\repo\\src-tauri\\src\\api.rs', 'NotebookEdit'), 'src-tauri/src/api.rs'));
  allowed(run(edit('src-tauri\\src\\bin\\pa.rs'), 'src-tauri/src/bin/pa.rs'));
});

test('malformed JSON input allows and notes stderr', () => {
  const bad = run('{not json');
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout, '');
  assert.match(bad.stderr, /malformed JSON/);
  const empty = run('null');
  assert.deepEqual([empty.status, empty.stdout, empty.stderr], [0, '', '']);
});

test('settings.json registers the seam PreToolUse hook beside the bash guard', () => {
  const hook = JSON.parse(readFileSync(new URL('../../.claude/settings.json', import.meta.url), 'utf8')).hooks.PreToolUse[1];
  assert.equal(hook.matcher, 'Write|Edit|MultiEdit|NotebookEdit');
  assert.equal(hook.hooks[0].command, 'node scripts/lib/seam-guard.mjs');
});
