#!/usr/bin/env node
// @type: contract
/**
 * relationships-availability.test.cjs — OPS-55 and OPS-57: GET /api/relationships/suppliers/availability, the real route over the stand-in sign-in and database.
 * OWNS      OPS-55 each supplier answers one state: has (a product matches), miss (the catalogue is read, nothing matches), nocat (no catalogue, or the shop is not showing), err (unreadable);
 *           the count is the number of "has". OPS-57 the catalogue reads run with bounded concurrency: 50 suppliers are all read, never more than 6 at once (AVAIL_CONCURRENCY).
 * CALLED BY scripts/guards.cjs. No database, no network: tests/lib/problem-world.cjs, catalogue-view's buildPublicView swapped for a stand-in and put back.
 * CARD      11-crm-and-marketing/relationships-routes
 */
'use strict';
const path = require('path');
const { harness, OWNER, answering } = require('./lib/problem-world.cjs');
const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/relationships';
const lab = harness({ here: HERE, mounts: [MOUNT], routeFiles: { [MOUNT]: 'routes/relationships.js' }, legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json') });
const { check, world } = lab;

const supplier = (n, hasCatalogue) => ({
  supplier_list_id: 'aaaaaaaa-0000-4000-8000-' + String(n).padStart(12, '0'), nickname: 'S' + n, preferred: false,
  supplier_entity_id: 'bbbbbbbb-0000-4000-8000-' + String(n).padStart(12, '0'), bridge_id: 'B' + n, user_id: '~s.sup-' + n,
  display_name: 'Supplier ' + n, currency_code: 'INR', business_status: 'open', has_catalogue: hasCatalogue
});
const item = (name) => ({ item_id: 'i-' + name, item_data: { name, unit: 'kg', price: 100 } });
const asking = (rows) => { Object.assign(world, { realAuth: false, who: OWNER, asKey: false, db: 'ok', jsonThrows: false, noCustomer: false, sqlRows: answering(/FROM supplier_list sl\s+JOIN identities i/, rows) }); };

(async () => {
  lab.installStubs();
  const router = require(path.join(HERE, 'routes', 'relationships.js'));
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  const view = require(path.join(HERE, 'lib', 'catalogue-view'));
  const kept = view.buildPublicView;
  const ask = () => lab.send(port, 'GET', MOUNT + '/suppliers/availability?q=tea');
  try {
    console.log('\n-- OPS-55: has / miss / nocat / err --');
    const byId = {};
    asking([supplier(1, false), supplier(2, true), supplier(3, true), supplier(4, true), supplier(5, true)]);
    view.buildPublicView = async (o) => {
      const id = o.entity.identity_id;
      if (id.endsWith('2')) return { available: true, shop: { currency_code: 'INR' }, items: [item('Green tea'), item('Rice')] };
      if (id.endsWith('3')) return { available: true, shop: { currency_code: 'INR' }, items: [item('Rice')] };
      if (id.endsWith('4')) return { available: false };
      throw new Error('relation "secret" does not exist');
    };
    const answer = await ask();
    const body = answer.json || {};
    (body.results || []).forEach((r) => { byId[r.supplier_entity_id.slice(-1)] = r; });
    check('the answer is 200 and searched 5 suppliers', answer.status === 200 && body.searched === 5, { status: answer.status, searched: body.searched });
    check('no catalogue is "nocat"', byId[1] && byId[1].state === 'nocat', byId[1]);
    check('a matching product is "has" with the hit named', byId[2] && byId[2].state === 'has' && byId[2].hits.length === 1 && /tea/i.test(byId[2].hits[0].name), byId[2]);
    check('a read catalogue with no match is "miss", not "nocat"', byId[3] && byId[3].state === 'miss' && byId[3].hits.length === 0, byId[3]);
    check('a shop that is not showing is "nocat" (cannot tell), never "miss"', byId[4] && byId[4].state === 'nocat', byId[4]);
    check('an unreadable catalogue is "err" and the cause never leaks', byId[5] && byId[5].state === 'err' && !/secret|relation/.test(JSON.stringify(byId[5])), byId[5]);
    check('count is the number of "has"', body.count === 1, body.count);

    console.log('\n-- OPS-57: bounded concurrency of 6 over 50 suppliers --');
    const rows = Array.from({ length: 50 }, (v, i) => supplier(100 + i, true));
    asking(rows);
    let live = 0, peak = 0, calls = 0;
    view.buildPublicView = async () => {
      calls++; live++; peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      live--;
      return { available: true, shop: { currency_code: 'INR' }, items: [item('Tea')] };
    };
    const many = await ask();
    check('all 50 catalogues were read', calls === 50 && many.json && many.json.searched === 50, { calls, searched: many.json && many.json.searched });
    check('never more than 6 reads at once, and the pool of 6 was used', peak === 6, { peak });
  } finally {
    view.buildPublicView = kept;
    server.close();
  }
  console.log('\n  ' + lab.count.passed + ' passed, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
