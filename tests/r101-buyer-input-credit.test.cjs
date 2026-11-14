/**
 * tests/r101-buyer-input-credit.test.cjs — R1 slice A (DEC-267): A BUYER WHO MAY NOT CLAIM THE TAX. Scenario ids R101-AU / R101-AE / R101-IN.
 *   classify() is pure; postChit hands it `buyerRegistration` (country-setup.registrationOfShop) and, for a supplier credit note, `originalTookNoCredit`.
 *   regular / nothing read → the credit is claimed, as before · unregistered / composition → no credit: a bill carries input_credit:false (the engine folds the tax into
 *   the cost), an expense is handed the GROSS and no tax · unknown → a purchase that CARRIES input tax waits with the question; one with no tax posts (nothing to claim).
 *   A supplier return follows the ORIGINAL bill's entry, never today's registration.
 * Hand figures (major units): AU bill 1,000 + 100 GST · AE 1,000 + 50 VAT · IN 1,000 + 180 (CGST 90 + SGST 90) · AU expense paid 165 incl GST 15.
 * Run: node tests/r101-buyer-input-credit.test.cjs      CARD 14-accounting (R1 slice A)
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SUPP = '33333333-3333-4333-8333-333333333333';
const AU = { enabled: true, walkin_grain: 'day', country: 'AU', functional_currency: 'AUD' };
const IN = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' };
const auInv = (tax) => ({ currency: 'AUD', _cb: { scheme: 'GST' }, ItemList: [{ GstRt: tax ? 10 : 0, AssAmt: 1000, TaxAmt: tax ? 100 : 0, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: tax ? 1100 : 1000 } });
const inInv = { currency: 'INR', ItemList: [{ GstRt: 18, AssAmt: 1000, CgstAmt: 90, SgstAmt: 90, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 1180 } };
const received = (invoice, setting, extra) => ({ chit: { chit_id: 'p1', created_at: '2026-11-12T05:00:00Z', purpose: 'invoice', currency_code: setting.functional_currency, business_json: {} }, entry: { sells: false, seller: { entity_id: SUPP, Country: setting.country }, invoice }, setting, status: 'accepted', ...extra });

(async () => {
  console.log('\n== R1-01: the buyer who may not claim the tax ==\n');
  H.load();
  const K = require(path.join(H.API, 'lib', 'books-hooks'));

  const claim = K.classify(received(auInv(true), AU, { buyerRegistration: 'regular' }));
  ok('R101 control: a registered buyer keeps the credit (no flag)', claim.kind === 'post' && claim.event.type === 'purchase_bill' && claim.event.input_credit === undefined, JSON.stringify(claim).slice(0, 200));
  const unread = K.classify(received(auInv(true), AU));
  ok('nothing read (the migration is not run): as before, no flag, no wait', unread.kind === 'post' && unread.event.input_credit === undefined);
  const no = K.classify(received(auInv(true), AU, { buyerRegistration: 'unregistered' }));
  ok('R101-AU: an UNREGISTERED buyer: purchase_bill carries input_credit:false', no.kind === 'post' && no.event.input_credit === false, JSON.stringify(no).slice(0, 200));
  const comp = K.classify(received(inInv, IN, { buyerRegistration: 'composition' }));
  ok('R101-IN: a COMPOSITION buyer: no credit either', comp.kind === 'post' && comp.event.input_credit === false);
  const unk = K.classify(received(auInv(true), AU, { buyerRegistration: 'unknown' }));
  ok('R101-AU: an UNKNOWN registration with tax on the bill WAITS with the question and its code', unk.kind === 'queue' && unk.code === 'TAX_REGISTRATION_UNKNOWN' && /registered for/.test(unk.why) && /posts then/.test(unk.why), JSON.stringify(unk));
  const untaxed = K.classify(received(auInv(false), AU, { buyerRegistration: 'unknown' }));
  ok('an unknown registration with NO tax on the bill posts: nothing to claim, nothing asked', untaxed.kind === 'post' && untaxed.event.input_credit === undefined, JSON.stringify(untaxed).slice(0, 200));

  /* the engine: the flag really moves the tax into the cost, on the adopted posting engine (one calculation, the engine's) */
  const P = require(path.join(H.API, 'lib', 'posting'));
  const AUPACK = require(path.join(H.API, 'lib', 'reg-au'));
  const posted = (event) => P.post(event, { pack: AUPACK });
  const lines = (r, acct) => r.lines.filter((l) => l.account === acct).reduce((s, l) => s + l.dr - l.cr, 0);
  const rNo = posted(no.event), rYes = posted(claim.event);
  eq('engine, no credit: Dr purchases 1,100.00, no gst_paid', [Math.round(lines(rNo, 'purchases') * 100), lines(rNo, 'gst_paid')], [110000, 0]);
  eq('engine, credit: Dr purchases 1,000.00 + gst_paid 100.00', [Math.round(lines(rYes, 'purchases') * 100), Math.round(lines(rYes, 'gst_paid') * 100)], [100000, 10000]);

  console.log('\n— an expense: the api hands the engine the GROSS —\n');
  const expense = (setting, reg) => K.classify({ chit: { chit_id: 'x1', created_at: '2026-11-12T05:00:00Z', purpose: 'expense', business_json: { till: { id: 'C1' }, expense: { what: 'Power', mode: 'Bank', amount: 165, class: 'electricity', input_tax: { gst: 15 } } } }, entry: {}, setting, buyerRegistration: reg });
  const eReg = expense(AU, 'regular'), eNo = expense(AU, 'unregistered'), eUnk = expense(AU, 'unknown');
  eq('registered: net 150 + input tax gst 15 (as before)', [eReg.event.amount, eReg.event.input_tax], [150, { gst: 15 }]);
  eq('R101-AU unregistered: amount 165 (what was paid), no input_tax', [eNo.event.amount, eNo.event.input_tax], [165, undefined]);
  ok('unknown + typed tax: waits with the question', eUnk.kind === 'queue' && eUnk.code === 'TAX_REGISTRATION_UNKNOWN');
  const eNoTax = K.classify({ chit: { chit_id: 'x2', created_at: '2026-11-12T05:00:00Z', purpose: 'expense', business_json: { till: { id: 'C1' }, expense: { what: 'Tea', mode: 'Cash', amount: 40 } } }, entry: {}, setting: AU, buyerRegistration: 'unknown' });
  ok('unknown + NO typed tax: posts whole to the class (nothing to claim: no flood of the queue)', eNoTax.kind === 'post' && eNoTax.event.amount === 40);
  const grossPosted = posted(eNo.event);
  eq('engine: the expense posts Dr electricity 165.00, no gst_paid, Cr bank 165.00', [Math.round(lines(grossPosted, 'electricity') * 100), lines(grossPosted, 'gst_paid')], [16500, 0]);

  console.log('\n— a supplier credit note follows the ORIGINAL bill —\n');
  const note = (extra) => K.classify({ chit: { chit_id: 'n1', created_at: '2026-11-13T05:00:00Z', purpose: 'credit_note', currency_code: 'AUD', business_json: { bill_no: 'CN-9', against: { chit_id: 'p1' } } },
    entry: { sells: false, seller: { entity_id: SUPP, Country: 'AU' }, invoice: auInv(true) }, setting: AU, ...extra });
  eq('the original took no credit → purchase_return input_credit:false', [note({ originalTookNoCredit: true }).event.type, note({ originalTookNoCredit: true }).event.input_credit], ['purchase_return', false]);
  eq('the original took the credit (or is unknown) → as before, no flag, whatever today\'s registration says', [note({ originalTookNoCredit: false, buyerRegistration: 'unregistered' }).event.input_credit, note({ originalTookNoCredit: null }).event.input_credit], [undefined, undefined]);

  console.log('\n— a counter bill I bought, for use: the expense part is gross —\n');
  const boughtUse = K.classify({ chit: { chit_id: 'b1', created_at: '2026-11-12T05:00:00Z', purpose: 'order', sender_entity_id: SUPP, currency_code: 'AUD', business_json: { bill_no: 'B-1', till: { id: 'T' }, payment: { parts: [{ how: 'Cash', amount: 1100 }] } } },
    entry: { sells: true, me: { entity_id: 'me' }, seller: { entity_id: SUPP, Country: 'AU' }, invoice: auInv(true) }, setting: AU, status: 'accepted', uses: { lines: [{ use: 'use', name: 'Goods' }] }, buyerRegistration: 'unregistered' });
  const ex = boughtUse.event; /* a use-only bill is ONE event: postChit posts verdict.event, so assert on it */
  ok('R101: the use part of a bought counter bill (unregistered buyer) is an expense of the gross 1,100, no input tax', !!ex && ex.amount === 1100 && ex.input_tax === undefined, JSON.stringify(boughtUse).slice(0, 300));

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n\n' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
