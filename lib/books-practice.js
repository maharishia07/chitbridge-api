'use strict';
// OWNS      THE PRACTICE READ (l16/firm-dash): the firm's whole client list with each client's work counts and business health, in ONE read: the firm's live grants → the look rows → one statement per client under that client's own binding (queryAsEach, one trip).
// CALLED BY routes/books-grants.js (GET /api/books-grants/practice) · tests/practice-health.test.cjs
// FLOW      firm binding: ONE transaction { the live grants, one per client (role chosen by the caller), the last look of each } → log one row per client the answer names (books_access_log, as a look is logged today) → commit →
//           db.query.asEach(live clients, STATEMENT) → shape each row (statusOf, returnDueFor) → { rule, band, clients[] }
// CARD      04-network/ACC-176-AUDITOR-GRANT
/**
 * ⭐ ONE CALCULATION PER FIGURE: every money figure is a stored sum of the client's own books (account_balance by the client's own fiscal_period, ledger_account nature/role); the return due date is books-cashflow.returnDueFor
 *   (the pack's calendar); the checked count and the queries are review_mark's own latest row per entry; months not locked is books.monthsNotLocked over the client's fiscal_period rows (the Month lock page's rule). Nothing here posts, nothing recomputes an engine's answer.
 * ⭐ THE LOOK DECIDES, NEVER COPIED: each grant row is put through grants.verdictOf (the same verdict the books router reads); only an `allowed` client is read, a revoked, expired or edge_off one returns no row and no log row.
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

/** the one statement a client's books answer ($1 the client, $2 today). The review marks are NOT in it: queries open and entries checked are review-mark's own functions, read per client (markFigures), so the practice and the client's page share one rule. */
function statement(cashRoles, bankLog) {
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
    SELECT $1::uuid AS entity_id,
      (SELECT to_jsonb(s) FROM (SELECT country, fy_start_month, functional_currency, enabled FROM books_setting WHERE entity_id = $1::uuid) s) AS setting,
      (SELECT CASE WHEN count(*) FILTER (WHERE rn BETWEEN 2 AND 4) >= 2 AND avg(sales) FILTER (WHERE rn BETWEEN 2 AND 4) > 0 THEN round((100.0 * (max(sales) FILTER (WHERE rn = 1) - avg(sales) FILTER (WHERE rn BETWEEN 2 AND 4)) / avg(sales) FILTER (WHERE rn BETWEEN 2 AND 4))::numeric, 1) END FROM d)::float8 AS sales_trend_pct,
      (SELECT count(*) FILTER (WHERE rn BETWEEN 2 AND 4) FROM d)::int AS sales_trend_months,
      (SELECT sales FROM d WHERE rn = 1)::bigint AS last_month_sales_minor,
      (SELECT CASE WHEN count(*) >= 2 THEN CASE WHEN bool_or(rn = 1 AND profit < 0) THEN CASE WHEN bool_or(rn = 2 AND profit < 0) THEN 2 ELSE 1 END ELSE 0 END END FROM d WHERE rn <= 2)::int AS loss_months_running,
      (SELECT CASE WHEN n > 0 AND s > 0 THEN round((100.0 * (s - c) / s)::numeric, 1) END FROM q)::float8 AS gross_margin_pct,
      (SELECT i - e FROM q WHERE n > 0)::bigint AS profit_quarter_minor,
      (SELECT count(DISTINCT currency)::int FROM account_balance WHERE entity_id = $1::uuid) AS currencies,
      (SELECT COALESCE(sum(ab.dr_minor - ab.cr_minor), 0)::bigint FROM account_balance ab JOIN ledger_account la ON la.account_id = ab.account_id AND la.entity_id = ab.entity_id WHERE ab.entity_id = $1::uuid AND la.role IN (${quoted(cashRoles)})) AS cash_minor,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('fiscal_year', f.fiscal_year, 'period', f.period, 'end_date', f.end_date::text, 'status', f.status, 'reason', f.reason)), '[]'::jsonb) FROM fiscal_period f WHERE f.entity_id = $1::uuid AND f.period >= 1) AS month_rows, /* the months as stored, which books.monthsNotLocked counts (the Month lock page own rule) */
      (SELECT jsonb_build_object('fiscal_year', f.fiscal_year, 'period', f.period) FROM fiscal_period f WHERE f.entity_id = $1::uuid AND f.period >= 1 AND EXISTS (SELECT 1 FROM journal_entry j WHERE j.entity_id = f.entity_id AND j.fiscal_year = f.fiscal_year AND j.period = f.period) ORDER BY f.fiscal_year, f.period LIMIT 1) AS books_start, /* E3: the first month with an entry — booksLockLine's own start; months before it are not work to lock: a product control, not a Xero or MYOB rule (books.markBeforeBooks) */
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
function markStatements(id, from, today, fy) {
  const RM = require('./review-mark');
  const detect = require('./mark-detect');
  const adopter = RM.adopterOf(ADOPTER);
  const inline = (text, params) => db.inlineSql(text, params);
  const idsOf = (rowsSql, column) => 'ARRAY(SELECT ' + column + '::text FROM (' + rowsSql + ') ids)';
  const askingFor = (text, listSql) => ({ text: text.replace('$2::text[]', () => listSql), params: [id] });
  const openSql = inline(RM.OPEN_LATEST_SQL, [id, ADOPTER]);
  const cover = RM.coverageSql(adopter);
  const list = [
    { text: RM.OPEN_LATEST_SQL, params: [id, ADOPTER] },
    askingFor(detect.nowSql(adopter), idsOf(openSql, 'subject_id')),
    askingFor(ON_US_SQL, idsOf(openSql, 'thread_id'))
  ];
  if (cover) {
    const clearedSql = inline(cover.cleared, [id, ADOPTER, from, today]);
    list.push({ text: cover.of, params: [id, from, today] }, { text: cover.cleared, params: [id, ADOPTER, from, today] }, askingFor(detect.nowSql(adopter), idsOf(clearedSql, 'subject_id')));
  }
  if (cover && fy) {
    const fyCleared = inline(cover.cleared, [id, ADOPTER, fy.start, fy.end]);
    list.push({ text: cover.of, params: [id, fy.start, fy.end] }, { text: cover.cleared, params: [id, ADOPTER, fy.start, fy.end] }, askingFor(detect.nowSql(adopter), idsOf(fyCleared, 'subject_id')));
  }
  return list;
}
async function markFigures(id, from, today, fy) {
  const RM = require('./review-mark');
  const detect = require('./mark-detect');
  const adopter = RM.adopterOf(ADOPTER);
  const got = await db.readBatch(id, null, markStatements(id, from, today, fy));
  const [latest, openNow, onUs, ofRead, cleared, clearedNow, fyOf, fyCleared, fyNow] = got.map((one) => one && one.rows);
  const open = RM.stillOpenFrom(latest, detect.nowFrom(adopter, openNow, latest.map((row) => row.subject_id))).rows;
  const threads = new Set(open.map((row) => String(row.thread_id)));
  const cover = ofRead ? RM.coverageFrom(ofRead, cleared, detect.nowFrom(adopter, clearedNow, cleared.map((row) => row.subject_id))) : { checked: null, of: null };
  const days = onUs.filter((row) => threads.has(row.thread) && row.last_day).map((row) => daysBetween(row.last_day, today));
  const fyCover = fyOf ? Object.assign(RM.coverageFrom(fyOf, fyCleared, detect.nowFrom(adopter, fyNow, fyCleared.map((row) => row.subject_id))), { capped: fyCleared.length >= 5000 }) : null; /* coverageSql caps the cleared read at 5000: over that, 100% can never show, and the row says so */
  return { open: open.length, on_us: onUs.filter((row) => row.us === true && threads.has(row.thread)).length, oldest_days: days.length ? Math.max(...days) : null, checked: cover.checked, of: cover.of, fy: fyCover };
}
async function withMarks(rows, today) {
  const todo = rows.filter((row) => row.quarter_start);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const row = todo[next++];
      try {
        const y = health.yearEndOf(row.month_rows, null, today);
        const m = await markFigures(String(row.entity_id), row.quarter_start, today, y && !y.first_year ? { start: y.start, end: y.end } : null);
        row.fy_cover = m.fy;
        row.queries = { open: m.open, on_us: m.on_us, oldest_days: m.oldest_days };
        row.entries_checked = m.checked;
        row.entries_of = m.of;
      } catch (failure) {
        require('./logger').warn('practice: a client marks could not be read', { code: failure && failure.code, why: failure && String(failure.message).slice(0, 160) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MARK_WORKERS, todo.length) }, worker));
  return rows;
}

