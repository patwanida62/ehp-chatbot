const path = require('path');
const express = require('express');
const { requireAdminToken } = require('../middleware/requireAdminToken');
const { jsonHandler } = require('./jsonHandler');

const ADMIN_PAGE = path.join(__dirname, '..', '..', 'public', 'webhook-admin.html');

/**
 * Admin UI page (GET /admin/webhooks) + JSON API under /admin/api for managing webhook apps.
 * Thin layer: rules live in appStore / appTester.
 */
function createAdminAppsRouter({ appStore, appTester, knownEvents, adminToken, logger = console }) {
  const router = express.Router();
  const api = express.Router();
  const handle = (fn) => jsonHandler(fn, logger);

  router.get('/admin/webhooks', (_req, res) => res.sendFile(ADMIN_PAGE));

  api.use(requireAdminToken(adminToken));
  api.get('/events', handle(async () => ({ body: knownEvents })));
  api.get('/apps', handle(async () => ({ body: appStore.list() })));
  api.post('/apps', handle(async (req) => ({ status: 201, body: appStore.create(req.body) })));
  api.put('/apps/:id', handle(async (req) => ({ body: appStore.update(req.params.id, req.body) })));
  api.post('/apps/:id/rotate-secret', handle(async (req) => ({ body: appStore.rotateSecret(req.params.id) })));
  api.post('/apps/:id/test', handle(async (req) => ({ body: await appTester.sendTestMessage(req.params.id, req.body) })));
  api.delete('/apps/:id', handle(async (req) => {
    appStore.remove(req.params.id);
    return { body: { deleted: req.params.id } };
  }));

  router.use('/admin/api', api);
  return router;
}

module.exports = { createAdminAppsRouter };
