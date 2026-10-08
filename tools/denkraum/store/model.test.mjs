import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeskError, ideaPriorities, migrateState, receiptFor, statuses } from './model.mjs';

const ROOT = 'test-root-agent';
const eventRef = { kind: 'idea', eventId: 'event-1', ideaId: 'idea-1', ideaRevision: 1 };
const receipt = rootAgentId => ({ receiptId: 'receipt-1', eventRef, rootAgentId, rootAcknowledgedAt: '2026-10-07T00:00:00.000Z',
  observedProof: 'synthetic proof', payload: '{}' });
const v2 = receipts => migrateState({ schemaVersion: 1, revision: 3, questions: [], answers: [], receipts });

test('receiptFor fails closed when no root agent id is configured', () => {
  const state = v2([receipt(ROOT)]);
  for (const missing of [undefined, null, '', 'not a valid id!']) {
    assert.throws(() => receiptFor(state, { eventRef }, missing), e => e instanceof DeskError && e.status === 503);
  }
});

test('receiptFor matches only receipts of the configured root agent', () => {
  const state = v2([receipt(ROOT)]);
  assert.equal(receiptFor(state, { eventRef }, ROOT), state.receipts[0]);
  assert.equal(receiptFor(state, { eventRef }, 'other-root-agent'), undefined);
  assert.equal(receiptFor({ ...state, schemaVersion: 1 }, { eventRef }, undefined), false, 'v1 ledgers have no receipts to check');
});

test('malformed stored questions or answers fail as DeskError 503 instead of a later TypeError', () => {
  const ledger = extra => ({ schemaVersion: 1, revision: 0, questions: [], answers: [], ...extra });
  for (const bad of [{ answers: [null] }, { answers: [7] }, { answers: [{ questionId: 'bad id!' }] },
    { questions: [null] }, { questions: ['q'] }, { questions: [{ id: 'bad id!' }] }]) {
    assert.throws(() => migrateState(ledger(bad)), e => e instanceof DeskError && e.status === 503, JSON.stringify(bad));
  }
  const legacy = ledger({ questions: [{ id: 'E-1', revision: 1, options: [] }], answers: [{ id: 'a-1', questionId: 'E-1', questionRevision: 1, ack: null }] });
  assert.deepEqual(migrateState(legacy).answers, legacy.answers, 'well-formed legacy records stay accepted');
});

test('exported validation lists cannot be changed by an importer', () => {
  for (const list of [statuses, ideaPriorities]) {
    assert.ok(Object.isFrozen(list));
    assert.throws(() => list.push('unexpected'), TypeError);
  }
  assert.equal(statuses.includes('unexpected'), false);
});
