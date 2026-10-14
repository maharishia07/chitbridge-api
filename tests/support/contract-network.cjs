/**
 * tests/support/contract-network.cjs — the /api/network-offers routes the Network app reads (public/app/network-app.js: the member view and
 * its In / Out choice), called through the REAL router over the network stub (tests/support/network-stub.cjs), each answer kept under
 * "METHOD /api/network-offers/<route pattern>". Used by tests/web-api-contract.test.cjs, which holds each answer to docs/contracts/web-api.json.
 * The world is the stub's: a store in one network, asking a second, invited by a third, paused in a fourth; then the brand's own view; a co-assist;
 * a counter key (#403).
 */
'use strict';
const S = require('./network-stub.cjs');

async function captureNetwork() {
  const got = {};
  /** an answer under its route pattern; the same status MERGES into one example, another status gets its own entry ("#403") */
  const keep = (m, key, r) => { let k = m + ' /api/network-offers' + key; if (got[k] && got[k].status !== r.status) k += ' #' + r.status; got[k] = got[k] || { status: r.status, bodies: [] }; got[k].bodies.push(r.body); return r; };
  await S.start();
  try {
    S.as({});                                                                 /* the store: four standings, one network's offer */
    keep('GET', '', await S.get('/api/network-offers'));
    S.as({ identity_id: S.A, display_name: 'Apex' });                         /* the brand: its roster with may, its catalogue, no networks */
    keep('GET', '', await S.get('/api/network-offers'));
    S.as({ identity_id: 'co-1', parent_entity_id: S.STORE, display_name: 'Asha' });   /* a co-assist: may_design refused with its sentence */
    keep('GET', '', await S.get('/api/network-offers'));
    S.as({}, true);                                                           /* a counter key: refused in words */
    keep('GET', '', await S.get('/api/network-offers'));
    S.as({});
    keep('POST', '/:id/choice', await S.post('/api/network-offers/' + S.OFF + '/choice', { choice: 'in' }));
    keep('POST', '/:id/choice', await S.post('/api/network-offers/' + S.OFF + '/choice', { choice: null }));
    keep('POST', '/:id/choice', await S.post('/api/network-offers/not-an-id/choice', { choice: 'in' }));   /* #400 */
  } finally { S.stop(); }
  return got;
}
module.exports = { captureNetwork };
