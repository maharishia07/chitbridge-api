/**
 * tests/tax-copy.test.cjs — WHO SELLS ON EACH COPY OF A COUNTER BILL (the two-sided counter bill, 2026-10-01).
 *
 * A counter bill is purpose 'order' — the word the storefront uses for an order a CUSTOMER sends. partiesFor() reads an
 * order as "the receiver sells", and its counter rule said "any order naming a customer: I sell". Both are right for the
 * shop's own copy. Once the counter sends the bill to an on-rail customer, the CUSTOMER holds a copy too — and both rules
 * called that copy the customer's SALE: output tax in their ledger, a line in their GSTR-1, for goods they bought.
 *
 *   · the shop's own copy (self only, or self + the customer) → a sale, unchanged
 *   · the customer's copy → a PURCHASE: seller = the shop that sent it, buyer = me, sells: false
 *   · a storefront order received by the shop (no counter, no bill number) → still the shop's sale
 *   · the ledger and GSTR-1 of the customer: no outward supply; the input tax is theirs
 * No database: identities come from a stub.
 * Run: node tests/tax-copy.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const IDS = {
  [SHOP]: { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', policy_flags: { price_includes_tax: 'no' } },
  [CUST]: { identity_id: CUST, gstn: '33BBBBB0000B1Z5', display_name: 'Chola Auto Care', country: 'IN', policy_flags: {} },
};
require.cache[require.resolve(path.join(API, 'db'))] = { exports: {
  query: async (sql, params) => {
    if (/FROM identities WHERE identity_id = ANY/.test(sql)) return { rows: params[0].map((id) => IDS[id]).filter(Boolean) };
    throw new Error('unstubbed query: ' + sql);
  },
  withEntity: async (_id, fn) => fn({ query: async () => ({ rows: [] }) }),
} };
delete require.cache[require.resolve(path.join(API, 'lib', 'tax-copy'))];
const TC = require(path.join(API, 'lib', 'tax-copy'));
const T = require(path.join(API, 'lib', 'tax-lines'));

const me = (id) => ({ entity_id: id, bridge_id: 'b-' + id.slice(0, 4), display_name: IDS[id].display_name });
const counterBj = (customer) => ({ customer, till: { id: 'C1', name: 'Counter 1', host: 'browser' }, bill_no: 'C1/26-27/0041',
  billed_at: '2026-10-01T05:00:00.000Z', client_ref: 'C1/26-27/0041', payment: { mode: 'On credit', parts: [{ how: 'On credit', amount: 118 }] }, slip: 'cash' });
const lines = [{ line_id: 'l1', particulars: 'Brake pad', quantity: 1, price: 100, total: 100, gst_rate: 18 }];
const copy = (id, bj, recipients, purpose) => ({ chit_id: 'cb1', sender_entity_id: SHOP, purpose: purpose || 'order',
  all_recipients: [Object.assign({ role: 'sender' }, me(SHOP))].concat(recipients), business_json: bj,
  summary_json: {}, sent_at: '2026-10-01T05:00:01.000Z', created_at: '2026-10-01T05:00:01.000Z', line_items: lines, currency_code: 'INR' });

(async () => {
  console.log('\n══ WHO SELLS, ON EACH COPY OF A COUNTER BILL ══\n');

  /* today's counter bill: self only */
  const selfOnly = copy(SHOP, counterBj({ name: 'Walk-in' }), [Object.assign({ role: 'receiver' }, me(SHOP))]);
  const a = await TC.partiesFor(selfOnly, SHOP);
  eq('a self-only counter bill: the shop sells (unchanged)', [a.sells, a.seller.entity_id, a.counter], [true, SHOP, true]);

  /* the two-sided bill — the same chit, two holders */
  const named = { name: 'Chola Auto Care', phone: '9840012345', identity_id: CUST, entity_id: CUST };
  const recips = [Object.assign({ role: 'receiver' }, me(SHOP)), Object.assign({ role: 'receiver' }, me(CUST))];
  const shopCopy = copy(SHOP, counterBj(named), recips), custCopy = copy(CUST, counterBj(named), recips);
  const s = await TC.partiesFor(shopCopy, SHOP);
  eq('the SHOP\'s copy of a bill sent to a rail customer is still its sale', [s.sells, s.seller.entity_id, s.direction], [true, SHOP, 'sent']);
  const c = await TC.partiesFor(custCopy, CUST);
  eq('the CUSTOMER\'s copy is a PURCHASE: sells false', c.sells, false);
  eq('…the seller is the shop that sent it, the buyer is me', [c.seller.entity_id, c.seller.Gstin, c.buyer.entity_id, c.buyer.Gstin], [SHOP, '33AAAAA0000A1Z5', CUST, '33BBBBB0000B1Z5']);
  eq('…received, and never the counter rule (no "counter: true" on a bill I did not issue)', [c.direction, !!c.counter], ['received', false]);
  eq('…priced the way the SELLER prices (its own price_includes_tax)', c.priceIncludesTax, false);

  /* a storefront order the shop received: the customer sent it, the shop sells — must not move */
  const storefront = { chit_id: 'o1', sender_entity_id: CUST, purpose: 'order', all_recipients: [Object.assign({ role: 'sender' }, me(CUST)), Object.assign({ role: 'receiver' }, me(SHOP))],
    business_json: {}, summary_json: {}, sent_at: '2026-10-01T05:00:00.000Z', created_at: '2026-10-01T05:00:00.000Z', line_items: lines, currency_code: 'INR' };
  const o = await TC.partiesFor(storefront, SHOP);
  eq('a storefront order RECEIVED by the shop is still the shop\'s sale (unchanged)', [o.sells, o.seller.entity_id, o.buyer.entity_id], [true, SHOP, CUST]);
  const ob = await TC.partiesFor(storefront, CUST);
  eq('…and the customer\'s sent copy of it is their purchase (unchanged)', [ob.sells, ob.seller.entity_id], [false, SHOP]);

  /* the ledger and the return, on each side */
  const eShop = await TC.entryFor(shopCopy, SHOP), eCust = await TC.entryFor(custCopy, CUST);
  ok('the entry carries the bill number either side', eShop.doc_no === 'C1/26-27/0041' && eCust.doc_no === 'C1/26-27/0041');
  const lShop = T.ledger([eShop], eShop.me), lCust = T.ledger([eCust], eCust.me);
  eq('the shop\'s ledger: output tax ₹18, no input credit', [lShop.output.tax, lShop.itc.tax], [18, 0]);
  eq('the customer\'s ledger: NO output tax, input credit ₹18', [lCust.output.tax, lCust.itc.tax, lCust.rows[0] && lCust.rows[0].side], [0, 18, 'itc']);
  const gShop = T.gstr1(lShop, eShop.me, '102026'), gCust = T.gstr1(lCust, eCust.me, '102026');
  /* ⭐⭐ B2B ON THE SELLER'S SIDE (Athi, 2026-10-01): the customer is on the rail, so the seller's invoice names them from the
     rail identity — GSTIN, legal name, state — and GSTR-1 reports the bill b2b to that GSTIN, under its bill number. */
  eq('the shop\'s invoice names the rail customer: GSTIN, legal name, state, registered',
    [eShop.buyer.Gstin, eShop.buyer.LglNm, eShop.buyer.State, eShop.buyer.RegType, eShop.buyer.entity_id], ['33BBBBB0000B1Z5', 'Chola Auto Care', '33', 'regular', CUST]);
  eq('…and the invoice\'s buyer block carries the GSTIN', eShop.invoice.BuyerDtls && eShop.invoice.BuyerDtls.Gstin, '33BBBBB0000B1Z5');
  ok('the shop\'s GSTR-1 reports the bill B2B to Chola\'s GSTIN, under the bill number — no b2cs row',
    gShop.b2b.length === 1 && gShop.b2b[0].ctin === '33BBBBB0000B1Z5' && gShop.b2b[0].inv[0].inum === 'C1/26-27/0041' && gShop.b2cs.length === 0, JSON.stringify({ b2b: gShop.b2b, b2cs: gShop.b2cs }));
  eq('…output tax unchanged (₹18 — the buyer\'s identity moved, never the tax)', lShop.output.tax, 18);
  /* a rail customer with no GSTIN stays B2C, exactly as the existing rules place it */
  IDS[CUST].gstn = null;
  const eNoG = await TC.entryFor(copy(SHOP, counterBj(named), recips), SHOP);
  const gNoG = T.gstr1(T.ledger([eNoG], eNoG.me), eNoG.me, '102026');
  eq('a rail customer with NO GSTIN stays b2cs (place of supply = the shop\'s state), output tax ₹18', [gNoG.b2b.length, gNoG.b2cs.length, gNoG.b2cs[0] && gNoG.b2cs[0].pos, T.ledger([eNoG], eNoG.me).output.tax], [0, 1, '33', 18]);
  IDS[CUST].gstn = '33BBBBB0000B1Z5';
  /* a walk-in, and an outside customer with a typed GSTIN, are what they were */
  const eWalk = await TC.entryFor(copy(SHOP, counterBj({ name: 'Walk-in' }), [Object.assign({ role: 'receiver' }, me(SHOP))]), SHOP);
  eq('a walk-in is unchanged: unregistered, b2cs', [eWalk.buyer.Gstin, eWalk.buyer.RegType, T.gstr1(T.ledger([eWalk], eWalk.me), eWalk.me, '102026').b2cs.length], [null, 'unregistered', 1]);
  const eTyped = await TC.entryFor(copy(SHOP, counterBj({ name: 'Acme', gstin: '29ACMEE0000A1Z5' }), [Object.assign({ role: 'receiver' }, me(SHOP))]), SHOP);
  eq('an outside customer with a TYPED GSTIN is unchanged: that GSTIN, inter-state', [eTyped.buyer.Gstin, eTyped.buyer.State, eTyped.buyer.entity_id], ['29ACMEE0000A1Z5', '29', null]);
  eq('⭐ the customer\'s GSTR-1 has NO outward supply from a bill they received', [gCust.b2b.length, gCust.b2cs.length, gCust.hsn.data.length], [0, 0, 0]);
  const g3 = T.gstr3b(lCust, eCust.me, '102026');
  ok('…and their GSTR-3B carries it as input credit, not output', JSON.stringify(g3).indexOf('18') >= 0 && lCust.output.total === 0, JSON.stringify(g3).slice(0, 300));

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });
