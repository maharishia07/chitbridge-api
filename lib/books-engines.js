// @stage tested
// @stage-note [BOOKS v2] The ONE door from the server to the books engines v1.8.0 (CBPosting, CBAccountsPacks,
// @stage-note CBReceivables, CBLedger, CBBookPack) — and the translation between the tables' rows and the engines' shapes.
'use strict';
/**
 * OWNS      the one adapter between the books tables' rows and the engines' shapes (itemOf · itemRow · dues · the engine loaders)
 * CALLED BY lib/books.js, lib/books-store.js, lib/books-hooks.js, lib/books-manual.js, lib/books-payables.js, lib/books-cashflow.js, routes/books.js
 * CARD 14-accounting/ledger-accounts-day-book-entries-reverse
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
 * OWNS       the engine door (load · inject · need) · the row ↔ engine mappings (lineOf · itemOf · itemRow · chartRows) · dues / netOpen — THE ONE
 *            DUE FIGURE every screen reads (R73/R75/R76) · interestMinor / limitView / earlyOffer — the terms' figures in money
 * CALLED BY  lib/books · books-cashflow · books-payables · books-period · books-recurring · books-hooks · party-fields · routes/books · routes/crm · tests
 * FLOW       items (party_item rows) → itemOf → netOpen (outstanding → fromItems → propose per party) → dues (ageing over the netted bills) → the route
 * CARD 16-finance/collections-and-dues
 */
const path = require('path');

const FILES = { posting: 'posting', packs: 'accounts-packs', receivables: 'receivables', ledger: 'ledger', bookpack: 'bookpack', period: 'period' };
const NAMES = { posting: 'CBPosting', packs: 'CBAccountsPacks', receivables: 'CBReceivables', ledger: 'CBLedger', bookpack: 'CBBookPack', period: 'CBPeriod' };
const NEEDS = { posting: 'post', packs: 'withAccounts', receivables: 'confirmItems', ledger: 'balanceAsAt', bookpack: 'build', period: 'postingDate' };
const injected = {};
const loaded = {};

function tryRequire(p) {
  try {
    return require(p);
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND' && String(e.message).indexOf(path.basename(p)) >= 0) return null;
    throw e;
  }
}
/** the engine, or null: injected (tests) → adopted lib copy → the dev sibling, only when asked for by name */
function load(name) {
  if (Object.prototype.hasOwnProperty.call(injected, name)) return injected[name];
  if (Object.prototype.hasOwnProperty.call(loaded, name)) return loaded[name].mod;
  const file = FILES[name];
  let mod = tryRequire(path.join(__dirname, file)),
    from = 'adopted';
  /* an adopted copy of an OLDER release (v1.7.0 has no withAccounts / confirmItems) is not the one these rows need */
  if (mod && typeof mod[NEEDS[name]] !== 'function') {
    mod = null;
  }
  if (!mod && process.env.BOOKS_DEV_ENGINES === '1') {
    mod = tryRequire(path.join(__dirname, '..', '..', 'chitbridge-engines', 'src', file));
    from = 'dev';
    if (mod && typeof mod[NEEDS[name]] !== 'function') mod = null;
  }
  loaded[name] = { mod, from: mod ? from : null };
  return mod;
}
function inject(name, mod) {
  injected[name] = mod;
}
function reset() {
  for (const k of Object.keys(injected)) delete injected[k];
  for (const k of Object.keys(loaded)) delete loaded[k];
}
/** what the health screen says about the engines — never guessed */
function status() {
  const out = {};
  for (const n of Object.keys(FILES)) {
    const m = load(n);
    out[n] = Object.prototype.hasOwnProperty.call(injected, n) ? (m ? 'injected' : 'missing') : m ? loaded[n].from : 'missing';
  }
  return out;
}
function need(name) {
  const m = load(name);
  if (!m) {
    const e = new Error('The ledger engines are not installed on this server yet (' + NAMES[name] + ', engines v1.8.0 not adopted).');
    e.code = 'BOOKS_ENGINE';
    throw e;
  }
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
let packsDoor = null; /* { raw, mod } — rebuilt when the engine behind it changes (inject / reset) */
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
const period = () => need('period'); /* v1.20.0: the month lock and the year close — the ONE rule (postingDate, yearClose) */

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
function ymd(date) {
  if (!date) return null;
  if (date instanceof Date) {
    if (isNaN(date.getTime())) return null;
    const p = (n) => (n < 10 ? '0' : '') + n;
    return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate());
  }
  return String(date).slice(0, 10);
}
/**
 * addDays(day, k) → the calendar day k days from `day` (a date column or 'YYYY-MM-DD'), as 'YYYY-MM-DD' — day arithmetic on the UTC
 * calendar, so the same answer in every zone. ⭐ T2-NATDEF: the one copy; books, books-cashflow, crm-calls and crm-followups typed it privately.
 */
