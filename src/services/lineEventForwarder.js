const { computeLineSignature } = require('./lineSignature');

// Marks requests we forward; if one ever comes back to us (misconfigured loop) we won't forward it again.
const FORWARDED_HEADER = 'x-ehp-forwarded';
const LINE_USER_AGENT = 'LineBotWebhook/2.0';
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Copies LINE webhook requests to downstream systems byte-for-byte with the original
 * x-line-signature, so each system verifies them exactly as if LINE had called it directly.
 * (All systems sharing the OA must use the same Channel Secret.)
 */
function createLineEventForwarder({
  targetStore,
  channelSecret,
  fetchImpl = fetch,
  logger = console,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = Date.now,
}) {
  const lastResults = new Map(); // targetId → { ok, status, error, at }

  async function post(target, rawBody, signature) {
    try {
      const res = await fetchImpl(target.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': LINE_USER_AGENT,
          'x-line-signature': signature,
          [FORWARDED_HEADER]: '1',
        },
        body: rawBody,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { ok: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}` };
    } catch (err) {
      const error = err.name === 'TimeoutError' ? `timeout after ${timeoutMs} ms` : err.message;
      return { ok: false, status: null, error };
    }
  }

  /** Sends to one target and records the outcome. Never throws. */
  async function deliver(target, rawBody, signature) {
    const outcome = { ...(await post(target, rawBody, signature)), at: new Date(now()).toISOString() };
    lastResults.set(target.id, outcome);
    const line = `[LINE-FORWARD] ${target.name} → ${outcome.ok ? outcome.status : outcome.error}`;
    if (outcome.ok) logger.info(line);
    else logger.error(line);
    return { targetId: target.id, ...outcome };
  }

  /**
   * What a target should receive: the original request untouched when nothing is withheld,
   * a re-signed copy without chat messages when some are, or null when nothing is left for it.
   */
  function payloadFor(target, original, parsed) {
    if (target.receiveMessages !== false || !parsed || !Array.isArray(parsed.events)) return original;
    const events = parsed.events.filter((event) => event.type !== 'message');
    if (events.length === parsed.events.length) return original;
    if (events.length === 0) return null;
    const rawBody = Buffer.from(JSON.stringify({ ...parsed, events }));
    return { rawBody, signature: computeLineSignature(channelSecret, rawBody) };
  }

  function parseBody(rawBody) {
    try {
      return JSON.parse(rawBody.toString('utf8'));
    } catch {
      return null;
    }
  }

  /** Forwards one LINE request to every enabled target in parallel (targets left with no events are skipped). */
  function forward(rawBody, signature) {
    const original = { rawBody, signature };
    const parsed = parseBody(rawBody);
    const deliveries = targetStore.enabled()
      .map((target) => ({ target, payload: payloadFor(target, original, parsed) }))
      .filter(({ payload }) => payload !== null)
      .map(({ target, payload }) => deliver(target, payload.rawBody, payload.signature));
    return Promise.all(deliveries);
  }

  /** Sends a signed empty event list — what LINE's own "Verify" button sends. */
  function ping(target) {
    const rawBody = Buffer.from(JSON.stringify({ destination: 'ehp-forward-test', events: [] }));
    return deliver(target, rawBody, computeLineSignature(channelSecret, rawBody));
  }

  /** Targets with their most recent delivery outcome, for the admin UI. */
  function describeTargets() {
    return targetStore.list().map((t) => ({ ...t, lastResult: lastResults.get(t.id) || null }));
  }

  return { forward, ping, describeTargets };
}

/** True when the request was produced by a forwarder (ours or a peer), to break forwarding loops. */
function isForwardedRequest(headers) {
  return Boolean(headers[FORWARDED_HEADER]);
}

module.exports = { createLineEventForwarder, isForwardedRequest };
