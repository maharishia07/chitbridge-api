/**
 * acc-377-foreign-invoice.test.cjs — ACC-377: A FOREIGN-CURRENCY INVOICE ON THE RAIL (AU seller → IN buyer), END TO END ON THE IN-MEMORY TWIN.
 * Critic: PM/critic/ACC-377-RAIL-FX-CRITIC-2026-11-19.md (hand-computed T1–T12, minor units; rates are illustrative). Answers: DECISIONS.md "2026-11-19 · ACC-377".
 *
 *   PART A · THE HOOK (postChit, accept → park → add supplier → park → add rate → post), as main does today:  T2 · T6 · T12   (green before and after the build)
 *   PART B · THE HOSTILE FIXTURES, written BEFORE the build:                                                  T3 · T4 · T5 · T8 · T9 · T10   (red on main: a payment cannot state its rate)
 *   PART C · THE ANSWERS the build adds:  (a) the bank's rate on a payment · (b) INR paid against an AUD bill settles it · (c) the accept says "waiting" ·
 *             (d) no rate for the day → the last earlier rate is SUGGESTED, never posted on its own.
 * One calculation: every figure is CBPosting's (fx_settlement); nothing here computes a gain — the expected numbers are the critic's, by hand.
 * Run: node tests/acc-377-foreign-invoice.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
async function threw(fn) { try { await fn(); return null; } catch (e) { return e; } }

const SHOP = '11111111-1111-4111-8111-377377377377';
const SUP = '55555555-5555-4555-8555-377377377377';
const SUPS = ['3', '4', '5', '8', '9', 'a', 'b'].map((x, i) => '6666666' + i + '-6666-4666-8666-37737737737' + x);
const S_IN = { enabled: true, walkin_grain: 'bill', country: 'IN', functional_currency: 'INR' };
/* the AU export invoice as the rail carries it: GST-free, AUD 1,000.00 (walk RL1: GST 0) */
const INV_AUD = { currency: 'AUD', ItemList: [{ GstRt: 0, AssAmt: 1000, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 1000 } };

(async () => {
  console.log('\n══ ACC-377 · a foreign-currency invoice on the rail ══\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); return; }
  const { B, T, db } = X;
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const FX = require(path.join(H.API, 'lib', 'fx-rates'));
  require(path.join(H.API, 'lib', 'shop-clock')).set('2026-11-20T06:00:00Z');
  if (typeof X.E.posting().fxRevaluation !== 'function') { console.log('   SKIP: the engines are older than v1.45.0'); return; }

  const TC = require(path.join(H.API, 'lib', 'tax-copy')); const wasC = TC.copyOf, wasE = TC.entryFor;
  const copies = {}; /* the rail copy of each chit, by id — a retry reads the one it asks for */
  let copyNow = null;
  const buyerEntry = { sells: false, seller: { entity_id: SUP, LglNm: 'Sydney Cafe' }, buyer: { entity_id: SHOP }, me: { entity_id: SHOP }, invoice: INV_AUD };
  TC.copyOf = async (chitId) => copies[chitId] || copyNow; TC.entryFor = async () => buyerEntry;
  const audCopy = (id, day, status) => (copies[id] = { chit_id: id, purpose: 'invoice', sender_entity_id: SUP, currency_code: 'AUD', current_status: status, created_at: day + 'T04:30:00Z',
    business_json: { bill_no: 'AU-' + id, billed_at: day + 'T04:30:00Z', invoice: INV_AUD } });
  T.identities.push({ identity_id: SHOP, display_name: 'IN Shop', country: 'IN', currency_code: 'INR', timezone: 'Asia/Kolkata', policy_flags: {} });
  await X.store.saveSetting(db, SHOP, S_IN); await B.enable(db, SHOP, { by: SHOP, today: '2026-10-01', country: 'IN' }); K.forget(SHOP);
  T.fxReady = true; T.fxLines = true;
  const s = await B.settingOf(db, SHOP);

  const posted = (id) => T.entries.filter((e) => e.entity_id === SHOP && e.source_ref === 'chit:' + id);
  const waitRows = (id) => T.outbox.filter((o) => o.entity_id === SHOP && o.source_chit_id === id && !o.done_at);
  const linesOf = (entryId) => T.lines.filter((l) => l.entry_id === entryId);
  const sum = (ls, role, side) => ls.filter((l) => l.role === role).reduce((t, l) => t + (l[side + '_minor'] || 0), 0);
  const fxSum = (ls, side) => ls.filter((l) => l.code === '4260').reduce((t, l) => t + (l[side + '_minor'] || 0), 0);

  /* ══ PART A · T12 → T6 → T2 : accept, supplier not on the list, then no rate, then the rate ══ */
  await FX.add(db, SHOP, s, { date: '2026-11-02', currency: 'AUD', rate: '55.25' }, SHOP);
  copyNow = audCopy('f1', '2026-11-02', 'accepted');
  const a1 = await K.postChit(SHOP, 'f1', {});
  const w1 = waitRows('f1').pop();
  eq('T12 · accepted, rate present, the seller NOT on the supplier list → waits with the supplier sentence, nothing posted',
    [a1.queued, w1 && w1.why, posted('f1').length], [true, 'Sydney Cafe is not on your supplier list — add them, then this posts', 0]);

  T.parties.push({ owner: SHOP, party_id: SUP, name: 'Sydney Cafe', supplier: true, credit_days: 30 });
  copyNow = audCopy('f2', '2026-11-03', 'accepted');
  const a2 = await K.postChit(SHOP, 'f2', {});
  const w2 = waitRows('f2').pop();
  eq('T6 · supplier on the list, NO AUD rate for 3 Nov → waits with the rate sentence, nothing posted, the books unchanged',
    [a2.queued, w2 && /^No AUD rate for 3 Nov — add it in Accounts › Rates\./.test(w2.why), posted('f2').length], [true, true, 0]);

  const r1 = await K.retryOutbox(SHOP, 20);
  const pf1 = posted('f1')[0];
  ok('T12 → posts once the supplier is on the list (the nightly retry): purchase_bill', !!pf1 && pf1.event_type === 'purchase_bill' && waitRows('f1').length === 0, JSON.stringify([r1, pf1]));
  const l1 = pf1 ? linesOf(pf1.entry_id) : [];
  eq('T2 · AUD 1,000.00 at 55.25: Dr Purchases ₹55,250.00 · Cr the supplier ₹55,250.00 (minor 5525000 each), no input tax',
    [l1.reduce((t, l) => t + l.dr_minor, 0), sum(l1, 'creditors', 'cr'), l1.filter((l) => /tax|gst/i.test(String(l.role))).length], [5525000, 5525000, 0]);
  const cr1 = l1.find((l) => l.role === 'creditors');
  eq('T2 · the supplier line keeps AUD 1,000.00 (amount_txn 100000) at 55.25, named manual, dated the invoice day',
    cr1 && [cr1.txn_currency, cr1.amount_txn_minor, cr1.fx_rate, cr1.fx_rate_source, String(cr1.fx_rate_date)], ['AUD', 100000, 55.25, 'manual', '2026-11-02']);
  eq('T6 · f2 still waits for its rate (3 Nov has none), the books carry only f1', [posted('f2').length, waitRows('f2').length >= 1], [0, true]);
  await FX.add(db, SHOP, s, { date: '2026-11-03', currency: 'AUD', rate: '55.25' }, SHOP);
  await K.retryOutbox(SHOP, 20);
  const again = await K.postChit(SHOP, 'f2', {});
  ok('T6 · rate added → retry posts exactly once (a second press is a duplicate, never a second entry)', posted('f2').length === 1 && again.duplicate === true && waitRows('f2').length === 0, JSON.stringify([again, posted('f2').length]));

  /* ══ PART B · the foreign payment and the hostile fixtures ══ */
  /* a bill per case on its own supplier, at its own stated rate (the event's rate is the one a bill may carry: lib/fx-rates forEvent) */
  const billOf = async (i, taxable, cur, rate, day) => {
    T.parties.push({ owner: SHOP, party_id: SUPS[i], name: 'Supplier ' + i, supplier: true, credit_days: 30 });
    return B.postEntry(db, SHOP, { type: 'purchase_bill', date: day || '2026-11-02', currency: cur, party: SUPS[i], by_rate: [{ rate: 0, taxable }], source_ref: 'chit:bill' + i, ref: 'B' + i, source_chit_id: '3770000' + i + '-0000-4000-8000-000000000000', fx_rate: rate });
  };
  const pay = (i, amount_minor, cur, extra, day) => B.recordPayment(db, SHOP, Object.assign({ party_id: SUPS[i], direction: 'out', amount_minor, currency: cur, mode: 'bank', received_at: day || '2026-11-05', by: SHOP }, extra || {}));
  const openOf = (i) => X.store.foreignBalances(db, SHOP, { functional: 'INR', party: SUPS[i] });

  /* T3 · paid in full at the bank's 54.80: gain ₹450.00 */
  await billOf(0, 1000, 'AUD', 55.25);
  const p3 = await threw(() => pay(0, 100000, 'AUD', { fx_rate: '54.80', client_ref: 't3' }));
  ok('T3 · a payment states the bank\'s rate (AUD 1,000.00 at 54.80) and is recorded', p3 === null, 'threw ' + (p3 && p3.message));
  const e3 = T.entries.filter((e) => e.entity_id === SHOP && /^pay:/.test(e.source_ref || '') || false).pop();
  const l3 = e3 ? linesOf(e3.entry_id) : [];
  eq('T3 · Dr Supplier 5525000 · Cr Bank 5480000 · Cr 4260 gain 45000; open AUD 0',
    [sum(l3, 'creditors', 'dr'), sum(l3, 'bank', 'cr'), fxSum(l3, 'cr'), (await openOf(0)).length], [5525000, 5480000, 45000, 0]);

  /* T4 · paid in full at 56.10: loss ₹850.00 */
  await billOf(1, 1000, 'AUD', 55.25);
  const p4 = await threw(() => pay(1, 100000, 'AUD', { fx_rate: '56.10', client_ref: 't4' }));
  const e4 = T.entries.filter((e) => e.entity_id === SHOP).pop(); const l4 = e4 ? linesOf(e4.entry_id) : [];
  eq('T4 · at 56.10: Dr Supplier 5525000 · Cr Bank 5610000 · Dr 4260 loss 85000; open AUD 0',
    [p4 === null, sum(l4, 'creditors', 'dr'), sum(l4, 'bank', 'cr'), fxSum(l4, 'dr'), (await openOf(1)).length], [true, 5525000, 5610000, 85000, 0]);

  /* T5 · part paid twice at two bank rates */
  await billOf(2, 1000, 'AUD', 55.25);
  const p5a = await threw(() => pay(2, 40000, 'AUD', { fx_rate: '56.00', client_ref: 't5a' }, '2026-11-05'));
  const e5a = T.entries.filter((e) => e.entity_id === SHOP).pop(); const l5a = e5a ? linesOf(e5a.entry_id) : [];
  eq('T5 · AUD 400.00 at 56.00: Dr Supplier 2210000 · Cr Bank 2240000 · Dr 4260 30000', [p5a === null, sum(l5a, 'creditors', 'dr'), sum(l5a, 'bank', 'cr'), fxSum(l5a, 'dr')], [true, 2210000, 2240000, 30000]);
  const o5 = (await openOf(2))[0];
  eq('T5 · open AUD 600.00 carried ₹33,150.00 (txn 60000, functional 3315000; a payable reads negative, as forEvent reads it)', o5 && [o5.txn_minor, o5.fn_minor], [-60000, -3315000]);
  const p5b = await threw(() => pay(2, 60000, 'AUD', { fx_rate: '55.00', client_ref: 't5b' }, '2026-11-06'));
  const e5b = T.entries.filter((e) => e.entity_id === SHOP).pop(); const l5b = e5b ? linesOf(e5b.entry_id) : [];
  eq('T5 · AUD 600.00 at 55.00: Dr Supplier 3315000 · Cr Bank 3300000 · Cr 4260 15000; open AUD 0; the bank paid 5540000 in all',
    [p5b === null, sum(l5b, 'creditors', 'dr'), sum(l5b, 'bank', 'cr'), fxSum(l5b, 'cr'), (await openOf(2)).length, sum(l5a, 'bank', 'cr') + sum(l5b, 'bank', 'cr')], [true, 3315000, 3300000, 15000, 0, 5540000]);

  /* T8 · hostile: the INR bank line (₹56,100.00) against a supplier whose only open bill is AUD 1,000.00 — it must settle the AUD bill, not leave it open */
  await billOf(3, 1000, 'AUD', 55.25);
  const p8 = await threw(() => pay(3, 5610000, 'INR', { settles: { currency: 'AUD', amount_minor: 100000 }, client_ref: 't8' }));
  const e8 = T.entries.filter((e) => e.entity_id === SHOP).pop(); const l8 = e8 ? linesOf(e8.entry_id) : [];
  eq('T8 · ₹56,100.00 against AUD 1,000.00: rate 56.10 = entry T4 (Dr Supplier 5525000 · Cr Bank 5610000 · Dr 4260 85000); NO AUD left open',
    [p8 === null, sum(l8, 'creditors', 'dr'), sum(l8, 'bank', 'cr'), fxSum(l8, 'dr'), (await openOf(3)).length], [true, 5525000, 5610000, 85000, 0]);
  await billOf(4, 1000, 'AUD', 55.25);
  const p8b = await threw(() => pay(4, 5610000, 'INR', { allocate: 'oldest_first', client_ref: 't8b' }));
  const open8b = await openOf(4);
  ok('T8 · an INR payment that would settle bills (oldest first) and says nothing of AUD, to a supplier with an open AUD bill, is not allowed to leave it open unnoticed: refused in words, or it settles it',
    (p8b && /AUD/.test(p8b.message)) || open8b.length === 0, 'threw ' + (p8b && p8b.message) + ' open ' + JSON.stringify(open8b));

  /* T9 · hostile rounding: AUD 333.33 at 55.2537 = 1841771.58 → ₹18,417.72 (half away from zero) */
  await billOf(5, 333.33, 'AUD', 55.2537);
  const bill9 = T.entries.filter((e) => e.entity_id === SHOP && e.source_ref === 'chit:bill5')[0]; const l9 = bill9 ? linesOf(bill9.entry_id) : [];
  const cr9 = l9.find((l) => l.role === 'creditors');
  eq('T9 · AUD 333.33 at 55.2537 → creditors Cr 1841772 (33333 × 55.2537 = 1841771.58, half up), amount_txn 33333', cr9 && [cr9.cr_minor, cr9.amount_txn_minor], [1841772, 33333]);

  /* T10 · hostile decimals: JPY has 0 decimals — JPY 10,000 at 0.55 = ₹5,500.00; paid at 0.56 → bank ₹5,600.00, loss ₹100.00 */
  await billOf(6, 10000, 'JPY', 0.55);
  const bill10 = T.entries.filter((e) => e.entity_id === SHOP && e.source_ref === 'chit:bill6')[0]; const l10 = bill10 ? linesOf(bill10.entry_id) : [];
  const cr10 = l10.find((l) => l.role === 'creditors');
  eq('T10 · JPY 10,000 at 0.55 → creditors Cr 550000 (₹5,500.00), amount_txn 10000 (no decimal shift)', cr10 && [cr10.cr_minor, cr10.amount_txn_minor], [550000, 10000]);
  const p10 = await threw(() => pay(6, 10000, 'JPY', { fx_rate: '0.56', client_ref: 't10' }));
  const e10 = T.entries.filter((e) => e.entity_id === SHOP).pop(); const l10p = e10 ? linesOf(e10.entry_id) : [];
  eq('T10 · paid JPY 10,000 at 0.56: Dr Supplier 550000 · Cr Bank 560000 · Dr 4260 10000; open JPY 0',
    [p10 === null, sum(l10p, 'creditors', 'dr'), sum(l10p, 'bank', 'cr'), fxSum(l10p, 'dr'), (await openOf(6)).length], [true, 550000, 560000, 10000, 0]);

  /* the bill it settles is closed in the party's ledger too (the allocation in the books' own currency: the carried ₹55,250.00) */
  const out3 = await B.proposeFor(db, SHOP, { party: SUPS[0], direction: 'out', amount_minor: 1, currency: 'INR' });
  ok('T3 · …and the bill is no longer open in the party\'s ledger (nothing owed to the supplier)', !out3.outstanding || !out3.outstanding.by_party || !Number(out3.outstanding.by_party[SUPS[0]]), JSON.stringify(out3.outstanding && out3.outstanding.by_party));

  /* the refusals, in words */
  const bad1 = await threw(() => pay(0, 100, 'INR', { fx_rate: '1' }));
  ok('a rate on a payment in the books\' own currency is refused in words (a rate is for a foreign currency)', !!bad1 && /foreign/i.test(bad1.message), 'threw ' + (bad1 && bad1.message));
  const bad2 = await threw(() => pay(0, 100, 'AUD', { fx_rate: '0' }));
  ok('a rate of 0 on a payment is refused in words', !!bad2 && /more than 0/.test(bad2.message), 'threw ' + (bad2 && bad2.message));
  const bad3 = await threw(() => pay(0, 100, 'INR', { settles: { currency: 'INR', amount_minor: 100 } }));
  ok('"settles" in the books\' own currency is refused in words', !!bad3 && /foreign/i.test(bad3.message), 'threw ' + (bad3 && bad3.message));

  /* ══ PART C (d) · no rate for the day: suggest the newest EARLIER rate (within 7 days), name its date, post nothing on it ══ */
  await FX.add(db, SHOP, s, { date: '2026-10-30', currency: 'AUD', rate: '55.00' }, SHOP);
  const sg = await FX.suggest(db, SHOP, 'AUD', 'INR', '2026-11-01');
  eq('(d) 1 Nov (a Sunday) has no AUD rate: the suggestion is 55 from 30 Oct, 2 days earlier', sg && [sg.rate, sg.date, sg.days_earlier], [55, '2026-10-30', 2]);
  eq('(d) a day with its own rate has no suggestion', await FX.suggest(db, SHOP, 'AUD', 'INR', '2026-11-02'), null);
  eq('(d) nothing within 7 days → no suggestion (an old rate is not offered)', await FX.suggest(db, SHOP, 'AUD', 'INR', '2026-11-20'), null);
  const nb = T.entries.length;
  const miss = await threw(() => B.postEntry(db, SHOP, { type: 'purchase_bill', date: '2026-11-01', currency: 'AUD', party: SUPS[0], by_rate: [{ rate: 0, taxable: 10 }], source_ref: 'chit:sun', ref: 'SUN', source_chit_id: '37700099-0000-4000-8000-000000000000' }));
  ok('(d) …a bill on 1 Nov is still REFUSED (never posted on a suggestion); the words name the last rate and its day',
    !!miss && miss.code === 'FX_RATE_MISSING' && /^No AUD rate for 1 Nov — add it in Accounts › Rates\./.test(miss.message) && /55 on 30 Oct/.test(miss.message) && T.entries.length === nb, 'threw ' + (miss && miss.message));
  const missNone = await threw(() => B.postEntry(db, SHOP, { type: 'purchase_bill', date: '2026-11-20', currency: 'AUD', party: SUPS[0], by_rate: [{ rate: 0, taxable: 10 }], source_ref: 'chit:none', ref: 'NONE', source_chit_id: '37700098-0000-4000-8000-000000000000' }));
  eq('(d) …with no earlier rate in reach the sentence is the plain one (the critic\'s T6 wording)', missNone && missNone.message, 'No AUD rate for 20 Nov — add it in Accounts › Rates.');

  /* ══ PART C (c) · the accept SAYS when the books are waiting ══ */
  const SUPNEW = '77777777-7777-4777-8777-377377377377';
  buyerEntry.seller = { entity_id: SUPNEW, LglNm: 'Perth Traders' };
  copyNow = audCopy('w1', '2026-11-02', 'accepted');
  eq('(c) accepted, the seller is not on the list → the answer says so, in the waiting sentence', await K.waitsFor(SHOP, 'w1'), 'Perth Traders is not on your supplier list — add them, then this posts');
  T.parties.push({ owner: SHOP, party_id: SUPNEW, name: 'Perth Traders', supplier: true, credit_days: 30 });
  copyNow = audCopy('w2', '2026-11-04', 'accepted');
  const wRate = await K.waitsFor(SHOP, 'w2');
  ok('(c) accepted, on the list, no AUD rate for 4 Nov → the answer carries the rate sentence', /^No AUD rate for 4 Nov — add it in Accounts › Rates\./.test(wRate || ''), String(wRate));
  copyNow = audCopy('w3', '2026-11-02', 'accepted');
  eq('(c) accepted, on the list, the rate is there → nothing to say (null)', await K.waitsFor(SHOP, 'w3'), null);
  eq('(c) …and asking never posts or parks anything (a read)', [posted('w1').length + posted('w2').length + posted('w3').length, waitRows('w1').length + waitRows('w2').length + waitRows('w3').length], [0, 0]);
  const CM = require(path.join(H.API, 'lib', 'chit-move'));
  const ans = CM.movedAnswer({ chit_id: 'w2', previous_status: 'delivered', new_status: 'accepted', disputeWarning: null, booksWaiting: wRate, booksOnCancel: null, crossed: null });
  eq('(c) the 200 of an accept carries the sentence on its `warning` line; an ordinary accept keeps warning null',
    [ans.body.warning === wRate, CM.movedAnswer({ chit_id: 'w3', previous_status: 'delivered', new_status: 'accepted', disputeWarning: null, booksOnCancel: null, crossed: null }).body.warning], [true, null]);

  TC.copyOf = wasC; TC.entryFor = wasE;
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n\n' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
