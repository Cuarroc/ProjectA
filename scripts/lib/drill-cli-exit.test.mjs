import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
// On Windows, process.exit() while a piped stdin handle is still closing after
// rl.close() aborts node in libuv (src\win\async.c, exit 3221226505). Drill CLIs
// with a readline interface must set process.exitCode and return instead.
const drills = fileURLToPath(new URL('../drills/', import.meta.url));
const readlineDrills = readdirSync(drills).filter((f) => f.endsWith('.mjs'))
  .map((f) => ({ f, src: readFileSync(join(drills, f), 'utf8') }))
  .filter(({ src }) => src.includes('createInterface'));
test('at least one drill CLI uses readline, so the check is not vacuous', () => {
  assert.ok(readlineDrills.length > 0);
});
test('drill CLIs with readline do not call process.exit after closing it', () => {
  for (const { f, src } of readlineDrills) {
    const close = src.search(/\b\w+\.close\(\)/);
    assert.ok(close >= 0, `${f}: readline interface is never closed`);
    assert.doesNotMatch(src.slice(close), /process\.exit\(/, `${f}: process.exit after close`);
  }
});
