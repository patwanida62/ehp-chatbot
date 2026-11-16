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

// ------------------------------------------------------------
// Chat-message filtering (receiveMessages: false)
// ------------------------------------------------------------

const messageEvent = { type: 'message', replyToken: 'r1', source: { type: 'user', userId: 'U1' }, message: { type: 'text', text: 'ผูก LINE' } };
const followEvent = { type: 'follow', replyToken: 'r2', source: { type: 'user', userId: 'U1' } };
const postbackEvent = { type: 'postback', replyToken: 'r3', source: { type: 'user', userId: 'U1' }, postback: { data: 'a=1' } };

function lineRequest(events) {
  const rawBody = Buffer.from(JSON.stringify({ destination: 'U0', events }));
  return { rawBody, signature: computeLineSignature(CHANNEL_SECRET, rawBody) };
}

async function startPair(t) {
  const support = await startDownstream(t);
  const cis = await startDownstream(t);
  const forwarder = makeForwarder([
    { id: 'support', name: 'Support', url: support.url, enabled: true, receiveMessages: true },
    { id: 'cis', name: 'CIS', url: cis.url, enabled: true, receiveMessages: false },
  ]);
  return { support, cis, forwarder };
}

test('a target with receiveMessages=false gets the other events, re-signed so verification still passes', async (t) => {
  const { support, cis, forwarder } = await startPair(t);
  const { rawBody, signature } = lineRequest([messageEvent, followEvent, postbackEvent]);

  await forwarder.forward(rawBody, signature);

  assert.ok(support.received[0].body.equals(rawBody), 'chat handler gets the original bytes');
  const cisBody = JSON.parse(cis.received[0].body);
  assert.deepEqual(cisBody.events.map((e) => e.type), ['follow', 'postback']);
  assert.equal(cisBody.destination, 'U0');
  assert.ok(isValidLineSignature(CHANNEL_SECRET, cis.received[0].body, cis.received[0].headers['x-line-signature']));
});

test('a target is skipped entirely when only chat messages arrive', async (t) => {
  const { support, cis, forwarder } = await startPair(t);
  const { rawBody, signature } = lineRequest([messageEvent]);

  const results = await forwarder.forward(rawBody, signature);

  assert.deepEqual(results.map((r) => r.targetId), ['support']);
  assert.equal(support.received.length, 1);
  assert.equal(cis.received.length, 0);
  assert.equal(forwarder.describeTargets()[1].lastResult, null, 'skips are not recorded as deliveries');
});

test('requests without chat messages (and LINE Verify) reach filtered targets unchanged', async (t) => {
  const { cis, forwarder } = await startPair(t);
  const follow = lineRequest([followEvent]);
  const verify = lineRequest([]);

  await forwarder.forward(follow.rawBody, follow.signature);
  await forwarder.forward(verify.rawBody, verify.signature);

  assert.ok(cis.received[0].body.equals(follow.rawBody));
  assert.equal(cis.received[0].headers['x-line-signature'], follow.signature);
  assert.ok(cis.received[1].body.equals(verify.rawBody));
});

test('an unparseable body is passed through untouched rather than dropped', async (t) => {
  const { cis, forwarder } = await startPair(t);

  await forwarder.forward(Buffer.from('not json'), 'sig');

  assert.equal(cis.received[0].body.toString(), 'not json');
});