/* YEAR ON YEAR (Athi 16 Nov): the statement itself lives with the one SOLD rule (books-store.YOY_STATEMENT, MIS A1); the practice only feeds it the dates of yoyDates */
const { YOY_STATEMENT } = require('./books-store');
/** the dates of that statement for a shop whose financial year starts in month fyMonth: [this year's first day, today, the first day a year back, today a year back] — the ONE date rule (books-report-period: periodOf year to date + priorOf 'year'), no date arithmetic here */
function yoyDates(today, fyMonth) {
  const RP = require('./books-report-period'), range = RP.periodOf({ preset: 'ytd' }, today, fyMonth), before = RP.priorOf(range, 'year');
  return [range.from, range.to, before.from, before.to];
}
/** a client's year on year as the page row carries it: nothing when the client holds two currencies. REP-66b: also the dates of both ranges and a `sales_yoy_state` CODE (practice-health.yoyStateOf), so a chart never guesses; a short last year or none carries no change */
function yoyOf(row, base, dates, today) {
  const span = { sales_yoy_from: dates ? dates[0] : null, sales_yoy_to: dates ? dates[1] : null, sales_prev_from: dates ? dates[2] : null, sales_prev_to: dates ? dates[3] : null };
  if (!row || !base || Number(base.currencies) > 1) return Object.assign({ sales_ytd_minor: null, sales_prev_ytd_minor: null, sales_yoy_pct: null, sales_through: null, sales_yoy_state: row && base ? 'mixed' : null }, span);
  const state = health.yoyStateOf({ now: row.sales_ytd_minor, before: row.sales_prev_ytd_minor, staleDays: row.sales_through && today ? daysBetween(row.sales_through, today) : null, startGapDays: row.sales_first && dates ? daysBetween(dates[2], row.sales_first) : null });
  return Object.assign({ sales_ytd_minor: Number(row.sales_ytd_minor), sales_prev_ytd_minor: Number(row.sales_prev_ytd_minor), sales_yoy_pct: state === 'short_last_year' || state === 'no_last_year' ? null : health.changeOf(row.sales_ytd_minor, row.sales_prev_ytd_minor), sales_through: row.sales_through || null, sales_yoy_state: state }, span);
}

