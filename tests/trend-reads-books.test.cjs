/**
 * trend-reads-books.test.cjs — REP-48 (lifecycle S9-9b): Trend's sales are READ FROM THE BOOKS, not from the counters' day summaries.
 *
 * Offline: the real lib/till-summary over the in-memory books (a cash day + a credit bill, posted by lib/books.postEntry) and a stub
 * read for the shop's year and the summaries. Held here:
 *   · a cash day plus a credit bill (a bill no summary holds) → the Trend week = the Day book's Sold = P&L sales for the same days
 *   · a day the counters never summarised is in; a stored summary for that week is replaced, not added to (no second sum)
 *   · books switched off → the counters' summaries, with the words saying so (sales_note) — never a 0
 *   · the week where the books begin carries its day keys, so the engine itself says it is short
 * Run: node tests/trend-reads-books.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-09-20T10:00:00Z'); /* a Sunday: the ISO week 2026-W38 (14–20 Sep) is the running one */
const S = { shop: null, week: [] };
const summaryRow = (key, gross) => ({ business_json: { summary: { period: 'week', key, till: { id: 'C1' }, totals: { count: 1, returns: 0, gross, refunds: 0, expenseCount: 0, expenses: 0, total: gross, by: {} } } } });

(async () => {
  console.log('\n══ REP-48 · Trend reads the books ══\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); process.exit(0); }
  /* the shop's year + summaries stand-in: db is already the harness's stub; add readBatch */
  const stub = require.cache[require.resolve(path.join(H.API, 'db'))].exports;
  stub.readBatch = async (_e, _a, stmts) => stmts.map((s) => (/AS gov\b/.test(s.text) ? { rows: [S.shop] } : { rows: S.week }));
  const TS = require(path.join(H.API, 'lib', 'till-summary'));
  await X.B.enable(X.db, SHOP, {});
  X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi Stores', customer: true, credit_days: 10 });
  /* a cash day (two cash bills, 14 Sep) and one credit bill (15 Sep) — no tax rate, so the P&L's Sales line is the whole bill */
  const bill = (ref, date, taxable, o) => X.B.postEntry(X.db, SHOP, Object.assign({ type: 'sale_bill', date, currency: 'INR', source_ref: ref, by_rate: [{ rate: 0, taxable, cgst: 0, sgst: 0, igst: 0 }], round_off: 0 }, o));
  for (const r of [await bill('t:1', '2026-09-14', 300, { paid: { cash: 300 } }), await bill('t:2', '2026-09-14', 240, { paid: { cash: 240 } }), await bill('t:3', '2026-09-15', 1400, { party: CUST, paid: {} })]) if (!r.ok) ok('posting', false, JSON.stringify(r));

  S.shop = { country: 'IN', currency_code: 'INR', books: { enabled: true, fy_start_month: 4, functional_currency: 'INR' }, gov: null };
  const pl = await X.B.profitAndLoss(X.db, SHOP, '2026-09-01', '2026-09-30');
  const plSales = pl.income.reduce((t, l) => t + l.amount_minor, 0);
  let r = await TS.trend(SHOP, 'actor', { period: 'week', n: 4, now: NOW });
  const last = r.body.slots[r.body.slots.length - 1];
  ok('the week holds the cash day AND the credit bill: 1940.00', last.key === '2026-W38' && last.gross_minor === 194000, JSON.stringify(last));
  ok('Trend = the P&L sales for the same days (books, not the summaries)', last.gross_minor === plSales && plSales === 194000, last.gross_minor + ' vs P&L ' + plSales);
  ok('sales_from says books, no note', r.body.sales_from === 'books' && r.body.sales_note === null, r.body.sales_from + ' ' + r.body.sales_note);
  ok('the week the books begin in names its day keys: the engine says it is short', last.coverage.short === true, JSON.stringify(last.coverage));

  S.week = [summaryRow('2026-W38', 540), summaryRow('2026-W37', 100)]; /* the counters' own summary: only the cash day, the credit bill is in none */
  r = await TS.trend(SHOP, 'actor', { period: 'week', n: 4, now: NOW });
  ok('a stored summary of the same week is replaced, never added to: 1940.00 not 2480.00', r.body.slots[3].gross_minor === 194000, String(r.body.slots[3].gross_minor));
  const t = TS.teaser([S.shop && { country: 'IN', currency_code: 'INR', books: S.shop.books }].map((x) => ({ rows: [x] }))[0], { rows: S.week }, NOW, await TS.booksSold(SHOP, { rows: [S.shop] }));
  ok('the Home teaser is the same week from the same books', !!t && t.spark[7] === 194000, JSON.stringify(t));

  /* REP-54: a fresh shop - no summary at all, one week in the books - still gets its Sold on the Home teaser (lifecycle S9-9b) */
  S.week = [];
  const fresh = TS.teaser({ rows: [S.shop] }, { rows: [] }, NOW, await TS.booksSold(SHOP, { rows: [S.shop] }));
  ok('one week of the books and no summary: the teaser answers, latest week 1940.00, earlier weeks null', !!fresh && fresh.spark[7] === 194000 && fresh.spark[6] === null, JSON.stringify(fresh));
  const sentence = TS.firstWeekLine(fresh, { rows: [S.shop] });
  ok('one figure: the server says it, with the money in the shop currency (REP-55)', !!sentence && sentence.text === 'First week: {money} so far' && sentence.money.amount === 1940 && sentence.money.currency === 'INR', JSON.stringify(sentence));
  ok('several figures (or none): no sentence, the chart speaks', TS.firstWeekLine({ spark: [1, 2] }, { rows: [S.shop] }) === null && TS.firstWeekLine(undefined, { rows: [S.shop] }) === null, '');
  r = await TS.trend(SHOP, 'actor', { period: 'week', n: 4, now: NOW });
  ok('the Reports week tab holds the same 1940.00 with no summary', r.body.slots[3].gross_minor === 194000, String(r.body.slots[3].gross_minor));

  S.shop = { country: 'IN', currency_code: 'INR', books: { enabled: false, fy_start_month: 4 }, gov: null };
  S.week = [summaryRow('2026-W38', 540), summaryRow('2026-W37', 100)];
  r = await TS.trend(SHOP, 'actor', { period: 'week', n: 4, now: NOW });
  ok('books off: the counters\' summary (540.00), said in words, from "summaries"', r.body.slots[3].gross_minor === 54000 && r.body.sales_from === 'summaries' && /books are not switched on/.test(r.body.sales_note), JSON.stringify([r.body.slots[3].gross_minor, r.body.sales_from, r.body.sales_note]));
  S.week = [];
  r = await TS.trend(SHOP, 'actor', { period: 'week', n: 4, now: NOW });
  ok('books off and no summary: the slot is null (never 0) and the words say why', r.body.slots[3].gross_minor === null && !!r.body.sales_note, String(r.body.slots[3].gross_minor));

  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
