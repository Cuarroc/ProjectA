const ideaKey = 'decision-desk.idea-draft.v1';
try { $('idea').value = localStorage.getItem(ideaKey) || ''; } catch { $('idea-status').textContent = 'Nur in dieser geöffneten Seite · Browser-Speicher nicht verfügbar.'; }
$('idea').addEventListener('input', () => { try { localStorage.setItem(ideaKey, $('idea').value); $('idea-status').textContent = 'Entwurf geändert · noch nicht gespeichert.'; } catch { $('idea-status').textContent = 'Nur in dieser geöffneten Seite · bitte den Entwurf vor dem Schließen kopieren.'; } });
window.addEventListener('storage', event => { if (event.key === storageKey && view) showChanged('Ein anderes Fenster hat lokale Entwürfe geändert. Deine Eingaben bleiben in diesem Fenster erhalten. Prüfe vor dem Senden den aktuellen Stand.'); });
// DD3a target binding; absence of a route is not successful storage or delivery.
// rootReceiver comes from questions.js (loaded first).
const ideaOperationKey = 'decision-desk.idea-operation.v1';
let ideaOperation = { id: null, expectedRevision: null, pending: null }, recoveryConfirmed = false, ideaRecovery = false;
function ideaIdValid(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value); }
function validIdeaPayload(payload) { return record(payload) && ideaIdValid(payload.requestId)
  && (payload.id === undefined ? payload.expectedRevision === null : ideaIdValid(payload.id) && Number.isSafeInteger(payload.expectedRevision) && payload.expectedRevision > 0)
  && ['title', 'text'].every(key => typeof payload[key] === 'string' && payload[key].trim() && payload[key].length <= (key === 'title' ? 200 : 8000))
  && (payload.source == null || typeof payload.source === 'string' && payload.source.trim() && payload.source.length <= 2000); }
