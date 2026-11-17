/**
 * books-dues.js — who owes whom, by age: the ONE dues read (REQ-MIS-SHOWCASE critic finding 8, A2).
 * OWNER     cb-finance
 * RISK      money
 * OWNS      read(h, e, o) (the parties' netted dues, ageing, needs, terms and payables inside the caller's handle) · agedTotals · pageExtras · termsFigures · termsReaders · earlyOfferRow · withBalanceWords
 * CALLED BY routes/books.js GET /dues · (the owner's overview read, A3)
 * ⭐ MOVED, NOT COPIED: this is the body GET /dues ran in its route; what it answers is unchanged (tests/books-dues-core.test.cjs). The seat rule (forReader) stays with the caller.
 */
'use strict';
const CLOCK = require('./shop-clock');
const B = require('./books');
const E = require('./books-engines');
const MO = require('./books-money-ops');
const S = require('./books-store');
const Needs = require('./books-needs');

/**
 * R76: the early-pay offer the customer's TERMS make, in money, on the oldest netted bill still inside its window — books-engines.earlyOffer
 * (CBReceivables.earlyDiscount on what is owed). null = no offer in the terms, or none still valid; `words` are the shopkeeper's line.
 */
function earlyOfferRow(docs, asOf, currency, early) {
  const money = (minor) => require('../lib/bill-privacy').money(minor, currency);
  const open = (docs || []).filter((doc) => doc.outstanding_minor > 0 && !doc.disputed).sort((first, second) => String(first.date || '').localeCompare(String(second.date || '')));
  for (const doc of open) {
    const offer = E.earlyOffer({ date: doc.date, open_minor: doc.outstanding_minor }, asOf, currency, early);
    if (offer && offer.valid) return Object.assign(offer, { ref: doc.ref, words: 'Pays ' + money(offer.pay_minor) + ' by ' + B.dateWords(offer.by) + ' · saves ' + money(offer.save_minor) });
  }
  return null;
}
/** FIN-R1 + R76: the figures a customer's TERMS put on a Collections row — interest SHOWN (never posted), its state code, and the early-pay offer */
function termsFigures(docs, asOf, currency, effective) {
  return {
    interest_minor: E.interestMinor(docs, asOf, currency, effective && effective.interest.value),
    interest_state: E.interestState(effective),
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
    const mine = rows.filter((row) => row.side === want);
    return Object.assign(E.followTotal(mine), { balance_minor: MO.sumMinor(mine, cur, (row) => row.balance_minor) }); /* the Total column's figure: the rows' balances, signed as the rows are (a supplier's is negative) */
  };
  return { customer: one('customer', 'debtors'), supplier: one('supplier', 'creditors') };
}
/** what sits beside the parties on the page: the Payables total (F4) and, on a Collections read, the follow-up total (FIN-72: what customers owe, by days late — a supplier row adds nothing) — nothing else is added */
function pageExtras(collections, payables, rows, sides, cur) {
  return Object.assign({}, payables ? { payables } : {}, collections ? { follow_up_total: E.followTotal(rows.filter((row) => row.side !== 'supplier')) } : {}, { aged_totals: agedTotals(rows, sides, cur) });
}
/** FIN-60: a /dues row with its standing in words, the payment outcome's own function (B.owesWords; + they owe you) — said once the rows are netted */
const withBalanceWords = (currency) => (row) => Object.assign(row, { balance_words: B.owesWords(row.balance_minor, currency) });

/**
 * read(h, e, o) → { rows, payables } — o: { req (the request: the shop's books, its clock, the marks door), fin, pay, sides (['debtors'] | ['creditors'] | both), asOf, partyNames(h, e, ids) → Map }.
 * One read inside the caller's handle; the rows are the page's parties, the biggest first.
 */
