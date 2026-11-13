const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createLineEventForwarder, isForwardedRequest } = require('../src/services/lineEventForwarder');
const { computeLineSignature, isValidLineSignature } = require('../src/services/lineSignature');
const { silentLogger } = require('./helpers');

const CHANNEL_SECRET = 'channel-secret-for-forward-tests';

/** A real HTTP server standing in for EHP CIS / Vetcare; records exactly what it receives. */
async function startDownstream(t, { status = 200, delayMs = 0 } = {}) {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      setTimeout(() => res.writeHead(status).end(), delayMs);
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}/api/line-oa/webhook/1`, received };
}

function storeOf(targets) {
  return { list: () => targets, enabled: () => targets.filter((x) => x.enabled) };
}

function makeForwarder(targets, opts = {}) {
  return createLineEventForwarder({
    targetStore: storeOf(targets),
    channelSecret: CHANNEL_SECRET,
    logger: silentLogger,
    now: () => Date.UTC(2026, 10, 13, 5, 0, 0),
    ...opts,
  });
}

test('forwards the exact bytes and original signature so downstream verification passes', async (t) => {
  const cis = await startDownstream(t);
  const vet = await startDownstream(t);
  const forwarder = makeForwarder([
    { id: 'cis', name: 'EHP CIS', url: cis.url, enabled: true },
    { id: 'vet', name: 'EHP Vetcare', url: vet.url, enabled: true },
  ]);
  // Odd whitespace + Thai text: re-serialising JSON would change these bytes and break the signature.
  const rawBody = Buffer.from('{ "destination":"U1",  "events":[{"type":"message","message":{"text":"สวัสดี"}}] }');
  const signature = computeLineSignature(CHANNEL_SECRET, rawBody);

  const results = await forwarder.forward(rawBody, signature);

  assert.deepEqual(results.map((r) => [r.targetId, r.ok, r.status]), [['cis', true, 200], ['vet', true, 200]]);
  for (const downstream of [cis, vet]) {
    const [req] = downstream.received;
    assert.equal(req.path, '/api/line-oa/webhook/1');
    assert.ok(req.body.equals(rawBody), 'body forwarded byte-for-byte');
    assert.equal(req.headers['x-line-signature'], signature);
    assert.ok(isValidLineSignature(CHANNEL_SECRET, req.body, req.headers['x-line-signature']));
    assert.equal(req.headers['user-agent'], 'LineBotWebhook/2.0');
    assert.equal(req.headers['content-type'], 'application/json');
    assert.ok(isForwardedRequest(req.headers), 'marked to prevent loops');
  }
});

test('skips disabled targets', async (t) => {
  const cis = await startDownstream(t);
  const forwarder = makeForwarder([{ id: 'cis', name: 'CIS', url: cis.url, enabled: false }]);

  const results = await forwarder.forward(Buffer.from('{}'), 'sig');

  assert.deepEqual(results, []);
  assert.equal(cis.received.length, 0);
});

test('one failing target does not affect the others, and outcomes are recorded', async (t) => {
  const ok = await startDownstream(t);
  const broken = await startDownstream(t, { status: 500 });
  const forwarder = makeForwarder([
    { id: 'ok', name: 'OK', url: ok.url, enabled: true },
    { id: 'broken', name: 'Broken', url: broken.url, enabled: true },
    { id: 'down', name: 'Down', url: 'http://127.0.0.1:1/unreachable', enabled: true },
  ]);

  const results = await forwarder.forward(Buffer.from('{}'), 'sig');

  assert.equal(results[0].ok, true);
  assert.deepEqual([results[1].ok, results[1].error], [false, 'HTTP 500']);
  assert.equal(results[2].ok, false);
  assert.equal(results[2].status, null);
  const described = forwarder.describeTargets();
  assert.equal(described[0].lastResult.ok, true);
  assert.equal(described[0].lastResult.at, '2026-11-13T05:00:00.000Z');
  assert.equal(described[1].lastResult.error, 'HTTP 500');
});

test('a slow target times out instead of hanging', async (t) => {
  const slow = await startDownstream(t, { delayMs: 500 });
  const forwarder = makeForwarder([{ id: 'slow', name: 'Slow', url: slow.url, enabled: true }], { timeoutMs: 50 });

  const [result] = await forwarder.forward(Buffer.from('{}'), 'sig');

  assert.deepEqual([result.ok, result.error], [false, 'timeout after 50 ms']);
});

test('ping sends a correctly signed empty event list, like LINE "Verify"', async (t) => {
  const cis = await startDownstream(t);
  const target = { id: 'cis', name: 'CIS', url: cis.url, enabled: false };
  const forwarder = makeForwarder([target]);

  const result = await forwarder.ping(target);

  const [req] = cis.received;
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(req.body).events, []);
  assert.ok(isValidLineSignature(CHANNEL_SECRET, req.body, req.headers['x-line-signature']));
});

test('describeTargets reports null lastResult before any delivery', () => {
  const forwarder = makeForwarder([{ id: 'cis', name: 'CIS', url: 'https://x', enabled: true }]);

  assert.equal(forwarder.describeTargets()[0].lastResult, null);
});

test('isValidLineSignature rejects missing or wrong signatures', () => {
  const body = Buffer.from('{}');

  assert.equal(isValidLineSignature(CHANNEL_SECRET, body, undefined), false);
  assert.equal(isValidLineSignature(CHANNEL_SECRET, body, 'wrong'), false);
  assert.equal(isValidLineSignature(CHANNEL_SECRET, body, computeLineSignature(CHANNEL_SECRET, body)), true);
});
