/**
 * rcm-post.test.cjs — RCM-POST (2026-10-14): a purchase the India pack marks reverse-charge posts the buyer's own tax through books-hooks.
 *
 * The chain this round switches on, end to end and READ at every step (never a second sum):
 *   a supplier bill's line NAMES its reverse-charge category (line_items[].rcm_category = the pack's id)
 *   → tax-lines.invoiceFor asks the engine for the RECIPIENT's view (rcm) → the frozen invoice carries the RCM heads, no supplier tax
 *   → books-hooks.classify hands tax.moneyOf(inv).rcm.rows to the posting engine → purchase_bill: Cr RCM payable 2204–2206 (the liability)
 *     and Dr Input CGST/SGST (the credit, when the notification allows it) — two tax lines that net to ZERO cash tax on the bill
 *   → GSTR-3B reads it as 3.1(d) + 4(A)(3) (tests/books-rcm.test.cjs covers the close / challan).
 * A bill with no marked line is unchanged (no rcm key; the supplier's forward tax as before). AU and AE are untouched: a marked line under
 * a pack with no RCM table (AU rcm: null) or no state split (AE) carries no RCM head. Run: node tests/rcm-post.test.cjs
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
  console.log('\n══ RCM-POST — a reverse-charge purchase posts the liability and the credit; nothing else moves ══\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const TL = require(path.join(H.API, 'lib', 'tax-lines'));
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const BUYER = { Gstin: '33AAAAA0000A1Z5', LglNm: 'Tally Test', State: '33', Pos: '33', Country: 'IN', RegType: 'regular' };
  const GTA = { LglNm: 'Sri Ram Transport', State: '33', Country: 'IN', RegType: 'unregistered' };   /* an unregistered transporter: s.9(3), always RCM */
  const REG = { Gstin: '33BBBBB1111B1Z2', LglNm: 'Chennai Tea Traders', State: '33', Country: 'IN', RegType: 'regular' };
  const chit = (id, i, cur) => ({ chit: { chit_id: id, created_at: '2026-09-10T05:00:00Z', purpose: 'invoice', business_json: {}, currency_code: cur || 'INR' },
                                  entry: { sells: false, seller: { entity_id: SUPP }, invoice: i }, setting: S, status: 'accepted' });

  /* 1 · the switch: a line that names its category is assessed as the recipient's purchase — the pack's rate and credit, no supplier tax */
  const freight = TL.invoiceFor({ lines: [{ particulars: 'Freight Salem to Chennai', quantity: 1, price: 10000, hsn: '996511', gst_rate: 18, rcm_category: 'gta' }],
                                  seller: GTA, buyer: BUYER, currency: 'INR', chit_id: 'rcm-18' });
  const it = freight.invoice.ItemList[0];
  eq('invoiceFor marks the GTA line: RcmCd gta · 18% with credit · CGST 900 + SGST 900 in the RCM heads · none charged by the supplier',
     [it.RcmCd, it.RcmItc, it.RcmCgstAmt, it.RcmSgstAmt, it.CgstAmt, it.SgstAmt], ['gta', true, 900, 900, 0, 0]);
  eq('…the invoice says so (RegRev Y, _cb.rcm) and its total is the supplier\'s bill: 10,000, tax 0 on the heads a screen sums',
     [freight.invoice.TranDtls.RegRev, (freight.invoice._cb.rcm || []).length, TL.heads(freight.invoice).total, TL.heads(freight.invoice).tax], ['Y', 1, 10000, 0]);
  eq('…rated: a marked line counts as rated (the notification rates it)', [freight.rated, freight.unrated], [1, 0]);
  const noRate = TL.invoiceFor({ lines: [{ particulars: 'Freight', quantity: 1, price: 10000, hsn: '996511', rcm_category: 'gta' }], seller: GTA, buyer: BUYER, currency: 'INR' });
  eq('a marked line with no rate takes the pack\'s first option (GTA 5%, no credit) — never 0%', [noRate.invoice.ItemList[0].GstRt, noRate.invoice.ItemList[0].RcmItc, noRate.invoice.ItemList[0].RcmCgstAmt], [5, false, 250]);

  /* 2 · the books: two tax lines, netting to zero cash tax — Cr 2204/2205 (liability) · Dr 2210/2211 (credit); the supplier is credited 10,000 */
  await X.store.saveSetting(X.db, SHOP, { enabled: true }); await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-04-01' }); K.forget(SHOP);
  X.T.parties.push({ owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Sri Ram Transport', supplier: true, credit_days: 30 });
  const codeOf = (role) => (X.T.accounts.find((a) => a.entity_id === SHOP && a.role === role) || {}).code;
  const c = K.classify(chit('rcm-18', freight.invoice));
  eq('classify → purchase_bill carrying the engine\'s rcm rows (read from the frozen invoice)', [c.kind, c.event.type, c.event.rcm], ['post', 'purchase_bill', [{ rate: 18, itc: true, taxable: 10000, cgst: 900, sgst: 900, igst: 0 }]]);
  const r = await X.B.postEntry(X.db, SHOP, Object.assign({}, c.event, { source_chit_id: 'c0000000-0000-4000-8000-0000000000bb' }));
  ok('it posts', r.ok === true, JSON.stringify(r));
  const e = X.T.entries.find((x) => x.source_ref === 'chit:rcm-18');
  const lines = X.T.lines.filter((l) => l.entry_id === e.entry_id).map((l) => [l.code, l.dr_minor, l.cr_minor]);
  const at = (code) => lines.filter((l) => l[0] === code).reduce((t, l) => [t[0] + l[1], t[1] + l[2]], [0, 0]);
  const sum = (i) => lines.reduce((t, l) => t + l[i], 0);
  ok('Dr = Cr', sum(1) === sum(2), JSON.stringify(lines));
  eq('the liability: Cr RCM payable CGST 2204 · SGST 2205, 900 each', [at(codeOf('rcm_cgst')), at(codeOf('rcm_sgst'))], [[0, 90000], [0, 90000]]);
  eq('the credit: Dr Input CGST 2210 · SGST 2211, 900 each', [at(codeOf('input_cgst')), at(codeOf('input_sgst'))], [[90000, 0], [90000, 0]]);
  ok('the two tax lines net to ZERO cash tax on the bill (credit = liability per head)',
     at(codeOf('input_cgst'))[0] === at(codeOf('rcm_cgst'))[1] && at(codeOf('input_sgst'))[0] === at(codeOf('rcm_sgst'))[1], JSON.stringify(lines));
  eq('the supplier is credited the bill WITHOUT the tax: 10,000', at(codeOf('creditors')), [0, 1000000]);
  eq('the purchase is the taxable value: 10,000 (the tax is credit, not cost)', at(codeOf('purchases')), [1000000, 0]);

  /* 3 · a non-RCM purchase is unchanged: no rcm key, the supplier's forward tax posts to input credit as before */
  const plain = TL.invoiceFor({ lines: [{ particulars: 'Tea', quantity: 1, price: 1000, hsn: '0902', gst_rate: 5 }], seller: REG, buyer: BUYER, currency: 'INR', chit_id: 'plain-1' });
  const p = K.classify(chit('plain-1', plain.invoice));
  ok('no marked line → the event carries no rcm key and the invoice no RCM head', p.kind === 'post' && p.event.rcm === undefined && !('RcmCd' in plain.invoice.ItemList[0]) && plain.invoice.TranDtls.RegRev === 'N', JSON.stringify([p.event.rcm, plain.invoice.ItemList[0]]));
  eq('…its heads are the forward tax: CGST 25 + SGST 25 on 1,000', [TL.heads(plain.invoice).cgst, TL.heads(plain.invoice).sgst, TL.heads(plain.invoice).total], [25, 25, 1050]);
  /* the SAME SAC without the mark is not matched by prefix — the engine's code fallback runs only on a bill with a marked line */
  const unmarked = TL.invoiceFor({ lines: [{ particulars: 'Freight', quantity: 1, price: 10000, hsn: '996511', gst_rate: 18 }], seller: REG, buyer: BUYER, currency: 'INR' });
  ok('a registered carrier\'s freight line with no mark stays forward charge (CGST 900 charged by the supplier, no RCM head)', unmarked.invoice.ItemList[0].CgstAmt === 900 && !('RcmCd' in unmarked.invoice.ItemList[0]), JSON.stringify(unmarked.invoice.ItemList[0]));

  /* 4 · country-first: AU (rcm: null) and AE (no state split) are untouched by a marked line */
  const au = TL.invoiceFor({ lines: [{ particulars: 'Freight', quantity: 1, price: 1000, gst_rate: 10, rcm_category: 'gta' }], seller: { Country: 'AU', LglNm: 'Oz Haulage', Gstin: '51824753556' }, buyer: { Country: 'AU', LglNm: 'Oz Shop', Gstin: '53004085616' }, currency: 'AUD' });
  ok('AU: no RCM head, the GST charged as before (A$100 on 1,000)', !('RcmCd' in au.invoice.ItemList[0]) && !au.invoice._cb.rcm && au.invoice.TranDtls.RegRev === 'N' && TL.heads(au.invoice).tax === 100, JSON.stringify([au.invoice.ItemList[0], TL.heads(au.invoice)]));
  const ae = TL.invoiceFor({ lines: [{ particulars: 'Freight', quantity: 1, price: 1000, gst_rate: 5, rcm_category: 'gta' }], seller: { Country: 'AE', LglNm: 'Gulf Haulage', Gstin: '100000000000003' }, buyer: { Country: 'AE', LglNm: 'Gulf Shop', Gstin: '100000000000004' }, currency: 'AED' });
  ok('AE: no RCM head, the VAT charged as before (AED 50 on 1,000)', !('RcmCd' in ae.invoice.ItemList[0]) && !ae.invoice._cb.rcm && TL.heads(ae.invoice).tax === 50, JSON.stringify([ae.invoice.ItemList[0], TL.heads(ae.invoice)]));
  const aeC = K.classify(chit('ae-1', ae.invoice, 'AED'));
  ok('…and the AE bill\'s event carries no rcm key', aeC.event ? aeC.event.rcm === undefined : true, JSON.stringify(aeC));

  console.log('\n  ' + (fail ? '✗ ' : '✓ ') + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
