/**
 * tests/rail-money-1121.test.cjs — Walk B B-F-18 / B-F-17: both sides' books mirror on the rail (two entities, the trial balance of each before and after).
 *   CN  a credit note the seller D sends R: D's books post a return against its customer R (no customer block on the chit: the buyer IS the customer), R posts a purchase return;
 *       both trial balances balance and each moves by the note's A$22.00 (hand-computed: 20.00 + 2.00 GST).
 *   PAY the buyer R pays A$242.00: D reads the advice and WAITS for its confirmation (nothing posts, TB unchanged); once D accepts, D records the receipt (Dr Bank / Cr Customers 242.00); R's own copy posts nothing.
 * Run: node tests/rail-money-1121.test.cjs   (CB_ENGINES_DIR = an engines worktree)
 */
'use strict';
const assert = require('assert');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n          ') : e)); }
};
const db0 = require('../db');
db0.query = async () => ({ rows: [{ identity_id: 'd1', gstn: null, display_name: 'Distributor', policy_flags: {}, country: 'AU' }, { identity_id: 'r1', gstn: null, display_name: 'Retailer', policy_flags: {}, country: 'AU' }] });
require('../lib/country-setup').registrationOfShop = async () => 'regular';
const sendMoney = require('../lib/send-money');

(async () => {
  const books = H.load();
  const K = require('../lib/books-hooks');
  if (!books.src.dir) { console.log('   SKIP: ' + books.src.why); process.exit(0); }
  const { B, T, db } = books;
  const D = '11111111-1111-4111-8111-111111111111', R = '22222222-2222-4222-8222-222222222222'; /* issuer/seller D, buyer R */
  const SET = { enabled: true, country: 'AU', functional_currency: 'AUD' };
  for (const shop of [D, R]) { await books.store.saveSetting(db, shop, { enabled: false }); await B.enable(db, shop, { by: shop, today: '2026-11-08', country: 'AU' }); K.forget(shop); }
  T.parties.push({ owner: D, party_id: R, name: 'CBT Australia Retailer', customer: true, credit_days: 15 });
  T.parties.push({ owner: R, party_id: D, name: 'CBT Australia Distributor', supplier: true, credit_days: 15 });
  const tbOf = async (shop) => { const tb = await B.trialBalance(db, shop, '2026-11-30'); assert.ok(tb.balanced); return tb.total_dr_minor; };
  const lineOf = (price) => ({ particulars: 'Goods', quantity: 1, unit: 'pc', price, total: price, list_price: price, gst_rate: 10 });
  const inv = (price) => sendMoney.invoiceOfLines({ lines: [lineOf(price)], sellerId: 'd1', buyerId: 'r1', business_json: { billed_at: '2026-11-08T00:00:00Z' }, currency_code: 'AUD' });

  await t('CN: the issuer posts the credit note against its own customer (the buyer on the rail) and the buyer posts the mirror; both TBs balance', async () => {
    const note = await inv(22);
    const chit = { chit_id: 'c0000000-0000-4000-8000-0000000000d1', created_at: '2026-11-08T05:00:00Z', purpose: 'credit_note', business_json: { invoice: note, against: { chit_id: 'c0000000-0000-4000-8000-000000000001', invoice_no: 'WB-INV-2' }, printed_as: 'WB-CN-1' } };
    const mine = K.classify({ chit, entry: { sells: true, buyer: { entity_id: R }, invoice: note }, setting: SET });
    assert.deepStrictEqual([mine.kind, mine.event.type, mine.event.party], ['post', 'return', R], JSON.stringify(mine));
    const theirs = K.classify({ chit, entry: { sells: false, seller: { entity_id: D }, invoice: note }, setting: SET });
    assert.deepStrictEqual([theirs.kind, theirs.event.type, theirs.event.party], ['post', 'purchase_return', D]);
    const before = [await tbOf(D), await tbOf(R)];
    assert.ok((await B.postEntry(db, D, mine.event)).ok);
    assert.ok((await B.postEntry(db, R, theirs.event)).ok);
    const after = [await tbOf(D), await tbOf(R)];
    assert.deepStrictEqual([after[0] - before[0], after[1] - before[1]], [2200, 2200], 'each side moves by A$22.00 (AU prices include GST: 22.00 = 20.00 + 2.00)');
  });

  await t('CN with no buyer anywhere still waits, in words', async () => {
    const note = await inv(22);
    const v = K.classify({ chit: { chit_id: 'c0000000-0000-4000-8000-0000000000d2', created_at: '2026-11-08T05:00:00Z', purpose: 'credit_note', business_json: { invoice: note } }, entry: { sells: true, invoice: note }, setting: SET });
    assert.strictEqual(v.kind, 'queue');
  });

  await t('PAY: R paid A$242.00; D waits for its confirmation, then records the receipt; R’s own copy posts nothing', async () => {
    const advice = { action: 'paid', amount_minor: 24200, currency: 'AUD', mode: 'bank', reference: 'PY/2026-27/000019', paid_on: '2026-11-21', words: 'Retailer paid you A$242.00 by bank.' };
    const copy = (direction, status) => ({ chit_id: 'c0000000-0000-4000-8000-0000000000e1', sender_entity_id: R, direction, current_status: status, created_at: '2026-11-21T01:00:00Z', purpose: 'general', business_json: { kind: 'payment_advice', payment_advice: advice } });
    const wait = K.classify({ chit: copy('received', 'delivered'), entry: {}, setting: SET, status: 'delivered' });
    assert.deepStrictEqual([wait.kind, wait.todo], ['queue', 'accept'], JSON.stringify(wait));
    assert.strictEqual(K.classify({ chit: copy('sent', 'delivered'), entry: {}, setting: SET, status: 'delivered' }).kind, 'none');
    const ok = K.classify({ chit: copy('received', 'accepted'), entry: {}, setting: SET, status: 'accepted' });
    assert.strictEqual(ok.kind, 'payment', JSON.stringify(ok));
    assert.deepStrictEqual([ok.payment.party_id, ok.payment.direction, ok.payment.amount_minor], [R, 'in', 24200]);
    const before = await tbOf(D);
    const rec = await K.recordChitPayment(db, D, ok.payment, { warn: { acknowledge: [], country: 'AU', name: 'Retailer' } });
    assert.ok(rec && rec.payment, JSON.stringify(rec));
    assert.ok(await tbOf(D) - before === 24200, 'D: Dr Bank / Cr Customers 242.00 moves the trial balance by 242.00 each side');
  });

  console.log('\n' + pass + ' checks' + (fail ? ', ' + fail + ' FAILED' : ''));
  process.exit(fail ? 1 : 0);
})();
