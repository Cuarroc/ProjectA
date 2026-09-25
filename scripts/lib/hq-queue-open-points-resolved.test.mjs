import test from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_POINT_TASKS } from '../hq-queue-open-points.mjs';

// W1-01 (PR #50) hat die Kimi-Zustellung gelöst: Smoke 8 durch den
// Launch-Pfad ohne manuellen Assist (.pa/report_kimi_raw_stream_2026-09-16.md).
// Ein erledigter Punkt darf nicht mehr eingereiht werden — `--apply` gegen die
// laufende App startet sofort einen echten Worker auf einen Bug, den es nicht
// mehr gibt.
test('the resolved Kimi delivery point is no longer queued', () => {
  assert.equal(OPEN_POINT_TASKS.some(task => task.key === 'kimi-delivery-nt17'), false);
  assert.equal(OPEN_POINT_TASKS.some(task => /Kimi-Zustellung/.test(task.text)), false);
});

// Die OpenCode-Zustellung (W1-02) ist weiter offen und bleibt eingereiht.
test('the still-open OpenCode delivery point stays queued', () => {
  assert.equal(OPEN_POINT_TASKS.some(task => task.key === 'opencode-delivery-nt17'), true);
});
