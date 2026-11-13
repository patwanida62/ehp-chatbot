const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { rawJsonBody } = require('../src/middleware/rawJsonBody');
const { createAppWebhookRouter } = require('../src/routes/appWebhookRouter');
const { createWebhookService } = require('../src/services/webhookService');
const { createEventRegistry } = require('../src/services/events/eventRegistry');
const { createIdempotencyStore } = require('../src/services/idempotencyStore');
const { signRequest } = require('../src/services/webhookAuth');
const h = require('./helpers');

async function startServer(t, service) {
  const app = express();
  app.use(rawJsonBody());
  app.use(createAppWebhookRouter(service, h.silentLogger));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('HTTP: a signed request is verified against the exact raw bytes and delivered', async (t) => {
  const lineClient = h.createFakeLineClient();
  const service = createWebhookService({
    apps: h.buildTestApps(),
    eventRegistry: createEventRegistry(),
    lineClient,
    idempotencyStore: createIdempotencyStore(),
    logger: h.silentLogger,
  });
  const baseUrl = await startServer(t, service);
  // Unusual spacing proves the signature is checked against raw bytes, not re-serialized JSON.
  const rawBody = `{ "event":"appointment.created",  "eventId":"e-1", "to":{"lineUserId":"${h.USER_ID}"},
    "data":{"appointmentId":"A1","datetime":"2026-11-20T09:30:00+07:00","clinic":"OPD"} }`;

  const res = await fetch(`${baseUrl}/webhooks/apps/ehp-cis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...signRequest(h.HMAC_SECRET, rawBody) },
    body: rawBody,
  });

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'sent', eventId: 'e-1' });
  assert.equal(lineClient.pushes.length, 1);
});

test('HTTP: unexpected service errors become 500 internal_error', async (t) => {
  const baseUrl = await startServer(t, { handle: async () => { throw new Error('kaboom'); } });

  const res = await fetch(`${baseUrl}/webhooks/apps/ehp-cis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'internal_error' });
});
