const { ServiceError } = require('../services/errors');

/**
 * Turns `async (req) => ({ status?, body })` into an Express handler.
 * ServiceErrors map to their HTTP status; anything else is logged and becomes 500.
 */
function jsonHandler(fn, logger = console) {
  return async (req, res) => {
    try {
      const { status = 200, body } = await fn(req);
      res.status(status).json(body);
    } catch (err) {
      if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message });
      logger.error(`[ADMIN] unexpected error: ${err.message}`);
      return res.status(500).json({ error: 'internal_error' });
    }
  };
}

module.exports = { jsonHandler };
