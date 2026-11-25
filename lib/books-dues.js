/**
 * books-dues.js — who owes whom, by age: the ONE dues read (REQ-MIS-SHOWCASE critic finding 8, A2).
 * OWNER     cb-finance
 * RISK      money
 * OWNS      read(handle, e, opts) (the parties' netted dues, ageing, needs, terms and payables inside the caller's handle) · agedTotals · pageExtras · termsFigures · termsReaders · earlyOfferRow · withBalanceWords
 * CALLED BY routes/books.js GET /dues · (the owner's overview read, A3)
 * FLOW      handle + request → each side's netted items → ageing + needs → one row per party (books-dues-rows) → names → both-sides netting → FX → payables → rows, biggest first
 * CARD      16-finance/receivables-and-payables
 * ⭐ MOVED, NOT COPIED: this is the body GET /dues ran in its route; what it answers is unchanged (tests/books-dues-core.test.cjs). The seat rule (forReader) stays with the caller.
 */
'use strict';
const SideItems = require('./books-side-items');
const Books = require('./books');
const Engines = require('./books-engines');
const MoneyOps = require('./books-money-ops');
const Store = require('./books-store');
const Needs = require('./books-needs');
const Rows = require('./books-dues-rows');

/**
 * R76: the early-pay offer the customer's TERMS make, in money, on the oldest netted bill still inside its window — books-engines.earlyOffer
 * (CBReceivables.earlyDiscount on what is owed). null = no offer in the terms, or none still valid; `words` are the shopkeeper's line.
 */
function earlyOfferRow(docs, asOf, currency, early) {
  const money = (minor) => require('../lib/bill-privacy').money(minor, currency);
  const open = (docs || []).filter((doc) => doc.outstanding_minor > 0 && !doc.disputed).sort((first, second) => String(first.date || '').localeCompare(String(second.date || '')));
  for (const doc of open) {
    const offer = Engines.earlyOffer({ date: doc.date, open_minor: doc.outstanding_minor }, asOf, currency, early);
    if (offer && offer.valid) return Object.assign(offer, { ref: doc.ref, words: 'Pays ' + money(offer.pay_minor) + ' by ' + Books.dateWords(offer.by) + ' · saves ' + money(offer.save_minor) });
  }
  return null;
}
/** FIN-R1 + R76: the figures a customer's TERMS put on a Collections row — interest SHOWN (never posted), its state code, and the early-pay offer */
function termsFigures(docs, asOf, currency, effective) {
  return {
    interest_minor: Engines.interestMinor(docs, asOf, currency, effective && effective.interest.value),
    interest_state: Engines.interestState(effective),
    early: earlyOfferRow(docs, asOf, currency, effective && effective.early.value)
  };
}
/**
 * FIN-R1 + FIN-72: the two readers of a customer's terms (null terms = not the Collections read): effOf(party) → what applies (own, else the shop's, else not set; null for a party
 * with no list row), and followOpt — the credit days a bill with NO due date is aged by in the follow-up view (the same resolver: own, else the shop's; a party with no list row has the shop's).
 */
function termsReaders(financeTerms, terms) {
  const effOf = (pid) => {
    const ownTerms = terms && terms.by_party.get(String(pid));
    return ownTerms ? financeTerms.resolve(terms.shop, ownTerms) : null;
  };
  const creditDaysOf = (pid) => financeTerms.resolve(terms.shop, terms.by_party.get(String(pid)) || {}).credit_days.value;
  return { effOf, followOpt: terms ? { creditDaysOf } : null };
}
/** W21: the aged table's total row per side, the SAME followTotal over the SAME follow_up (days past due: not_due · d0_30 · d31_60 · d61_90 · d90_plus); a side not asked for is null, never a zero */
function agedTotals(rows, sides, cur) {
  const one = (want, role) => {
    if (!sides.includes(role)) return null;
    const mine = rows.flatMap((row) => (row.side === 'both' && row.sides ? [row.sides[want]] : row.side === want ? [row] : [])).filter(Boolean); /* a both-sides party counts on each list with that list's own figure, so each total ties to its control ledger */
    return Object.assign(Engines.followTotal(mine), { balance_minor: MoneyOps.sumMinor(mine, cur, (row) => row.balance_minor) }); /* the Total column's figure: the rows' balances, signed as the rows are (a supplier's is negative) */
  };
  return { customer: one('customer', 'debtors'), supplier: one('supplier', 'creditors') };
}
/** what sits beside the parties on the page: the Payables total (F4) and, on a Collections read, the follow-up total (FIN-72: what customers owe, by days late — a supplier row adds nothing) — nothing else is added */
function pageExtras(collections, payables, rows, sides, cur) {
  return Object.assign({}, payables ? { payables } : {}, collections ? { follow_up_total: Engines.followTotal(rows.filter((row) => row.side !== 'supplier')) } : {}, { aged_totals: agedTotals(rows, sides, cur) });
}
/** FIN-60: a /dues row with its standing in words, the payment outcome's own function (Books.owesWords; + they owe you) — said once the rows are netted */
const withBalanceWords = (currency) => (row) => Object.assign(row, { balance_words: Books.owesWords(row.balance_minor, currency) });

