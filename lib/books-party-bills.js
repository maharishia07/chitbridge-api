'use strict';
/**
 * lib/books-party-bills.js — THE BILLS OF ONE PARTY, as a page (W15-107): what the Receivables / Payables row opens to.
 * OWNER     cb-finance
 * RISK      money
 * OWNS      read(h, e, req, opt) → { bills: a page, total (the filtered count), page, limit, counts { open, paid, all }, owed_minor, bands { key: minor }, on_account_minor, mark_actions, checks }
 * CALLED BY routes/books.js GET /party/:id/bills
 * FLOW      the party's items (ONE read) ──▶ books-engines.dues (the NETTED bills: the one due figure) ──▶ billBands (each bill's band and days past due, the follow-up set — the same engine as the party's chips)
 *           ──▶ filter (open by default · a band · a status) ──▶ sort ──▶ the page ──▶ bill-checks.attach (the Day book's own mark and "No tax invoice" flag, ONE read for the page)
 * CARD      16-finance/collections-and-dues
 * ⭐ ONE AGEING: the band and the days late are books-engines.billBands, which ages the same netted documents the party's `follow_up` chips age. Nothing is ordered or aged here.
 * ⭐ NEVER LOAD ALL: a page of bills (default 25, newest first), the counts of open / paid beside it; paid bills are not read until asked for (state=paid|all).
 */
const E = require('./books-engines'); const MO = require('./books-money-ops');
const S = require('./books-store');
const T = require('./finance-terms');
const pageLimit = require('./page-limit');

const Needs = require('./books-needs');

const STATES = ['open', 'paid', 'all', 'part', 'unpaid'];
const TABS = ['needs', 'open', 'all']; /* W15-115: Needs you · Open · All (Paid is a filter inside All) */
const SORTS = { date: (bill) => bill.date || '', due: (bill) => bill.due_date || '', days: (bill) => (bill.days_overdue == null ? -1 : bill.days_overdue), amount: (bill) => bill.amount_minor, owed: (bill) => bill.owed_minor, bill: (bill) => String(bill.bill_no || bill.ref) };
const PAGE_DEFAULT = 25,
  PAGE_MAX = 100;

/** a bill's standing from its own figures: paid (nothing owed) · part (less owed than the bill) · unpaid */
const standingOf = (amount, owed) => (owed <= 0 ? 'paid' : owed < amount ? 'part' : 'unpaid');

/** the question as the route read it → { state, band, sort, dir } or throws a plain refusal */
function askOf(query) {
  const tab = TABS.includes(query.tab) ? query.tab : null,
    state = tab === 'needs' || tab === 'open' ? 'open' : STATES.includes(query.state) ? query.state : tab === 'all' ? 'all' : 'open',
    sort = Object.prototype.hasOwnProperty.call(SORTS, query.sort) ? query.sort : tab === 'needs' ? 'urgent' : 'date',
    dir = query.dir === 'asc' ? 1 : -1;
  return { tab, state, sort, dir, band: query.band ? String(query.band) : null, why: Needs.KINDS.includes(query.why) ? query.why : null };
}
/** the Needs you order: the most days late first, then the largest still owed (a bill not yet due after those that are late) */
const urgent = (first, second) => (second.days_overdue == null ? -1 : second.days_overdue) - (first.days_overdue == null ? -1 : first.days_overdue) || second.owed_minor - first.owed_minor;

/** one bill of the party as a row: its figures, standing and band (the band is books-engines.billBands, null for a bill not open) */
function billRow(doc, owed, band) {
  const amount = Math.abs(Number(doc.bill_minor != null ? doc.bill_minor : doc.outstanding_minor));
  return {
    against_ref: doc.ref,
    date: doc.date || null,
    due_date: doc.due_date || null,
    amount_minor: amount,
    owed_minor: owed,
    status: standingOf(amount, owed),
    days_overdue: band ? band.days_late : null,
    band: band && band.band,
    no_terms: !!(band && band.no_terms),
    disputed: !!doc.disputed
  };
}
/** the rows the question asks for (tab, reason chip, band, state), in the question's order (the Needs you order, or the chosen column; ties by date then ref) */
function wantedOf(rows, ask) {
  const wanted = rows.filter((row) => {
    if (ask.tab === 'needs' && !row.reasons.length) return false;
    if (ask.why && !row.reasons.includes(ask.why)) return false; /* a chip on the party's row: only the bills with THAT reason */
    if (ask.band && row.band !== ask.band) return false;
    if (ask.state === 'open') return row.owed_minor > 0;
    if (ask.state === 'all') return true;
    return row.status === ask.state;
  });
  const key = SORTS[ask.sort];
  wanted.sort((first, second) => {
    if (ask.sort === 'urgent') return urgent(first, second) || String(second.date || '').localeCompare(String(first.date || '')) || String(second.against_ref).localeCompare(String(first.against_ref));
    const x = key(first),
      y = key(second);
    return (x < y ? -1 : x > y ? 1 : 0) * ask.dir || String(second.date || '').localeCompare(String(first.date || '')) || String(second.against_ref).localeCompare(String(first.against_ref));
  });
  return wanted;
}

