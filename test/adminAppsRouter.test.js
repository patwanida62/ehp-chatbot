const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { rawJsonBody } = require('../src/middleware/rawJsonBody');
const { createAdminAppsRouter } = require('../src/routes/adminAppsRouter');
const { createAppStore } = require('../src/services/appStore');
const { createAppTester } = require('../src/services/appTester');
const h = require('./helpers');

const ADMIN_TOKEN = 'admin-token-for-tests-123';
const KNOWN_EVENTS = ['appointment.created', 'notification.text'];

async function startAdmin(t, { adminToken = ADMIN_TOKEN } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const appStore = createAppStore({ filePath: path.join(dir, 'apps.json'), knownEvents: KNOWN_EVENTS, env: {} });
  const lineClient = h.createFakeLineClient();

  const app = express();
  app.use(rawJsonBody());
  app.use(createAdminAppsRouter({
    appStore,
    appTester: createAppTester({ appStore, lineClient }),
    knownEvents: KNOWN_EVENTS,
    adminToken,
    logger: h.silentLogger,
  }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, route, body, token = ADMIN_TOKEN) => {
    const res = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  return { baseUrl, call, lineClient, appStore };
}

test('admin page is served without a token', async (t) => {
  const { baseUrl } = await startAdmin(t);

  const res = await fetch(`${baseUrl}/admin/webhooks`);

  assert.equal(res.status, 200);
  assert.match(await res.text(), /Webhook Apps/);
});

test('admin API is disabled (503) when no ADMIN_TOKEN is configured', async (t) => {
  const { call } = await startAdmin(t, { adminToken: '' });

  const res = await call('GET', '/admin/api/apps', undefined, 'anything');

  assert.deepEqual(res, { status: 503, body: { error: 'admin_disabled' } });
});

test('admin API rejects missing or wrong tokens with 401', async (t) => {
  const { call } = await startAdmin(t);

  assert.equal((await call('GET', '/admin/api/apps', undefined, null)).status, 401);
  assert.equal((await call('GET', '/admin/api/apps', undefined, 'wrong')).status, 401);
});

test('GET /admin/api/events lists the available events', async (t) => {
  const { call } = await startAdmin(t);

  assert.deepEqual((await call('GET', '/admin/api/events')).body, KNOWN_EVENTS);
});

test('full lifecycle: create → list → update → rotate → delete', async (t) => {
  const { call, appStore } = await startAdmin(t);

  const created = await call('POST', '/admin/api/apps', { id: 'ehp-vetcare', name: 'EHP Vetcare', allowedEvents: ['notification.text'] });
  assert.equal(created.status, 201);
  assert.match(created.body.secret, /^[0-9a-f]{64}$/);

  const listed = await call('GET', '/admin/api/apps');
  assert.deepEqual(listed.body.map((a) => a.id), ['ehp-vetcare']);
  assert.ok(!JSON.stringify(listed.body).includes(created.body.secret));

  const updated = await call('PUT', '/admin/api/apps/ehp-vetcare', { enabled: false });
  assert.equal(updated.body.enabled, false);

  const rotated = await call('POST', '/admin/api/apps/ehp-vetcare/rotate-secret');
  assert.notEqual(rotated.body.secret, created.body.secret);
  assert.equal(appStore.get('ehp-vetcare').auth.secret, rotated.body.secret);

  const deleted = await call('DELETE', '/admin/api/apps/ehp-vetcare');
  assert.deepEqual(deleted.body, { deleted: 'ehp-vetcare' });
  assert.deepEqual((await call('GET', '/admin/api/apps')).body, []);
});

test('validation errors come back as 400/404/409 with a message', async (t) => {
  const { call } = await startAdmin(t);
  await call('POST', '/admin/api/apps', { id: 'ehp-spa', allowedEvents: ['notification.text'] });

  const invalid = await call('POST', '/admin/api/apps', { id: 'ehp-x', allowedEvents: [] });
  const duplicate = await call('POST', '/admin/api/apps', { id: 'ehp-spa', allowedEvents: ['notification.text'] });
  const missing = await call('PUT', '/admin/api/apps/nope', { name: 'x' });

  assert.deepEqual(invalid, { status: 400, body: { error: 'select at least one event' } });
  assert.equal(duplicate.status, 409);
  assert.equal(missing.status, 404);
});

test('test-send pushes a connection message to the given recipient', async (t) => {
  const { call, lineClient } = await startAdmin(t);
  await call('POST', '/admin/api/apps', { id: 'ehp-cis', name: 'EHP CIS', allowedEvents: ['notification.text'] });

  const res = await call('POST', '/admin/api/apps/ehp-cis/test', { lineUserId: h.USER_ID });

  assert.deepEqual(res, { status: 200, body: { sentTo: h.USER_ID } });
  assert.match(lineClient.pushes[0].messages[0].text, /ทดสอบการเชื่อมต่อจาก EHP CIS/);
});

test('test-send falls back to the default target, and reports missing recipients and LINE failures', async (t) => {
  const { call, lineClient } = await startAdmin(t);
  await call('POST', '/admin/api/apps', { id: 'with-group', allowedEvents: ['notification.text'], defaultTarget: { lineGroupId: h.GROUP_ID } });
  await call('POST', '/admin/api/apps', { id: 'no-target', allowedEvents: ['notification.text'] });

  const fallback = await call('POST', '/admin/api/apps/with-group/test', {});
  const missing = await call('POST', '/admin/api/apps/no-target/test', {});
  lineClient.failWith = Object.assign(new Error('x'), { response: { status: 401, data: { message: 'bad token' } } });
  const lineDown = await call('POST', '/admin/api/apps/with-group/test', {});
  const unknown = await call('POST', '/admin/api/apps/ghost/test', {});

  assert.equal(fallback.body.sentTo, h.GROUP_ID);
  assert.deepEqual(missing, { status: 400, body: { error: 'missing_recipient' } });
  assert.equal(lineDown.status, 502);
  assert.match(lineDown.body.error, /HTTP 401 bad token/);
  assert.equal(unknown.status, 404);
});