try { const stored = JSON.parse(localStorage.getItem(ideaOperationKey) || 'null'); if (record(stored)) {
  ideaOperation = stored; const pending = stored.pending;
  ideaRecovery = pending != null ? !validIdeaPayload(pending) : !(stored.id === null && stored.expectedRevision === null || ideaIdValid(stored.id) && Number.isSafeInteger(stored.expectedRevision) && stored.expectedRevision > 0);
  if (pending != null && typeof pending.text === 'string' && !$('idea').value.trim()) $('idea').value = pending.text;
  if (pending != null && !ideaRecovery) { ideaOperation.id = pending.id ?? null; ideaOperation.expectedRevision = pending.expectedRevision; }
} } catch { ideaRecovery = true; /* Preserve the existing free-text draft; require explicit recovery. */ }
const ideaSave = button('Idee speichern', saveIdea, 'primary'); ideaSave.id = 'idea-save';
const ideaNew = button('Als neue Idee verwenden', () => { if (ideaPosting || ideaOperation.pending) return; ideaOperation = { id: null, expectedRevision: null, pending: null }; persistIdeaOperation(); updateIdeaControls(); $('idea-status').textContent = 'Nur lokaler Entwurf für eine neue Idee · keine Ausführungsfreigabe.'; });
const ideaRecover = button('Ungültige Anfrage verwerfen · Entwurf behalten', () => {
  if (!ideaRecovery || ideaPosting) return;
  if (!recoveryConfirmed) { recoveryConfirmed = true; ideaRecover.textContent = 'Verwerfen bestätigen · Entwurf behalten'; $('idea-status').textContent = 'Nur die ungültige lokale Anfrage wird verworfen. Der Text bleibt erhalten; Speichern wäre danach eine neue Anfrage.'; return; }
  ideaOperation = { id: null, expectedRevision: null, pending: null }; ideaRecovery = false; recoveryConfirmed = false; persistIdeaOperation(); updateIdeaControls(); $('idea-status').textContent = 'Ungültige lokale Anfrage verworfen · Entwurf erhalten und noch nicht neu gesendet.';
}); ideaRecover.id = 'idea-recover';
const ideaActions = node('div', undefined, 'actions'); ideaActions.append(ideaSave, ideaNew, ideaRecover); $('idea-status').before(ideaActions);
const ideaBinding = node('p', '', 'idea-binding'); ideaBinding.id = 'idea-binding'; $('idea').before(ideaBinding); $('idea').setAttribute('aria-describedby', `${$('idea').getAttribute('aria-describedby') || ''} idea-binding`.trim());
const ideaEditor = node('div', undefined, 'idea-editor'); ideaEditor.append(...$('thinking').children); $('thinking').append(ideaEditor);
$('thinking-title').textContent = 'Ideen entwickeln';
const ideaEvents = node('section'); ideaEvents.id = 'idea-events'; ideaEvents.setAttribute('aria-label', 'Gespeicherte Ideen'); $('thinking').append(ideaEvents);
const inboxStatus = node('p', '', 'muted'); inboxStatus.id = 'inbox-status'; $('thinking').append(inboxStatus);
$('idea-boundary').textContent = 'Eine gespeicherte Idee ist kein Auftrag und keine Zustimmung. Rootempfang, Prüfung, Planung und Umsetzung brauchen jeweils eigene Belege.';
$('idea').addEventListener('input', updateIdeaControls);
function persistIdeaOperation() { try { localStorage.setItem(ideaOperationKey, JSON.stringify(ideaOperation)); } catch { $('global-error').hidden = false; $('global-error').textContent = 'Die Anfragekennung bleibt nur in dieser geöffneten Seite. Vor dem Schließen den Entwurf sichern.'; } }
function updateIdeaControls() {
  for (const edit of ideaEvents.querySelectorAll('.idea-edit')) edit.disabled = ideaPosting || Boolean(ideaOperation.pending) || ideaRecovery;
  ideaSave.disabled = loading || posting || ideaPosting || dataInvalid || ideaRecovery || state?.schemaVersion !== 2 || (!ideaOperation.pending && !$('idea').value.trim());
  ideaSave.textContent = ideaOperation.pending ? 'Speicherung erneut prüfen' : ideaOperation.id ? 'Neue Fassung speichern' : 'Idee speichern';
  ideaBinding.textContent = ideaOperation.id ? `Entwurf verbunden mit Fassung ${ideaOperation.expectedRevision} · Speichern erstellt eine neue Fassung.` : 'Entwurf für eine neue Idee · noch nicht gespeichert'; $('idea').disabled = ideaPosting || Boolean(ideaOperation.pending);
  ideaNew.disabled = ideaPosting || Boolean(ideaOperation.pending) || ideaRecovery; ideaNew.hidden = !ideaOperation.id;
  ideaRecover.hidden = !ideaRecovery; ideaRecover.disabled = ideaPosting;
  if (ideaRecovery && !recoveryConfirmed) $('idea-status').textContent = 'Die gespeicherte Anfrage ist ungültig. Entwurf sichern und die ungültige Anfrage ausdrücklich verwerfen; es wird nichts gesendet.';
  else if (!state) $('idea-status').textContent = 'Noch kein geprüfter Datenstand · Speichern ist gesperrt. Aktualisieren und danach erneut prüfen.';
  if (ideaOperation.pending && $('idea-status').textContent.startsWith('Nur in')) $('idea-status').textContent = 'Frühere Speicherprüfung offen · dieselbe Anfrage erneut prüfen. Dein Entwurf bleibt erhalten.';
  if (state?.schemaVersion === 1) $('idea-status').textContent = 'Nur in diesem Browser · diese Backendversion hat noch keinen Ideenspeicher.';
}
function validEventRef(ref) { return record(ref) && typeof ref.eventId === 'string' && (ref.kind === 'answer' ? typeof ref.questionId === 'string' && Number.isSafeInteger(ref.questionRevision) && ref.questionRevision > 0 : ref.kind === 'idea' && typeof ref.ideaId === 'string' && Number.isSafeInteger(ref.ideaRevision) && ref.ideaRevision > 0); }
function sameEvent(a, b) { return validEventRef(a) && validEventRef(b) && a.kind === b.kind && a.eventId === b.eventId && (a.kind === 'answer' ? a.questionId === b.questionId && a.questionRevision === b.questionRevision : a.ideaId === b.ideaId && a.ideaRevision === b.ideaRevision); }
function validIdeaState(data) {
  if (data.schemaVersion === 1) return true;
  return ['ideas', 'receipts', 'progress', 'patches'].every(key => Array.isArray(data[key]))
    && data.ideas.every(i => record(i) && typeof i.id === 'string' && Array.isArray(i.revisions) && i.revisions.length > 0 && i.revisions.every(r => record(r) && Number.isSafeInteger(r.revision) && r.revision > 0 && ['eventId', 'requestId', 'title', 'text', 'createdAt'].every(key => typeof r[key] === 'string')))
    && data.receipts.every(r => record(r) && validEventRef(r.eventRef) && typeof r.rootAgentId === 'string' && typeof r.rootAcknowledgedAt === 'string' && typeof r.observedProof === 'string')
    && data.progress.every(p => record(p) && typeof p.eventId === 'string' && ['incoming', 'reviewed', 'planned', 'applied'].includes(p.currentStatus) && Array.isArray(p.history) && p.history.every(record))
    && data.patches.every(p => record(p) && typeof p.id === 'string' && typeof p.label === 'string' && typeof p.windowText === 'string' && typeof p.reason === 'string' && Array.isArray(p.sourceRefs) && p.sourceRefs.every(validEventRef) && strings(p.authorityEvidenceRefs));
}
const answerRef = a => ({ kind: 'answer', eventId: a.id, questionId: a.questionId, questionRevision: a.questionRevision });
const ideaRef = (i, r) => ({ kind: 'idea', eventId: r.eventId, ideaId: i.id, ideaRevision: r.revision });
function activeEvents() {
  if (!state) return [];
  const answers = state.answers.filter(a => latest(a.questionId)?.id === a.id && answerCurrent(a)).map(a => ({ ref: answerRef(a), title: a.question?.title || a.questionId, action: a.action }));
  return answers.concat(state.schemaVersion === 2 ? state.ideas.map(i => { const r = i.revisions.at(-1); return { ref: ideaRef(i, r), title: r.title, action: 'idea', idea: i, revision: r }; }) : []);
}
function strongReceipt(ref) { return state?.schemaVersion === 2 ? state.receipts.find(r => sameEvent(r.eventRef, ref) && r.rootAgentId === rootReceiver && r.observedProof.trim() && Number.isFinite(Date.parse(r.rootAcknowledgedAt))) : null; }
function patchFor(ref) {
  if (state?.schemaVersion !== 2 || !strongReceipt(ref)) return null;
  const progress = state.progress.find(p => p.eventId === ref.eventId), final = progress?.history.at(-1), bound = final?.patchRef;
  if (!['planned', 'applied'].includes(progress?.currentStatus) || final?.to !== progress.currentStatus || !record(bound) || typeof bound.id !== 'string' || !Number.isSafeInteger(bound.revision) || bound.revision < 1) return null;
  return state.patches.find(p => p.id === bound.id && p.revision === bound.revision && p.sourceRefs.some(source => sameEvent(source, ref))
    && p.authorityMode === 'configured-verifier-attestation' && p.authorityEvidenceRefs.length > 0 && p.authorityEvidenceRefs.every(ref => ref.trim())) || null;
}
function eventSummary(ref, action) {
  const received = strongReceipt(ref); if (!received) return 'Gespeichert · Rootempfang offen. Eine Warteschlange oder ein Altbeleg bestätigt keinen Rootempfang.';
  const progress = state.progress.find(p => p.eventId === ref.eventId), prefix = `Gespeichert · Root empfangen ${date(received.rootAcknowledgedAt)} · ${received.observedProof}`;
  if (progress?.currentStatus === 'reviewed') return `${prefix} · Geprüft`;
  if (['defer', 'clarify'].includes(action)) return `${prefix} · Keine Ausführungsfreigabe`;
  if (progress?.currentStatus === 'planned' && patchFor(ref)) return `${prefix} · Für Patch geplant`;
  const final = progress?.history.at(-1);
  const implementation = final?.implementationEvidence;
  if (progress?.currentStatus === 'applied' && patchFor(ref) && final?.to === 'applied' && record(implementation) && implementation.eventId === ref.eventId
    && ['id', 'artifactRef', 'observedAt', 'check', 'observedResult', 'actor'].every(key => typeof implementation[key] === 'string' && implementation[key].trim()) && Number.isFinite(Date.parse(implementation.observedAt)))
    return `${prefix} · Umgesetzt · ${implementation.artifactRef} · ${implementation.check} · ${implementation.observedResult} · ${implementation.actor} · ${date(implementation.observedAt)}`;
  return `${prefix} · Weitere Bearbeitung noch nicht belegt`;
}
function ideaCategory(event) {
  const r = event.revision;
  return !Object.hasOwn(r, 'category') ? '' : typeof r.category === 'string' && r.category.trim().length <= 80 ? r.category.trim() : null;
}
let ideaCategoryDescriptors = '';
function updateIdeaCategories(events) {
  const select = $('idea-category'), selected = select.value;
  const categories = [...new Set(events.map(event => JSON.stringify(ideaCategory(event))))];
  const label = value => value === 'null' ? 'Nicht lesbar' : JSON.parse(value) || 'Keine Kategorie';
  const descriptors = [['*', 'Alle Kategorien'], ...categories.map(value => [value, label(value)])];
  if (selected !== '*' && selected !== '' && !categories.includes(selected)) descriptors.push([selected, label(selected) + ' · derzeit nicht im Datenstand']);
  const encoded = JSON.stringify(descriptors);
  if (encoded === ideaCategoryDescriptors) return;
  ideaCategoryDescriptors = encoded;
  select.replaceChildren();
  for (const [value, text] of descriptors) {
    const option = node('option', text); option.value = value; select.append(option);
  }
  select.value = selected;
}
function ideaMetadata(event) {
  const r = event.revision, priorities = ['urgent', 'high', 'normal', 'later'];
  const names = { urgent: 'Dringend', high: 'Hoch', normal: 'Normal', later: 'Später' };
  const category = ideaCategory(event);
  const priority = !Object.hasOwn(r, 'userPriority') ? 'normal' : priorities.includes(r.userPriority) ? r.userPriority : null;
  const source = r.source == null ? 'Nicht hinterlegt' : typeof r.source === 'string' && r.source.trim() && r.source.length <= 2000 ? r.source : 'Nicht lesbar';
  const progress = state.progress.find(p => p.eventId === event.ref.eventId);
  const station = !progress || progress.currentStatus === 'incoming' ? 'Eingang · Aktuelle Fassung gespeichert' : 'Noch nicht zugeordnet';
  return facts([['Kategorie · Nutzerangabe (ungeprüft)', category === null ? 'Nicht lesbar' : category || 'Keine Kategorie'],
    ['Nutzerpriorität', priority === null ? 'Nicht lesbar' : names[priority]], ['Herkunft · Revisionsangabe (ungeprüft)', source], ['Station', station]]);
}
function ideaStations() {
  const band = node('ol'); band.id = 'idea-stations'; band.setAttribute('aria-label', 'Ideenstationen');
  for (const station of ['Eingang', 'Einordnen', 'Prüfen', 'Ausarbeiten', 'Zur Entscheidung', 'Bereit', 'Eingeplant', 'Umsetzung', 'Geliefert']) {
    band.append(node('li', `${station} · ${station === 'Eingang' ? 'Aktuelle Fassung gespeichert' : 'Wird ergänzt'}`));
  }
  return band;
}
function renderIdeaState() {
  const events = activeEvents(), all = events.filter(event => event.idea);
  if (document.getElementById('idea-search')?.id !== 'idea-search') {
    const label = node('label', 'Titel oder Originaltext durchsuchen'); label.htmlFor = 'idea-search';
    const search = node('input'); search.id = 'idea-search'; search.type = 'search';
    search.addEventListener('input', renderIdeaState);
    const categoryLabel = node('label', 'Kategorie · Nutzerangabe (ungeprüft)'); categoryLabel.htmlFor = 'idea-category';
    const category = node('select'); category.id = 'idea-category';
    const every = node('option', 'Alle Kategorien'); every.value = '*'; category.append(every); category.value = '*';
    category.addEventListener('change', renderIdeaState);
    const count = node('p', '', 'muted'); count.id = 'idea-count'; count.setAttribute('role', 'status');
    const cards = node('div'); cards.id = 'idea-cards';
    ideaEvents.append(node('h3', 'Deine gespeicherten Ideen'), ideaStations(), label, search, categoryLabel, category, count, cards);
  }
  const term = $('idea-search').value.toLocaleLowerCase('de');
  updateIdeaCategories(all); const selectedCategory = $('idea-category').value || '*';
  const ideas = all.filter(event => [event.title, event.revision.text].join(' ').toLocaleLowerCase('de').includes(term)
    && (selectedCategory === '*' || JSON.stringify(ideaCategory(event)) === selectedCategory));
  const cards = $('idea-cards'); cards.replaceChildren(); $('idea-count').textContent = `${ideas.length} von ${all.length} gespeicherten Ideen`;
  for (const event of ideas) {
    const item = node('article', undefined, 'idea-card');
    item.dataset.ideaId = event.idea.id; item.append(node('h3', event.title), ideaMetadata(event));
    item.append(node('p', 'Eigene Einordnung fehlt · Nutzerangaben sind keine Belege für Rootempfang, Prüfung oder Freigabe.', 'muted'));
    item.append(node('p', `Fassung ${event.revision.revision} · ${date(event.revision.createdAt)}`, 'muted'), node('p', event.revision.text, 'idea-text'), node('p', eventSummary(event.ref, event.action).replace(/^Gespeichert/, 'Aktuelle Fassung gespeichert'), 'idea-receipt'));
    const edit = button('Idee bearbeiten', () => {
      if (ideaPosting || ideaOperation.pending || ideaRecovery) return;
      let draftStored = true;
      ideaOperation = { id: event.idea.id, expectedRevision: event.revision.revision, pending: null };
      if (!$('idea').value.trim()) { $('idea').value = event.revision.text; try { localStorage.setItem(ideaKey, $('idea').value); } catch { draftStored = false; } }
      persistIdeaOperation(); updateIdeaControls(); $('idea').focus();
      $('idea-status').textContent = `Dein Entwurf bleibt erhalten · verbunden mit Fassung ${event.revision.revision}. Erst Speichern erstellt die nächste Fassung.${draftStored ? '' : ' Browser-Speicher nicht verfügbar; Text vor dem Schließen sichern.'}`;
    });
    edit.classList.add('idea-edit');
    edit.disabled = ideaPosting || Boolean(ideaOperation.pending) || ideaRecovery;
    item.append(edit, button('Ausarbeiten', () => openWorkbench(event.idea))); appendWorkbench(item, event.idea);
    if (event.idea.revisions.length > 1) {
      const history = node('details', undefined, 'idea-history');
      history.append(node('summary', `Frühere Fassungen (${event.idea.revisions.length - 1})`));
      for (const r of event.idea.revisions.slice(0, -1).reverse()) {
        const prior = node('section');
        prior.append(node('h4', `Fassung ${r.revision} · ${r.title}`), node('p', date(r.createdAt), 'muted'), node('p', r.text, 'idea-text'));
        history.append(prior);
      }
      item.append(history);
    }
    cards.append(item);
  }
  if (!ideas.length) cards.append(node('p', all.length ? 'Keine Ideen für diese Auswahl.' : 'Hier erscheinen deine gespeicherten Ideen. Beginne mit einem freien Gedanken.', 'muted'));
  ideaEvents.querySelector('.idea-answer-archive')?.remove();
  const answers = events.filter(event => !event.idea);
  if (answers.length) { const archive = node('details', undefined, 'idea-answer-archive'); archive.append(node('summary', `Gespeicherte Antworten (${answers.length})`)); for (const event of answers) archive.append(node('h3', event.title), node('p', eventSummary(event.ref, event.action))); ideaEvents.append(archive); }
  updateIdeaControls(); renderWB();
}
async function loadInbox() {
  try { const r = await fetch('/api/inbox', { cache: 'no-store', signal: AbortSignal.timeout(10000) }); if (r.status === 404) { inboxStatus.textContent = 'Empfangsabgleich hier nicht verfügbar. Gespeicherte Inhalte bleiben lesbar.'; return; }
    const data = await r.json(); if (!r.ok || !record(data) || !['pending', 'received'].every(key => Array.isArray(data[key]) && data[key].every(e => record(e) && validEventRef(e.eventRef) && record(e.content)))) throw new Error();
    inboxStatus.textContent = 'Empfangsabgleich geladen. Rootempfang wird nur anhand des gespeicherten Belegs angezeigt.';
  } catch { inboxStatus.textContent = 'Empfangsabgleich nicht prüfbar. Der zuletzt geprüfte Datenstand bleibt sichtbar.'; }
}
async function saveIdea() {
  if (ideaPosting || posting || loading) return;
  if (!rootReceiver) { $('idea-status').textContent = 'Nur in diesem Browser · noch nicht an den Orchestrator gesendet.'; return; }
  if (dataInvalid || state?.schemaVersion !== 2) { $('idea-status').textContent = 'Kein geprüfter V2-Datenstand. Aktualisieren und danach erneut prüfen; dein Entwurf bleibt erhalten.'; return; }
  if (ideaRecovery) { updateIdeaControls(); return; }
  const text = $('idea').value.trim();
  if (!ideaOperation.pending && !crypto.randomUUID) { $('idea-status').textContent = 'Dieser Browser unterstützt keine sicheren Anfrage-IDs. Bitte einen aktuellen Browser auf localhost verwenden; dein Entwurf bleibt erhalten.'; return; }
  if (!ideaOperation.pending && (!text || text.length > 8000)) { $('idea-status').textContent = 'Bitte einen nichtleeren Entwurf mit höchstens 8000 Zeichen eingeben.'; return; }
  const payload = ideaOperation.pending || { requestId: crypto.randomUUID(), ...(ideaOperation.id ? { id: ideaOperation.id } : {}), expectedRevision: ideaOperation.expectedRevision, title: text.split('\n')[0].slice(0, 200), text };
  if (!validIdeaPayload(payload)) { ideaOperation.pending = payload; ideaRecovery = true; updateIdeaControls(); return; }
  ideaOperation.pending = payload; persistIdeaOperation(); ideaPosting = true; updateIdeaControls(); $('idea-status').textContent = 'Idee wird gespeichert · noch kein Rootempfang.'; let conflict = false;
  try { const response = await fetch('/api/ideas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
    if (!response.ok) { conflict = response.status === 409; if (response.status < 500) { ideaOperation.pending = null; persistIdeaOperation(); }
      const failure = await response.json().catch(() => null); throw new Error(response.status === 404 ? 'Ideenspeicher noch nicht angebunden. Nur lokaler Entwurf.' : conflict ? 'Konflikt: Eine andere Fassung wurde gespeichert. Den erhaltenen Entwurf mit der aktuellen Idee verbinden.' : typeof failure?.error === 'string' ? failure.error : 'Idee konnte nicht bestätigt werden.'); }
    ideaPosting = false; const fresh = await load(); const idea = fresh && state.schemaVersion === 2 && state.ideas.find(i => (!payload.id || i.id === payload.id) && i.revisions.some(r => r.requestId === payload.requestId));
    const saved = idea && idea.revisions.find(r => r.requestId === payload.requestId && r.title === payload.title && r.text === payload.text && r.revision === (payload.expectedRevision ?? 0) + 1);
    if (!saved) throw new Error('Speicherbestätigung nicht prüfbar. Dieselbe Anfrage erneut prüfen; der Entwurf bleibt erhalten.');
    ideaOperation = { id: idea.id, expectedRevision: saved.revision, pending: null }; persistIdeaOperation();
    $('idea-status').textContent = saved.eventId === idea.revisions.at(-1).eventId ? 'Gespeichert · Rootempfang wird separat bestätigt. Keine Ausführungsfreigabe.' : 'Frühere Fassung gespeichert; inzwischen wurde die Idee aktualisiert. Deinen Entwurf vor einer neuen Speicherung prüfen.';
  } catch (error) { $('idea-status').textContent = `${transportError(error)} Dein Entwurf bleibt erhalten.`; }
  finally { ideaPosting = false; updateIdeaControls(); if (conflict) await load(); }
}
// Workbench content is descriptive; it grants no receipt, plan or execution authority.
const wbKey = 'decision-desk.workbench-drafts.v1';
let wbDrafts = {}, wbActive = null, wbBusy = false, wbCorrupt = false;
const wbRefValid = r => record(r) && ideaIdValid(r.ideaId) && ideaIdValid(r.eventId) && Number.isSafeInteger(r.ideaRevision) && r.ideaRevision > 0;
const wbRevisionValid = r => r === null || Number.isSafeInteger(r) && r > 0;
function wbValue(p) {
  if (!record(p) || !wbRefValid(p.ideaRef) || typeof p.actor !== 'string' || !p.actor.trim() || p.actor.length > 200 || !(p.source == null || typeof p.source === 'string' && p.source.trim() && p.source.length <= 2000)) return null;
  if (!Array.isArray(p.variants) || p.variants.length > 16 || !p.variants.every(v => record(v) && ['title', 'description'].every(k => typeof v[k] === 'string' && v[k].trim() && v[k].length <= (k === 'title' ? 200 : 2000)))) return null;
  if (!['openPoints', 'nextSteps'].every(k => Array.isArray(p[k]) && p[k].length <= 32 && p[k].every(t => typeof t === 'string' && t.trim() && t.length <= 2000))) return null;
  const value = { ideaRef: { ideaId: p.ideaRef.ideaId, ideaRevision: p.ideaRef.ideaRevision, eventId: p.ideaRef.eventId }, actor: p.actor.trim(), source: p.source?.trim() ?? null, variants: p.variants.map(v => ({ title: v.title.trim(), description: v.description.trim() })), openPoints: p.openPoints.map(t => t.trim()), nextSteps: p.nextSteps.map(t => t.trim()) };
  return value.variants.length + value.openPoints.length + value.nextSteps.length > 0 && JSON.stringify(value).length <= 20000 ? value : null;
}
function wbSaved(w) { return record(w) && ideaIdValid(w.id) && ideaIdValid(w.requestId) && Number.isSafeInteger(w.revision) && w.revision > 0 && typeof w.createdAt === 'string' && Number.isFinite(Date.parse(w.createdAt)) && wbValue(w); }
try { const stored = JSON.parse(localStorage.getItem(wbKey) || 'null'); if (stored !== null) {
  if (!record(stored) || !record(stored.drafts) || !(stored.active === null || ideaIdValid(stored.active))) throw new Error();
  for (const [id, d] of Object.entries(stored.drafts)) if (!ideaIdValid(id) || !record(d) || !wbRefValid(d.ideaRef) || d.ideaRef.ideaId !== id || !wbRevisionValid(d.expectedRevision) || !Array.isArray(d.variants) || d.variants.length > 16 || !d.variants.every(v => record(v) && ['title', 'description'].every(k => typeof v[k] === 'string')) || !['openPoints', 'nextSteps'].every(k => Array.isArray(d[k]) && d[k].every(t => typeof t === 'string')) || d.pending != null && (!wbValue(d.pending) || !ideaIdValid(d.pending.requestId) || !wbRevisionValid(d.pending.expectedRevision) || JSON.stringify(d.pending.ideaRef) !== JSON.stringify(d.ideaRef))) throw new Error();
  wbDrafts = stored.drafts; wbActive = stored.active;
} } catch { wbCorrupt = true; }
const wbForm = node('section', undefined, 'wb-editor'); wbForm.id = 'workbench-editor'; wbForm.hidden = true; $('thinking').append(wbForm);
const wbBinding = node('p', '', 'muted'); wbBinding.id = 'wb-binding';
const wbStatus = node('p', 'Nur lokaler Ausarbeitungsentwurf · kein Auftrag.', 'muted'); wbStatus.id = 'wb-status'; wbStatus.setAttribute('role', 'status');
const wbFields = node('div'), wbVariants = node('div');
const wbSave = button('Ausarbeitung speichern', saveWorkbench, 'primary'); wbSave.id = 'wb-save';
const wbRebind = button('Mit aktuellem Stand verbinden', () => { const i = state?.ideas?.find(i => i.id === wbActive), d = wbDrafts[wbActive]; if (!i || !d || d.pending || wbBusy || wbCorrupt) return; const r = i.revisions.at(-1); d.ideaRef = { ideaId: i.id, ideaRevision: r.revision, eventId: r.eventId }; d.expectedRevision = i.workbench?.at(-1)?.revision ?? null; persistWB(); updateWB(); wbStatus.textContent = 'Entwurf erhalten · ausdrücklich mit aktuellem Stand verbunden. Erst Speichern erstellt eine neue Ausarbeitung.'; }); wbRebind.id = 'wb-rebind';
const wbActions = node('div', undefined, 'actions'); wbActions.append(wbSave, wbRebind);
wbForm.append(node('h3', 'Deine Ausarbeitung'), wbBinding, wbFields, wbActions, wbStatus, node('p', 'Ausarbeitung ist kein fertiger Plan und keine Freigabe. Prüfung, Planung und Umsetzung benötigen eigene Belege.', 'muted'));
function persistWB() { try { localStorage.setItem(wbKey, JSON.stringify({ active: wbActive, drafts: wbDrafts })); return true; } catch { wbStatus.textContent = 'Browser-Speicher nicht verfügbar. Vor dem Schließen den Entwurf sichern; es wird nichts neu gesendet.'; return false; } }
function openWorkbench(i) {
  if (wbBusy || wbCorrupt) return;
  wbActive = i.id;
  if (!wbDrafts[i.id]) { const r = i.revisions.at(-1), last = i.workbench?.at(-1), value = wbSaved(last) || null; wbDrafts[i.id] = { ideaRef: value ? { ...value.ideaRef } : { ideaId: i.id, ideaRevision: r.revision, eventId: r.eventId }, expectedRevision: last?.revision ?? null, variants: value?.variants.map(v => ({ ...v })) ?? [{ title: '', description: '' }], openPoints: value?.openPoints.slice() ?? [], nextSteps: value?.nextSteps.slice() ?? [], pending: null }; }
  persistWB(); renderWB(); wbForm.querySelector('input,textarea')?.focus();
}
function renderWB() {
  wbForm.hidden = !wbActive && !wbCorrupt; if (wbForm.hidden) return;
  if (wbCorrupt) { wbStatus.textContent = 'Gespeicherter Ausarbeitungsentwurf nicht prüfbar. Text vor manueller Wiederherstellung sichern; Speichern gesperrt.'; wbSave.disabled = wbRebind.disabled = true; return; }
  const d = wbDrafts[wbActive]; if (!d) { wbForm.hidden = true; return; }
  if (wbForm.dataset.ideaId !== wbActive) {
    wbForm.dataset.ideaId = wbActive; wbFields.replaceChildren(wbVariants); renderWBVariants();
    const add = button('Variante ergänzen', () => { if (d.variants.length >= 16 || d.pending || wbBusy) return; d.variants.push({ title: '', description: '' }); persistWB(); renderWBVariants(); updateWB(); wbVariants.querySelector('fieldset:last-child input')?.focus(); }); add.id = 'wb-add'; wbFields.append(add);
    for (const [key, id, title] of [['openPoints', 'wb-open', 'Offene Punkte'], ['nextSteps', 'wb-next', 'Nächste Schritte']]) { const label = node('label', title); label.htmlFor = id; const input = node('textarea'); input.id = id; input.rows = 3; input.value = d[key].join('\n'); input.setAttribute('aria-describedby', 'wb-list-help'); input.addEventListener('input', () => { d[key] = input.value.split('\n').map(t => t.trim()).filter(Boolean); persistWB(); updateWB(); }); wbFields.append(label, input); }
    const help = node('p', 'Je Punkt eine Zeile · höchstens 32 Punkte mit je 2000 Zeichen.', 'muted'); help.id = 'wb-list-help'; wbFields.append(help);
  }
  updateWB();
}
function renderWBVariants() {
  const d = wbDrafts[wbActive]; wbVariants.replaceChildren();
  d.variants.forEach((v, n) => { const row = node('fieldset'); row.append(node('legend', `Variante ${n + 1}`));
    for (const [key, title, max] of [['title', 'Titel', 200], ['description', 'Beschreibung', 2000]]) { const id = `wb-variant-${key}-${n}`, label = node('label', title); label.htmlFor = id; const input = node(key === 'title' ? 'input' : 'textarea'); input.id = id; input.maxLength = max; input.value = v[key]; if (key === 'description') input.rows = 2; input.addEventListener('input', () => { v[key] = input.value; persistWB(); updateWB(); }); row.append(label, input); }
    wbVariants.append(row);
  });
}
function updateWB() {
  const d = wbDrafts[wbActive], i = state?.schemaVersion === 2 && state.ideas.find(i => i.id === wbActive); if (!d) return;
  const current = i?.revisions.at(-1), stale = !current || current.revision !== d.ideaRef.ideaRevision || current.eventId !== d.ideaRef.eventId, changed = (i?.workbench?.at(-1)?.revision ?? null) !== d.expectedRevision;
  wbBinding.textContent = `Ideenfassung ${d.ideaRef.ideaRevision} · Ausarbeitungsbasis ${d.expectedRevision ?? 'neu'}${stale ? ' · Ideenbindung veraltet' : ''}${changed ? ' · Ausarbeitungsstand verändert' : ''}`;
  wbSave.textContent = d.pending ? 'Ausarbeitung erneut prüfen' : 'Ausarbeitung speichern'; wbSave.disabled = wbBusy || loading || posting || ideaPosting || dataInvalid || !i || wbCorrupt || (!d.pending && (stale || changed));
  wbRebind.hidden = !stale && !changed; wbRebind.disabled = wbBusy || Boolean(d.pending) || !i || wbCorrupt;
  for (const input of wbFields.querySelectorAll('input,textarea,button')) input.disabled = wbBusy || Boolean(d.pending) || wbCorrupt || input.id === 'wb-add' && d.variants.length >= 16;
}
function appendWorkbench(item, idea) {
  if (idea.workbench === undefined) return;
  const history = node('details', undefined, 'wb-history'); history.append(node('summary', 'Gespeicherte Ausarbeitungen'));
  if (!Array.isArray(idea.workbench) || !idea.workbench.every(wbSaved)) { history.append(node('p', 'Ausarbeitung nicht prüfbar. Keine Freigabe ableitbar.')); item.append(history); return; }
  const current = idea.revisions.at(-1);
  for (const w of idea.workbench.slice().reverse()) { const value = wbValue(w), section = node('section'); section.append(node('h4', `Ausarbeitung ${w.revision} · Ideenfassung ${value.ideaRef.ideaRevision}`), node('p', w.ideaRef.eventId === current.eventId && w.ideaRef.ideaRevision === current.revision ? 'Ausarbeitung zur aktuellen Idee · keine Planfreigabe' : 'Ausarbeitung zu einer früheren Ideenfassung · keine aktuelle Planfreigabe', 'muted'));
    for (const v of value.variants) section.append(node('h4', v.title), node('p', v.description));
    for (const [key, title] of [['openPoints', 'Offene Punkte'], ['nextSteps', 'Nächste Schritte']]) { section.append(node('h4', title)); const list = node('ul'); value[key].forEach(t => list.append(node('li', t))); section.append(list); } history.append(section);
  }
  item.append(history);
}
async function saveWorkbench() {
  const d = wbDrafts[wbActive]; if (!d || wbBusy || loading || posting || ideaPosting || dataInvalid || wbCorrupt || state?.schemaVersion !== 2) return;
  if (!rootReceiver) { wbStatus.textContent = 'Nur in diesem Browser · noch nicht an den Orchestrator gesendet.'; return; }
  const value = wbValue({ ideaRef: d.ideaRef, actor: 'Browserentwurf', source: null, variants: d.variants.filter(v => v.title.trim() || v.description.trim()), openPoints: d.openPoints, nextSteps: d.nextSteps });
  if (!d.pending && (!value || !crypto.randomUUID || !wbRevisionValid(d.expectedRevision))) { wbStatus.textContent = 'Bitte mindestens einen vollständigen Inhalt eingeben: bis zu 16 Varianten (Titel 200, Beschreibung 2000 Zeichen), je 32 Punkte/Schritte, insgesamt höchstens 20000 Zeichen.'; return; }
  const payload = d.pending || { requestId: crypto.randomUUID(), expectedRevision: d.expectedRevision, ...value }; d.pending = payload; if (!persistWB()) { updateWB(); return; }
  wbBusy = true; updateWB(); wbStatus.textContent = 'Ausarbeitung wird gespeichert · keine Planfreigabe.';
  try {
    const response = await fetch('/api/workbench', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
    if (!response.ok) { if (response.status < 500) { d.pending = null; persistWB(); } const error = await response.json().catch(() => null); if (response.status === 409) await load(); throw new Error(response.status === 404 ? 'Ausarbeitungsspeicher ist hier noch nicht angebunden.' : response.status === 409 ? 'Konflikt: Entwurf mit aktuellem Stand ausdrücklich verbinden.' : typeof error?.error === 'string' ? error.error : 'Speicherung nicht bestätigt.'); }
    if (!await load()) throw new Error('Speicherbestätigung nicht prüfbar. Dieselbe Anfrage erneut prüfen.');
    const idea = state.ideas.find(i => i.id === payload.ideaRef.ideaId), saved = idea?.workbench?.find(w => wbSaved(w) && w.requestId === payload.requestId && w.revision === (payload.expectedRevision ?? 0) + 1 && JSON.stringify(wbValue(w)) === JSON.stringify(wbValue(payload)));
    if (!saved) throw new Error('Exakte Speicherbestätigung fehlt. Dieselbe Anfrage erneut prüfen.');
    d.pending = null; d.expectedRevision = saved.revision; persistWB(); const current = idea.revisions.at(-1);
    wbStatus.textContent = current.eventId === saved.ideaRef.eventId && current.revision === saved.ideaRef.ideaRevision ? 'Ausarbeitung gespeichert · keine Planfreigabe.' : 'Ausarbeitung gespeichert für eine frühere Ideenfassung · keine aktuelle Planfreigabe.';
  } catch (error) { wbStatus.textContent = `${transportError(error)} Dein Entwurf bleibt erhalten.`; }
  finally { wbBusy = false; updateWB(); }
}

load(); setInterval(load, 15000);
