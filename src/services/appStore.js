const crypto = require('crypto');
const { buildAppRegistry } = require('../config/appRegistry');
const { isValidLineId } = require('./recipientResolver');
const { ServiceError } = require('./errors');
const { isPlainObject } = require('../utils/validation');
const { readJsonArray, writeJsonAtomically } = require('../utils/jsonFile');

const AUTH_TYPES = Object.freeze(['hmac', 'apiKey']);
const ENV_PREFIX = 'env:';
const NAME_MAX = 100;

const badRequest = (message) => new ServiceError(400, message);

function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/** What the admin UI may see — never the secret itself. */
function toPublicView(raw) {
  const secret = raw.auth.secret;
  const fromEnv = secret.startsWith(ENV_PREFIX);
  return {
    id: raw.id,
    name: raw.name || raw.id,
    enabled: raw.enabled !== false,
    authType: raw.auth.type,
    allowedEvents: [...raw.allowedEvents],
    defaultTarget: raw.defaultTarget || null,
    secretSource: fromEnv ? 'env' : 'stored',
    secretHint: fromEnv ? secret : `••••${secret.slice(-4)}`,
  };
}

function normalizeTarget(target) {
  if (target === undefined || target === null) return null;
  if (!isPlainObject(target)) throw badRequest('defaultTarget must be an object');
  const { lineGroupId, lineUserId } = target;
  const id = lineGroupId || lineUserId;
  if (!id) return null;
  if (!isValidLineId(id)) throw badRequest('defaultTarget must be a LINE ID (U.../C... followed by 32 hex chars)');
  return lineGroupId ? { lineGroupId } : { lineUserId };
}

/** Applies editable fields from admin input onto a raw app object (returns a new object). */
function applyEditableFields(raw, input, knownEvents) {
  const next = { ...raw, auth: { ...raw.auth } };
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.length > NAME_MAX) throw badRequest(`name must be a string up to ${NAME_MAX} characters`);
    next.name = input.name.trim() || raw.id;
  }
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') throw badRequest('enabled must be true or false');
    next.enabled = input.enabled;
  }
  if (input.authType !== undefined) {
    if (!AUTH_TYPES.includes(input.authType)) throw badRequest(`authType must be one of ${AUTH_TYPES.join(', ')}`);
    next.auth.type = input.authType;
  }
  if (input.allowedEvents !== undefined) {
    const events = input.allowedEvents;
    if (!Array.isArray(events) || events.length === 0) throw badRequest('select at least one event');
    const unknown = events.filter((e) => !knownEvents.includes(e));
    if (unknown.length) throw badRequest(`unknown events: ${unknown.join(', ')}`);
    next.allowedEvents = [...new Set(events)];
  }
  if (input.defaultTarget !== undefined) {
    const target = normalizeTarget(input.defaultTarget);
    if (target) next.defaultTarget = target;
    else delete next.defaultTarget;
  }
  return next;
}

/**
 * Persistent, editable list of webhook apps backed by a JSON file.
 * Exposes `get(id)` so it can be used directly as the webhook service's app registry.
 */
function createAppStore({ filePath, knownEvents, env = process.env }) {
  let rawApps = readJsonArray(filePath);
  let registry = buildAppRegistry(rawApps, env);

  /** Validates the whole new list before touching the file, so a bad edit never corrupts it. */
  function commit(nextRawApps) {
    let nextRegistry;
    try {
      nextRegistry = buildAppRegistry(nextRawApps, env);
    } catch (err) {
      throw badRequest(err.message);
    }
    writeJsonAtomically(filePath, nextRawApps);
    rawApps = nextRawApps;
    registry = nextRegistry;
  }

  function findIndexOrThrow(id) {
    const index = rawApps.findIndex((app) => app.id === id);
    if (index === -1) throw new ServiceError(404, `app "${id}" not found`);
    return index;
  }

  function replaceAt(index, nextRaw) {
    commit(rawApps.map((app, i) => (i === index ? nextRaw : app)));
    return toPublicView(nextRaw);
  }

  return {
    get: (id) => registry.get(id),
    get size() {
      return registry.size;
    },

    list: () => rawApps.map(toPublicView),

    create(input = {}) {
      if (rawApps.some((app) => app.id === input.id)) throw new ServiceError(409, `app "${input.id}" already exists`);
      const secret = generateSecret();
      const base = { id: input.id, name: input.id, enabled: true, auth: { type: 'hmac', secret }, allowedEvents: [] };
      const raw = applyEditableFields(base, { allowedEvents: [], ...input }, knownEvents);
      commit([...rawApps, raw]);
      return { app: toPublicView(raw), secret };
    },

    update(id, input = {}) {
      const index = findIndexOrThrow(id);
      return replaceAt(index, applyEditableFields(rawApps[index], input, knownEvents));
    },

    rotateSecret(id) {
      const index = findIndexOrThrow(id);
      const secret = generateSecret();
      const raw = rawApps[index];
      return { app: replaceAt(index, { ...raw, auth: { ...raw.auth, secret } }), secret };
    },

    remove(id) {
      const index = findIndexOrThrow(id);
      commit(rawApps.filter((_, i) => i !== index));
    },
  };
}

module.exports = { createAppStore };