/**
 * read(h, e, req, opt) — opt = { party, side: 'customer'|'supplier', asOf, pack, cur, query }. The caller has the gates; this is the read.
 * A supplier's bill is aged by its own due date (no customer terms), a customer's by its own, else the party's credit days, else the shop's (the /dues rule).
 */
async function read(h, e, req, opt) {
  const ask = askOf(opt.query || {}),
    pg = pageLimit.pageArgs({ page: (opt.query || {}).page, limit: (opt.query || {}).limit || PAGE_DEFAULT }, PAGE_DEFAULT, PAGE_MAX);
  const role = opt.side === 'supplier' ? 'creditors' : 'debtors',
    sideWord = opt.side === 'supplier' ? 'payable' : 'receivable';
  const account = (await S.accounts(h, e)).find((row) => row.role === role);
  const items = account ? (await S.items(h, e, opt.party, account.account_id)).filter((item) => (item.doc_date ? String(E.ymd(item.doc_date)) <= opt.asOf : true)).map(E.itemOf) : [];
  const dues = E.dues(items, opt.asOf, sideWord, { pack: opt.pack, creditDaysOf: () => null });
  const open = dues.open.by_ref;
  let creditDaysOf = () => null;
  if (role === 'debtors') {
    const terms = await T.customerTerms(h, e);
    creditDaysOf = (pid) => T.resolve(terms.shop, terms.by_party.get(String(pid)) || {}).credit_days.value;
  }
  const docs = Object.keys(open).map((ref) => open[ref]).filter((doc) => doc.outstanding_minor > 0),
    bands = E.billBands(docs, opt.asOf, creditDaysOf, sideWord);
  const all = Object.keys(dues.outstanding.by_ref)
    .map((ref) => dues.outstanding.by_ref[ref])
    .filter((doc) => doc.kind === 'bill');
  const owedOf = (doc) => (open[doc.ref] ? open[doc.ref].outstanding_minor : 0);
  const rows = all.map((doc) => billRow(doc, owedOf(doc), bands[doc.ref] || null));
  /* W15-115: why each OPEN bill wants you — the one list of reasons (books-needs), asked once for the party's open bills */
  const entryOf = new Map(items.filter((item) => item.ref === item.against_ref && item.entry_id).map((item) => [String(item.ref), item.entry_id]));
  const needing = await Needs.partyNeeds(h, e, req, { pack: opt.pack, cur: opt.cur, supplier: role === 'creditors' }, rows.filter((row) => row.owed_minor > 0).map((row) => ({ ref: row.against_ref, party: opt.party, entry_id: entryOf.get(String(row.against_ref)) || null, owed_minor: row.owed_minor, disputed: row.disputed, no_terms: row.no_terms, days_overdue: row.days_overdue })));
  rows.forEach((row) => {
    row.reasons = needing.reasons.get(row.against_ref) || [];
    row.why = row.reasons[0] || null;
    row.action = row.why ? Needs.ACTION[row.why] : null;
  });
  const counts = { needs: rows.filter((row) => row.reasons.length).length, open: rows.filter((row) => row.owed_minor > 0).length, paid: rows.filter((row) => row.owed_minor <= 0).length, all: rows.length };
  counts.in_order = counts.open - counts.needs;
  const wanted = wantedOf(rows, ask);
  const page = wanted.slice(pg.offset, pg.offset + pg.limit);
  /* the bill numbers and the Day book's own marks + flag for THIS page only */
  const numbers = await S.billNos(h, e, page.map((row) => row.against_ref));
  const entries = new Map(items.filter((item) => item.ref === item.against_ref).map((item) => [String(item.ref), item]));
  const marking = await require('./bill-checks').attach(h, e, req, { items: items.map((item) => ({ ref: item.ref, against_ref: item.against_ref, entry_id: item.entry_id, amount_minor: item.amount_minor, doc_date: item.date })), proposal: page }, { pack: opt.pack, cur: opt.cur });
  page.forEach((row) => {
    row.bill_no = numbers[row.against_ref] || null;
    row.ref = row.against_ref;
    delete row.bill_minor;
    delete row.bill_date;
    delete row.against_ref;
  });
  const bandTotals = {};
  docs.forEach((doc) => {
    const band = bands[doc.ref] && bands[doc.ref].band;
    if (band) bandTotals[band] = (bandTotals[band] || 0) + doc.outstanding_minor;
  });
  return Object.assign(
    { currency: opt.cur, party_id: opt.party, side: opt.side, asOf: opt.asOf, tab: ask.tab, why: ask.why, state: ask.state, band: ask.band, sort: ask.sort, bills: page, counts, owed_minor: MO.sumMinor(docs, opt.cur, (doc) => doc.outstanding_minor), bands: bandTotals, on_account_minor: MO.sumMinor(Object.values(dues.open.unapplied_by_party), opt.cur), mark_actions: marking.mark_actions, checks: true },
    { total: wanted.length, page: pg.page, limit: pg.limit }
  );
}

module.exports = { read, STATES, TABS, SORTS, standingOf };
