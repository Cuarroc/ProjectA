// Pending answers, Root inbox and webhook delivery with a stable delivery id (DR-04b) on DR-04a.
// Split from the P1 DeskStore (pending/inbox/flushNotifications); the root agent id stays injected (D2),
// so on V2 every receipt lookup here fails closed with 503 while it is missing.
import { randomUUID } from 'node:crypto';
import { AnswerStore } from './answers.mjs';
import { getOwnershipContext, OwnershipError, OWNERSHIP_RELEASE_MISMATCH } from './ownership.mjs';
import { activeAnswers, activeEvents, ensure, isoTime, receiptFor, validId } from './model.mjs';

// R669-O1: on V2 every path here checks the root id before reading events, so an empty ledger also answers 503.
const requireRoot = (state, rootAgentId) => ensure(state.schemaVersion !== 2 || validId(rootAgentId),
  'Root-Agent-ID ist nicht konfiguriert; Empfangsprüfung abgelehnt.', 503);

export class DeliveryStore extends AnswerStore {
  #notificationClosing;
  // Retain core membership until accepted sends and their result commits settle.
  close() {
    if (this.#notificationClosing) return this.#notificationClosing;
    const context = getOwnershipContext(this.file);
    return this.#notificationClosing = (context.notificationQueue ?? Promise.resolve()).then(() => super.close());
  }
  async pending() {
    const state = await this.read(); requireRoot(state, this.rootAgentId);
    return activeAnswers(state).filter(a => state.schemaVersion === 2
      ? !receiptFor(state, a, this.rootAgentId) : !a.ack);
  }
  async inbox() {
    const state = await this.read(); requireRoot(state, this.rootAgentId); const pending = []; const received = [];
    for (const event of activeEvents(state)) {
      const receipt = receiptFor(state, event, this.rootAgentId) || null;
      const progress = state.progress?.find(p => p.eventId === event.eventRef.eventId) ?? null;
      const legacyAck = event.eventRef.kind === 'answer' ? event.content.ack ?? null : null;
      const envelope = { ...event, receipt, progress, legacyAck };
      (receipt || (state.schemaVersion === 1 && legacyAck?.status === 'received') ? received : pending).push(envelope);
    }
    return { pending, received };
  }
  flushNotifications(eventId) {
    if (this.#notificationClosing) return Promise.reject(new OwnershipError(OWNERSHIP_RELEASE_MISMATCH));
    const context = getOwnershipContext(this.file);
    // Separate from the mutation queue: receipts can commit during transport I/O.
    const work = (context.notificationQueue ?? Promise.resolve()).then(() => this.#deliver(eventId));
    context.notificationQueue = work.catch(() => {}); return work;
  }
  async #deliver(eventId) {
    // DR-04B-FU: V2 root check before missing-transport, so rootless V2 answers 503 not not-configured.
    requireRoot(await this.read(), this.rootAgentId);
    if (typeof this.io.notifyEvent !== 'function') return { status: 'not-configured' };
    const event = await this.change(state => {
      if (state.schemaVersion !== 2) return null;
      requireRoot(state, this.rootAgentId); const at = this.io.clock();
      const eligible = activeEvents(state).filter(e => (eventId === undefined || e.eventRef.eventId === eventId) && !receiptFor(state, e, this.rootAgentId));
      const a = eligible.map(e => e.content).filter(a =>
        (a.webhookDelivery?.status !== 'queued' || isoTime(a.webhookDelivery.queuedAt) && at - Date.parse(a.webhookDelivery.queuedAt) >= 7 * 86400000))
        .sort((x, y) => (Date.parse(x.webhookDelivery?.lastAttemptAt) || 0) - (Date.parse(y.webhookDelivery?.lastAttemptAt) || 0))[0];
      if (!a) return null;
      const ref = eligible.find(e => e.content === a).eventRef;
      if (!Object.hasOwn(a, 'webhookDelivery')) a.webhookDelivery = { status: 'pending', attempts: 0, lastAttemptAt: null, queuedAt: null, lastError: null };
      if (a.webhookDelivery?.status === 'queued') {
        a.webhookDelivery.status = 'pending'; a.webhookDelivery.deliveryId = randomUUID(); a.webhookDelivery.queuedAt = null;
      }
      ensure(a.webhookDelivery && a.webhookDelivery.status === 'pending' && Number.isSafeInteger(a.webhookDelivery.attempts) && a.webhookDelivery.attempts >= 0 && a.webhookDelivery.attempts < Number.MAX_SAFE_INTEGER, 'Outbox beschädigt.', 503);
      a.webhookDelivery.deliveryId ??= ref.eventId;
      ensure(validId(a.webhookDelivery.deliveryId), 'Outbox-Zustellungs-ID beschädigt.', 503);
      a.webhookDelivery.attempts++; a.webhookDelivery.lastAttemptAt = new Date(at).toISOString();
      return { type: 'decision-desk.event', eventId: ref.eventId, contentRevision: ref.kind === 'answer' ? ref.questionRevision : ref.ideaRevision, deliveryId: a.webhookDelivery.deliveryId };
    });
    if (!event) return { status: 'empty' };
    let queued = false;
    try { await this.io.notifyEvent(event, event.deliveryId); queued = true; } catch { /* Persist only a fixed error code, never transport secrets. */ }
    return this.change(state => {
      const current = activeEvents(state).find(e => e.eventRef.eventId === event.eventId);
      if (!current) return { status: 'superseded' };
      if (receiptFor(state, current, this.rootAgentId)) return { status: 'received' };
      const a = current.content;
      ensure(a.webhookDelivery, 'Outboxereignis fehlt.', 409);
      a.webhookDelivery.status = queued ? 'queued' : 'pending';
      a.webhookDelivery.queuedAt = queued ? new Date(this.io.clock()).toISOString() : null; a.webhookDelivery.lastError = queued ? null : 'transport-failed';
      return a.webhookDelivery;
    });
  }
}
