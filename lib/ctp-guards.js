'use strict';
/**
 * lib/ctp-guards.js — the three small door helpers of the CTP routes (answer allow-list, refusal in the peer's old words, version gate).
 * OWNS      namesItsAnswer · refusalTo · readsVersion (no route, no state)
 * CALLED BY routes/ctp.js
 * FLOW      a door names its operation → the helper builds the output filter / the refusal / the tolerant-reader middleware
 * CARD      05-ctp-and-cross-installation/deliver-query-across-domains
 */
const { problem } = require('./problem');
const envelope = require('./ctpenvelope');

/* S34: the answer is pruned to the keys its operation names (reported by default, dropped under OUTPUT_ALLOWLIST=enforce); the closed 200 schema of its own operation */
const namesItsAnswer = (operation, key) => require('./output-allowlist').outputFilter({ status: '200', schema: operation.responses[200].content['application/json'].schema, observed: 1 }, key);
/** refusalTo(req, res, flag) → refuse({ status, code, why }): a Problem that keeps the keys a peer reads — `<flag>: false` and `why`, word for word */
const refusalTo = (req, res, flag) => ({ why, ...spec }) => problem(req, res, Object.assign(spec, { detail: why, legacy: { [flag]: false, why } }));

/**
 * RAIL-126 b · THE TOLERANT READER'S DOOR: a minor of our major goes on (a field we do not know is ignored by what reads the body); another major is refused 400
 * CTP_VERSION_UNSUPPORTED, in words naming both (lib/ctpenvelope versionRefusal). A value that is no version never gets here: the schema answered it.
 */
const readsVersion = (flag) => (req, res, next) => {
  const wrongVersion = envelope.versionRefusal(req.body.ctp);
  return wrongVersion ? refusalTo(req, res, flag)(wrongVersion) : next();
};

module.exports = { namesItsAnswer, refusalTo, readsVersion };
