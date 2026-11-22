'use strict';
// OWNS      THE PRACTICE READ (l16/firm-dash): the firm's whole client list with each client's work counts and business health, in ONE read: the firm's live grants → the look rows → one statement per client under that client's own binding (queryAsEach, one trip).
// CALLED BY routes/books-grants.js (GET /api/books-grants/practice) · tests/practice-health.test.cjs
// FLOW      firm binding: ONE transaction { the live grants, one per client (role chosen by the caller), the last look of each } → log one row per client the answer names (books_access_log, as a look is logged today) → commit →
//           db.query.asEach(live clients, STATEMENT) → shape each row (statusOf, returnDueFor) → { rule, band, clients[] }
// CARD      04-network/ACC-176-AUDITOR-GRANT
/**
 * ⭐ ONE CALCULATION PER FIGURE: every money figure is a stored sum of the client's own books (account_balance by the client's own fiscal_period, ledger_account nature/role); the return due date is books-cashflow.returnDueFor
 *   (the pack's calendar); the checked count and the queries are review_mark's own latest row per entry; months not locked is books.monthsNotLocked over the client's fiscal_period rows (the Month lock page's rule). Nothing here posts, nothing recomputes an engine's answer.
 * ⭐ THE LOOK DECIDES, NEVER COPIED: each grant row is put through grants.liveAmong (grants.verdictOf, the verdict the books router reads, then the assignment test of the switch `assigned`); only an `allowed` and held client is read, a revoked, expired or edge_off one returns no row and no log row.
 * ⭐ BANK (coordinator decision 15 Nov): the latest signed statement of each bank account, as bank_rec_log carries it (reconciled to the period's end, the difference it carried): read, never recomputed. Read-only under a live grant.
 * ⭐ 5-YEAR GROWTH (l16-scale): only the OPEN documents come (books-open-items.rowsSql: a document with money left or a status, and everything linked to it by an allocation) — a settled bill and its settled payment are not read; the SAME engine reads run on them and answer the same (tests/open-items.test.cjs compares the two carried answers). It shipped every row ever written: 61.7 MB for one busy 8-year client.
 * ⭐ RECEIVABLES AND BILLS: the client's party_item rows come in the same statement and go through the SAME engine reads "Who owes whom" and the cash view use: books-engines.dues (the follow-up ageing, days past due) and
 *    books-cashflow.project (days 30: out_minor is the bills due in the next 30 days, shortfall the day the cash runs out). Aged from the stored due dates (a bill with none, from its bill date); a party's own terms are not read here.
 * ⚠️ can_see_costs=false on the grant: margin and profit come back null (the consent words say what the firm may see).
 */
const db = require('../db');
const grants = require('./books-grant');
const health = require('./practice-health');
const { boundRead } = require('./bound-read');
const { isGrantParentSql } = require('./network-membership');
const { soldEntriesSql } = require('./books-store');
const baseline = require('./books-baseline'); /* rank 10: the person's check point per client, the one `changed since` test, the one list-read pattern */

const ADOPTER = 'acc.audit';
const MAX_CLIENTS = 500; /* the one read answers up to this many; above it the answer says so (`truncated`) */
const COGS_ROLES = require('./books-report-period').COST_OF_SALES_ROLES; /* one list with the P&L's gross profit line */
const quoted = (list) => list.map((x) => "'" + x + "'").join(',');

