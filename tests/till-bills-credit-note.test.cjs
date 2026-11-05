'use strict';
/**
 * till-bills-credit-note.test.cjs — ACC-255: GET /api/till/bills gives a counter CREDIT NOTE its money.
 * A credit note has no invoice (summary_json.money is null by design, lib/send-money scope 'none'), so its money sits in
 * business_json.{taxable, tax, refund}. billRow only PICKS those, signed negative for kind credit_note, so a day's net is a
 * plain sum. Every figure below is worked by hand (the plan's table), never read back from the engine.
 *   IN 18% inclusive : sale 1000 = 847.46 + 152.54 · CN 300 = -254.24 / -45.76 / -300 · net 700 · 593.22 · 106.78
 *   IN 18% exclusive : sale 1180 = 1000 + 180      · CN on 300 = -300 / -54 / -354     · net 826 · 700 · 126
 *   AU 10% inclusive : sale 1000 = 909.09 + 90.91  · CN -272.73 / -27.27 / -300         · net 700 · 636.36 · 63.64
 *   AU 10% exclusive : sale 1100 = 1000 + 100      · CN on 300 = -300 / -30 / -330     · net 770 · 700 · 70
 * Run: node tests/till-bills-credit-note.test.cjs
 */
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

const SHOP = '11111111-1111-4111-8111-111111111111';
let BILL_ROWS = [];
/* the shop's own identity row, changed per case: the books half reads it for the country and the price basis */
const IDENTITY = { identity_id: SHOP, bridge_id: 'CB-SHOP', display_name: 'Shop', country: 'IN', gstn: '33AABCK1234F1Z6', status: 'active', policy_flags: {} };
function rowsFor(sql, p) {
  const text = String(sql);
  if (/h\.sender_entity_id = \$1 AND h\.purpose IN/.test(text)) return BILL_ROWS;
  if (/SELECT self_copy_pref/.test(text)) return [{ self_copy_pref: null }];
  if (/FROM identities/.test(text) && /identity_id = ANY/.test(text)) return (p[0] || []).map((id) => (id === SHOP ? IDENTITY : null)).filter(Boolean);
  if (/FROM identities/.test(text) && /identity_id = \$1/.test(text)) return p && p[0] === SHOP ? [IDENTITY] : [];
  return [];
}
const tx = { query: async (s, p) => ({ rows: rowsFor(s, p) }) };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (s, p) => ({ rows: rowsFor(s, p) }),
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
const counterBill = require(path.join(API, 'lib', 'counter-bill'));
require(path.join(API, 'lib', 'tax-shelf')).readShelf = async () => null;
const TC = require(path.join(API, 'lib', 'tax-copy'));
const hooks = require(path.join(API, 'lib', 'books-hooks'));

const AT = '2026-11-05T09:00:00.000Z';
/** a counter sale as the server stores it: the invoice's money is on summary_json.money */
const sale = (no, total, taxable, tax) => ({
  chit_id: 'sale-' + no, created_at: AT, line_items: [],
  business_json: { bill_no: no, billed_at: AT, slip: 'cash', till: { id: 'C1', name: 'Counter 1' }, payment: { parts: [{ how: 'Cash', amount: total }], total },
    customer: { name: 'Walk-in' } },
  summary_json: { money: { total, taxable, tax, savings: 0 } }
});
/** a counter credit note as the till stores it (chitOfCN): money OUT in refund, taxable and tax signed negative, no invoice */
const note = (no, total, taxable, tax, parts, extra) => ({
  chit_id: 'cn-' + no, created_at: AT, line_items: [],
  business_json: Object.assign({ bill_no: no, billed_at: AT, doc: 'credit_note', slip: 'credit_note', till: { id: 'C1', name: 'Counter 1' },
    customer: { name: 'Walk-in' }, against: { bill_no: 'C1/0001', billed_at: AT, chit_id: null },
    reason: 'wrong', reason_words: 'Wrong item', refund: { parts, total }, by_rate: {}, taxable, tax }, extra || {}),
  summary_json: null
});
const sum = (rows, key) => Math.round(rows.reduce((a, b) => a + (b[key] || 0), 0) * 100) / 100;

