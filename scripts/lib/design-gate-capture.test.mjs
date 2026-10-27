import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));

// Only the external browser RPC boundary is replaced. Vite, routes, CLI,
// measurement dispatch, ratchet and output files are the real implementation.
const preload = `
import { createRequire } from 'node:module';
const require = createRequire(${JSON.stringify(join(repo, 'package.json'))});
const { chromium } = require('@playwright/test');
const tabs = ['es-tab-mcp', 'es-tab-benachrichtigungen', 'es-tab-projekt'];
const later = delay => delay ? new Promise(resolve => setTimeout(resolve, delay)) : Promise.resolve();
chromium.launch = async () => ({
  version: () => 'external-browser-fixture',
  close: async () => {},
  newContext: async () => {
    let route, requested, selected, visible, selection, panel;
    const page = {
      clock: { setFixedTime: async () => {} },
      goto: async url => { route = new URL(url).hash; requested = selected = visible = null; },
      waitForFunction: async () => {},
      waitForLoadState: async () => {},
      screenshot: async () => {},
      evaluate: async fn => {
        if (fn.name === 'measure') {
          const ready = requested === 'es-tab-mcp' && selected === requested && visible === requested;
          return { slack: [], nesting: ready ? [{ element: '#mcp-one' }, { element: '#mcp-two' }] : [{ element: '#general' }], tabs: [], eyebrows: [], grids: [] };
        }
        if (String(fn).includes('location.hash')) return route;
      },
      locator: selector => ({
        evaluateAll: async fn => fn(['es-tab-allgemein', ...tabs].map(id => ({ id }))),
        click: async () => {
          requested = tabs.find(id => selector === '[id="' + id + '"]');
          assertTab(requested);
          selected = visible = null;
          const id = requested;
          selection = later(Number(process.env.CAPTURE_SELECTION_DELAY)).then(() => { selected = id; });
          panel = later(Number(process.env.CAPTURE_PANEL_DELAY)).then(() => { visible = id; });
        },
        getAttribute: async name => {
          if (name !== 'aria-controls') throw new Error('Unexpected attribute: ' + name);
          // This association is available only after the requested selection commits.
          return selected === requested ? 'external-panel-' + requested : null;
        },
        waitFor: async options => {
          if (selector === '.g-shell-content') return;
          if (selector === '[id="' + requested + '"][aria-selected="true"]') {
            await selection;
            return;
          }
          if (selector === '[role="tabpanel"][id="external-panel-' + requested + '"]' && options?.state === 'visible') {
            await panel;
            return;
          }
          throw new Error('Unexpected locator: ' + selector);
        },
      }),
    };
    return { addInitScript: async () => {}, newPage: async () => page,
      close: async () => { await Promise.all([selection, panel]); } };
  },
});
function assertTab(id) { if (!id) throw new Error('Unexpected tab click'); }
`;

for (const [name, selectionDelay, panelDelay] of [
  ['CLI waits for late tab selection before measuring MCP', 25, 0],
  ['CLI waits for late associated panel before measuring MCP', 0, 25],
]) test(name, () => {
  const dir = mkdtempSync(join(tmpdir(), 'design-gate-capture-'));
  const transport = join(dir, 'browser.mjs');
  writeFileSync(transport, preload);
  const run = spawnSync(process.execPath, ['--import', pathToFileURL(transport).href, 'scripts/dev/design-gate.mjs', '--out', dir], {
    cwd: repo, encoding: 'utf8',
    env: { ...process.env, CAPTURE_SELECTION_DELAY: String(selectionDelay), CAPTURE_PANEL_DELAY: String(panelDelay) },
  });
  assert.ifError(run.error);
  assert.equal(run.signal, null, run.stderr);
  assert.ok(existsSync(join(dir, 'results.json')), run.stderr);
  const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
  assert.equal(run.status, results.failures.length ? 1 : 0, run.stderr);
  const mcp = Object.entries(results.counts).filter(([key]) => key.startsWith('/einstellungen@es-tab-mcp|'));
  assert.equal(mcp.length, 12);
  for (const [key, counts] of mcp) {
    assert.deepEqual(counts, [0, 2, 0, 0, 0], key);
    assert.deepEqual(results.details[key].nesting, [{ element: '#mcp-one' }, { element: '#mcp-two' }]);
  }
});
