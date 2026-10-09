import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(join(__dirname, 'index.html'), 'utf8');

const ref = { kind: "idea", eventId: "ev1", ideaId: "i1", ideaRevision: 1 };
const stateWith = (rootAgentId, extra = {}) => ({
  schemaVersion: 2, revision: 1, answers: [], questions: [],
  ideas: [{ id: "i1", revisions: [{ revision: 1, eventId: "ev1", requestId: "r1", title: "Titel", text: "Text", createdAt: "2026-01-01T00:00:00Z" }] }],
  receipts: [{ eventRef: ref, rootAgentId, rootAcknowledgedAt: "2026-01-02T00:00:00Z", observedProof: "proof-text", ...extra }],
  progress: [{ eventId: "ev1", currentStatus: "planned", history: [{ to: "planned", patchRef: { id: "p1", revision: 1 } }] }],
  patches: [{ id: "p1", revision: 1, label: "l", windowText: "w", reason: "r", sourceRefs: [ref], authorityMode: "configured-verifier-attestation", authorityEvidenceRefs: ["evidence"] }],
});

async function setupPage(page, metaContent, stateData, scriptError = false, { clock = false } = {}) {
  if (clock) await page.clock.install();
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url === 'http://127.0.0.1/' || url === 'http://127.0.0.1/index.html') {
      let html = indexHtml;
      if (metaContent !== null) {
        html = html.replace('<head>', `<head>\n  <meta name="decision-desk-root-agent-id" content="${metaContent}">`);
      }
      await route.fulfill({ body: html, contentType: 'text/html' });
    } else if (url.includes('/api/state')) {
      if (stateData === "network-error") {
        await route.abort('failed');
      } else {
        await route.fulfill({ json: typeof stateData === 'function' ? stateData() : stateData });
      }
    } else if (url.includes('/api/inbox')) {
      await route.fulfill({ status: 404 });
    } else if (url.includes('/api/ideas') || url.includes('/api/answers') || url.includes('/api/workbench')) {
      await route.fulfill({ json: {} });
    } else if (url.includes('/style.css')) {
      await route.fulfill({ body: readFileSync(join(__dirname, 'style.css'), 'utf8'), contentType: 'text/css' });
    } else if (url.includes('/app/questions.js')) {
      const code = scriptError ? "throw new Error('split script startup broken');" : readFileSync(join(__dirname, 'app/questions.js'), 'utf8');
      await route.fulfill({ body: code, contentType: 'application/javascript' });
    } else if (url.includes('/app/ideas.js')) {
      await route.fulfill({ body: readFileSync(join(__dirname, 'app/ideas.js'), 'utf8'), contentType: 'application/javascript' });
    } else {
      await route.continue();
    }
  });

  await page.goto('http://127.0.0.1/');
  if (!scriptError) {
    // Wait for load to finish
    await page.waitForFunction(() => {
      const conn = document.getElementById('connection');
      const err = document.getElementById('global-error');
      return (conn && conn.textContent.includes('Aktualisiert')) || 
             (err && err.textContent.includes('unterbrochen')) ||
             (err && err.textContent.includes('Unbekanntes'));
    });
  }
}

const stamp = '2026-01-01T00:00:00Z';
const idea = (id, title, text, fields = {}, history = []) => ({
  id, revisions: [...history, { revision: history.length + 1, eventId: `e-${id}`, requestId: `r-${id}`, title, text, createdAt: stamp, ...fields }],
});
function categoryState(ideas) {
  return { schemaVersion: 2, revision: 1, answers: [], questions: [], ideas, receipts: [], progress: [], patches: [] };
}
async function openIdeas(page) { await page.locator('#area-think').click(); }
async function ideaIds(page) { return page.locator('.idea-card').evaluateAll(nodes => nodes.map(n => n.dataset.ideaId)); }

test("root receiver fails closed without injected id", async ({ page }) => {
  const dir = join(__dirname, 'app');
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.js')) {
      expect(readFileSync(join(dir, name), "utf8")).not.toMatch(/agent-\d+-[a-z0-9]+/i);
    }
  }
  
  await setupPage(page, null, stateWith("injected"));
  await expect(page.locator('#thinking-title')).toHaveText("Ideen entwickeln");
  expect(await page.evaluate(() => rootReceiver)).toBe(null);
  
  await setupPage(page, "", stateWith("injected"));
  expect(await page.evaluate(() => rootReceiver)).toBe(null);
  
  await setupPage(page, "injected", stateWith("injected"));
  expect(await page.evaluate(() => rootReceiver)).toBe("injected");
});