function addDays(day, k) {
  const d = ymd(day);
  return d ? new Date(Date.parse(d + 'T00:00:00Z') + Number(k || 0) * 86400000).toISOString().slice(0, 10) : null;
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
  const A = packs(),
    p = pack || {};
  const groups = (p.groups || []).slice().sort((first, second) => (first.parent ? 1 : 0) - (second.parent ? 1 : 0));
  /* CS2: a group's statement line is `sch3` on India's rows and `line` on Australia's and the UAE's (the pack's own key into its `sch3` table) — read either, one column */
  const lineKey = (g) => g.sch3 || g.line || '';
  const out = groups.map((item) => ({
    code: groupCode(item),
    key: item.code,
    name: item.name,
    is_group: true,
    nature: item.nature,
    role: null,
    parent: item.parent || null,
    tally_group: item.name,
    sch3_line: p.sch3 && p.sch3[lineKey(item)] ? p.sch3[lineKey(item)].label : null,
    saft_grouping: item.nature.toUpperCase() + ':' + lineKey(item)
  }));
  const seen = {};
  [].concat(p.ledgers || [], p.expense_classes || [], p.income_classes || []).forEach((item) => {
    if (seen[item.code] || item.shop) return;
    seen[item.code] = 1;
    const a = A.accountOf(p, item.role || item.code);
    /* accountOf hands back the pack's OWN extras: India `tally_group · sch3_line · saft`; AU / AE `group_name · line · line_label` — the same three columns are filled from either */
    out.push({
      code: item.code,
      key: item.role,
      name: item.name,
      is_group: false,
      nature: a ? a.nature : null,
      role: item.role || null,
      parent: item.group,
      tally_group: a ? a.tally_group || a.group_name || null : null,
      sch3_line: a ? a.sch3_line || a.line_label || null : null,
      saft_grouping: a ? (a.saft ? a.saft.category + ':' + a.saft.code : a.line ? String(a.nature || '').toUpperCase() + ':' + a.line : null) : null
    });
  });
  return out;
}
/** the ledgers a SHOP added (role null), as CBAccountsPacks.withAccounts wants them: { code, name, group (the pack key) } */
function shopAccounts(pack, chart) {
  const gKey = new Map((pack.groups || []).map((item) => [groupCode(item), item.code]));
  const gCode = new Map((chart || []).filter((item) => item.is_group).map((item) => [String(item.account_id), item.code]));
  return (chart || [])
    .filter((item) => !item.role && !item.is_group && item.active !== false)
    .map((item) => ({ code: String(item.code), name: item.name, group: gKey.get(gCode.get(String(item.parent_id))) }))
    .filter((item) => item.group);
}
/** the pack plus this shop's own ledgers (a clash is refused by the engine, never merged) */
function packWith(pack, chart) {
  const own = shopAccounts(pack, chart);
  return own.length ? packs().withAccounts(pack, own) : pack;
}

/* ═══ rows ↔ engine shapes ════════════════════════════════════════════════════════════════════════════════════ */

