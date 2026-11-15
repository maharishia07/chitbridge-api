'use strict';
// OWNS      THE PRACTICE READ (l16/firm-dash): the firm's whole client list with each client's work counts and business health, in ONE read: the firm's live grants → the look rows → one statement per client under that client's own binding (queryAsEach, one trip).
// CALLED BY routes/books-grants.js (GET /api/books-grants/practice) · tests/practice-health.test.cjs
// FLOW      firm binding: ONE transaction { the live grants, one per client (role chosen by the caller), the last look of each } → log one row per client the answer names (books_access_log, as a look is logged today) → commit →
//           db.query.asEach(live clients, STATEMENT) → shape each row (statusOf, returnDueFor) → { rule, band, clients[] }
// CARD      04-network/ACC-176-AUDITOR-GRANT
/**
 * ⭐ ONE CALCULATION PER FIGURE: every money figure is a stored sum of the client's own books (account_balance by the client's own fiscal_period, ledger_account nature/role); the return due date is books-cashflow.returnDueFor
 *   (the pack's calendar); the checked count and the queries are review_mark's own latest row per entry; months not locked is fiscal_period.status. Nothing here posts, nothing recomputes an engine's answer.
 * ⭐ THE LOOK DECIDES, NEVER COPIED: each grant row is put through grants.verdictOf (the same verdict the books router reads); only an `allowed` client is read, a revoked, expired or edge_off one returns no row and no log row.
 * ⚠️ HELD (named, not guessed): the bank figure (bank_rec_log is held back from the auditor, /bank/log in middleware/books-grant GRANT_HELD_BACK: cb-finance decides) and "receivables over 60 days" / "bills due in 30 days" (the open-item netting is the Receivables engine's, not a stored sum). They come back null with a state, and
 *    the cash rule waits for them.
 * ⚠️ can_see_costs=false on the grant: margin and profit come back null (the consent words say what the firm may see).
 */
const db = require('../db');
const grants = require('./books-grant');
const health = require('./practice-health');
const { boundRead } = require('./bound-read');
const { isGrantParentSql } = require('./network-membership');

const MAX_CLIENTS = 500; /* the one read answers up to this many; above it the answer says so (`truncated`) */
const COGS_ROLES = ['purchases', 'changes_in_inventories', 'purchase_returns'];
const quoted = (list) => list.map((x) => "'" + x + "'").join(',');

