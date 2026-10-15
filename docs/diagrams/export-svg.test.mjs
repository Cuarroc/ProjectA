// Both modes of export-svg.mjs on one-line fixtures. They need Chromium
// (ARCHIFY_CHROME or Playwright's); without one the tests skip and say why.
// Run from anywhere: node --test docs/diagrams/export-svg.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./export-svg.mjs', import.meta.url));

async function chromiumMissing() {
  try {
    const { chromium } = createRequire(import.meta.url)('playwright-core');
    // Same launch arguments as launch() in export-svg.mjs.
    const browser = await chromium.launch({
      executablePath: process.env.ARCHIFY_CHROME || undefined,
      args: process.env.ARCHIFY_NO_SANDBOX ? ['--no-sandbox'] : [],
    });
    await browser.close();
    return false;
  } catch (e) {
    return `Chromium not available: ${String(e.message).split('\n')[0]}`;
  }
}
const skip = await chromiumMissing();

// Runs the script in a scratch directory that is removed afterwards.
function inScratch(run) {
  const dir = mkdtempSync(join(tmpdir(), 'export-svg-'));
  try { return run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function contrast(fg, bg, cwd) {
  return inScratch((dir) => {
    const file = join(dir, 'probe.svg');
    writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><rect width="200" height="40" fill="${bg}"/><text x="10" y="26" fill="${fg}" font-size="16">Probe</text></svg>`);
    return spawnSync(process.execPath, [script, 'contrast', file], { encoding: 'utf8', cwd });
  });
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

test('contrast finds playwright-core from a working directory outside the repository', { skip }, () => {
  const r = contrast('#121826', '#E9EDF3', tmpdir());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /minimum 15\.09:1 OK/);
});

// Pretty-printed like a real Archify page: indentation between tags must go,
// the space between the two tspans must stay.
const FIXTURE = `<html><body><svg data-quality-profile viewBox="0 0 400 300">
  <style>.c-backend{fill:red}</style>
  <rect width="100%" height="100%" fill="#fff"/>
  <g data-node-id="n1">
    <rect class="c-backend" x="40" y="40" width="120" height="60" fill="red" stroke="red"/>
    <text x="50" y="70">
      <tspan>Hello</tspan>
      <tspan>World</tspan>
    </text>
  </g>
  <path class="relationship-hit-overlay" d="M0 0L9 9" stroke="black"/>
  <script>1</script>
</svg></body></html>`;

test('export keeps the tspan space and applies tokens and drops the viewer layer and crops', { skip }, () => {
  inScratch((dir) => {
    const html = join(dir, 'in.html'), out = join(dir, 'out.svg');
    writeFileSync(html, FIXTURE);
    const r = spawnSync(process.execPath, [script, 'export', html, out, 'light', 'T', 'D'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const svg = readFileSync(out, 'utf8');
    assert.ok(svg.includes('>Hello</tspan> <tspan'), 'exactly one space between the tspans'); // R1498-G6
    assert.ok(!svg.includes('\n') && !svg.includes('  '), 'no newline and no run of spaces left'); // R1523-G1
    assert.match(svg, /fill:#E3EAF8;stroke:#1F57D6/i); // light backend token pair
    assert.match(svg, /fill="#E9EDF3"/); // ground rect
    assert.doesNotMatch(svg, /relationship-hit-overlay|<script|<style|data-/);
    const [, w, h] = svg.match(/viewBox="-?[\d.]+ -?[\d.]+ ([\d.]+) ([\d.]+)"/); // getBBox can give fractions
    assert.ok(+w < 400 && +h < 300, `cropped to the drawing, got ${w}x${h}`); // 120+56 x 60+56 + text
  });
});

test('export opens an HTML file whose path needs URL escaping', { skip }, () => {
  inScratch((dir) => {
    mkdirSync(join(dir, 'a #1 %20'));
    const html = join(dir, 'a #1 %20', 'in.html'), out = join(dir, 'out.svg');
    writeFileSync(html, '<svg data-quality-profile viewBox="0 0 120 60"><rect width="120" height="60" fill="#fff"/><text x="10" y="30">Probe</text></svg>');
    const r = spawnSync(process.execPath, [script, 'export', html, out, 'light', 'Probe title', 'Probe desc'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(out, 'utf8'), /<text[^>]*>Probe<\/text>/);
  });
});
