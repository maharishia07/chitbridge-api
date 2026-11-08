/**
 * acc-283-refund-gap.test.cjs — ACC-283: A CASH REFUND THAT IS NOT THE CREDIT NOTE'S TOTAL WAITS, IN WORDS, WITH THE GAP.
 *
 *   Before: AU credit note A$68.98 refunded in cash A$69.00 (5c step) reached the writer as a return whose refund (6900) was more than its lines (6871 + 627 = 6898); the
 *   engine's return rule has no round-off line, so it refused "the debits (68.98) do not equal the credits (69)" and parked the chit where only the Waiting list showed it.
 *   Now the verdict itself waits, naming both figures and the difference (gap_minor 2); equal refunds (the A$70.00 control) and credit-only refunds post as before.
 *   Hand figures (PM/SIT-HUNT-RUN-2026-11-08-c5.md, p4au.cjs): taxable 62.71 + GST 6.27 = 68.98; refund 69.00; gap 0.02 = 2 minor. Runs on the in-memory twin.
 *   NOT fixed here: posting the 2 minor through the pack's rounding ledger needs the engines return rule to take round_off (engines round, adopt in api and web).
 * Run: node tests/acc-283-refund-gap.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const AU_SHOP = 'aaaaaaaa-2222-4111-8111-283283283283', CUST = '22222222-2222-4222-8222-222222222222';
const S_AU = { enabled: true, walkin_grain: 'day', country: 'AU', functional_currency: 'AUD', fy_start_month: 7 };
const S_IN = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' };
const auNote = (net, tax) => ({ currency: 'AUD', _cb: { scheme: 'GST' }, ItemList: [{ GstRt: 10, AssAmt: net, TaxAmt: tax, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: net + tax } });
const inNote = { currency: 'INR', ItemList: [{ GstRt: 18, AssAmt: 100, CgstAmt: 9, SgstAmt: 9, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 118 } };

(async () => {
  console.log('\n== ACC-283 · a refund that is not the note\'s total waits, in words ==\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); process.exit(1); }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const note = (cur, parts) => ({ chit_id: 'n1', purpose: 'credit_note', currency_code: cur, created_at: '2026-10-17T05:00:00Z',
    business_json: { till: { id: 'C1' }, bill_no: 'CN-1', refund: { parts }, customer: { name: 'Ravi', identity_id: CUST } } });
  const run = (setting, invoice, parts) => K.classify({ chit: note(invoice.currency, parts), entry: { sells: true, invoice }, setting });

  const au = run(S_AU, auNote(62.71, 6.27), [{ how: 'Cash', amount: 69 }]);
  eq('AU · A$68.98 note refunded A$69.00 in cash: waits, gap 2 minor', [au.kind, au.gap_minor], ['queue', 2]);
  ok('AU · the sentence names both figures and the gap, not the engine words', /AUD 69 /.test(au.why) && /68\.98/.test(au.why) && /0\.02/.test(au.why) && !/debits/.test(au.why), au.why);
  const inShort = run(S_IN, inNote, [{ how: 'Cash', amount: 100 }]);
  eq('IN · ₹118 note refunded ₹100: waits, gap -1800 minor', [inShort.kind, inShort.gap_minor], ['queue', -1800]);
  eq('AU control · A$70.00 note refunded A$70.00: posts', run(S_AU, auNote(63.64, 6.36), [{ how: 'Cash', amount: 70 }]).kind, 'post');
  eq('IN · ₹118 refunded ₹118 (cash 50 + UPI 68): posts', run(S_IN, inNote, [{ how: 'Cash', amount: 50 }, { how: 'UPI', amount: 68 }]).kind, 'post');
  eq('credit-only refund is untouched (the receivable path, ACC-263)', run(S_AU, auNote(62.71, 6.27), [{ how: 'On credit', amount: 68.98 }]).kind, 'post');

  /* through the hook onto the twin: it waits with OUR sentence, nothing half-posted */
  const TC = require(path.join(H.API, 'lib', 'tax-copy')); let now = null, entry = null;
  TC.copyOf = async () => now; TC.entryFor = async () => entry;
  X.T.identities.push({ identity_id: AU_SHOP, display_name: 'Shop', country: 'AU', currency_code: 'AUD', timezone: 'Australia/Sydney', policy_flags: {} });
  await X.store.saveSetting(X.db, AU_SHOP, S_AU); await X.B.enable(X.db, AU_SHOP, { by: AU_SHOP, today: '2026-10-17' }); K.forget(AU_SHOP);
  X.T.parties.push({ owner: AU_SHOP, party_id: CUST, name: 'Ravi', customer: true });
  now = note('AUD', [{ how: 'Cash', amount: 69 }]); delete now.business_json.against; entry = { sells: true, invoice: auNote(62.71, 6.27) };
  const posted = await K.postChit(AU_SHOP, 'n1', {});
  const row = X.T.outbox.filter((o) => o.source_chit_id === 'n1' && !o.done_at);
  ok('postChit · queued, no entry, one waiting row carrying the sentence', posted.queued === true && X.T.entries.length === 0 && row.length === 1 && /0\.02/.test(row[0].why) && !/debits/.test(row[0].why), JSON.stringify([posted, row.map((o) => o.why)]));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n\n' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
