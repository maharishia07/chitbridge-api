// @stage tested
// @stage-note [BOOKS v2] The ONE door from the server to the books engines v1.8.0 (CBPosting, CBAccountsPacks,
// @stage-note CBReceivables, CBLedger, CBBookPack) — and the translation between the tables' rows and the engines' shapes.
'use strict';
/**
 * lib/books-engines.js — WHERE THE SERVER MEETS THE BOOKS ENGINES (SPEC-books-v2 §7.2; engines docs/CONTRACTS.md).
 *
 * ⭐ ONE ADAPTER. Every books caller asks this file, never an engine directly, so adopting v1.8.0 (tools/adopt.cjs →
 *   lib/posting.js, lib/accounts-packs.js, lib/receivables.js, lib/ledger.js, lib/bookpack.js) changes nothing else.
 * ⚠️⚠️ NEVER AN UNRELEASED ENGINE IN PRODUCTION. Only an ADOPTED copy (lib/<engine>.js, stamped, pinned in
 *   engines.lock.json) is loaded. The sibling working copy (../chitbridge-engines/src) is read ONLY with
 *   BOOKS_DEV_ENGINES=1 — a developer proving the wiring before the release exists. Without either the ledger refuses
 *   (BOOKS_ENGINE → 503 on a read; a post waits in books_outbox, named) rather than post by rules nobody released.
 * ⭐ NO SECOND COPY OF THE RULES: debits and credits (CBPosting), due dates, allocations, cheques and reversals of party
 *   items (CBReceivables), balances, statements, ageing, carryforward and controls (CBLedger), the pack (CBBookPack) —
 *   all theirs. What is here is only the mapping between a table row and an engine row.
 */
const path = require('path');

const FILES = { posting: 'posting', packs: 'accounts-packs', receivables: 'receivables', ledger: 'ledger', bookpack: 'bookpack', period: 'period' };
const NAMES = { posting: 'CBPosting', packs: 'CBAccountsPacks', receivables: 'CBReceivables', ledger: 'CBLedger', bookpack: 'CBBookPack', period: 'CBPeriod' };
const NEEDS = { posting: 'post', packs: 'withAccounts', receivables: 'confirmItems', ledger: 'balanceAsAt', bookpack: 'build', period: 'postingDate' };
const injected = {};
const loaded = {};

function tryRequire(p) {
  try { return require(p); }
  catch (e) { if (e && e.code === 'MODULE_NOT_FOUND' && String(e.message).indexOf(path.basename(p)) >= 0) return null; throw e; }
}
/** the engine, or null: injected (tests) → adopted lib copy → the dev sibling, only when asked for by name */
function load(name) {
  if (Object.prototype.hasOwnProperty.call(injected, name)) return injected[name];
  if (Object.prototype.hasOwnProperty.call(loaded, name)) return loaded[name].mod;
  const file = FILES[name];
  let mod = tryRequire(path.join(__dirname, file)), from = 'adopted';
  /* an adopted copy of an OLDER release (v1.7.0 has no withAccounts / confirmItems) is not the one these rows need */
  if (mod && typeof mod[NEEDS[name]] !== 'function') { mod = null; }
  if (!mod && process.env.BOOKS_DEV_ENGINES === '1') {
    mod = tryRequire(path.join(__dirname, '..', '..', 'chitbridge-engines', 'src', file)); from = 'dev';
    if (mod && typeof mod[NEEDS[name]] !== 'function') mod = null;
  }
  loaded[name] = { mod, from: mod ? from : null };
  return mod;
}
function inject(name, mod) { injected[name] = mod; }
function reset() { for (const k of Object.keys(injected)) delete injected[k]; for (const k of Object.keys(loaded)) delete loaded[k]; }
/** what the health screen says about the engines — never guessed */
function status() {
  const out = {};
  for (const n of Object.keys(FILES)) {
    const m = load(n);
    out[n] = Object.prototype.hasOwnProperty.call(injected, n) ? (m ? 'injected' : 'missing') : (m ? loaded[n].from : 'missing');
  }
  return out;
}
function need(name) {
  const m = load(name);
  if (!m) { const e = new Error('The ledger engines are not installed on this server yet (' + NAMES[name] + ', engines v1.8.0 not adopted).'); e.code = 'BOOKS_ENGINE'; throw e; }
  return m;
}
const posting = () => need('posting');
/**
 * ⭐ CS2 (2026-10-13): accounts-packs is the engines' FACADE over the registry since v1.21.0 (adopted here at v1.42.0): packFor('AU') is the Australia pack,
 * packFor('AE') the UAE's — never India's with a `fallback` flag nobody read (what enable() seeded for every non-Indian shop under v1.20.0). The books core
 * still adopted at v1.20.0 (posting · ledger · bookpack · period) reads a pack's year as `fy_start_month`; a registered pack states it ONCE, in
 * `fiscalYear.startMonth` (regulation refuses a contradiction), so THIS door fills the legacy twin for a pack that lacks it — one place, never a copy of the year.
 */