/* the ONE day arithmetic of the books: books-engines ymd / addDays and books-cashflow day (a day number); the day itself is the shop clock's (the firm's own zone) */
const E = require('./books-engines');
const CLOCK = require('./shop-clock');
const cashflow = require('./books-cashflow');
const daysBetween = (from, to) => cashflow.day(to) - cashflow.day(from);
const iso = (value) => E.ymd(value);
const addDays = (day, n) => E.addDays(day, n);

/** the health figures: what the client's own books said (the statement above sums them); withheld where the figure would mislead: another currency mixed in (never added across), or costs the grant does not show */
const num = (value) => (value === null || value === undefined ? null : Number(value));
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
/** the same engine reads as the cash view and Who owes whom, over this client's own open items; null (never a guess) when the books are not switched on, the costs are not shown, or an engine refuses the items */
function openFiguresOf(row, today, ok, setting) {
  const none = { cash_days: null, bills_due_30_minor: null, receivables_over60_minor: null, receivables_over60_share_pct: null };
  if (!ok || !setting || !setting.functional_currency) return none;
  try {
    const items = (row.items || []).map(E.itemOf);
    const packed = require('./books').packOf(setting);
    const cash = cashflow.project({ asOf: today, days: 30, currency: setting.functional_currency, opening: [{ role: 'bank', code: 'cash', name: 'Cash', balance_minor: Number(row.cash_minor || 0) }], receivable_items: [], payable_items: items.filter((x) => x.side === 'payable'), cheques: [], promises: [], gst: null, names: new Map(), recurring: [] });
    const owed = items.filter((x) => x.side === 'receivable');
    const aged = owed.length ? E.dues(owed, today, 'receivable', { pack: packed, creditDaysOf: () => null }).follow.ageing : null; /* nothing owed to the client: the engine answers no ageing */
    const late = aged ? aged.buckets.undisputed : { d61_90: 0, d90_plus: 0 };
    const over = late.d61_90 + late.d90_plus;
    return {
      cash_days: cash.shortfall ? daysBetween(today, cash.shortfall.date) : null,
      bills_due_30_minor: cash.out_minor,
      receivables_over60_minor: over,
      receivables_over60_share_pct: health.shareOf(over, aged ? aged.total_minor : 0)
    };
  } catch (failure) {
    require('./logger').warn('practice: a client open items could not be read', { code: failure && failure.code, why: failure && String(failure.message).slice(0, 160) });
    return none;
  }
}