test("strongReceipt and patchFor and rendering reject absent or empty or mismatched root id", async ({ page }) => {
  const cases = [
    { name: "absent", meta: null, rootAgentId: "injected" },
    { name: "empty", meta: "", rootAgentId: "" },
    { name: "mismatched", meta: "other-root", rootAgentId: "injected" }
  ];
  
  for (const c of cases) {
    await setupPage(page, c.meta, stateWith(c.rootAgentId));
    expect(await page.evaluate((ref) => strongReceipt(ref), ref)).toBeUndefined();
    expect(await page.evaluate((ref) => patchFor(ref), ref)).toBeNull();
    
    await page.evaluate(() => renderIdeaState());
    const text = await page.evaluate(() => {
      const cards = document.getElementById('idea-cards');
      if (!cards) return null;
      const receipt = Array.from(cards.querySelectorAll('.idea-receipt')).find(el => el.textContent);
      return receipt ? receipt.textContent : null;
    });
    expect(text).toMatch(/Rootempfang offen/);
  }
});

test("strongReceipt and patchFor accept the matching injected root id", async ({ page }) => {
  await setupPage(page, "injected", stateWith("injected"));
  
  const receipt = await page.evaluate((ref) => strongReceipt(ref), ref);
  expect(receipt.rootAgentId).toBe("injected");
  
  const patch = await page.evaluate((ref) => patchFor(ref), ref);
  expect(patch.id).toBe("p1");
  
  await page.evaluate(() => renderIdeaState());
  const text = await page.evaluate(() => {
    const cards = document.getElementById('idea-cards');
    if (!cards) return null;
    const receipt = Array.from(cards.querySelectorAll('.idea-receipt')).find(el => el.textContent);
    return receipt ? receipt.textContent : null;
  });
  expect(text).toMatch(/Root empfangen .* · proof-text · Für Patch geplant/);
});

test("strongReceipt still requires proof and valid time and matching event and schema v2", async ({ page }) => {
  await setupPage(page, "injected", stateWith("injected", { observedProof: " " }));
  expect(await page.evaluate((ref) => strongReceipt(ref), ref)).toBeUndefined();
  
  await setupPage(page, "injected", stateWith("injected", { rootAcknowledgedAt: "not a date" }));
  expect(await page.evaluate((ref) => strongReceipt(ref), ref)).toBeUndefined();
  
  await setupPage(page, "injected", stateWith("injected"));
  expect(await page.evaluate((ref) => strongReceipt({ ...ref, eventId: "ev2" }), ref)).toBeUndefined();
  
  const stateV1 = stateWith("injected");
  stateV1.schemaVersion = 1;
  await setupPage(page, "injected", stateV1);
  expect(await page.evaluate((ref) => strongReceipt(ref), ref)).toBeNull();
});

test("validIdeaState rejects a receipt without a string root id", async ({ page }) => {
  await setupPage(page, "injected", stateWith("injected"));
  expect(await page.evaluate((state) => validIdeaState(state), stateWith("injected"))).toBe(true);
  expect(await page.evaluate((state) => validIdeaState(state), stateWith(null))).toBe(false);
});