function withLegacyYear(p) {
  if (!p || p.fy_start_month || !(p.fiscalYear && p.fiscalYear.startMonth)) return p;
  return Object.assign({}, p, { fy_start_month: p.fiscalYear.startMonth });
}
let packsDoor = null;                                 /* { raw, mod } — rebuilt when the engine behind it changes (inject / reset) */
function packs() {
  const m = need('packs');
  if (packsDoor && packsDoor.raw === m) return packsDoor.mod;
  const mod = Object.assign({}, m, { packFor: (c) => withLegacyYear(m.packFor(c)) });
  packsDoor = { raw: m, mod };
  return mod;
}
const receivables = () => need('receivables');
const ledger = () => need('ledger');
const bookpack = () => need('bookpack');
const period = () => need('period');            /* v1.20.0: the month lock and the year close — the ONE rule (postingDate, yearClose) */

/**
 * ⭐ ymd(v) — THE ONE READER OF A DATE (a `date` column, or a 'YYYY-MM-DD…' string) → 'YYYY-MM-DD'.
 * ⚠️⚠️ A Date HERE IS A `date` COLUMN, AND node-pg BUILDS IT AT LOCAL MIDNIGHT (pg-types 1082 → new Date(y, m, d)). So it is
 *   read back with the LOCAL getters — the same calendar day in every zone. It used toISOString(), which is the day BEFORE
 *   east of UTC: production (UTC) was right by accident, and a run in India dated a reversal the day before its original
 *   and moved a sale INTO a locked month, in insert-only rows (critic M8, 2026-09-30; tests/books-dates-tz.test.cjs runs
 *   the writer under Asia/Kolkata and UTC and holds them equal).
 * ⚠️ A MOMENT (created_at, enabled_at — timestamptz) is NOT read with this: its day depends on the shop, not the server —
 *   lib/books-hooks dayOf(ts, country).
 */
function ymd(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const p = (n) => (n < 10 ? '0' : '') + n;
    return v.getFullYear() + '-' + p(v.getMonth() + 1) + '-' + p(v.getDate());
  }
  return String(v).slice(0, 10);
}
const num = (v) => (v == null ? 0 : Number(v));

/* ═══ the chart ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** a group's code in a shop's chart: 'G' + the first number of its range — never collides with a ledger's 4 digits */
const groupCode = (g) => 'G' + (g.range ? g.range[0] : g.code);

/**
 * chartRows(pack) → the rows a shop's chart is seeded with: groups (parents first), then the ledgers and the expense /
 * income classes, each naming its group's key. Read from the pack's own data (CBAccountsPacks.accountOf for mappings).
 */