/** a stored journal line (joined to its entry and ledger) → CBLedger's line */
function lineOf(r) {
  return {
    entry_id: r.entry_id,
    jv_no: r.entry_no,
    line_no: r.line_no,
    date: ymd(r.posting_date),
    fiscal_year: r.fiscal_year,
    period: Number(r.period),
    is_opening: !!r.is_opening,
    code: String(r.code),
    party: r.party_id || null,
    dr_minor: num(r.dr_minor),
    cr_minor: num(r.cr_minor),
    currency: r.currency,
    ref: r.source_ref || null,
    narration: r.narration || null
  };
}
/** a stored monthly balance row → CBLedger's balance row */
function balanceOf(r, ZERO) {
  return {
    fiscal_year: r.fiscal_year,
    period: Number(r.period),
    code: String(r.code),
    party: r.party_key && r.party_key !== ZERO ? r.party_key : null,
    dr_minor: num(r.dr_minor),
    cr_minor: num(r.cr_minor)
  };
}
/** a stored party_item → CBReceivables' party item */
function itemOf(r) {
  const o = {
    item_id: r.item_id,
    entry_id: r.entry_id || null,
    party: r.party_id,
    side: r.side,
    ref_kind: r.ref_kind,
    ref: r.ref,
    against_ref: r.against_ref,
    amount_minor: num(r.amount_minor),
    currency: r.currency,
    date: ymd(r.doc_date),
    due_date: ymd(r.due_date),
    kind: r.kind || undefined,
    status: r.status || undefined,
    created_at: r.created_at
  };
  if (r.pending_minor != null) o.pending_minor = num(r.pending_minor);
  if (r.payment_id) o.payment_id = r.payment_id; /* M26: which payment settled a bill — the duplicate rule's W4 reads it */
  if (r.reverses != null) o.reverses = r.reverses;
  if (r.reverses_kind) o.reverses_kind = r.reverses_kind;
  if (r.note) o.note = String(r.note); /* R106: the document's own word ("₹250 short against their ₹2,940") — books-payables.billNotes reads it */
  return o;
}
/** a CBReceivables row → the columns insertItems writes */
function itemRow(x, account_id, extra) {
  const e = extra || {};
  return {
    party_id: x.party,
    account_id,
    side: x.side || 'receivable',
    ref: String(x.ref),
    against_ref: String(x.against_ref),
    ref_kind: x.ref_kind,
    kind: x.kind || null,
    amount_minor: num(x.amount_minor),
    pending_minor: x.pending_minor != null ? num(x.pending_minor) : null,
    currency: x.currency || e.currency,
    due_date: x.due_date || null,
    doc_date: x.date || e.date || null,
    status: x.status || null,
    reverses: x.reverses != null ? String(x.reverses) : null,
    reverses_kind: x.reverses_kind || null,
    entry_id: e.entry_id || null,
    payment_id: e.payment_id || null,
    note: e.note || null,
    created_by: e.by || null
  };
}

/** minor units ↔ the engine's amounts (money.decimals for the currency) — the seam, as interestMinor crosses it */
function minorScale(currency) {
  const Money = require('./money');
  return Math.pow(10, Money.decimals ? Money.decimals(currency) : 2);
}
/** a credit's money still on account (a receipt never allocated), when it may reduce a bill (usable: cleared, undisputed, not void) */
function unappliedOf(credit, byRef, Receivables) {
  const doc = byRef[credit.id];
  if (!doc || !(doc.outstanding_minor < 0) || !Receivables.usable(credit).ok) return 0;
  return -doc.outstanding_minor;
}
/** fromItems' debits · credits · allocations, grouped per party (an allocation sits with its credit's party) — one pass, never a filter per party */
function perParty(view) {
  const groups = Object.create(null),
    creditParty = Object.create(null);
  const groupOf = (party) => groups[party] || (groups[party] = { debits: [], credits: [], allocations: [] });
  view.debits.forEach((debit) => groupOf(String(debit.party)).debits.push(debit));
  view.credits.forEach((credit) => {
    creditParty[credit.id] = String(credit.party);
    groupOf(creditParty[credit.id]).credits.push(credit);
  });
  view.allocations.forEach((alloc) => {
    if (creditParty[alloc.credit]) groupOf(creditParty[alloc.credit]).allocations.push(alloc);
  });
  return groups;
}
/**
 * one party's receipts on account, proposed against its open bills — CBReceivables.propose with ONE stand-in credit for all it has unapplied
 * (the engine's oldest-due-first rule, as books-cashflow covers a held cheque). → { cover: { bill → minor }, extra: virtual allocations, left: minor on account }
 */
