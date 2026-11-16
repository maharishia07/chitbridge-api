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

const ADOPTER = 'acc.audit';
const MAX_CLIENTS = 500; /* the one read answers up to this many; above it the answer says so (`truncated`) */
const COGS_ROLES = ['purchases', 'changes_in_inventories', 'purchase_returns'];
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
${bankLog ? `    bk AS (${require('./bank-rec-log').LATEST_SQL('$1::uuid')}),
` : ''}    d AS (SELECT row_number() OVER (ORDER BY start DESC) AS rn, sales, income - expense AS profit FROM m WHERE start < to_char($2::date, 'YYYY-MM') || '-01'),
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
      (SELECT count(*)::int FROM journal_entry e, qs WHERE e.entity_id = $1::uuid AND e.posting_date BETWEEN qs.d AND $2::date) AS entries_of,
      ${bankLog ? "(SELECT jsonb_build_object('accounts', count(*), 'rows', COALESCE(jsonb_agg(jsonb_build_object('account_id', account_id, 'period_to', period_to::text, 'difference_minor', difference_minor, 'currency', currency)), '[]'::jsonb)) FROM bk)" : 'NULL::jsonb'} AS bank,
      (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.created_at, p.item_id), '[]'::jsonb) FROM (${require('./books-open-items').rowsSql('$1::uuid')}) p) AS items, /* l16-scale: the OPEN documents only (books-open-items.rowsSql), never every row ever written */
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
  const askingFor = (text, listSql) => ({ text: text.replace('ANY($2::text[])', 'ANY(' + listSql + ')'), params: [id] });
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

function shape(row, grant, looked, today) {
  const costsOk = grant.can_see_costs === true;
  const setting = row.setting;
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
    last_look: looked || null
  };
  out.to_check = Math.max(0, out.checked.of - out.checked.n); /* the server's subtraction (entries this quarter without a clear mark); the FY Checked stage waits for the 0c coverage read */
  out.year_end = health.yearEndOf(row.month_rows, out.bank, today, row.fy_cover);
  out.stage = health.stageOf(out);
  out.stages_reached = health.STAGES.filter((stage) => health.reached(out, stage)); /* the list's filter reads this, so a stage count and its filter are one rule */
  out.stage_blocker = out.year_end ? out.year_end.blocker || (out.year_end.complete && out.year_end.checked && out.queries.open > 0 ? 'queries' : null) : null;
  out.health.withheld = withheldOf(row, costsOk);
  out.action_count = health.actionOf(out);
  return out;
}

/** practice(firm, { roles, today, actor, actor_name }) → { rule, today, band, clients, truncated, ended } */
async function practice(firm, opts) {
  const roles = (opts && opts.roles) || [grants.AUDITOR];
  const marks = await require('./schema').hasTable('review_mark');
  const bankLog = await require('./schema').hasTable('bank_rec_log');
  let today = opts && opts.today;
  const request = { actor: opts && opts.actor, actor_name: opts && opts.actor_name, pattern: 'GET /practice', method: 'GET', listed: true, query_shape: null };
  const live = await grants.asEntity(firm, async (transaction) => {
    const execute = transaction.query.bind(transaction);
    const rows = (await boundRead(execute, firm, `SELECT g.grant_id, g.grantor_entity::text AS grantor_entity, g.grantee_entity, g.preset, g.can_see_costs, g.granted_at, g.expires_at, g.revoked_at,
        (SELECT display_name FROM identities WHERE identity_id = g.grantor_entity) AS grantor_name, (g.expires_at > now()) AS unexpired,
        ${isGrantParentSql('g.grantee_entity::text', 'g.grantor_entity::text')} AS edge_live,
        (SELECT max(l.at) FROM books_access_log l WHERE l.grantee_entity = g.grantee_entity AND l.grantor_entity = g.grantor_entity) AS last_look,
        (EXISTS (SELECT 1 FROM chit_header h WHERE h.entity_id = $1::uuid) OR EXISTS (SELECT 1 FROM books_payment b WHERE b.entity_id = $1::uuid)) AS own_trade,
        (SELECT country FROM identities WHERE identity_id = $1::uuid) AS firm_country,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'books_access_log' AND column_name = 'preset') AS role_columns
      FROM books_access_grant g WHERE g.grantee_entity = $1::uuid ORDER BY g.granted_at DESC`, [firm])).rows;
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
    return { kept, truncated: allowed.length > kept.length, ended: seen.size - live.size, own_trade: rows.some((row) => row.own_trade === true), zone: (rows[0] && rows[0].firm_country) || undefined };
  });
  today = today || CLOCK.today(live.zone);
  const ids = live.kept.map((row) => row.grantor_entity);
  const cashRoles = cashflow.CASH_ROLES;
  const answer = ids.length ? await db.query.asEach(ids, statement(cashRoles, bankLog), (id) => [id, today]) : { rows: [] };
  if (marks) await withMarks(answer.rows, today);
  const byId = new Map(answer.rows.map((row) => [String(row.entity_id), row]));
  const clients = live.kept.map((grant) => shape(byId.get(grant.grantor_entity) || { entity_id: grant.grantor_entity, queries: null }, grant, grant.last_look, today)).sort((opts && opts.roles && health.seatOf(opts.roles) === 'accountant') ? health.byOldest : health.byUrgency);
  return { rule: health.RULE, today, band: health.bandOf(clients, { seat: health.seatOf(roles) }), clients, truncated: live.truncated, ended: live.ended, own_trade: live.own_trade };
}
module.exports = { practice, withMarks, markFigures, shape, statement, figuresOf, basOf, bankOf, MAX_CLIENTS };