/** the shop's chart account of one role (debtors | creditors); undefined when the books have none */
const accountOf = (chart, role) => chart.find((account) => account.role === role);

/**
 * FIN-new-1 (decided by practice: Xero, QuickBooks and SAP age by document date): "as at asOf" is every document DATED on or before asOf, and every payment dated on or before it —
 * the row's own day (party_item.doc_date), never the moment it was recorded. A row with no document date falls back to the shop's day of its recording (one moment compared, PERF1).
 */
function asOfFilter(asOf, shopSetting) {
  const cutoff = Date.parse(require('../lib/books-hooks').dayBounds(asOf, shopSetting).to);
  return (item) => (item.date ? String(item.date) <= asOf : new Date(item.created_at).getTime() < cutoff);
}

/** FIN-R1 + W15-94: the customer terms are read on EVERY dues read (not only Collections), so a bill with no due date ages by the same credit days on every screen */
async function termsOf(handle, e, sides) {
  const FinanceTerms = require('../lib/finance-terms');
  const terms = sides.includes('debtors') ? await FinanceTerms.customerTerms(handle, e) : null;
  return termsReaders(FinanceTerms, terms);
}

/** GROWTH5Y: "as at today" reads the OPEN documents only (a paid bill and its receipts are not read); a past day reads every row, as a bill paid since was open then */
async function sideItems(handle, e, ctx, account) {
  const rows = await SideItems.read(handle, e, ctx.req.books, ctx.asOf, account.account_id, true);
  return rows.map(Engines.itemOf).filter(ctx.onOrBefore);
}

/** W15-114: who needs you, and why — ONE read per side (lib/books-needs: the flag, the open marks, the bill's own age), the party's counts beside its balance */
async function needsOfSide(handle, e, ctx, role, items, dues, docsOf) {
  const { req } = ctx;
  const entryOfRef = new Map(items.filter((item) => item.ref === item.against_ref && item.entry_id).map((item) => [String(item.ref), item.entry_id]));
  const everyDoc = [...docsOf.values()].reduce((all, docs) => all.concat(docs), []);
  const billAge = Engines.billBands(everyDoc, ctx.asOf, ctx.ageOpts(role).creditDaysOf, role === 'creditors' ? 'payable' : 'receivable');
  const flagged = everyDoc.map((doc) => ({
    ref: doc.ref, party: doc.party, entry_id: entryOfRef.get(String(doc.ref)) || null, owed_minor: doc.outstanding_minor, disputed: !!((dues.outstanding.by_ref[doc.ref] || doc).disputed),
    no_terms: !!(billAge[doc.ref] && billAge[doc.ref].no_terms), days_overdue: billAge[doc.ref] ? billAge[doc.ref].days_late : null
  }));
  return Needs.partyNeeds(handle, e, req, { pack: Books.packOf(req.books), cur: ctx.currency, supplier: role === 'creditors' }, flagged);
}

/** one side's rows into the lookup (key partyId|role); returns the side's items (the creditors' are the payables' input) */
async function readSide(handle, e, ctx, role, account, lookup) {
  const items = await sideItems(handle, e, ctx, account);
  const dues = Engines.dues(items, ctx.asOf, role === 'creditors' ? 'payable' : 'receivable', Object.assign({ pack: Books.packOf(ctx.req.books) }, ctx.ageOpts(role)));
  const docsOf = Rows.openDocsByParty(dues.open.by_ref || {}); /* the NETTED bills — the one due figure */
  const needs = await needsOfSide(handle, e, ctx, role, items, dues, docsOf);
  ctx.listTotal[role] = MoneyOps.sumMinor(Object.values(dues.outstanding.by_party || {}), ctx.currency, (open) => Number(open || 0)) * (role === 'creditors' ? -1 : 1); /* the side's own list total, signed as the rows are */
  const partyIds = Object.keys(dues.ageing.by_party || {}).concat(Object.keys(dues.outstanding.by_party || {}));
  partyIds.forEach((partyId) => {
    if (lookup.has(partyId + '|' + role)) return;
    const docs = docsOf.get(String(partyId)) || [];
    const row = Rows.partyRow(ctx, role, partyId, dues, docs, needs);
    if (!row) return;
    if (ctx.fin && role === 'debtors') Object.assign(row, termsFigures(docs, ctx.asOf, ctx.currency, ctx.effOf(partyId)));
    lookup.set(partyId + '|' + role, row);
  });
  return items;
}

/** one row per party: a party on both lists nets (what they owe you less what you owe them) */
function onePerParty(lookup, names, ctx) {
  const rows = new Map();
  for (const row of lookup.values()) {
    const party = names.get(String(row.party_id)) || {};
    const have = rows.get(row.party_id);
    if (!have) rows.set(row.party_id, Object.assign({ party_no: party.party_no || null, name: party.nickname || party.name || null }, row, ctx.fin ? Engines.limitView(ctx.effOf(row.party_id), row) : {}));
    else Rows.mergeSides(have, row, ctx.fin ? ctx.effOf(row.party_id) : null, ctx.fin);
  }
  return rows;
}

