// Ideas and question import (DR-04c-2): the last P1 operations, completing the store surface.
// Split from the P1 DeskStore (putIdea/putQuestion); neither needs the root agent id.
import { randomUUID } from 'node:crypto';
import { ProgressStore } from './progress.mjs';
import { ensure, id, ideaDefaults, ideaPriorities, now, object, priorityRefCurrent, requireCurrentSource, sameRef, text,
  validateQuestion, validIdeaCategory } from './model.mjs';

export class LedgerStore extends ProgressStore {
  async putIdea(input) {
    object(input, 'Idee');
    const requestId = id(input.requestId); const ideaId = input.id === undefined ? null : id(input.id);
    ensure(ideaId ? Number.isSafeInteger(input.expectedRevision) && input.expectedRevision > 0 : input.expectedRevision === null, 'Ungültige expectedRevision.');
    const content = { title: text(input.title, 'Titel', 200), text: text(input.text, 'Idee', 8000),
      source: input.source === undefined || input.source === null ? null : text(input.source, 'Quelle', 2000) };
    if (Object.hasOwn(input, 'category')) {
      ensure(typeof input.category === 'string' && validIdeaCategory(input.category.trim()), 'Ungültige Ideenkategorie.');
      content.category = input.category.trim();
    }
    if (Object.hasOwn(input, 'userPriority')) {
      ensure(ideaPriorities.includes(input.userPriority), 'Ungültige Ideenpriorität.');
      content.userPriority = input.userPriority;
    }
    const payload = JSON.stringify({ id: ideaId, expectedRevision: input.expectedRevision, ...content });
    return this.change(state => {
      ensure(state.schemaVersion === 2, 'Explizite V2-Migration erforderlich.', 409);
      // ponytail: request replay scans the local history; index request IDs when the ledger grows large.
      for (const idea of state.ideas) {
        const replay = idea.revisions.find(r => r.requestId === requestId);
        if (replay) { ensure(replay.payload === payload, 'requestId bereits mit anderem Inhalt verwendet.', 409); return { id: idea.id, ...replay }; }
      }
      let idea = ideaId ? state.ideas.find(i => i.id === ideaId) : null;
      if (ideaId) ensure(idea, 'Idee nicht gefunden.', 404);
      if (idea) ensure(idea.revisions.at(-1).revision === input.expectedRevision, 'Ideenrevision verändert.', 409);
      else { idea = { id: randomUUID(), revisions: [] }; state.ideas.push(idea); }
      const metadata = { ...ideaDefaults(idea.revisions.at(-1) ?? {}), ...content };
      const revision = { revision: idea.revisions.length + 1, eventId: randomUUID(), requestId, payload, ...metadata, createdAt: now() };
      revision.webhookDelivery = { status: 'pending', attempts: 0, lastAttemptAt: null, queuedAt: null, lastError: null };
      idea.revisions.push(revision);
      state.progress.push({ eventId: revision.eventId, currentStatus: 'incoming', progressRevision: 1,
        history: [{ progressRevision: 1, from: null, to: 'incoming', actor: 'user', at: revision.createdAt, reason: 'Idee gespeichert.', evidenceRefs: [] }] });
      return { id: idea.id, ...revision };
    });
  }
  async putQuestion(input) {
    const q = validateQuestion(input);
    const requestId = input.requestId === undefined ? null : id(input.requestId);
    const payload = requestId ? JSON.stringify({ id: input.id ?? null, expectedRevision: input.expectedRevision ?? null, question: { ...q, id: input.id ?? null } }) : null;
    return this.change(state => {
      const replay = requestId && state.questionImports?.find(r => r.requestId === requestId);
      if (replay) { ensure(replay.payload === payload, 'Import-requestId bereits anders verwendet.', 409); return replay.result; }
      const index = state.questions.findIndex(x => x.id === q.id); const old = state.questions[index];
      requireCurrentSource(state, { ...old, ...q });
      const detail = q.priorityDetail ?? old?.priorityDetail;
      if (detail?.sourceRefs.length) {
        ensure(detail.sourceRefs.every(ref => priorityRefCurrent(state, ref)), 'Prioritätsquelle ist nicht aktuell.', 409);
        const sourceRef = q.sourceRef ?? old?.sourceRef;
        ensure(!sourceRef || detail.sourceRefs.some(ref => sameRef(ref, sourceRef)), 'Priorität ist nicht an diese Quelle gebunden.', 409);
      }
      ensure(old || input.expectedRevision === undefined, 'Frage fehlt für diese Revision. Erst neu laden.', 409);
      ensure(!old || input.expectedRevision === old.revision, 'Frage wurde inzwischen geändert. Erst neu laden.', 409);
      if (old?.recommendationDetail && q.sourceRef && !sameRef(old.sourceRef, q.sourceRef) && q.recommendationDetail === undefined) q.recommendationDetail = undefined;
      const at = now();
      const next = { ...old, ...q, revision: (old?.revision ?? 0) + 1, createdAt: old?.createdAt ?? at, updatedAt: at };
      if (old) state.questions[index] = next; else state.questions.push(next);
      if (requestId) { state.questionImports ??= []; state.questionImports.push({ requestId, payload, result: structuredClone(next) }); }
      return next;
    });
  }
}
