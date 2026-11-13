const appointmentEvents = require('./appointmentEvents');
const notificationEvents = require('./notificationEvents');

/**
 * Map of event name → { validate(data): string[], buildMessages(data): LineMessage[] }.
 * To support a new event type, add a handler module and spread it in here.
 */
function createEventRegistry(extraHandlers = {}) {
  return new Map(Object.entries({ ...appointmentEvents, ...notificationEvents, ...extraHandlers }));
}

module.exports = { createEventRegistry };
