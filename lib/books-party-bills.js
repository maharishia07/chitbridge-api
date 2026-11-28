'use strict';
/**
 * lib/books-party-bills.js — THE BILLS OF ONE PARTY, as a page (W15-107): what the Receivables / Payables row opens to.
 * OWNER     cb-finance
 * RISK      money
 * OWNS      read(handle, e, req, opt) → { bills: a page, total (the filtered count), page, limit, counts { open, paid, all }, owed_minor, bands { key: minor }, on_account_minor, mark_actions, checks }
 * CALLED BY routes/books.js GET /party/:id/bills
 * FLOW      the party's items (ONE read) ──▶ books-engines.dues (the NETTED bills: the one due figure) ──▶ billBands (each bill's band and days past due, the follow-up set — the same engine as the party's chips)
 *           ──▶ filter (open by default · a band · a status) ──▶ sort ──▶ the page ──▶ bill-checks.attach (the Day book's own mark and "No tax invoice" flag, ONE read for the page)
 * CARD      16-finance/collections-and-dues
 * ⭐ ONE AGEING: the band and the days late are books-engines.billBands, which ages the same netted documents the party's `follow_up` chips age. Nothing is ordered or aged here.
 * ⭐ NEVER LOAD ALL: a page of bills (default 25, newest first), the counts of open / paid beside it; paid bills are not read until asked for (state=paid|all).
 */
const Engines = require('./books-engines');
const MoneyOps = require('./books-money-ops');
const Store = require('./books-store');
const FinanceTerms = require('./finance-terms');
const pageLimit = require('./page-limit');

const Needs = require('./books-needs');

const STATES = ['open', 'paid', 'all', 'part', 'unpaid'];
const TABS = ['needs', 'open', 'all']; /* W15-115: Needs you · Open · All (Paid is a filter inside All) */
const SORTS = { date: (bill) => bill.date || '', due: (bill) => bill.due_date || '', days: (bill) => (bill.days_overdue == null ? -1 : bill.days_overdue), amount: (bill) => bill.amount_minor, owed: (bill) => bill.owed_minor, bill: (bill) => String(bill.bill_no || bill.ref) };
const PAGE_DEFAULT = 25,
  PAGE_MAX = 100;

/** a bill's standing from its own figures: paid (nothing owed) · part (less owed than the bill) · unpaid */
const standingOf = (amount, owed) => (owed <= 0 ? 'paid' : owed < amount ? 'part' : 'unpaid');

/** the state a question asks for: a tab fixes it (Needs you and Open show the open bills, All shows all), else the state word, else open */
function stateAsked(tab, query) {
  if (tab === 'needs' || tab === 'open') return 'open';
  if (STATES.includes(query.state)) return query.state;
  return tab === 'all' ? 'all' : 'open';
}
/** the sort a question asks for: a sort the table has, else the Needs you order on that tab, else by date */
function sortAsked(tab, query) {
  if (Object.prototype.hasOwnProperty.call(SORTS, query.sort)) return query.sort;
  return tab === 'needs' ? 'urgent' : 'date';
}
/** the question as the route read it → { state, band, sort, dir } or throws a plain refusal */
function questionOf(query) {
  const tab = TABS.includes(query.tab) ? query.tab : null,
    state = stateAsked(tab, query),
    sort = sortAsked(tab, query),
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
    overdue: !!(band && band.overdue),
    band: band && band.band,
    no_terms: !!(band && band.no_terms),
    disputed: !!doc.disputed
  };
}
/** does a bill row belong to the question: the tab, the reason chip, the band, the state */
function wantsRow(row, question) {
  if (question.tab === 'needs' && !row.reasons.length) return false;
  if (question.why && !row.reasons.includes(question.why)) return false; /* a chip on the party's row: only the bills with THAT reason */
  if (question.band && row.band !== question.band) return false;
  if (question.state === 'open') return row.owed_minor > 0;
  if (question.state === 'all') return true;
  return row.status === question.state;
}
/** the tie-break of every order: the newer bill first, then the larger reference first */
const newestThenRef = (first, second) => String(second.date || '').localeCompare(String(first.date || '')) || String(second.against_ref).localeCompare(String(first.against_ref));
/** the order of the page: the Needs you order, or the chosen column; ties by date then ref */
function compareRows(question, key) {
  return (first, second) => {
    if (question.sort === 'urgent') return urgent(first, second) || newestThenRef(first, second);
    const x = key(first),
      y = key(second);
    return (x < y ? -1 : x > y ? 1 : 0) * question.dir || newestThenRef(first, second);
  };
}
/** the rows the question asks for (tab, reason chip, band, state), in the question's order (the Needs you order, or the chosen column; ties by date then ref) */
function wantedOf(rows, question) {
  const wanted = rows.filter((row) => wantsRow(row, question));
  wanted.sort(compareRows(question, SORTS[question.sort]));
  return wanted;
}

/** the party's items on the side's control account, as the engines read them (one read; a document dated after asOf is not in the picture) */
async function itemsOf(handle, e, opt, role) {
  const account = (await Store.accounts(handle, e)).find((row) => row.role === role);
  if (!account) return [];
  const rows = await Store.items(handle, e, opt.party, account.account_id);
  return rows.filter((item) => (item.doc_date ? String(Engines.ymd(item.doc_date)) <= opt.asOf : true)).map(Engines.itemOf);
}

