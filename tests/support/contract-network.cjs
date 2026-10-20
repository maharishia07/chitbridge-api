/**
 * tests/support/contract-network.cjs — GET /api/network-offers, the answer the Network app reads (public/app/network-app.js: the member view
 * and its In / Out choice), called through the REAL router over the shared stubbed world (tests/support/network-world.cjs), kept under
 * "GET /api/network-offers". Used by tests/web-api-contract.test.cjs, which holds the answer to docs/contracts/web-api.json.
 * Two answers are fired — the store's (networks[] with membership, may, bridge ids, offers) and the brand's (members[] with may, the
 * catalogue half) — so every optional key is seen with and without a value.
 */
'use strict';
const path = require('path');
const G = require('./route-golden.cjs');
const W = require('./network-world.cjs');

async function captureNetwork() {
  const h = G.harness({ rows: W.rows, known: W.known });
  const q = h.db.query;
  h.db.readBatch = async (id, actor, stmts) => Promise.all(stmts.map((item) => q(item.text, item.params)));
  const app = h.app('/api/network-offers', require(path.join(G.API, 'routes', 'network-offers')));
  const got = {};
  for (const who of [W.S, W.B]) {
    const r = await h.run(app, { method: 'GET', url: '/api/network-offers', identity: { identity_id: who, identity_type: 'entity', entity_id: who } });
    const k = 'GET /api/network-offers';
    got[k] = got[k] || { status: r.status, bodies: [] };
    got[k].bodies.push(r.body);
  }
  return got;
}
module.exports = { captureNetwork };
