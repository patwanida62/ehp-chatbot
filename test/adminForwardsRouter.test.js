const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { rawJsonBody } = require('../src/middleware/rawJsonBody');
const { createAdminForwardsRouter } = require('../src/routes/adminForwardsRouter');
const { createForwardTargetStore } = require('../src/services/forwardTargetStore');
const { createLineEventForwarder } = require('../src/services/lineEventForwarder');
const { silentLogger } = require('./helpers');

const ADMIN_TOKEN = 'admin-token-for-forward-tests';

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

async function startAdmin(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fwd-admin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const targetStore = createForwardTargetStore({ filePath: path.join(dir, 'line-forwards.json') });
  const forwarder = createLineEventForwarder({ targetStore, channelSecret: 'secret-x', logger: silentLogger });

  const app = express();
  app.use(rawJsonBody());
  app.use(createAdminForwardsRouter({ targetStore, forwarder, adminToken: ADMIN_TOKEN, logger: silentLogger }));
  const baseUrl = await listen(t, app);

  return async (method, route, body, token = ADMIN_TOKEN) => {
    const res = await fetch(`${baseUrl}/admin/api/line-forwards${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
}

test('requires the admin token', async (t) => {
  const call = await startAdmin(t);

  assert.equal((await call('GET', '', undefined, null)).status, 401);
});

test('create → list → update → test → delete', async (t) => {
  const call = await startAdmin(t);
  const downstreamUrl = await listen(t, (_req, res) => res.writeHead(200).end());

  const created = await call('POST', '', { name: 'EHP CIS', url: `${downstreamUrl}/hook` });
  assert.equal(created.status, 201);
  const { id } = created.body;

  const listed = await call('GET', '');
  assert.deepEqual(listed.body, [{ id, name: 'EHP CIS', url: `${downstreamUrl}/hook`, enabled: true, lastResult: null }]);

  const updated = await call('PUT', `/${id}`, { enabled: false });
  assert.equal(updated.body.enabled, false);

  const tested = await call('POST', `/${id}/test`);
  assert.equal(tested.body.ok, true);
  assert.equal(tested.body.status, 200);
  assert.equal((await call('GET', '')).body[0].lastResult.status, 200);

  assert.deepEqual((await call('DELETE', `/${id}`)).body, { deleted: id });
  assert.deepEqual((await call('GET', '')).body, []);
});

test('returns validation and not-found errors', async (t) => {
  const call = await startAdmin(t);

  assert.deepEqual(await call('POST', '', { name: 'x', url: 'nope' }), { status: 400, body: { error: 'url is not a valid URL' } });
  assert.equal((await call('POST', '/missing/test')).status, 404);
  assert.equal((await call('DELETE', '/missing')).status, 404);
});