/** the one statement a client's books answer ($1 the client, $2 today); `marks` false = review_mark not migrated, the counts read 0 */
function statement(marks, cashRoles) {
  const lm = marks ? ", lm AS (SELECT DISTINCT ON (subject_id) subject_id, class, thread_id FROM review_mark WHERE entity_id = $1::uuid AND adopter = 'acc.audit' ORDER BY subject_id, mark_id DESC)" : '';
  const checked = marks
    ? "(SELECT count(*)::int FROM lm JOIN journal_entry e ON e.entry_id::text = lm.subject_id AND e.entity_id = $1::uuid, qs WHERE lm.class = 'clear' AND e.posting_date BETWEEN qs.d AND $2::date)"
    : '0';
  const queries = marks
    ? "(SELECT jsonb_build_object('open', count(*), 'on_us', count(*) FILTER (WHERE x.last_sender = $1::uuid)) FROM (SELECT (SELECT cm.sender_entity_id FROM chit_messages cm WHERE cm.subject_type = 'mark' AND cm.subject_id = lm.thread_id AND cm.entity_id = $1::uuid ORDER BY cm.created_at DESC LIMIT 1) AS last_sender FROM lm WHERE lm.class IN ('open', 'hold')) x)"
    : "jsonb_build_object('open', 0, 'on_us', 0)";
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
          GROUP BY fp.start_date)${lm}
    SELECT $1::uuid AS entity_id,
      (SELECT to_jsonb(s) FROM (SELECT country, fy_start_month, functional_currency, enabled FROM books_setting WHERE entity_id = $1::uuid) s) AS setting,
      (SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.start), '[]'::jsonb) FROM m) AS months,
      (SELECT d::text FROM qs) AS quarter_start,
      (SELECT count(DISTINCT currency)::int FROM account_balance WHERE entity_id = $1::uuid) AS currencies,
      (SELECT COALESCE(sum(ab.dr_minor - ab.cr_minor), 0)::bigint FROM account_balance ab JOIN ledger_account la ON la.account_id = ab.account_id AND la.entity_id = ab.entity_id WHERE ab.entity_id = $1::uuid AND la.role IN (${quoted(cashRoles)})) AS cash_minor,
      (SELECT count(*)::int FROM fiscal_period f WHERE f.entity_id = $1::uuid AND f.period >= 1 AND f.end_date < $2::date AND f.status = 'open' AND EXISTS (SELECT 1 FROM account_balance b WHERE b.entity_id = f.entity_id AND b.fiscal_year = f.fiscal_year AND b.period = f.period)) AS months_unlocked,
      (SELECT count(*)::int FROM journal_entry e, qs WHERE e.entity_id = $1::uuid AND e.posting_date BETWEEN qs.d AND $2::date) AS entries_of,
      ${checked} AS entries_checked,
      ${queries} AS queries`;
}

const DAY = 86400000;
const daysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY);
const iso = (value) => new Date(value).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

/** the health figures from the client's monthly sums: last COMPLETED month against the average of the three before it; margin and profit this quarter; loss months running (the stored sums, compared, never re-derived from entries) */
function figuresOf(row, today, costsOk) {
  const months = (row.months || []).slice().sort((a, b) => (a.start < b.start ? -1 : 1));
  const thisMonth = today.slice(0, 7);
  const done = months.filter((x) => x.start.slice(0, 7) < thisMonth);
  const mixed = Number(row.currencies) > 1;
  const last = done.length ? done[done.length - 1] : null;
  const before = done.slice(-4, -1);
  const avg = before.length === 3 ? before.reduce((t, x) => t + Number(x.sales), 0) / 3 : null;
  const trend = last && avg && avg > 0 && !mixed ? ((Number(last.sales) - avg) / avg) * 100 : null;
  const quarter = months.filter((x) => row.quarter_start && x.start >= row.quarter_start);
  const sum = (key) => quarter.reduce((t, x) => t + Number(x[key]), 0);
  const q = quarter.length && !mixed && costsOk ? { sales: sum('sales'), income: sum('income'), expense: sum('expense'), cogs: sum('cogs') } : null;
  const profits = done.slice(-2).map((x) => Number(x.income) - Number(x.expense));
  const loss = done.length >= 2 && costsOk && !mixed ? (profits.every((p) => p < 0) ? 2 : profits[1] < 0 ? 1 : 0) : null;
  return {
    sales_trend_pct: trend === null ? null : Math.round(trend * 10) / 10,
    last_month_sales_minor: last && !mixed ? Number(last.sales) : null,
    gross_margin_pct: q && q.sales > 0 ? Math.round(((q.sales - q.cogs) / q.sales) * 1000) / 10 : null,
    profit_quarter_minor: q ? q.income - q.expense : null,
    loss_months_running: loss,
    cash_minor: mixed ? null : Number(row.cash_minor || 0),
    cash_days: null, bills_due_30_minor: null, receivables_over60_minor: null, receivables_over60_share_pct: null,
    held: ['bank', 'bills_due_30', 'receivables_over60']
  };
}

/** the next return due: the pack's own calendar (books-cashflow.returnDueFor); never "overdue": nothing records a lodgement, so a passed date says so */
function basOf(setting, today) {
  if (!setting || !setting.country) return { form: null, due_date: null, due_in_days: null, why: 'The books are not switched on.' };
  const cashflow = require('./books-cashflow'), books = require('./books');
  const pack = books.packOf(setting);
  const now = cashflow.returnDueFor(pack, today);
  const earlier = cashflow.returnDueFor(pack, addDays(today, -95));
  const past = earlier.due_date && earlier.due_date < today ? earlier.due_date : null;
  const next = now.due_date;
  return { form: now.short, due_date: next, due_in_days: next ? daysBetween(today, next) : null, last_due_date_passed: past, lodged_known: false, why: next ? null : now.why };
}

function shape(row, grant, looked, today) {
  const costsOk = grant.can_see_costs === true;
  const setting = row.setting;
  const figures = figuresOf(row, today, costsOk);
  const verdict = health.statusOf(figures);
  const queries = row.queries || { open: 0, on_us: 0 };
  const out = {
    entity_id: row.entity_id, name: grant.grantor_name || null, role: grant.preset, grant_id: grant.grant_id,
    country: setting ? setting.country : null, currency: setting ? setting.functional_currency : null, books_on: !!(setting && setting.enabled),
    health: Object.assign({ status: verdict.status, words: health.WORDS[verdict.status], reasons: verdict.reasons }, figures),
    queries: { open: Number(queries.open), on_us: Number(queries.on_us), on_client: Number(queries.open) - Number(queries.on_us) },
    bas: basOf(setting, today),
    months_unlocked: Number(row.months_unlocked || 0),
    checked: { n: Number(row.entries_checked || 0), of: Number(row.entries_of || 0) },
    bank: { state: 'held' },
    grant: { granted_at: grant.granted_at, expires_at: grant.expires_at, ends_in_days: daysBetween(today, iso(grant.expires_at)), can_see_costs: costsOk },
    last_look: looked || null
  };
  out.action_count = health.actionOf(out);
  return out;
}

/** practice(firm, { roles, today, actor, actor_name }) → { rule, today, band, clients, truncated, ended } */
async function practice(firm, opts) {
  const today = (opts && opts.today) || new Date().toISOString().slice(0, 10);
  const roles = (opts && opts.roles) || [grants.AUDITOR];
  const withRole = await grants.roleColumnsReady();
  const marks = await require('./schema').hasTable('review_mark');
  const request = { actor: opts && opts.actor, actor_name: opts && opts.actor_name, pattern: 'GET /practice', method: 'GET', listed: true, query_shape: null };
  const live = await grants.asEntity(firm, async (transaction) => {
    const execute = transaction.query.bind(transaction);
    const rows = (await boundRead(execute, firm, `SELECT g.grant_id, g.grantor_entity::text AS grantor_entity, g.grantee_entity, g.preset, g.can_see_costs, g.granted_at, g.expires_at, g.revoked_at,
        (SELECT display_name FROM identities WHERE identity_id = g.grantor_entity) AS grantor_name, (g.expires_at > now()) AS unexpired,
        ${isGrantParentSql('g.grantee_entity::text', 'g.grantor_entity::text')} AS edge_live,
        (SELECT max(l.at) FROM books_access_log l WHERE l.grantee_entity = g.grantee_entity AND l.grantor_entity = g.grantor_entity) AS last_look,
        (EXISTS (SELECT 1 FROM chit_header h WHERE h.entity_id = $1::uuid) OR EXISTS (SELECT 1 FROM books_payment b WHERE b.entity_id = $1::uuid)) AS own_trade
      FROM books_access_grant g WHERE g.grantee_entity = $1::uuid ORDER BY g.granted_at DESC`, [firm])).rows;
    const chosen = new Map();
    for (const row of rows) {
      if (!roles.includes(row.preset) || chosen.has(row.grantor_entity)) continue; /* newest row of the pair, for a role this caller may use; one row per client */
      chosen.set(row.grantor_entity, row);
    }
    const allowed = [...chosen.values()].filter((row) => grants.verdictOf(row, request) === 'allowed');
    const kept = allowed.slice(0, MAX_CLIENTS);
    kept.forEach((row) => grants.tooMany(firm, row.grantor_entity));
    if (kept.length) await grants.writeLogRows(transaction, withRole, kept, firm, request, { status: 200, outcome: 'allowed' });
    return { kept, truncated: allowed.length > kept.length, ended: chosen.size - allowed.length, own_trade: rows.some((row) => row.own_trade === true) };
  });
  const ids = live.kept.map((row) => row.grantor_entity);
  const cashRoles = require('./books-cashflow').CASH_ROLES;
  const answer = ids.length ? await db.query.asEach(ids, statement(marks, cashRoles), (id) => [id, today]) : { rows: [] };
  const byId = new Map(answer.rows.map((row) => [String(row.entity_id), row]));
  const clients = live.kept.map((grant) => shape(byId.get(grant.grantor_entity) || { entity_id: grant.grantor_entity, months: [], queries: null }, grant, grant.last_look, today)).sort(health.byUrgency);
  return { rule: health.RULE, today, band: health.bandOf(clients), clients, truncated: live.truncated, ended: live.ended, own_trade: live.own_trade };
}
module.exports = { practice, statement, figuresOf, basOf, MAX_CLIENTS };
