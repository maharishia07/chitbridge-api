/**
 * tools/sim-load-proof.cjs — THE LOADER'S PROOF: SQL over what was written (reads only), and the login line it prints at the end.
 * OWNS      proof (bills · day summaries · purchases · trial balance · stored month summaries · cash per year · created_at on the shop's day · locked months · outbox), printLogin.
 * CALLED BY tools/sim-load.cjs (after the plan is loaded, and as "already loaded" on a repeat run); --months hands over to tools/sim-history.cjs prove.
 * FLOW      proof(ctx, shopId, quiet) ──▶ count checks ──▶ balance checks ──▶ cash per year ──▶ day · lock · outbox checks ──▶ the number of red lines
 * CARD      qa/sim-load
 * Reads only: no INSERT or UPDATE here. ctx is what the loader already holds (sql, plan, wanted counts, the pack's year, the shop row).
 */
'use strict';
const path = require('path');

/** one proof line: printed, and its verdict kept so the run can count the red ones */
function liner(out) {
  return (ok, name, detail) => {
    out.push(ok);
    console.log('   ' + (ok ? 'ok   ' : 'RED  ') + name + (detail ? ' — ' + detail : ''));
  };
}

/** bills, day summaries and purchases the database holds against what the plan said */
async function countChecks(ctx, shopId, line) {
  const { sql, WANT, PLAN, TILL } = ctx;
  const bills = await sql(
    `SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND sender_entity_id = $1 AND role <> 'Draft' AND business_json ? 'bill_no' AND business_json -> 'till' ->> 'id' = $2`,
    [shopId, TILL]
  );
  line(bills.rows[0].n === WANT.bills, "bills in chit_header = the plan's (" + bills.rows[0].n + ' of ' + WANT.bills + ', ' + WANT.days + ' days)');
  const sums = await sql(
    `SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND purpose = 'general' AND business_json -> 'summary' ->> 'period' = 'day'`,
    [shopId]
  );
  const daysWithBills = PLAN.days.filter((item) => item.sales.length).length;
  line(sums.rows[0].n === daysWithBills, 'day summaries = days with bills (' + sums.rows[0].n + ' of ' + daysWithBills + ')');
  const purchases = await sql(`SELECT count(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND event_type = 'purchase_bill'`, [shopId]);
  line(purchases.rows[0].n === WANT.purchases, "purchases posted = the plan's (" + purchases.rows[0].n + ' of ' + WANT.purchases + ')');
}

/** the lines' trial balance and the STORED month summaries (a second source); returns the trial-balance rows so the cash check knows the years */
async function balanceChecks(ctx, shopId, line) {
  const { sql, majorText, ZERO } = ctx;
  /* trial balance: every month's lines balance */
  const trialBalance = await sql(
    `SELECT e.fiscal_year, e.period, SUM(l.dr_minor)::bigint AS dr, SUM(l.cr_minor)::bigint AS cr FROM journal_entry e JOIN journal_line l ON l.entry_id = e.entry_id
                         WHERE e.entity_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`,
    [shopId]
  );
  const unbalanced = trialBalance.rows.filter((item) => String(item.dr) !== String(item.cr));
  line(
    trialBalance.rows.length > 0 && unbalanced.length === 0,
    'trial balance balances every month (' + trialBalance.rows.length + ' months, Dr = Cr)',
    unbalanced
      .slice(0, 3)
      .map((item) => item.fiscal_year + '/' + item.period + ' Dr ' + majorText(item.dr) + ' Cr ' + majorText(item.cr))
      .join(' · ')
  );
  /* the STORED month summaries (account_balance, written by the posting) balance too — a second source, not the lines again */
  const storedBalance = await sql(
    `SELECT fiscal_year, period, SUM(dr_minor)::bigint AS dr, SUM(cr_minor)::bigint AS cr FROM account_balance WHERE entity_id = $1 AND party_key = $2 GROUP BY 1, 2 ORDER BY 1, 2`,
    [shopId, ZERO]
  );
  const storedUnbalanced = storedBalance.rows.filter((item) => String(item.dr) !== String(item.cr));
  line(
    storedBalance.rows.length === trialBalance.rows.length && storedUnbalanced.length === 0,
    'stored month summaries (account_balance) balance, one per month (' + storedBalance.rows.length + ')',
    storedUnbalanced
      .slice(0, 3)
      .map((item) => item.fiscal_year + '/' + item.period)
      .join(' · ')
  );
  return trialBalance.rows;
}