function chartRows(pack) {
  const A = packs(), p = pack || {};
  const groups = (p.groups || []).slice().sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));
  /* CS2: a group's statement line is `sch3` on India's rows and `line` on Australia's and the UAE's (the pack's own key into its `sch3` table) — read either, one column */
  const lineKey = (g) => g.sch3 || g.line || '';
  const out = groups.map((g) => ({ code: groupCode(g), key: g.code, name: g.name, is_group: true, nature: g.nature, role: null, parent: g.parent || null,
    tally_group: g.name, sch3_line: p.sch3 && p.sch3[lineKey(g)] ? p.sch3[lineKey(g)].label : null, saft_grouping: g.nature.toUpperCase() + ':' + lineKey(g) }));
  const seen = {};
  [].concat(p.ledgers || [], p.expense_classes || [], p.income_classes || []).forEach((r) => {
    if (seen[r.code] || r.shop) return; seen[r.code] = 1;
    const a = A.accountOf(p, r.role || r.code);
    /* accountOf hands back the pack's OWN extras: India `tally_group · sch3_line · saft`; AU / AE `group_name · line · line_label` — the same three columns are filled from either */
    out.push({ code: r.code, key: r.role, name: r.name, is_group: false, nature: a ? a.nature : null, role: r.role || null, parent: r.group,
      tally_group: a ? (a.tally_group || a.group_name || null) : null, sch3_line: a ? (a.sch3_line || a.line_label || null) : null,
      saft_grouping: a ? (a.saft ? a.saft.category + ':' + a.saft.code : (a.line ? String(a.nature || '').toUpperCase() + ':' + a.line : null)) : null });
  });
  return out;
}
/** the ledgers a SHOP added (role null), as CBAccountsPacks.withAccounts wants them: { code, name, group (the pack key) } */
function shopAccounts(pack, chart) {
  const gKey = new Map((pack.groups || []).map((g) => [groupCode(g), g.code]));
  const gCode = new Map((chart || []).filter((a) => a.is_group).map((a) => [String(a.account_id), a.code]));
  return (chart || []).filter((a) => !a.role && !a.is_group && a.active !== false)
    .map((a) => ({ code: String(a.code), name: a.name, group: gKey.get(gCode.get(String(a.parent_id))) })).filter((r) => r.group);
}
/** the pack plus this shop's own ledgers (a clash is refused by the engine, never merged) */
function packWith(pack, chart) {
  const own = shopAccounts(pack, chart);
  return own.length ? packs().withAccounts(pack, own) : pack;
}

/* ═══ rows ↔ engine shapes ════════════════════════════════════════════════════════════════════════════════════ */

/** a stored journal line (joined to its entry and ledger) → CBLedger's line */
function lineOf(r) {
  return { entry_id: r.entry_id, jv_no: r.entry_no, line_no: r.line_no, date: ymd(r.posting_date), fiscal_year: r.fiscal_year, period: Number(r.period),
           is_opening: !!r.is_opening, code: String(r.code), party: r.party_id || null, dr_minor: num(r.dr_minor), cr_minor: num(r.cr_minor),
           currency: r.currency, ref: r.source_ref || null, narration: r.narration || null };
}
/** a stored monthly balance row → CBLedger's balance row */
function balanceOf(r, ZERO) {
  return { fiscal_year: r.fiscal_year, period: Number(r.period), code: String(r.code), party: r.party_key && r.party_key !== ZERO ? r.party_key : null,
           dr_minor: num(r.dr_minor), cr_minor: num(r.cr_minor) };
}
/** a stored party_item → CBReceivables' party item */
function itemOf(r) {
  const o = { item_id: r.item_id, entry_id: r.entry_id || null, party: r.party_id, side: r.side, ref_kind: r.ref_kind, ref: r.ref, against_ref: r.against_ref, amount_minor: num(r.amount_minor),
              currency: r.currency, date: ymd(r.doc_date), due_date: ymd(r.due_date), kind: r.kind || undefined, status: r.status || undefined,
              created_at: r.created_at };
  if (r.pending_minor != null) o.pending_minor = num(r.pending_minor);
  if (r.payment_id) o.payment_id = r.payment_id;          /* M26: which payment settled a bill — the duplicate rule's W4 reads it */
  if (r.reverses != null) o.reverses = r.reverses;
  if (r.reverses_kind) o.reverses_kind = r.reverses_kind;
  return o;
}
/** a CBReceivables row → the columns insertItems writes */
function itemRow(x, account_id, extra) {
  const e = extra || {};
  return { party_id: x.party, account_id, side: x.side || 'receivable', ref: String(x.ref), against_ref: String(x.against_ref), ref_kind: x.ref_kind,
           kind: x.kind || null, amount_minor: num(x.amount_minor), pending_minor: x.pending_minor != null ? num(x.pending_minor) : null,
           currency: x.currency || e.currency, due_date: x.due_date || null, doc_date: x.date || e.date || null, status: x.status || null,
           reverses: x.reverses != null ? String(x.reverses) : null, reverses_kind: x.reverses_kind || null,
           entry_id: e.entry_id || null, payment_id: e.payment_id || null, note: e.note || null, created_by: e.by || null };
}

