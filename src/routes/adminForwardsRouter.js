const express = require('express');
const { requireAdminToken } = require('../middleware/requireAdminToken');
const { jsonHandler } = require('./jsonHandler');

/**
 * JSON API under /admin/api/line-forwards for managing where LINE events are copied to.
 * Thin layer: rules live in forwardTargetStore / lineEventForwarder.
 */
function createAdminForwardsRouter({ targetStore, forwarder, adminToken, logger = console }) {
  const api = express.Router();
  const handle = (fn) => jsonHandler(fn, logger);

  api.use(requireAdminToken(adminToken));
  api.get('/', handle(async () => ({ body: forwarder.describeTargets() })));
  api.post('/', handle(async (req) => ({ status: 201, body: targetStore.create(req.body) })));
  api.put('/:id', handle(async (req) => ({ body: targetStore.update(req.params.id, req.body) })));
  api.post('/:id/test', handle(async (req) => ({ body: await forwarder.ping(targetStore.find(req.params.id)) })));
  api.delete('/:id', handle(async (req) => {
    targetStore.remove(req.params.id);
    return { body: { deleted: req.params.id } };
  }));

  const router = express.Router();
  router.use('/admin/api/line-forwards', api);
  return router;
}

module.exports = { createAdminForwardsRouter };
