import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createWebhookNotifier } from './server.mjs';
import { DeskError } from './store.mjs';

const url = 'https://agentsroom.dev/api/triggers/t_abcdef0123456789';
const secret = 'synthetic-webhook-secret-for-security-tests';
const event = { type: 'decision-desk.event', eventId: '12345678-1234-4234-8234-123456789012', contentRevision: 7 };
const deliveryId = '87654321-4321-4321-8321-210987654321';
const fixedFailure = error => {
  assert.ok(error instanceof DeskError);
  assert.equal(error.status, 503);
  assert.equal(error.message, 'Webhook-Übertragung fehlgeschlagen.');
  assert.equal(error.cause, undefined);
  for (const value of [url, secret, event.eventId, 'synthetic-private-question']) {
    assert.ok(!`${error.stack}\n${JSON.stringify(error)}`.includes(value));
  }
  return true;
};

test('DRSEC: unsafe webhook URLs are refused before any request', () => {
  let requests = 0;
  for (const invalid of [
    url.replace('://', '://synthetic-user:synthetic-password@'),
    `${url}?token=synthetic`, `${url}#synthetic`, url.replace('https:', 'http:'),
    url.replace('agentsroom.dev', 'untrusted.invalid'),
    url.replace('agentsroom.dev', 'agentsroom.dev.untrusted.invalid'),
    url.replace('agentsroom.dev', 'agentsroom.dev:444'), `${url}/extra`,
  ]) {
    assert.throws(() => createWebhookNotifier({ url: invalid, secret, request: async () => { requests++; } }), error => {
      assert.ok(error instanceof DeskError);
      assert.equal(error.status, 503);
      assert.equal(error.message, 'Webhook-Konfiguration ungültig.');
      assert.ok(!error.message.includes(invalid));
      return true;
    });
  }
  assert.equal(requests, 0);
});

test('DRSEC: redirect responses are rejected without following their location', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const calls = [];
    const response = new Response('synthetic-private-question', {
      status, headers: { Location: 'https://untrusted.invalid/collect' },
    });
    const notify = createWebhookNotifier({ url, secret, request: async (destination, options) => {
      calls.push({ destination: String(destination), redirect: options.redirect });
      return response;
    } });
    await assert.rejects(notify(event, deliveryId), fixedFailure);
    assert.deepEqual(calls, [{ destination: url, redirect: 'error' }]);
    assert.equal(response.bodyUsed, true, 'rejected response body is cancelled');
  }
});

test('DRSEC: envelope contains only allowed fields and independently verifiable HMAC', async () => {
  let sent;
  const notify = createWebhookNotifier({ url, secret, clock: () => 1700000000999,
    request: async (destination, options) => { sent = { destination: String(destination), ...options }; return new Response(null, { status: 204 }); } });
  await notify({ ...event, question: 'synthetic-private-question', note: 'synthetic-private-note',
    secret, token: 'synthetic-private-token', nested: { secret } }, deliveryId);
  assert.equal(sent.destination, url);
  assert.equal(sent.method, 'POST');
  assert.deepEqual(JSON.parse(sent.body), event);
  assert.deepEqual(Object.keys(sent.headers).sort(), [
    'Content-Type', 'X-AgentsRoom-Delivery', 'X-AgentsRoom-Signature', 'X-AgentsRoom-Timestamp',
  ]);
  assert.equal(sent.headers['Content-Type'], 'application/json');
  assert.equal(sent.headers['X-AgentsRoom-Delivery'], deliveryId);
  assert.equal(sent.headers['X-AgentsRoom-Timestamp'], '1700000000');
  assert.match(sent.headers['X-AgentsRoom-Signature'], /^v1=[a-f0-9]{64}$/);
  for (const value of [secret, 'synthetic-private-question', 'synthetic-private-note', 'synthetic-private-token']) {
    assert.ok(!JSON.stringify(sent).includes(value));
  }
  const bytes = value => new TextEncoder().encode(value);
  const key = await webcrypto.subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const signature = Buffer.from(sent.headers['X-AgentsRoom-Signature'].slice(3), 'hex');
  const signed = `v1:1700000000:${deliveryId}:${JSON.stringify(event)}`;
  assert.equal(await webcrypto.subtle.verify('HMAC', key, signature, bytes(signed)), true);
  for (const changed of [signed.replace('1700000000', '1700000001'), signed.replace(deliveryId, event.eventId),
    signed.replace('"contentRevision":7', '"contentRevision":8')]) {
    assert.equal(await webcrypto.subtle.verify('HMAC', key, signature, bytes(changed)), false);
  }
});

test('DRSEC: timeout returns a fixed error without URL body or secrets', async () => {
  let reason;
  const notify = createWebhookNotifier({ url, secret, request: async (destination, { signal, body }) => {
    assert.ok(signal instanceof AbortSignal);
    // Keep the test alive while the real AbortSignal.timeout timer (unref'ed by Node) expires.
    reason = await new Promise((resolve, reject) => {
      const guard = setTimeout(() => reject(new Error('timeout signal did not abort')), 10000);
      signal.addEventListener('abort', () => { clearTimeout(guard); resolve(signal.reason); }, { once: true });
    });
    throw new DOMException(`synthetic timeout: ${destination} ${body} ${secret}`, 'TimeoutError');
  } });
  await assert.rejects(notify(event, deliveryId), fixedFailure);
  assert.equal(reason.name, 'TimeoutError');
});

test('DRSEC: transport rejection returns a fixed error without URL body or secrets', async () => {
  const notify = createWebhookNotifier({ url, secret, request: async (destination, { body }) => {
    throw new Error(`synthetic network failure: ${destination} ${body} ${secret}`);
  } });
  await assert.rejects(notify(event, deliveryId), fixedFailure);
});
