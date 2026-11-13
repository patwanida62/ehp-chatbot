const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10000;

/**
 * In-memory record of processed event keys so a retried webhook is not sent to LINE twice.
 * Single-instance only: run several replicas → swap for a shared store (e.g. Redis SET NX EX).
 */
function createIdempotencyStore({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, now = Date.now } = {}) {
  const expiries = new Map(); // key → expiresAt; insertion order == expiry order (fixed TTL)

  function pruneExpired() {
    const current = now();
    for (const [key, expiresAt] of expiries) {
      if (expiresAt > current) break;
      expiries.delete(key);
    }
  }

  function evictOverflow() {
    while (expiries.size >= maxEntries) {
      expiries.delete(expiries.keys().next().value);
    }
  }

  /** Returns true if the key was free and is now reserved, false if already seen. */
  function reserve(key) {
    pruneExpired();
    if (expiries.has(key)) return false;
    evictOverflow();
    expiries.set(key, now() + ttlMs);
    return true;
  }

  /** Frees a key so the sender may retry (used when delivery failed). */
  function release(key) {
    expiries.delete(key);
  }

  return { reserve, release };
}

module.exports = { createIdempotencyStore };
