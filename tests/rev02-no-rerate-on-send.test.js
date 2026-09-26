/**
 * ── ⭐⭐⭐ [REV-02] "A BILL THE CUSTOMER HAS PAID IS RE-PRICED AT TODAY'S OFFERS WHEN IT SYNCS" ─────────────────
 *
 * External review, 2026-09-25: routes/chits.js:700,717,748 · lib/offers-live.js:52.
 *
 * Monday 19:00, line down, customer pays ₹500 cash, takes a printed slip with no offer on it. Tuesday the shop
 * launches "10% off". Wednesday the queue drains: send re-runs the seller's LIVE offers over a plain line that
 * carries none, and the recorded chit says net ₹450 — a number the customer never saw and never agreed to. The
 * same defect over-refunds a credit note the same way.
 *
 * The fix is `lib/offers-live.js`'s `alreadyBilled(business_json)` — true only when `billed_at` is present,
 * which ONLY till.html/till.js ever set (verified below: no compose/capture/storefront path in chitbridge-web
 * sets it) — gating whether routes/chits.js calls `applyLiveOffers` AT ALL for that chit. A captured/typed sale
 * (no billed_at) is unaffected; that path is what the live-offers call exists for.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { applyLiveOffers, alreadyBilled } = require('../lib/offers-live');

let pass = 0, fail = 0;
const ok = (name, cond, why) => {
  try {
    assert.ok(cond, why);
    pass++; console.log('  ok    ' + name);
  } catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + (why || e.message)); }
};

console.log('\n── alreadyBilled() names exactly what the till stamps, nothing else ──\n');
ok('a chit with billed_at (a real till/counter document) is "already billed"',
  alreadyBilled({ billed_at: '2026-09-22T19:00:00.000Z', customer: { name: 'Walk-in' } }) === true);
ok('a credit note carries billed_at too (chitOfCN sets it the same way) — also gated',
  alreadyBilled({ billed_at: '2026-09-22T19:00:00.000Z', refund: { total: 90 } }) === true);
ok('a captured/typed sale with NO billed_at is NOT "already billed" — still gets live offers',
  alreadyBilled({ customer: { name: 'Walk-in' } }) === false);
ok('a WhatsApp capture (business_json.via, no billed_at) is NOT "already billed"',
  alreadyBilled({ via: 'whatsapp' }) === false);
ok('no business_json at all does not throw', alreadyBilled(null) === false);
ok('an empty-string billed_at is not a real timestamp', alreadyBilled({ billed_at: '' }) === false);

console.log('\n── only till.html/till.js ever produce billed_at — grep says so, not an assumption ──\n');
const grep = (dir, pattern) => {
  const hits = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { if (!/node_modules|\.git/.test(f.name)) walk(p); }
      else if (/\.(js|jsx|cjs|html)$/.test(f.name) && fs.readFileSync(p, 'utf8').includes(pattern)) hits.push(p);
    }
  };
  walk(dir);
  return hits;
};
const webSrc = path.join(__dirname, '..', '..', 'chitbridge-web', 'src');
if (fs.existsSync(webSrc)) {
  const hits = grep(webSrc, 'billed_at');
  ok('no compose/capture/storefront page in chitbridge-web/src sets billed_at', hits.length === 0,
    'found in: ' + hits.join(', ') + ' — alreadyBilled() would now also gate this path; verify that is intended');
} else {
  console.log('  (skipped — chitbridge-web checkout not found beside this repo)');
}

console.log('\n── the exact reproduction: Monday\'s plain line, Tuesday\'s new offer, Wednesday\'s sync ──\n');
(async () => {
  const withEntity = async (id, fn) => fn({});
  const seller = { identity_id: 'seller-1', currency_code: 'INR' };
  const monaysLine = [{ item_id: 'oil-1', sku: 'OIL1', kind: 'item', price: 118, quantity: 2, total: 236, d: { categories: [] } }];

  // Prove offers-live.js ITSELF is unchanged: if it were still called on this bill, it WOULD reprice the line —
  // the bug was never in this function (it already skips a line with `.offer`), it was in calling it at all.
  const fakeLive = require('../lib/catalogue-view');
  const realLiveOffers = fakeLive.liveOffers;
  fakeLive.liveOffers = async () => [{ id: 'flat10', kind: 'percent_off', percent: 10, scope: 'line', label: 'Flat 10%' }];
  const realGroupsOf = require('../lib/customer-groups').groupsOf;
  require('../lib/customer-groups').groupsOf = async () => [];
  try {
    const r = await applyLiveOffers(seller, monaysLine.map((l) => Object.assign({}, l)), null, { withEntity });
    ok('offers-live.js still reprices a PLAIN line when it is actually called (proves the fix is the CALLER, not this function)',
      r.items[0].total < 236, 'got total=' + r.items[0].total + ' — if this ever stops discounting, this test stops proving anything');
  } finally {
    fakeLive.liveOffers = realLiveOffers;
    require('../lib/customer-groups').groupsOf = realGroupsOf;
  }

  // And the actual guard: a chit whose business_json carries billed_at must never reach that call at all.
  ok('a Monday sale with no offer, synced Wednesday after Tuesday\'s "10% off", stays gated',
    alreadyBilled({ billed_at: '2026-09-22T19:00:00.000Z', customer: { name: 'Walk-in' } }) === true,
    'routes/chits.js reads exactly this before deciding whether to call applyLiveOffers()');

  console.log('\n── routes/chits.js\'s OWN call site must keep asking alreadyBilled() before offers-live runs ──\n');
  const chitsSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chits.js'), 'utf8');
  ok('the send route calls offers-live.alreadyBilled(business_json)',
    /alreadyBilled\s*\(\s*bj\s*\)/.test(chitsSrc) && /offers-live['"]\)\.alreadyBilled/.test(chitsSrc));
  ok('the applyLiveOffers guard is gated on !alreadyBilled',
    /if\s*\(\s*!alreadyBilled\s*&&\s*\(bj\.customer/.test(chitsSrc));
  ok('the invoice summary\'s document date prefers billed_at over "now"',
    /invAt\s*=\s*\(business_json\s*&&\s*business_json\.billed_at\)\s*\|\|\s*new Date/.test(chitsSrc));

  console.log('\n' + (fail ? '✗ ' + fail + ' failed' : '✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
