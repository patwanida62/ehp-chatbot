const crypto = require('crypto');
const { safeEqual } = require('../utils/safeEqual');

/** LINE's x-line-signature: base64(HMAC-SHA256(channelSecret, rawBody)). */
function computeLineSignature(channelSecret, rawBody) {
  return crypto.createHmac('SHA256', channelSecret).update(rawBody).digest('base64');
}

function isValidLineSignature(channelSecret, rawBody, signature) {
  if (!signature || !rawBody) return false;
  return safeEqual(computeLineSignature(channelSecret, rawBody), signature);
}

module.exports = { computeLineSignature, isValidLineSignature };