/** FX1: the foreign-currency balances beside the books' figure (b392; one grouped read; absent before b392 and for a party with none) */
async function addForeign(handle, e, ctx, chart, rows) {
  if (!(await Store.fxLinesReady())) return;
  const ids = ctx.sides.map((role) => (accountOf(chart, role) || {}).account_id).filter(Boolean);
  const foreign = ids.length ? await Store.foreignBalances(handle, e, { asOf: ctx.asOf, functional: ctx.currency, account_ids: ids }) : [];
  Rows.mergeForeign(rows, foreign);
}

/** the payables total and each party's payable standing (F4); returns { total_minor } and sets row.payable */
async function addPayables(handle, e, ctx, chart, rows, names, payableItems) {
  const BooksPayables = require('../lib/books-payables');
  const more = await BooksPayables.read(handle, e);
  const view = BooksPayables.view({
    asOf: ctx.asOf,
    currency: ctx.currency,
    country: ctx.req.books && ctx.req.books.country,
    payable_items: payableItems,
    cheques: more.cheques,
    names,
    msme: more.msme,
    terms: more.terms,
    chart
  });
  for (const row of rows.values()) row.payable = view.by_party[String(row.party_id)] || null;
  return { total_minor: view.total_minor };
}

/**
 * FC-M10: each side's list total beside the trial balance's debtors / creditors control (the ONE trial-balance calculation, Books.trialBalance), the difference named:
 * { customer, supplier } each { list_minor, tb_minor, differs_minor } signed as the rows are (a supplier's is negative); differs_minor = list less trial balance, 0 = agrees; a side not asked for is null.
 */
async function controlOf(handle, e, ctx, chart) {
  const trialBal = await Books.trialBalance(handle, e, ctx.asOf);
  const balanceOf = (role) => {
    const account = ctx.sides.includes(role) && accountOf(chart, role);
    if (!account) return null;
    const row = (trialBal.rows || []).find((line) => String(line.code) === String(account.code)) || {};
    const tbMinor = Number(row.debit_minor || 0) - Number(row.credit_minor || 0); /* a debtor's balance is a debit, a creditor's a credit: the rows' own sign */
    const listMinor = ctx.listTotal[role] || 0;
    return { list_minor: listMinor, tb_minor: tbMinor, differs_minor: listMinor - tbMinor };
  };
  return { customer: balanceOf('debtors'), supplier: balanceOf('creditors') };
}

/**
 * read(handle, e, opts) → { rows, payables, tbControl } — opts: { control (FC-M10: add the trial-balance control), req (the request: the shop's books, its clock, the marks door), fin, pay, sides (['debtors'] | ['creditors'] | both), asOf, partyNames(handle, e, ids) → Map }.
 * One read inside the caller's handle; the rows are the page's parties, the biggest first.
 */
async function read(handle, e, opts) {
  const { req, sides, asOf, partyNames } = opts;
  const { fin: withFinance, pay: withPayables } = opts;
  const chart = await Store.accounts(handle, e);
  const readers = await termsOf(handle, e, sides);
  const noDays = { creditDaysOf: () => null }; /* a supplier's bill is aged by its own due date (the books write one), never by the shop's customer terms */
  const ctx = {
    req, fin: withFinance, sides, asOf, effOf: readers.effOf, currency: Books.curOf(req.books), onOrBefore: asOfFilter(asOf, req.books),
    ageOpts: (role) => (role === 'debtors' ? readers.followOpt || noDays : noDays), listTotal: {}
  };
  const lookup = new Map();
  let payableItems = [];
  for (const role of sides) {
    const account = accountOf(chart, role);
    if (!account) continue;
    const items = await readSide(handle, e, ctx, role, account, lookup);
    if (role === 'creditors') payableItems = items;
  }
  /* the names of the parties with dues — PERF1: only those, read from the shop's own lists (never the platform's identities) */
  const names = await partyNames(handle, e, Array.from(lookup.values()).map((item) => item.party_id).concat(payableItems.map((item) => item.party)));
  const rows = onePerParty(lookup, names, ctx);
  await addForeign(handle, e, ctx, chart, rows);
  const payables = withPayables ? await addPayables(handle, e, ctx, chart, rows, names, payableItems) : null;
  const shown = Array.from(rows.values()).map(withBalanceWords(ctx.currency));
  /* AC-F-02: a party whose document a locked month moved says so on its row, in the entry's own words (one sentence for every view) */
  const moved = await Store.movedByLock(handle, e);
  if (moved.length) shown.forEach((row) => { const hit = moved.find((item) => item.party_id && String(item.party_id) === String(row.party_id)); if (hit) row.posting_note = hit.entry_no + ' · ' + hit.words; });
  const tbControl = opts.control ? await controlOf(handle, e, ctx, chart) : undefined;
  return { rows: require('../lib/upi-waiting').quietRows(shown, e, withFinance).sort((first, second) => Math.abs(second.balance_minor) - Math.abs(first.balance_minor)), payables, tbControl };
}
module.exports = { read, agedTotals, pageExtras, controlOf, termsFigures, termsReaders, earlyOfferRow, withBalanceWords };