/** the WITH clauses of the practice statement: the current quarter, the months of sales / income / expense / cost of sales, the sold-by-month look, the latest bank statements, the last months, the quarter sums */
function statementWith(bankLog) {
  return `WITH cur AS (SELECT fiscal_year, period FROM fiscal_period WHERE entity_id = $1::uuid AND period >= 1 AND $2::date BETWEEN start_date AND end_date ORDER BY fiscal_year DESC LIMIT 1),
    qs AS (SELECT min(f.start_date) AS d FROM fiscal_period f, cur WHERE f.entity_id = $1::uuid AND f.fiscal_year = cur.fiscal_year AND f.period >= 1 AND ((f.period - 1) / 3) = ((cur.period - 1) / 3)),
    m AS (SELECT fp.start_date::text AS start,
            COALESCE(sum(CASE WHEN la.role LIKE 'sales%' THEN ab.cr_minor - ab.dr_minor ELSE 0 END), 0)::bigint AS sales,
            COALESCE(sum(CASE WHEN la.nature = 'income' THEN ab.cr_minor - ab.dr_minor ELSE 0 END), 0)::bigint AS income,
            COALESCE(sum(CASE WHEN la.nature = 'expense' THEN ab.dr_minor - ab.cr_minor ELSE 0 END), 0)::bigint AS expense,
            COALESCE(sum(CASE WHEN la.role IN (${quoted(COGS_ROLES)}) THEN ab.dr_minor - ab.cr_minor ELSE 0 END), 0)::bigint AS cogs
          FROM account_balance ab JOIN ledger_account la ON la.account_id = ab.account_id AND la.entity_id = ab.entity_id
          JOIN fiscal_period fp ON fp.entity_id = ab.entity_id AND fp.fiscal_year = ab.fiscal_year AND fp.period = ab.period
          WHERE ab.entity_id = $1::uuid AND fp.period >= 1 AND fp.start_date >= ($2::date - interval '7 months') AND fp.start_date <= $2::date
          GROUP BY fp.start_date),
    sm AS (SELECT fp.start_date::text AS start, COALESCE(sum(x.sold), 0)::bigint AS sold
            FROM (SELECT e.fiscal_year, e.period, sum(e.sold) AS sold FROM (${soldEntriesSql('$1::uuid', { from: "(date_trunc('month', $2::date) - interval '4 months')", to: "(date_trunc('month', $2::date) - interval '1 day')" })}) e GROUP BY e.fiscal_year, e.period) x /* the months first, then ONE fiscal_period look per month, not one per entry */
            JOIN fiscal_period fp ON fp.entity_id = $1::uuid AND fp.fiscal_year = x.fiscal_year AND fp.period = x.period AND fp.period >= 1
            GROUP BY fp.start_date),
${bankLog ? `    bk AS (${require('./bank-rec-log').LATEST_SQL('$1::uuid')}),
` : ''}    d AS (SELECT row_number() OVER (ORDER BY m.start DESC) AS rn, COALESCE(sm.sold, 0) AS sales, m.income - m.expense AS profit FROM m LEFT JOIN sm ON sm.start = m.start WHERE m.start < to_char($2::date, 'YYYY-MM') || '-01'),
    q AS (SELECT sum(sales) AS s, sum(income) AS i, sum(expense) AS e, sum(cogs) AS c, count(*) AS n FROM m, qs WHERE m.start >= qs.d::text)
`;
}
/** the one statement a client's books answer ($1 the client, $2 today). The review marks are NOT in it: queries open and entries checked are review-mark's own functions, read per client (markFigures), so the practice and the client's page share one rule. */
function statement(cashRoles, bankLog) {
  return statementWith(bankLog) + `    SELECT $1::uuid AS entity_id,
      (SELECT to_jsonb(s) FROM (SELECT country, fy_start_month, functional_currency, enabled FROM books_setting WHERE entity_id = $1::uuid) s) AS setting,
      (SELECT to_jsonb(i) FROM (SELECT country, currency_code FROM identities WHERE identity_id = $1::uuid) i) AS identity, /* XC-1119: the client own country and money when its books are off (no books_setting row), no apostrophe or semicolon in SQL text (readBatch counts them) */
      (SELECT CASE WHEN count(*) FILTER (WHERE rn BETWEEN 2 AND 4) >= 2 AND avg(sales) FILTER (WHERE rn BETWEEN 2 AND 4) > 0 THEN round((100.0 * (max(sales) FILTER (WHERE rn = 1) - avg(sales) FILTER (WHERE rn BETWEEN 2 AND 4)) / avg(sales) FILTER (WHERE rn BETWEEN 2 AND 4))::numeric, 1) END FROM d)::float8 AS sales_trend_pct,
      (SELECT count(*) FILTER (WHERE rn BETWEEN 2 AND 4) FROM d)::int AS sales_trend_months,
      (SELECT sales FROM d WHERE rn = 1)::bigint AS last_month_sales_minor,
      (SELECT CASE WHEN count(*) >= 2 THEN CASE WHEN bool_or(rn = 1 AND profit < 0) THEN CASE WHEN bool_or(rn = 2 AND profit < 0) THEN 2 ELSE 1 END ELSE 0 END END FROM d WHERE rn <= 2)::int AS loss_months_running,
      (SELECT CASE WHEN n > 0 AND s > 0 THEN round((100.0 * (s - c) / s)::numeric, 1) END FROM q)::float8 AS gross_margin_pct,
      (SELECT i - e FROM q WHERE n > 0)::bigint AS profit_quarter_minor,
      (SELECT count(DISTINCT currency)::int FROM account_balance WHERE entity_id = $1::uuid) AS currencies,
      (SELECT COALESCE(sum(ab.dr_minor - ab.cr_minor), 0)::bigint FROM account_balance ab JOIN ledger_account la ON la.account_id = ab.account_id AND la.entity_id = ab.entity_id WHERE ab.entity_id = $1::uuid AND la.role IN (${quoted(cashRoles)})) AS cash_minor,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('fiscal_year', f.fiscal_year, 'period', f.period, 'end_date', f.end_date::text, 'status', f.status, 'reason', f.reason)), '[]'::jsonb) FROM fiscal_period f WHERE f.entity_id = $1::uuid AND f.period >= 1) AS month_rows, /* the months as stored, which books.monthsNotLocked counts (the Month lock page own rule) */
      (SELECT jsonb_build_object('fiscal_year', f.fiscal_year, 'period', f.period) FROM fiscal_period f WHERE f.entity_id = $1::uuid AND f.period >= 1 AND EXISTS (SELECT 1 FROM journal_entry j WHERE j.entity_id = f.entity_id AND j.fiscal_year = f.fiscal_year AND j.period = f.period) ORDER BY f.fiscal_year, f.period LIMIT 1) AS books_start, /* E3: the first month with an entry — the own start of booksLockLine, months before it are not work to lock: a product control, not a Xero or MYOB rule (books.markBeforeBooks) */
      (SELECT count(*)::int FROM journal_entry e, qs WHERE e.entity_id = $1::uuid AND e.posting_date BETWEEN qs.d AND $2::date) AS entries_of,
      ${bankLog ? "(SELECT jsonb_build_object('accounts', count(*), 'rows', COALESCE(jsonb_agg(jsonb_build_object('account_id', account_id, 'period_to', period_to::text, 'difference_minor', difference_minor, 'currency', currency)), '[]'::jsonb)) FROM bk)" : 'NULL::jsonb'} AS bank,
      (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.created_at, p.item_id), '[]'::jsonb) FROM (${require('./books-open-items').rowsSql('$1::uuid')}) p) AS items, /* l16-scale: the OPEN documents only (books-open-items.rowsSql), never every row ever written */
      (SELECT count(*)::int FROM journal_entry ce WHERE ce.entity_id = $1::uuid AND ${baseline.changedWhere('ce', '$3')}) AS changed_n, /* rank 10: entries posted since the caller check point (created_at), the Day book filter own predicate */
      (SELECT d::text FROM qs) AS quarter_start`;
}

