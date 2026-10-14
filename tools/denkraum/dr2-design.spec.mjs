import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeskServer } from './server.mjs';

test('DR2: one read-only Glass URL serves canonical tokens and refuses other design paths', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'denkraum-design-'));
  const server = createDeskServer({ statePath: join(dir, 'ledger.json'), rootAgentId: 'root-test' });
  try {
    const listening = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await listening;
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = (path, method = 'GET', headers = {}) => new Promise((resolve, reject) => {
      // Send the raw request target so the client cannot normalize traversal away.
      const req = request(base, { path, method, headers, signal: AbortSignal.timeout(3000) }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject);
      req.end(method === 'POST' ? '{}' : undefined);
    });
    const response = await get('/design/glass.css');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('no-store');
    const tokens = await readFile(new URL('../../src/design/tokens.css', import.meta.url), 'utf8');
    const motion = await readFile(new URL('../../src/design/motion.css', import.meta.url), 'utf8');
    expect(response.body).toBe(`${tokens}\n${motion}`);
    expect(response.body).toContain('--g-ground:');
    expect(response.body).toContain('--g-dur-2: 200ms');

    await page.goto(base);
    await page.addStyleTag({ url: `${base}/design/glass.css` });
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--g-dur-2').trim())).toBe('200ms');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--g-ground').trim())).not.toBe('');

    for (const path of ['/design/', '/design/motion.css', '/design/tokens.css', '/design/shell.css',
      '/design/../../src/design/tokens.css', '/design/%2e%2e/%2e%2e/src/design/motion.css',
      '/design/..%2f..%2fsrc%2fdesign%2ftokens.css', '/design/..\\..\\src\\design\\tokens.css']) {
      const denied = await get(path);
      expect(denied.status, path).toBe(404);
      expect(denied.body, path).not.toContain('--g-');
    }
    expect((await get('/design/glass.css', 'PUT')).status).toBe(405);
    expect((await get('/design/glass.css', 'POST', { 'x-decision-desk': 'agent', 'content-type': 'application/json' })).status).toBe(404);
    expect((await get('/design/glass.css', 'GET', { origin: 'https://foreign.test' })).status).toBe(403);
    expect((await get('/design/glass.css', 'GET', { host: 'foreign.test' })).status).toBe(403);
    expect((await get('/style.css')).status).toBe(200);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
