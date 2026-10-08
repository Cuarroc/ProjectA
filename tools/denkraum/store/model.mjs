import { randomUUID } from 'node:crypto';

export class DeskError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const ensure = (condition, message, status) => { if (!condition) throw new DeskError(message, status); };
const text = (v, name, max = 5000) => { ensure(typeof v === 'string' && v.trim() && v.length <= max, `${name}: Text fehlt oder ist zu lang.`); return v.trim(); };
const validId = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v);
const id = (v) => { ensure(validId(v), 'Ungültige ID.'); return v; };
const now = () => new Date().toISOString();
const record = v => v && typeof v === 'object' && !Array.isArray(v);
const object = (v, name) => ensure(record(v), `${name}: Objekt erforderlich.`);
const isoTime = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const ideaPriorities = ['urgent', 'high', 'normal', 'later'];
const validIdeaCategory = v => typeof v === 'string' && v === v.trim() && v.length <= 80;
const ideaDefaults = r => ({ category: r.category ?? '', userPriority: r.userPriority ?? 'normal' });
const statuses = ['incoming', 'reviewed', 'planned', 'applied'];
const validImplementationEvidence = e => record(e) && validId(e.id) && validId(e.eventId) && isoTime(e.observedAt)
  && ['artifactRef', 'check', 'observedResult', 'actor'].every(k => typeof e[k] === 'string' && e[k].trim() && e[k].length <= 5000);
function validEventRef(ref) {
  if (!record(ref) || !validId(ref.eventId)) return false;
  const revision = ref.kind === 'answer' ? ref.questionRevision : ref.ideaRevision;
  return Number.isSafeInteger(revision) && revision > 0 && (ref.kind === 'answer' ? validId(ref.questionId) : ref.kind === 'idea' && validId(ref.ideaId));
}
export const latestAnswer = (state, qid) => state.answers.findLast(a => a.questionId === qid);
const sourceIsCurrent = (state, q) => !q.sourceRef || state.ideas?.some(i => i.id === q.sourceRef.ideaId
  && i.revisions.at(-1).eventId === q.sourceRef.eventId && i.revisions.at(-1).revision === q.sourceRef.ideaRevision);
function requireCurrentSource(state, q) {
  if (!q.sourceRef) return;
  ensure(state.schemaVersion === 2, 'Explizite V2-Migration erforderlich.', 409);
  ensure(state.ideas.some(i => i.id === q.sourceRef.ideaId), 'Ideenquelle nicht gefunden.', 404);
  ensure(sourceIsCurrent(state, q), 'Ideenquelle ist nicht mehr aktuell.', 409);
}
// ponytail: current-answer scans are O(n²); index by question ID if the local ledger grows large.
const activeAnswers = state => state.answers.filter(a => a.ack?.status !== 'applied' && latestAnswer(state, a.questionId)?.id === a.id && state.questions.some(q => q.id === a.questionId && q.revision === a.questionRevision && sourceIsCurrent(state, q)));
const answerRef = a => ({ kind: 'answer', eventId: a.id, questionId: a.questionId, questionRevision: a.questionRevision });
const sameRef = (a, b) => validEventRef(a) && validEventRef(b) && a.kind === b.kind && a.eventId === b.eventId
  && (a.kind === 'answer' ? a.questionId === b.questionId && a.questionRevision === b.questionRevision : a.ideaId === b.ideaId && a.ideaRevision === b.ideaRevision);
function receiptFor(state, event, rootAgentId) {
  if (state.schemaVersion !== 2) return false;
  ensure(validId(rootAgentId), 'Root-Agent-ID ist nicht konfiguriert; Empfangsprüfung abgelehnt.', 503);
  return state.receipts.find(r => r.rootAgentId === rootAgentId && sameRef(r.eventRef, event.eventRef ?? answerRef(event)));
}
const activeEvents = state => [...activeAnswers(state).map(a => ({ eventRef: answerRef(a), content: a, savedAt: a.savedAt })),
  ...(state.schemaVersion === 2 ? state.ideas.map(i => { const r = i.revisions.at(-1); return {
    eventRef: { kind: 'idea', eventId: r.eventId, ideaId: i.id, ideaRevision: r.revision }, content: r, savedAt: r.createdAt }; }) : [])]
  .filter(e => !state.progress?.some(p => p.eventId === e.eventRef.eventId && p.currentStatus === 'applied'));
