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

test('exported validation lists cannot be changed by an importer', () => {
  for (const list of [statuses, ideaPriorities]) {
    assert.ok(Object.isFrozen(list));
    assert.throws(() => list.push('unexpected'), TypeError);
  }
  assert.equal(statuses.includes('unexpected'), false);
});