/**
 * ⭐ MARKS PER CLIENT (MIS 0b/0c): queries open and entries checked are review-mark's OWN reads (OPEN_LATEST_SQL + stillOpenFrom, coverageSql + coverageFrom, and mark-detect's nowSql), never a second rule: the practice shows the figure the client's own page shows (openList.total_open, coverage).
 * ⭐ ONE TRIP PER CLIENT: the statements go in ONE readBatch (BEGIN, the binding, the reads, COMMIT as one message). A read that wants the ids of an earlier read takes them as a sub-select of that SAME text (the ids never travel back and forth), the filter and the seal check run on the rows after.
 * `on_us` = the open queries whose last message came from the client. → { open, on_us, checked, of } ; a client whose marks cannot be read answers 0 / 0 (as before the marks table existed), logged, never failing the list.
 */
const MARK_WORKERS = 6; /* clients read at once: the pool is 10, the firm's own read has already let go of its connection */
const ON_US_SQL = "SELECT x.subject_id::text AS thread, (x.sender_entity_id = $1::uuid) AS us, to_char(x.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS last_day FROM (SELECT DISTINCT ON (subject_id) subject_id, sender_entity_id, created_at FROM chit_messages WHERE subject_type = 'mark' AND entity_id = $1::uuid AND subject_id::text = ANY($2::text[]) ORDER BY subject_id, created_at DESC) x";
const OVER_DAYS = 14; /* a query waiting longer than this is the practice's `waiting_over_14`; the age is the days since the last message of the thread */
/** the statements of one client's marks (never a ';' in a comment: readBatch refuses it), each with the values it takes */
function markStatements(id, from, today, fiscalYear) {
  const ReviewMark = require('./review-mark');
  const detect = require('./mark-detect');
  const adopter = ReviewMark.adopterOf(ADOPTER);
  const inline = (text, params) => db.inlineSql(text, params);
  const idsOf = (rowsSql, column) => 'ARRAY(SELECT ' + column + '::text FROM (' + rowsSql + ') ids)';
  const askingFor = (text, listSql) => ({ text: text.replace('$2::text[]', () => listSql), params: [id] });
  const openSql = inline(ReviewMark.OPEN_LATEST_SQL, [id, ADOPTER]);
  const cover = ReviewMark.coverageSql(adopter);
  const list = [
    { text: ReviewMark.OPEN_LATEST_SQL, params: [id, ADOPTER] },
    askingFor(detect.nowSql(adopter), idsOf(openSql, 'subject_id')),
    askingFor(ON_US_SQL, idsOf(openSql, 'thread_id'))
  ];
  if (cover) {
    const clearedSql = inline(cover.cleared, [id, ADOPTER, from, today]);
    list.push({ text: cover.of, params: [id, from, today] }, { text: cover.cleared, params: [id, ADOPTER, from, today] }, askingFor(detect.nowSql(adopter), idsOf(clearedSql, 'subject_id')));
  }
  if (cover && fiscalYear) {
    const fyCleared = inline(cover.cleared, [id, ADOPTER, fiscalYear.start, fiscalYear.end]);
    list.push({ text: cover.of, params: [id, fiscalYear.start, fiscalYear.end] }, { text: cover.cleared, params: [id, ADOPTER, fiscalYear.start, fiscalYear.end] }, askingFor(detect.nowSql(adopter), idsOf(fyCleared, 'subject_id')));
  }
  return list;
}
/** the financial-year coverage of a client's marks: review-mark's own coverage over the FY range; null when the FY reads were not asked; `capped` says the 5000-row cap was hit (coverageSql), so 100% can never show */
function fiscalCoverOf(reads, adopter, today) {
  const ReviewMark = require('./review-mark');
  const detect = require('./mark-detect');
  const [fyOf, fyCleared, fyNow] = reads;
  if (!fyOf) return null;
  const cover = ReviewMark.coverageFrom(fyOf, fyCleared, detect.nowFrom(adopter, fyNow, fyCleared.map((row) => row.subject_id)));
  return Object.assign(cover, { capped: fyCleared.length >= 5000 });
}
/** one client's mark figures from ONE batch: open queries, those on us, the oldest wait in days, the quarter's checked / of, and the FY coverage */
async function markFigures(id, from, today, fiscalYear) {
  const ReviewMark = require('./review-mark');
  const detect = require('./mark-detect');
  const adopter = ReviewMark.adopterOf(ADOPTER);
  const results = await db.readBatch(id, null, markStatements(id, from, today, fiscalYear));
  const [latest, openNow, onUs, ofRead, cleared, clearedNow, fyOf, fyCleared, fyNow] = results.map((one) => one && one.rows);
  const open = ReviewMark.stillOpenFrom(latest, detect.nowFrom(adopter, openNow, latest.map((row) => row.subject_id))).rows;
  const threads = new Set(open.map((row) => String(row.thread_id)));
  const cover = ofRead ? ReviewMark.coverageFrom(ofRead, cleared, detect.nowFrom(adopter, clearedNow, cleared.map((row) => row.subject_id))) : { checked: null, of: null };
  const days = onUs.filter((row) => threads.has(row.thread) && row.last_day).map((row) => daysBetween(row.last_day, today));
  const fyCover = fiscalCoverOf([fyOf, fyCleared, fyNow], adopter, today);
  return { open: open.length, on_us: onUs.filter((row) => row.us === true && threads.has(row.thread)).length, oldest_days: days.length ? Math.max(...days) : null, checked: cover.checked, of: cover.of, fy: fyCover };
}
/** put one client's mark figures on its row (queries, entries checked, FY coverage); a client whose marks cannot be read keeps its row as it is, logged */
async function addMarks(row, today) {
  try {
    const yearEnd = health.yearEndOf(row.month_rows, null, today);
    const figures = await markFigures(String(row.entity_id), row.quarter_start, today, yearEnd && !yearEnd.first_year ? { start: yearEnd.start, end: yearEnd.end } : null);
    row.fy_cover = figures.fy;
    row.queries = { open: figures.open, on_us: figures.on_us, oldest_days: figures.oldest_days };
    row.entries_checked = figures.checked;
    row.entries_of = figures.of;
  } catch (failure) {
    require('./logger').warn('practice: a client marks could not be read', { code: failure && failure.code, why: failure && String(failure.message).slice(0, 160) });
  }
}
/** the marks of every client with a quarter, MARK_WORKERS at a time */
async function withMarks(rows, today) {
  const todo = rows.filter((row) => row.quarter_start);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) await addMarks(todo[next++], today);
  };
  await Promise.all(Array.from({ length: Math.min(MARK_WORKERS, todo.length) }, worker));
  return rows;
}