function currentAnswer(state, answerId) {
  const a = state.answers.find(a => a.id === answerId);
  ensure(a, 'Antwort nicht gefunden.', 404);
  ensure(latestAnswer(state, a.questionId)?.id === a.id && state.questions.some(q => q.id === a.questionId && q.revision === a.questionRevision && sourceIsCurrent(state, q)), 'Antwort ist nicht mehr aktuell.', 409);
  return a;
}

const priorityLevels = ['high', 'medium', 'low', 'unclassified'];
function priorityRefCurrent(state, ref) {
  if (!validEventRef(ref)) return false;
  if (ref.kind === 'idea') return sourceIsCurrent(state, { sourceRef: ref }) === true;
  try { return sameRef(answerRef(currentAnswer(state, ref.eventId)), ref); }
  catch (e) { if (e instanceof DeskError) return false; throw e; }
}
export function projectQuestionPriority(state, q) {
  const detail = q.priorityDetail;
  const current = state.questions.some(stored => stored.id === q.id && stored.revision === q.revision) && sourceIsCurrent(state, q) === true;
  const supported = current && !!detail?.reason?.trim() && detail.sourceRefs.length > 0
    && detail.sourceRefs.every(ref => priorityRefCurrent(state, ref))
    && (!q.sourceRef || detail.sourceRefs.some(ref => sameRef(ref, q.sourceRef)));
  const observed = evidenceRef => {
    const observation = q.recommendationDetail?.observation;
    if (q.sourceRef && isoTime(observation?.observedAt) && observation.evidenceRefs.includes(evidenceRef)) return true;
    return state.progress?.some(p => detail.sourceRefs.some(ref => ref.eventId === p.eventId) && p.history.some(h =>
      validImplementationEvidence(h.implementationEvidence) && h.implementationEvidence.eventId === p.eventId && h.implementationEvidence.id === evidenceRef)) === true;
  };
  return { questionId: q.id, questionRevision: q.revision, current, classificationSupported: !!supported,
    actualBlocker: !!supported && detail.blockingDependencies.length > 0 && detail.blockerEvidenceRefs.length > 0 && detail.blockerEvidenceRefs.every(observed),
    criticality: supported && detail.criticality ? detail.criticality : 'unclassified', impact: supported && detail.impact ? detail.impact : 'unclassified',
    reason: detail?.reason ?? '', blockingDependencies: detail?.blockingDependencies ?? [], blockerEvidenceRefs: detail?.blockerEvidenceRefs ?? [] };
}
export function compareQuestions(state, a, b) {
  const x = projectQuestionPriority(state, a); const y = projectQuestionPriority(state, b);
  const createdAt = q => isoTime(q.createdAt) ? Date.parse(q.createdAt) : Infinity;
  return Number(y.actualBlocker) - Number(x.actualBlocker)
    || priorityLevels.indexOf(x.criticality) - priorityLevels.indexOf(y.criticality)
    || priorityLevels.indexOf(x.impact) - priorityLevels.indexOf(y.impact)
    || (createdAt(a) < createdAt(b) ? -1 : createdAt(a) > createdAt(b) ? 1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function validateState(state) {
  ensure(state && [1, 2].includes(state.schemaVersion) && Number.isSafeInteger(state.revision) && state.revision >= 0 && Array.isArray(state.questions) && Array.isArray(state.answers), 'Datendatei beschädigt. Wiederherstellung nötig.', 503);
  // Only the shape every ledger scan dereferences; older optional fields stay untouched (DR-03 C-2).
  ensure(state.questions.every(q => record(q) && validId(q.id)) && state.answers.every(a => record(a) && validId(a.questionId)),
    'Datendatei beschädigt: Frage oder Antwort.', 503);
  if (state.questionImports !== undefined) ensure(Array.isArray(state.questionImports) && state.questionImports.every(r => record(r) && validId(r.requestId)
    && typeof r.payload === 'string' && record(r.result) && validId(r.result.id) && Number.isSafeInteger(r.result.revision) && r.result.revision > 0), 'Datendatei beschädigt: question imports.', 503);
  for (const r of state.questionImports ?? []) {
    try { validateQuestion(r.result); }
    catch { throw new DeskError('Datendatei beschädigt: question import result.', 503); }
  }
  for (const q of state.questions) if (record(q) && (q.mode === 'free' || q.sourceRef !== undefined || q.contentOrigin !== undefined || q.recommendationDetail !== undefined || q.priorityDetail !== undefined)) {
    try { ensure(validId(q.id), 'Ungültige gespeicherte Frage.'); validateQuestion(q); }
    catch { throw new DeskError('Datendatei beschädigt: Fragenimport.', 503); }
  }
  if (state.schemaVersion === 2) for (const key of ['ideas', 'receipts', 'progress', 'patches']) ensure(Array.isArray(state[key]), `Datendatei beschädigt: ${key}.`, 503);
  if (state.schemaVersion === 2) {
    for (const idea of state.ideas) {
      ensure(record(idea) && validId(idea.id) && Array.isArray(idea.revisions) && idea.revisions.length > 0, 'Datendatei beschädigt: idea.', 503);
      for (const [n, r] of idea.revisions.entries()) ensure(record(r) && r.revision === n + 1 && validId(r.eventId) && validId(r.requestId)
        && typeof r.title === 'string' && r.title.trim() && r.title.length <= 200 && typeof r.text === 'string' && r.text.trim() && r.text.length <= 8000
        && (r.source === null || typeof r.source === 'string' && r.source.trim() && r.source.length <= 2000)
        && (r.category === undefined || validIdeaCategory(r.category))
        && (r.userPriority === undefined || ideaPriorities.includes(r.userPriority))
        && isoTime(r.createdAt) && typeof r.payload === 'string', 'Datendatei beschädigt: idea revision.', 503);
    }
    for (const p of state.patches) ensure(record(p) && validId(p.id) && validId(p.requestId) && Number.isSafeInteger(p.revision) && p.revision > 0
      && typeof p.label === 'string' && p.label.trim() && p.label.length <= 200 && typeof p.windowText === 'string' && p.windowText.length <= 2000
      && typeof p.reason === 'string' && p.reason.trim() && Array.isArray(p.sourceRefs) && p.sourceRefs.length > 0 && p.sourceRefs.every(validEventRef)
      && Array.isArray(p.authorityEvidenceRefs) && p.authorityEvidenceRefs.length > 0 && p.authorityEvidenceRefs.every(r => typeof r === 'string' && r.trim() && r.length <= 2000)
      && isoTime(p.createdAt) && typeof p.payload === 'string', 'Datendatei beschädigt: patch.', 503);
    for (const r of state.receipts) ensure(record(r) && validId(r.receiptId) && validEventRef(r.eventRef) && validId(r.rootAgentId)
      && isoTime(r.rootAcknowledgedAt) && typeof r.observedProof === 'string' && r.observedProof.trim() && typeof r.payload === 'string'
      && (r.transportMessageId === undefined || validId(r.transportMessageId)) && (r.rootReplyId === undefined || validId(r.rootReplyId)), 'Datendatei beschädigt: receipt.', 503);
    for (const p of state.progress) {
      ensure(record(p) && validId(p.eventId) && statuses.includes(p.currentStatus) && Number.isSafeInteger(p.progressRevision) && p.progressRevision > 0
        && Array.isArray(p.history) && p.history.length > 0, 'Datendatei beschädigt: progress.', 503);
      for (const h of p.history) ensure(record(h) && Number.isSafeInteger(h.progressRevision) && h.progressRevision > 0 && (h.from === null || statuses.includes(h.from))
        && statuses.includes(h.to) && isoTime(h.at) && typeof h.actor === 'string' && h.actor.trim() && typeof h.reason === 'string' && h.reason.trim()
        && (h.evidenceRefs === undefined || Array.isArray(h.evidenceRefs))
        && (h.implementationEvidence === undefined || validImplementationEvidence(h.implementationEvidence) && h.implementationEvidence.eventId === p.eventId), 'Datendatei beschädigt: progress history.', 503);
      ensure(p.history.at(-1).to === p.currentStatus && p.history.at(-1).progressRevision === p.progressRevision, 'Datendatei beschädigt: progress revision.', 503);
    }
  }
}

export function migrateState(state) {
  validateState(state);
  const next = structuredClone(state);
  if (next.schemaVersion === 1) {
    next.schemaVersion = 2;
    for (const key of ['ideas', 'receipts', 'progress', 'patches']) if (!Object.hasOwn(next, key)) next[key] = [];
  }
  validateState(next);
  return next;
}

function validateQuestion(input) {
  object(input, 'Frage');
  if (input.expectedRevision !== undefined) ensure(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0, 'Ungültige expectedRevision.');
  const q = { id: id(input.id ?? (input.mode === 'free' ? randomUUID() : undefined)) };
  for (const key of ['title', 'context', 'owner', 'category', 'scope', 'source', 'uncertainty']) q[key] = text(input[key], key);
  q.priority = input.priority ?? 'normal'; q.mode = input.mode ?? 'single';
  ensure(['normal', 'blocking'].includes(q.priority), 'Ungültige Priorität.');
  ensure(['single', 'multiple', 'free'].includes(q.mode), 'Ungültige Auswahlart.');
  if (input.priorityDetail !== undefined) {
    const p = input.priorityDetail; object(p, 'Prioritätsdetails');
    const values = {};
    for (const key of ['blockingDependencies', 'blockerEvidenceRefs', 'sourceRefs']) {
      const list = p[key] === undefined ? [] : p[key]; ensure(Array.isArray(list) && list.length <= 32, 'Prioritätsreferenzliste erforderlich.');
      if (key === 'sourceRefs') values[key] = list.map(ref => {
        ensure(validEventRef(ref), 'Exakte Prioritätsquelle erforderlich.');
        return ref.kind === 'idea' ? { kind: 'idea', eventId: ref.eventId, ideaId: ref.ideaId, ideaRevision: ref.ideaRevision }
          : { kind: 'answer', eventId: ref.eventId, questionId: ref.questionId, questionRevision: ref.questionRevision };
      });
      else values[key] = list.map(v => text(v, key, 2000));
    }
    for (const key of ['criticality', 'impact']) {
      values[key] = p[key] ?? null; ensure(values[key] === null || priorityLevels.slice(0, 3).includes(values[key]), 'Ungültige Prioritätsstufe.');
    }
    ensure(p.reason === undefined || typeof p.reason === 'string' && p.reason.length <= 5000, 'Ungültige Prioritätsbegründung.');
    q.priorityDetail = { ...values, reason: p.reason?.trim() ?? '' };
  }
  if (input.sourceRef !== undefined) {
    ensure(validEventRef(input.sourceRef) && input.sourceRef.kind === 'idea', 'Exakte Ideenreferenz erforderlich.');
    const r = input.sourceRef; q.sourceRef = { kind: 'idea', eventId: r.eventId, ideaId: r.ideaId, ideaRevision: r.ideaRevision };
  }
  if (input.contentOrigin !== undefined) {
    object(input.contentOrigin, 'Inhaltsherkunft'); q.contentOrigin = { actor: text(input.contentOrigin.actor, 'Urheber', 200), sourceRefText: text(input.contentOrigin.sourceRefText, 'Herkunftsreferenz') };
  }
  if (input.recommendationDetail !== undefined) {
    const r = input.recommendationDetail; object(r, 'Empfehlungsdetails'); object(r.observation, 'Beobachtung');
    ensure(Array.isArray(r.observation.evidenceRefs) && r.observation.evidenceRefs.length <= 32 && Array.isArray(r.authorityRefs) && r.authorityRefs.length <= 32, 'Referenzlisten erforderlich.');
    ensure(r.observation.observedAt === null || isoTime(r.observation.observedAt), 'Beobachtungszeit muss ISO oder unbekannt sein.');
    ensure(r.patchWindowText === null || typeof r.patchWindowText === 'string' && r.patchWindowText.length <= 2000, 'Patchfenster muss Text oder unbekannt sein.');
    q.recommendationDetail = { observation: { statement: text(r.observation.statement, 'Beobachtungsbasis'),
      evidenceRefs: r.observation.evidenceRefs.map(v => text(v, 'Beobachtungsreferenz', 2000)), observedAt: r.observation.observedAt },
      hypothesis: text(r.hypothesis, 'Hypothese'), consequences: text(r.consequences, 'Folgen'), reversibility: text(r.reversibility, 'Umkehrbarkeit'),
      patchWindowText: r.patchWindowText === null ? null : r.patchWindowText.trim(), authorityRefs: r.authorityRefs.map(v => text(v, 'Autoritätsreferenz', 2000)) };
  }
  if (q.mode === 'free') {
    ensure(q.sourceRef && q.contentOrigin, 'Freie Frage benötigt exakte Quelle und Inhaltsherkunft.');
    ensure(input.options === undefined || Array.isArray(input.options) && input.options.length === 0, 'Freie Frage verwendet keine Auswahloptionen.');
    q.options = []; q.recommendation = null; return q;
  }
  ensure(Array.isArray(input.options) && input.options.length >= 2 && input.options.length <= 6, 'Zwei bis sechs Optionen nötig.');
  q.options = input.options.map(o => {
    object(o, 'Option');
    const option = { id: id(o.id), exclusive: o.exclusive === true };
    for (const key of ['label', 'rationale', 'impact', 'tradeoff', 'effort', 'reversible']) option[key] = text(o[key], key);
    if (o.preview) {
      object(o.preview, 'Vorschau');
      option.preview = { text: text(o.preview.text, 'Vorschau') };
      if (o.preview.image) {
        ensure(typeof o.preview.image === 'string' && /^\/previews\/[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(o.preview.image), 'Vorschau muss ein lokales Bild sein.');
        option.preview.image = o.preview.image;
      }
    }
    return option;
  });
  const options = new Set(q.options.map(o => o.id));
  ensure(options.size === q.options.length, 'Doppelte Optionen.');
  const recommended = input.recommendation?.optionIds;
  ensure(Array.isArray(recommended) && recommended.length > 0 && recommended.every(x => options.has(x)) && new Set(recommended).size === recommended.length, 'Empfehlung muss vorhandene Optionen nennen.');
  ensure(q.mode === 'multiple' || recommended.length === 1, 'Einzelauswahl braucht eine Empfehlung.');
  ensure(recommended.length === 1 || !q.options.some(o => o.exclusive && recommended.includes(o.id)), 'Widersprüchliche Empfehlung.');
  q.recommendation = { optionIds: recommended, rationale: text(input.recommendation.rationale, 'Empfehlungsbegründung') };
  return q;
}
// Exported for the store class; frozen so no importer can widen validation for all others.
Object.freeze(statuses);
Object.freeze(ideaPriorities);
export { ensure, text, validId, id, now, record, object, isoTime, ideaPriorities, validIdeaCategory, ideaDefaults, statuses,
  validImplementationEvidence, validEventRef, requireCurrentSource, activeAnswers, answerRef, sameRef, receiptFor, activeEvents, currentAnswer,
  priorityRefCurrent, validateState, validateQuestion };
