/**
 * /api/openapi.json — ONE CONTRACT FOR THE SERVICES: offers · pricing · tax · invoice · keys. Each service route carries
 * its own fragment (router.openapi = { paths, schemas }) beside the code it describes, and this assembles them.
 * OWNS      the assembled /api/openapi.json (fragments + the Problem schema).
 * CALLED BY server.js (mounted at /api) · tools/api-register.cjs (assemble).
 * FLOW      each route file's router.openapi → assemble() → paths + schemas → JSON
 * CARD      28-platform-and-operations/api-standard
 */
const express = require('express');
const router = express.Router();
const { PROBLEM_SCHEMA } = require('../lib/problem');
const { OPENAPI } = require('../lib/plumbing-contract'); // the operation of this door (S9)

/** the one OpenAPI document: the openapi part of six route files joined, served from PUBLIC_API_BASE or the request host */
function assemble(req) {
  const base = process.env.PUBLIC_API_BASE || req.protocol + '://' + req.get('host');
  const parts = [require('./offers'), require('./pricing'), require('./tax'), require('./invoice'), require('./keys'), require('./integrations')].map(
    (item) => item.openapi || { paths: {}, schemas: {} }
  );
  const paths = Object.assign({}, ...parts.map((item) => item.paths || {}));
  const schemas = Object.assign({ Problem: PROBLEM_SCHEMA }, ...parts.map((item) => item.schemas || {})); /* S1: every fragment's refusals $ref this one body */
  return {
    openapi: '3.0.3',
    info: {
      title: 'ChitBridge services',
      version: '1.0.0',
      description:
        "The governed capabilities as services — the same engines the ChitBridge storefront, compose and the chit use. Stateless: lines in, answers out; omit structures, offers or rates and the caller entity's own shelf answers. Order of evaluation on a line: pricing structure → offers → tax. Authenticate with an API key minted under Settings › Integrations (X-Api-Key), scoped per service."
    },
    servers: [{ url: base }],
    tags: [{ name: 'offers' }, { name: 'pricing' }, { name: 'tax' }, { name: 'invoice' }, { name: 'keys' }],
    components: { securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' }, bearer: { type: 'http', scheme: 'bearer' } }, schemas },
    paths
  };
}
router.get('/openapi.json', ...OPENAPI.checked('GET /openapi.json'), (req, res, next) => {
  try {
    res.json(assemble(req));
  } catch (err) {
    next(err); // a fault of ours: the app's one error handler answers the Problem 500
  }
});
router.openapi = { paths: OPENAPI.pathsOf(), schemas: {} }; // this door describes itself to the register; assemble() above joins only the six service fragments, so the document is unchanged
module.exports = router;
module.exports.assemble = assemble;