async function read(h, e, o) {
  const { req, fin, pay, sides, asOf, partyNames } = o;
  const curOf = (r) => B.curOf(r.books),
    today = (r) => CLOCK.today(r && r.books);
  let payables = null;
    const chart = await S.accounts(h, e),
      lookup = new Map();
    /* FIN-new-1 (decided by practice: Xero, QuickBooks and SAP age by document date): "as at asOf" is every document DATED on or before asOf, and every payment dated on or before it —
       the row's own day (party_item.doc_date), never the moment it was recorded. A row with no document date falls back to the shop's day of its recording (one moment compared, PERF1). */
    const cut = Date.parse(require('../lib/books-hooks').dayBounds(asOf, req.books).to);
    const asOfDay = (item) => (item.date ? String(item.date) <= asOf : new Date(item.created_at).getTime() < cut);
    /* FIN-R1: interest and limit come from the customer's TERMS (finance-terms.resolve: own, else the shop default, else not set) — one grouped read */
    const T = require('../lib/finance-terms');
    /* W15-94: the customer terms are read on EVERY dues read (not only Collections), so a bill with no due date ages by the same credit days on every screen */
    const terms = sides.includes('debtors') ? await T.customerTerms(h, e) : null;
    const { effOf, followOpt } = termsReaders(T, terms);
    const noDays = { creditDaysOf: () => null }; /* a supplier's bill is aged by its own due date (the books write one), never by the shop's customer terms */
    let payableItems = [];
    for (const role of sides) {
      const a = chart.find((x) => x.role === role);
      if (!a) continue;
      const side = role === 'creditors' ? 'payable' : 'receivable',
        sign = role === 'creditors' ? -1 : 1;
      /* created_at is a MOMENT: its day is the shop's (dayOf), never E.ymd — that reads `date` columns */
      /* GROWTH5Y: "as at today" reads the OPEN documents only (S.openItems — a paid bill and its receipts are not read); a past day reads every row, as a bill paid since was open then */
      const items = (asOf >= today(req) ? await S.openItems(h, e, a.account_id, asOf) : await S.items(h, e, null, a.account_id)).map(E.itemOf).filter(asOfDay);
      const d = E.dues(items, asOf, side, Object.assign({ pack: B.packOf(req.books) }, role === 'debtors' ? followOpt || noDays : noDays));
      if (role === 'creditors') payableItems = items;
      const byRef = d.open.by_ref || {}; /* the NETTED bills — the one due figure (see above) */
      /* PERF1: each party's open documents, grouped ONCE — the filter over every document ran once per party (251 × 15k at 100k lines) */
      const docsOf = new Map();
      Object.keys(byRef).forEach((item) => {
        const x = byRef[item];
        if (!(x.outstanding_minor > 0)) return;
        const p = String(x.party);
        if (!docsOf.has(p)) docsOf.set(p, []);
        docsOf.get(p).push(x);
      });
      /* W15-114: who needs you, and why — ONE read per side (lib/books-needs: the flag, the open marks, the bill's own age), the party's counts beside its balance */
      const entryOfRef = new Map(items.filter((item) => item.ref === item.against_ref && item.entry_id).map((item) => [String(item.ref), item.entry_id]));
      const everyDoc = [...docsOf.values()].reduce((all, docs) => all.concat(docs), []);
      const billAge = E.billBands(everyDoc, asOf, role === 'debtors' ? (followOpt || noDays).creditDaysOf : noDays.creditDaysOf, side);
      const needs = await Needs.partyNeeds(h, e, req, { pack: B.packOf(req.books), cur: curOf(req), supplier: role === 'creditors' }, everyDoc.map((doc) => ({
        ref: doc.ref, party: doc.party, entry_id: entryOfRef.get(String(doc.ref)) || null, owed_minor: doc.outstanding_minor, disputed: !!((d.outstanding.by_ref[doc.ref] || doc).disputed),
        no_terms: !!(billAge[doc.ref] && billAge[doc.ref].no_terms), days_overdue: billAge[doc.ref] ? billAge[doc.ref].days_late : null
      })));
      Object.keys(d.ageing.by_party || {})
        .concat(Object.keys(d.outstanding.by_party || {}))
        .forEach((pid) => {
          if (lookup.has(pid + '|' + role)) return;
          const ag = d.ageing.by_party[pid] || { undisputed: {}, disputed: {}, total_minor: 0 };
          const open = Number((d.outstanding.by_party || {})[pid] || 0);
          const docs = docsOf.get(String(pid)) || [];
          if (open === 0 && !docs.length && !Number(ag.total_minor || 0)) return; /* E15: a party whose bills are all settled owes nothing and holds nothing open: not a row of Who owes whom */
          const oldest =
            docs
              .map((x) => x.due_date || x.date)
              .filter(Boolean)
              .sort()[0] || null;
          /* ADDITIVE keep: web main still reads p.buckets (cap-books.js); the SAME ageing as before, filled from d.ageing; its removal is a later change made with its web twin */
          const buckets = {};
          Object.keys(ag.undisputed || {}).forEach((item) => {
            buckets[item] = sign * ((ag.undisputed[item] || 0) + ((ag.disputed || {})[item] || 0));
          });
          const disputed = MO.sumMinor(Object.keys(ag.disputed || {}), curOf(req), (item) => ag.disputed[item]);
          const row = {
            party_id: pid,
            side: role === 'creditors' ? 'supplier' : 'customer',
            balance_minor: sign * open,
            oldest_due: oldest,
            disputed_minor: sign * disputed,
            buckets
          };
          row.follow_up = E.followRow(d.follow, pid); /* W15-94: the ONE ageing — days past due, both sides, every read */
          row.needs = Object.assign(Needs.empty(), needs.by_party.get(String(pid)) || {});
          if (fin && role === 'debtors') Object.assign(row, termsFigures(docs, asOf, curOf(req), effOf(pid)));
          lookup.set(pid + '|' + role, row);
        });
    }
    /* the names of the parties with dues — PERF1: only those, read from the shop's own lists (never the platform's identities) */
    const names = await partyNames(
      h,
      e,
      Array.from(lookup.values())
        .map((item) => item.party_id)
        .concat(payableItems.map((item) => item.party))
    );
    /* one row per party: a party on both lists nets (what they owe you less what you owe them) */
    const rows = new Map();
    for (const r of lookup.values()) {
      const p = names.get(String(r.party_id)) || {};
      const x = rows.get(r.party_id);
      if (!x)
        rows.set(
          r.party_id,
          Object.assign({ party_no: p.party_no || null, name: p.nickname || p.name || null }, r, fin ? E.limitView(effOf(r.party_id), r) : {})
        );
      else {
        x.balance_minor += r.balance_minor;
        x.disputed_minor += r.disputed_minor;
        Object.keys(r.needs).forEach((key) => (x.needs[key] = (x.needs[key] || 0) + r.needs[key])); /* a party on both lists: what needs you on either */
        x.side = 'both';
        if (r.side === 'customer') x.follow_up = r.follow_up; /* a both-sides row ages what the customer half owes (as before) */
        x.oldest_due = [x.oldest_due, r.oldest_due].filter(Boolean).sort()[0] || null;
        Object.keys(r.buckets).forEach((item) => {
          x.buckets[item] = (x.buckets[item] || 0) + r.buckets[item];
        });
        if (fin) {
          if (r.interest_minor != null) {
            x.interest_minor = (x.interest_minor || 0) + r.interest_minor;
            x.interest_state = r.interest_state;
          }
          Object.assign(x, E.limitView(effOf(r.party_id), x));
        }
      }
    }
    /* FX1: a party with a foreign-currency balance shows it beside the books' figure — "USD 1,000 · ₹83,250" (b392; one grouped read; absent before b392 and for a party with none) */
    if (await S.fxLinesReady()) {
      const ids = sides.map((role) => (chart.find((x) => x.role === role) || {}).account_id).filter(Boolean);
      const fx = ids.length ? await S.foreignBalances(h, e, { asOf, functional: curOf(req), account_ids: ids }) : [];
      for (const f of fx) {
        const r = rows.get(f.party_id);
        if (!r) continue;
        const have = (r.foreign = r.foreign || []).find((x) => x.currency === f.txn_currency);
        if (have) {
          have.balance_minor += f.txn_minor;
          have.carried_minor += f.fn_minor;
        } else r.foreign.push({ currency: f.txn_currency, balance_minor: f.txn_minor, carried_minor: f.fn_minor });
      }
    }
    if (pay) {
      const nestedP = require('../lib/books-payables'),
        more = await nestedP.read(h, e);
      const v = nestedP.view({
        asOf,
        currency: curOf(req),
        country: req.books && req.books.country,
        payable_items: payableItems,
        cheques: more.cheques,
        names,
        msme: more.msme,
        terms: more.terms,
        chart
      });
      for (const r of rows.values()) r.payable = v.by_party[String(r.party_id)] || null;
      payables = { total_minor: v.total_minor };
    }
    return { rows: require('../lib/upi-waiting').quietRows(Array.from(rows.values()).map(withBalanceWords(curOf(req))), e, fin).sort((first, second) => Math.abs(second.balance_minor) - Math.abs(first.balance_minor)), payables };
}
module.exports = { read, agedTotals, pageExtras, termsFigures, termsReaders, earlyOfferRow, withBalanceWords };
