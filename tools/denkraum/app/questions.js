'use strict';
const $ = id => document.getElementById(id);
const labels = { open: 'Offen', answered: 'Beantwortet', deferred: 'Zurückgestellt', clarify: 'Rückfrage offen', received: 'Gelesen', applied: 'Umgesetzt', historical: 'Historisch' };
const actions = { answer: 'Antwort', defer: 'Zurückgestellt · keine Zustimmung', clarify: 'Rückfrage · keine Zustimmung' };
let state = null, activeId = null, view = null, loading = false, posting = false;
let area = 'now', dataInvalid = false, ideaPosting = false;
const transportError = error => error instanceof TypeError || ['TimeoutError', 'AbortError'].includes(error.name) ? 'Die Verbindung ist gerade nicht erreichbar.' : error.message;
const storageKey = 'decision-desk.drafts.v1';
const rootReceiver = document.querySelector('meta[name="decision-desk-root-agent-id"]')?.content || null;
let drafts = {}, storageAvailable = true;
try { drafts = JSON.parse(localStorage.getItem(storageKey) || '{}'); if (!drafts || typeof drafts !== 'object' || Array.isArray(drafts)) drafts = {}; } catch { storageAvailable = false; }
let persistedDrafts = JSON.stringify(drafts);
function persist() { try {
  const baseline = JSON.parse(persistedDrafts), remote = JSON.parse(localStorage.getItem(storageKey) || '{}');
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) throw new Error('Invalid draft storage');
  for (const k of new Set([...Object.keys(baseline), ...Object.keys(drafts)])) {
    if (JSON.stringify(baseline[k]) === JSON.stringify(drafts[k])) continue;
    if (JSON.stringify(remote[k]) !== JSON.stringify(baseline[k]) && remote[k]) { remote[`${k}:parallel-${crypto.randomUUID()}`] = remote[k]; if (view) showChanged('Ein paralleler Entwurf wurde erkannt und separat erhalten. Prüfe die aktuelle Fassung und die erhaltenen Entwürfe.'); }
    if (drafts[k]) remote[k] = drafts[k]; else delete remote[k];
  }
  localStorage.setItem(storageKey, JSON.stringify(remote)); persistedDrafts = JSON.stringify(drafts);
} catch { storageAvailable = false; $('global-error').hidden = false; $('global-error').textContent = 'Entwürfe können nicht im Browser gespeichert werden. Bitte diese Seite bis zum Speichern geöffnet lassen.'; } }
function node(tag, content, cls) { const n = document.createElement(tag); if (content !== undefined) n.textContent = content; if (cls) n.className = cls; return n; }
function button(text, fn, cls) { const b = node('button', text, cls); b.type = 'button'; b.addEventListener('click', fn); return b; }
function latest(id) { return state?.answers.findLast(a => a.questionId === id); }
function sourceCurrent(q) {
  if (!q.sourceRef) return true;
  const ref = q.sourceRef, revision = state?.schemaVersion === 2 && state.ideas.find(i => i.id === ref.ideaId)?.revisions.at(-1);
  return ref.kind === 'idea' && Boolean(revision) && revision.eventId === ref.eventId && revision.revision === ref.ideaRevision;
}
function answerCurrent(a) { return state.questions.some(q => q.id === a.questionId && q.revision === a.questionRevision && sourceCurrent(q)) && (!a.question || sourceCurrent(a.question)); }
function status(q) { if (!sourceCurrent(q)) return 'historical'; const a = latest(q.id); if (!a || a.questionRevision !== q.revision) return 'open'; return a.ack?.status === 'applied' ? 'applied' : a.ack?.status === 'received' ? 'received' : a.action === 'defer' ? 'deferred' : a.action === 'clarify' ? 'clarify' : 'answered'; }
function signature(q) { return JSON.stringify([q, state.answers.filter(a => a.questionId === q.id), sourceCurrent(q)]); }
function key(q) { return `${q.id}:${q.revision}`; }
function date(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Zeitpunkt unbekannt' : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }); }
function facts(items) { const dl = node('dl', undefined, 'facts'); for (const [label, value] of items) { const row = node('div'); row.append(node('dt', label), node('dd', value)); dl.append(row); } return dl; }
function badge(text, cls) { return node('span', text, `badge ${cls || ''}`); }
function detailedRecommendation(q) {
  if (!q.recommendationDetail) return null;
  const r = q.recommendationDetail, o = r.observation, rec = node('section', undefined, 'recommendation'); rec.setAttribute('aria-label', 'Empfehlung');
  if (!record(r) || !record(o) || !strings(o.evidenceRefs) || !strings(r.authorityRefs) || !['statement'].every(k => typeof o[k] === 'string') || !['hypothesis', 'consequences', 'reversibility'].every(k => typeof r[k] === 'string')) { rec.append(node('p', 'Empfehlungsdetails nicht prüfbar.')); return rec; }
  const observed = o.evidenceRefs.some(ref => ref.trim()) && typeof o.observedAt === 'string' && Number.isFinite(Date.parse(o.observedAt));
  rec.append(node('strong', sourceCurrent(q) && state.questions.some(current => current.id === q.id && current.revision === q.revision) ? 'Empfehlung' : 'Historische Empfehlung'), node('p', `Hypothese: ${r.hypothesis}`));
  const proof = node('details'); proof.append(node('summary', 'Begründung, Folgen und Belege'), node('p', `${observed ? 'Grundlage' : 'Ungeprüfte Grundlage'}: ${o.statement}`), node('p', `Mögliche Folgen: ${r.consequences}`), facts([
    ['Belege', o.evidenceRefs.join(', ') || 'Keine Belege hinterlegt'], ['Beobachtungszeit', typeof o.observedAt === 'string' && Number.isFinite(Date.parse(o.observedAt)) ? date(o.observedAt) : 'Zeitpunkt unbekannt'], ['Umkehrbarkeit', r.reversibility],
    ['Vorgesehenes Planfenster', typeof r.patchWindowText === 'string' && r.patchWindowText.trim() ? r.patchWindowText : 'Nicht geplant'],
    ['Referenzen · keine Empfangsbestätigung', r.authorityRefs.join(', ') || 'Keine Referenzen hinterlegt']
  ])); rec.append(proof); return rec;
}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
const priorityLevels = ['high', 'medium', 'low', 'unclassified'];
const priorityNames = { high: 'hoch', medium: 'mittel', low: 'niedrig', unclassified: 'nicht eingeordnet' };
const priorityId = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v);
const priorityIso = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const prioritySourceCurrent = (data, q) => !q.sourceRef || data.ideas?.some(i => i.id === q.sourceRef.ideaId && i.revisions.at(-1).eventId === q.sourceRef.eventId && i.revisions.at(-1).revision === q.sourceRef.ideaRevision);
function priorityRefCurrent(data, ref) {
  if (!validEventRef(ref) || !priorityId(ref.eventId) || !priorityId(ref.kind === 'idea' ? ref.ideaId : ref.questionId)) return false;
  if (ref.kind === 'idea') return prioritySourceCurrent(data, { sourceRef: ref }) === true;
  const a = data.answers.find(a => a.id === ref.eventId);
  return Boolean(a && data.answers.findLast(answer => answer.questionId === a.questionId)?.id === a.id && data.questions.some(q => q.id === a.questionId && q.revision === a.questionRevision && prioritySourceCurrent(data, q)) && sameEvent(answerRef(a), ref));
}
function projectQuestionPriority(data, q) {
  const detail = q.priorityDetail, current = data.questions.some(stored => stored.id === q.id && stored.revision === q.revision) && prioritySourceCurrent(data, q) === true;
  const supported = current && !!detail?.reason?.trim() && detail.sourceRefs.length > 0 && detail.sourceRefs.every(ref => priorityRefCurrent(data, ref)) && (!q.sourceRef || detail.sourceRefs.some(ref => sameEvent(ref, q.sourceRef)));
  const observed = evidenceRef => {
    const observation = q.recommendationDetail?.observation;
    if (q.sourceRef && priorityIso(observation?.observedAt) && observation.evidenceRefs.includes(evidenceRef)) return true;
    return data.progress?.some(p => detail.sourceRefs.some(ref => ref.eventId === p.eventId) && p.history.some(h => {
      const e = h.implementationEvidence; return record(e) && priorityId(e.id) && priorityId(e.eventId) && priorityIso(e.observedAt) && ['artifactRef', 'check', 'observedResult', 'actor'].every(k => typeof e[k] === 'string' && e[k].trim() && e[k].length <= 5000) && e.eventId === p.eventId && e.id === evidenceRef;
    })) === true;
  };
  return { questionId: q.id, questionRevision: q.revision, current, classificationSupported: !!supported,
    actualBlocker: !!supported && detail.blockingDependencies.length > 0 && detail.blockerEvidenceRefs.length > 0 && detail.blockerEvidenceRefs.every(observed),
    criticality: supported && detail.criticality ? detail.criticality : 'unclassified', impact: supported && detail.impact ? detail.impact : 'unclassified',
    reason: detail?.reason ?? '', blockingDependencies: detail?.blockingDependencies ?? [], blockerEvidenceRefs: detail?.blockerEvidenceRefs ?? [] };
}
function compareQuestions(data, a, b) {
  const x = projectQuestionPriority(data, a), y = projectQuestionPriority(data, b), created = q => priorityIso(q.createdAt) ? Date.parse(q.createdAt) : Infinity;
  return Number(y.actualBlocker) - Number(x.actualBlocker) || priorityLevels.indexOf(x.criticality) - priorityLevels.indexOf(y.criticality) || priorityLevels.indexOf(x.impact) - priorityLevels.indexOf(y.impact)
    || (created(a) < created(b) ? -1 : created(a) > created(b) ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function prioritySummary(q) { const p = projectQuestionPriority(state, q); return `${p.actualBlocker ? 'Belegte Abhängigkeit · ' : ''}Kritikalität: ${priorityNames[p.criticality]} · Wirkung: ${priorityNames[p.impact]}`; }
function validQuestion(q) {
  if (record(q) && q.mode === 'free') return typeof q.id === 'string' && typeof q.title === 'string' && Number.isInteger(q.revision)
    && Array.isArray(q.options) && q.options.length === 0 && q.recommendation === null
    && record(q.sourceRef) && q.sourceRef.kind === 'idea' && typeof q.sourceRef.eventId === 'string' && typeof q.sourceRef.ideaId === 'string'
    && Number.isSafeInteger(q.sourceRef.ideaRevision) && q.sourceRef.ideaRevision > 0
    && record(q.contentOrigin) && typeof q.contentOrigin.actor === 'string' && typeof q.contentOrigin.sourceRefText === 'string';
  return record(q) && typeof q.id === 'string' && typeof q.title === 'string' && Number.isInteger(q.revision) && ['single', 'multiple'].includes(q.mode)
    && Array.isArray(q.options) && q.options.length > 0 && q.options.every(o => record(o) && typeof o.id === 'string' && typeof o.label === 'string' && (!o.preview || record(o.preview)))
    && record(q.recommendation) && strings(q.recommendation.optionIds) && q.recommendation.optionIds.every(id => q.options.some(o => o.id === id));
}
function validAnswer(a) {
  const validAck = ack => record(ack) && ['received', 'applied'].includes(ack.status);
  return record(a) && typeof a.id === 'string' && typeof a.questionId === 'string' && Number.isInteger(a.questionRevision) && Object.hasOwn(actions, a.action) && strings(a.selected)
    && (a.question == null || validQuestion(a.question)) && (a.ack == null || validAck(a.ack)) && (a.acknowledgements == null || (Array.isArray(a.acknowledgements) && a.acknowledgements.every(validAck)));
}
function renderList() {
  const filter = $('filter').value, term = $('search').value.toLocaleLowerCase('de');
  const questions = state.questions.filter(q => (filter === 'all' || status(q) === filter) && [q.title, q.category, q.owner, q.id].join(' ').toLocaleLowerCase('de').includes(term)).sort((a, b) => compareQuestions(state, a, b));
  $('count').textContent = `${questions.length} ${questions.length === 1 ? 'Frage' : 'Fragen'} · ${state.questions.filter(q => status(q) === 'open').length} offen insgesamt`;
  const filterSummary = document.querySelector('.question-tools > summary');
  if (filterSummary) filterSummary.textContent = `Fragen suchen und filtern · ${$('filter').selectedOptions[0]?.textContent || filter}${term ? ' · Suche aktiv' : ''}`;
  $('questions').replaceChildren();
  for (const q of questions) { const b = button('', () => openQuestion(q.id)); b.className = 'question-link'; b.setAttribute('aria-current', String(q.id === activeId)); b.append(node('strong', q.title), node('small', `${labels[status(q)]} · ${q.category} · ${prioritySummary(q)}`)); $('questions').append(b); }
  if (!questions.length) $('questions').append(node('p', state.questions.length ? 'Keine Fragen für diesen Filter.' : 'Noch keine Fragen. Neue Fragen erscheinen hier automatisch.', 'muted'));
}
function showChanged(message) {
  if (!view) return; view.stale = true; view.notice.hidden = false; view.notice.replaceChildren(node('span', message), button('Aktuelle Fassung prüfen', () => openQuestion(activeId)));
  view.confirm.hidden = true; view.updateButtons();
}
async function load() {
  if (loading || posting || ideaPosting) return; loading = true; $('refresh').disabled = true;
  try {
    const response = await fetch('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(10000) }); const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Laden fehlgeschlagen (${response.status}).`);
    if (!record(data) || ![1, 2].includes(data.schemaVersion) || !Number.isInteger(data.revision) || !Array.isArray(data.questions) || !Array.isArray(data.answers) || !data.questions.every(validQuestion) || !data.answers.every(validAnswer) || !validIdeaState(data)) {
      dataInvalid = true; showChanged('Unvollständige Daten. Dein Entwurf bleibt erhalten; erst den aktuellen Datenstand prüfen.');
      throw new Error('Unbekanntes oder unvollständiges Datenformat. Bitte den Orchestrator informieren.');
    }
    dataInvalid = false;
    state = data; renderList(); $('connection').textContent = `Aktualisiert ${date(new Date())} · automatische Prüfung alle 15 Sekunden`;
    $('global-error').hidden = storageAvailable; if (!storageAvailable) $('global-error').textContent = 'Lokaler Entwurfsspeicher nicht verfügbar. Eingaben bleiben nur in dieser geöffneten Seite.';
    if (view) { const q = state.questions.find(q => q.id === activeId); if (!q || signature(q) !== view.signature) showChanged('Diese Frage oder ihre Historie wurde aktualisiert. Dein Entwurf bleibt erhalten. Prüfe die aktuelle Fassung vor dem Senden.'); }
    else { const next = state.questions.filter(q => status(q) === 'open').sort((a, b) => compareQuestions(state, a, b))[0]; if (next) openQuestion(next.id, false); }
    renderPlanned(); renderIdeaState();
    for (const label of document.querySelectorAll('.event-status')) { const a = state.answers.find(a => a.id === label.dataset.eventId); if (a) label.textContent = eventSummary(answerRef(a), a.action); }
    await loadInbox(); return true;
  } catch (error) { $('global-error').hidden = false; $('global-error').textContent = `${transportError(error)} Erneut mit „Aktualisieren“ versuchen. Deine Eingaben bleiben erhalten.`; $('connection').textContent = state ? 'Verbindung unterbrochen · zuletzt geladene Daten' : 'Fragen konnten nicht geladen werden.'; }
  finally { loading = false; $('refresh').disabled = false; updateIdeaControls(); updateWB(); }
}
function openQuestion(id, focus = true) {
  if (posting || dataInvalid) return;
  const q = state.questions.find(q => q.id === id); if (!q) return;
  activeId = id; const draftKey = key(q), previous = latest(id);
  const d = drafts[draftKey] ||= { selected: [], note: '', baseAnswerId: previous?.id ?? null };
  if (!Array.isArray(d.selected) || typeof d.note !== 'string') { drafts[draftKey] = { selected: [], note: '', baseAnswerId: previous?.id ?? null }; return openQuestion(id, focus); }
  const panel = $('detail'); panel.replaceChildren();
  const priority = projectQuestionPriority(state, q), tags = node('div'); tags.append(badge(labels[status(q)], status(q)), badge(`Fassung ${q.revision}`)); if (priority.actualBlocker) tags.append(badge('Belegte Abhängigkeit', 'blocking'));
  panel.append(tags, node('h2', q.title));
  const background = node('details'); background.id = 'question-background'; background.append(node('summary', 'Kontext, Einordnung und Herkunft'), node('p', q.context, 'context'), facts([['Verantwortlich', q.owner], ['Thema', q.category], ['Geltungsbereich', q.scope], ['Quelle', q.source], ['Unsicherheit', q.uncertainty]]));
  if (q.sourceRef) background.append(facts([['Ideen-ID', q.sourceRef.ideaId], ['Ideenfassung', String(q.sourceRef.ideaRevision)], ['Ereignis-ID', q.sourceRef.eventId]]));
  if (q.contentOrigin) background.append(facts([['Inhaltsherkunft', q.contentOrigin.actor], ['Herkunftsreferenz', q.contentOrigin.sourceRefText]]));
  background.append(facts([['Kritikalität', priorityNames[priority.criticality]], ['Wirkung', priorityNames[priority.impact]], ['Begründung', priority.reason || 'Keine Begründung hinterlegt'],
    ['Abhängige Arbeit', priority.actualBlocker ? priority.blockingDependencies.join(', ') : 'Keine belegte aktuelle Blockade'], ['Beobachtungsbelege', priority.actualBlocker ? priority.blockerEvidenceRefs.join(', ') : 'Nicht belegt']]));
  if (q.priority === 'blocking') background.append(node('p', 'Früheres Blockerlabel · ungeprüft. Dieses Label allein blockiert keine Arbeit.', 'muted'));
  background.append(node('p', 'Gespeicherte Beobachtungsbelege sind keine unabhängige Wahrheitsprüfung. Herkunft und Referenzen bestätigen keinen Rootempfang. Andere freigegebene Arbeit bleibt frei.', 'muted'));
  if (priority.actualBlocker) panel.append(node('p', `Beobachtete Abhängigkeit: ${priority.blockingDependencies.join(', ')}. ${priority.reason}`, 'dependency-note'));
  if (previous?.questionRevision === q.revision) panel.append(node('p', `Letzte Aktion: ${actions[previous.action]}. ${previous.ack ? `${labels[status(q)]} durch ${previous.ack.actor}: ${previous.ack.note}` : 'Noch keine Empfangsbestätigung.'}`, 'muted'));
  if (previous && previous.questionRevision !== q.revision) panel.append(node('p', `Neu offen: Die letzte Antwort bezog sich auf Fassung ${previous.questionRevision}.`, 'notice'));
  const free = q.mode === 'free';
  const recommendation = detailedRecommendation(q); if (recommendation) panel.append(recommendation);
  if (!free) { const rec = node('section', undefined, 'recommendation'); rec.setAttribute('aria-label', 'Empfehlung'); const why = node('details'); why.append(node('summary', 'Warum diese Empfehlung?'), node('p', q.recommendation.rationale)); rec.append(node('strong', `Empfehlung: ${q.options.filter(o => q.recommendation.optionIds.includes(o.id)).map(o => o.label).join(' + ')}`), why); panel.append(rec); }
  const oldDrafts = Object.entries(drafts).filter(([k]) => k.startsWith(`${q.id}:`) && k !== draftKey);
  if (oldDrafts.length) { const old = node('details'); old.append(node('summary', 'Entwürfe früherer Fassungen')); for (const [k, value] of oldDrafts) old.append(node('p', `${k} · Auswahl: ${(value.selected || []).join(', ') || 'keine'}\n${value.note || ''}`)); panel.append(old); }
  const notice = node('div', undefined, 'notice'); notice.hidden = true; notice.setAttribute('role', 'status'); panel.append(notice);
  const form = node('form'), fields = node('fieldset'); fields.append(node('legend', free ? 'Deine Antwort' : 'Deine Auswahl'), node('p', free ? 'Antworten starten keine Ausführung.' : q.mode === 'multiple' ? 'Mehrere Optionen möglich. „Nur allein“ lässt sich nicht kombinieren. Antworten starten keine Ausführung.' : 'Wähle genau eine Option. Antworten starten keine Ausführung.', 'muted'));
  const inputs = [];
  for (const o of q.options) {
    const row = node('div', undefined, 'option'), label = node('label', undefined, 'option-label'), input = node('input'); input.type = q.mode === 'multiple' ? 'checkbox' : 'radio'; input.name = 'selection'; input.value = o.id; input.checked = d.selected.includes(o.id); input.id = `option-${q.id}-${o.id}`;
    label.append(input, node('span', o.label)); row.append(label); if (q.recommendation.optionIds.includes(o.id)) row.append(badge('Empfohlen')); if (o.exclusive) row.append(badge('Nur allein'));
    const more = node('details'); more.append(node('summary', 'Begründung und Folgen'), node('p', o.rationale), facts([['Auswirkungen', o.impact], ['Abwägung', o.tradeoff], ['Aufwand', o.effort], ['Umkehrbarkeit', o.reversible]])); row.append(more);
    if (o.preview) { const preview = node('details', undefined, 'preview'); preview.append(node('summary', 'Vorschau ansehen'), node('p', o.preview.text)); if (typeof o.preview.image === 'string' && /^\/previews\/[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(o.preview.image)) { const img = node('img'); img.src = o.preview.image; img.alt = o.preview.text; img.loading = 'lazy'; img.addEventListener('error', () => { img.hidden = true; preview.append(node('p', 'Vorschaubild nicht verfügbar.', 'muted')); }, { once: true }); preview.append(img); } row.append(preview); }
    inputs.push(input); input.addEventListener('change', () => { d.selected = inputs.filter(i => i.checked).map(i => i.value); changed(); }); fields.append(row);
  }
  const noteLabel = node('label', free ? 'Antwort oder Rückfrage' : 'Notiz oder Rückfrage', 'note-label'); noteLabel.htmlFor = 'note'; const note = node('textarea'); note.id = 'note'; note.maxLength = 8000; note.value = d.note; note.setAttribute('aria-describedby', 'draft-status');
  note.addEventListener('input', () => { d.note = note.value; changed(); }); fields.append(noteLabel, note);
  const draftStatus = node('p', 'Entwurf lokal · nicht gesendet', 'muted'); draftStatus.id = 'draft-status'; fields.append(draftStatus);
  const bar = node('div', undefined, 'actions'), choose = button(free ? 'Antwort prüfen' : 'Auswahl prüfen', () => prepare('answer'), 'primary'), defer = button('Später entscheiden', () => prepare('defer')), clarify = button('Rückfrage stellen', () => prepare('clarify')); bar.append(choose, defer, clarify); fields.append(bar); form.append(fields);
  const feedback = node('p', '', 'feedback'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite'); const confirm = node('section', undefined, 'notice'); confirm.hidden = true;
  form.addEventListener('submit', event => { event.preventDefault(); }); form.append(confirm, feedback); panel.append(form, background);
  view = { q, signature: signature(q), stale: !sourceCurrent(q), sourceHistorical: !sourceCurrent(q), notice, confirm, fields, feedback, draft: d, draftKey, baseAnswerId: previous?.id ?? null, updateButtons };
  if (!sourceCurrent(q)) { notice.hidden = false; notice.append(node('p', 'Historisch: Diese Frage gehört zu einer überholten oder fehlenden Ideenfassung. Entwurf und Historie bleiben erhalten; eine neue Antwort benötigt eine aktuelle Rückfrage.')); }
  function updateButtons() { fields.disabled = posting || Boolean(d.pending) || view.sourceHistorical; choose.disabled = view.stale || (free ? !d.note.trim() : !d.selected.length); defer.disabled = view.stale; clarify.disabled = view.stale || !d.note.trim(); }
  function changed() { delete d.pending; confirm.hidden = true; feedback.textContent = ''; d.baseAnswerId = view.baseAnswerId; persist(); draftStatus.textContent = storageAvailable ? 'Entwurf lokal · nicht gesendet' : 'Entwurf nur in dieser Seite · Browser-Speicher nicht verfügbar'; updateButtons(); }
  function prepare(action) {
    if (view.stale) return;
    if (action === 'answer' && free && !d.note.trim()) { feedback.textContent = 'Bitte trage deine Antwort ein.'; note.focus(); return; }
    if (action === 'answer' && !free && (!d.selected.length || (d.selected.length > 1 && q.options.some(o => o.exclusive && d.selected.includes(o.id))))) { feedback.textContent = 'Bitte eine gültige Auswahl treffen. „Nur allein“ lässt sich nicht kombinieren.'; return; }
    if (action === 'clarify' && !d.note.trim()) { feedback.textContent = 'Bitte trage deine Rückfrage in das Notizfeld ein.'; note.focus(); return; }
    const summary = action === 'answer' ? free ? 'Du speicherst deine Antwort. Daraus entsteht kein Ausführungsauftrag.' : `Du bestätigst: ${q.options.filter(o => d.selected.includes(o.id)).map(o => o.label).join(' + ')}` : action === 'defer' ? 'Du stellst diese Frage zurück. Das ist keine Zustimmung.' : 'Du sendest eine Rückfrage. Das ist keine Zustimmung.';
    confirm.replaceChildren(node('strong', summary)); if (d.note.trim()) confirm.append(node('p', d.note));
    const send = button(action === 'answer' ? free ? 'Antwort speichern' : 'Auswahl verbindlich speichern' : action === 'defer' ? 'Zurückstellung speichern' : 'Rückfrage senden', () => submit(action), 'primary'); confirm.append(send, button('Zurück zum Entwurf', () => { confirm.hidden = true; choose.focus(); })); confirm.hidden = false; send.focus();
  }
  function offerRetry() { confirm.hidden = false; confirm.replaceChildren(node('p', 'Der Ausgang der letzten Übertragung ist unklar. Wiederholen sendet exakt dieselbe Anfrage und erzeugt keine doppelte Antwort.'), button('Speicherung erneut prüfen', () => submit(d.pending.action), 'primary')); }
  async function submit(action) {
    if (posting || ideaPosting || (view.stale && !d.pending)) return;
    if (!rootReceiver) { feedback.textContent = 'Nur in diesem Browser · noch nicht an den Orchestrator gesendet.'; return; }
    if (loading) { feedback.textContent = 'Der aktuelle Stand wird gerade geladen. Bitte danach erneut bestätigen.'; return; }
    if (!crypto.randomUUID) { feedback.textContent = 'Dieser Browser unterstützt keine sicheren Anfrage-IDs. Bitte einen aktuellen Browser auf localhost verwenden.'; return; }
    const retry = Boolean(d.pending), payload = d.pending || { questionId: q.id, questionRevision: q.revision, expectedAnswerId: view.baseAnswerId, requestId: crypto.randomUUID(), action, selected: action === 'answer' && !free ? [...d.selected] : [], note: d.note };
    d.pending = payload; persist(); if (view.stale && !retry) { delete d.pending; persist(); return; } posting = true; updateButtons(); confirm.hidden = true; feedback.textContent = 'Wird gespeichert …'; $('refresh').disabled = true;
    let success = false, conflict = false; $('save-status').textContent = 'Antwort wird gespeichert …';
    try { const r = await fetch('/api/answers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
      if (!r.ok) { conflict = [400, 404, 409].includes(r.status); delete d.pending; persist(); const failure = await r.json().catch(() => null); throw new Error(typeof failure?.error === 'string' ? failure.error : conflict ? 'Antwort konnte nicht gespeichert werden. Bitte den aktuellen Stand prüfen.' : `Speichern fehlgeschlagen (${r.status}).`); }
      const result = await r.json().catch(() => null);
      if (!validAnswer(result) || !result.id || result.questionId !== q.id || result.requestId !== payload.requestId) throw new Error('Speicherbestätigung konnte nicht geprüft werden.');
      const existing = state.answers.findIndex(a => a.id === result.id); if (existing < 0) state.answers.push(result); else state.answers[existing] = result;
      if (answerCurrent(result)) delete drafts[draftKey]; else delete d.pending; persist(); success = true;
    } catch (error) { feedback.textContent = `${transportError(error)} Dein Entwurf bleibt erhalten.`; $('save-status').textContent = feedback.textContent; if (d.pending) offerRetry(); }
    finally { posting = false; $('refresh').disabled = false; updateButtons(); }
    if (success) { view = null; await load(); openQuestion(q.id, false); const historical = !sourceCurrent(q) || state.questions.find(current => current.id === q.id)?.revision !== q.revision; const message = historical ? 'Historische Antwort bereits gespeichert. Der Beleg gilt für die frühere Fassung und ist keine aktuelle Zustimmung.' : `${actions[action]} gespeichert. Die Bestätigung des Orchestrators erscheint separat.`; $('save-status').textContent = message;
      if (view?.q.id === q.id) { view.feedback.textContent = message; if (area === 'now') { view.feedback.tabIndex = -1; view.feedback.focus(); } }
    }
    else if (conflict) { showChanged('Speichern abgelehnt: Bitte die aktuelle Frage und Quelle prüfen. Dein Entwurf bleibt erhalten.'); await load(); }
  }
  panel.append(history(q));
  if (sourceCurrent(q) && d.baseAnswerId !== view.baseAnswerId && !d.pending) { notice.hidden = false; notice.append(node('p', 'Seit diesem Entwurf wurde eine andere Antwort gespeichert. Prüfe die Historie und bestätige, dass du auf dieser Grundlage weiterarbeiten möchtest.'), button('Historie geprüft · Entwurf weiterbearbeiten', () => { d.baseAnswerId = view.baseAnswerId; persist(); view.stale = false; notice.hidden = true; updateButtons(); })); view.stale = true; }
  if (d.pending) offerRetry(); updateButtons(); renderList(); if (focus) panel.focus();
}
function history(q) {
  const entries = state.answers.filter(a => a.questionId === q.id).reverse(), details = node('details', undefined, 'history'); details.append(node('summary', `Historie (${entries.length})`));
  if (!entries.length) details.append(node('p', 'Noch keine Antwort gespeichert.'));
  for (const a of entries) { const item = node('article'); item.append(node('h3', `${answerCurrent(a) ? '' : 'Historisch · '}${actions[a.action] || a.action} · Fassung ${a.questionRevision}`), node('time', date(a.savedAt))); item.append(node('p', a.question?.title || q.title)); if (a.selected.length) item.append(node('p', `Auswahl: ${a.selected.map(id => a.question?.options.find(o => o.id === id)?.label || id).join(' + ')}`)); if (a.note) item.append(node('p', a.note));
    if (state.schemaVersion === 2) { const label = node('p', eventSummary(answerRef(a), a.action), 'event-status'); label.dataset.eventId = a.id; item.append(label); }
    const snapshot = node('details'); snapshot.append(node('summary', 'Frage zum Antwortzeitpunkt')); if (a.question) { snapshot.append(node('p', a.question.context), facts([['Geltungsbereich', a.question.scope], ['Quelle', a.question.source], ['Unsicherheit', a.question.uncertainty]])); for (const o of a.question.options) snapshot.append(node('h3', o.label), node('p', o.rationale), facts([['Auswirkungen', o.impact], ['Abwägung', o.tradeoff], ['Aufwand', o.effort], ['Umkehrbarkeit', o.reversible]])); } item.append(snapshot);
    if (a.question) { const rec = detailedRecommendation(a.question); if (rec) snapshot.append(rec); }
    if (a.ack) item.append(node('p', `${a.ack.status === 'applied' ? 'Umgesetzt' : 'Gelesen'} · ${a.ack.actor} · ${date(a.ack.at)}\n${a.ack.note}`)); else item.append(node('p', 'Noch keine Empfangsbestätigung.', 'muted'));
    for (const ack of (a.acknowledgements || []).slice(0, -1)) item.append(node('p', `${ack.status === 'applied' ? 'Umgesetzt' : 'Gelesen'} · ${ack.actor} · ${date(ack.at)}\n${ack.note}`, 'muted'));
    details.append(item);
  } return details;
}
$('refresh').addEventListener('click', load); $('filter').addEventListener('change', () => { if (state) renderList(); }); $('search').addEventListener('input', () => { if (state) renderList(); });
function renderPlanned() {
  const panel = $('planned'); panel.replaceChildren(node('h2', 'Was als Nächstes ansteht')); panel.firstChild.id = 'planned-title';
  const planned = activeEvents().map(event => ({ ...event, patch: patchFor(event.ref) })).filter(event => event.patch && strongReceipt(event.ref) && state.progress?.some(p => p.eventId === event.ref.eventId && p.currentStatus === 'planned') && !['defer', 'clarify'].includes(event.action));
  if (!planned.length) panel.append(node('p', 'Kein Patchfenster hinterlegt. Ein Termin wird erst angezeigt, wenn er tatsächlich geplant ist.'));
  for (const event of planned) panel.append(node('h3', event.title), node('p', `${event.patch.label} · ${event.patch.windowText.trim() || 'Zeitfenster noch nicht festgelegt'}`), node('p', event.patch.reason), node('p', `Freigabebelege: ${event.patch.authorityEvidenceRefs.join(', ')}`, 'muted'));
  if (!state) return;
  const applied = state.questions.filter(q => status(q) === 'applied');
  if (applied.length) { const archive = node('details'); archive.append(node('summary', 'Bisher als umgesetzt bestätigt')); for (const q of applied) { const a = latest(q.id); archive.append(node('h3', q.title), node('p', `${a.ack.actor} · ${date(a.ack.at)} · ${a.ack.note}`)); } panel.append(archive); }
  panel.append(node('p', 'Gespeicherte Antworten und Empfangsbestätigungen allein sind keine Patchplanung.', 'muted'));
}
function showArea(next) {
  area = next;
  for (const name of ['now', 'think', 'plan']) { const panel = $(name === 'think' ? 'thinking' : name === 'plan' ? 'planned' : 'now'); panel.hidden = name !== next; $(`area-${name}`).setAttribute('aria-pressed', String(name === next)); }
  const target = $(next === 'think' ? 'thinking' : next === 'plan' ? 'planned' : 'detail'); target.focus();
}
for (const name of ['now', 'think', 'plan']) $(`area-${name}`).addEventListener('click', () => showArea(name));
