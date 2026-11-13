const fs = require('fs');

const APP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
const AUTH_TYPES = Object.freeze(['hmac', 'apiKey']);
const ENV_PREFIX = 'env:';
const MIN_SECRET_LENGTH = 16;

/** Secrets may be written inline or as "env:VAR_NAME" so they never live in the config file. */
function resolveSecret(value, env) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (!value.startsWith(ENV_PREFIX)) return value;
  return env[value.slice(ENV_PREFIX.length)] || null;
}

function normalizeAuth(id, auth, env) {
  if (!auth || !AUTH_TYPES.includes(auth.type)) {
    throw new Error(`App "${id}": auth.type must be one of ${AUTH_TYPES.join(', ')}`);
  }
  const secret = resolveSecret(auth.secret, env);
  if (!secret) {
    throw new Error(`App "${id}": auth.secret is missing or its env variable is not set`);
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`App "${id}": auth.secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return Object.freeze({ type: auth.type, secret });
}

function normalizeAllowedEvents(id, allowedEvents) {
  if (!Array.isArray(allowedEvents) || allowedEvents.length === 0) {
    throw new Error(`App "${id}": allowedEvents must be a non-empty array`);
  }
  return Object.freeze([...allowedEvents]);
}

function normalizeApp(raw, env) {
  const id = raw && raw.id;
  if (typeof id !== 'string' || !APP_ID_PATTERN.test(id)) {
    throw new Error(`Invalid app id: ${JSON.stringify(id)} (use lowercase letters, digits, "-")`);
  }
  return Object.freeze({
    id,
    name: raw.name || id,
    enabled: raw.enabled !== false,
    auth: normalizeAuth(id, raw.auth, env),
    allowedEvents: normalizeAllowedEvents(id, raw.allowedEvents),
    defaultTarget: raw.defaultTarget ? Object.freeze({ ...raw.defaultTarget }) : null,
  });
}

/** Validates the raw app list and returns a Map of appId → app config. Throws on any invalid entry. */
function buildAppRegistry(rawApps, env = process.env) {
  if (!Array.isArray(rawApps)) throw new Error('Apps config must be a JSON array');
  const registry = new Map();
  for (const raw of rawApps) {
    const app = normalizeApp(raw, env);
    if (registry.has(app.id)) throw new Error(`Duplicate app id: ${app.id}`);
    registry.set(app.id, app);
  }
  return registry;
}

/** Loads apps from a JSON file. A missing file means no apps are registered. */
function loadAppRegistry(filePath, env = process.env) {
  if (!fs.existsSync(filePath)) return new Map();
  const rawApps = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return buildAppRegistry(rawApps, env);
}

module.exports = { buildAppRegistry, loadAppRegistry };