test("check console errors", async ({ page }) => {
  page.on('console', msg => console.log('CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('ERROR:', err.message));
  await setupPage(page, "injected", stateWith("injected"));
});

test("invalid state is rejected", async ({ page }) => {
  const invalidState = stateWith("injected");
  invalidState.schemaVersion = 3;
  await setupPage(page, "injected", invalidState);
  expect(await page.evaluate(() => dataInvalid)).toBe(true);
  await expect(page.locator('#global-error')).toContainText(/Unbekanntes oder unvollständiges Datenformat/);
});

test("broken questions.js makes the test red", async ({ page }) => {
  let errorMsgs = [];
  page.on('pageerror', err => { errorMsgs.push(err.message); });
  await setupPage(page, "injected", stateWith("injected"), true);
  expect(errorMsgs.some(msg => msg.includes('split script startup broken'))).toBe(true);
});

test("D4: a missing or empty root id blocks every POST action", async ({ page }) => {
  const reason = 'Nur in diesem Browser · noch nicht an den Orchestrator gesendet.';
  const question = {
    id: 'Q1', title: 'Frage', context: 'C', owner: 'O', category: 'K', scope: 'S',
    source: 'S', uncertainty: 'U', revision: 1, mode: 'single',
    options: [{ id: 'a', label: 'A', rationale: 'r', impact: 'i', tradeoff: 't', effort: 'e', reversible: 'ja' }],
    recommendation: { optionIds: ['a'], rationale: 'R' },
  };
  const state = { ...stateWith('injected'), questions: [question] };
  const posts = [];
  page.on('request', req => { if (req.method() === 'POST') posts.push(new URL(req.url()).pathname); });

  async function expectBlocked(meta, run, statusSel) {
    posts.length = 0;
    await setupPage(page, meta, state);
    await run();
    await page.waitForTimeout(300);
    expect(posts, `meta=${JSON.stringify(meta)}`).toEqual([]);
    await expect(page.locator(statusSel)).toHaveText(reason);
  }

  for (const meta of [null, '']) {
    await expectBlocked(meta, async () => {
      await page.locator('#area-think').click();
      await page.locator('#idea').fill('Test idea');
      await page.locator('#idea-save').click();
    }, '#idea-status');

    await expectBlocked(meta, async () => {
      await page.locator('#option-Q1-a').check();
      await page.getByRole('button', { name: 'Auswahl prüfen' }).click();
      await page.getByRole('button', { name: 'Auswahl verbindlich speichern' }).click();
    }, '#detail .feedback');

    await expectBlocked(meta, async () => {
      await page.getByRole('button', { name: 'Später entscheiden' }).click();
      await page.getByRole('button', { name: 'Zurückstellung speichern' }).click();
    }, '#detail .feedback');

    await expectBlocked(meta, async () => {
      await page.locator('#note').fill('Rückfrage');
      await page.getByRole('button', { name: 'Rückfrage stellen' }).click();
      await page.getByRole('button', { name: 'Rückfrage senden' }).click();
    }, '#detail .feedback');

    await expectBlocked(meta, async () => {
      await page.locator('#area-think').click();
      await page.getByRole('button', { name: 'Ausarbeiten' }).click();
      await page.locator('#wb-variant-title-0').fill('Variante');
      await page.locator('#wb-variant-description-0').fill('Beschreibung');
      await page.locator('#wb-save').click();
    }, '#wb-status');
  }

  posts.length = 0;
  await setupPage(page, 'injected', state);
  await page.locator('#area-think').click();
  await page.locator('#idea').fill('Test idea');
  await page.locator('#idea-save').click();
  await page.waitForTimeout(300);
  expect(posts.some(p => p.includes('/api/ideas'))).toBe(true);
});

test('DR12: category projection and search intersection', async ({ page }) => {
  const ideas = [
    idea('b', 'Beta', 'Original alpha', { category: ' Technik ' }, [{ revision: 1, eventId: 'old-b', requestId: 'old', title: 'Historischer Titel', text: 'alt', createdAt: stamp, category: 'Historische Kategorie' }]),
    idea('a', 'Alpha', 'Original beta'),
    idea('blank', 'Leer', 'Leer', { category: ' ' }),
    idea('null', 'Null', 'Null', { category: null }),
    idea('invalid', 'Zahl', 'Zahl', { category: 7 }),
    idea('over', 'Zu lang', 'Zu lang', { category: 'A'.repeat(81) }),
    idea('edge', 'Grenze', 'Grenze', { category: ' ' + '😀'.repeat(40) + ' ' }),
    idea('edgeover', 'Über Grenze', 'Über Grenze', { category: '😀'.repeat(41) }),
    idea('star', 'Stern', 'Stern', { category: '*' }),
    idea('long80', 'L80', 'Text80', { category: 'S'.repeat(80) }),
  ];
  await setupPage(page, 'injected', categoryState(ideas));
  await openIdeas(page);
  const category = page.locator('#idea-category');
  await expect(category.locator('option').first()).toHaveText('Alle Kategorien');
  expect(await category.locator('option').first().getAttribute('value')).toBe('*');
  expect(await category.locator('option').evaluateAll(nodes => nodes.map(n => n.value))).not.toContain(JSON.stringify('Historische Kategorie'));
  await category.selectOption(JSON.stringify('Technik'));
  await page.locator('#idea-search').fill('ALPHA');
  expect(await ideaIds(page)).toEqual(['b']);
  await expect(page.locator('#idea-count')).toHaveText('1 von 10 gespeicherten Ideen');
  await page.locator('#idea-search').fill('Historischer Titel');
  expect(await ideaIds(page)).toEqual([]);
  await expect(page.locator('#idea-cards')).toContainText('Keine Ideen für diese Auswahl.');
  await page.locator('#idea-search').fill('');
  await category.selectOption('*');
  expect(await ideaIds(page)).toEqual(ideas.map(i => i.id));
  for (const [value, expected] of [
    ['', ['a', 'blank']],
    [null, ['null', 'invalid', 'over', 'edgeover']],
    ['😀'.repeat(40), ['edge']],
    ['*', ['star']],
    ['S'.repeat(80), ['long80']],
  ]) {
    await category.selectOption(JSON.stringify(value));
    expect(await ideaIds(page)).toEqual(expected);
  }
});

test('DR12: changed categories retain absent selection', async ({ page }) => {
  let live = categoryState([
    idea('b', 'Beta', 'Text', { category: 'Technik' }),
    idea('a', 'Alpha', 'Other', { category: 'Neu' }),
  ]);
  await setupPage(page, 'injected', () => live);
  await openIdeas(page);
  const category = page.locator('#idea-category');
  await category.selectOption(JSON.stringify('Technik'));
  expect(await ideaIds(page)).toEqual(['b']);
  live = categoryState([
    idea('b', 'Beta', 'Text', { category: 'Neu' }),
    idea('a', 'Alpha', 'Other', { category: 'Neu' }),
  ]);
  await page.evaluate(() => load());
  await page.waitForFunction(() => !loading);
  expect(await category.inputValue()).toBe(JSON.stringify('Technik'));
  await expect(category.locator('option:checked')).toContainText('derzeit nicht im Datenstand');
  expect(await ideaIds(page)).toEqual([]);
  expect(await category.locator('option').evaluateAll(nodes => nodes.map(n => n.value))).toEqual(['*', JSON.stringify('Neu'), JSON.stringify('Technik')]);
  live = categoryState([
    idea('b', 'Beta', 'Text', { category: 'Technik' }),
    idea('a', 'Alpha', 'Other', { category: 'Neu' }),
  ]);
  await page.evaluate(() => load());
  await page.waitForFunction(() => !loading);
  expect(await category.inputValue()).toBe(JSON.stringify('Technik'));
  expect(await ideaIds(page)).toEqual(['b']);
  expect(await page.evaluate(() => document.querySelector('#idea-category option:checked')?.textContent)).toBe('Technik');
});

test('DR12: unchanged options survive the 15 second poll', async ({ page }) => {
  const live = categoryState([
    idea('b', 'Beta', 'alpha text', { category: 'Technik' }),
    idea('a', 'Alpha', 'beta text', { category: 'Plan' }),
  ]);
  await setupPage(page, 'injected', () => live, false, { clock: true });
  await openIdeas(page);
  const category = page.locator('#idea-category');
  await category.selectOption(JSON.stringify('Technik'));
  await category.focus();
  expect(await page.evaluate(() => {
    const select = document.getElementById('idea-category');
    window.__dr12Category = { select, options: [...select.options], value: select.value };
    return document.activeElement === select;
  })).toBe(true);
  const second = page.waitForResponse(r => r.url().includes('/api/state') && r.ok());
  await page.clock.fastForward(15000);
  await second;
  await page.waitForFunction(() => !loading);
  const afterPoll = await page.evaluate(() => {
    const select = document.getElementById('idea-category'), prev = window.__dr12Category;
    return {
      sameSelect: select === prev.select,
      sameOptions: [...select.options].every((o, i) => o === prev.options[i]),
      value: select.value,
      focus: document.activeElement === select,
    };
  });
  expect(afterPoll).toEqual({ sameSelect: true, sameOptions: true, value: JSON.stringify('Technik'), focus: true });
  await page.locator('#idea-search').fill('alpha');
  const afterSearch = await page.evaluate(() => {
    const select = document.getElementById('idea-category'), prev = window.__dr12Category;
    return {
      sameSelect: select === prev.select,
      sameOptions: [...select.options].every((o, i) => o === prev.options[i]),
      value: select.value,
    };
  });
  expect(afterSearch).toEqual({ sameSelect: true, sameOptions: true, value: JSON.stringify('Technik') });
  expect(await ideaIds(page)).toEqual(['b']);
});

test('DR12: category refresh preserves draft and pending guards', async ({ page }) => {
  const ideas = [
    idea('b', 'Beta', 'Original', { category: 'Technik' }),
    idea('a', 'Alpha', 'Other', { category: '' }),
    idea('c', 'Gamma', 'More', { category: null }),
    idea('d', 'Delta', 'Last', { category: 'Plan' }),
  ];
  const errors = [];
  const posts = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await setupPage(page, 'injected', categoryState(ideas));
  await openIdeas(page);
  const category = page.locator('#idea-category');
  await category.selectOption(JSON.stringify('Technik'));
  expect(await page.locator('.idea-edit:enabled').count()).toBe(1);
  await category.focus();
  for (const id of ['priority', 'station']) { await page.keyboard.press('Tab'); await expect(page.locator(`#idea-${id}`)).toBeFocused(); }
  await page.keyboard.press('Tab');
  expect(await page.locator('.idea-card[data-idea-id="b"] .idea-edit').evaluate(n => document.activeElement === n)).toBe(true);
  await page.locator('.idea-card[data-idea-id="b"] .idea-edit').click();
  await page.locator('#idea').fill('Ungesicherter Entwurf');
  await page.locator('#idea').evaluate(n => n.setSelectionRange(3, 6));
  const saved = await page.evaluate(() => JSON.stringify({ ideaOperation, storage: { ...localStorage } }));
  await category.selectOption(JSON.stringify(''));
  await category.focus();
  await page.evaluate(() => load());
  await page.waitForFunction(() => !loading);
  expect(await category.inputValue()).toBe(JSON.stringify(''));
  expect(await page.evaluate(() => document.activeElement.id)).toBe('idea-category');
  expect(await page.locator('#idea').inputValue()).toBe('Ungesicherter Entwurf');
  expect(await page.locator('#idea').evaluate(n => [n.selectionStart, n.selectionEnd])).toEqual([3, 6]);
  expect(await page.evaluate(() => JSON.stringify({ ideaOperation, storage: { ...localStorage } }))).toBe(saved);
  const pending = { id: 'b', expectedRevision: 1, requestId: 'pending', title: 'Pending', text: 'Unbestätigter Text' };
  await page.evaluate(value => {
    localStorage.setItem('decision-desk.idea-operation.v1', JSON.stringify({ id: value.id, expectedRevision: 1, pending: value }));
  }, pending);
  await page.reload();
  await page.waitForFunction(() => {
    const conn = document.getElementById('connection');
    return conn && conn.textContent.includes('Aktualisiert');
  });
  await openIdeas(page);
  await page.locator('#idea-category').selectOption('null');
  await page.evaluate(() => load());
  await page.waitForFunction(() => !loading);
  expect(await page.evaluate(() => ideaOperation.pending)).toEqual(pending);
  expect(await page.locator('#idea').isDisabled()).toBe(true);
  const editCount = await page.locator('.idea-edit').count();
  expect(editCount).toBeGreaterThan(0);
  expect(await page.locator('.idea-edit').evaluateAll(nodes => nodes.every(n => n.disabled))).toBe(true);
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
  // Positive control: every write endpoint must reach the independent detector.
  for (const endpoint of ['ideas', 'answers', 'workbench']) {
    await page.evaluate(endpoint => fetch(`/api/${endpoint}`, { method: 'POST' }), endpoint);
  }
  expect(posts).toHaveLength(3);
});

test('DR12: real CSS gives field borders 3 to 1 contrast', async ({ page }) => {
  await setupPage(page, 'injected', categoryState([idea('a', 'Alpha', 'Text')]));
  await openIdeas(page);
  const sheets = await page.evaluate(() => [...document.styleSheets].some(s => {
    try { return [...s.cssRules].some(r => r.cssText?.includes('--line')); } catch { return false; }
  }));
  expect(sheets).toBe(true);
  // Read rendered pixels: Chromium composes gradients, alpha layers and backdrop filters.
  const contrastOf = async locator => page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
    const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    // Midpoints avoid rounded corners; darkest of top 4 rows is the border after DPR/AA.
    return [0.25, 0.5, 0.75].map(fraction => {
      const x = Math.floor(image.width * fraction);
      let border = pixel(x, 0), borderY = 0;
      for (let y = 1; y < Math.min(4, image.height); y++) { const p = pixel(x, y); if (lum(p) < lum(border)) { border = p; borderY = y; } }
      const fill = pixel(x, Math.min(image.height - 1, borderY + 2));
      const [light, dark] = [lum(border), lum(fill)].sort((a, b) => b - a);
      return { border, fill, contrast: (light + 0.05) / (dark + 0.05) };
    });
  }, (await locator.screenshot()).toString('base64'));
  const report = await contrastOf(page.locator('#idea'));
  console.log('DR12 rendered contrast', JSON.stringify(report));
  expect(Math.min(...report.map(sample => sample.contrast))).toBeGreaterThanOrEqual(3);
  const hoverBtn = page.locator('.idea-edit').first();
  await hoverBtn.hover();
  expect(Math.min(...(await contrastOf(hoverBtn)).map(s => s.contrast))).toBeGreaterThanOrEqual(3);
});

