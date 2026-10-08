// Progress transitions and patch plans (DR-04c-1) on DR-04b.
// Split from the P1 DeskStore (putProgress/#progress/putPatch); the root agent id stays injected (D2),
// so receipt checks fail closed with 503 and progress entries name the configured root as actor.
import { randomUUID } from 'node:crypto';
import { DeliveryStore } from './delivery.mjs';
import { activeEvents, answerRef, ensure, id, now, object, receiptFor, sameRef, statuses, text, validEventRef,
  validImplementationEvidence } from './model.mjs';

export class ProgressStore extends DeliveryStore {
  // Binds the DR-04a hook: a V2 "applied" ack runs the same transition inside its own change.
  progressTransition(state, input) { return this.#progress(state, input); }
  putProgress(input) { return this.change(state => this.#progress(state, input)); }
  async #progress(state, input) {
    object(input, 'Fortschritt'); ensure(state.schemaVersion === 2, 'Explizite V2-Migration erforderlich.', 409);
    const requestId = id(input.requestId); ensure(validEventRef(input.eventRef), 'Ungültige Ereignisreferenz.');
    const ref = input.eventRef;
    const eventRef = ref.kind === 'answer' ? answerRef({ id: ref.eventId, questionId: ref.questionId, questionRevision: ref.questionRevision })
      : { kind: 'idea', eventId: ref.eventId, ideaId: ref.ideaId, ideaRevision: ref.ideaRevision };
    ensure(Number.isSafeInteger(input.expectedProgressRevision) && input.expectedProgressRevision > 0 && statuses.includes(input.from) && statuses.includes(input.to), 'Ungültiger Fortschrittsstand.');
    ensure(Array.isArray(input.evidenceRefs) && input.evidenceRefs.length > 0 && input.evidenceRefs.length <= 32, 'Beobachtete Prüfreferenzen erforderlich.');
    const request = { requestId, eventRef, expectedProgressRevision: input.expectedProgressRevision, from: input.from, to: input.to,
      reason: text(input.reason, 'Fortschrittsgrund'), patchId: input.patchId === undefined ? null : id(input.patchId),
      evidenceRefs: input.evidenceRefs.map(r => text(r, 'Prüfreferenz', 2000)), implementationEvidence: input.implementationEvidence ?? null };
    if (request.implementationEvidence !== null) {
      const e = request.implementationEvidence; ensure(validImplementationEvidence(e), 'Vollständiger beobachteter Umsetzungsbeleg erforderlich.');
      request.implementationEvidence = { id: e.id, eventId: e.eventId, artifactRef: e.artifactRef.trim(), observedAt: e.observedAt,
        check: e.check.trim(), observedResult: e.observedResult.trim(), actor: e.actor.trim() };
    }
    const payload = JSON.stringify(request);
    const replay = state.progress.flatMap(p => p.history).find(h => h.requestId === requestId);
    const result = h => ({ eventId: eventRef.eventId, currentStatus: h.to, progressRevision: h.progressRevision, transition: h });
    if (replay) { ensure(replay.payload === payload, 'requestId bereits anders verwendet.', 409); return result(replay); }
    const known = ref.kind === 'answer' ? state.answers.some(a => a.id === ref.eventId) : state.ideas.some(i => i.revisions.some(r => r.eventId === ref.eventId));
    ensure(known, 'Ereignis nicht gefunden.', 404);
    const event = activeEvents(state).find(e => sameRef(e.eventRef, eventRef)); ensure(event, 'Ereignisrevision nicht mehr aktuell oder abgeschlossen.', 409);
    ensure(receiptFor(state, event, this.rootAgentId), 'Exact Rootempfang fehlt.', 409);
    let p = state.progress.find(p => p.eventId === ref.eventId);
    if (!p) { p = { eventId: ref.eventId, currentStatus: 'incoming', progressRevision: 1, history: [{ progressRevision: 1, from: null, to: 'incoming',
      actor: 'system', at: now(), reason: 'Gespeichertes Ereignis in Fortschrittsvertrag aufgenommen.', evidenceRefs: [] }] }; state.progress.push(p); }
    ensure(p.progressRevision === request.expectedProgressRevision && p.currentStatus === request.from, 'Fortschrittsrevision verändert.', 409);
    ensure(['incoming:reviewed', 'reviewed:planned', 'planned:applied', 'planned:reviewed'].includes(`${request.from}:${request.to}`), 'Fortschrittsübergang nicht erlaubt.', 409);
    let patchRef = null;
    if (['planned', 'applied'].includes(request.to)) {
      ensure(ref.kind !== 'answer' || event.content.action === 'answer', 'Zurückstellen oder Rückfrage erteilt keine Zustimmung.', 409);
      if (request.to === 'planned') { ensure(request.patchId, 'Patchplan erforderlich.'); const patch = state.patches.findLast(patch => patch.id === request.patchId);
        ensure(patch, 'Patch nicht gefunden.', 404); patchRef = { id: patch.id, revision: patch.revision }; }
      else patchRef = p.history.at(-1).patchRef;
      const patch = state.patches.find(patch => patch.id === patchRef?.id && patch.revision === patchRef?.revision);
      ensure(patch && patch.authorityMode === 'configured-verifier-attestation' && patch.authorityEvidenceRefs.length > 0 && patch.sourceRefs.some(r => sameRef(r, eventRef)), 'Patchautorität passt nicht zur Ereignisfassung.', 409);
    }
    if (request.to === 'applied') {
      ensure(request.implementationEvidence, 'Beobachteter Umsetzungsbeleg fehlt.');
      ensure(request.implementationEvidence.eventId === ref.eventId, 'Umsetzungsbeleg gehört zu anderem Ereignis.', 409);
      ensure(!state.progress.some(p => p.history.some(h => h.implementationEvidence?.id === request.implementationEvidence.id)), 'Umsetzungsbeleg-ID bereits verwendet.', 409);
    } else ensure(request.implementationEvidence === null, 'Umsetzungsbeleg nur für tatsächliche Umsetzung.');
    ensure(typeof this.io.verifyProgressEvidence === 'function', 'Fortschritts-Belegprüfung nicht angebunden.', 503);
    ensure(await this.io.verifyProgressEvidence(structuredClone(request)) === true, 'Beobachtete Fortschrittsbelege nicht bestätigt.', 403);
    const h = { requestId, payload, progressRevision: p.progressRevision + 1, from: request.from, to: request.to, actor: this.rootAgentId, at: now(),
      reason: request.reason, evidenceRefs: request.evidenceRefs, patchRef, ...(request.implementationEvidence ? { implementationEvidence: request.implementationEvidence } : {}) };
    p.history.push(h); p.progressRevision = h.progressRevision; p.currentStatus = h.to; return result(h);
  }
  async putPatch(input) {
    object(input, 'Patch'); const requestId = id(input.requestId); const patchId = input.id === undefined ? null : id(input.id);
    ensure(patchId ? Number.isSafeInteger(input.expectedRevision) && input.expectedRevision > 0 : input.expectedRevision === null, 'Ungültige expectedRevision.');
    ensure(typeof input.windowText === 'string' && input.windowText.length <= 2000, 'Ungültiges Patchfenster.');
    ensure(Array.isArray(input.sourceRefs) && input.sourceRefs.length > 0 && input.sourceRefs.length <= 32 && input.sourceRefs.every(validEventRef), 'Typisierte Patchquellen erforderlich.');
    const sourceRefs = input.sourceRefs.map(r => r.kind === 'answer' ? answerRef({ id: r.eventId, questionId: r.questionId, questionRevision: r.questionRevision })
      : { kind: 'idea', eventId: r.eventId, ideaId: r.ideaId, ideaRevision: r.ideaRevision });
    ensure(!sourceRefs.some((r, n) => sourceRefs.slice(0, n).some(previous => sameRef(previous, r))), 'Doppelte Patchquelle.');
    ensure(Array.isArray(input.authorityEvidenceRefs) && input.authorityEvidenceRefs.length > 0 && input.authorityEvidenceRefs.length <= 16, 'Vorhandene Freigabereferenzen erforderlich.');
    const content = { label: text(input.label, 'Patchlabel', 200), windowText: input.windowText.trim(), sourceRefs,
      reason: text(input.reason, 'Planungsgrund'), authorityEvidenceRefs: input.authorityEvidenceRefs.map(r => text(r, 'Freigabereferenz', 2000)) };
    const payload = JSON.stringify({ id: patchId, expectedRevision: input.expectedRevision, ...content });
    return this.change(async state => {
      ensure(state.schemaVersion === 2, 'Explizite V2-Migration erforderlich.', 409);
      const replay = state.patches.find(p => p.requestId === requestId);
      if (replay) { ensure(replay.payload === payload, 'requestId bereits anders verwendet.', 409); return replay; }
      const prior = patchId ? state.patches.findLast(p => p.id === patchId) : null;
      if (patchId) ensure(prior, 'Patch nicht gefunden.', 404);
      if (prior) ensure(prior.revision === input.expectedRevision, 'Patchrevision verändert.', 409);
      for (const ref of sourceRefs) {
        const known = ref.kind === 'answer' ? state.answers.some(a => a.id === ref.eventId) : state.ideas.some(i => i.revisions.some(r => r.eventId === ref.eventId));
        ensure(known, 'Patchquelle nicht gefunden.', 404);
        const event = activeEvents(state).find(e => sameRef(e.eventRef, ref));
        ensure(event, 'Patchquelle nicht mehr aktuell.', 409);
        ensure(receiptFor(state, event, this.rootAgentId), 'Rootempfang der Patchquelle fehlt.', 409);
        ensure(ref.kind !== 'answer' || event.content.action === 'answer', 'Zurückstellen oder Rückfrage erteilt keine Zustimmung.', 409);
      }
      ensure(typeof this.io.verifyPatchAuthority === 'function', 'Patch-Freigabeprüfung nicht angebunden.', 503);
      ensure(await this.io.verifyPatchAuthority(structuredClone(content)) === true, 'Bestehende Patchautorität nicht bestätigt.', 403);
      const patch = { id: patchId ?? randomUUID(), revision: (prior?.revision ?? 0) + 1, requestId, payload, ...content,
        createdAt: now(), authorityMode: 'configured-verifier-attestation' };
      state.patches.push(patch); return patch;
    });
  }
}
