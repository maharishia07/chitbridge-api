'use strict';
/**
 * ctr-197-cancelled-bill.test.cjs - CTR-197: GET /api/till/bills leaves a CANCELLED (or rejected) bill out, so Earlier bills and the day
 * report add up to what the books hold. The status is READ from chit_status (the rail's table, written only by moveStatus) through the one
 * condition lib/counter-bill NOT_WITHDRAWN_SQL, which the day close (books-store counterBills) uses too. No status writer is added.
 * The stand-in database below obeys that condition, so the test is red on the old statement (it carried no such condition).
 * Worked by hand:
 *   IN 18% inclusive : live sale 1000 + cancelled sale 1180 -> the day is 1000 (847.46 + 152.54), not 2180
 *   AU 10% inclusive : live sale 1100 + cancelled sale 550 + cancelled credit note 330 -> the day is 1100 (1000 + 100)
 * Run: node tests/ctr-197-cancelled-bill.test.cjs
 * CARD      09-counter/day-close
 */
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

const SHOP = '11111111-1111-4111-8111-111111111111';
const AT = '2026-11-05T09:00:00.000Z';
let BILL_ROWS = [];
let STATUS = {}; /* chit_id -> chit_status.current_status; absent = still live */
const WITHDRAWN = /current_status IN \('cancelled', 'rejected'\)/;
function rowsFor(sql) {
  const text = String(sql);
  if (!/h\.sender_entity_id = \$1 AND h\.purpose IN/.test(text)) return /SELECT self_copy_pref/.test(text) ? [{ self_copy_pref: null }] : [];
  const leavesWithdrawnOut = WITHDRAWN.test(text) && /NOT EXISTS \(SELECT 1 FROM chit_status/.test(text);
  return BILL_ROWS.filter((r) => !(leavesWithdrawnOut && ['cancelled', 'rejected'].includes(STATUS[r.chit_id])));
}
const tx = { query: async (s) => ({ rows: rowsFor(s) }) };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (s) => ({ rows: rowsFor(s) }),
  withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
  onEntity: async (id, db, fn) => fn(tx)
} };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => {
    req.identity = { identity_id: SHOP, identity_type: 'entity', bridge_id: 'CB-SHOP', display_name: 'Shop' };
    req.api_key = { scopes: ['till'] };
    req.till = require(path.join(API, 'lib', 'holder')).holderOf({ kind: 'api_key', scopes: ['till'] }, null);
    next();
  },
  { entityOf: (req) => req.identity.identity_id, requireScope: () => (q, s, n) => n(), userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };
const express = require('express');
require(path.join(API, 'lib', 'tax-shelf')).readShelf = async () => null;

const sale = (no, total, taxable, tax) => ({
  chit_id: 'sale-' + no, created_at: AT, line_items: [],
  business_json: { bill_no: no, billed_at: AT, slip: 'cash', till: { id: 'C1', name: 'Counter 1' }, payment: { parts: [{ how: 'Cash', amount: total }], total }, customer: { name: 'Walk-in' } },
  summary_json: { money: { total, taxable, tax, savings: 0 } }
});
const note = (no, total, taxable, tax) => ({
  chit_id: 'cn-' + no, created_at: AT, line_items: [],
  business_json: { bill_no: no, billed_at: AT, doc: 'credit_note', slip: 'credit_note', till: { id: 'C1', name: 'Counter 1' }, customer: { name: 'Walk-in' },
    against: { bill_no: 'C1/0001', billed_at: AT, chit_id: null }, reason: 'wrong', refund: { parts: [{ how: 'Cash', amount: total }], total }, by_rate: {}, taxable, tax },
  summary_json: null
});
const sum = (rows, key) => Math.round(rows.reduce((a, b) => a + (b[key] || 0), 0) * 100) / 100;

(async () => {
  const app = express();
  app.use('/api/till', require(path.join(API, 'routes', 'till')));
  const srv = app.listen(0);
  const port = srv.address().port;
  const bills = async (rows, status) => { BILL_ROWS = rows; STATUS = status || {}; return (await (await fetch(`http://127.0.0.1:${port}/api/till/bills`)).json()).bills; };
  let n = 0;
  const ok = (name, fn) => Promise.resolve(fn()).then(() => { n++; console.log('  ok  ' + name); });

  await ok('IN 18% inclusive: a cancelled sale is not listed and the day is the live sale only', async () => {
    const rows = await bills([sale('S1', 1000, 847.46, 152.54), sale('S2', 1180, 1000, 180)], { 'sale-S2': 'cancelled' });
    assert.deepStrictEqual(rows.map((r) => r.no), ['S1']);
    assert.strictEqual(sum(rows, 'total'), 1000);
    assert.strictEqual(sum(rows, 'taxable'), 847.46);
    assert.strictEqual(sum(rows, 'tax'), 152.54);
  });
  await ok('AU 10% inclusive: a cancelled sale and a cancelled credit note are both left out', async () => {
    const rows = await bills([sale('S1', 1100, 1000, 100), sale('S2', 550, 500, 50), note('N1', 330, -300, -30)], { 'sale-S2': 'cancelled', 'cn-N1': 'cancelled' });
    assert.deepStrictEqual(rows.map((r) => r.no), ['S1']);
    assert.strictEqual(sum(rows, 'total'), 1100);
    assert.strictEqual(sum(rows, 'taxable'), 1000);
  });
  await ok('a rejected bill is left out like a cancelled one', async () => {
    const rows = await bills([sale('S1', 1000, 847.46, 152.54), sale('S2', 1180, 1000, 180)], { 'sale-S2': 'rejected' });
    assert.deepStrictEqual(rows.map((r) => r.no), ['S1']);
  });
  await ok('a live bill (any other status, or none) stays listed', async () => {
    const rows = await bills([sale('S1', 1000, 847.46, 152.54), sale('S2', 1180, 1000, 180)], { 'sale-S1': 'accepted', 'sale-S2': 'completed' });
    assert.deepStrictEqual(rows.map((r) => r.no), ['S1', 'S2']);
  });
  await ok('the day close reads the same condition (books-store counterBills)', async () => {
    let seen = '';
    await require(path.join(API, 'lib', 'books-store')).counterBills({ query: async (s) => { seen = String(s); return { rows: [] }; } }, SHOP, 'C1', AT, AT);
    assert(seen.includes(require(path.join(API, 'lib', 'counter-bill')).NOT_WITHDRAWN_SQL));
  });
  console.log(n + ' passed');
  srv.close();
})().catch((e) => { console.error(e); process.exitCode = 1; setImmediate(() => process.exit(1)); });
