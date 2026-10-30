/**
 * ── ⭐⭐⭐ [R58, walk 24 Oct] "THE SHOP'S OWN SALES OFFER CUT A SUPPLIER'S BILL FROM ₹2,940 TO ₹2,910" ──
 * Counter › Receive records Sri Ganesh's bill SG-1021 (8 × Ghee 500 g @ ₹367.50 = ₹2,940) as a goods receipt sent to
 * self with no billed_at. routes/chits.js sendOffers applied the shop's live "₹300 → ₹30 back" to it. The shop is the
 * BUYER on a receipt: the gate is offers-live.isSalesDocument(purpose, business_json), asked at the send call site.
 */
const CF = require('../tools/chits-files.cjs'); /* the ONE list of chits files (tools/chits-files.cjs) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { applyLiveOffers, isSalesDocument } = require('../lib/offers-live');

let pass = 0, fail = 0;
const ok = (name, cond, why) => {
  try { assert.ok(cond, why); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + (why || e.message)); }
};

(async () => {
  console.log('\n── isSalesDocument: a sale sells, a purchase and a despatch do not ──\n');
  ok('the Receive chit (purpose receipt, doc receipt) is not a sales document', isSalesDocument('receipt', { doc: 'receipt' }) === false);
  ok('a receipt by purpose alone is not a sales document', isSalesDocument('receipt', {}) === false);
  ok('a receipt by doc alone (any purpose) is not a sales document', isSalesDocument('general', { doc: 'receipt' }) === false);
  ok('a despatch note is not a sales document', isSalesDocument('delivery_note', { doc: 'despatch' }) === false);
  ok('a counter sale (purpose order, bill_no) IS a sales document', isSalesDocument('order', { bill_no: 'C1/26-27/0003', customer: { name: 'Venkat' } }) === true);
  ok('a captured WhatsApp message (general, via) IS a sales document', isSalesDocument('general', { via: 'whatsapp' }) === true);
  ok('no purpose and no business_json does not throw', isSalesDocument(undefined, null) === true);

  console.log('\n── the walk: ₹2,940 with a live big-bill offer — receipt keeps it, a sale still gets it ──\n');
  const withEntity = async (id, fn) => fn({});
  const seller = { identity_id: 'shop-1', currency_code: 'INR' };
  const ghee = () => [{ item_id: 'ghee-500', sku: 'GHEE500', kind: 'item', price: 367.5, quantity: 8, total: 2940, d: { categories: [] } }];
  const cat = require('../lib/catalogue-view');
  const groups = require('../lib/customer-groups');
  const realLive = cat.liveOffers, realGroups = groups.groupsOf;
  cat.liveOffers = async () => [{ id: 'big-bill', kind: 'amount_off', amount: 30, scope: 'cart', threshold: 300, label: 'Reward a big bill' }];
  groups.groupsOf = async () => [];
  /* the exact gate routes/chits.js sendOffers runs: skip when billed, or when the document is not a sale */
  const sendOffersOn = async (purpose, bj) => {
    if (!isSalesDocument(purpose, bj)) return { items: ghee(), applied: [] };
    return applyLiveOffers(seller, ghee(), null, { withEntity });
  };
  const totalOf = (r) => Math.round(r.items.reduce((s, l) => s + Number(l.total), 0) * 100) / 100;
  try {
    const rcv = await sendOffersOn('receipt', { doc: 'receipt', doc_no: 'SG-1021', source: { name: 'Sri Ganesh Provisions' } });
    ok('goods receipt SG-1021 keeps ₹2,940.00 with the big-bill offer live', totalOf(rcv) === 2940 && rcv.applied.length === 0, 'got ' + totalOf(rcv));
    const sale = await sendOffersOn('order', { customer: { name: 'Walk-in' } });
    const sold = totalOf(sale);
    ok('a counter-style sale of the same lines still gets the offer (₹2,940 does not stand)', sold < 2940, 'got ' + sold + ' - if the engine no longer discounts, this stops proving anything');
  } finally { cat.liveOffers = realLive; groups.groupsOf = realGroups; }

  console.log('\n── routes/chits.js asks the gate at the one place offers are applied ──\n');
  const src = CF.read(path.join(__dirname, '..'));
  ok('sendOffers reads purpose from the send state', /async function sendOffers\([^)]*\)\s*\{\s*const \{ sender_id, purpose,/.test(src));
  ok('the applyLiveOffers guard also asks isSalesDocument(purpose, bj)', /if \(!alreadyBilled && \([^)]*\) && require\('\.\.\/lib\/offers-live'\)\.isSalesDocument\(purpose, bj\)\)/.test(src));

  console.log('\n' + (fail ? '✗ ' + fail + ' failed' : '✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
