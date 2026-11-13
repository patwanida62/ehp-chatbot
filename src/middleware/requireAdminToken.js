const { safeEqual } = require('../utils/safeEqual');

const BEARER_PREFIX = 'Bearer ';

/**
 * Guards admin APIs with `Authorization: Bearer <ADMIN_TOKEN>`.
 * With no token configured the admin API is switched off entirely (503) rather than left open.
 */
function requireAdminToken(adminToken) {
  return (req, res, next) => {
    if (!adminToken) return res.status(503).json({ error: 'admin_disabled' });
    const header = req.headers.authorization || '';
    const provided = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : '';
    if (!provided || !safeEqual(provided, adminToken)) return res.status(401).json({ error: 'unauthorized' });
    return next();
  };
}

module.exports = { requireAdminToken };
