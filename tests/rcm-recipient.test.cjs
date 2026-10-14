/**
 * tests/rcm-recipient.test.cjs — SIGNIN-CONST (2026-10-14): A PURCHASE THE INDIA PACK MARKS REVERSE-CHARGE REACHES THE BOOKS.
 *
 * The engine was complete (tax.determine `rcm` → moneyOf().rcm.rows → books-hooks rcmOf → posting rcmLines_, tests/books-rcm.test.cjs) but
 * the opt-in was passed nowhere live: tax-lines.invoiceFor dropped it, so no recipient's copy ever froze an Rcm* line and nothing posted.
 * Now tax-copy.entryFor assesses MY purchase as the recipient's when MY pack carries reverse-charge categories (tax-lines.rcmOptIn):
 *   · an Indian registered shop's receipt of an unregistered transporter's freight bill (F10/F11) → Rcm lines frozen → purchase_bill carrying rcm rows
 *   · the same assessment without the opt-in (the old path) → none — the control
 *   · an Australian shop's receipt → none (its pack has no RCM categories); a shop with no country → never opted in (no national default)
 *   · the shop's own SALE copy → never opted in; a FROZEN invoice is read as it is, never re-assessed
 * No database: identities from a stub; the books harness injects the engines. Run: node tests/rcm-recipient.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const SHOP = '11111111-1111-4111-8111-111111111111', AUSHOP = '44444444-4444-4444-8444-444444444444', SUPP = '33333333-3333-4333-8333-333333333333', NOC = '55555555-5555-4555-8555-555555555555';
const IDS = {
  [SHOP]: { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', policy_flags: {} },
  [AUSHOP]: { identity_id: AUSHOP, gstn: '51824753556', display_name: 'Harbour Hardware', country: 'AU', policy_flags: {} },
  [SUPP]: { identity_id: SUPP, gstn: null, display_name: 'Sri Ram Transport', country: 'IN', policy_flags: {} },
  [NOC]: { identity_id: NOC, gstn: '33CCCCC0000C1Z5', display_name: 'No Country Stores', country: null, policy_flags: {} },
};

(async () => {
  console.log('\n══ REVERSE CHARGE — the recipient\'s copy is assessed, frozen and posted ══\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  /* the harness stubbed db; tax-copy's one identities read answers from the stub above, everything else stays the harness's */
  const base = X.dbStub;
  require.cache[require.resolve(path.join(H.API, 'db'))] = { exports: Object.assign({}, base, {
    query: async (sql, params) => /FROM identities WHERE identity_id = ANY/.test(sql) ? { rows: params[0].map((id) => IDS[id]).filter(Boolean) } : base.query(sql, params),
  }) };
  delete require.cache[require.resolve(path.join(H.API, 'lib', 'tax-copy'))];
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  const T = require(path.join(H.API, 'lib', 'tax-lines'));
  const TX = require(path.join(H.API, 'lib', 'tax'));
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const S = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' };

  /* F10 + F11: my counter receipt carrying their bill no. + total, the supplier picked from my list (an unregistered transporter) */
  const receipt = (me, over) => Object.assign({ chit_id: 'r1', sender_entity_id: me, purpose: 'receipt', current_status: 'accepted',
    all_recipients: [{ role: 'sender', entity_id: me }], created_at: '2026-09-10T05:00:00Z', sent_at: '2026-09-10T05:00:00Z', currency_code: 'INR',
    business_json: { their_bill: { no: 'GTA-17', total: 10000 }, party: { name: 'Sri Ram Transport', party_id: SUPP }, input_tax: { vendor_state: '33', inclusive: false } },
    line_items: [{ line_id: 'l1', particulars: 'Freight Salem to Chennai', quantity: 1, price: 10000, total: 10000, gst_rate: 5, hsn: '996511' }] }, over || {});

  /* 1. the gate: whose pack carries reverse charge */
  eq('rcmOptIn: India yes · Australia no · no country no (never India by default)', [T.rcmOptIn({ Country: 'IN' }), T.rcmOptIn({ Country: 'AU' }), T.rcmOptIn({ Country: null }), T.rcmOptIn(null)], [true, false, false, false]);

  /* 2. the recipient's copy: assessed as MY purchase, the Rcm lines frozen on the invoice */
  const e = await TC.entryFor(receipt(SHOP), SHOP);
  eq('my receipt of their bill is my purchase (sells false), the supplier unregistered', [e.sells, e.seller.entity_id, !!e.seller.Gstin, e.buyer.Gstin], [false, SUPP, false, '33AAAAA0000A1Z5']);
  const rcm = e.invoice._cb && e.invoice._cb.rcm;
  eq('…the invoice carries ONE reverse-charge line: GTA 5%, no credit (the pack\'s option), on line 1', rcm && rcm.map((x) => [x.line, x.category, x.rate, x.itc]), [[0, 'gta', 5, false]]);
  eq('…the supplier\'s bill carries NO tax (CGST 0 · SGST 0); the tax sits in the RCM heads', [e.invoice.ValDtls.CgstVal, e.invoice.ValDtls.SgstVal, e.invoice.ValDtls.TotInvVal, e.invoice.ValDtls.RcmCgstVal, e.invoice.ValDtls.RcmSgstVal], [0, 0, 10000, 250, 250]);
  eq('…and moneyOf reads the rows books-hooks hands to posting', TX.moneyOf(e.invoice, 'INR').rcm.rows, [{ rate: 5, itc: false, taxable: 10000, cgst: 250, sgst: 250, igst: 0 }]);

  /* 3. the control: the same lines through invoiceFor WITHOUT the opt-in — what every live copy got before this round */
  const plain = T.invoiceFor({ lines: receipt(SHOP).line_items, seller: e.seller, buyer: e.buyer, currency: 'INR' }).invoice;
  ok('without the opt-in the invoice has no reverse-charge line (the old live path — nothing to post)', !(plain._cb && plain._cb.rcm), JSON.stringify(plain._cb));

  /* 4. books-hooks: the accepted receipt → purchase_bill carrying the engine's rcm rows (read, never recomputed) */
  const c = K.classify({ chit: receipt(SHOP), entry: e, setting: S, status: 'accepted', party: SUPP });
  eq('the accepted receipt posts as purchase_bill with the rcm rows for posting (Cr RCM payable 2204/2205; no credit at 5%)', [c.kind, c.event && c.event.type, c.event && c.event.party, c.event && c.event.rcm], ['post', 'purchase_bill', SUPP, [{ rate: 5, itc: false, taxable: 10000, cgst: 250, sgst: 250, igst: 0 }]]);

  /* 5. country-first: an Australian shop's receipt of the same freight is never read under India's notifications */
  const au = await TC.entryFor(receipt(AUSHOP, { currency_code: 'AUD', line_items: [{ line_id: 'l1', particulars: 'Freight Perth to Fremantle', quantity: 1, price: 1000, total: 1000, gst_rate: 10, hsn: '996511' }] }), AUSHOP);
  ok('an AU shop\'s purchase carries no reverse-charge line (its pack has no RCM categories)', au.sells === false && !(au.invoice._cb && au.invoice._cb.rcm), JSON.stringify(au.invoice._cb));
  const noc = await TC.entryFor(receipt(NOC), NOC);
  ok('a shop with NO country is never opted in — no national default', noc.sells === false && !(noc.invoice._cb && noc.invoice._cb.rcm), JSON.stringify(noc.invoice._cb));

  /* 6. my own SALE copy never opts in; a FROZEN invoice is read as it is */
  const sale = await TC.entryFor({ chit_id: 's1', sender_entity_id: SHOP, purpose: 'order', all_recipients: [{ role: 'sender', entity_id: SHOP }, { role: 'receiver', entity_id: SHOP }],
    business_json: { customer: { name: 'Walk-in' }, till: { id: 'C1' }, bill_no: 'C1/26-27/0042', payment: { parts: [{ how: 'Cash', amount: 10500 }] } },
    created_at: '2026-09-10T05:00:00Z', sent_at: '2026-09-10T05:00:00Z', currency_code: 'INR', line_items: receipt(SHOP).line_items }, SHOP);
  ok('the shop\'s own sale copy is never assessed as a purchase (no reverse-charge line)', sale.sells === true && !(sale.invoice._cb && sale.invoice._cb.rcm), JSON.stringify(sale.invoice._cb));
  const frozen = await TC.entryFor(receipt(SHOP, { business_json: Object.assign({}, receipt(SHOP).business_json, { invoice: Object.assign({ frozen_at: '2026-09-01T00:00:00Z' }, plain) }) }), SHOP);
  ok('a copy already FROZEN keeps its invoice as it was — never re-assessed, so no posted book moves', frozen.frozen === true && !(frozen.invoice._cb && frozen.invoice._cb.rcm));

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
