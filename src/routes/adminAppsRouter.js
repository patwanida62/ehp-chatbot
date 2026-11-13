const path = require('path');
const express = require('express');
const { requireAdminToken } = require('../middleware/requireAdminToken');
const { AppStoreError } = require('../services/appStore');

const ADMIN_PAGE = path.join(__dirname, '..', '..', 'public', 'webhook-admin.html');

/** Wraps a handler so AppStoreErrors become their HTTP status and anything else becomes 500. */
function handle(fn, logger) {
  return async (req, res) => {
    try {
      const { status = 200, body } = await fn(req);
      res.status(status).json(body);
    } catch (err) {
      if (err instanceof AppStoreError) return res.status(err.status).json({ error: err.message });
      logger.error(`[ADMIN] unexpected error: ${err.message}`);
      return res.status(500).json({ error: 'internal_error' });
    }
  };
}

/**
 * Admin UI page (GET /admin/webhooks) + JSON API under /admin/api for managing webhook apps.
 * Thin layer: rules live in appStore / appTester.
 */
function createAdminAppsRouter({ appStore, appTester, knownEvents, adminToken, logger = console }) {
  const router = express.Router();
  const api = express.Router();

  router.get('/admin/webhooks', (_req, res) => res.sendFile(ADMIN_PAGE));

  api.use(requireAdminToken(adminToken));
  api.get('/events', handle(async () => ({ body: knownEvents }), logger));
  api.get('/apps', handle(async () => ({ body: appStore.list() }), logger));
  api.post('/apps', handle(async (req) => ({ status: 201, body: appStore.create(req.body) }), logger));
  api.put('/apps/:id', handle(async (req) => ({ body: appStore.update(req.params.id, req.body) }), logger));
  api.post('/apps/:id/rotate-secret', handle(async (req) => ({ body: appStore.rotateSecret(req.params.id) }), logger));
  api.post('/apps/:id/test', handle(async (req) => ({ body: await appTester.sendTestMessage(req.params.id, req.body) }), logger));
  api.delete('/apps/:id', handle(async (req) => {
    appStore.remove(req.params.id);
    return { body: { deleted: req.params.id } };
  }, logger));

  router.use('/admin/api', api);
  return router;
}

module.exports = { createAdminAppsRouter };
