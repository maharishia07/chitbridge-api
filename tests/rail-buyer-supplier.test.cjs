/**
 * rail-buyer-supplier.test.cjs — AE-F-19: A B2B CHIT POSTS ON THE SELLER AT SEND AND ON THE BUYER ONCE THE SELLER IS ON THE SUPPLIER LIST.
 *   Seller W: Dr Customers 525.00 / Cr Sales 500.00 / Cr Output tax 25.00 (at send). Buyer V accepts BEFORE W is on its list: parked, nothing posted, W never auto-added
 *   (Athi, 1 Oct), the parked row carries the seller's own key + name. W is then listed under its OWN key (lib/supplier-list for_bill / a business add) and the retry posts ONCE:
 *   Dr Purchases 500.00 / Dr Input tax 25.00 / Cr Suppliers 525.00; a second retry and a second post are duplicates. A name typed on the Suppliers page mints a different key (a local twin):
 *   it does NOT post the rail bill. The trial balance of BOTH entities adds up (Sum Dr = Sum Cr).
 * Run: node tests/rail-buyer-supplier.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const W = '11111111-1111-4111-8111-111111111111', V = '22222222-2222-4222-8222-222222222222', TWIN = '44444444-4444-4444-8444-444444444444';

(async () => {
  console.log('\n== AE-F-19 · THE BUYER OF A B2B CHIT POSTS ONCE THE SELLER IS ON ITS LIST ==\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   (books engines not found: ' + X.src.why + ')'); console.log('\n  0 passed · 0 checks'); return; }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const inv = { currency: 'INR', ItemList: [{ GstRt: 5, AssAmt: 500, CgstAmt: 12.5, SgstAmt: 12.5, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 525 } };
  const bj = { bill_no: 'AE-INV-1', till: { id: 'C1' }, billed_at: '2026-11-21T05:00:00Z', customer: { name: 'Vee Traders', identity_id: V }, payment: { parts: [{ how: 'On credit', amount: 525 }] }, terms: { credit_days: 15, due_date: '2026-12-06' } };
  const copy = (status) => ({ chit_id: 'ae1', purpose: 'order', sender_entity_id: W, currency_code: 'INR', current_status: status, business_json: bj });
  const sellerEntry = { sells: true, seller: { entity_id: W, LglNm: 'Wadi Supplies' }, buyer: { entity_id: V }, me: { entity_id: W }, invoice: inv };
  const buyerEntry = { sells: false, seller: { entity_id: W, LglNm: 'Wadi Supplies' }, buyer: { entity_id: V }, me: { entity_id: V }, invoice: inv };
  const TC = require(path.join(H.API, 'lib', 'tax-copy')); const wasC = TC.copyOf, wasE = TC.entryFor;
  let now = null, entryNow = null;
  TC.copyOf = async () => now; TC.entryFor = async () => entryNow;
  for (const e of [W, V]) { await X.store.saveSetting(X.db, e, { enabled: true }); await X.B.enable(X.db, e, { by: e, today: '2026-11-21' }); K.forget(e); }
  const posted = (e) => X.T.entries.filter((x) => x.entity_id === e && x.source_ref === 'chit:ae1');
  const waits = () => X.T.outbox.filter((o) => o.entity_id === V && o.source_chit_id === 'ae1' && !o.done_at);
  const linesOf = (e) => X.T.lines.filter((l) => posted(e).some((p) => p.entry_id === l.entry_id));
  const sum = (ls, k) => ls.reduce((t, l) => t + l[k], 0);
  const balanced = (e) => { const ls = linesOf(e); return ls.length > 0 && sum(ls, 'dr_minor') === sum(ls, 'cr_minor'); };

  /* the seller posts at send */
  now = copy('pending'); entryNow = sellerEntry;
  const sent = await K.postChit(W, 'ae1', {});
  const wl = linesOf(W);
  eq('W at send: one sale entry, Dr = Cr = 525.00, Dr Customers 525 named for V', [!!sent.ok, posted(W).length, sum(wl, 'dr_minor'), sum(wl, 'cr_minor'), wl.filter((l) => l.dr_minor === 52500 && l.party_id === V).length], [true, 1, 52500, 52500, 1]);

  /* the buyer accepts before W is on its list */
  now = copy('accepted'); entryNow = buyerEntry;
  const a1 = await K.postChit(V, 'ae1', {});
  eq('V accepts, W not on its list: parked with the sentence, nothing posted, W NOT auto-added', [a1.queued, a1.why, posted(V).length, X.T.parties.some((p) => p.owner === V && p.party_id === W)], [true, 'Wadi Supplies is not on your supplier list — add them, then this posts', 0, false]);
  const row = waits()[0];
  eq('the parked row names the seller by their OWN key, as data (the sheet offers Add Wadi Supplies as supplier and post)', [row && row.event.waiting, row && row.event.supplier], ['supplier', { id: W, name: 'Wadi Supplies' }]);

  /* a name typed on the Suppliers page = a local twin with another key: it must not post a rail bill under a stranger */
  X.T.parties.push({ owner: V, party_id: TWIN, name: 'Wadi Supplies', supplier: true });
  const r0 = await K.retryOutbox(V, 10);
  eq('a LOCAL twin typed by name (another key) does not post the rail bill: still waiting, nothing posted', [r0.posted, waits().length, posted(V).length], [0, 1, 0]);
  X.T.parties = X.T.parties.filter((p) => p.party_id !== TWIN);

  /* the seller is listed under its own key, so the retry posts once */
  X.T.parties.push({ owner: V, party_id: W, name: 'Wadi Supplies', supplier: true, credit_days: 15 });
  const r1 = await K.retryOutbox(V, 10);
  const vl = linesOf(V);
  eq('W listed under its own key: the retry posts ONCE, the waiting row closes', [r1.posted, posted(V).length, waits().length], [1, 1, 0]);
  eq('V: Dr Purchases 500 / Dr Input tax 25 / Cr Suppliers 525 named for W; Dr = Cr = 525.00',
    [sum(vl, 'dr_minor'), sum(vl, 'cr_minor'), vl.filter((l) => l.cr_minor === 52500 && l.party_id === W).length, vl.filter((l) => l.dr_minor === 50000).length, sum(vl.filter((l) => l.dr_minor > 0 && l.dr_minor !== 50000), 'dr_minor')],
    [52500, 52500, 1, 1, 2500]);
  ok('the trial balance adds up on BOTH entities', balanced(W) && balanced(V));

  /* no double post */
  const r2 = await K.retryOutbox(V, 10);
  const a2 = await K.postChit(V, 'ae1', {});
  const a3 = await K.postChit(V, 'ae1', {});
  eq('a second retry and two more posts are duplicates: one entry, same lines, nothing waits', [r2.tried, a2.duplicate === true, a3.duplicate === true, posted(V).length, linesOf(V).length, waits().length], [0, true, true, 1, vl.length, 0]);

  /* the sheet's stale line is read against the live list (lib/supplier-list freshWait) */
  const SL = require(path.join(H.API, 'lib', 'supplier-list'));
  const same = { todo: 'record', wait: 'accept', why: 'x' };
  eq('freshWait leaves any other wait untouched, and a null one', [await SL.freshWait(V, 'ae1', same), await SL.freshWait(V, 'ae1', null)], [same, null]);
  eq('sellerOfBill refuses an id that is not a chit id (no query)', await SL.sellerOfBill({ query: async () => { throw new Error('no query expected'); } }, V, 'not-a-uuid'), null);

  TC.copyOf = wasC; TC.entryFor = wasE;
  console.log('\n  ' + (fail ? 'FAILED ' : 'ok ') + pass + ' passed · ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
