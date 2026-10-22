import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

export const metrics = ['slack', 'nesting', 'tabs', 'eyebrows', 'grids'];
export function serializeBaseline(counts) {
  const cases = Object.entries(counts).map(([key, row]) => `${JSON.stringify(key)}:${JSON.stringify(row)}`);
  return '{\n' + (cases.length ? cases.join(',\n') + '\n' : '') + '}\n';
}

// Self-contained so the same measurement runs against literal HTML and the app.
export function measure() {
  const result = { slack: [], nesting: [], tabs: [], eyebrows: [], grids: [] };
  const root = document.querySelector('.g-shell-content') ?? document.body;
  if (root.matches('.g-shell-content') && !root.innerText.trim()) throw new Error('app content not ready');
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const label = el => el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`;
  const all = [...root.querySelectorAll('*')].filter(visible);
  const textNodes = el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.textContent.trim() && visible(n.parentElement)) nodes.push(n);
    }
    return nodes;
  };
  const controls = 'input,textarea,select,button,svg,img,canvas,progress,hr';
  const content = el => el && (textNodes(el).some(n => !n.parentElement.closest('.g-hs,.g-shell-note,h1,h2,nav,[role="tablist"]')) ||
    [...el.querySelectorAll(controls)].some(c => visible(c) && !c.closest('.g-hs,nav,[role="tablist"]')));
  const boxes = all.filter(el => {
    if (!(el instanceof HTMLElement)) return false;
    const s = getComputedStyle(el);
    return s.boxShadow !== 'none' || !['transparent', 'rgba(0, 0, 0, 0)'].includes(s.backgroundColor) ||
      ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== 'none');
  });
  const boxed = new Set(boxes);
  for (const el of boxes) {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    let depth = 1, bottom = r.top;
    for (let p = el.parentElement; p && root.contains(p); p = p.parentElement) if (boxed.has(p)) depth++;
    if (depth > 2) result.nesting.push({ element: label(el), depth });
    if (!el.matches('section,article,aside,div,nav,ul,table,form,details')) continue;
    for (const n of textNodes(el)) {
      const range = document.createRange(); range.selectNodeContents(n);
      for (const rect of range.getClientRects()) bottom = Math.max(bottom, rect.bottom);
    }
    for (const c of el.querySelectorAll(controls)) if (visible(c)) bottom = Math.max(bottom, c.getBoundingClientRect().bottom);
    const slack = r.height - (bottom - r.top + (parseFloat(s.paddingBottom) || 0));
    if (slack > 120 && slack / r.height > .35) result.slack.push({ element: label(el), height: Math.round(r.height), slack: Math.round(slack), percent: Math.round(slack / r.height * 100) });
  }
  for (const tab of all.filter(el => el.matches('[role="tab"][aria-selected="true"][aria-controls],.g-shell-tabs [aria-current="page"]'))) {
    const nav = tab.closest('nav');
    const panel = tab.hasAttribute('aria-controls') ? document.getElementById(tab.getAttribute('aria-controls')) :
      tab.closest('.g-shell-panel') ?? (nav?.parentElement.querySelector('.g-sr-pane') ?? nav?.parentElement.closest('.g-lr,.g-sr,.g-mount-legacy'));
    if (!content(panel)) result.tabs.push({ element: label(tab), panel: panel ? label(panel) : null });
  }
  const fractional = [];
  const rules = list => { for (const rule of list) {
    if (rule.media && !matchMedia(rule.conditionText).matches) continue;
    if (rule.style?.gridTemplateColumns.includes('1fr')) fractional.push(rule.selectorText);
    if (rule.cssRules) rules(rule.cssRules);
  } };
  for (const sheet of document.styleSheets) rules(sheet.cssRules);
  for (const el of all) {
    const s = getComputedStyle(el), text = el.textContent.trim();
    if (!el.children.length && text.length > 2 && parseFloat(s.fontSize) <= 14 &&
      (s.textTransform === 'uppercase' || (text === text.toLocaleUpperCase() && text !== text.toLocaleLowerCase()))) result.eyebrows.push({ element: label(el), text });
    const columns = s.gridTemplateColumns.split(' ').map(Number.parseFloat);
    if (s.display === 'grid' && columns.length > 1 && columns.every(n => Math.abs(n - columns[0]) < 1) &&
      (el.style.gridTemplateColumns.includes('1fr') || fractional.some(selector => el.matches(selector)))) result.grids.push({ element: label(el), columns: columns.length });
  }
  return result;
}

export function ratchet(current, baseline, update = false) {
  for (const counts of [current, baseline]) {
    if (!counts || Array.isArray(counts) || typeof counts !== 'object' || Object.values(counts).some(row =>
      !Array.isArray(row) || row.length !== metrics.length || row.some(n => !Number.isSafeInteger(n) || n < 0))) throw new Error('invalid design counts');
  }
  const failures = [];
  for (const key of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    if (!current[key] || !baseline[key]) { if (!update) failures.push(`${key}: missing current case or baseline`); }
    else metrics.forEach((name, i) => { if (current[key][i] > baseline[key][i]) failures.push(`${key} ${name}: ${current[key][i]} > ${baseline[key][i]}`); });
  }
  return failures;
}

// Extend the existing rich mock at the IPC boundary; never contact a provider.
export function fixture({ items, theme }) {
  window.__PROJECTA_E2E_RICH__ = items > 0;
  localStorage.setItem('projecta.activeProjectId', 'p1');
  localStorage.setItem('projecta.settings.glassTheme', theme);
  localStorage.setItem('projecta.settings.featureFlag.weitere_bereiche', '1');
  localStorage.setItem('projecta.settings.featureFlag.d1_neue_oberflaeche', '1');
  let original;
  const copies = (array, make) => Array.from({ length: items }, (_, i) => make(structuredClone(array[0]), i));
  const worker = (w, i) => ({ ...w, id: `w${i + 1}`, task: `Example task ${i + 1}`, branch: `example/task-${i + 1}`, worktreePath: '/example/worktree', sessionId: `example-session-${i + 1}` });
  Object.defineProperty(window.__TAURI_INTERNALS__ = {}, 'invoke', {
    configurable: true,
    set(fn) { original = fn; },
    get() { return async (cmd, args, options) => {
      const value = await original(cmd, args, options);
      if (!items) return value;
      if (cmd === 'list_projects') return value.map(p => ({ ...p, repoPath: '/example/project' }));
      if (cmd === 'list_workers') return copies(value, worker);
      if (cmd === 'get_board_state') return { cards: copies(value.cards, (c, i) => ({ ...c, worker: worker(c.worker, i), column: ['working', 'needs_you', 'in_review', 'ready_to_merge', 'done'][i % 5] })), coordinators: [] };
      if (cmd === 'list_queue') return copies(value, (q, i) => ({ ...q, id: `example-queue-${i + 1}` }));
      if (cmd === 'list_live_sessions') return copies(value, (_, i) => `example-session-${i + 1}`);
      return value;
    }; },
  });
}

async function main() {
  const { values } = parseArgs({ options: { help: { type: 'boolean', short: 'h' }, update: { type: 'boolean' }, out: { type: 'string', default: '.pa/design-gate' } } });
  if (values.help) {
    console.log(`Usage: npm run design:gate -- [--update] [--out <directory>]

Developer DOM heuristic, not a visual verdict.

Options:
  -h, --help         Show this help without rendering or writing files.
  --update           Initialize or replace the baseline after validation;
                     never raise ceilings on retained cases.
  --out <directory>  Write table, PNGs and JSON (default: .pa/design-gate).`);
    return;
  }
  const baselinePath = new URL('./design-gate.baseline.json', import.meta.url);
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;
  if (!baseline && !values.update) throw new Error('baseline missing: initialize with --update');
  const counts = {}, details = {}, summary = {}, out = resolve(values.out);
  mkdirSync(out, { recursive: true });
  process.env.VITE_TAURI_MOCKS = 'true';
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error' });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ args: ['--disable-gpu', '--disable-dev-shm-usage'] });
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const registry = await server.ssrLoadModule('/src/shell/routes.ts');
    const routes = [...new Set([...registry.ROUTES.flatMap(r => [r.path, ...r.tabs.map(t => t.path)]),
      '/leitstand/fabrik', '/leitstand/werkzeuge', '/leitstand/klassisch', '/leitstand/terminal?worker=w1', '/einstellungen/klassisch', '/designsystem'])];
    for (const items of [0, 2, 12]) for (const [width, height] of [[1440, 900], [1920, 1080]]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce', locale: 'de-DE' });
      try {
        await context.addInitScript(fixture, { items, theme });
        const page = await context.newPage();
        await page.clock.setFixedTime(new Date('2026-10-19T00:00:00Z'));
        const capture = async route => {
          const key = `${route}|${items}|${width}x${height}|${theme}`;
          const result = await page.evaluate(measure);
          counts[key] = metrics.map(m => result[m].length); details[key] = result;
          summary[route] ??= [0, 0, 0, 0, 0]; counts[key].forEach((n, i) => { summary[route][i] += n; });
          await page.screenshot({ path: resolve(out, `${key.replace(/[^\w-]/g, '_')}.png`) });
        };
        for (const route of routes) {
          await page.goto(`${base}/#${route}`, { waitUntil: 'networkidle' });
          await page.locator('.g-shell-content').waitFor();
          await page.waitForFunction(() => document.querySelector('.g-shell-content')?.innerText.trim());
          if (await page.evaluate(() => location.hash) !== `#${route}`) throw new Error(`unexpected redirect: ${route}`);
          await page.evaluate(() => document.fonts.ready);
          await capture(route);
          if (route === '/einstellungen') for (const id of await page.locator('.es [role="tab"]').evaluateAll(tabs => tabs.slice(1).map(t => t.id))) {
            await page.locator(`[id="${id}"]`).click();
            await page.waitForLoadState('networkidle');
            await capture(`${route}@${id}`);
          }
        }
        console.log(`Rendered ${items} items / ${width}x${height} / ${theme}`);
      } finally { await context.close(); }
    }
    const failures = baseline ? ratchet(counts, baseline, values.update) : [];
    const table = ['| Screen (sum of 12 cases) | Slack | Depth>2 | Empty tabs | Eyebrows | 1fr grids |', '|---|---:|---:|---:|---:|---:|',
      ...Object.entries(summary).map(([route, row]) => `| ${route} | ${row.join(' | ')} |`)].join('\n');
    console.log(table);
    writeFileSync(resolve(out, 'table.md'), table + '\n');
    writeFileSync(resolve(out, 'results.json'), JSON.stringify({ browser: browser.version(), counts, details, failures }, null, 2) + '\n');
    if (values.update && !failures.length) writeFileSync(baselinePath, serializeBaseline(counts));
    for (const failure of failures) console.error(failure);
    process.exitCode = failures.length ? 1 : 0;
  } finally { try { await browser?.close(); } finally { await server.close(); } }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