/** outstanding per document, then Schedule III ageing (receivable six buckets, payable five) */
function dues(items, asOf, side) {
  const R = receivables(), L = ledger();
  const rows = (items || []).filter(Boolean);
  if (!rows.length) return { outstanding: { by_ref: {}, by_party: {}, total_minor: 0 }, ageing: L.ageing([], asOf, side) };
  const o = R.outstanding(rows);
  return { outstanding: o, ageing: L.ageing(Object.keys(o.by_ref).map((k) => o.by_ref[k]), asOf, side) };
}

/**
 * CB Finance · Collections — the interest a customer's overdue bills have earned, SHOWN and never posted (decision: interest is show-only).
 * One calculation: receivables.interestDue (major decimals in and out — converted here at the seam). The rate is the customer's TERMS
 * (lib/finance-terms.resolve: the party's own, else the shop default — set in CB Finance › Terms); never a constant (T1-FINREW FIN-R1).
 * `interest` = the resolved { on, rate_pct, grace_days } — rate_pct is % A YEAR (the Terms tab's "Rate % a year"); the engine takes a
 * month's rate, so rate_pm = rate_pct / 12. No terms, or interest off → null: nothing is guessed, the screen says "Not set" / "Off".
 */
function interestMinor(docs, asOf, cur, interest) {
  const i = interest || null;
  if (!i || i.on !== true || !(Number(i.rate_pct) > 0)) return null;
  const opt = { currency: cur, on: true, rate_pm: Number(i.rate_pct) / 12, grace_days: Number(i.grace_days) || 0 };
  const M = require('./money'), R = receivables(), f = Math.pow(10, M.decimals ? M.decimals(cur) : 2);
  let t = 0;
  (docs || []).forEach((d) => {
    const r = R.interestDue({ balance: d.outstanding_minor / f, due: d.due_date || d.date, currency: cur }, asOf, opt);
    if (r && r.amount > 0) t += Math.round(r.amount * f);
  });
  return t;
}
/** the code the screen branches on for interest: 'on' · 'off' (terms say off) · 'not_set' (no terms anywhere) */
function interestState(eff) {
  const i = eff && eff.interest;
  return !i || !i.value ? 'not_set' : i.value.on === true && Number(i.value.rate_pct) > 0 ? 'on' : 'off';
}
/**
 * the limit a customer has and whether the balance is over it — the resolved terms' limit (the party's own, else the shop default;
 * lib/finance-terms.limitCheck decides "over"); credit_limit_from: 'party' · 'shop' · null (not set). last_remind has no store yet (F5).
 */
function limitView(eff, r) {
  const lim = eff && eff.credit_limit_minor ? eff.credit_limit_minor : { value: null, from: null };
  const c = require('./finance-terms').limitCheck(lim.value, r.balance_minor, 0);
  return { credit_limit_minor: lim.value == null ? null : Number(lim.value), credit_limit_from: lim.value == null ? null : lim.from, over_limit: c.over, last_remind: null };
}

module.exports = { load, inject, reset, status, posting, packs, receivables, ledger, bookpack, period, chartRows, shopAccounts, packWith,
  interestMinor, interestState, limitView, groupCode, lineOf, balanceOf, itemOf, itemRow, dues, ymd, NAMES };
