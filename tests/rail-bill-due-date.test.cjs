/**
 * rail-bill-due-date.test.cjs — ACC-new-4 (28 Nov 2026): a rail supplier invoice keeps the sender's terms due date (the one reader, termsDueDate,
 * the counter bill already used). Bean case: bill 8 Jul 2026, 30-day terms → due 7 Aug; aged by the engine at 30 Sep = 54 days (d31_60), at 28 Nov = 113 (d90_plus).
 * Without terms the bill still ages from its bill date and says no_terms. Run: node tests/rail-bill-due-date.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const eq = (name, got, want) => { const same = JSON.stringify(got) === JSON.stringify(want); same ? pass++ : fail++; console.log('  ' + (same ? 'ok  ' : 'FAIL') + '  ' + name + (same ? '' : '\n     got ' + JSON.stringify(got) + '\n     want ' + JSON.stringify(want))); };
if (!H.enginesSrc().dir) { console.log('SKIP: ' + H.enginesSrc().why); process.exit(1); }
const K = require(path.join(H.API, 'lib', 'books-hooks'));
const E = require(path.join(H.API, 'lib', 'books-engines'));
const SHOP = '11111111-1111-4111-8111-111111111111', BEAN = '33333333-3333-4333-8333-333333333333';
const S = { enabled: true, country: 'IN', functional_currency: 'INR' };
const inv = { currency: 'INR', ItemList: [{ GstRt: 20, AssAmt: 200, CgstAmt: 10, SgstAmt: 10, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 220 } };
const classify = (business) => K.classify({ chit: { chit_id: 'bean-1', created_at: '2026-07-08T01:00:00Z', purpose: 'invoice', sender_entity_id: BEAN, currency_code: 'INR', business_json: Object.assign({ invoice_no: 'B-1', billed_at: '2026-07-08T01:00:00Z', invoice: inv }, business) },
  entry: { sells: false, seller: { entity_id: BEAN, LglNm: 'Bean Supply' }, me: { entity_id: SHOP }, invoice: inv }, setting: S, status: 'accepted' });
const withTerms = classify({ terms: { due_date: '2026-08-07' } }), noTerms = classify({});
eq('a rail supplier bill carries the sender\'s terms due date', [withTerms.kind, withTerms.event && withTerms.event.type, withTerms.event && withTerms.event.due_date], ['post', 'purchase_bill', '2026-08-07']);
eq('no terms → no due date (ages from the bill date, no_terms)', [noTerms.kind, noTerms.event && noTerms.event.due_date], ['post', undefined]);
/* the SELLER's side of the same invoice: a sale_bill to the buyer carries the same terms through the same reader */
const BUYER = '44444444-4444-4444-8444-444444444444';
const sold = (business) => K.classify({ chit: { chit_id: 'bean-2', created_at: '2026-07-08T01:00:00Z', purpose: 'invoice', currency_code: 'INR', business_json: Object.assign({ invoice_no: 'S-1', billed_at: '2026-07-08T01:00:00Z', invoice: inv }, business) },
  entry: { sells: true, buyer: { entity_id: BUYER }, me: { entity_id: SHOP }, invoice: inv }, setting: S });
const soldTerms = sold({ terms: { due_date: '2026-08-07' } }), soldNone = sold({});
eq('a rail SALE bill carries the terms due date too', [soldTerms.kind, soldTerms.event && soldTerms.event.type, soldTerms.event && soldTerms.event.due_date], ['post', 'sale_bill', '2026-08-07']);
eq('a rail sale with no terms has no due date', [soldNone.kind, soldNone.event && soldNone.event.due_date], ['post', undefined]);
const doc = (due) => ({ item_id: 'i1', party: BEAN, party_id: BEAN, side: 'payable', currency: 'INR', ref_kind: 'bill', kind: 'purchase', ref: 'bean-1', against_ref: 'bean-1', amount_minor: 22000, date: '2026-07-08', doc_date: '2026-07-08', due_date: due });
const bandAt = (due, asOf) => { const d = E.dues([doc(due)], asOf, 'payable', { pack: require(path.join(H.API, 'lib', 'regulation')).packFor('AU'), creditDaysOf: () => null }); const r = E.followRow(d.follow, BEAN); return [d.follow.ageing.bucket_keys.find((k) => r[k] > 0), r.no_terms_minor]; };
eq('Bean at 30 Sep: due 7 Aug (54 days) → d31_60, terms known', bandAt(withTerms.event.due_date, '2026-09-30'), ['d31_60', 0]);
eq('Bean at 28 Nov: due 7 Aug (113 days) → d90_plus', bandAt(withTerms.event.due_date, '2026-11-28'), ['d90_plus', 0]);
eq('no terms: aged from 8 Jul, no_terms says so (the wrong band the fix removes)', bandAt(noTerms.event.due_date, '2026-09-30'), ['d61_90', 22000]);
const src = fs.readFileSync(path.join(H.API, 'lib', 'books-hooks.js'), 'utf8');
eq('guard: no `due: undefined` beside a due reader remains', /due: undefined/.test(src), false);
console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + '\n');
process.exit(fail ? 1 : 0);
