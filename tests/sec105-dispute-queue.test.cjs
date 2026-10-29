#!/usr/bin/env node
/**
 * sec105-dispute-queue.test.cjs — SEC-105: GET /api/chits/disputes/queue names the caller's shop in its own SQL, not only through row security.
 *
 * OWNS      the offline proof that the queue (rows and the open/resolved counts) holds only the caller's copies when the connection does NOT apply row security
 *           (the local stack once ran as postgres). The stand-in db holds disputes of two shops and applies a predicate on entity_id only if the SQL itself names one.
 * CALLED BY scripts/guards.cjs. The real T2 twin is the S41 suite and tests/dispute-scoping.test.cjs.
 * FLOW      stand-in sign-in + db (tests/lib/problem-world.cjs) → the real routes/chits.js over http → ask as shop B and as shop A → compare what comes back
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tests/sec105-dispute-queue.test.cjs
 */
'use strict';
const path = require('path');
const { harness, SHOP } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const SHOP_A = SHOP;
const SHOP_B = '66666666-6666-4666-8666-666666666666';
const WHO_A = { identity_id: SHOP_A, identity_type: 'entity', display_name: 'Shop A' };
const WHO_B = { identity_id: SHOP_B, identity_type: 'entity', display_name: 'Shop B' };
const dispute = (id, owner, status) => ({ dispute_id: id, chit_id: 'c' + id, entity_id: owner, raised_by_entity_id: owner, status, category: 'x', reason: 'r-' + id, created_at: '2026-10-01', _total: '0' });
const ALL = [dispute('d1', SHOP_A, 'open'), dispute('d2', SHOP_A, 'open'), dispute('d3', SHOP_B, 'open'), dispute('d4', SHOP_A, 'resolved')];

const lab = harness({ here: HERE, mounts: ['/api/chits'], routeFiles: { '/api/chits': 'routes/chits.js' } });
const { check } = lab;

/** the db with row security OFF: rows are cut to a shop only when the SQL carries `entity_id = $1` (the caller's id) */
function modelWithoutRls(sql, params) {
  const named = /entity_id\s*=\s*\$1/.test(sql);
  const mine = (row) => (named ? row.entity_id === params[0] : true);
  if (/AS _total/.test(sql)) {
    const rows = ALL.filter(mine);
    return { rows: rows.map((row) => Object.assign({}, row, { _total: String(rows.length) })), rowCount: rows.length };
  }
  if (/FILTER \(WHERE status = 'open'\)/.test(sql)) {
    const rows = ALL.filter(mine);
    return { rows: [{ open: rows.filter((row) => row.status === 'open').length, resolved: rows.filter((row) => row.status !== 'open').length }], rowCount: 1 };
  }
  return null;
}

async function ask(port, who) {
  Object.assign(lab.world, { who, sqlRows: modelWithoutRls, db: 'ok' });
  return lab.send(port, 'GET', '/api/chits/disputes/queue?status=all');
}

async function main() {
  lab.installStubs();
  const chits = require(path.join(HERE, 'routes', 'chits.js'));
  const server = lab.appOf([{ mount: '/api/chits', router: chits }]).listen(0);
  const port = server.address().port;
  const idsOf = (answer) => ((answer.json && answer.json.rows) || []).map((row) => row.dispute_id).sort().join(',');
  const asB = await ask(port, WHO_B);
  check('shop B: 200 (it answered ' + asB.status + ')', asB.status === 200, asB.text.slice(0, 200));
  check('shop B sees only its own dispute d3, none of shop A (' + idsOf(asB) + ')', idsOf(asB) === 'd3', asB.text.slice(0, 300));
  check('shop B counts: 1 open, 0 resolved (a count of shop A would leak size)', asB.json && asB.json.total_open === 1 && asB.json.counts.resolved === 0, JSON.stringify(asB.json && asB.json.counts));
  const asA = await ask(port, WHO_A);
  check('shop A still sees its three (' + idsOf(asA) + ')', idsOf(asA) === 'd1,d2,d4', asA.text.slice(0, 300));
  check('shop A counts: 2 open, 1 resolved', asA.json && asA.json.total_open === 2 && asA.json.counts.resolved === 1, JSON.stringify(asA.json && asA.json.counts));
  server.close();
  console.log('\n  ' + (lab.count.passed + lab.count.failed) + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
}

main().catch((failure) => {
  console.log('sec105-dispute-queue crashed:', failure);
  process.exit(1);
});
