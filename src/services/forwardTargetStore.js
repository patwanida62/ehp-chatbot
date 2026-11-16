const crypto = require('crypto');
const { ServiceError } = require('./errors');
const { readJsonArray, writeJsonAtomically } = require('../utils/jsonFile');

const NAME_MAX = 100;
const URL_MAX = 500;
const ALLOWED_PROTOCOLS = Object.freeze(['https:', 'http:']);

const badRequest = (message) => new ServiceError(400, message);

function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) throw badRequest('name is required');
  if (name.length > NAME_MAX) throw badRequest(`name must be at most ${NAME_MAX} characters`);
  return name.trim();
}

function validateUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw badRequest('url is required');
  if (value.length > URL_MAX) throw badRequest(`url must be at most ${URL_MAX} characters`);
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw badRequest('url is not a valid URL');
  }
  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) throw badRequest('url must start with https:// or http://');
  return url.toString();
}

function validateBoolean(field, value) {
  if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false`);
  return value;
}

/** Builds a validated target from a base plus the editable fields present in `input`. */
function buildTarget(base, input) {
  const pick = (field, validate) => (input[field] !== undefined ? validate(input[field]) : base[field]);
  return Object.freeze({
    id: base.id,
    name: pick('name', validateName),
    url: pick('url', validateUrl),
    enabled: pick('enabled', (v) => validateBoolean('enabled', v)),
    // false = chat messages (text, sticker, image...) are withheld, so this system cannot auto-reply to chat
    receiveMessages: pick('receiveMessages', (v) => validateBoolean('receiveMessages', v)),
  });
}

const DEFAULTS = Object.freeze({ enabled: true, receiveMessages: true });

/**
 * Downstream webhook URLs (e.g. EHP CIS, EHP Vetcare) that every LINE event is copied to,
 * so several systems can share one LINE OA. Persisted as a JSON array.
 */
function createForwardTargetStore({ filePath }) {
  let targets = readJsonArray(filePath).map((raw) => buildTarget({ ...DEFAULTS, id: raw.id }, raw));

  function save(next) {
    writeJsonAtomically(filePath, next);
    targets = next;
  }

  function assertUniqueUrl(url, exceptId) {
    if (targets.some((t) => t.url === url && t.id !== exceptId)) {
      throw new ServiceError(409, 'this URL is already in the forwarding list');
    }
  }

  function findIndexOrThrow(id) {
    const index = targets.findIndex((t) => t.id === id);
    if (index === -1) throw new ServiceError(404, `forward target "${id}" not found`);
    return index;
  }

  return {
    list: () => [...targets],
    enabled: () => targets.filter((t) => t.enabled),
    find: (id) => targets[findIndexOrThrow(id)],

    create(input = {}) {
      const target = buildTarget({ ...DEFAULTS, id: crypto.randomUUID().slice(0, 8) }, {
        name: input.name ?? '',
        url: input.url ?? '',
        enabled: input.enabled,
        receiveMessages: input.receiveMessages,
      });
      assertUniqueUrl(target.url);
      save([...targets, target]);
      return target;
    },

    update(id, input = {}) {
      const index = findIndexOrThrow(id);
      const target = buildTarget(targets[index], input);
      assertUniqueUrl(target.url, id);
      save(targets.map((t, i) => (i === index ? target : t)));
      return target;
    },

    remove(id) {
      const index = findIndexOrThrow(id);
      save(targets.filter((_, i) => i !== index));
    },
  };
}

module.exports = { createForwardTargetStore };