/** a customer's bill is aged by its own due date, else the party's credit days, else the shop's (the /dues rule); a supplier's by its own date only */
async function creditDaysResolver(handle, e, role) {
  if (role !== 'debtors') return () => null;
  const terms = await FinanceTerms.customerTerms(handle, e);
  return (partyId) => FinanceTerms.resolve(terms.shop, terms.by_party.get(String(partyId)) || {}).credit_days.value;
}

/** W15-115: why each OPEN bill wants you — the one list of reasons (books-needs), asked once for the party's open bills; sets reasons, why and action on every row */
async function addReasons(handle, e, req, opt, role, items, rows) {
  const entryOf = new Map(items.filter((item) => item.ref === item.against_ref && item.entry_id).map((item) => [String(item.ref), item.entry_id]));
  const openRows = rows.filter((row) => row.owed_minor > 0).map((row) => ({
    ref: row.against_ref, party: opt.party, entry_id: entryOf.get(String(row.against_ref)) || null, owed_minor: row.owed_minor, disputed: row.disputed, no_terms: row.no_terms, overdue: row.overdue, days_overdue: row.days_overdue
  }));
  const needing = await Needs.partyNeeds(handle, e, req, { pack: opt.pack, cur: opt.cur, supplier: role === 'creditors' }, openRows);
  rows.forEach((row) => {
    row.reasons = needing.reasons.get(row.against_ref) || [];
    row.why = row.reasons[0] || null;
    row.action = row.why ? Needs.ACTION[row.why] : null;
  });
}

/** the bill numbers and the Day book's own marks + flag for THIS page only; the page rows end in their published shape (ref, bill_no) */
async function decoratePage(handle, e, req, opt, items, page) {
  const numbers = await Store.billNos(handle, e, page.map((row) => row.against_ref));
  const docItems = items.map((item) => ({ ref: item.ref, against_ref: item.against_ref, entry_id: item.entry_id, amount_minor: item.amount_minor, doc_date: item.date }));
  const marking = await require('./bill-checks').attach(handle, e, req, { items: docItems, proposal: page }, { pack: opt.pack, cur: opt.cur });
  page.forEach((row) => {
    row.bill_no = numbers[row.against_ref] || null;
    row.ref = row.against_ref;
    delete row.bill_minor;
    delete row.bill_date;
    delete row.against_ref;
  });
  return marking;
}

/** what is owed, by follow-up band: { band: minor } over the open documents */
function bandTotalsOf(docs, bands) {
  const totals = {};
  docs.forEach((doc) => {
    const band = bands[doc.ref] && bands[doc.ref].band;
    if (band) totals[band] = (totals[band] || 0) + doc.outstanding_minor;
  });
  return totals;
}

/** the counts beside the page: Needs you · Open · Paid · All, and what is open but in order */
function countsOf(rows) {
  const counts = { needs: rows.filter((row) => row.reasons.length).length, open: rows.filter((row) => row.owed_minor > 0).length, paid: rows.filter((row) => row.owed_minor <= 0).length, all: rows.length };
  counts.in_order = counts.open - counts.needs;
  return counts;
}

/**
 * read(handle, e, req, opt) — opt = { party, side: 'customer'|'supplier', asOf, pack, cur, query }. The caller has the gates; this is the read.
 * A supplier's bill is aged by its own due date (no customer terms), a customer's by its own, else the party's credit days, else the shop's (the /dues rule).
 */
async function read(handle, e, req, opt) {
  const question = questionOf(opt.query || {}),
    paging = pageLimit.pageArgs({ page: (opt.query || {}).page, limit: (opt.query || {}).limit || PAGE_DEFAULT }, PAGE_DEFAULT, PAGE_MAX);
  const role = opt.side === 'supplier' ? 'creditors' : 'debtors',
    sideWord = opt.side === 'supplier' ? 'payable' : 'receivable';
  const items = await itemsOf(handle, e, opt, role);
  const dues = Engines.dues(items, opt.asOf, sideWord, { pack: opt.pack, creditDaysOf: () => null });
  const open = dues.open.by_ref;
  const creditDaysOf = await creditDaysResolver(handle, e, role);
  const docs = Object.keys(open).map((ref) => open[ref]).filter((doc) => doc.outstanding_minor > 0),
    bands = Engines.billBands(docs, opt.asOf, creditDaysOf, sideWord);
  const all = Object.keys(dues.outstanding.by_ref)
    .map((ref) => dues.outstanding.by_ref[ref])
    .filter((doc) => doc.kind === 'bill');
  const owedOf = (doc) => (open[doc.ref] ? open[doc.ref].outstanding_minor : 0);
  const rows = all.map((doc) => billRow(doc, owedOf(doc), bands[doc.ref] || null));
  await addReasons(handle, e, req, opt, role, items, rows);
  const counts = countsOf(rows);
  const wanted = wantedOf(rows, question);
  const page = wanted.slice(paging.offset, paging.offset + paging.limit);
  const marking = await decoratePage(handle, e, req, opt, items, page);
  const standing = { currency: opt.cur, party_id: opt.party, side: opt.side, asOf: opt.asOf, tab: question.tab, why: question.why, state: question.state, band: question.band, sort: question.sort };
  return Object.assign(
    standing,
    { bills: page, counts, owed_minor: MoneyOps.sumMinor(docs, opt.cur, (doc) => doc.outstanding_minor), bands: bandTotalsOf(docs, bands), on_account_minor: MoneyOps.sumMinor(Object.values(dues.open.unapplied_by_party), opt.cur), mark_actions: marking.mark_actions, checks: true },
    { total: wanted.length, page: paging.page, limit: paging.limit }
  );
}

module.exports = { read, STATES, TABS, SORTS, standingOf };