/* YEAR ON YEAR (Athi 16 Nov): the statement itself lives with the one SOLD rule (books-store.YOY_STATEMENT, MIS A1); the practice only feeds it the dates of yoyDates */
const { YOY_STATEMENT } = require('./books-store');
/** the dates of that statement for a shop whose financial year starts in month fyMonth: [this year's first day, today, the first day a year back, today a year back] — the ONE date rule (books-report-period: periodOf year to date + priorOf 'year'), no date arithmetic here */
function yoyDates(today, fyMonth) {
  const ReportPeriod = require('./books-report-period'), range = ReportPeriod.periodOf({ preset: 'ytd' }, today, fyMonth), before = ReportPeriod.priorOf(range, 'year');
  return [range.from, range.to, before.from, before.to];
}
/** the dates of both year-on-year ranges as the row carries them (REP-66b), null when no dates were asked for */
const yoySpanOf = (dates) => ({ sales_yoy_from: dates ? dates[0] : null, sales_yoy_to: dates ? dates[1] : null, sales_prev_from: dates ? dates[2] : null, sales_prev_to: dates ? dates[3] : null });
/** the state CODE of this client's year on year (practice-health.yoyStateOf): how stale its last sale is, and how late last year's first sale came */
function yoyStateFor(row, dates, today) {
  return health.yoyStateOf({ now: row.sales_ytd_minor, before: row.sales_prev_ytd_minor, staleDays: row.sales_through && today ? daysBetween(row.sales_through, today) : null, startGapDays: row.sales_first && dates ? daysBetween(dates[2], row.sales_first) : null });
}
/** a client's year on year as the page row carries it: nothing when the client holds two currencies. REP-66b: also the dates of both ranges and a `sales_yoy_state` CODE (practice-health.yoyStateOf), so a chart never guesses; a short last year or none carries no change */
function yoyOf(row, base, dates, today) {
  const span = yoySpanOf(dates);
  if (!row || !base || Number(base.currencies) > 1) return Object.assign({ sales_ytd_minor: null, sales_prev_ytd_minor: null, sales_yoy_pct: null, sales_through: null, sales_yoy_state: row && base ? 'mixed' : null }, span);
  const state = yoyStateFor(row, dates, today);
  const noChange = state === 'short_last_year' || state === 'no_last_year';
  return Object.assign({ sales_ytd_minor: Number(row.sales_ytd_minor), sales_prev_ytd_minor: Number(row.sales_prev_ytd_minor), sales_yoy_pct: noChange ? null : health.changeOf(row.sales_ytd_minor, row.sales_prev_ytd_minor), sales_through: row.sales_through || null, sales_yoy_state: state }, span);
}

/* the ONE day arithmetic of the books: books-engines ymd / addDays and books-cashflow day (a day number); the day itself is the shop clock's (the firm's own zone) */
const booksEngines = require('./books-engines');
const CLOCK = require('./shop-clock');
const cashflow = require('./books-cashflow');
const daysBetween = (from, to) => cashflow.day(to) - cashflow.day(from);
const dayOf = (value) => booksEngines.ymd(value);
const addDays = (day, count) => booksEngines.addDays(day, count);

