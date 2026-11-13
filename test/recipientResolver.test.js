const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRecipient } = require('../src/services/recipientResolver');
const { USER_ID, GROUP_ID } = require('./helpers');

test('prefers a group over a user in the request', () => {
  assert.deepEqual(resolveRecipient({ lineUserId: USER_ID, lineGroupId: GROUP_ID }, null), { ok: true, to: GROUP_ID });
});

test('the request target wins over the app default', () => {
  assert.equal(resolveRecipient({ lineUserId: USER_ID }, { lineGroupId: GROUP_ID }).to, USER_ID);
});

test('falls back to the app default target', () => {
  assert.equal(resolveRecipient(undefined, { lineGroupId: GROUP_ID }).to, GROUP_ID);
});

test('fails when no target exists or the ID is malformed', () => {
  assert.equal(resolveRecipient(undefined, null).reason, 'missing_recipient');
  assert.equal(resolveRecipient({}, null).reason, 'missing_recipient');
  assert.equal(resolveRecipient({ lineUserId: 'U123' }, null).reason, 'invalid_recipient');
});
