const test = require('node:test');
const assert = require('node:assert/strict');
const { signRequest, authenticateRequest } = require('../src/services/webhookAuth');
const { HMAC_SECRET, API_KEY, NOW_MS } = require('./helpers');

const hmacApp = { auth: { type: 'hmac', secret: HMAC_SECRET } };
const apiKeyApp = { auth: { type: 'apiKey', secret: API_KEY } };
const rawBody = Buffer.from('{"event":"notification.text"}');

test('accepts a correctly signed HMAC request', () => {
  const headers = signRequest(HMAC_SECRET, rawBody, NOW_MS);

  const result = authenticateRequest(hmacApp, { headers, rawBody, nowMs: NOW_MS });

  assert.deepEqual(result, { ok: true });
});

test('rejects HMAC requests with missing headers, tampered body or wrong secret', () => {
  const headers = signRequest(HMAC_SECRET, rawBody, NOW_MS);
  const wrongSecret = signRequest('another-secret-0123456789', rawBody, NOW_MS);

  assert.equal(authenticateRequest(hmacApp, { headers: {}, rawBody, nowMs: NOW_MS }).reason, 'missing_signature');
  assert.equal(
    authenticateRequest(hmacApp, { headers, rawBody: Buffer.from('{"tampered":1}'), nowMs: NOW_MS }).reason,
    'invalid_signature'
  );
  assert.equal(authenticateRequest(hmacApp, { headers: wrongSecret, rawBody, nowMs: NOW_MS }).reason, 'invalid_signature');
});

test('rejects HMAC requests outside the 5-minute window (replay protection)', () => {
  const headers = signRequest(HMAC_SECRET, rawBody, NOW_MS);

  const late = authenticateRequest(hmacApp, { headers, rawBody, nowMs: NOW_MS + 301_000 });
  const justInTime = authenticateRequest(hmacApp, { headers, rawBody, nowMs: NOW_MS + 300_000 });

  assert.equal(late.reason, 'timestamp_out_of_range');
  assert.equal(justInTime.ok, true);
});

test('rejects a non-numeric timestamp', () => {
  const headers = { ...signRequest(HMAC_SECRET, rawBody, NOW_MS), 'x-webhook-timestamp': 'abc' };

  assert.equal(authenticateRequest(hmacApp, { headers, rawBody, nowMs: NOW_MS }).reason, 'invalid_timestamp');
});

test('API key auth accepts the right key and rejects missing or wrong keys', () => {
  const check = (headers) => authenticateRequest(apiKeyApp, { headers, rawBody, nowMs: NOW_MS });

  assert.equal(check({ 'x-api-key': API_KEY }).ok, true);
  assert.equal(check({}).reason, 'missing_api_key');
  assert.equal(check({ 'x-api-key': 'wrong' }).reason, 'invalid_api_key');
});
