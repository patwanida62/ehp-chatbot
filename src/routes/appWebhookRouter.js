const express = require('express');

/**
 * POST /webhooks/apps/:appId — single entry point for every external application.
 * Kept thin: all rules live in webhookService. Requires `req.rawBody` (see rawJsonBody middleware).
 */
function createAppWebhookRouter(webhookService, logger = console) {
  const router = express.Router();

  router.post('/webhooks/apps/:appId', async (req, res) => {
    try {
      const { status, body } = await webhookService.handle({
        appId: req.params.appId,
        headers: req.headers,
        rawBody: req.rawBody || Buffer.alloc(0),
        body: req.body,
      });
      res.status(status).json(body);
    } catch (err) {
      logger.error(`[APP-WEBHOOK] unexpected error: ${err.message}`);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}

module.exports = { createAppWebhookRouter };
