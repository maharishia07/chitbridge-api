/**
 * books-dues-rows.js — the per-party row of the dues read: build it from one side's ageing, merge a party's two sides into one row (split out of books-dues.js, behaviour unchanged).
 * OWNER     cb-finance
 * RISK      money
 * OWNS      openDocsByParty · partyRow(ctx, role, partyId, dues, docs, needs) · mergeSides(into, other, effectiveTerms, withTerms) · mergeForeign(rows, foreignBalances)
 * CALLED BY lib/books-dues.js read (the one dues read)
 * FLOW      one side's netted dues + needs → partyRow → the lookup of rows → mergeSides folds a party on both lists into one row → mergeForeign adds the foreign-currency balances
 * CARD      16-finance/receivables-and-payables
 */
'use strict';
const Books = require('./books');
const Engines = require('./books-engines');
const MoneyOps = require('./books-money-ops');
const Needs = require('./books-needs');

/** PERF1: each party's open documents, grouped ONCE — the filter over every document ran once per party (251 × 15k at 100k lines) */
function openDocsByParty(byRef) {
  const docsOf = new Map();
  Object.keys(byRef).forEach((ref) => {
    const doc = byRef[ref];
    if (!(doc.outstanding_minor > 0)) return;
    const partyId = String(doc.party);
    if (!docsOf.has(partyId)) docsOf.set(partyId, []);
    docsOf.get(partyId).push(doc);
  });
  return docsOf;
}

/** the oldest due date (else document date) among a party's open documents; null when it has none */
function oldestDueOf(docs) {
  return (
    docs
      .map((doc) => doc.due_date || doc.date)
      .filter(Boolean)
      .sort()[0] || null
  );
}

/** ADDITIVE keep: web main still reads p.buckets (cap-books.js); the SAME ageing as before, filled from the dues' ageing, signed by side */
function bucketsOf(aged, sign) {
  const buckets = {};
  Object.keys(aged.undisputed || {}).forEach((key) => {
    buckets[key] = sign * ((aged.undisputed[key] || 0) + ((aged.disputed || {})[key] || 0));
  });
  return buckets;
}

/** a party that owes nothing and holds nothing open: no open amount, no open document, nothing aged (E15) */
const isSettled = (open, docs, aged) => open === 0 && !docs.length && !Number(aged.total_minor || 0);
/**
 * one party's row on one side, or null when the party owes nothing and holds nothing open (E15: all bills settled is not a row of Who owes whom).
 * ctx: { currency }; role 'debtors' | 'creditors'; dues = books-engines dues(); needs = the side's partyNeeds() read.
 */
function partyRow(ctx, role, partyId, dues, docs, needs) {
  const sign = role === 'creditors' ? -1 : 1;
  const aged = dues.ageing.by_party[partyId] || { undisputed: {}, disputed: {}, total_minor: 0 };
  const open = Number((dues.outstanding.by_party || {})[partyId] || 0);
  if (isSettled(open, docs, aged)) return null;
  const disputed = MoneyOps.sumMinor(Object.keys(aged.disputed || {}), ctx.currency, (key) => aged.disputed[key]);
  const row = {
    party_id: partyId,
    side: role === 'creditors' ? 'supplier' : 'customer',
    balance_minor: sign * open,
    oldest_due: oldestDueOf(docs),
    disputed_minor: sign * disputed,
    buckets: bucketsOf(aged, sign)
  };
  row.follow_up = Engines.followRow(dues.follow, partyId); /* W15-94: the ONE ageing — days past due, both sides, every read */
  row.needs = Object.assign(Needs.empty(), needs.by_party.get(String(partyId)) || {});
  return row;
}

/** a party on both lists nets: what they owe you less what you owe them (the customer half is what the follow-up ages) */
function mergeSides(into, other, effective, withTerms) {
  into.balance_minor += other.balance_minor;
  into.disputed_minor += other.disputed_minor;
  Object.keys(other.needs).forEach((key) => (into.needs[key] = (into.needs[key] || 0) + other.needs[key])); /* what needs you on either list */
  into.side = 'both';
  if (other.side === 'customer') into.follow_up = other.follow_up; /* a both-sides row ages what the customer half owes (as before) */
  into.oldest_due = [into.oldest_due, other.oldest_due].filter(Boolean).sort()[0] || null;
  Object.keys(other.buckets).forEach((key) => {
    into.buckets[key] = (into.buckets[key] || 0) + other.buckets[key];
  });
  if (withTerms) mergeTerms(into, other, effective);
}

/** the customer terms' figures of a both-sides row: interest adds (SHOWN, never posted), the limit view is read again on the netted row */
function mergeTerms(into, other, effective) {
  if (other.interest_minor != null) {
    into.interest_minor = (into.interest_minor || 0) + other.interest_minor;
    into.interest_state = other.interest_state;
  }
  Object.assign(into, Engines.limitView(effective, into));
}

/** FX1: a party with a foreign-currency balance shows it beside the books' figure — "USD 1,000 · ₹83,250"; rows = Map(party_id → row) */
function mergeForeign(rows, foreignBalances) {
  for (const line of foreignBalances) {
    const row = rows.get(line.party_id);
    if (!row) continue;
    const have = (row.foreign = row.foreign || []).find((item) => item.currency === line.txn_currency);
    if (have) {
      have.balance_minor += line.txn_minor;
      have.carried_minor += line.fn_minor;
    } else row.foreign.push({ currency: line.txn_currency, balance_minor: line.txn_minor, carried_minor: line.fn_minor });
  }
}

module.exports = { openDocsByParty, partyRow, mergeSides, mergeForeign };
