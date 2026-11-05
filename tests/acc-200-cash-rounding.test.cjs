/**
 * acc-200-cash-rounding.test.cjs — ACC-200 (lifecycle B3 S5-7b, S5-12): A COUNTER BILL'S PAYMENTS AGAINST ITS TAX INVOICE.
 *
 *   The gap posts as the round-off only inside the books pack's cash step (cashRounding.step_minor, read from the pack; AU 5c on a
 *   cash part). reg-in has no cashRounding: a rounded figure is never posted, so an Indian bill is exact to the paisa and a bill
 *   short or over by even 50p WAITS with the gap named, never absorbed in silence. Compared in minor units, so 0.1 + 0.2 is exact.
 *   Runs on the in-memory twin (tests/support/books-harness.cjs → books-memory.cjs) for an IN shop and an AU shop. No database.
 * Run: node tests/acc-200-cash-rounding.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const IN_SHOP = '11111111-1111-4111-8111-111111111111', AU_SHOP = 'aaaaaaaa-2222-4111-8111-111111111111', SUPP = '33333333-3333-4333-8333-333333333333';
const S_IN = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' };
const S_AU = { enabled: true, walkin_grain: 'day', country: 'AU', functional_currency: 'AUD' };
/* an IN invoice: 100 @18% (9 + 9) = ₹118; an AU invoice as the engine freezes it: one GST head, 9.12 + 0.91 = A$10.03 */
const invIn = (lines, more) => Object.assign({ currency: 'INR', ItemList: lines.map((x) => ({ GstRt: x[0], AssAmt: x[1], CgstAmt: x[2], SgstAmt: x[2], IgstAmt: 0, CesAmt: 0 })) }, more || {});
const invAu = () => ({ currency: 'AUD', _cb: { scheme: 'GST' }, ItemList: [{ GstRt: 10, AssAmt: 9.12, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, TaxAmt: 0.91, CesAmt: 0 }], ValDtls: { TotInvVal: 10.03 } });
const parts = (list) => ({ parts: list.map(([how, amount]) => ({ how, amount })) });

