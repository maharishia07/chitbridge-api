/**
 * tests/walkw-1129.test.cjs — WALK W (AE, batch 1129) W-F-02: a bill accepted into a LOCKED month is dated on the first open day AND SAYS SO; payables = the trial balance.
 * Walk W hand case (fils): INV-2 21.00 → Suppliers 2100 (named for the seller; this test's bill is untaxed, the VAT split is walk T's). November was locked, the bill posted "1 Dec" with warning null,
 * so Payables (232.50) and the trial balance of the day (201.00) disagreed. At the 1128 head the RUNNING month cannot be locked (K-F-01), so the same shape is a month that has ENDED:
 * October locked, a bill sent 28 Oct (no typed billed_at) accepted in November → it posts on 1 Nov, the narration and the accept's sentence say "October is locked ... posted on 1 Nov".
 * Two carried totals are compared (never recomputed): the Suppliers ledger balance of the trial balance at today's date = the payables the party items carry.
 * Run: CB_ENGINES_DIR=../chitbridge-engines node tests/walkw-1129.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const W = '11111111-1111-4111-8111-129129129129', V = '22222222-2222-4222-8222-129129129129';
(async () => {
  console.log('\n== WALK W · W-F-02 a bill accepted into a locked month: dated in words, payables = trial balance ==\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); return; }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const TC = require(path.join(H.API, 'lib', 'tax-copy')); const wasC = TC.copyOf, wasE = TC.entryFor;
  const inv = { currency: 'AED', ItemList: [{ GstRt: 0, AssAmt: 21, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 21 } };
  const copy = { chit_id: 'wf2', purpose: 'invoice', sender_entity_id: W, currency_code: 'AED', current_status: 'accepted', sent_at: '2026-10-28T08:00:00Z', created_at: '2026-10-28T08:00:00Z', business_json: { bill_no: 'WKW-INV-2' } };
  const entry = { sells: false, seller: { entity_id: W, LglNm: 'Wadi Supplies' }, buyer: { entity_id: V }, me: { entity_id: V }, invoice: inv };
  TC.copyOf = async () => copy; TC.entryFor = async () => entry;
  await X.store.saveSetting(X.db, V, { enabled: true, walkin_grain: 'day', country: 'AE', functional_currency: 'AED', timezone: 'UTC' });
  await X.B.enable(X.db, V, { by: V, today: '2026-10-05' });
  K.forget(V);
  X.T.parties.push({ owner: V, party_id: W, name: 'Wadi Supplies', supplier: true, credit_days: 30 });
  /* October holds an entry, then October is locked (it has ended) */
  await X.B.postEntry(X.db, V, { type: 'purchase_bill', ref: 'OCT-1', date: '2026-10-05', currency: 'AED', party: W, by_rate: [{ rate: 5, taxable: 100, vat: 5 }], paid: {}, round_off: 0, source_ref: 'pur:OCT-1' });
  await X.B.setPeriod(X.db, V, '2026', 10, 'soft_locked', V, 'Oct done');
  const out = await K.postChit(V, 'wf2', {});
  const e = X.T.entries.find((x) => x.entity_id === V && x.source_ref === 'chit:wf2');
  eq('the bill posts once, on the first open day 1 Nov (its own day 28 Oct kept as doc_date)', [!!out.ok, e && String(e.posting_date).slice(0, 10), e && String(e.doc_date).slice(0, 10)], [true, '2026-11-01', '2026-10-28']);
  ok('the entry says why in words: "October is locked" and "posted on 1 Nov"', e && /October/.test(e.narration || '') && /locked/.test(e.narration || ''), e && e.narration);
  const waitLine = await require(path.join(H.API, 'lib', 'books-waits')).lockWords(X.db, V, K.classify({ chit: copy, entry, setting: { enabled: true, timezone: 'UTC', country: 'AE', functional_currency: 'AED' }, status: 'accepted' }).event);
  ok('the accept sentence (before it posts) names the move in words', /28 Oct/.test(waitLine || '') && /1 Nov/.test(waitLine || ''), String(waitLine));
  /* two carried totals: the Suppliers ledger of the trial balance (as of 21 Nov) = what the party items say we owe */
  const tb = await X.B.trialBalance(X.db, V, '2026-11-21');
  const ledger = (tb.rows.find((r) => r.role === 'creditors') || {}).credit_minor;
  const owed = X.T.items.filter((i) => i.entity_id === V && i.side === 'payable').reduce((s, i) => s + Number(i.amount_minor || 0), 0);
  eq('payables = trial balance at today: the Suppliers ledger (12600 = OCT-1 10500 + this bill 2100) equals the open payable items', [ledger, owed], [12600, 12600]);
  TC.copyOf = wasC; TC.entryFor = wasE;
  console.log('\n' + (fail ? '  FAIL ' + fail + ' failed' : '  ok ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });
