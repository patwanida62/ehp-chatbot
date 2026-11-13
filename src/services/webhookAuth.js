const crypto = require('crypto');
const { safeEqual } = require('../utils/safeEqual');

const SIGNATURE_HEADER = 'x-webhook-signature';
const TIMESTAMP_HEADER = 'x-webhook-timestamp';
const API_KEY_HEADER = 'x-api-key';
const DEFAULT_TOLERANCE_SEC = 300;

const ok = () => ({ ok: true });
const fail = (reason) => ({ ok: false, reason });

/** Signature = "sha256=" + hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)). */
function computeSignature(secret, timestamp, rawBody) {
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
  return `sha256=${digest}`;
}

/** Builds the headers a sending application must attach (used by the CLI sender and tests). */
function signRequest(secret, rawBody, nowMs = Date.now()) {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: computeSignature(secret, timestamp, rawBody),
  };
}

function verifyHmac(secret, { headers, rawBody, nowMs, toleranceSec }) {
  const timestamp = headers[TIMESTAMP_HEADER];
  const signature = headers[SIGNATURE_HEADER];
  if (!timestamp || !signature) return fail('missing_signature');
  if (!/^\d+$/.test(timestamp)) return fail('invalid_timestamp');
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > toleranceSec) return fail('timestamp_out_of_range');
  if (!safeEqual(computeSignature(secret, timestamp, rawBody), signature)) return fail('invalid_signature');
  return ok();
}

function verifyApiKey(secret, { headers }) {
  const apiKey = headers[API_KEY_HEADER];
  if (!apiKey) return fail('missing_api_key');
  return safeEqual(apiKey, secret) ? ok() : fail('invalid_api_key');
}

/**
 * Checks that a request really comes from `app`.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function authenticateRequest(app, { headers, rawBody, nowMs = Date.now(), toleranceSec = DEFAULT_TOLERANCE_SEC }) {
  const { type, secret } = app.auth;
  if (type === 'hmac') return verifyHmac(secret, { headers, rawBody, nowMs, toleranceSec });
  if (type === 'apiKey') return verifyApiKey(secret, { headers });
  return fail('unsupported_auth_type');
}

module.exports = {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  API_KEY_HEADER,
  computeSignature,
  signRequest,
  authenticateRequest,
};
