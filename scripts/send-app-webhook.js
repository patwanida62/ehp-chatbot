#!/usr/bin/env node
/**
 * Sends a signed test webhook — also a reference implementation for app developers.
 *
 * Usage:
 *   APP_SECRET=... node scripts/send-app-webhook.js <url> <payload.json> [hmac|apiKey]
 * Example:
 *   APP_SECRET=xxx node scripts/send-app-webhook.js http://localhost:3000/webhooks/apps/ehp-cis docs/examples/appointment.json
 */
const fs = require('fs');
const { signRequest, API_KEY_HEADER } = require('../src/services/webhookAuth');

function buildAuthHeaders(authType, secret, rawBody) {
  return authType === 'apiKey' ? { [API_KEY_HEADER]: secret } : signRequest(secret, rawBody);
}

async function main([url, payloadFile, authType = 'hmac']) {
  const secret = process.env.APP_SECRET;
  if (!url || !payloadFile || !secret) {
    console.error('Usage: APP_SECRET=... node scripts/send-app-webhook.js <url> <payload.json> [hmac|apiKey]');
    process.exit(2);
  }
  const rawBody = fs.readFileSync(payloadFile, 'utf8');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(authType, secret, rawBody) },
    body: rawBody,
  });
  console.log(res.status, await res.text());
  process.exit(res.ok ? 0 : 1);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