async function renderedBorderContrast(page, selector) {
  const image = await page.locator(selector).screenshot();
  return page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
    const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    // Midpoints avoid rounded corners; darkest of top 4 rows is the border after DPR/AA.
    return [0.25, 0.5, 0.75].map(fraction => {
      const x = Math.floor(image.width * fraction);
      let border = pixel(x, 0), borderY = 0;
      for (let y = 1; y < Math.min(4, image.height); y++) { const p = pixel(x, y); if (lum(p) < lum(border)) { border = p; borderY = y; } }
      const fill = pixel(x, Math.min(image.height - 1, borderY + 2));
      const [light, dark] = [lum(border), lum(fill)].sort((a, b) => b - a);
      return { border, fill, contrast: (light + 0.05) / (dark + 0.05) };
    });
  }, image.toString('base64'));
}

test('DR12: category controls fit 1440 390 and 320', async ({ page }, testInfo) => {
  const ideas = [
    idea('long', 'L'.repeat(200), 'Text'.repeat(2000), { category: 'S'.repeat(80), source: 'S'.repeat(2000) }),
    idea('b', 'Beta', 'Text', { category: 'Technik' }),
    idea('a', 'Alpha', 'Other'),
  ];
  const outDir = testInfo.outputDir;
  mkdirSync(outDir, { recursive: true });
  await setupPage(page, 'injected', categoryState(ideas));
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await openIdeas(page);
    await expect(page.getByLabel('Kategorie · Nutzerangabe (ungeprüft)', { exact: true })).toHaveCount(1);
    await page.locator('#idea-category').focus();
    expect(await page.evaluate(() => document.activeElement.id)).toBe('idea-category');
    expect(await page.locator('#idea-category').count()).toBe(1);
    expect(await page.locator('.idea-card').count()).toBeGreaterThan(0);
    const bounds = await page.locator('#idea-category,.idea-card').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect(), panel = document.getElementById('thinking').getBoundingClientRect();
      return { left: box.left, right: box.right, panelLeft: panel.left, panelRight: panel.right, overflow: node.scrollWidth - node.clientWidth };
    }));
    expect(bounds.every(b => b.left >= b.panelLeft - 1 && b.right <= b.panelRight + 1 && b.overflow <= 1)).toBe(true);
    const shot = join(outDir, `${width}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    expect(readFileSync(shot).length).toBeGreaterThan(1000);
  }
});

test('DR13: priority projection is strict and missing defaults normal', async ({ page }) => {
  const values = ['urgent', 'high', 'normal', 'later', undefined, null, '', ' ', 7, 'unknown'];
  const ids = values.map((_, i) => `p${i}`);
  await setupPage(page, 'injected', categoryState(values.map((value, i) =>
    idea(ids[i], 'Title', 'Text', value === undefined ? {} : { userPriority: value }))));
  await openIdeas(page);
  const priority = page.getByLabel('Nutzerpriorität', { exact: true });
  await expect(priority).toHaveCount(1);
  expect(await priority.locator('option').allTextContents()).toEqual(['Alle Prioritäten', 'Dringend', 'Hoch', 'Normal', 'Später', 'Nicht lesbar']);
  for (const [value, expected, label] of [
    ['urgent', ['p0'], 'Dringend'], ['high', ['p1'], 'Hoch'], ['normal', ['p2', 'p4'], 'Normal'],
    ['later', ['p3'], 'Später'], ['unreadable', ids.slice(5), 'Nicht lesbar'], ['*', ids, null],
  ]) {
    await priority.selectOption(value);
    expect(await ideaIds(page)).toEqual(expected);
    if (label) await expect(page.locator('.idea-card dt').filter({ hasText: /^Nutzerpriorität$/ }).locator('..').locator('dd')).toHaveText(expected.map(() => label));
  }
});

test('DR13: station filter uses only current event projection', async ({ page }) => {
  const old = { ...idea('old', 'Old', 'Old', { userPriority: 'urgent' }).revisions[0], eventId: 'old-event' };
  const data = categoryState(['absent', 'incoming', 'reviewed', 'planned', 'applied', 'receipt', 'old'].map(id =>
    idea(id, id, 'Current text', {}, id === 'old' ? [old] : [])));
  data.progress = ['incoming', 'reviewed', 'planned', 'applied'].map(status => ({ eventId: `e-${status}`, currentStatus: status, history: [] }));
  data.progress.unshift({ eventId: 'old-event', currentStatus: 'applied', history: [] });
  data.receipts = [['e-receipt', 'receipt', 1], ['old-event', 'old', 1]].map(([eventId, ideaId, ideaRevision]) => ({
    eventRef: { kind: 'idea', eventId, ideaId, ideaRevision }, rootAgentId: 'injected', rootAcknowledgedAt: stamp, observedProof: 'Receipt only',
  }));
  await setupPage(page, 'injected', data);
  await openIdeas(page);
  const station = page.getByLabel('Belegte Zuordnung', { exact: true });
  await expect(station).toHaveCount(1);
  expect(await station.locator('option').allTextContents()).toEqual(['Alle Zuordnungen', 'Eingang · Aktuelle Fassung gespeichert', 'Noch nicht zugeordnet']);
  await expect(station).toHaveAccessibleDescription('Weitere Stationen werden ergänzt; ein Rootempfang ordnet keine Station zu.');
  for (const [value, expected, label] of [
    ['incoming', ['absent', 'incoming', 'receipt', 'old'], 'Eingang · Aktuelle Fassung gespeichert'],
    ['unmapped', ['reviewed', 'planned', 'applied'], 'Noch nicht zugeordnet'],
  ]) {
    await station.selectOption(value);
    expect(await ideaIds(page)).toEqual(expected);
    await expect(page.locator('.idea-card dt').filter({ hasText: /^Station$/ }).locator('..').locator('dd')).toHaveText(expected.map(() => label));
  }
  await station.selectOption('*');
  await page.locator('#idea-priority').selectOption('urgent');
  expect(await ideaIds(page)).toEqual([]);
});

test('DR13: all four filters intersect and reset without reordering', async ({ page }) => {
  const data = categoryState([
    idea('z', 'ÄPFEL', 'Original', { category: ' Technik ', userPriority: 'high' }),
    idea('b', 'Beta', 'Äpfel Original', { category: 'Technik', userPriority: 'high' }),
    idea('a', 'Äpfel', 'Original', { category: 'Technik', userPriority: 'later' }),
    idea('c', 'Äpfel', 'Original', { category: 'Plan', userPriority: 'high' }),
    idea('d', 'Äpfel', 'Original', { category: 'Technik', userPriority: 'high' }),
    idea('e', 'Other', 'Original', { category: 'Technik', userPriority: 'high' }),
  ]);
  data.progress = [{ eventId: 'e-d', currentStatus: 'planned', history: [] }];
  await setupPage(page, 'injected', data);
  await openIdeas(page);
  for (const id of ['category', 'priority', 'station']) await expect(page.locator(`#idea-${id}`)).toHaveValue('*');
  await expect(page.locator('#idea-search')).toHaveValue('');
  await page.locator('#idea-search').fill('äPFEL');
  await page.locator('#idea-category').selectOption(JSON.stringify('Technik'));
  await page.locator('#idea-priority').selectOption('high');
  await page.locator('#idea-station').selectOption('incoming');
  expect(await ideaIds(page)).toEqual(['z', 'b']);
  await expect(page.locator('#idea-count')).toHaveText('2 von 6 gespeicherten Ideen');
  await page.locator('#idea-search').fill('  äPFEL');
  expect(await ideaIds(page)).toEqual([]);
  await expect(page.locator('#idea-count')).toHaveText('0 von 6 gespeicherten Ideen');
  await expect(page.locator('#idea-cards')).toHaveText('Keine Ideen für diese Auswahl.');
  await page.locator('#idea-search').fill('');
  for (const id of ['category', 'priority', 'station']) await page.locator(`#idea-${id}`).selectOption('*');
  expect(await ideaIds(page)).toEqual(data.ideas.map(i => i.id));
  await expect(page.locator('#idea-count')).toHaveText('6 von 6 gespeicherten Ideen');
});

