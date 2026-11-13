const test = require('node:test');
const assert = require('node:assert/strict');
const { createEventRegistry } = require('../src/services/events/eventRegistry');

const registry = createEventRegistry();
const appointmentData = {
  appointmentId: 'APT-0001',
  datetime: '2026-11-20T09:30:00+07:00',
  clinic: 'คลินิกเบาหวาน',
  note: 'งดน้ำงดอาหารหลังเที่ยงคืน',
};

function collectTexts(node, out = []) {
  if (node && typeof node === 'object') {
    if (node.type === 'text') out.push(node.text);
    Object.values(node).forEach((child) => collectTexts(child, out));
  }
  return out;
}

test('registry exposes all built-in events and accepts extra handlers', () => {
  const extra = { 'custom.event': { validate: () => [], buildMessages: () => [] } };

  const names = [...createEventRegistry(extra).keys()];

  assert.deepEqual(names.sort(), [
    'appointment.cancelled',
    'appointment.created',
    'appointment.updated',
    'custom.event',
    'message.push',
    'notification.text',
  ]);
});

test('appointment.created builds a Flex bubble with Bangkok-time date and all provided fields', () => {
  const [message] = registry.get('appointment.created').buildMessages(appointmentData);

  const texts = collectTexts(message.contents);
  assert.equal(message.type, 'flex');
  assert.match(message.altText, /^ยืนยันการนัดหมาย: /);
  assert.ok(texts.includes('คลินิกเบาหวาน'));
  assert.ok(texts.includes('งดน้ำงดอาหารหลังเที่ยงคืน'));
  assert.ok(texts.includes('APT-0001'));
  assert.ok(texts.some((t) => t.includes('20') && t.includes('09:30')), 'date shown in Asia/Bangkok');
  assert.ok(!texts.includes('แพทย์'), 'omitted optional fields produce no row');
});

test('appointment.cancelled uses its own title', () => {
  const [message] = registry.get('appointment.cancelled').buildMessages(appointmentData);

  assert.match(message.altText, /^ยกเลิกการนัดหมาย/);
});

test('appointment validation reports missing and invalid fields', () => {
  const validate = registry.get('appointment.created').validate;

  assert.deepEqual(validate(appointmentData), []);
  assert.deepEqual(validate({}), [
    'appointmentId is required',
    'clinic is required',
    'datetime must be an ISO 8601 date-time',
  ]);
  assert.deepEqual(validate({ ...appointmentData, doctor: 123 }), ['doctor is required']);
});

test('notification.text validates and wraps text', () => {
  const handler = registry.get('notification.text');

  assert.deepEqual(handler.validate({ text: 'สวัสดี' }), []);
  assert.deepEqual(handler.validate({ text: '' }), ['text is required']);
  assert.deepEqual(handler.validate({ text: 'x'.repeat(5001) }), ['text must be at most 5000 characters']);
  assert.deepEqual(handler.buildMessages({ text: 'สวัสดี' }), [{ type: 'text', text: 'สวัสดี' }]);
});

test('message.push passes through 1-5 typed LINE messages', () => {
  const handler = registry.get('message.push');
  const messages = [{ type: 'sticker', packageId: '446', stickerId: '1988' }];

  assert.deepEqual(handler.validate({ messages }), []);
  assert.deepEqual(handler.buildMessages({ messages }), messages);
  assert.equal(handler.validate({ messages: [] }).length, 1);
  assert.equal(handler.validate({ messages: Array(6).fill(messages[0]) }).length, 1);
  assert.deepEqual(handler.validate({ messages: [{}] }), ['every message needs a "type"']);
});
