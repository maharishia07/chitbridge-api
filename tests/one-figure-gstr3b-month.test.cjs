/**
 * one-figure-gstr3b-month.test.cjs - ONE-FIGURE RC3 (Athi 28 Nov 2026, batch 1141): the India GSTR-3B month figures on /tax/ledger (output, itc, net by head, summed by tax-lines.ledger)
 * and on /tax/gstr?form=gstr3b (3.1(a), 4 ITC net, 6.1 set-off, built by the engine from the same rows) are the SAME figure.
 * WHAT THIS PROVES: two CARRIED totals compared per head, never computed twice - ledger sums against the engine re-summing the same rows. It does NOT prove ITC eligibility (the 3B is fed
 * the ledger rows and sides); eligibility is the ledger rule, proved in in-f08 / acc-269 / gstr-one-source. The journal month against the chit month is tests/gstr-one-source.test.cjs.
 * MUTATION: the summing is mutated AFTER the fact (a head dropped, output counted twice, a purchase read as a credit note); each must turn the compare red.
 * GOLDEN: netOf and setOffPreview keep their own shaping (ledger net keeps cess and negatives, the 6.1 preview carries no cess) - the values below were taken from the code BEFORE the set-off wrapper
 * (tax-lines.setOffRun) was introduced; a change in either shows here. Values are rupees (INR, the India pack).
 * Run: node tests/one-figure-gstr3b-month.test.cjs   OWNER cb-accounting
 */