/** a stored figure as a number, null when it is missing */
const num = (value) => (value === null || value === undefined ? null : Number(value));
/** the health figures: what the client's own books said (the statement above sums them); withheld where the figure would mislead: another currency mixed in (never added across), or costs the grant does not show */
function figuresOf(row, today, costsOk, setting) {
  const mixed = Number(row.currencies) > 1;
  const read = (key, needsCosts) => (mixed || (needsCosts && !costsOk) ? null : num(row[key]));
  return {
    sales_trend_pct: read('sales_trend_pct'),
    sales_trend_months: read('sales_trend_months'),
    last_month_sales_minor: read('last_month_sales_minor'),
    gross_margin_pct: read('gross_margin_pct', true),
    profit_quarter_minor: read('profit_quarter_minor', true),
    loss_months_running: read('loss_months_running', true),
    cash_minor: mixed ? null : Number(row.cash_minor || 0),
    ...openFiguresOf(row, today, costsOk && !mixed, setting)
  };
}
/** the cash view of a client's open items: the same engine as the cash view (books-cashflow.project, 30 days) over its payable items and its cash balance */
function cashViewOf(row, today, setting, items) {
  return cashflow.project({ asOf: today, days: 30, currency: setting.functional_currency, opening: [{ role: 'bank', code: 'cash', name: 'Cash', balance_minor: Number(row.cash_minor || 0) }], receivable_items: [], payable_items: items.filter((x) => x.side === 'payable'), cheques: [], promises: [], gst: null, names: new Map(), recurring: [] });
}
/** the receivables over 60 days late (61-90 and 90+) of the client's open items, with the follow-up ageing's total; null ageing when nothing is owed to the client */
function lateReceivablesOf(items, today, setting) {
  const owed = items.filter((item) => item.side === 'receivable');
  const aged = owed.length ? booksEngines.dues(owed, today, 'receivable', { pack: require('./books').packOf(setting), creditDaysOf: () => null }).follow.ageing : null; /* nothing owed to the client: the engine answers no ageing */
  const late = aged ? aged.buckets.undisputed : { d61_90: 0, d90_plus: 0 };
  return { over: late.d61_90 + late.d90_plus, total: aged ? aged.total_minor : 0 };
}
/** the same engine reads as the cash view and Who owes whom, over this client's own open items; null (never a guess) when the books are not switched on, the costs are not shown, or an engine refuses the items */
function openFiguresOf(row, today, ok, setting) {
  const none = { cash_days: null, bills_due_30_minor: null, receivables_over60_minor: null, receivables_over60_share_pct: null };
  if (!ok || !setting || !setting.functional_currency) return none;
  try {
    const items = (row.items || []).map(booksEngines.itemOf);
    const cash = cashViewOf(row, today, setting, items);
    const late = lateReceivablesOf(items, today, setting);
    return {
      cash_days: cash.shortfall ? daysBetween(today, cash.shortfall.date) : null,
      bills_due_30_minor: cash.out_minor,
      receivables_over60_minor: late.over,
      receivables_over60_share_pct: health.shareOf(late.over, late.total)
    };
  } catch (failure) {
    require('./logger').warn('practice: a client open items could not be read', { code: failure && failure.code, why: failure && String(failure.message).slice(0, 160) });
    return none;
  }
}

/** YE-F-07: the oldest return whose due day has passed and the books do not hold closed (lib/return-overdue), with how many are behind: { n, form, label, due, days_late } | null */
function overdueOf(pack, today, monthRows) {
  const R = require('./return-overdue'),
    list = R.overdueReturns(pack, today, (monthRows || []).map((row) => row.fiscal_year), R.closedByMonths(monthRows));
  return list.length ? { n: list.length, form: list[0].form, label: list[0].label, due: list[0].due, days_late: list[0].days_late } : null;
}
/** the next return due: the pack's own calendar (books-cashflow.returnDueFor); never "overdue": nothing records a lodgement, so a passed date says so */
function basOf(setting, today, monthRows) {
  if (!setting || !setting.country) return { form: null, due_date: null, due_in_days: null, why: 'The books are not switched on.' };
  const books = require('./books');
  const pack = books.packOf(setting);
  const now = require('./books-cashflow-return').nextReturnDue(pack, today); /* CTY-80: the return that falls due next (a finished period), not the period that holds today */
  const earlier = cashflow.returnDueFor(pack, addDays(today, -95));
  const past = earlier.due_date && earlier.due_date < today ? earlier.due_date : null;
  const next = now.due_date;
  return { form: now.short, due_date: next, due_in_days: next ? daysBetween(today, next) : null, last_due_date_passed: past, lodged_known: false, overdue: overdueOf(pack, today, monthRows), why: next ? null : now.why };
}

/** the bank state of a client as its signed statements carry it: none (no statement signed) · reconciled · unexplained (the difference the statement carried) */
function bankOf(bank) {
  if (!bank || !Number(bank.accounts)) return { state: 'none', reconciled_to: null, unexplained_minor: null, currency: null, by_currency: [] };
  const sum = require('./bank-rec-log').unexplainedOf(bank.rows); /* the ONE rule, shared with the Bank home (lib/bank-rec-log unexplainedOf): never added across currencies */
  return { state: sum.by_currency.length ? 'unexplained' : 'reconciled', reconciled_to: sum.to, unexplained_minor: sum.unexplained_minor, currency: sum.currency, by_currency: sum.by_currency };
}

/** why a figure group is null: `currencies` (more than one currency, never added across) or `costs` (the grant does not show costs); the page says "not shared" only for costs */
function withheldOf(row, costsOk) {
  return { costs: costsOk ? null : 'costs', currencies: Number(row.currencies) > 1 ? 'currencies' : null };
}

