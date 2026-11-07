'use strict';
/**
 * routes/preflight.js — OPTIONS *: the browser preflight for any path (moved out of server.js, answering exactly as before: the cors package, same options, same place in the stack).
 * OWNS      the preflight reply. The ALLOW-LIST ITSELF (corsOptions) stays in server.js with its long reasons; server.js hands it over once: app.use(require('./routes/preflight').withOptions(corsOptions)).
 * CALLED BY server.js · browsers (every cross-origin call that carries a header outside the safe list) · lib/plumbing-contract.js (its operation).
 * FLOW      cors(options) answers 204 with the Access-Control headers | a refused origin or a fault → next(err) → the app's one error handler (403 ORIGIN_NOT_ALLOWED · a Problem 500)
 * CARD      28-platform-and-operations/api-standard
 */
const express = require('express');
const cors = require('cors');
const { PREFLIGHT } = require('../lib/plumbing-contract');

const router = express.Router();
let options = {};

router.options('*', ...PREFLIGHT.checked('OPTIONS *'), (req, res, next) => {
  try {
    cors(options)(req, res, (err) => next(err));
  } catch (err) {
    next(err);
  }
});

/** the allow-list the preflight answers from (server.js corsOptions); the router comes back so it mounts in one line */
router.withOptions = (corsOptions) => {
  options = corsOptions;
  return router;
};

router.openapi = { paths: PREFLIGHT.pathsOf(), schemas: {} };
module.exports = router;
