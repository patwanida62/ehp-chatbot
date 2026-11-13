// LINE IDs: U = user, C = group, R = room, followed by 32 lowercase hex chars.
const LINE_ID_PATTERN = /^[UCR][0-9a-f]{32}$/;

function isValidLineId(value) {
  return typeof value === 'string' && LINE_ID_PATTERN.test(value);
}

function pickTarget(target) {
  if (!target) return null;
  return target.lineGroupId || target.lineUserId || null;
}

/**
 * Chooses who receives the message: the payload's `to` wins over the app's defaultTarget,
 * and a group ID wins over a user ID.
 */
function resolveRecipient(requested, fallback) {
  const to = pickTarget(requested) || pickTarget(fallback);
  if (!to) return { ok: false, reason: 'missing_recipient' };
  if (!isValidLineId(to)) return { ok: false, reason: 'invalid_recipient' };
  return { ok: true, to };
}

module.exports = { resolveRecipient, isValidLineId };
