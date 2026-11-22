/**
 * rail-service-bill-expense-1128.test.cjs — WALK J J-F-06: a SERVICE bill on the rail (freight, legal fees) posts to an expense class, never to Purchases of stock-in-trade.
 * Hand (paise, India, GTA freight 10,000.00 at 18% reverse charge, SAC 996511, unregistered transporter):
 *   Dr sundry_expense 10,00,000 · Dr input CGST 90,000 · Dr input SGST 90,000 · Cr supplier 10,00,000 · Cr RCM CGST 90,000 · Cr RCM SGST 90,000 (credit = liability: zero cash tax)
 *   and Purchases is 0. A goods line on the same kind of bill stays Purchases (no catalogue guess on a rail invoice); the buyer's own choice beats the service default.
 * Two carried totals agree: the bill's total 10,00,000 = the expense debit; Dr = Cr across the entry.
 * Run: node tests/rail-service-bill-expense-1128.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '11111111-1111-4111-8111-111111111111', SUPP = '33333333-3333-4333-8333-333333333333';
const S = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' };

(async () => {
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const TL = require(path.join(H.API, 'lib', 'tax-lines'));
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const U = require(path.join(H.API, 'lib', 'bill-use'));
  const BUYER = { Gstin: '33AAAAA0000A1Z5', LglNm: 'Tally Test', State: '33', Pos: '33', Country: 'IN', RegType: 'regular' };
  const GTA = { LglNm: 'Sri Ram Transport', State: '33', Country: 'IN', RegType: 'unregistered' };
  const line = { particulars: 'Freight Salem to Chennai', quantity: 1, price: 10000, hsn: '996511', gst_rate: 18, rcm_category: 'gta' };
  const made = TL.invoiceFor({ lines: [line], seller: GTA, buyer: BUYER, currency: 'INR', chit_id: 'svc-1' });
  const copy = (bj) => ({ line_items: [Object.assign({ line_id: 'l1' }, line)], business_json: bj || {} });

  eq('the rail default: a SAC line (996511) is use, a goods line is resale, nothing read from a catalogue', [U.effective(copy(), null, { rail: true }).lines[0].use, U.effective({ line_items: [{ line_id: 'g', particulars: 'Tea', hsn: '0902' }], business_json: {} }, null, { rail: true }).lines[0].use], ['use', 'resale']);
  eq('the buyer\'s own choice beats the service default (bill marked resale)', U.effective(copy({ use: { bill: 'resale' } }), null, { rail: true }).lines[0].use, 'resale');

  await X.store.saveSetting(X.db, SHOP, { enabled: true }); await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-04-01' }); K.forget(SHOP);
  X.T.parties.push({ owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Sri Ram Transport', supplier: true, credit_days: 30 });
  const codeOf = (role) => (X.T.accounts.find((a) => a.entity_id === SHOP && a.role === role) || {}).code;
  const uses = U.effective(copy(), null, { rail: true });
  const c = K.classify({ chit: { chit_id: 'svc-1', created_at: '2026-09-10T05:00:00Z', purpose: 'invoice', business_json: {}, currency_code: 'INR' }, entry: { sells: false, seller: { entity_id: SUPP }, invoice: made.invoice }, setting: S, status: 'accepted', uses });
  eq('classify: one purchase_bill accepted for use, class sundry_expense, carrying the engine\'s rcm rows', [c.kind, c.events.map((e) => [e.type, e.accept, e.class]), (c.event.rcm || []).length], ['post', [['purchase_bill', 'use', 'sundry_expense']], 1]);
  const r = await X.B.postEntry(X.db, SHOP, Object.assign({}, c.events[0], { source_chit_id: 'c0000000-0000-4000-8000-0000000000cc' }));
  ok('it posts', r.ok === true, JSON.stringify(r));
  const e = X.T.entries.find((x) => x.source_ref === 'chit:svc-1');
  const lines = X.T.lines.filter((l) => l.entry_id === e.entry_id).map((l) => [l.code, l.dr_minor, l.cr_minor]);
  const at = (code) => lines.filter((l) => l[0] === code).reduce((t, l) => [t[0] + l[1], t[1] + l[2]], [0, 0]);
  const sum = (i) => lines.reduce((t, l) => t + l[i], 0);
  ok('Dr = Cr', sum(1) === sum(2), JSON.stringify(lines));
  eq('Purchases of stock-in-trade is 0', at(codeOf('purchases')), [0, 0]);
  eq('the expense class holds the 10,000 (1000000 paise)', at(codeOf('sundry_expense')), [1000000, 0]);
  eq('the supplier is credited 10,00,000, the credit equals the liability', [at(codeOf('creditors')), at(codeOf('input_cgst'))[0] === at(codeOf('rcm_cgst'))[1]], [[0, 1000000], true]);
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
