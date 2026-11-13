const { requireString, isPlainObject, isNonEmptyString } = require('../../utils/validation');

const LINE_TEXT_MAX = 5000;
const LINE_MESSAGES_MAX = 5;

/** notification.text — plain text for apps that just want to announce something. */
const textNotification = Object.freeze({
  validate(data) {
    const errors = [];
    requireString(data, 'text', errors, LINE_TEXT_MAX);
    return errors;
  },
  buildMessages: (data) => [{ type: 'text', text: data.text }],
});

/** message.push — raw LINE message objects (Flex, image, sticker...) built by the sending app. */
const rawMessagePush = Object.freeze({
  validate(data) {
    const { messages } = data;
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > LINE_MESSAGES_MAX) {
      return [`messages must be an array of 1-${LINE_MESSAGES_MAX} LINE message objects`];
    }
    const invalid = messages.some((m) => !isPlainObject(m) || !isNonEmptyString(m.type));
    return invalid ? ['every message needs a "type"'] : [];
  },
  buildMessages: (data) => data.messages,
});

module.exports = {
  'notification.text': textNotification,
  'message.push': rawMessagePush,
};