(async () => {
  const app = express();
  app.use('/api/till', require(path.join(API, 'routes', 'till')));
  const srv = app.listen(0);
  const port = srv.address().port;
  const bills = async (rows) => { BILL_ROWS = rows; return (await (await fetch(`http://127.0.0.1:${port}/api/till/bills`)).json()).bills; };
  let n = 0;
  const ok = (name, fn) => Promise.resolve(fn()).then(() => { n++; console.log('  ok  ' + name); });

  const cases = [
    ['IN 18% inclusive', sale('S1', 1000, 847.46, 152.54), note('N1', 300, -254.24, -45.76, [{ how: 'Cash', amount: 300 }]), [700, 593.22, 106.78]],
    ['IN 18% exclusive', sale('S1', 1180, 1000, 180), note('N1', 354, -300, -54, [{ how: 'Cash', amount: 354 }]), [826, 700, 126]],
    ['AU 10% inclusive', sale('S1', 1000, 909.09, 90.91), note('N1', 300, -272.73, -27.27, [{ how: 'Cash', amount: 300 }]), [700, 636.36, 63.64]],
    ['AU 10% exclusive', sale('S1', 1100, 1000, 100), note('N1', 330, -300, -30, [{ how: 'Cash', amount: 330 }]), [770, 700, 70]]
  ];
  for (const [name, s, c, [net, taxable, tax]] of cases) {
    await ok(name + ': the credit note is negative, the day nets by a plain sum', async () => {
      const rows = await bills([s, c]);
      const cn = rows.find((r) => r.no === 'N1');
      assert.strictEqual(cn.kind, 'credit_note');
      assert(cn.total < 0 && cn.taxable < 0 && cn.tax < 0);
      assert.strictEqual(cn.total, -c.business_json.refund.total);
      assert.strictEqual(cn.taxable, c.business_json.taxable);
      assert.strictEqual(cn.tax, c.business_json.tax);
      assert.strictEqual(cn.saved, null);
      assert.strictEqual(sum(rows, 'total'), net);
      assert.strictEqual(sum(rows, 'taxable'), taxable);
      assert.strictEqual(sum(rows, 'tax'), tax);
    });
  }

  /* the books' own reading of the same note: books-hooks 'return' event, worked by the server from the lines (not from the till's stored taxable / tax) */
  const books = [
    ['IN 18% inclusive', { country: 'IN', gstn: '33AABCK1234F1Z6', policy_flags: { price_includes_tax: 'yes' } }, 'INR', 18, 0],
    ['IN 18% exclusive', { country: 'IN', gstn: '33AABCK1234F1Z6', policy_flags: { price_includes_tax: 'no' } }, 'INR', 18, 1],
    ['AU 10% inclusive', { country: 'AU', gstn: null, policy_flags: { price_includes_tax: 'yes' } }, 'AUD', 10, 2],
    ['AU 10% exclusive', { country: 'AU', gstn: null, policy_flags: { price_includes_tax: 'no' } }, 'AUD', 10, 3]
  ];
  for (const [name, identity, currency, rate, at] of books) {
    await ok(name + ': the day net from /till/bills equals the books return event for the same note (same cent)', async () => {
      Object.assign(IDENTITY, identity);
      const [, saleRow, cnRow] = cases[at];
      const cn = (await bills([saleRow, cnRow])).find((r) => r.no === 'N1');
      const hdr = { chit_id: 'cn1', sender_entity_id: SHOP, all_recipients: [SHOP], purpose: 'credit_note', currency_code: currency, current_status: 'pending',
        sent_at: AT, created_at: AT, summary_json: null,
        business_json: { bill_no: 'N1', till: { id: 'C1' }, slip: 'credit_note', against: { bill_no: 'S1' }, refund: cnRow.business_json.refund },
        line_items: [{ particulars: 'x', quantity: 1, price: 300, total: 300, gst_rate: rate }] };
      const entry = await TC.entryFor(hdr, SHOP);
      const verdict = hooks.classify({ chit: hdr, entry, setting: { enabled: true, country: identity.country, walkin_grain: 'day' } }); const event = verdict.event; assert(event, JSON.stringify(verdict));
      assert.strictEqual(event.type, 'return');
      const row = event.by_rate[0];
      const heads = Math.round(((row.cgst || 0) + (row.sgst || 0) + (row.igst || 0) + (row.gst || 0)) * 100) / 100;
      assert.strictEqual(-cn.taxable, row.taxable);
      assert.strictEqual(-cn.tax, heads);
    });
  }

  await ok('a credit note answers against, reason_words and refunds[]; a sale row carries none of them', async () => {
    const rows = await bills([sale('S1', 1000, 847.46, 152.54), cases[0][2]]);
    const cn = rows.find((r) => r.no === 'N1'), s = rows.find((r) => r.no === 'S1');
    assert.deepStrictEqual(cn.against, { bill_no: 'C1/0001' });
    assert.strictEqual(cn.reason_words, 'Wrong item');
    assert.deepStrictEqual(cn.refunds, [{ how: 'Cash', amount: 300 }]);
    assert(!('refunds' in s) && !('against' in s) && !('reason_words' in s));
  });

  await ok('an old credit note with no taxable / tax answers null, never 0, and no by_rate arithmetic fills it', async () => {
    const old = note('N0', 300, undefined, undefined, [{ how: 'Cash', amount: 300 }], { by_rate: { 18: { taxable: -254.24, gst: -45.76 } } });
    delete old.business_json.taxable; delete old.business_json.tax;
    const cn = (await bills([old]))[0];
    assert.strictEqual(cn.taxable, null); assert.strictEqual(cn.tax, null); assert.strictEqual(cn.total, -300);
  });

  await ok('no refund.total answers total null; zero tax answers 0, never -0; a string figure is not a number', async () => {
    const none = note('N2', 300, -300, 0, []);
    delete none.business_json.refund.total;
    const zero = note('N3', 300, -300, 0, [{ how: 'Cash', amount: 300 }]);
    const text = note('N4', 300, '-300', -0, [{ how: 'Cash', amount: 300 }]);
    const [a, b, c] = await bills([none, zero, text]);
    assert.strictEqual(a.total, null);
    assert(Object.is(b.tax, 0), 'zero tax is +0');
    assert(Object.is(c.tax, 0), '-0 in the store still answers +0');
    assert.strictEqual(c.taxable, null);
  });

  await ok('a stored positive taxable / tax still answers negative (the sign is the reader\'s, -abs)', async () => {
    const cn = (await bills([note('N5', 300, 254.24, 45.76, [{ how: 'Cash', amount: 300 }])]))[0];
    assert.strictEqual(cn.taxable, -254.24); assert.strictEqual(cn.tax, -45.76);
  });

  await ok('a mixed day: the sale, expense and sale-only rows are byte-identical to the rows made without a credit note in the list', async () => {
    const expense = { chit_id: 'x1', created_at: AT, line_items: [], business_json: { bill_no: 'X1', billed_at: AT, slip: 'expense', till: { id: 'C1' } }, summary_json: null };
    const rowsA = [sale('S1', 1000, 847.46, 152.54), expense, sale('S2', 118, 100, 18)];
    const without = await bills(rowsA);
    const withNote = await bills([rowsA[0], cases[0][2], rowsA[1], rowsA[2]]);
    const strip = withNote.filter((r) => r.no !== 'N1');
    assert.strictEqual(JSON.stringify(strip), JSON.stringify(without));
  });

  await ok('a two-tender refund: both parts ride refunds[], and the engine nets by.cash -100 and by.upi -200', async () => {
    const parts = [{ how: 'Cash', amount: 100 }, { how: 'UPI', amount: 200 }];
    const cn = (await bills([note('N6', 300, -254.24, -45.76, parts)]))[0];
    assert.deepStrictEqual(cn.refunds, parts);
    const day = require(path.join(API, 'lib', 'rollup')).totals([cn]);
    assert.strictEqual(day.by.Cash, -100); assert.strictEqual(day.by.UPI, -200);
    assert.strictEqual(day.returns, 1); assert.strictEqual(day.refunds, 300); assert.strictEqual(day.total, -300);
  });

  await ok('paidOf is untouched: a credit note still has no paid figure (the reward reads it), a sale still reads money.total', () => {
    assert.strictEqual(counterBill.paidOf(null) == null, true);
    assert.strictEqual(counterBill.paidOf({ money: null }) == null, true);
    assert.strictEqual(counterBill.paidOf({ money: { total: 1000 } }), 1000);
  });

  await ok('planted sign: a reader that kept the stored positive total would NOT sum to the net', async () => {
    const rows = await bills([sale('S1', 1000, 847.46, 152.54), cases[0][2]]);
    const flipped = rows.map((r) => (r.kind === 'credit_note' ? Object.assign({}, r, { total: -r.total }) : r));
    assert.notStrictEqual(sum(flipped, 'total'), 700);
    assert.strictEqual(sum(rows, 'total'), 700);
  });

  srv.close();
  console.log('\n' + n + ' passed');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