function coverByReceipts(party, group, byRef, Receivables, currency) {
  const scale = minorScale(currency),
    none = { cover: Object.create(null), extra: [], left: 0 };
  const unapplied = group.credits.reduce((total, credit) => total + unappliedOf(credit, byRef, Receivables), 0);
  if (!(unapplied > 0)) return none;
  const latest = group.credits.map((credit) => credit.date || '').sort().pop() || null;
  const standIn = { id: 'unapplied:' + party, kind: 'payment', party, date: latest, amount: unapplied / scale, currency };
  const proposal = Receivables.propose(group.debits, standIn, { credits: group.credits, allocations: group.allocations });
  if (!proposal.ok) return none;
  const cover = Object.create(null),
    extra = [];
  proposal.allocations.forEach((alloc) => {
    cover[alloc.debit] = (cover[alloc.debit] || 0) + Math.round(Number(alloc.amount) * scale);
    extra.push({ credit: standIn.id, debit: alloc.debit, amount: alloc.amount });
  });
  return { cover, extra, left: Math.round(Number(proposal.on_account || 0) * scale) };
}
/**
 * ⭐⭐ netOpen(items) — THE ONE DUE FIGURE (walk R73/R75/R76, 24 Oct: Remind said ₹4,490, the Cash view counted ₹4,490 and the age bucket held
 * ₹4,490 for a customer who owed ₹490 — a cleared cheque sat on account, netted in the party's balance but never against the bill).
 * A bill's due = what it still needs after its allocations AND the party's receipts that were never allocated (cash on account, a cheque that
 * cleared and was left unapplied). The netting is the engine's own proposal (coverByReceipts) — never a second rule. Nothing is written: the
 * books still show the receipt on account until the owner allocates it; this is what Remind, the Cash position and the age buckets READ.
 * → { by_ref: the open bills (kind 'bill') with outstanding_minor = what is left, covered_minor = what the receipts cover;
 *     view: fromItems' { debits, credits, allocations } with the virtual allocations appended (a caller proposing a held cheque starts from it);
 *     unapplied_by_party: { party → minor } what stays on account once every bill is covered (an advance, not a due) }
 */
function netOpen(items) {
  const Receivables = receivables();
  const rows = (items || []).filter(Boolean);
  const out = { by_ref: Object.create(null), view: { debits: [], credits: [], allocations: [] }, unapplied_by_party: Object.create(null) };
  if (!rows.length) return out;
  const outstanding = Receivables.outstanding(rows),
    view = Receivables.fromItems(rows),
    currency = outstanding.currency || view.currency;
  const cover = Object.create(null);
  let extra = [];
  const groups = perParty(view);
  Object.keys(groups).forEach((party) => {
    const covered = coverByReceipts(party, groups[party], outstanding.by_ref, Receivables, currency);
    Object.assign(cover, covered.cover);
    extra = extra.concat(covered.extra);
    if (covered.left > 0) out.unapplied_by_party[party] = covered.left;
  });
  Object.keys(outstanding.by_ref).forEach((ref) => {
    const bill = outstanding.by_ref[ref];
    if (bill.kind !== 'bill' || !(bill.outstanding_minor > 0)) return;
    const covered = cover[ref] || 0;
    out.by_ref[ref] = Object.assign({}, bill, { outstanding_minor: bill.outstanding_minor - covered, covered_minor: covered });
  });
  out.view = { currency: view.currency, debits: view.debits, credits: view.credits, allocations: view.allocations.concat(extra) };
  return out;
}

