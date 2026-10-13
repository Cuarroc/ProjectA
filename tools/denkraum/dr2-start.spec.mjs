import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const title = 'Eine ausführliche Frage über die nächsten Schritte ' + '𝄞'.repeat(35);
const ref = { kind: 'idea', ideaId: 'idea', eventId: 'event', ideaRevision: 1 };
const question = id => ({ id, revision: 1, title: `${title} ${id}`, mode: 'single', createdAt: '2026-01-01T00:00:00.000Z',
  options: [{ id: 'yes', label: 'Übernehmen', rationale: 'Begründung', impact: 'Die Einstellung gilt für alle Projekte.', tradeoff: 'Abwägung', effort: 'Klein', reversible: 'Rücknahme möglich' }],
  recommendation: { optionIds: ['yes'], rationale: 'Ausführliche Empfehlung' }, recommendationDetail: { hypothesis: 'Vorschlag', consequences: 'Ändert den Standard.', reversibility: 'Rücknahme möglich', authorityRefs: ['reference'], observation: { statement: 'Beobachtung', evidenceRefs: ['proof'], observedAt: '2026-01-01T00:00:00Z' } } });
const fixture = () => ({ schemaVersion: 2, revision: 1, questions: ['d', 'b', 'a', 'c'].map(question), answers: [],
  ideas: [{ id: 'idea', revisions: [{ revision: 1, eventId: 'event', requestId: 'request', title, text: 'Idee', createdAt: '2026-01-01T00:00:00Z' }] }],
  receipts: [{ eventRef: ref, rootAgentId: 'receiver', rootAcknowledgedAt: '2026-01-02T00:00:00Z', observedProof: 'proof' }],
  progress: [{ eventId: 'event', currentStatus: 'planned', history: [{ to: 'planned', patchRef: { id: 'patch', revision: 1 } }] }],
  patches: [{ id: 'patch', revision: 1, label: 'Nächster Schritt', windowText: 'Nach Abnahme', reason: 'Planbegründung', sourceRefs: [ref], authorityMode: 'configured-verifier-attestation', authorityEvidenceRefs: ['authority-proof'] }] });
