'use strict';
/**
 * tests/ctry-81-send-stamp-delivery.test.cjs — CTRY-81 live fault (SIT part 6, 2026-11-07): the invoice STAMPED AT SEND reads the chit's recorded
 * delivery.state_code, the same way the unstamped copy does (lib/tax-copy withRecordedPos -> lib/tax placeOfSupply: ONE rule).
 * Real lib/send-money invoiceOfLines over a stubbed identities read. Hand-computed, 1 x 100.00 excl at 18%, seller TN (33), buyer GSTIN KA (29):
 *   delivered to TN (33)  -> intra: CGST 9.00 + SGST 9.00, IGST 0
 *   delivered to KA (29)  -> inter: IGST 18.00
 *   no delivery           -> the buyer's own state (KA), inter: IGST 18.00 (as before)
 *   bill_to_ship_to       -> the buyer's state (KA), inter: IGST 18.00
 *   a delivery code that is no state ("ZZ") -> not assumed: the buyer's state (KA), IGST 18.00
 *   buyer TN GSTIN, delivered to KA -> IGST 18.00
 * Run: node --test tests/ctry-81-send-stamp-delivery.test.cjs · no DB, no network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const dbId = require.resolve('../db');
const rows = {};
const q = async (sql, args) => ({ rows: ((args && args[0]) || []).map((id) => rows[id]).filter(Boolean) });
require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { query: q, pool: { query: q }, withEntity: async (id, fn) => fn({ query: q }), withTransaction: async (fn) => fn({ query: q }), onEntity: async (id, db, fn) => fn({ query: q }), readBatch: async () => ({}), trySavepoint: async (db, fn, fb) => fn(db).catch(() => fb) } };
const { invoiceOfLines } = require('../lib/send-money');
const S = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
rows[S] = { identity_id: S, gstn: '33AAAAA0000A1Z5', display_name: 'TN Seller', policy_flags: { price_includes_tax: 'no' }, country: 'IN' };
const buyerGstin = { KA: '29AAAAA0000A1Z5', TN: '33BBBBB0000B1Z5' };
const run = async (buyerState, delivery) => {
  rows[B] = { identity_id: B, gstn: buyerGstin[buyerState], display_name: 'Buyer', policy_flags: {}, country: 'IN' };
  const inv = await invoiceOfLines({ lines: [{ particulars: 'Goods', quantity: 1, price: 100, gst_rate: 18 }], sellerId: S, buyerId: B, business_json: delivery === undefined ? {} : { delivery }, currency_code: 'INR' });
  const v = inv.ValDtls;
  return { cgst: v.CgstVal, sgst: v.SgstVal, igst: v.IgstVal };
};
const cases = [
  ['seller TN delivering to TN (buyer KA GSTIN)', 'KA', { state_code: '33' }, { cgst: 9, sgst: 9, igst: 0 }],
  ['seller TN delivering to KA (buyer KA GSTIN)', 'KA', { state_code: '29' }, { cgst: 0, sgst: 0, igst: 18 }],
  ['no delivery: the buyer GSTIN state (KA) as before', 'KA', undefined, { cgst: 0, sgst: 0, igst: 18 }],
  ['bill_to_ship_to: the buyer state (KA)', 'KA', { bill_to_ship_to: true }, { cgst: 0, sgst: 0, igst: 18 }],
  ['a delivery code that is no state stays unknown, the buyer state decides', 'KA', { state_code: 'ZZ' }, { cgst: 0, sgst: 0, igst: 18 }],
  ['buyer TN GSTIN, delivered to KA', 'TN', { state_code: '29' }, { cgst: 0, sgst: 0, igst: 18 }],
  ['buyer TN GSTIN, no delivery: intra as before', 'TN', undefined, { cgst: 9, sgst: 9, igst: 0 }]
];
for (const [name, state, delivery, want] of cases) {
  test('CTRY-81 stamp at send: ' + name, async () => {
    const got = await run(state, delivery);
    assert.deepEqual(got, want);
  });
}