test('DR13: filter polling preserves drafts pending and control nodes', async ({ page }) => {
  const data = categoryState([idea('b', 'Beta', 'Original', { category: 'Technik', userPriority: 'high', source: null })]);
  const errors = [], posts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await setupPage(page, 'injected', data, false, { clock: true });
  await openIdeas(page);
  await expect(page.locator('.idea-edit:enabled')).toHaveCount(1);
  await page.locator('.idea-edit').click();
  await page.locator('#idea').fill('Ungesicherter Entwurf');
  await page.locator('#idea').evaluate(n => n.setSelectionRange(3, 6));
  const pending = { id: 'b', expectedRevision: 1, requestId: 'pending', title: 'Pending', text: 'Unbestätigter Text', source: null };
  for (const isPending of [false, true]) {
    if (isPending) {
      await page.evaluate(value => localStorage.setItem('decision-desk.idea-operation.v1', JSON.stringify({ id: 'b', expectedRevision: 1, pending: value })), pending);
      await page.reload();
      await page.waitForFunction(() => state && !loading);
      await openIdeas(page);
      await page.locator('#idea').evaluate(n => n.setSelectionRange(3, 6));
    }
    await page.locator('#idea-search').fill('Original');
    await page.locator('#idea-search').evaluate(n => n.setSelectionRange(1, 4));
    await page.locator('#idea-category').selectOption(JSON.stringify('Technik'));
    await page.locator('#idea-priority').selectOption('high');
    await page.locator('#idea-station').selectOption('incoming');
    await page.locator('#idea-priority').focus();
    const saved = await page.evaluate(() => {
      window.dr13Nodes = [...document.querySelectorAll('#idea-search,#idea-category,#idea-priority,#idea-station,#idea-events option')];
      return JSON.stringify({ ideaOperation, storage: { ...localStorage }, binding: $('idea-binding').textContent });
    });
    const second = page.waitForResponse(r => r.url().endsWith('/api/state') && r.ok());
    await page.clock.fastForward(15000);
    await second;
    await page.waitForFunction(() => !loading);
    expect(await page.evaluate(() => (() => { const nodes = [...document.querySelectorAll('#idea-search,#idea-category,#idea-priority,#idea-station,#idea-events option')]; return nodes.length === window.dr13Nodes.length && nodes.every((n, i) => n === window.dr13Nodes[i]); })())).toBe(true);
    expect(await page.evaluate(() => JSON.stringify({ ideaOperation, storage: { ...localStorage }, binding: $('idea-binding').textContent }))).toBe(saved);
    expect(await page.evaluate(() => document.activeElement.id)).toBe('idea-priority');
    for (const [id, value] of [['search', 'Original'], ['category', JSON.stringify('Technik')], ['priority', 'high'], ['station', 'incoming']]) await expect(page.locator(`#idea-${id}`)).toHaveValue(value);
    await expect(page.locator('#idea')).toHaveValue('Ungesicherter Entwurf');
    expect(await page.locator('#idea').evaluate(n => [n.selectionStart, n.selectionEnd])).toEqual([3, 6]);
    expect(await page.locator('#idea-search').evaluate(n => [n.selectionStart, n.selectionEnd])).toEqual([1, 4]);
    expect(await page.locator('#idea').isDisabled()).toBe(isPending);
    await expect(page.locator('.idea-edit')).toHaveCount(1);
    expect(await page.locator('.idea-edit').isDisabled()).toBe(isPending);
    if (isPending) expect(await page.evaluate(() => ideaOperation.pending)).toEqual(pending);
    expect(await ideaIds(page)).toEqual(['b']);
  }
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
  for (const endpoint of ['ideas', 'answers', 'workbench']) await page.evaluate(endpoint => fetch(`/api/${endpoint}`, { method: 'POST' }), endpoint);
  expect(posts).toHaveLength(3);
});

