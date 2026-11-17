/**
 * tests/tax-copy-pos.test.cjs — CTRY-81 (R10): PLACE OF SUPPLY ON A COMPOSED CHIT FOLLOWS THE RECORDED DELIVERY, NOT THE BUYER'S GSTIN.
 * A composed invoice (purpose 'invoice', no counter bill) used to take the buyer's GSTIN state. Now business_json.delivery.state_code
 * (the counter's key) decides, bill_to_ship_to puts it in the buyer's state, and with neither fact the labelled fallback stays.
 * No database: identities come from a stub. Run: node tests/tax-copy-pos.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const SHOP = '11111111-1111-4111-8111-111111111111', KA = '22222222-2222-4222-8222-222222222222', TN = '33333333-3333-4333-8333-333333333333';
const AUS = '44444444-4444-4444-8444-444444444444', AUB = '55555555-5555-4555-8555-555555555555';
const IDS = {
  [SHOP]: { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', policy_flags: { price_includes_tax: 'no' } },
  [KA]: { identity_id: KA, gstn: '29BBBBB0000B1Z5', display_name: 'Bengaluru Autos', country: 'IN', policy_flags: {} },
  [TN]: { identity_id: TN, gstn: '33CCCCC0000C1Z5', display_name: 'Chola Auto Care', country: 'IN', policy_flags: {} },
  [AUS]: { identity_id: AUS, gstn: '51824753556', display_name: 'Sydney Supplies', country: 'AU', policy_flags: { price_includes_tax: 'no' } },
  [AUB]: { identity_id: AUB, gstn: '53004085616', display_name: 'Perth Buyer', country: 'AU', policy_flags: {} },
};
require.cache[require.resolve(path.join(API, 'db'))] = { exports: {
  query: async (sql, params) => {
    if (/FROM identities WHERE identity_id = ANY/.test(sql)) return { rows: params[0].map((id) => IDS[id]).filter(Boolean) };
    throw new Error('unstubbed query: ' + sql);
  },
  withEntity: async (_id, fn) => fn({ query: async () => ({ rows: [] }) }),
} };
const TC = require(path.join(API, 'lib', 'tax-copy'));
const T = require(path.join(API, 'lib', 'tax-lines'));

const party = (id) => ({ entity_id: id, bridge_id: 'b-' + id.slice(0, 4), display_name: IDS[id].display_name });
const lines = [{ line_id: 'l1', particulars: 'Brake pad', quantity: 1, price: 100, total: 100, gst_rate: 18 }];
const chit = (seller, buyer, bj) => ({ chit_id: 'cb1', sender_entity_id: seller, purpose: 'invoice',
  all_recipients: [Object.assign({ role: 'sender' }, party(seller)), Object.assign({ role: 'receiver' }, party(buyer))], business_json: bj,
  summary_json: {}, sent_at: '2026-11-01T05:00:00.000Z', created_at: '2026-11-01T05:00:00.000Z', line_items: lines, currency_code: seller === AUS ? 'AUD' : 'INR' });
async function invoiceOf(seller, buyer, bj) {
  const p = await TC.partiesFor(chit(seller, buyer, bj), seller);
  const r = T.invoiceFor({ lines, seller: p.seller, buyer: p.buyer, priceIncludesTax: p.priceIncludesTax, currency: seller === AUS ? 'AUD' : 'INR' });
  return { supply: r.invoice._cb.supply, v: r.invoice.ValDtls, pos: r.invoice.BuyerDtls.Pos, notes: r.invoice._cb.notes || [] };
}
const heads = (x) => ({ cgst: x.v.CgstVal, sgst: x.v.SgstVal, igst: x.v.IgstVal });

(async () => {
  console.log('\n══ CTRY-81 · PLACE OF SUPPLY ON A COMPOSED CHIT ══\n');
  const a = await invoiceOf(SHOP, KA, { delivery: { state_code: '33' } });
  ok('TN shop to a KA-GSTIN buyer, delivered in TN: CGST+SGST, place of supply 33', a.pos === '33' && a.supply === 'intra' && heads(a).cgst === 9 && heads(a).sgst === 9 && !heads(a).igst, JSON.stringify([a.pos, a.supply, heads(a)]));
  const b = await invoiceOf(SHOP, TN, { delivery: { state_code: '29' } });
  ok('TN shop to a TN-GSTIN buyer, delivered in KA: IGST, place of supply 29', b.pos === '29' && b.supply === 'inter' && heads(b).igst === 18 && !heads(b).cgst, JSON.stringify([b.pos, b.supply, heads(b)]));
  const c = await invoiceOf(SHOP, KA, { delivery: { bill_to_ship_to: true, state_code: '33' } });
  ok('bill-to-ship-to: the buyer\'s (KA) state, IGST, even though a ship-to says 33', c.pos === '29' && c.supply === 'inter' && heads(c).igst === 18, JSON.stringify([c.pos, c.supply, heads(c)]));
  const d = await invoiceOf(SHOP, KA, {});
  ok('no fact: the labelled buyer-GSTIN fallback stays (29, IGST, the engine says the buyer\'s state was used)', d.pos === '29' && d.supply === 'inter' && d.notes.some((n) => /buyer's state was used/.test(n)), JSON.stringify([d.pos, d.supply, d.notes]));
  const e = await invoiceOf(SHOP, KA, { delivery: { state_code: 'KA' } });
  ok('a bad delivery code is ignored: the fallback, not a guessed state', e.pos === '29' && e.supply === 'inter', JSON.stringify([e.pos, e.supply]));
  const f = await invoiceOf(AUS, AUB, { delivery: { state_code: '29' } });
  const g = await invoiceOf(AUS, AUB, {});
  ok('AU is unaffected: the same GST with or without a delivery key', f.supply === g.supply && JSON.stringify(f.v) === JSON.stringify(g.v) && Number(f.v.TotInvVal || f.v.TotVal || 0) > 0, JSON.stringify([f.supply, g.supply, f.v, g.v]));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((x) => { console.error(x); process.exit(1); });