async function boot(page, data) {
  await page.clock.install();
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/state') return route.fulfill({ json: data() });
    if (path.startsWith('/api/')) return route.fulfill({ status: 404 });
    const body = path === '/' ? read('index.html').replace('<head>', '<head><meta name="decision-desk-root-agent-id" content="receiver">')
      : path === '/design/glass.css' ? read('../../src/design/tokens.css') + '\n' + read('../../src/design/motion.css') : read(`.${path}`);
    return route.fulfill({ body, contentType: path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'application/javascript' : 'text/html' });
  });
  await page.goto('http://127.0.0.1/');
  await expect(page.locator('#connection')).toContainText('Aktualisiert');
}
async function capture(page, info, name) {
  for (const [width, height] of [[1440, 900], [1280, 800]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`${process.env.DR2_CAPTURE_PREFIX || 'after'}-${name}-${width}.png`) });
    const measured = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), range = document.createRange(); let chars = 0;
      while (walker.nextNode()) { const n = walker.currentNode; if (!n.parentElement.checkVisibility()) continue; let offset = 0;
        for (const ch of n.textContent) { range.setStart(n, offset); offset += ch.length; range.setEnd(n, offset); const r = range.getBoundingClientRect(); if (ch.trim() && r.width && r.height && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && n.parentElement.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))) chars++; }
      }
      return { chars, primary: [...document.querySelectorAll('.primary')].filter(n => n.checkVisibility()).length };
    });
    console.log(`${name} ${width}x${height}: ${JSON.stringify(measured)}`);
  }
}
test('DR2 start limits attention to three current questions', async ({ page }, info) => {
  const data = fixture(); data.questions.push({ ...question('old'), sourceRef: { ...ref, eventId: 'old' } }, question('done'));
  data.answers.push({ id: 'answer', questionId: 'done', questionRevision: 1, action: 'answer', selected: ['yes'] });
  await boot(page, () => data); await capture(page, info, 'start');
  const home = page.locator('#home'); await expect(home).toBeVisible();
  await expect(home.locator('.question-link')).toHaveCount(3);
  await expect(home.locator('.question-link strong')).toHaveText(['a', 'b', 'c'].map(() => 'Eine ausführliche Frage über die nächsten Schritte 𝄞𝄞𝄞𝄞𝄞𝄞𝄞𝄞…'));
  expect(await home.locator('.question-link').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')))).toEqual(['a', 'b', 'c'].map(id => `${title} ${id}`));
  await expect(home.locator('.badge')).toHaveText(['Braucht dich', 'Braucht dich', 'Braucht dich']);
  await expect(page.locator('.primary:visible')).toHaveCount(1);
  const action = home.getByRole('button', { name: 'Nächste Frage öffnen' }); await expect(action).toBeInViewport();
  await action.click(); await expect(page.locator('#detail')).toBeFocused();
  await expect(page.locator('#option-a-yes')).not.toBeChecked();
  await page.locator('#area-home').click(); await home.getByRole('button', { name: 'Alle ansehen' }).click();
  await expect(page.locator('#questions .question-link')).toHaveCount(6);
  await page.locator('#area-home').click(); data.questions = [question('only')]; await page.clock.runFor(15000);
  await expect(home.locator('.question-link')).toHaveCount(1);
  data.questions = []; await page.clock.runFor(15000); await expect(home.locator('.question-link')).toHaveCount(0);
  await expect(home.locator('.primary')).toHaveText('Idee einreichen');
  await home.locator('.primary').click(); await page.locator('#idea').fill('Mein Entwurf');
  await page.locator('#area-home').click();
  await page.route('**/api/state', route => route.abort('internetdisconnected')); await page.clock.runFor(15000);
  await expect(home).not.toContainText('Keine offenen Fragen'); await expect(home.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
  await page.locator('#area-think').click(); await expect(page.locator('#idea')).toHaveValue('Mein Entwurf');
  await page.reload(); await expect(page.locator('#home')).toContainText('nicht geladen');
  await page.route('**/api/state', route => route.fulfill({ status: 503, json: { error: 'Vorübergehend nicht verfügbar' } }));
  await page.getByRole('button', { name: 'Erneut versuchen' }).click(); await expect(page.locator('#global-error')).toContainText('Vorübergehend');
  await page.route('**/api/state', route => route.fulfill({ json: data })); await page.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(page.locator('#home .primary')).toHaveText('Idee einreichen');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(page.locator('#home .primary')).toHaveCSS('transition-duration', '0s');
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(13, 18, 25)');
  await page.screenshot({ path: info.outputPath('after-empty-dark-1280.png') });
});
test('DR2 clarification stays gated until a keyboard-accessible note exists', async ({ page }) => {
  await boot(page, fixture); await page.locator('#area-now').click();
  const clarify = page.getByRole('button', { name: 'Rückfrage stellen' });
  await expect(page.locator('#note')).toBeHidden(); await expect(clarify).toBeDisabled();
  await page.getByText('Notiz hinzufügen', { exact: true }).focus(); await page.keyboard.press('Enter');
  await page.keyboard.press('Tab'); await expect(page.locator('#note')).toBeFocused();
  await page.locator('#note').fill('  '); await expect(clarify).toBeDisabled();
  await page.locator('#note').fill('Warum?'); await clarify.click();
  await expect(page.getByRole('button', { name: 'Rückfrage senden' })).toBeFocused();
  await expect(page.locator('form .notice')).toContainText('keine Zustimmung');
});
test('DR2 malformed recommendation details preserve the basic recommendation', async ({ page }) => {
  const data = fixture(); data.questions[2].recommendationDetail.observation = null;
  await boot(page, () => data); await page.locator('#area-now').click();
  await expect(page.locator('#detail > .recommendation')).toHaveCount(1);
  await expect(page.locator('#detail > .recommendation strong')).toHaveText('Empfehlung: Übernehmen');
  await page.getByText('Warum diese Empfehlung?', { exact: true }).click();
  await expect(page.locator('#detail > .recommendation')).toContainText('Ausführliche Empfehlung');
});
test('DR2 confirmation omits non-text recommendation consequences', async ({ page }) => {
  const data = fixture(); data.questions[2].recommendationDetail.consequences = { invalid: true };
  await boot(page, () => data); await page.locator('#area-now').click();
  await page.locator('#option-a-yes').check(); await page.getByRole('button', { name: 'Auswahl prüfen' }).click();
  await expect(page.locator('form .notice')).toContainText('Die Einstellung gilt für alle Projekte.');
  await expect(page.locator('form .notice')).not.toContainText('[object Object]');
  await expect(page.getByRole('button', { name: 'Auswahl verbindlich speichern' })).toBeFocused();
});
test('DR2 declares both supported color schemes before styles load', async ({ page }) => {
  await boot(page, fixture);
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'light dark');
});
test('DR2 compact text keeps originals and confirmation reachable', async ({ page }, info) => {
  const data = fixture(); await boot(page, () => data); await page.locator('#area-now').click();
  await capture(page, info, 'question'); await page.locator('#area-plan').click(); await capture(page, info, 'planned'); await page.locator('#area-now').click();
  expect([...await page.locator('#detail h2').innerText()].length).toBeLessThanOrEqual(60);
  const more = page.locator('#detail > details').filter({ has: page.getByText('mehr', { exact: true }) });
  await more.locator('summary').focus(); await page.keyboard.press('Enter'); await expect(more.locator('p')).toHaveText(`${title} a`);
  await expect(page.locator('#detail > .recommendation')).toHaveCount(1); await expect(page.locator('#note')).toBeHidden();
  await page.locator('#option-a-yes').check(); await page.getByRole('button', { name: 'Auswahl prüfen' }).click();
  await expect(page.getByText('Die Einstellung gilt für alle Projekte.', { exact: false }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Auswahl verbindlich speichern' })).toBeFocused();
  await page.getByRole('button', { name: 'Zurück zum Entwurf' }).click(); await page.getByText('Notiz hinzufügen', { exact: true }).click();
  await page.locator('#note').fill('Erhalten'); await page.clock.runFor(15000); await expect(page.locator('#note')).toHaveValue('Erhalten');
  let sent; await page.route('**/api/answers', route => { sent = route.request().postDataJSON(); const answer = { ...sent, id: 'saved', question: data.questions.find(q => q.id === sent.questionId) }; data.answers.push(answer); return route.fulfill({ json: answer }); });
  await page.getByRole('button', { name: 'Auswahl prüfen' }).click(); expect(sent).toBeUndefined();
  await page.getByRole('button', { name: 'Auswahl verbindlich speichern' }).click(); await expect(page.locator('#save-status')).toContainText('Antwort gespeichert');
  expect(sent).toMatchObject({ questionId: 'a', selected: ['yes'], note: 'Erhalten', action: 'answer' });
  await page.locator('#area-plan').click();
  expect([...await page.locator('#planned h3').first().innerText()].length).toBeLessThanOrEqual(60);
  await page.locator('#planned').getByText('mehr', { exact: true }).click(); await expect(page.locator('#planned')).toContainText(title);
  await expect(page.getByText('Planbegründung', { exact: true })).toBeHidden();
  await page.locator('#planned').getByText('Begründung und Belege').click(); await expect(page.getByText('Planbegründung', { exact: true })).toBeVisible();
  data.questions = [{ ...question('free'), mode: 'free', options: [], recommendation: null, sourceRef: ref, contentOrigin: { actor: 'fixture', sourceRefText: 'idea' } }];
  await page.clock.runFor(15000); await page.locator('#area-now').click(); await page.locator('#questions .question-link').click();
  await expect(page.locator('#note')).toBeVisible(); await page.locator('#note').fill('Freie Antwort');
  await page.getByRole('button', { name: 'Antwort prüfen' }).click(); await expect(page.getByRole('button', { name: 'Antwort speichern' })).toBeFocused();
});
