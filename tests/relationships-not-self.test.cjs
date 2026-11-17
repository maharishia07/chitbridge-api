#!/usr/bin/env node
// @type: contract
/**
 * relationships-not-self.test.cjs — a shop is never its own customer or supplier (l16 consistency finding "Party lists disagree").
 * OWNS      GET /api/relationships/customers and /suppliers leave the reader's own entity out in SQL (lib/customer-groups NOT_SELF_*), the same rule lib/crm.rows applies,
 *           so the Customers pane, the CRM list and the Home count agree; no data change, the self-sent source chits stay.
 * CALLED BY scripts/guards.cjs. No database: tests/lib/problem-world.cjs captures the SQL the route sends.
 * CARD      11-crm-and-marketing/relationships-routes
 */
'use strict';
const path = require('path');
const { harness, OWNER } = require('./lib/problem-world.cjs');
const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/relationships';
const lab = harness({ here: HERE, mounts: [MOUNT], routeFiles: { [MOUNT]: 'routes/relationships.js' }, legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json') });
const { check, world } = lab;

(async () => {
  lab.installStubs();
  const router = require(path.join(HERE, 'routes', 'relationships.js'));
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  const seen = [];
  const watch = (from) => (sql, params) => { if (from.test(sql)) seen.push({ sql, params }); return null; };
  const ask = async (tail, from) => {
    seen.length = 0;
    Object.assign(world, { realAuth: false, who: OWNER, asKey: false, db: 'ok', jsonThrows: false, noCustomer: false, sqlRows: watch(from) });
    await lab.send(port, 'GET', MOUNT + tail);
    return seen[0];
  };
  try {
    const cust = await ask('/customers', /FROM customer_list cl\s+JOIN identities i/);
    check('customers: the read ran', !!cust);
    check('customers: own entity excluded in SQL', !!cust && /cl\.customer_identity_id <> \$1/.test(cust.sql));
    check('customers: $1 is the reader', !!cust && String(cust.params[0]) === String(OWNER.identity_id));
    const sup = await ask('/suppliers', /FROM supplier_list sl\s+JOIN identities i/);
    check('suppliers: the read ran', !!sup);
    check('suppliers: own entity excluded in SQL', !!sup && /sl\.supplier_entity_id <> \$1/.test(sup.sql));
  } finally {
    server.close();
  }
  console.log(`
${lab.count.passed} passed, ${lab.count.failed} failed`);
  process.exit(lab.count.failed ? 1 : 0);
})();
