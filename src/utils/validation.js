const DEFAULT_MAX_LENGTH = 200;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Pushes an error when `data[field]` is not a non-empty string within `max` chars. */
function requireString(data, field, errors, max = DEFAULT_MAX_LENGTH) {
  const value = data[field];
  if (!isNonEmptyString(value)) {
    errors.push(`${field} is required`);
  } else if (value.length > max) {
    errors.push(`${field} must be at most ${max} characters`);
  }
}

/** Like requireString, but an absent value is allowed. */
function optionalString(data, field, errors, max = DEFAULT_MAX_LENGTH) {
  if (data[field] === undefined || data[field] === null) return;
  requireString(data, field, errors, max);
}

module.exports = { isPlainObject, isNonEmptyString, requireString, optionalString };
