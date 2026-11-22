/**
 * ye-f03-last-year.test.cjs — YE-F-03 (walk YE 21 Nov 2026): "same time last year" reads the books' prior range.
 * Books begin 12 Sep 2025 (a part month). Trend (month tab): Sep 2026 holds Sep 2025's figure; books-mis lastYearBar says partial.
 * Run: node tests/ye-f03-last-year.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-09-20T10:00:00Z');
(async () => {
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); process.exit(0); }
  const stub = require.cache[require.resolve(path.join(H.API, 'db'))].exports;
  const shop = { country: 'IN', currency_code: 'INR', books: { enabled: true, fy_start_month: 4, functional_currency: 'INR' }, gov: null };
  stub.readBatch = async (_e, _a, stmts) => stmts.map((s) => (/AS gov\b/.test(s.text) ? { rows: [shop] } : { rows: [] }));
  const TS = require(path.join(H.API, 'lib', 'till-summary'));
  await X.B.enable(X.db, SHOP, { by: SHOP, today: '2025-04-01' });
  X.T.setting.get(SHOP).enabled_at = '2025-05-01T02:00:00.000Z'; /* the memory store stamps its own day */
  const bill = (ref, date, taxable) => X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date, currency: 'INR', source_ref: ref, by_rate: [{ rate: 0, taxable, cgst: 0, sgst: 0, igst: 0 }], round_off: 0, paid: { cash: taxable } });
  for (const r of [await bill('t:1', '2025-09-12', 5104.32), await bill('t:2', '2026-09-14', 4909.84)]) if (!r.ok) ok('posting', false, JSON.stringify(r));
  const r = await TS.trend(SHOP, 'actor', { period: 'month', n: 12, now: NOW });
  const sep = r.body.slots.find((s) => s.key === '2026-09');
  ok('Sep 2026 holds Sep 2025 (books begin 12 Sep 2025) as its last year: 5104.32', !!sep && sep.last_year && sep.last_year.gross_minor === 510432, JSON.stringify(sep));
  ok('the months with no earlier range stay null, never 0', r.body.slots.filter((s) => s.key !== '2026-09').every((s) => !s.last_year || s.last_year.gross_minor === null), JSON.stringify(r.body.slots.map((s) => s.last_year && s.last_year.gross_minor)));
  const MIS = require(path.join(H.API, 'lib', 'books-mis'));
  const ov = await MIS.read(X.db, SHOP, { books: X.T.setting.get(SHOP) }, { period: 'ytd', today: '2026-09-20', fyMonth: 4, seat: { blind: true, cash: false } });
  const sepBar = ov.bars.find((b) => b.from === '2026-09-01');
  ok('the How we are doing bar for Sep 2026 reads Sep 2025 (510432), flagged partial (books began 12 Sep)', sepBar && sepBar.last_year_minor === 510432 && sepBar.last_year_partial === true, JSON.stringify(sepBar));
  ok('a month with no day a year before stays null with no partial flag', ov.bars.filter((b) => b !== sepBar).every((b) => b.last_year_minor === null && !b.last_year_partial), JSON.stringify(ov.bars.map((b) => b.last_year_minor)));
  console.log(`\n${pass + fail} checks, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
