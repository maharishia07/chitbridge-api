'use strict';
/**
 * tests/books-sold-totals.realstack.cjs — MIS A1: books-store.soldTotals (ONE statement, N ranges) equals the SUM of soldByDay over the same range, on a REAL Postgres.
 * Fixture (one throwaway entity): sales on each boundary day inside and outside the ranges, a sale that was REVERSED (both left out), a return (a credit), a day in a second currency (the range is '*mixed*').
 * Run on a throwaway database that has the api's migrations (tools/migrate.cjs): DATABASE_URL=postgres://postgres:x@127.0.0.1/postgres node tests/books-sold-totals.realstack.cjs
 * Without DATABASE_URL it says so and exits 0 (not part of the offline guard). Runs as cb_app with RLS on (sit-realstack): the session names its entity; the SQL is the text the app runs.
 */
if (!process.env.DATABASE_URL) { console.log('skipped: needs DATABASE_URL (a throwaway migrated database)'); process.exit(0); }
process.env.NODE_ENV = 'test';
const crypto = require('crypto'), { Client } = require('pg');
const S = require('../lib/books-store');
const uuid = () => crypto.randomUUID();
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const E = uuid(), cash = uuid(), debtors = uuid(), sales = uuid(); let n = 0;
  try {
    await c.query("SELECT set_config('app.current_entity', $1, false)", [E]); /* the ledger tables are under RLS (cb_app): the session names its entity, as the api does per request (same as books-tb-compare) */
    for (const [id, code, role, nature] of [[cash, 'C1', 'cash', 'asset'], [debtors, 'D1', 'debtors', 'asset'], [sales, 'S1', 'sales', 'income']])
      await c.query('INSERT INTO ledger_account (account_id, entity_id, code, name, nature, role) VALUES ($1,$2,$3,$3,$4,$5)', [id, E, code, nature, role]);
    const entry = async (day, kind, lines, reverses, cur) => {
      const id = uuid(); n++;
      await c.query('BEGIN'); /* b904: an entry balances at COMMIT, so its header and every line share one transaction */
      await c.query('INSERT INTO journal_entry (entry_id, entity_id, entry_no, posting_date, fiscal_year, period, event_type, currency, total_minor, reverses_entry_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, E, 'T' + n, day, 'FY' + day.slice(0, 4), Number(day.slice(5, 7)), kind, cur || 'AUD', 1, reverses || null]);
      let i = 0;
      for (const [acct, dr, cr] of lines) await c.query('INSERT INTO journal_line (entry_id, entity_id, line_no, account_id, dr_minor, cr_minor, currency) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, E, ++i, acct, dr, cr, cur || 'AUD']);
      await c.query('COMMIT');
      return id;
    };
    await entry('2026-01-01', 'walkin_day', [[cash, 1000, 0], [sales, 0, 1000]]);
    await entry('2026-01-01', 'sale_bill', [[debtors, 500, 0], [sales, 0, 500]]);
    await entry('2026-06-30', 'walkin_day', [[cash, 2000, 0], [sales, 0, 2000]]);
    const gone = await entry('2026-07-01', 'sale_bill', [[debtors, 7777, 0], [sales, 0, 7777]]);
    await entry('2026-07-02', 'sale_bill', [[debtors, 0, 7777], [sales, 7777, 0]], gone);
    await entry('2026-07-01', 'walkin_day', [[cash, 4000, 0], [sales, 0, 4000]]);
    await entry('2026-11-05', 'return', [[cash, 0, 300], [sales, 300, 0]]);
    await entry('2026-11-17', 'walkin_day', [[cash, 900, 0], [sales, 0, 900]]);
    await entry('2026-11-18', 'walkin_day', [[cash, 99999, 0], [sales, 0, 99999]]);
    await entry('2025-12-31', 'walkin_day', [[cash, 12345, 0], [sales, 0, 12345]]);
    await entry('2026-03-03', 'walkin_day', [[cash, 100, 0], [sales, 0, 100]], null, 'USD');
    let lastText = '';
    const db = { query: (t, p) => { lastText = t; return c.query(t, p); } };
    const ranges = [{ from: '2026-01-01', to: '2026-11-17' }, { from: '2026-07-01', to: '2026-11-17' }, { from: '2026-01-01', to: '2026-01-01' }, { from: '2026-11-17', to: '2026-11-17' }, { from: '2026-04-01', to: '2026-06-29' }, { from: '2026-01-02', to: '2026-02-28' }, { from: '2025-01-01', to: '2025-06-30' }];
    const got = await S.soldTotals(db, E, ranges), totalsText = lastText;
    ok('one answer per range, in the order asked', got.length === ranges.length && got.every((g, i) => g.from === ranges[i].from && g.to === ranges[i].to));
    for (let i = 0; i < ranges.length; i++) {
      const days = await S.soldByDay(db, E, ranges[i]);
      const cur = new Set(days.map((d) => d.sold.currency)), mixed = cur.size > 1 || cur.has('*mixed*');
      const want = { sold: mixed ? null : days.reduce((t, d) => t + d.sold.minor, 0), taken: mixed ? null : days.reduce((t, d) => t + d.taken.minor, 0), bills: days.reduce((t, d) => t + d.bills, 0), through: days.length ? days[days.length - 1].day : null, first: days.length ? days[0].day : null, currency: mixed ? '*mixed*' : days.length ? [...cur][0] : null };
      const g = got[i];
      ok('range ' + ranges[i].from + '..' + ranges[i].to + ' = the sum of soldByDay (sold ' + g.sold.minor + ', taken ' + g.taken.minor + ', bills ' + g.bills + ', ' + g.sold.currency + ')', g.sold.minor === want.sold && g.taken.minor === want.taken && g.bills === want.bills && g.through === want.through && g.first === want.first && (g.sold.currency === want.currency || (want.currency == null && g.sold.currency == null)), JSON.stringify([g, want]));
    }
    ok('by hand: the year range holds a USD day, so it is mixed (no sum, never added across)', got[0].sold.currency === '*mixed*' && got[0].sold.minor === null, JSON.stringify(got[0].sold));
    ok('by hand: 1 Jul to 17 Nov = 4000 - 300 + 900 = 4600 (the reversed 7777 and its reversal are out; the day after is out)', got[1].sold.minor === 4600 && got[1].sold.currency === 'AUD', JSON.stringify(got[1].sold));
    ok('by hand: the first day alone = 1500 over 2 bills; the last day alone = 900', got[2].sold.minor === 1500 && got[2].bills === 2 && got[3].sold.minor === 900, JSON.stringify([got[2], got[3]]));
    ok('an empty range has entries 0 and through null (the caller says "no figure", not 0)', got[6].entries === 0 && got[6].through === null, JSON.stringify(got[6]));
    ok('one statement, however many ranges', (totalsText.match(/UNION ALL/g) || []).length === ranges.length - 1);
  } finally {
    await c.query('UPDATE journal_entry SET reverses_entry_id = NULL WHERE entity_id = $1', [E]).catch(() => {});
    await c.query('DELETE FROM journal_line WHERE entity_id = $1', [E]).catch(() => {});
    await c.query('DELETE FROM journal_entry WHERE entity_id = $1', [E]).catch(() => {});
    await c.query('DELETE FROM ledger_account WHERE entity_id = $1', [E]).catch(() => {});
    await c.end();
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((err) => { console.log('ERROR ' + (err && err.stack)); process.exit(1); });
