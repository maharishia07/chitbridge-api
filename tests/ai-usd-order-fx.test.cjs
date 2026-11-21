/**
 * ai-usd-order-fx.test.cjs - AI-F-01 (walk AI, 21 Nov 2026): an order of 10 x 65.00 USD stays USD end to end, and the books carry its AUD equivalent through the ONE fx engine.
 * Hand figures (minor units): 10 x 6500 = 65000 US cents = US$650.00; the day's rate 1.55 AUD per USD (22 Nov) -> 65000 x 1.55 = 100750 = A$1,007.50 (the walk's own figure).
 * The send half (currency kept USD, money block 650.00 USD) is tests/send-seller-currency.test.cjs; the commercial invoice reading the order's currency and rate is tests/trade-srv1.test.cjs.
 * Run: node tests/ai-usd-order-fx.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '44444444-4444-4444-8444-444444444444', VENDOR = '55555555-5555-4555-8555-555555555555';
(async () => {
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const { B, T, db } = X;
  const FX = require(path.join(H.API, 'lib', 'fx-rates'));
  require(path.join(H.API, 'lib', 'shop-clock')).set('2026-11-22T06:00:00Z');
  T.fxReady = true; T.fxLines = true;
  T.parties.push({ owner: SHOP, party_id: VENDOR, name: 'Chip Co (US)', supplier: true, credit_days: 30 });
  await B.enable(db, SHOP, { by: SHOP, today: '2026-10-01', country: 'AU' });
  const s = await B.settingOf(db, SHOP);
  await FX.add(db, SHOP, s, { date: '2026-11-22', currency: 'USD', rate: 1.55 }, SHOP);
  const bill = await B.postEntry(db, SHOP, { type: 'purchase_bill', date: '2026-11-22', currency: 'USD', party: VENDOR, by_rate: [{ rate: 0, taxable: 650 }], source_ref: 'chit:ai1', ref: 'AI-1' });
  const line = T.lines.find((l) => l.entry_id === bill.entry_id && l.role === 'creditors');
  ok('USD 650.00 posts in AUD at 1.55: the supplier line Cr 100750 (A$1,007.50), the line keeps US$650.00 (65000) and the rate', !!line && line.cr_minor === 100750 && line.txn_currency === 'USD' && line.amount_txn_minor === 65000 && Number(line.fx_rate) === 1.55, JSON.stringify(line));
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
