const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createForwardTargetStore } = require('../src/services/forwardTargetStore');
const { ServiceError } = require('../src/services/errors');

const CIS_URL = 'https://new-cis.bmscloud.in.th/api/line-oa/webhook/42557';

function tempFile(t, initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forwards-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'line-forwards.json');
  if (initial) fs.writeFileSync(file, JSON.stringify(initial));
  return file;
}

function assertServiceError(fn, status, pattern) {
  assert.throws(fn, (err) => err instanceof ServiceError && err.status === status && pattern.test(err.message));
}

test('starts empty and creates an enabled target with a generated id', (t) => {
  const filePath = tempFile(t);
  const store = createForwardTargetStore({ filePath });

  const target = store.create({ name: ' EHP CIS ', url: CIS_URL });

  assert.match(target.id, /^[0-9a-f]{8}$/);
  assert.equal(target.name, 'EHP CIS');
  assert.equal(target.enabled, true);
  assert.deepEqual(store.list(), [target]);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), [target]);
});

test('validates name and url, and rejects duplicate URLs', (t) => {
  const store = createForwardTargetStore({ filePath: tempFile(t) });
  store.create({ name: 'CIS', url: CIS_URL });

  assertServiceError(() => store.create({ url: CIS_URL }), 400, /name is required/);
  assertServiceError(() => store.create({ name: 'x' }), 400, /url is required/);
  assertServiceError(() => store.create({ name: 'x', url: 'not a url' }), 400, /not a valid URL/);
  assertServiceError(() => store.create({ name: 'x', url: 'ftp://host/x' }), 400, /https:\/\//);
  assertServiceError(() => store.create({ name: 'Copy', url: CIS_URL }), 409, /already/);
});

test('enabled() excludes disabled targets; update edits fields', (t) => {
  const store = createForwardTargetStore({ filePath: tempFile(t) });
  const cis = store.create({ name: 'CIS', url: CIS_URL });
  const vet = store.create({ name: 'Vetcare', url: 'https://vet.example/webhook' });

  const updated = store.update(cis.id, { enabled: false, name: 'EHP CIS' });

  assert.equal(updated.name, 'EHP CIS');
  assert.deepEqual(store.enabled().map((x) => x.id), [vet.id]);
  assertServiceError(() => store.update(cis.id, { enabled: 'no' }), 400, /enabled/);
  assertServiceError(() => store.update(vet.id, { url: CIS_URL }), 409, /already/);
  assertServiceError(() => store.update('missing', {}), 404, /not found/);
});

test('remove deletes and find throws 404 afterwards', (t) => {
  const store = createForwardTargetStore({ filePath: tempFile(t) });
  const cis = store.create({ name: 'CIS', url: CIS_URL });

  store.remove(cis.id);

  assert.deepEqual(store.list(), []);
  assertServiceError(() => store.find(cis.id), 404, /not found/);
});

test('loads and validates targets saved in the file', (t) => {
  const filePath = tempFile(t, [{ id: 'abc12345', name: 'CIS', url: CIS_URL, enabled: false }]);

  const store = createForwardTargetStore({ filePath });

  assert.deepEqual(store.list(), [{ id: 'abc12345', name: 'CIS', url: CIS_URL, enabled: false }]);
  assert.throws(() => createForwardTargetStore({ filePath: tempFile(t, [{ id: 'x', name: 'bad', url: 'nope' }]) }), /not a valid URL/);
});
