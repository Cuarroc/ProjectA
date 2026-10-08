// Answers, Root receipts and acknowledgements (DR-04a) on the DR-03 core.
// Split from the P1 DeskStore (answer/receipt/ack); the root agent id comes only from
// the injected configuration (D2). Progress transitions are composed by a later module.
import { randomUUID } from 'node:crypto';
import { DeskStore } from './core.mjs';
import { activeEvents, answerRef, currentAnswer, ensure, id, latestAnswer, now, object, receiptFor, requireCurrentSource,
  sameRef, text, validEventRef, validId } from './model.mjs';

export class AnswerStore extends DeskStore {
  // D2 for paths P1 let through (C-3): receipt replay and every acknowledgement need the configured root id.
  #requireRoot() { ensure(validId(this.rootAgentId), 'Root-Agent-ID ist nicht konfiguriert; Empfangsprüfung abgelehnt.', 503); }
  answer(input) {
    object(input, 'Antwort');
    id(input.questionId); id(input.requestId);
    ensure(Number.isSafeInteger(input.questionRevision) && input.questionRevision > 0, 'Ungültige questionRevision.');
    ensure(input.expectedAnswerId === null || (typeof input.expectedAnswerId === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(input.expectedAnswerId)), 'Ungültige expectedAnswerId.');
    return this.change(state => {
      const q = state.questions.find(q => q.id === input.questionId);
      ensure(q, 'Frage nicht gefunden.', 404);
      const requestId = id(input.requestId);
      const payload = JSON.stringify({ questionId: input.questionId, questionRevision: input.questionRevision, action: input.action, selected: input.selected, note: input.note });
      const existing = state.answers.find(a => a.requestId === requestId);
      if (existing) { ensure(existing.payload === payload, 'Anfrage-ID wurde für eine andere Antwort verwendet.', 409); return existing; }
      requireCurrentSource(state, q);
      ensure(q.revision === input.questionRevision, 'Frage wurde geändert. Bitte die neue Fassung lesen.', 409);
      const previous = latestAnswer(state, q.id);
      ensure((previous?.id ?? null) === input.expectedAnswerId, 'Antwort wurde in einem anderen Fenster geändert. Bitte neu laden.', 409);
      ensure(['answer', 'defer', 'clarify'].includes(input.action), 'Ungültige Antwortart.');
      const selected = input.selected;
      ensure(Array.isArray(selected) && new Set(selected).size === selected.length, 'Ungültige Auswahl.');
      ensure(selected.every(v => q.options.some(o => o.id === v)), 'Auswahl enthält unbekannte Option.');
      if (input.action === 'answer' && q.mode === 'free') {
        ensure(selected.length === 0 && typeof input.note === 'string' && input.note.trim(), 'Freie Antwort benötigt nichtleeren Text ohne Auswahl.');
      } else if (input.action === 'answer') {
        ensure(selected.length > 0 && (q.mode === 'multiple' || selected.length === 1), 'Bitte eine gültige Auswahl treffen.');
        ensure(selected.length === 1 || !q.options.some(o => o.exclusive && selected.includes(o.id)), 'Diese Auswahl lässt sich nicht kombinieren.');
      } else ensure(selected.length === 0, 'Zurückstellen und Rückfragen enthalten keine Auswahl.');
      ensure(typeof input.note === 'string' && input.note.length <= 8000, 'Notiz ist zu lang.');
      if (input.action === 'clarify') ensure(input.note.trim(), 'Bitte deine Rückfrage eintragen.');
      const result = { id: randomUUID(), requestId, payload, questionId: q.id, questionRevision: q.revision,
        action: input.action, selected, note: input.note.trim(), savedAt: now(), question: structuredClone(q), ack: null, acknowledgements: [] };
      if (state.schemaVersion === 2) result.webhookDelivery = { status: 'pending', attempts: 0, lastAttemptAt: null, queuedAt: null, lastError: null };
      state.answers.push(result);
      if (state.schemaVersion === 2) state.progress.push({ eventId: result.id, currentStatus: 'incoming', progressRevision: 1,
        history: [{ progressRevision: 1, from: null, to: 'incoming', actor: 'user', at: result.savedAt, reason: 'Antwort gespeichert.', evidenceRefs: [] }] });
      return result;
    });
  }
  receipt(input) { return this.change(state => this.#receipt(state, input)); }
  async #receipt(state, input) {
    object(input, 'Quittierung'); object(input.eventRef, 'Ereignisreferenz');
    ensure(state.schemaVersion === 2, 'V2-Migration erforderlich.', 409);
    this.#requireRoot();
    const ref = input.eventRef;
    ensure(validEventRef(ref), 'Ungültige typisierte Ereignisreferenz.');
    const eventRef = ref.kind === 'answer' ? answerRef({ id: ref.eventId, questionId: ref.questionId, questionRevision: ref.questionRevision })
      : { kind: 'idea', eventId: ref.eventId, ideaId: ref.ideaId, ideaRevision: ref.ideaRevision };
    const request = { receiptId: id(input.receiptId), eventRef,
      transportMessageId: id(input.transportMessageId), rootReplyId: id(input.rootReplyId) };
    let suppliedProof;
    if (input.proof !== undefined) {
      object(input.proof, 'Root-Attestierung');
      suppliedProof = { rootAcknowledgedAt: input.proof.rootAcknowledgedAt, observedProof: input.proof.observedProof };
    }
    const payload = JSON.stringify({ ...request, ...(suppliedProof ? { proof: suppliedProof } : {}) });
    const existing = state.receipts.find(r => r.receiptId === request.receiptId);
    if (existing) { ensure(existing.payload === payload, 'Quittungs-ID wurde anders verwendet.', 409); return existing; }
    const exists = ref.kind === 'answer' ? state.answers.some(a => a.id === ref.eventId)
      : state.ideas.some(i => i.revisions.some(r => r.eventId === ref.eventId));
    ensure(exists, 'Ereignis nicht gefunden.', 404);
    const event = activeEvents(state).find(e => sameRef(e.eventRef, request.eventRef));
    ensure(event, 'Ereignisrevision ist nicht mehr aktuell oder abgeschlossen.', 409);
    ensure(!receiptFor(state, event, this.rootAgentId), 'Rootempfang bereits quittiert.', 409);
    ensure(typeof this.io.verifyReceipt === 'function', 'Root-Belegprüfung ist nicht angebunden.', 503);
    const proof = await this.io.verifyReceipt(structuredClone(request), structuredClone(suppliedProof));
    object(proof, 'Geprüfter Empfangsbeleg');
    ensure(proof.rootAgentId === this.rootAgentId && sameRef(proof.eventRef, request.eventRef)
      && proof.transportMessageId === request.transportMessageId && proof.rootReplyId === request.rootReplyId, 'Root-Beleg ist nicht an dieses Ereignis gebunden.', 403);
    ensure(typeof proof.rootAcknowledgedAt === 'string' && Number.isFinite(Date.parse(proof.rootAcknowledgedAt))
      && new Date(proof.rootAcknowledgedAt).toISOString() === proof.rootAcknowledgedAt, 'Ungültige Empfangszeit.');
    const result = { ...request, payload, rootAgentId: this.rootAgentId, rootAcknowledgedAt: proof.rootAcknowledgedAt,
      observedProof: text(proof.observedProof, 'Geprüfter Empfangsbeleg'), verificationMode: proof.verificationMode ?? 'external-verifier', recordedAt: now() };
    state.receipts.push(result); return result;
  }
  ack(input) {
    object(input, 'Quittierung');
    id(input.answerId);
    return this.change(async state => {
      this.#requireRoot();
      const a = currentAnswer(state, input.answerId);
      ensure(['received', 'applied'].includes(input.status), 'Ungültiger Status.');
      if (state.schemaVersion === 2) {
        if (input.status === 'applied' && input.progress !== undefined) {
          object(input.progress, 'Strukturierter Fortschrittsbeleg');
          ensure(sameRef(input.progress.eventRef, answerRef(a)) && input.progress.to === 'applied', 'Fortschrittsbeleg gehört zu anderem Ereignis oder Status.', 409);
          // P1 called its private progress transition here; the progress module provides it (fail closed until then).
          ensure(typeof this.progressTransition === 'function', 'Fortschrittsvertrag ist nicht angebunden.', 503);
          return { ...a, progress: await this.progressTransition(state, input.progress) };
        }
        ensure(input.status === 'received', 'Umsetzung benötigt den noch nicht angebundenen Fortschrittsvertrag.', 409);
        object(input.receipt, 'Strukturierter Rootbeleg');
        ensure(input.receipt.eventRef?.eventId === a.id, 'Quittung gehört zu einer anderen Antwort.', 409);
        const receipt = await this.#receipt(state, input.receipt); return { ...a, receipt };
      }
      ensure(input.status !== 'applied' || a.action === 'answer', 'Keine Zustimmung: nicht als umgesetzt markieren.');
      ensure(a.ack?.status !== 'applied' || input.status === 'applied', 'Umsetzung darf nicht zurückgestuft werden.', 409);
      const proof = input.status === 'received'
        ? { deliveryReceipt: text(input.deliveryReceipt, 'Weitergabebeleg') }
        : { evidence: text(input.evidence, 'Umsetzungsbeleg') };
      if (input.status === 'applied') ensure(a.ack, 'Empfang muss vor der Umsetzung bestätigt werden.');
      a.ack = { status: input.status, actor: text(input.actor, 'Verantwortlicher', 100), note: text(input.note, 'Beleg/Notiz'), ...proof, at: now() };
      a.acknowledgements.push(a.ack); return a;
    });
  }
}