/** the next return due: the pack's own calendar (books-cashflow.returnDueFor); never "overdue": nothing records a lodgement, so a passed date says so */
function basOf(setting, today) {
  if (!setting || !setting.country) return { form: null, due_date: null, due_in_days: null, why: 'The books are not switched on.' };
  const books = require('./books');
  const pack = books.packOf(setting);
  const now = cashflow.returnDueFor(pack, today);
  const earlier = cashflow.returnDueFor(pack, addDays(today, -95));
  const past = earlier.due_date && earlier.due_date < today ? earlier.due_date : null;
  const next = now.due_date;
  return { form: now.short, due_date: next, due_in_days: next ? daysBetween(today, next) : null, last_due_date_passed: past, lodged_known: false, why: next ? null : now.why };
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

function shape(row, grant, looked, today, since) {
  const costsOk = grant.can_see_costs === true;
  const setting = row.setting;
  row = Object.assign({}, row, { month_rows: require('./books').markBeforeBooks(row.month_rows, row.books_start) }); /* E3: one rule for months before the books start */
  const figures = figuresOf(row, today, costsOk, setting);
  const verdict = health.statusOf(figures);
  const queries = row.queries || { open: 0, on_us: 0 };
  const oldest = queries.oldest_days == null ? null : Number(queries.oldest_days);
  const out = {
    entity_id: row.entity_id, name: grant.grantor_name || null, role: grant.preset, grant_id: grant.grant_id,
    country: setting ? setting.country : null, currency: setting ? setting.functional_currency : null, books_on: !!(setting && setting.enabled),
    health: Object.assign({ status: verdict.status, words: health.WORDS[verdict.status], reasons: verdict.reasons, codes: verdict.codes }, figures),
    queries: { open: Number(queries.open), on_us: Number(queries.on_us), on_client: Number(queries.open) - Number(queries.on_us), oldest_days: oldest, waiting_over_14: oldest == null ? null : oldest > OVER_DAYS },
    bas: basOf(setting, today),
    months_unlocked: require('./books').monthsNotLocked(row.month_rows, today),
    checked: { n: Number(row.entries_checked || 0), of: Number(row.entries_of || 0) },
    bank: bankOf(row.bank),
    grant: { granted_at: grant.granted_at, expires_at: grant.expires_at, ends_in_days: daysBetween(today, iso(grant.expires_at)), can_see_costs: costsOk },
    last_look: looked || null,
    changed: { n: Number(row.changed_n || 0), since: since ? since.at : null, never: since ? since.never : true } /* rank 10: entries posted since THIS person last said checked (never = no act yet: counted from the start of the grant) */
  };
  out.to_check = Math.max(0, out.checked.of - out.checked.n); /* the server's subtraction (entries this quarter without a clear mark); the FY Checked stage waits for the 0c coverage read */
  out.year_end = health.yearEndOf(row.month_rows, out.bank, today, row.fy_cover);
  out.stage = health.stageOf(out);
  out.stage_blocker = out.year_end ? out.year_end.blocker || (out.year_end.complete && out.year_end.checked && out.queries.open > 0 ? 'queries' : null) : null;
  out.health.withheld = withheldOf(row, costsOk);
  out.action_count = health.actionOf(out);
  return out;
}

const PAGE_MAX = 100, PAGE_DEFAULT = 50;
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
/** practice(firm, { roles, today, actor, actor_name, query }) → { rule, today, band, clients (the page), total, page, limit, has_more, truncated, ended } */
async function practice(firm, opts) {
  const roles = (opts && opts.roles) || [grants.AUDITOR];
  const present = await require('./schema').hasTables(['review_mark', 'bank_rec_log', baseline.TABLE]); /* ONE probe for the three optional tables */
  const marks = present.review_mark, bankLog = present.bank_rec_log;
  let today = opts && opts.today;
  const baselineReady = present[baseline.TABLE];
  const request = { actor: opts && opts.actor, actor_name: opts && opts.actor_name, pattern: baseline.LIST_READ, method: 'GET', listed: true, query_shape: null };
  const live = await grants.asEntity(firm, async (transaction) => {
    const execute = transaction.query.bind(transaction);
    const rows = (await boundRead(execute, firm, `SELECT g.grant_id, g.grantor_entity::text AS grantor_entity, g.grantee_entity, g.preset, g.can_see_costs, g.granted_at, g.expires_at, g.revoked_at,
        (SELECT display_name FROM identities WHERE identity_id = g.grantor_entity) AS grantor_name, (g.expires_at > now()) AS unexpired,
        ${isGrantParentSql('g.grantee_entity::text', 'g.grantor_entity::text')} AS edge_live,
        (SELECT max(l.at) FROM books_access_log l WHERE l.grantee_entity = g.grantee_entity AND l.grantor_entity = g.grantor_entity AND l.actor_identity_id = $2::uuid AND l.route_pattern <> $3::text AND l.outcome = 'allowed') AS last_look,
        ${baseline.checkPointSql(baselineReady, 'g')} AS check_seen_to, /* rank 10: this person, real allowed looks only - the list read, other staff and refused looks never count */
        (EXISTS (SELECT 1 FROM chit_header h WHERE h.entity_id = $1::uuid) OR EXISTS (SELECT 1 FROM books_payment b WHERE b.entity_id = $1::uuid)) AS own_trade,
        (SELECT country FROM identities WHERE identity_id = $1::uuid) AS firm_country,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'books_access_log' AND column_name = 'preset') AS role_columns
      FROM books_access_grant g WHERE g.grantee_entity = $1::uuid ORDER BY g.granted_at DESC`, [firm, (opts && opts.actor) || null, baseline.LIST_READ])).rows;
    /* ONE row per client, chosen among the LIVE grants only (newest first): an ended or run-out grant on the same client never hides the live one */
    const seen = new Set();
    const live = new Map();
    for (const row of rows) {
      if (!roles.includes(row.preset)) continue;
      seen.add(row.grantor_entity);
      if (!live.has(row.grantor_entity) && grants.verdictOf(row, request) === 'allowed') live.set(row.grantor_entity, row);
    }
    const allowed = [...live.values()];
    const kept = allowed.slice(0, MAX_CLIENTS);
    kept.forEach((row) => grants.tooMany(firm, row.grantor_entity));
    const withRole = rows.length > 0 && rows[0].role_columns === true; /* b866 run? asked in the grants read itself (same as grants.roleColumnsReady, no probe trip); with no grant row nothing is logged */
    if (kept.length) await grants.writeLogRows(transaction, withRole, kept, firm, request, { status: 200, outcome: 'allowed' });
    const checkPoints = new Map(rows.filter((row) => row.check_seen_to).map((row) => [String(row.grantor_entity), { seen_to: row.check_seen_to }])); /* rank 10: the caller's check points ride the grants read above (no extra trip) */
    return { kept, checkPoints, truncated: allowed.length > kept.length, ended: seen.size - live.size, own_trade: rows.some((row) => row.own_trade === true), zone: (rows[0] && rows[0].firm_country) || undefined };
  });
  today = today || CLOCK.today(live.zone);
  const ids = live.kept.map((row) => row.grantor_entity);
  const grantStart = new Map(live.kept.map((row) => [String(row.grantor_entity), row.granted_at]));
  const sinceOf = (id) => baseline.sinceFor(live.checkPoints, id, grantStart.get(String(id)));
  const cashRoles = cashflow.CASH_ROLES;
  const answer = ids.length ? await db.query.asEach(ids, statement(cashRoles, bankLog), (id) => [id, today, sinceOf(id).at]) : { rows: [] };
  if (marks) await withMarks(answer.rows, today);
  const byId = new Map(answer.rows.map((row) => [String(row.entity_id), row]));
  const seat = health.seatOf(roles);
  const everyone = live.kept.map((grant) => shape(byId.get(grant.grantor_entity) || { entity_id: grant.grantor_entity, queries: null }, grant, grant.last_look, today, sinceOf(grant.grantor_entity))).sort(seat === 'accountant' ? health.byOldest : health.byUrgency);
  const { band, clients, paging } = pageOf(everyone, pageAsked(opts && opts.query), { seat });
  const verb = require('./pack-words').wordsFor(live.zone).filingVerb; /* REP-73 B6: the last stages' words, from the firm's country pack (lodge · file), never typed in a page */
  const fyOf = new Map(answer.rows.map((row) => [String(row.entity_id), row.setting && row.setting.enabled ? row.setting.fy_start_month : null]));
  const askable = clients.filter((c) => Number(fyOf.get(String(c.entity_id))) >= 1);
  const yoy = askable.length ? await db.query.asEach(askable.map((c) => c.entity_id), YOY_STATEMENT, (id) => [id].concat(yoyDates(today, Number(fyOf.get(String(id)))))) : { rows: [] };
  const yoyById = new Map(yoy.rows.map((row) => [String(row.entity_id), row]));
  clients.forEach((c) => Object.assign(c.health, yoyOf(yoyById.get(String(c.entity_id)), byId.get(String(c.entity_id)), askable.includes(c) ? yoyDates(today, Number(fyOf.get(String(c.entity_id)))) : null, today)));
  return { rule: health.RULE, words: { ready: 'Ready to ' + verb, done: (verb === 'lodge' ? 'Lodged' : 'Filed') + " (owner's word)" }, today, band, clients, total: paging.total, page: paging.page, limit: paging.limit, has_more: paging.has_more, truncated: live.truncated, ended: live.ended, own_trade: live.own_trade };
}
module.exports = { practice, yoyOf, withMarks, markFigures, YOY_STATEMENT, yoyDates, pageOf, pageAsked, PAGE_MAX, shape, statement, figuresOf, basOf, bankOf, MAX_CLIENTS };
