/**
 * books-sql-window-first.test.cjs — MIS SPEED (offline): the window's entries are found FIRST, and an entry's lines are tested by account id, never by a ledger_account join per entry.
 * WHY: on a real Postgres (7 years, 14,058 entries) the old shapes read the shop's whole book: soldByDay joined ledger_account once per entry (14,080 of 19,471 page reads), and the GST EXISTS / NOT EXISTS in
 * taxedIncomeLines · taxedOnlyLines · taxEntryLines read every GST line of every year (385 ms for a quarter, against 12). The answers are unchanged (fuzzed old against new on a real Postgres: reversals, opening entries,
 * two currencies, role-less ledgers: 41 comparisons, 0 differ). This test keeps the SHAPE: a later edit that puts the correlated EXISTS or the per-entry join back fails here.
 * Run: node tests/books-sql-window-first.test.cjs
 */
'use strict';
const path = require('path');
process.env.DATABASE_URL = '';
const S = require(path.join(__dirname, '..', 'lib', 'books-store.js'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name); } };
const E = '11111111-1111-4111-8111-111111111111';
const texts = {};
const db = { query: async (text) => { texts[text.slice(0, 60)] = text; return { rows: [] }; } };

(async () => {
  const sold = S.soldEntriesSql('$1', { from: '$2', to: '$3' });
  ok('the SOLD fragment resolves its account ids once (ids) and tests lines by id', /WITH ids AS/.test(sold) && /l\.account_id = ANY\(ids\.sold_ids\)/.test(sold));
  ok('the SOLD fragment does not join ledger_account per entry', !/JOIN ledger_account/.test(sold));
  ok('the SOLD fragment still finds the window first (OFFSET 0) and each entry\'s lines by LATERAL', /OFFSET 0\) h/.test(sold) && /CROSS JOIN LATERAL/.test(sold));
  const shapes = [['taxedIncomeLines', () => S.taxedIncomeLines(db, E, '2026-10-01', '2026-12-31', 'gst_collected', ['sales'])],
    ['taxedOnlyLines', () => S.taxedOnlyLines(db, E, '2026-10-01', '2026-12-31', 'gst_paid', ['purchases'])],
    ['taxEntryLines', () => S.taxEntryLines(db, E, '2026-10-01', '2026-12-31', ['gst_payment'], { tax: ['gst_collected'], money: ['cash'] })]];
  for (const [name, call] of shapes) {
    Object.keys(texts).forEach((k) => delete texts[k]);
    await call();
    const text = Object.values(texts)[0] || '';
    ok(name + ': the window of entries first (OFFSET 0), their lines by ONE array read of the entry index', /OFFSET 0\)/.test(text) && /l\.entry_id = ANY\(ARRAY\(SELECT entry_id FROM win\)\)/.test(text));
    ok(name + ': no correlated EXISTS and no per-entry LATERAL over the shop\'s lines (RETURNS SPEED: on a book with no statistics yet each entry read every line, 15 s)', !/EXISTS \(SELECT 1 FROM journal_line/.test(text) && !/CROSS JOIN LATERAL/.test(text));
  }
  /* RETURNS SPEED: entryLines over a whole window (no page, no account, no party) reads its lines by one array read and joins the entry by its key */
  Object.keys(texts).forEach((k) => delete texts[k]);
  await S.entryLines(db, E, '2026-10-01', '2026-12-31', null, null);
  const whole = Object.values(texts)[0] || '';
  ok('entryLines (whole window): its lines by one array read, the entry joined by its key', /l\.entry_id = ANY\(ARRAY\(SELECT entry_id FROM win\)\)/.test(whole) && /ln l JOIN journal_entry h ON h\.entry_id = l\.entry_id/.test(whole));
  ok('entryLines (whole window): no date test on the joined entry (it would restart the plan at the entry date index)', !/AND h\.posting_date >= \$2::date/.test(whole.slice(whole.indexOf('FROM ln l'))));
  Object.keys(texts).forEach((k) => delete texts[k]);
  await S.entryLines(db, E, '2026-10-01', '2026-12-31', null, null, { limit: 10 });
  ok('entryLines (a page): unchanged, the lines first', !/WITH win AS/.test(Object.values(texts)[0] || ''));
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
