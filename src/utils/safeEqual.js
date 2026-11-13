const crypto = require('crypto');

/** Constant-time string comparison, so response timing does not leak how much of a secret matched. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { safeEqual };
