const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildAppRegistry, loadAppRegistry } = require('../src/config/appRegistry');

const SECRET = 'x'.repeat(20);
const validApp = (overrides = {}) => ({
  id: 'ehp-cis',
  auth: { type: 'hmac', secret: SECRET },
  allowedEvents: ['notification.text'],
  ...overrides,
});

test('builds a registry keyed by app id with defaults applied', () => {
  const registry = buildAppRegistry([validApp()]);

  const app = registry.get('ehp-cis');
  assert.equal(app.name, 'ehp-cis');
  assert.equal(app.enabled, true);
  assert.equal(app.defaultTarget, null);
  assert.ok(Object.isFrozen(app));
});

test('resolves "env:" secrets from the environment', () => {
  const registry = buildAppRegistry(
    [validApp({ auth: { type: 'apiKey', secret: 'env:LAB_KEY' } })],
    { LAB_KEY: SECRET }
  );

  assert.equal(registry.get('ehp-cis').auth.secret, SECRET);
});

test('rejects an "env:" secret whose variable is not set', () => {
  assert.throws(
    () => buildAppRegistry([validApp({ auth: { type: 'hmac', secret: 'env:MISSING' } })], {}),
    /env variable is not set/
  );
});

test('rejects invalid ids, auth types, short secrets, empty events and duplicates', () => {
  assert.throws(() => buildAppRegistry([validApp({ id: 'Bad Id' })]), /Invalid app id/);
  assert.throws(() => buildAppRegistry([validApp({ auth: { type: 'basic', secret: SECRET } })]), /auth.type/);
  assert.throws(() => buildAppRegistry([validApp({ auth: { type: 'hmac', secret: 'short' } })]), /at least 16/);
  assert.throws(() => buildAppRegistry([validApp({ allowedEvents: [] })]), /allowedEvents/);
  assert.throws(() => buildAppRegistry([validApp(), validApp()]), /Duplicate app id/);
  assert.throws(() => buildAppRegistry({}), /JSON array/);
});

test('loadAppRegistry returns an empty registry when the file does not exist', () => {
  const registry = loadAppRegistry(path.join(os.tmpdir(), 'does-not-exist-apps.json'));

  assert.equal(registry.size, 0);
});

test('loadAppRegistry reads and validates a JSON file', (t) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apps-')), 'apps.json');
  fs.writeFileSync(file, JSON.stringify([validApp()]));
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));

  assert.deepEqual([...loadAppRegistry(file).keys()], ['ehp-cis']);
});

test('the shipped apps.example.json is a valid config', () => {
  const example = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps.example.json'), 'utf8'));
  const env = { EHP_CIS_WEBHOOK_SECRET: SECRET, LAB_WEBHOOK_API_KEY: SECRET };

  assert.doesNotThrow(() => buildAppRegistry(example, env));
});
