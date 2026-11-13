const express = require('express');

/**
 * JSON body parser that also keeps the raw bytes on `req.rawBody`.
 * Signature checks (LINE and app webhooks) must hash the exact bytes received.
 */
function rawJsonBody() {
  return express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  });
}

module.exports = { rawJsonBody };