/** a client's open queries as the row carries them: how many, how many wait on us, the oldest wait, whether it is over OVER_DAYS */
function queriesOf(row) {
  const queries = row.queries || { open: 0, on_us: 0 };
  const oldest = queries.oldest_days == null ? null : Number(queries.oldest_days);
  return { open: Number(queries.open), on_us: Number(queries.on_us), on_client: Number(queries.open) - Number(queries.on_us), oldest_days: oldest, waiting_over_14: oldest == null ? null : oldest > OVER_DAYS };
}
/** XC-1119: the client's country and money from its books, else from its own identity (books off), else null */
function clientCountryOf(setting, identity) {
  const code = (setting && setting.country) || (identity && identity.country);
  return code ? String(code).toUpperCase() : null;
}
const clientCurrencyOf = (setting, identity) => (setting && setting.functional_currency) || (identity && identity.currency_code) || null;
/** who the client is and what the books say of themselves: the grant's role, the country and currency, whether the books are on */
function whoOf(row, grant) {
  const setting = row.setting;
  const country = clientCountryOf(setting, row.identity);
  return {
    entity_id: row.entity_id, name: grant.grantor_name || null, role: grant.preset, grant_id: grant.grant_id,
    country, currency: clientCurrencyOf(setting, row.identity), books_on: !!(setting && setting.enabled),
    pack_missing: require('./no-pack-words').missingFor(country) /* XC-1119: the one sentence, so the list never shows "not enough books yet" for a country we cannot check */
  };
}
/** the grant as the row shows it: when, until when, days left, whether costs are shown */
const grantViewOf = (grant, today, costsOk) => ({ granted_at: grant.granted_at, expires_at: grant.expires_at, ends_in_days: daysBetween(today, dayOf(grant.expires_at)), can_see_costs: costsOk });
/** what holds a client back at year end: the year's own blocker, else the open queries when the year is complete and checked */
const stageBlockerOf = (yearEnd, queries) => (yearEnd ? yearEnd.blocker || (yearEnd.complete && yearEnd.checked && queries.open > 0 ? 'queries' : null) : null);
/** a client's practice row: who, health, queries, return due, checks, bank, grant, what changed — and the derived to_check, year end, stage, blocker and action count */
function shape(row, grant, looked, today, since) {
  const costsOk = grant.can_see_costs === true;
  row = Object.assign({}, row, { month_rows: require('./books').markBeforeBooks(row.month_rows, row.books_start) }); /* E3: one rule for months before the books start */
  const figures = figuresOf(row, today, costsOk, row.setting);
  const verdict = health.statusOf(figures);
  const out = Object.assign(whoOf(row, grant), {
    health: Object.assign({ status: verdict.status, words: health.WORDS[verdict.status], reasons: verdict.reasons, codes: verdict.codes }, figures),
    queries: queriesOf(row),
    bas: basOf(row.setting, today, row.month_rows),
    months_unlocked: require('./books').monthsNotLocked(row.month_rows, today),
    checked: { n: Number(row.entries_checked || 0), of: Number(row.entries_of || 0) },
    bank: bankOf(row.bank),
    grant: grantViewOf(grant, today, costsOk),
    last_look: looked || null,
    changed: { n: Number(row.changed_n || 0), since: since ? since.at : null, never: since ? since.never : true } /* rank 10: entries posted since THIS person last said checked (never = no act yet: counted from the start of the grant) */
  });
  out.to_check = Math.max(0, out.checked.of - out.checked.n); /* the server's subtraction (entries this quarter without a clear mark); the FY Checked stage waits for the 0c coverage read */
  out.year_end = health.yearEndOf(row.month_rows, out.bank, today, row.fy_cover);
  out.stage = health.stageOf(out);
  out.stage_blocker = stageBlockerOf(out.year_end, out.queries);
  out.health.withheld = withheldOf(row, costsOk);
  out.action_count = health.actionOf(out);
  return out;
}

const PAGE_MAX = require('./bounds').LIMIT_MAX, PAGE_DEFAULT = 50; /* the contract's own limit maximum (bounds.LIMIT_MAX): a limit the schema admits is honoured, never silently halved (PRAC150: limit=200 answered 100 rows) */
/** the page asked: { page, limit } from the query words, or null (no page words = the whole list, as before, so the current web keeps working); limit is capped at PAGE_MAX on the server */
function pageAsked(query) {
  if (!query || (query.page === undefined && query.limit === undefined)) return null;
  const whole = (v, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 ? n : d; };
  return { page: whole(query.page, 1), limit: Math.min(whole(query.limit, PAGE_DEFAULT), PAGE_MAX) };
}
/**
 * the answer's page of a worst-first list: the band is over ALL the clients (counted once, here, from the same rows the order needs: the verdict of a client
 * needs its own books' figures, so there is no cheaper pass that sorts correctly), `clients` is the page. No page asked → every client, the old answer.
 */