'use strict';
const TL = require('../lib/tax-lines');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const ME = { Gstin: '29AAAAA0000A1Z5', LglNm: 'P Traders', State: '29', Pos: '29', Country: 'IN', RegType: 'regular' };
const OTHER = { Gstin: '33BBBBB1111B1Z2', LglNm: 'Chennai Supplier', State: '33', Country: 'IN', RegType: 'regular' };
const CUST = { LglNm: 'Walk-in', State: '29', Country: 'IN', RegType: 'unregistered' };
const mk = (id, dir, lines, seller, buyer, extra) => {
  const made = TL.invoiceFor({ lines, seller, buyer, currency: 'INR', chit_id: id, at: '2026-09-10' });
  return Object.assign({ chit_id: id, direction: dir, sells: dir === 'sent', purpose: 'invoice', invoice: made.invoice, provisional: false, seller: Object.assign({ entity_id: dir === 'sent' ? 'me' : 'sup' }, seller), buyer: Object.assign({ entity_id: dir === 'sent' ? 'c1' : 'me' }, buyer), at: '2026-09-10T05:00:00Z' }, extra || {});
};
const line = (price, rate) => [{ particulars: 'Goods', quantity: 1, price, hsn: '0902', gst_rate: rate }];
const sale = mk('s1', 'sent', line(1000, 18), ME, CUST);
const buy = mk('b1', 'received', line(500, 18), OTHER, ME);
const crn = mk('s2', 'sent', line(200, 18), ME, CUST, { purpose: 'credit_note' });
const bigCrn = mk('s3', 'sent', line(3000, 18), ME, CUST, { purpose: 'credit_note' });
const bcrn = mk('b2', 'received', line(100, 18), OTHER, ME, { purpose: 'credit_note' });
const expense = mk('e1', 'received', line(100, 18), OTHER, ME, { expense_itc: true });
const unreg = mk('b3', 'received', line(500, 18), Object.assign({}, OTHER, { RegType: 'unregistered' }), ME);
const rcm = mk('b4', 'received', line(100000, 5), OTHER, ME);
rcm.invoice.ValDtls.RcmIgstVal = 5000;
const MATRIX = { sale_and_purchase: [sale, buy], credit_note: [sale, crn, buy], purchase_return: [sale, buy, bcrn], expense_itc: [sale, expense], unregistered_seller: [sale, unreg], reverse_charge: [sale, rcm], credit_note_over_sales: [sale, bigCrn, buy] };
const r2 = (n) => Math.round(n * 100) / 100;
/** the two carried totals per head: the ledger sums (L) against the engine 3B (o); [] = they agree */
function diffs(L, o) {
  const out = [], d = o.sup_details.osup_det, n = o.itc_elg.itc_net;
  [['cgst', 'camt'], ['sgst', 'samt'], ['igst', 'iamt']].forEach(([h, k]) => {
    if (r2(L.output[h]) !== r2(d[k])) out.push('output ' + h + ' ledger ' + L.output[h] + ' 3.1(a) ' + d[k]);
    if (r2(L.itc[h]) !== r2(n[k])) out.push('itc ' + h + ' ledger ' + L.itc[h] + ' itc_net ' + n[k]);
  });
  return out;
}
for (const name of Object.keys(MATRIX)) {
  const L = TL.ledger(MATRIX[name], ME), o = TL.gstr3b(L, ME, '092026');
  ok(name + ': the 3B is built', !!(o.sup_details && o.itc_elg), JSON.stringify(o).slice(0, 200));
  if (!(o.sup_details && o.itc_elg)) continue;
  eq(name + ': ledger output / ITC by head = engine 3.1(a) / 4 net', diffs(L, o), []);
  const s = o._cb.setoff;
  if (s) ['cgst', 'sgst', 'igst'].forEach((h) => { if (L.output[h] >= 0) eq(name + ': ledger net ' + h + ' = set-off payable - carried', r2(L.net[h]), r2(s.payable[h] - s.carried[h])); });
}
/* the expense chit: built as an invoice (tax-copy), READ back through heads(): the ledger ITC and the 3B ITC both carry its 18.00 */
{
  const L = TL.ledger(MATRIX.expense_itc, ME), o = TL.gstr3b(L, ME, '092026');
  eq('expense chit: ITC 18.00 on the ledger and on 4 net', [L.itc.igst, o.itc_elg.itc_net.iamt], [18, 18]);
}
/* MUTATIONS of the summing, after the fact: each must go red */
{
  const L = TL.ledger(MATRIX.sale_and_purchase, ME), o = TL.gstr3b(L, ME, '092026');
  ok('mutation: a dropped ITC head turns the compare red', diffs(Object.assign({}, L, { itc: Object.assign({}, L.itc, { igst: 0 }) }), o).length > 0);
  ok('mutation: output counted twice turns the compare red', diffs(Object.assign({}, L, { output: Object.assign({}, L.output, { cgst: L.output.cgst * 2 }) }), o).length > 0);
  ok('mutation: a purchase read as a credit note turns the compare red', diffs(TL.ledger([sale, Object.assign({}, buy, { purpose: 'credit_note' })], ME), o).length > 0);
}
/* GOLDEN, from the code before the wrapper (rupees, INR) */
const G = {
  normal: { net: { cgst: 0, sgst: 17.78, igst: 0, cess: 0, vat: 0, total: 17.78 }, pre: { utilised: [{ from: 'igst', against: 'igst', amount: 160.16 }, { from: 'igst', against: 'cgst', amount: 228.81 }, { from: 'igst', against: 'sgst', amount: 211.03 }], payable: { cgst: 0, sgst: 17.78, igst: 0 }, carried: { cgst: 0, sgst: 0, igst: 0 }, pay_total: 17.78 } },
  cess: { net: { cgst: 70, sgst: 70, igst: 0, cess: 7, vat: 0, total: 147 }, pre: { utilised: [{ from: 'cgst', against: 'cgst', amount: 30 }, { from: 'sgst', against: 'sgst', amount: 30 }], payable: { cgst: 70, sgst: 70, igst: 0 }, carried: { cgst: 0, sgst: 0, igst: 0 }, pay_total: 140 } },
  negout: { net: { cgst: -70, sgst: -70, igst: -10, cess: 0, vat: 0, total: -150 }, pre: null },
  leftover: { net: { cgst: 0, sgst: 0, igst: -70, cess: 0, vat: 0, total: -70 }, pre: { utilised: [{ from: 'igst', against: 'cgst', amount: 10 }, { from: 'igst', against: 'sgst', amount: 10 }], payable: { cgst: 0, sgst: 0, igst: 0 }, carried: { cgst: 0, sgst: 0, igst: 70 }, pay_total: 0 } }
};
const CASES = {
  normal: [{ cgst: 228.81, sgst: 228.81, igst: 160.16, cess: 0 }, { cgst: 0, sgst: 0, igst: 600, cess: 0 }],
  cess: [{ cgst: 100, sgst: 100, igst: 0, cess: 12 }, { cgst: 30, sgst: 30, igst: 0, cess: 5 }],
  negout: [{ cgst: -50, sgst: -50, igst: 0, cess: 0 }, { cgst: 20, sgst: 20, igst: 10, cess: 0 }],
  leftover: [{ cgst: 10, sgst: 10, igst: 0, cess: 0 }, { cgst: 0, sgst: 0, igst: 90, cess: 0 }]
};
for (const k of Object.keys(CASES)) {
  eq('golden ' + k + ': ledger net (cess and negatives kept)', TL.netOf(CASES[k][0], CASES[k][1]), G[k].net);
  eq('golden ' + k + ': 6.1 preview (no cess; null when refused)', TL.setOffPreview(CASES[k][0], CASES[k][1]), G[k].pre);
}
console.log((pass + fail) + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
