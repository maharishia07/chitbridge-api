/**
 * rcm-return-1129.test.cjs — AQ-F-03 (walk AQ, 22 Nov 2026): a credit note on a reverse-charge bill takes the buyer's own tax BACK, per rate, from the bill's carried RCM rows — never worked out.
 * Hand figures, rupees: a legal opinion 1 x 1,000.00 at 18%, credit allowed. The bill posted: Dr purchases 1,000 · Dr Input CGST 90 + SGST 90 · Cr RCM payable CGST 90 + SGST 90 · Cr supplier 1,000.
 *   The whole of it returned must post: Dr supplier 1,000 · Cr purchase returns 1,000 · Dr RCM payable 90 + 90 · Cr Input 90 + 90 (the liability falls, the credit goes).
 *   GSTR-3B for the month: 3.1(d) txval 1,000 / 90 / 90 with the bill alone, 0 / 0 / 0 with the note; 4(B)(2) reversed 90 / 90; net credit 0.
 * Compared as carried totals: the books' RCM payable after the note (0) = the 3B's 3.1(d) tax after it (0); the Input ledger (0) = the 3B's net credit (0).
 * Run: node tests/rcm-return-1129.test.cjs
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
  console.log('\n== AQ-F-03 · a credit note on a reverse-charge bill reverses the liability and the credit ==\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const TL = require(path.join(H.API, 'lib', 'tax-lines'));
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const BUYER = { Gstin: '33AAAAA0000A1Z5', LglNm: 'Tally Test', State: '33', Pos: '33', Country: 'IN', RegType: 'regular' };
  const ADVOCATE = { Gstin: '33BBBBB1111B1Z2', LglNm: 'Chennai Law', State: '33', Country: 'IN', RegType: 'regular' };
  const line = { particulars: 'Legal opinion', quantity: 1, price: 1000, hsn: '9982', gst_rate: 18, rcm_category: 'legal' };
  const billIv = TL.invoiceFor({ lines: [line], seller: ADVOCATE, buyer: BUYER, currency: 'INR', chit_id: 'rcm-bill' }).invoice;
  const noteIv = TL.invoiceFor({ lines: [line], seller: ADVOCATE, buyer: BUYER, currency: 'INR', chit_id: 'rcm-note', purpose: 'credit_note' }).invoice;
  const chit = (id, purpose, iv) => ({ chit: { chit_id: id, created_at: '2026-09-10T05:00:00Z', purpose, business_json: {}, currency_code: 'INR' }, entry: { sells: false, seller: { entity_id: SUPP }, invoice: iv }, setting: S, status: 'accepted' });

  await X.store.saveSetting(X.db, SHOP, { enabled: true }); await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-04-01' }); K.forget(SHOP);
  X.T.parties.push({ owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Chennai Law', supplier: true, credit_days: 30 });
  const codeOf = (role) => (X.T.accounts.find((a) => a.entity_id === SHOP && a.role === role) || {}).code;
  const bill = K.classify(chit('rcm-bill', 'invoice', billIv));
  ok('the bill posts', (await X.B.postEntry(X.db, SHOP, Object.assign({}, bill.event, { source_chit_id: 'c0000000-0000-4000-8000-0000000000b1' }))).ok === true);

  const note = K.classify(chit('rcm-note', 'credit_note', noteIv));
  eq('the note classifies as purchase_return carrying the same RCM rows', [note.event.type, note.event.rcm], ['purchase_return', [{ rate: 18, itc: true, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }]]);
  const posted = await X.B.postEntry(X.db, SHOP, Object.assign({}, note.event, { source_chit_id: 'c0000000-0000-4000-8000-0000000000b2' }));
  ok('the note posts', posted.ok === true, JSON.stringify(posted));
  const entry = X.T.entries.find((x) => x.source_ref === 'chit:rcm-note');
  const lines = X.T.lines.filter((l) => l.entry_id === entry.entry_id).map((l) => [l.code, l.dr_minor, l.cr_minor]);
  const at = (code) => lines.filter((l) => l[0] === code).reduce((t, l) => [t[0] + l[1], t[1] + l[2]], [0, 0]);
  eq('the liability falls: Dr RCM payable CGST 2204 · SGST 2205, 90.00 each', [at(codeOf('rcm_cgst')), at(codeOf('rcm_sgst'))], [[9000, 0], [9000, 0]]);
  eq('the credit goes: Cr Input CGST 2210 · SGST 2211, 90.00 each', [at(codeOf('input_cgst')), at(codeOf('input_sgst'))], [[0, 9000], [0, 9000]]);
  eq('the supplier is debited the 1,000.00 only (the bill never credited him the tax)', at(codeOf('creditors')), [100000, 0]);
  ok('Dr = Cr', lines.reduce((t, l) => t + l[1] - l[2], 0) === 0, JSON.stringify(lines));
  const ledger = (role) => X.T.lines.filter((l) => l.code === codeOf(role)).reduce((t, l) => t + l.dr_minor - l.cr_minor, 0);
  eq('after bill and note: RCM payable CGST/SGST 0 and Input CGST/SGST 0 in the books', [ledger('rcm_cgst'), ledger('rcm_sgst'), ledger('input_cgst'), ledger('input_sgst')], [0, 0, 0, 0]);

  /* the return the shop files, read from the same two documents */
  const doc = (id, purpose, iv) => ({ chit_id: id, direction: 'received', sells: false, purpose, invoice: iv, provisional: false, seller: Object.assign({ entity_id: SUPP }, ADVOCATE), buyer: Object.assign({ entity_id: 'me' }, BUYER), at: '2026-09-10T05:00:00Z' });
  const ME = { Gstin: BUYER.Gstin, RegType: 'regular', Country: 'IN' };
  const file = (docs) => TL.gstr3b(TL.ledger(docs, ME), ME, '092026');
  const one = file([doc('rcm-bill', 'invoice', billIv)]);
  eq('3B with the bill alone: 3.1(d) 1000 / 90 / 90', [one.sup_details.isup_rev.txval, one.sup_details.isup_rev.camt, one.sup_details.isup_rev.samt], [1000, 90, 90]);
  const both = file([doc('rcm-bill', 'invoice', billIv), doc('rcm-note', 'credit_note', noteIv)]);
  eq('3B with the note: 3.1(d) 0 / 0 / 0', [both.sup_details.isup_rev.txval, both.sup_details.isup_rev.camt, both.sup_details.isup_rev.samt], [0, 0, 0]);
  eq('…4(B)(2) reversed 90 / 90 and net credit 0 / 0', [both.itc_elg.itc_rev.find((r) => r.ty === 'OTH').camt, both.itc_elg.itc_rev.find((r) => r.ty === 'OTH').samt, both.itc_elg.itc_net.camt, both.itc_elg.itc_net.samt], [90, 90, 0, 0]);
  eq('two carried totals agree: the books\' RCM payable after the note = the 3B\'s 3.1(d) tax', [ledger('rcm_cgst') + ledger('rcm_sgst'), both.sup_details.isup_rev.camt + both.sup_details.isup_rev.samt], [0, 0]);

  console.log('\n  ' + (fail ? '✗ ' : '✓ ') + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
