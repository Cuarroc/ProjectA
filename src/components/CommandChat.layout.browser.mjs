import { test } from 'node:test';
import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { fixture } from '../../scripts/dev/design-gate.mjs';

test('keeps command history above the prompt on its existing bordered surface', async () => {
  const previousMocks = process.env.VITE_TAURI_MOCKS;
  process.env.VITE_TAURI_MOCKS = 'true';
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
  const observations = [];
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ args: ['--disable-gpu', '--disable-dev-shm-usage'] });
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
      try {
        await context.addInitScript(fixture, { items: 2, theme });
        const page = await context.newPage();
        await page.clock.setFixedTime(new Date('2026-10-19T00:00:00Z'));
        await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/#/beweise/diff`, { waitUntil: 'networkidle' });
        await page.getByRole('textbox', { name: 'Aufgabe an den Orchestrator' }).waitFor();
        await page.getByRole('button', { name: 'Verlauf', exact: true }).click();
        await page.locator('.command-chat-history').waitFor({ state: 'visible' });
        await page.evaluate(() => globalThis.document.fonts.ready);
        const layout = await page.getByRole('textbox', { name: 'Aufgabe an den Orchestrator' }).evaluate(input => {
          const bar = input.closest('.command-chat-bar');
          const host = bar.parentElement;
          const style = globalThis.getComputedStyle(host);
          const history = host.querySelector('.command-chat-history').getBoundingClientRect();
          const prompt = bar.getBoundingClientRect();
          return { display: style.display, direction: style.flexDirection, border: style.borderTopWidth,
            borderStyle: style.borderTopStyle, background: style.backgroundColor,
            historyBottom: history.bottom, promptTop: prompt.top, historyHeight: history.height };
        });
        observations.push({ theme, ...layout });
        if (process.env.COMMAND_CHAT_LAYOUT_OUT) {
          mkdirSync(process.env.COMMAND_CHAT_LAYOUT_OUT, { recursive: true });
          await page.screenshot({ path: resolve(process.env.COMMAND_CHAT_LAYOUT_OUT, `${theme}.png`) });
        }
      } finally { await context.close(); }
    }
    if (process.env.COMMAND_CHAT_LAYOUT_OUT) writeFileSync(resolve(process.env.COMMAND_CHAT_LAYOUT_OUT, 'layout.json'), JSON.stringify(observations, null, 2));
    console.log(JSON.stringify(observations));
    for (const layout of observations) {
      assert.equal(layout.display, 'flex', layout.theme);
      assert.equal(layout.direction, 'column', layout.theme);
      assert.equal(layout.border, '1px', layout.theme);
      assert.equal(layout.borderStyle, 'solid', layout.theme);
      assert.notEqual(layout.background, 'rgba(0, 0, 0, 0)', layout.theme);
      assert.ok(layout.historyHeight > 0 && layout.historyBottom <= layout.promptTop, layout.theme);
    }
  } finally {
    try { await browser?.close(); } finally { await server.close(); }
    if (previousMocks === undefined) delete process.env.VITE_TAURI_MOCKS;
    else process.env.VITE_TAURI_MOCKS = previousMocks;
  }
});
