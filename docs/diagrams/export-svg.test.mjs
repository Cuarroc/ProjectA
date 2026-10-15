// Contrast mode of export-svg.mjs on one-line SVG fixtures. It needs Chromium
// (ARCHIFY_CHROME or Playwright's); without one the tests skip and say why.
// Run from the repository root: node --test docs/diagrams/export-svg.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./export-svg.mjs', import.meta.url));

async function chromiumMissing() {
  try {
    const { chromium } = createRequire(resolve('package.json'))('playwright-core');
    const browser = await chromium.launch({ executablePath: process.env.ARCHIFY_CHROME || undefined });
    await browser.close();
    return false;
  } catch (e) {
    return `Chromium not available: ${String(e.message).split('\n')[0]}`;
  }
}
const skip = await chromiumMissing();

function contrast(fg, bg) {
  const file = join(mkdtempSync(join(tmpdir(), 'export-svg-')), 'probe.svg');
  writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><rect width="200" height="40" fill="${bg}"/><text x="10" y="26" fill="${fg}" font-size="16">Probe</text></svg>`);
  return spawnSync(process.execPath, [script, 'contrast', file], { encoding: 'utf8' });
}

test('contrast fails text below 4.5:1 with exit 1', { skip }, () => {
  const r = contrast('#999999', '#FFFFFF'); // WCAG reference pair: 2.85:1
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /minimum 2\.85:1 FAIL/);
});

test('contrast passes ink on ground with exit 0', { skip }, () => {
  const r = contrast('#121826', '#E9EDF3'); // Glass --g-ink on --g-ground: 15.09:1
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /minimum 15\.09:1 OK/);
});