(async () => {
  console.log('\n══ ACC-200 · the cash step comes from the pack; none = exact to the minor unit ══\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); return; }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const sale = (cur, invoice, pay, setting, id) => K.classify({ chit: { chit_id: id || 'c1', purpose: 'order', currency_code: cur,
    business_json: { bill_no: 'C1-0001', till: { id: 'C1' }, billed_at: '2026-10-17T05:00:00Z', payment: pay } }, entry: { sells: true, invoice }, setting });
  const inSale = (pay) => sale('INR', invIn([[18, 100, 9]]), parts(pay), S_IN);
  const auSale = (pay) => sale('AUD', invAu(), parts(pay), S_AU);

  /* ── India: no cashRounding in reg-in ── */
  const exact = inSale([['Cash', 118]]);
  eq('IN · cash ₹118 on a ₹118 invoice → posts (waits for its day) with no round-off', [exact.kind, exact.bill && exact.bill.round_off], ['walkin', 0]);
  const short50 = inSale([['Cash', 117.5]]);
  eq('IN · cash ₹117.50 (short 50p) → WAITS, the gap as data (-50 paise)', [short50.kind, short50.gap_minor], ['queue', -50]);
  ok('…and the gap named in words: "short by ₹0.50", both figures', /short by ₹0\.50: paid ₹117\.50, tax invoice ₹118\./.test(short50.why || ''), short50.why);
  const over99 = inSale([['Cash', 118.99]]);
  eq('IN · cash ₹118.99 (over 99p) → WAITS, "over by ₹0.99"', [over99.kind, over99.gap_minor, /over by ₹0\.99/.test(over99.why || '')], ['queue', 99, true]);
  const short150 = inSale([['Cash', 116.5]]);
  eq('IN · cash ₹116.50 (short ₹1.50) → WAITS, as it always did, now with the gap named', [short150.kind, short150.gap_minor, /short by ₹1\.50/.test(short150.why || '')], ['queue', -150, true]);
  const split = inSale([['Cash', 18], ['UPI', 99.99]]);
  eq('IN · cash ₹18 + UPI ₹99.99 (short 1p) → WAITS: a paisa is a paisa', [split.kind, split.gap_minor], ['queue', -1]);

  /* ── Australia: cashRounding.step_minor 5 on cash (reg-au) ── */
  const au2 = auSale([['Cash', 10.01]]);
  eq('AU · cash A$10.01 on A$10.03 (2c, inside the 5c step) → posts the 2c as round-off, as today', [au2.kind, au2.bill && au2.bill.round_off], ['walkin', -0.02]);
  const au5 = auSale([['Cash', 10.05]]);
  eq('AU · cash A$10.05 on A$10.03 (+2c, the till\'s own rounding) → posts +0.02', [au5.kind, au5.bill && au5.bill.round_off], ['walkin', 0.02]);
  const au7 = auSale([['Cash', 9.96]]);
  eq('AU · cash A$9.96 (short 7c, outside the step) → WAITS, "short by AUD 0.07"', [au7.kind, au7.gap_minor, /short by AUD 0\.07/.test(au7.why || '')], ['queue', -7, true]);
  const auCard = auSale([['Card', 10.01]]);
  eq('AU · card A$10.01 (2c) → WAITS: the step is the cash tender\'s (the pack says card pays the exact total)', [auCard.kind, auCard.gap_minor], ['queue', -2]);
  const auMix = auSale([['Card', 5], ['Cash', 5.05]]);
  eq('AU · card A$5 + cash A$5.05 → posts +0.02 (the cash that pays the rest rounds)', [auMix.kind, auMix.bill && auMix.bill.round_off], ['walkin', 0.02]);

  /* ── minor units, never floats ── */
  const tenths = sale('INR', invIn([[0, 0.1, 0], [0, 0.2, 0]]), parts([['Cash', 0.1], ['UPI', 0.2]]), S_IN);
  eq('IN · lines 0.1 + 0.2 paid 0.1 + 0.2 → exact (no float noise reads as a gap)', [tenths.kind, tenths.bill && tenths.bill.round_off], ['walkin', 0]);
  const noisy = sale('INR', invIn([[0, 1.1, 0], [0, 2.2, 0], [5, 0.7, 0.02]]), parts([['Cash', 1.1], ['UPI', 2.94]]), S_IN);
  eq('IN · 1.1 + 2.2 + 0.74 (1.1 + 2.2 is 3.3000000000000003 in floats) paid 1.1 + 2.94 → exact', [noisy.kind, noisy.bill && noisy.bill.round_off], ['walkin', 0]);
  const declared = sale('INR', invIn([[18, 100, 9]], { ValDtls: { TotInvVal: 118.4, RndOffAmt: 0.4 } }), parts([['Cash', 118.4]]), S_IN);
  eq('an invoice that DECLARES its round-off (RndOffAmt 0.40) paid at its total → posts, the declared figure is no gap', [declared.kind, declared.bill && declared.bill.round_off], ['walkin', 0.4]);

  /* ── the buyer's copy of a counter bill: the same rule ── */
  const buyer = K.classify({ chit: { chit_id: 'b1', purpose: 'order', currency_code: 'INR', sender_entity_id: SUPP,
    business_json: { bill_no: 'C2-0007', till: { id: 'C2' }, billed_at: '2026-10-17T05:00:00Z', payment: parts([['Cash', 117.5]]) } },
  entry: { sells: false, seller: { entity_id: SUPP }, me: { entity_id: IN_SHOP }, invoice: invIn([[18, 100, 9]]) }, setting: S_IN, status: 'accepted' });
  eq('IN · the BUYER\'s copy paid ₹117.50 → waits with the gap, never a purchase with a silent round-off', [buyer.kind, buyer.gap_minor], ['queue', -50]);

  /* ── through the hook, on the twin: the IN wait is parked with the words; the AU 2c posts ── */
  const TC = require(path.join(H.API, 'lib', 'tax-copy')); const wasC = TC.copyOf, wasE = TC.entryFor;
  let copyNow = null, entryNow = null;
  TC.copyOf = async () => copyNow; TC.entryFor = async () => entryNow;
  const copy = (id, cur, pay) => ({ chit_id: id, purpose: 'order', currency_code: cur, created_at: '2026-10-17T05:00:00Z',
    business_json: { bill_no: 'C1-' + id, till: { id: 'C1' }, billed_at: '2026-10-17T05:00:00Z', payment: parts(pay) } });

  await X.store.saveSetting(X.db, IN_SHOP, { enabled: true, walkin_grain: 'bill', country: 'IN', functional_currency: 'INR' });
  await X.B.enable(X.db, IN_SHOP, { by: IN_SHOP, today: '2026-10-17' }); K.forget(IN_SHOP);
  copyNow = copy('p50', 'INR', [['Cash', 117.5]]); entryNow = { sells: true, invoice: invIn([[18, 100, 9]]) };
  const p50 = await K.postChit(IN_SHOP, 'p50', {});
  const row = X.T.outbox.find((o) => o.source_chit_id === 'p50' && !o.done_at);
  eq('IN · through postChit: ₹117.50 is parked on Waiting with "short by ₹0.50", nothing posted',
    [p50.queued, !!(row && /short by ₹0\.50/.test(row.why)), X.T.entries.filter((e) => e.source_ref === 'bill:p50').length], [true, true, 0]);
  copyNow = copy('p118', 'INR', [['Cash', 118]]);
  const p118 = await K.postChit(IN_SHOP, 'p118', {});
  const e118 = X.T.entries.find((e) => e.source_ref === 'bill:p118');
  ok('IN · through postChit: ₹118 exact posts its walk-in entry', !p118.queued && !!e118, JSON.stringify(p118));

  X.T.identities.push({ identity_id: AU_SHOP, gstn: '51824753556', display_name: 'Bondi Grocer', country: 'AU', policy_flags: { gst_registration: 'regular' } });
  await X.store.saveSetting(X.db, AU_SHOP, { enabled: true, walkin_grain: 'bill', country: 'AU', functional_currency: 'AUD', fy_start_month: 7 });
  await X.B.enable(X.db, AU_SHOP, { by: AU_SHOP, today: '2026-10-17' }); K.forget(AU_SHOP);
  copyNow = copy('a2', 'AUD', [['Cash', 10.01]]); entryNow = { sells: true, invoice: invAu() };
  const a2 = await K.postChit(AU_SHOP, 'a2', {});
  ok('AU · through postChit: cash A$10.01 on A$10.03 posts (2c round-off), not parked', !a2.queued && X.T.entries.some((e) => e.entity_id === AU_SHOP && e.source_ref === 'bill:a2'), JSON.stringify(a2));
  copyNow = copy('a7', 'AUD', [['Cash', 9.96]]);
  const a7 = await K.postChit(AU_SHOP, 'a7', {});
  eq('AU · through postChit: cash A$9.96 is parked, "short by AUD 0.07"', [a7.queued, /short by AUD 0\.07/.test(a7.why || '')], [true, true]);
  TC.copyOf = wasC; TC.entryFor = wasE;

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n\n' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