/**
 * outstanding per document (the engine's — by_party IS each party's balance, the figure the Collections list shows), then Schedule III ageing
 * (receivable six buckets, payable five) over the NETTED bills (netOpen): a receipt on account no longer ages the bill it will settle.
 * `open` is netOpen's answer — the route reads a party's open documents and its oldest due from it.
 */
function dues(items, asOf, side) {
  const Receivables = receivables(),
    Ledger = ledger();
  const rows = (items || []).filter(Boolean);
  if (!rows.length) return { outstanding: { by_ref: {}, by_party: {}, total_minor: 0 }, ageing: Ledger.ageing([], asOf, side), open: netOpen([]) };
  const outstanding = Receivables.outstanding(rows),
    open = netOpen(rows);
  const docs = Object.keys(open.by_ref)
    .map((ref) => open.by_ref[ref])
    .filter((bill) => bill.outstanding_minor > 0)
    .concat(
      Object.keys(open.unapplied_by_party).map((party) => ({ ref: 'unapplied:' + party, party, date: asOf, outstanding_minor: -open.unapplied_by_party[party] }))
    );
  return { outstanding, ageing: Ledger.ageing(docs, asOf, side), open };
}
/**
 * ⭐ earlyOffer(bill, asOf, currency, early) — the early-pay discount on what a bill still needs, in money: CBReceivables.earlyDiscount (pct % off when
 * paid within within_days of the bill's date) on open_minor; `by` = the last day it holds. ONE helper for both sides: Payables (the supplier's offer
 * to us, books-payables) and Collections (our terms to the customer, routes/books.js /dues?finance=1). null when the terms carry no offer.
 * → { pct, within_days, by, valid, save_minor, pay_minor } — words are the caller's (each side speaks to a different person).
 */
function earlyOffer(bill, asOf, currency, early) {
  const terms = early || null;
  if (!terms || !(Number(terms.pct) > 0) || !(Number(terms.within_days) > 0) || !bill || !bill.date) return null;
  const scale = minorScale(currency),
    open = Number(bill.open_minor || 0);
  const discount = receivables().earlyDiscount({ date: bill.date, amount: open / scale, currency }, asOf, {
    on: true,
    pct: Number(terms.pct),
    within_days: Number(terms.within_days),
    currency
  });
  const save = discount && discount.eligible ? Math.round(Number(discount.amount) * scale) : 0;
  return {
    pct: Number(terms.pct),
    within_days: Number(terms.within_days),
    by: addDays(bill.date, Number(terms.within_days)),
    valid: !!(discount && discount.eligible) && save > 0,
    save_minor: save,
    pay_minor: open - save
  };
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
  const M = require('./money'),
    R = receivables(),
    f = Math.pow(10, M.decimals ? M.decimals(cur) : 2);
  let t = 0;
  (docs || []).forEach((item) => {
    const r = R.interestDue({ balance: item.outstanding_minor / f, due: item.due_date || item.date, currency: cur }, asOf, opt);
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
  return {
    credit_limit_minor: lim.value == null ? null : Number(lim.value),
    credit_limit_from: lim.value == null ? null : lim.from,
    over_limit: c.over,
    last_remind: null
  };
}

module.exports = {
  load,
  inject,
  reset,
  status,
  posting,
  packs,
  receivables,
  ledger,
  bookpack,
  period,
  chartRows,
  shopAccounts,
  packWith,
  interestMinor,
  interestState,
  limitView,
  groupCode,
  lineOf,
  balanceOf,
  itemOf,
  itemRow,
  dues,
  netOpen,
  earlyOffer,
  ymd,
  addDays,
  NAMES
};