/** cash, each FY: opening (the STORED summaries of the years before) + net flow (this year's LINES) = closing (the stored summaries up to this year) */
async function cashChecks(ctx, shopId, line, balanceRows) {
  const { sql, majorText, ZERO, AP: accountPacks, FYPACK } = ctx;
  const years = [...new Set(balanceRows.map((item) => item.fiscal_year))].sort();
  for (const fy of years) {
    const range = accountPacks.fyRange(fy, FYPACK),
      from = range.start,
      to = range.end; /* the pack's year, not April's */
    const cashRows = await sql(
      `SELECT (SELECT COALESCE(SUM(b.dr_minor - b.cr_minor), 0) FROM account_balance b JOIN ledger_account a ON a.account_id = b.account_id
                                  WHERE b.entity_id = $1 AND a.role = 'cash' AND b.party_key = $4 AND b.fiscal_year < $5)::bigint AS opening,
                                (SELECT COALESCE(SUM(l.dr_minor - l.cr_minor), 0) FROM journal_line l JOIN journal_entry e ON e.entry_id = l.entry_id JOIN ledger_account a ON a.account_id = l.account_id
                                  WHERE e.entity_id = $1 AND a.role = 'cash' AND e.posting_date >= $2 AND e.posting_date <= $3)::bigint AS flow,
                                (SELECT COALESCE(SUM(b.dr_minor - b.cr_minor), 0) FROM account_balance b JOIN ledger_account a ON a.account_id = b.account_id
                                  WHERE b.entity_id = $1 AND a.role = 'cash' AND b.party_key = $4 AND b.fiscal_year <= $5)::bigint AS closing`,
      [shopId, from, to, ZERO, fy]
    );
    const cash = cashRows.rows[0],
      ok = BigInt(cash.opening) + BigInt(cash.flow) === BigInt(cash.closing) && (years.indexOf(fy) === 0 || BigInt(cash.opening) > 0n);
    line(ok, fy + ' · cash opening ' + majorText(cash.opening) + ' (stored) + net flow ' + majorText(cash.flow) + ' (lines) = closing ' + majorText(cash.closing) + ' (stored)');
  }
}

/** the bills' own day, the locked months and the outbox */
async function dayChecks(ctx, shopId, line) {
  const { sql, API, SHOPROW, YEARS } = ctx;
  /* created_at names an INSTANT (M210): timestamptz after b299, and before it a naive UTC wall clock — read as UTC because this
     pool's session zone is pinned to UTC exactly as db/index.js pins the api's (the `::timestamptz` cast is then the same instant
     either way). The day it belongs to is the SHOP's (books-hooks.zoneOf of the shop's IANA zone — SHOPS in sim-load.cjs; zoneOf(COUNTRY) falls back to
     India for AU, whose zones neither COUNTRY_ZONE nor the pack carries yet), the one rule the day close uses. */
  const zone = require(path.join(API, 'lib', 'books-hooks')).zoneOf(SHOPROW.zone);
  const dated = await sql(
    `SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND business_json ? 'bill_no'
                             AND ((business_json ->> 'billed_at')::timestamptz AT TIME ZONE $2)::date <> (created_at::timestamptz AT TIME ZONE $2)::date`,
    [shopId, zone]
  );
  line(dated.rows[0].n === 0, "every bill's created_at is its own simulated day in " + zone + ', not today (' + dated.rows[0].n + ' off)');
  const locked = await sql(`SELECT count(*)::int AS n FROM fiscal_period WHERE entity_id = $1 AND status IN ('soft_locked', 'hard_locked') AND period > 0`, [
    shopId
  ]);
  line(locked.rows[0].n >= YEARS * 12, 'months locked (' + locked.rows[0].n + ' of ' + YEARS * 12 + ')');
  const waiting = await sql(`SELECT count(*)::int AS n FROM books_outbox WHERE entity_id = $1 AND done_at IS NULL`, [shopId]).catch(() => ({
    rows: [{ n: 'n/a' }]
  }));
  line(waiting.rows[0].n === 0 || waiting.rows[0].n === 'n/a', 'nothing waiting in books_outbox (' + waiting.rows[0].n + ')');
}

/** the whole proof; the number of red lines (0 = all green). --months hands over to the history proof */
async function proof(ctx, shopId, quiet) {
  if (ctx.MONTHS) return require('./sim-history.cjs').prove(ctx.historyCtx(), shopId, quiet);
  const out = [];
  const line = liner(out);
  console.log('\n  proof (' + (quiet ? 'as loaded' : 'this run') + '):');
  await countChecks(ctx, shopId, line);
  const balanceRows = await balanceChecks(ctx, shopId, line);
  await cashChecks(ctx, shopId, line, balanceRows);
  await dayChecks(ctx, shopId, line);
  const failures = out.filter((verdict) => !verdict).length;
  console.log('  ' + (failures ? '✗ ' + failures + ' RED' : '✓ all green') + ' · ' + out.length + ' lines');
  return failures;
}

/** where to sign in to the loaded shop */
function printLogin({ SHOP, EMAIL, LOGIN_CODE }) {
  console.log('\n  open it: http://localhost:8124 → sign in as ' + SHOP + ' (or ' + EMAIL + ') · code: ' + (process.env.TESTER_CODE ? 'the tester code' : LOGIN_CODE) + '\n');
}
module.exports = { proof, printLogin };
