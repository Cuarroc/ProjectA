// V1 flow events share the ledger transaction and its ownership; no separate scheduler.
import { DeskError, currentAnswer, ensure, id, isoTime, now, object, sameRef, text, validEventRef, validId } from './model.mjs';
const roles = Object.freeze({ reserve: 'root', started: 'agent', asked: 'agent', answered: 'user' });
export function newIdeaFlow(mode) {
  ensure(['dialog', 'solo'].includes(mode), 'Ungültiger Ideenmodus.');
  return { version: 1, mode, revision: 0, events: [] };
}
function request(input) {
  object(input, 'Ideenablauf');
  ensure(Object.hasOwn(roles, input.command), 'Unbekannter Ablaufbefehl.');
  ensure(validEventRef(input.ideaRef) && input.ideaRef.kind === 'idea', 'Exakte Ideenreferenz erforderlich.');
  ensure(Number.isSafeInteger(input.expectedFlowRevision) && input.expectedFlowRevision >= 0, 'Ungültige Ablaufrevision.');
  const r = input.ideaRef;
  const out = { requestId: id(input.requestId), command: input.command,
    ideaRef: { kind: 'idea', eventId: r.eventId, ideaId: r.ideaId, ideaRevision: r.ideaRevision },
    expectedFlowRevision: input.expectedFlowRevision, turnId: id(input.turnId), jobId: id(input.jobId) };
  if (out.command === 'reserve') {
    out.mode = input.mode ?? null;
    ensure(out.mode === null || ['dialog', 'solo'].includes(out.mode), 'Ungültiger Turnmodus.');
  }
  if (out.command === 'started') out.startProof = text(input.startProof, 'Startbeleg', 2000);
  if (out.command === 'asked') {
    object(input.questionRef, 'Fragenreferenz'); const q = input.questionRef;
    ensure(Number.isSafeInteger(q.questionRevision) && q.questionRevision > 0, 'Ungültige Fragenrevision.');
    out.questionRef = { questionId: id(q.questionId), questionRevision: q.questionRevision };
  }
  if (out.command === 'answered') out.answerId = id(input.answerId);
  return out;
}
function advance(s, e) {
  if (e.command === 'reserve') {
    ensure(!s.turn || s.stage === 'answered', 'Turn ist noch aktiv.', 409);
    ensure(!s.turns.has(e.turnId) && !s.jobs.has(e.jobId), 'Turn oder Job wurde bereits verwendet.', 409);
    s.turns.add(e.turnId); s.jobs.add(e.jobId); s.turn = e.turnId; s.job = e.jobId;
    s.mode = e.mode ?? s.mode;
  } else {
    ensure(e.turnId === s.turn && e.jobId === s.job, 'Veraltete Turn-/Jobbindung.', 409);
    if (e.command === 'started') { ensure(s.stage === 'reserve', 'Start benötigt Reservierung.', 409); s.phase = 'elaborating'; }
    if (e.command === 'asked') {
      ensure(s.stage === 'started' && s.mode === 'dialog', 'Frage benötigt aktiven Dialogturn.', 409);
      s.question = e.questionRef; s.phase = 'awaiting_user';
    }
    if (e.command === 'answered') {
      ensure(s.stage === 'asked', 'Keine offene Frage.', 409); s.phase = 'elaborating';
    }
  }
  s.stage = e.command; return s;
}
export function validateIdeaFlow(flow, ideaRef, state) {
  try {
    object(flow, 'Ablauf'); newIdeaFlow(flow.mode);
    ensure(flow.version === 1 && Array.isArray(flow.events) && flow.events.length <= 100 && flow.revision === flow.events.length, 'Ungültige Ablaufversion/-revision.');
    const s = { phase: 'submitted', mode: flow.mode, turns: new Set(), jobs: new Set() }; const requests = new Set();
    for (const [n, e] of flow.events.entries()) {
      const normalized = request(e);
      ensure(e.payload === JSON.stringify(normalized) && e.expectedFlowRevision === n && e.revision === n + 1
        && sameRef(e.ideaRef, ideaRef) && !requests.has(e.requestId) && validId(e.rootAgentId) && isoTime(e.at)
        && e.actor === roles[e.command], 'Beschädigtes Ablaufereignis.');
      requests.add(e.requestId);
      if (['asked', 'answered'].includes(e.command)) ensure(text(e.text, 'Threadbeitrag', 4000) === e.text, 'Ungültiger Threadbeitrag.');
      if (e.command === 'answered') {
        const a = state.answers.find(a => a.id === e.answerId);
        ensure(a?.action === 'answer' && a.question?.mode === 'free' && sameRef(a.question.sourceRef, ideaRef)
          && a.questionId === s.question?.questionId && a.questionRevision === s.question?.questionRevision && a.note === e.text, 'Beschädigte Antwortbindung.');
      }
      advance(s, e); ensure(e.phase === s.phase, 'Ungültige Ablaufphase.');
    }
    return s;
  } catch { throw new DeskError('Datendatei beschädigt: Ideenablauf. Sie wurde nicht überschrieben.', 503); }
}
export function appendIdeaFlow(state, input, trustedContext, rootAgentId) {
  ensure(validId(rootAgentId), 'Root ist nicht konfiguriert.', 503);
  ensure(trustedContext?.role === 'root' && trustedContext.rootAgentId === rootAgentId, 'Vertrauenswürdiger Root-Kontext erforderlich.', 403);
  const r = request(input); const payload = JSON.stringify(r);
  ensure(state.schemaVersion === 2, 'V2-Migration erforderlich.', 409);
  for (const idea of state.ideas) for (const revision of idea.revisions) {
    const replay = revision.flow?.events.find(e => e.requestId === r.requestId);
    if (replay) { ensure(replay.payload === payload, 'requestId bereits anders verwendet.', 409); return replay; }
  }
  const idea = state.ideas.find(i => i.id === r.ideaRef.ideaId);
  ensure(idea, 'Idee nicht gefunden.', 404);
  const revision = idea.revisions.find(v => v.eventId === r.ideaRef.eventId && v.revision === r.ideaRef.ideaRevision);
  ensure(revision, 'Ideenfassung nicht gefunden.', 404);
  ensure(revision === idea.revisions.at(-1) && revision.flow, 'Ideenfassung veraltet oder ohne Ablauf.', 409);
  const flow = revision.flow;
  ensure(flow.revision === r.expectedFlowRevision, 'Ablaufrevision verändert.', 409);
  ensure(flow.events.length < 100, 'Ablauf hat bereits 100 Ereignisse.', 409);
  const s = validateIdeaFlow(flow, r.ideaRef, state); let contribution;
  if (r.command === 'asked') {
    const q = state.questions.find(q => q.id === r.questionRef.questionId);
    ensure(q, 'Frage nicht gefunden.', 404);
    ensure(q.revision === r.questionRef.questionRevision && q.mode === 'free' && sameRef(q.sourceRef, r.ideaRef), 'Frage ist nicht aktuell oder anders gebunden.', 409);
    ensure(!state.answers.some(a => a.questionId === q.id && a.questionRevision === q.revision), 'Frage ist bereits beantwortet.', 409);
    contribution = text(q.title, 'Frage', 4000);
  }
  if (r.command === 'answered') {
    const a = currentAnswer(state, r.answerId);
    ensure(a.action === 'answer' && a.question?.mode === 'free' && sameRef(a.question.sourceRef, r.ideaRef)
      && a.questionId === s.question?.questionId && a.questionRevision === s.question?.questionRevision, 'Antwort gehört nicht zur offenen Frage.', 409);
    contribution = text(a.note, 'Antwort', 4000);
  }
  advance(s, r);
  const event = { ...r, payload, revision: flow.revision + 1, actor: roles[r.command], rootAgentId, at: now(), phase: s.phase,
    ...(['asked', 'answered'].includes(r.command) ? { text: contribution } : {}) };
  flow.events.push(event); flow.revision++; return event;
}