function pageOf(all, asked, bandOpts) {
  const band = health.bandOf(all, bandOpts);
  if (!asked) return { band, clients: all, paging: { total: all.length, page: 1, limit: all.length, has_more: false } };
  const from = (asked.page - 1) * asked.limit;
  return { band, clients: all.slice(from, from + asked.limit), paging: { total: all.length, page: asked.page, limit: asked.limit, has_more: from + asked.limit < all.length } };
}
/** the firm's grants read, bound to the firm's own id (boundRead): every grant the firm holds, with the grantor's name, the last look of this person, the check point, whether the firm trades itself, its country and whether the role columns exist */
function grantsRead(execute, firm, opts, baselineReady) {
  return boundRead(execute, firm, `SELECT g.grant_id, g.grantor_entity::text AS grantor_entity, g.grantee_entity, g.preset, g.can_see_costs, g.granted_at, g.expires_at, g.revoked_at,
        (SELECT display_name FROM identities WHERE identity_id = g.grantor_entity) AS grantor_name, (g.expires_at > now()) AS unexpired,
        ${isGrantParentSql('g.grantee_entity::text', 'g.grantor_entity::text')} AS edge_live,
        (SELECT max(l.at) FROM books_access_log l WHERE l.grantee_entity = g.grantee_entity AND l.grantor_entity = g.grantor_entity AND l.actor_identity_id = $2::uuid AND l.route_pattern <> $3::text AND l.outcome = 'allowed') AS last_look,
        ${baseline.checkPointSql(baselineReady, 'g')} AS check_seen_to, /* rank 10: this person, real allowed looks only - the list read, other staff and refused looks never count */
        ${require('./people').ownTradeSql('$1::uuid')} AS own_trade, /* the ONE test (lib/people ownTradeSql): the firm's own job chits are not a trade */
        (SELECT country FROM identities WHERE identity_id = $1::uuid) AS firm_country,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'books_access_log' AND column_name = 'preset') AS role_columns
      FROM books_access_grant g WHERE g.grantee_entity = $1::uuid ORDER BY g.granted_at DESC`, [firm, (opts && opts.actor) || null, baseline.LIST_READ]);
}
/**
 * ONE row per client, chosen among the LIVE grants only (newest first): an ended or run-out grant on the same client never hides the live one.
 * ⭐ ASSIGN-1: the live test AND the assignment test are grants.liveAmong's (the list twin of finalOutcome, never verdictOf called here): under switch `assigned` a client the caller does not hold is left out of every row, total and count (the partner, the owner, sees all).
 * → { live: Map(grantor → row), ended: clients whose access has run out (an unassigned client is NOT ended) }
 */
async function chooseLive(transaction, rows, roles, request) {
  const mine = rows.filter((row) => roles.includes(row.preset));
  const seen = new Set(mine.map((row) => row.grantor_entity));
  const { live: standing, kept } = await grants.liveAmong(transaction, mine, request);
  const live = new Map();
  for (const row of kept) if (!live.has(row.grantor_entity)) live.set(row.grantor_entity, row);
  return { live, ended: seen.size - new Set(standing.map((row) => row.grantor_entity)).size };
}
/**
 * the holder column: who holds each kept client (grants.liveAmong's sibling read, ONE statement per role), whatever the firm's switch says (A1, 18 Nov: who holds is not the same fact as "staff see only theirs").
 * → null (no client kept) | Map(grantor → [{ actor_id, name }])
 */
