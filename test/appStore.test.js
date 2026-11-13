const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAppStore, AppStoreError } = require('../src/services/appStore');
const { GROUP_ID, USER_ID } = require('./helpers');

const KNOWN_EVENTS = ['appointment.created', 'notification.text'];

function tempFile(t, initialApps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'apps.json');
  if (initialApps) fs.writeFileSync(file, JSON.stringify(initialApps));
  return file;
}

const readFile = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function newStore(t, initialApps, env = {}) {
  const filePath = tempFile(t, initialApps);
  return { filePath, store: createAppStore({ filePath, knownEvents: KNOWN_EVENTS, env }) };
}

function assertStoreError(fn, status, pattern) {
  assert.throws(fn, (err) => err instanceof AppStoreError && err.status === status && pattern.test(err.message));
}

test('starts empty when the file does not exist', (t) => {
  const { store } = newStore(t);

  assert.deepEqual(store.list(), []);
  assert.equal(store.size, 0);
});

test('create generates a secret, saves the file and makes the app usable immediately', (t) => {
  const { store, filePath } = newStore(t);

  const { app, secret } = store.create({ id: 'ehp-cis', name: 'EHP CIS', allowedEvents: ['appointment.created'] });

  assert.match(secret, /^[0-9a-f]{64}$/);
  assert.equal(app.authType, 'hmac');
  assert.equal(app.enabled, true);
  assert.equal(app.secretHint, `••••${secret.slice(-4)}`);
  assert.equal(store.get('ehp-cis').auth.secret, secret);
  assert.equal(readFile(filePath)[0].auth.secret, secret);
});

test('list never exposes secrets', (t) => {
  const { store } = newStore(t);
  const { secret } = store.create({ id: 'ehp-cis', allowedEvents: ['notification.text'] });

  const listed = JSON.stringify(store.list());

  assert.ok(!listed.includes(secret));
});

test('create validates id, events, target and duplicates', (t) => {
  const { store, filePath } = newStore(t);
  store.create({ id: 'ehp-cis', allowedEvents: ['notification.text'] });

  assertStoreError(() => store.create({ id: 'Bad Id', allowedEvents: ['notification.text'] }), 400, /Invalid app id/);
  assertStoreError(() => store.create({ id: 'spa' }), 400, /at least one event/);
  assertStoreError(() => store.create({ id: 'spa', allowedEvents: ['nope'] }), 400, /unknown events: nope/);
  assertStoreError(() => store.create({ id: 'spa', allowedEvents: ['notification.text'], defaultTarget: { lineUserId: 'U1' } }), 400, /LINE ID/);
  assertStoreError(() => store.create({ id: 'spa', allowedEvents: ['notification.text'], authType: 'basic' }), 400, /authType/);
  assertStoreError(() => store.create({ id: 'ehp-cis', allowedEvents: ['notification.text'] }), 409, /already exists/);
  assert.equal(readFile(filePath).length, 1, 'failed creates leave the file untouched');
});

test('update changes editable fields but keeps the secret', (t) => {
  const { store } = newStore(t);
  const { secret } = store.create({ id: 'ehp-spa', allowedEvents: ['notification.text'] });

  const updated = store.update('ehp-spa', {
    name: 'EHP Spa',
    enabled: false,
    authType: 'apiKey',
    allowedEvents: ['notification.text', 'appointment.created', 'notification.text'],
    defaultTarget: { lineGroupId: GROUP_ID },
  });

  assert.equal(updated.name, 'EHP Spa');
  assert.equal(updated.enabled, false);
  assert.equal(updated.authType, 'apiKey');
  assert.deepEqual(updated.allowedEvents, ['notification.text', 'appointment.created'], 'duplicates removed');
  assert.deepEqual(updated.defaultTarget, { lineGroupId: GROUP_ID });
  assert.equal(store.get('ehp-spa').auth.secret, secret);
  assert.equal(store.get('ehp-spa').enabled, false);
});

test('update can clear the default target and rejects unknown apps', (t) => {
  const { store } = newStore(t);
  store.create({ id: 'ehp-spa', allowedEvents: ['notification.text'], defaultTarget: { lineUserId: USER_ID } });

  const cleared = store.update('ehp-spa', { defaultTarget: null });

  assert.equal(cleared.defaultTarget, null);
  assertStoreError(() => store.update('missing', { name: 'x' }), 404, /not found/);
  assertStoreError(() => store.update('ehp-spa', { enabled: 'yes' }), 400, /enabled/);
});

test('rotateSecret replaces the secret', (t) => {
  const { store } = newStore(t);
  const { secret: oldSecret } = store.create({ id: 'ehp-cis', allowedEvents: ['notification.text'] });

  const { secret } = store.rotateSecret('ehp-cis');

  assert.notEqual(secret, oldSecret);
  assert.equal(store.get('ehp-cis').auth.secret, secret);
});

test('remove deletes the app from memory and file', (t) => {
  const { store, filePath } = newStore(t);
  store.create({ id: 'ehp-cis', allowedEvents: ['notification.text'] });

  store.remove('ehp-cis');

  assert.equal(store.get('ehp-cis'), undefined);
  assert.deepEqual(readFile(filePath), []);
  assertStoreError(() => store.remove('ehp-cis'), 404, /not found/);
});

test('apps using "env:" secrets are loaded, shown by variable name, and keep that reference on update', (t) => {
  const initial = [{ id: 'ehp-cis', auth: { type: 'hmac', secret: 'env:CIS_SECRET' }, allowedEvents: ['notification.text'] }];
  const { store, filePath } = newStore(t, initial, { CIS_SECRET: 's'.repeat(32) });

  const [view] = store.list();
  store.update('ehp-cis', { name: 'EHP CIS' });

  assert.equal(view.secretSource, 'env');
  assert.equal(view.secretHint, 'env:CIS_SECRET');
  assert.equal(store.get('ehp-cis').auth.secret, 's'.repeat(32));
  assert.equal(readFile(filePath)[0].auth.secret, 'env:CIS_SECRET');
});

test('an invalid existing file fails fast at startup', (t) => {
  const filePath = tempFile(t, [{ id: 'x' }]);

  assert.throws(() => createAppStore({ filePath, knownEvents: KNOWN_EVENTS, env: {} }), /Invalid app id/);
});
