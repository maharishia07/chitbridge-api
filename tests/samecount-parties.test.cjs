'use strict';
/**
 * tests/samecount-parties.test.cjs - SAMECOUNT A-F-59: "how many customers / suppliers" is ONE count (lib/crm.roleCounts).
 * 8 customer-role rows of which 5 are leads: the Parties list shows 3 customers, so the Home CRM card, the Home rail and Groups' customers must say 3 too.
 * Offline. Run: node tests/samecount-parties.test.cjs
 * CARD 11-crm-and-marketing/README
 */
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const party = (i, over) => Object.assign({ party_id: 'p' + i, roles: { customer: true, supplier: false }, lead: false, customer: { txn_count: 2 } }, over);
const parties = [
  party(1), party(2), party(3),
  ...[4, 5, 6, 7, 8].map((i) => party(i, { lead: true, customer: { txn_count: 0 } })),
  party(9, { roles: { customer: false, supplier: true }, customer: null }), party(10, { roles: { customer: false, supplier: true }, customer: null })
];
const real = require('../lib/crm.js');
stub('lib/crm', Object.assign({}, real, { rows: async () => ({}), assemble: () => ({ parties }) }));
stub('lib/istest', { maySample: () => ({ ok: true }) });
const Home = require('../lib/home-facts.js');
const partiesListCustomers = parties.filter((p) => p.customer && real.isLead(p) === false).length; /* lib/crm.list: the Customers tab */

(async () => {
  const card = await Home.BUILD.crm({ entity: 'e1', actor: 'e1' });
  assert.strictEqual(partiesListCustomers, 3);
  assert.strictEqual(card.figures.customers, 3);
  assert.strictEqual(card.figures.suppliers, 2);
  assert.strictEqual(card.lines[0].text, '3 customers · 2 suppliers');
  assert.deepStrictEqual(real.roleCounts(parties), { suppliers: 2, customers: 3 });
  console.log('  ok  Home CRM card = Parties list = roleCounts (3 customers · 2 suppliers; 5 leads are not customers)');
})().catch((e) => { console.log('  FAIL ' + e.message); process.exit(1); });
