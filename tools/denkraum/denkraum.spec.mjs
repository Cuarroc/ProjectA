import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
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

async function setupPage(page, metaContent, stateData, scriptError = false) {
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
        await route.fulfill({ json: stateData });
      }
    } else if (url.includes('/api/inbox')) {
      await route.fulfill({ status: 404 });
    } else if (url.includes('/api/ideas') || url.includes('/api/answers') || url.includes('/api/workbench')) {
      await route.fulfill({ json: {} });
    } else if (url.includes('/style.css')) {
      await route.fulfill({ body: '', contentType: 'text/css' });
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