async function holdersOf(transaction, firm, kept) {
  if (!kept.length) return null;
  const register = require('./assign-register');
  const out = new Map();
  for (const role of [...new Set(kept.map((row) => row.preset))]) {
    const holderRead = await register.holdersAmong(transaction, { plug: 'client', entity_id: firm, members: kept.filter((row) => row.preset === role).map((row) => String(row.grantor_entity)), role });
    holderRead.holders.forEach((holder, subject) => out.set(subject, holder));
  }
  return out;
}
/** a row reached only through a role the seat does not hold (W12: the accountant seat on an auditor grant) is read only */
const readOnlyOf = (grant, seats) => !(seats || []).includes(grants.roleOf(grant.preset));
/** the firm's live clients in ONE transaction: the grants, the clients kept (up to MAX_CLIENTS), one log row per client the answer names, the check points */
async function readLiveClients(firm, opts, roles, baselineReady) {
  const request = { owner: !!(opts && opts.owner), manager: !!(opts && opts.manager), actor: opts && opts.actor, actor_name: opts && opts.actor_name, pattern: baseline.LIST_READ, method: 'GET', listed: true, query_shape: null };
  return grants.asEntity(firm, async (transaction) => {
    const execute = transaction.query.bind(transaction);
    const rows = (await grantsRead(execute, firm, opts, baselineReady)).rows;
    const { live, ended } = await chooseLive(transaction, rows, roles, request);
    const allowed = [...live.values()];
    const kept = allowed.slice(0, MAX_CLIENTS);
    kept.forEach((row) => grants.tooMany(firm, row.grantor_entity));
    const withRole = rows.length > 0 && rows[0].role_columns === true; /* b866 run? asked in the grants read itself (same as grants.roleColumnsReady, no probe trip); with no grant row nothing is logged */
    if (kept.length) await grants.writeLogRows(transaction, withRole, kept, firm, request, { status: 200, outcome: 'allowed' });
    const checkPoints = new Map(rows.filter((row) => row.check_seen_to).map((row) => [String(row.grantor_entity), { seen_to: row.check_seen_to }])); /* rank 10: the caller's check points ride the grants read above (no extra trip) */
    const holders = await holdersOf(transaction, firm, kept);
    return { kept, holders, checkPoints, truncated: allowed.length > kept.length, ended, own_trade: rows.some((row) => row.own_trade === true), zone: (rows[0] && rows[0].firm_country) || undefined };
  });
}
/** the year on year of each page client whose financial year is known, put on its health (one statement per client under its own binding) */
async function addYearOnYear(clients, answerRows, byId, today) {
  const fiscalStart = new Map(answerRows.map((row) => [String(row.entity_id), row.setting && row.setting.enabled ? row.setting.fy_start_month : null]));
  const askable = clients.filter((client) => Number(fiscalStart.get(String(client.entity_id))) >= 1);
  const datesOf = (id) => yoyDates(today, Number(fiscalStart.get(String(id))));
  const yearOnYear = askable.length ? await db.query.asEach(askable.map((client) => client.entity_id), YOY_STATEMENT, (id) => [id].concat(datesOf(id))) : { rows: [] };
  const yoyById = new Map(yearOnYear.rows.map((row) => [String(row.entity_id), row]));
  clients.forEach((client) => Object.assign(client.health, yoyOf(yoyById.get(String(client.entity_id)), byId.get(String(client.entity_id)), askable.includes(client) ? datesOf(client.entity_id) : null, today)));
}
/** ASSIGN-1: each client carries who holds it, only under switch `assigned` (an empty list = Unassigned, the partner sees it); under `all` the key is absent, the answer is today's byte for byte */
function addHolders(clients, holders) {
  if (holders) clients.forEach((client) => { client.holders = holders.get(String(client.entity_id)) || []; });
}
/** the cash-and-queries rows of the kept clients, one statement per client (none when there are none) */
async function cashRowsOf(ids, bankLog, today, sinceOf) {
  if (!ids.length) return { rows: [] };
  return db.query.asEach(ids, statement(cashflow.CASH_ROLES, bankLog), (id) => [id, today, sinceOf(id).at]);
}
/** the last stages' words (REP-73 B6) from the firm's filing verb: ready to lodge | file, and done */
const stageWords = (verb) => ({ ready: 'Ready to ' + verb, done: (verb === 'lodge' ? 'Lodged' : 'Filed') + " (owner's word)" });
/** XC-1119: the filing verb every client's pack agrees on, else the neutral one; the firm's own country only when it has no client to ask */
function filingVerbOf(clients, firmZone) {
  const words = require('./pack-words');
  const verbs = new Set((clients || []).filter((client) => client.country).map((client) => words.wordsFor(client.country).filingVerb));
  return verbs.size === 1 ? [...verbs][0] : verbs.size === 0 ? words.wordsFor(firmZone).filingVerb : words.wordsFor(null).filingVerb;
}
/** the grant's role and whether this seat may only read it, put on the row's grant */
const withRole = (row, grant, seats) => { row.grant = Object.assign({}, row.grant, { role: grants.roleOf(grant.preset), read_only: readOnlyOf(grant, seats) }); return row; };
/** practice(firm, { roles (usable: decide the clients), seats (held: decide the order and read_only), today, actor, actor_name, owner (the firm's owner sees every client; absent = not the owner), manager, query }) → { rule, today, band, clients (the page), total, page, limit, has_more, truncated, ended } */
async function practice(firm, opts) {
  const roles = (opts && opts.roles) || [grants.AUDITOR];
  const present = await require('./schema').hasTables(['review_mark', 'bank_rec_log', baseline.TABLE]); /* ONE probe for the three optional tables */
  const marks = present.review_mark, bankLog = present.bank_rec_log;
  const live = await readLiveClients(firm, opts, roles, present[baseline.TABLE]);
  const today = (opts && opts.today) || CLOCK.today(live.zone);
  const ids = live.kept.map((row) => row.grantor_entity);
  const grantStart = new Map(live.kept.map((row) => [String(row.grantor_entity), row.granted_at]));
  const sinceOf = (id) => baseline.sinceFor(live.checkPoints, id, grantStart.get(String(id)));
  const answer = await cashRowsOf(ids, bankLog, today, sinceOf);
  if (marks) await withMarks(answer.rows, today);
  const byId = new Map(answer.rows.map((row) => [String(row.entity_id), row]));
  const seats = (opts && opts.seats) || roles; /* the seats HELD decide the order; the roles USABLE decide the clients */
  const seat = health.seatOf(seats);
  const everyone = live.kept.map((grant) => withRole(shape(byId.get(grant.grantor_entity) || { entity_id: grant.grantor_entity, queries: null }, grant, grant.last_look, today, sinceOf(grant.grantor_entity)), grant, seats)).sort(seat === 'accountant' ? health.byOldest : health.byUrgency);
  addHolders(everyone, live.holders); /* A1: always (an empty list = Unassigned); a client with no kept row has no key */
  const { band, clients, paging } = pageOf(everyone, pageAsked(opts && opts.query), { seat });
  const verb = filingVerbOf(everyone, live.zone); /* REP-73 B6 + XC-1119: the last stages' words from the CLIENTS' packs (lodge · file); clients under different verbs get the neutral word, never the firm's country for all */
  await addYearOnYear(clients, answer.rows, byId, today);
  return { rule: health.RULE, words: stageWords(verb), today, band, clients, total: paging.total, page: paging.page, limit: paging.limit, has_more: paging.has_more, truncated: live.truncated, ended: live.ended, own_trade: live.own_trade };
}
module.exports = { practice, addHolders, chooseLive, readOnlyOf, yoyOf, withMarks, markFigures, YOY_STATEMENT, yoyDates, pageOf, pageAsked, PAGE_MAX, shape, statement, figuresOf, basOf, bankOf, filingVerbOf, whoOf, MAX_CLIENTS };
