/**
 * aj-today-sales.test.cjs - AJ-F-08 (walk AJ, 21 Nov 2026): "today's sales" read four ways on one shop (Home Takings 452.50, Home Sold 348.50 · 12 bills, till/summary gross 1092.00, overview 369.00).
 * ONE definition: the Day book's SOLD for the shop's own posting day (books-store soldByDay / soldEntriesSql), net of credit notes, one count per BILL; a rail credit note is never a till sale.
 * Hand figures (the AJ shop, minor units): 8 till bills 9850+6000+5000+4500+5500+4000+5400+5000 = 45250 (A$/AED 452.50 = Takings, tender roles only);
 * two credit notes 400 + 10000 (the 500.00 one is capped to its 100.00 bill, AI-F-02) hit debtors, so SOLD = 45250 - 10400 = 34850 (348.50) over 8 bills (a return is no bill; it was 10, then 12 with the double counts).
 * The till list and the day's gross read the counters' bills only: 45250, 8 bills (it read 1092.00 / 12 with the rail notes and a double). The overview is the SAME SOLD rule over a PERIOD (period.word, from, to), so it equals Home on a one-day period.
 * Run: node tests/aj-today-sales.test.cjs
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const S = require(path.join(root, 'lib', 'books-store.js'));
const CB = require(path.join(root, 'lib', 'counter-bill.js'));
const R = require(path.join(root, 'lib', 'rollup.js'));
let pass = 0, fail = 0;
const t = (name, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n         got  ' + a + '\n         want ' + b); } };
(async () => {
  const till = fs.readFileSync(path.join(root, 'routes', 'till.js'), 'utf8');
  t('every till list (Earlier bills, its withdrawn arm, today\'s live bills) carries the ONE counter-row condition', till.split('${counterBill.COUNTER_ROW_SQL}').length - 1, 3);
  t('the condition: a credit note needs its counter (business_json.till.id); orders and offers are unchanged', CB.COUNTER_ROW_SQL, "AND (h.purpose <> 'credit_note' OR h.business_json -> 'till' ->> 'id' IS NOT NULL)");
  const sql = S.soldEntriesSql ? S.soldEntriesSql('$1', {}) : fs.readFileSync(path.join(root, 'lib', 'books-store.js'), 'utf8');
  t('a return is never a bill, even when it names its chit', /CASE WHEN h\.event_type = 'return' THEN 0 ELSE COALESCE\(cardinality\(h\.source_chit_ids\), 1\) END AS bills/.test(sql), true);
  const bills = [9850, 6000, 5000, 4500, 5500, 4000, 5400, 5000];
  const rows = bills.map((total) => ({ kind: 'sale', total: total / 100, payments: [{ how: 'cash', amount: total / 100 }] }));
  const day = R.totals(rows);
  t('the counters\' day: 8 bills, gross 452.50 (the hand figure), no credit note among them', [day.count, day.gross], [8, 452.5]);
  const db = { query: async () => ({ rows: [{ day: '2026-11-21', sold: '34850', taken: '45250', bills: '8', cur_lo: 'AED', cur_hi: 'AED' }] }) };
  const [d] = await S.soldByDay(db, 'e', { from: '2026-11-21', to: '2026-11-21' });
  t('Home on the one rule: Sold 348.50 (net of the two credit notes) over 8 bills, Takings 452.50; Sold = Takings - the notes on account (452.50 - 104.00)', [d.sold.minor, d.taken.minor, d.bills, d.taken.minor - 10400 === d.sold.minor], [34850, 45250, 8, true]);
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
