const { authenticateRequest } = require('./webhookAuth');
const { resolveRecipient } = require('./recipientResolver');
const { describeLineError } = require('./lineClient');
const { isPlainObject, isNonEmptyString } = require('../utils/validation');

const EVENT_ID_MAX = 128;

const respond = (status, body) => ({ status, body });
const reject = (status, error, details) => respond(status, details ? { error, details } : { error });

function validateEnvelope(body) {
  if (!isPlainObject(body)) return ['body must be a JSON object'];
  const errors = [];
  if (!isNonEmptyString(body.event)) errors.push('event is required');
  if (!isNonEmptyString(body.eventId) || body.eventId.length > EVENT_ID_MAX) {
    errors.push(`eventId is required (max ${EVENT_ID_MAX} characters)`);
  }
  if (!isPlainObject(body.data)) errors.push('data must be an object');
  return errors;
}

/**
 * Receives webhooks from registered applications and forwards them to LINE.
 * Pipeline: app lookup → auth → envelope → permission → event validation → recipient → dedupe → push.
 */
function createWebhookService({ apps, eventRegistry, lineClient, idempotencyStore, logger = console, now = Date.now }) {
  /** Runs every check that does not have side effects. Returns either a rejection or a delivery plan. */
  function prepare({ appId, headers, rawBody, body }) {
    const app = apps.get(appId);
    if (!app || !app.enabled) return { rejection: reject(404, 'unknown_app') };

    const auth = authenticateRequest(app, { headers, rawBody, nowMs: now() });
    if (!auth.ok) return { rejection: reject(401, auth.reason) };

    const envelopeErrors = validateEnvelope(body);
    if (envelopeErrors.length) return { rejection: reject(400, 'invalid_payload', envelopeErrors) };

    const { event, eventId, data, to } = body;
    if (!app.allowedEvents.includes(event)) return { rejection: reject(403, 'event_not_allowed') };

    const handler = eventRegistry.get(event);
    if (!handler) return { rejection: reject(400, 'unsupported_event') };

    const dataErrors = handler.validate(data);
    if (dataErrors.length) return { rejection: reject(400, 'invalid_payload', dataErrors) };

    const recipient = resolveRecipient(to, app.defaultTarget);
    if (!recipient.ok) return { rejection: reject(400, recipient.reason) };

    return { plan: { app, event, eventId, recipient: recipient.to, messages: handler.buildMessages(data) } };
  }

  async function deliver({ app, event, eventId, recipient, messages }) {
    const key = `${app.id}:${eventId}`;
    const tag = `app=${app.id} event=${event} eventId=${eventId}`;
    if (!idempotencyStore.reserve(key)) return respond(200, { status: 'duplicate', eventId });

    try {
      await lineClient.push(recipient, messages);
      logger.info(`[APP-WEBHOOK] sent ${tag}`);
      return respond(200, { status: 'sent', eventId });
    } catch (err) {
      idempotencyStore.release(key);
      logger.error(`[APP-WEBHOOK] push failed ${tag}: ${describeLineError(err)}`);
      return reject(502, 'line_push_failed');
    }
  }

  async function handle(request) {
    const { rejection, plan } = prepare(request);
    return rejection || deliver(plan);
  }

  return { handle };
}

module.exports = { createWebhookService };
