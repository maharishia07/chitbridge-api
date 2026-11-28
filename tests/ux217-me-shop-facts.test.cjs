#!/usr/bin/env node
/**
 * ux217-me-shop-facts.test.cjs — UX-217: a staff seat's GET /api/entities/me carries the SHOP's facts (name, tax number, address) beside the seat's own row.
 *
 * OWNS      the offline proof that the seat's own display_name stays the person's (Casey Nguyen) while `entity.shop` is the employer's (the shop's name and ABN), so the
 *           Settings > Your business card of a staff seat shows the shop read-only, never the staff member's name as the business (the Fable AU walk 2, ACC002-I15).
 * CALLED BY scripts/guards.cjs.
 * FLOW      stand-in sign-in + db (tests/lib/problem-world.cjs) → the real routes/entities.js over http → read /me as a seat
 * CARD      17-people-employees-hr-and-payroll/people-list-with-may-why
 *
 *   node tests/ux217-me-shop-facts.test.cjs
 */
'use strict';
const path = require('path');
const { harness, STAFF, SHOP } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const lab = harness({ here: HERE, mounts: ['/api/entities'], routeFiles: { '/api/entities': 'routes/entities.js' } });
const { check } = lab;
const SHOP_FACTS = { display_name: 'Yarra Bike Works', gstn: '51992702030', address: '1 Main St' };
const COLS = ['timezone', 'supplies', 'storefront_access', 'locale_prefs', 'ui_prefs', 'policy_flags', 'catalogue_visibility', 'plan', 'params_override'];

let meSql = '';
const model = (sql) => {
  if (/information_schema\.columns/.test(sql)) return { rows: COLS.map((column_name) => ({ column_name })), rowCount: COLS.length };
  if (/SELECT identity_id, bridge_id, display_name, email, user_id, self_copy_pref/.test(sql)) {
    meSql = sql;
    return { rows: [{ identity_id: STAFF.identity_id, display_name: 'Casey Nguyen', country: 'AU', gstn: null, address: null, shop: SHOP_FACTS }], rowCount: 1 };
  }
  return null;
};

async function main() {
  lab.installStubs();
  const entities = require(path.join(HERE, 'routes', 'entities.js'));
  const server = lab.appOf([{ mount: '/api/entities', router: entities }]).listen(0);
  const port = server.address().port;
  Object.assign(lab.world, { who: Object.assign({}, STAFF, { parent_entity_id: SHOP }), sqlRows: model, db: 'ok' });

  const got = await lab.send(port, 'GET', '/api/entities/me');
  const entity = (got.json && got.json.entity) || {};
  check('a seat reads /me: 200 (it answered ' + got.status + ')', got.status === 200, got.text.slice(0, 200));
  check('the seat keeps its own name', entity.display_name === 'Casey Nguyen', JSON.stringify(entity.display_name));
  check('and entity.shop is the employer\'s name, tax number and address', !!entity.shop && entity.shop.display_name === 'Yarra Bike Works' && entity.shop.gstn === '51992702030' && entity.shop.address === '1 Main St', JSON.stringify(entity.shop));
  check('the SELECT reads the shop from the parent row beside the seat (same trip, no second query)', /json_build_object\(.*FROM identities p WHERE p\.identity_id = identities\.parent_entity_id\) AS shop/s.test(meSql), meSql.slice(-400));
  server.close();
  console.log('\n  ' + (lab.count.passed + lab.count.failed) + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
}

main().catch((failure) => {
  console.log('ux217-me-shop-facts crashed:', failure);
  process.exit(1);
});
