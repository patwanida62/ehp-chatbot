const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebhookService } = require('../src/services/webhookService');
const { createEventRegistry } = require('../src/services/events/eventRegistry');
const { createIdempotencyStore } = require('../src/services/idempotencyStore');
const { signRequest } = require('../src/services/webhookAuth');
const h = require('./helpers');

function setup() {
  const lineClient = h.createFakeLineClient();
  const service = createWebhookService({
    apps: h.buildTestApps(),
    eventRegistry: createEventRegistry(),
    lineClient,
    idempotencyStore: createIdempotencyStore(),
    logger: h.silentLogger,
    now: () => h.NOW_MS,
  });
  return { service, lineClient };
}

function signedRequest(appId, body) {
  const rawBody = Buffer.from(JSON.stringify(body));
  return { appId, body, rawBody, headers: signRequest(h.HMAC_SECRET, rawBody, h.NOW_MS) };
}

function apiKeyRequest(appId, body, key = h.API_KEY) {
  return { appId, body, rawBody: Buffer.from(JSON.stringify(body)), headers: { 'x-api-key': key } };
}

test('a valid signed appointment is pushed to LINE', async () => {
  const { service, lineClient } = setup();

  const res = await service.handle(signedRequest('ehp-cis', h.appointmentPayload()));

  assert.deepEqual(res, { status: 200, body: { status: 'sent', eventId: 'APT-0001-created' } });
  assert.equal(lineClient.pushes.length, 1);
  assert.equal(lineClient.pushes[0].to, h.USER_ID);
  assert.equal(lineClient.pushes[0].messages[0].type, 'flex');
});

test('the same eventId is delivered only once', async () => {
  const { service, lineClient } = setup();

  await service.handle(signedRequest('ehp-cis', h.appointmentPayload()));
  const second = await service.handle(signedRequest('ehp-cis', h.appointmentPayload()));

  assert.deepEqual(second.body, { status: 'duplicate', eventId: 'APT-0001-created' });
  assert.equal(lineClient.pushes.length, 1);
});

test('eventIds are scoped per app', async () => {
  const { service, lineClient } = setup();
  const text = { event: 'notification.text', eventId: 'same-id', data: { text: 'hi' }, to: { lineUserId: h.USER_ID } };

  await service.handle(signedRequest('ehp-cis', text));
  const other = await service.handle(apiKeyRequest('lab-system', text));

  assert.equal(other.body.status, 'sent');
  assert.equal(lineClient.pushes.length, 2);
});

test('an API-key app falls back to its default group target', async () => {
  const { service, lineClient } = setup();
  const body = { event: 'notification.text', eventId: 'lab-1', data: { text: 'ผลแล็บพร้อมแล้ว' } };

  const res = await service.handle(apiKeyRequest('lab-system', body));

  assert.equal(res.status, 200);
  assert.equal(lineClient.pushes[0].to, h.GROUP_ID);
});

test('unknown and disabled apps get 404', async () => {
  const { service } = setup();

  assert.equal((await service.handle(apiKeyRequest('nope', {}))).status, 404);
  assert.equal((await service.handle(apiKeyRequest('disabled-app', {}))).status, 404);
});

test('bad credentials get 401 with a reason', async () => {
  const { service } = setup();
  const req = signedRequest('ehp-cis', h.appointmentPayload());

  const res = await service.handle({ ...req, rawBody: Buffer.from('{}') });

  assert.deepEqual(res, { status: 401, body: { error: 'invalid_signature' } });
});

test('an event outside the app allow-list gets 403', async () => {
  const { service, lineClient } = setup();

  const res = await service.handle(apiKeyRequest('lab-system', h.appointmentPayload()));

  assert.deepEqual(res, { status: 403, body: { error: 'event_not_allowed' } });
  assert.equal(lineClient.pushes.length, 0);
});

test('malformed envelopes and data get 400 with details', async () => {
  const { service } = setup();

  const envelope = await service.handle(signedRequest('ehp-cis', { event: 'notification.text' }));
  const data = await service.handle(signedRequest('ehp-cis', h.appointmentPayload({ data: { clinic: 'x' } })));

  assert.equal(envelope.status, 400);
  assert.deepEqual(envelope.body.details, ['eventId is required (max 128 characters)', 'data must be an object']);
  assert.equal(data.status, 400);
  assert.ok(data.body.details.includes('appointmentId is required'));
});

test('an allowed but unregistered event gets 400 unsupported_event', async () => {
  const lineClient = h.createFakeLineClient();
  const service = createWebhookService({
    apps: h.buildTestApps(),
    eventRegistry: new Map(),
    lineClient,
    idempotencyStore: createIdempotencyStore(),
    logger: h.silentLogger,
    now: () => h.NOW_MS,
  });

  const res = await service.handle(signedRequest('ehp-cis', h.appointmentPayload()));

  assert.deepEqual(res, { status: 400, body: { error: 'unsupported_event' } });
});

test('a missing recipient gets 400', async () => {
  const { service } = setup();

  const res = await service.handle(signedRequest('ehp-cis', h.appointmentPayload({ to: undefined })));

  assert.deepEqual(res, { status: 400, body: { error: 'missing_recipient' } });
});

test('a LINE failure returns 502 and the event can be retried', async () => {
  const { service, lineClient } = setup();
  lineClient.failWith = Object.assign(new Error('boom'), { response: { status: 429, data: { message: 'quota' } } });

  const failed = await service.handle(signedRequest('ehp-cis', h.appointmentPayload()));
  lineClient.failWith = null;
  const retried = await service.handle(signedRequest('ehp-cis', h.appointmentPayload()));

  assert.deepEqual(failed, { status: 502, body: { error: 'line_push_failed' } });
  assert.equal(retried.body.status, 'sent');
});
