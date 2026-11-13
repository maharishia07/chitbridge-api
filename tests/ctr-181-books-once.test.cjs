/**
 * tests/ctr-181-books-once.test.cjs — CTR-181: A SECOND VERSION OF A DAY SUMMARY POSTS NOTHING A SECOND TIME.
 * A day summary classifies as kind 'day' and runs postDay under source_ref walkin:<counter>:<day> (lib/books-hooks.js). That posting is idempotent
 * (entryBySource), so version #2 of the same counter-day answers duplicate and the books hold ONE day entry. Runs the REAL postChit on #1 and on #2.
 * OWNS      the "books hold one day entry however many versions of its summary arrive" claim of lib/summary-reclose.
 * CALLED BY scripts/guards.cjs (the offline gate).
 * FLOW      lib/books-hooks postChit → classify (day) → postDay → books-store entryBySource, over the in-memory books harness
 * CARD      09-counter/day-close
 * Run: node tests/ctr-181-books-once.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0,
  fail = 0;
const ok = (name, cond, why) => {
  if (cond) {
    pass++;
    console.log('   ok   ' + name);
  } else {
    fail++;
    console.log('   FAIL ' + name + (why ? '\n          ' + String(why).slice(0, 300) : ''));
  }
};
const SHOP = '11111111-1111-4111-8111-111111111111';

(async () => {
  const X = H.load();
  if (!X.src.dir) {
    console.log('   SKIP the books engines are not here: ' + X.src.why);
    process.exit(0);
  }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  const summaryCopy = (id, bills, revision) => ({
    chit_id: id,
    purpose: 'general',
    sender_entity_id: SHOP,
    currency_code: 'INR',
    business_json: { summary: Object.assign({ period: 'day', key: '2026-10-01', till: { id: 'C1' }, totals: { bills } }, revision ? { revision } : {}) }
  });
  let copyNow = null;
  TC.copyOf = async () => copyNow;
  const invoice = { currency: 'INR', ItemList: [{ GstRt: 18, AssAmt: 100, CgstAmt: 9, SgstAmt: 9, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 118 } };
  TC.entryFor = async (copy) => (copy.chit_id === 'bill-1' ? { sells: true, seller: { entity_id: SHOP }, me: { entity_id: SHOP }, buyer: { entity_id: null }, invoice } : {});
  X.store.counterBills = async () => [
    { chit_id: 'bill-1', purpose: 'order', sender_entity_id: SHOP, currency_code: 'INR', business_json: { bill_no: 'C1-0001', till: { id: 'C1' }, billed_at: '2026-10-01T05:00:00Z', customer: { name: 'Walk-in' }, payment: { parts: [{ how: 'Cash', amount: 118 }] } } }
  ];
  await X.store.saveSetting(X.db, SHOP, { enabled: true });
  await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-10-01' });
  K.forget(SHOP);
  const dayEntries = () => X.T.entries.filter((e) => e.entity_id === SHOP && e.source_ref === 'walkin:C1:2026-10-01');

  copyNow = summaryCopy('sum-1', 1);
  const first = await K.postChit(SHOP, 'sum-1', {});
  ok('version #1 of the day summary posts the walk-in day: one entry under walkin:C1:2026-10-01', dayEntries().length === 1 && !first.queued, JSON.stringify(first));
  copyNow = summaryCopy('sum-2', 2, 2);
  const second = await K.postChit(SHOP, 'sum-2', {});
  ok('version #2 (the re-close) answers duplicate and posts nothing again', second.duplicate === true && dayEntries().length === 1, JSON.stringify(second));
  ok('the books still hold ONE day entry in all', X.T.entries.filter((e) => e.entity_id === SHOP && /^walkin:/.test(e.source_ref || '')).length === 1);
  console.log(String.fromCharCode(10) + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