test('DR13: filter controls remain usable at 1440 390 and 320', async ({ page }, testInfo) => {
  await setupPage(page, 'injected', categoryState([idea('long', 'L'.repeat(200), 'Text'.repeat(2000), { category: 'S'.repeat(80), source: 'S'.repeat(2000) })]));
  await openIdeas(page);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel('Nutzerpriorität', { exact: true })).toHaveCount(1);
    await expect(page.getByLabel('Belegte Zuordnung', { exact: true })).toHaveCount(1);
    await page.locator('#idea-category').focus();
    for (const id of ['priority', 'station']) {
      await page.keyboard.press('Tab');
      const control = page.locator(`#idea-${id}`);
      await expect(control).toBeFocused();
      expect(await control.evaluate(n => { const s = getComputedStyle(n); return n.matches(':focus-visible') && s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; })).toBe(true);
      await control.selectOption(id === 'priority' ? 'normal' : 'incoming');
      await control.blur();
      const contrast = await renderedBorderContrast(page, `#idea-${id}`);
      console.log(`DR13 ${width} ${id} rendered contrast`, JSON.stringify(contrast));
      expect(Math.min(...contrast.map(s => s.contrast))).toBeGreaterThanOrEqual(3);
      await control.focus();
    }
    expect(await ideaIds(page)).toEqual(['long']);
    const bounds = await page.locator('#idea-search,#idea-category,#idea-priority,#idea-station,.idea-card').evaluateAll(nodes => nodes.map(n => {
      const b = n.getBoundingClientRect(), p = document.getElementById('thinking').getBoundingClientRect();
      return b.left >= p.left && b.right <= p.right && n.scrollWidth <= n.clientWidth + 1;
    }));
    expect(bounds.every(Boolean)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`dr13-${width}.png`) });
  }
});
