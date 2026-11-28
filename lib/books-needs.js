'use strict';
/**
 * lib/books-needs.js — WHO NEEDS YOU, AND WHY (W15-114/115/116): the ONE list of reasons a bill or an entry wants the owner, counted on the server.
 * OWNER     cb-finance
 * RISK      money
 * OWNS      KINDS · ACTION · reasonsOf(bill) (a bill's reasons, in the order they matter; a hold and a missing tax invoice are BOTH kept, the web shows one chip + n) · partyNeeds(handle, e, req, ctx, bills) (reasons by bill ref + the same counts by party) · sumNeeds(list) · openMarks(handle, e, req) (the open marks, one read)
 * CALLED BY routes/books.js GET /dues (the Needs column + the header line) · lib/books-party-bills.js (the Needs you tab, a why-chip and ONE action per bill) · routes/books.js GET /attention (the open queries; the ⚑ Needs you count of the Day book)
 * FLOW      open bills (the netted ones, with their entry ids) ──▶ the flag (books-evidence.flaggedAmong — the Day book's own rule asked of THESE entries) + the open marks (review-mark.openList, ONE read) + the bill's own figures (disputed, no due date, days late from billBands)
 *           ──▶ reasonsOf ──▶ a count per party and per kind, and the reasons of each bill
 * CARD      16-finance/collections-and-dues
 * ⭐ ONE SOURCE: /dues (the Needs column), the party's Needs you tab and the Day book's ⚑ count read THIS file; none of them counts a reason itself. Nothing is decided here: the flag is the pack's, the age is books-engines.billBands, a hold and a query are the reviewer's marks.
 * ⭐ A reason is a fact about a bill, never an instruction: ACTION names the ONE button the web may offer for it; nothing posts by itself.
 */
const Evidence = require('./books-evidence');

/** the reasons, in the order they matter (the first is the bill's WHY) */
const KINDS = ['disputed', 'query', 'held', 'no_tax_invoice', 'no_terms', 'overdue'];
/** the ONE action a reason offers (the web's words: Answer · Release · Attach · Set terms · Pay / Receive) */
const ACTION = { disputed: 'answer', query: 'answer', held: 'release', no_tax_invoice: 'attach', no_terms: 'terms', overdue: 'pay' };

/** the reasons a bill wants you, in the order they matter, each with the test that raises it (a hold and the tax-invoice flag are both kept) */
const REASON_RULES = [
  ['disputed', (bill) => !!bill.disputed],
  ['query', (bill, mark) => mark.class === 'open'],
  ['held', (bill, mark) => mark.class === 'hold' || mark.kind === 'on_hold'],
  ['no_tax_invoice', (bill) => bill.evidence_flag === 'no_tax_invoice'],
  ['no_terms', (bill) => !!bill.no_terms],
  /* ACC-412: no terms = no due date = never overdue (it has its own reason, no_terms); the flag is billBands' `overdue` */
  ['overdue', (bill) => (bill.overdue != null ? !!bill.overdue : !bill.no_terms && Number(bill.days_overdue) > 0)]
];
/** a bill's reasons from what is known of it: { owed_minor, disputed, no_terms, overdue, days_overdue, evidence_flag, mark } → [kind] (a hold and the tax-invoice flag are both kept: Release stays offered, the web shows one chip and +n) */
function reasonsOf(bill) {
  if (!bill || !(Number(bill.owed_minor) > 0)) return [];
  const mark = bill.mark || {};
  return REASON_RULES.filter(([, applies]) => applies(bill, mark)).map(([kind]) => kind);
}

/** the open marks of the books (queries and holds), ONE read under a savepoint; null while marking is not switched on or cannot be read — a mark that fails never fails the count */
async function openMarks(handle, e, req, from, to) {
  const door = require('./mark-door');
  if (!(await require('./schema').hasTable('review_mark'))) return null;
  await handle.query('SAVEPOINT needs_marks');
  try {
    const open = await require('./review-mark').openList(handle, 'acc.audit', e, door.ctxOf(req), { from, to });
    await handle.query('RELEASE SAVEPOINT needs_marks');
    return open.open.map((mark) => ({ subject_id: String(mark.subject_id), class: mark.class, kind: mark.kind, posting_date: String(mark.posting_date).slice(0, 10) }));
  } catch (err) {
    await handle.query('ROLLBACK TO SAVEPOINT needs_marks').catch(require('./logger').orElse('needs: the rollback after the marks read failed', undefined));
    require('./logger').fellBack('needs: the open marks could not be read, the list is counted without them', err);
    return null;
  }
}

/** the flag of these entries, under a savepoint: a read that fails is logged and leaves the flags uncounted, it never fails the list the count sits on (the marks do the same) */
async function flaggedSafely(handle, e, ctx, ids) {
  if (!ids.length) return [];
  try {
    await handle.query('SAVEPOINT needs_flag');
    const found = await Evidence.flaggedAmong(handle, e, { pack: ctx.pack, cur: ctx.cur }, ids);
    await handle.query('RELEASE SAVEPOINT needs_flag');
    return found.map(String);
  } catch (err) {
    await handle.query('ROLLBACK TO SAVEPOINT needs_flag').catch(require('./logger').orElse('needs: the rollback after the flag read failed', undefined));
    require('./logger').fellBack('needs: the tax-invoice flag could not be read, the bills are counted without it', err);
    return [];
  }
}

const empty = () => ({ parties: 0, bills: 0, disputed: 0, query: 0, held: 0, no_tax_invoice: 0, no_terms: 0, overdue: 0, overdue_minor: 0 });

/**
 * partyNeeds(handle, e, req, ctx, bills) — bills: [{ ref, party, entry_id, owed_minor, disputed, no_terms, days_overdue }] (the OPEN ones); ctx = { pack, cur, supplier: boolean (the tax-invoice flag is a purchase-side fact) }.
 * → { reasons: Map(ref → [kind]), by_party: Map(party → { bills, <kind>: n …, overdue_minor }) }
 */
async function partyNeeds(handle, e, req, ctx, bills) {
  const ids = [...new Set(bills.map((bill) => bill.entry_id).filter(Boolean).map(String))];
  const flagged = new Set(ctx.supplier ? await flaggedSafely(handle, e, ctx, ids) : []);
  const marks = ids.length ? await module.exports.openMarks(handle, e, req, '1900-01-01', '2999-12-31') : null;
  const markOf = new Map((marks || []).map((mark) => [mark.subject_id, mark]));
  const reasons = new Map(),
    byParty = new Map();
  bills.forEach((bill) => {
    const entry = bill.entry_id ? String(bill.entry_id) : null;
    const list = reasonsOf(Object.assign({}, bill, { evidence_flag: entry && flagged.has(entry) ? 'no_tax_invoice' : null, mark: entry ? markOf.get(entry) || null : null }));
    reasons.set(bill.ref, list);
    if (!list.length) return;
    const row = byParty.get(String(bill.party)) || byParty.set(String(bill.party), { bills: 0, overdue_minor: 0 }).get(String(bill.party));
    row.bills += 1;
    list.forEach((kind) => (row[kind] = (row[kind] || 0) + 1));
    if (list.includes('overdue')) row.overdue_minor += Number(bill.owed_minor);
  });
  return { reasons, by_party: byParty };
}

/** the page's header line: parties that need you and each kind's number of bills, over the rows given (each row's `needs`, or none) */
function sumNeeds(rows) {
  const out = empty();
  (rows || []).forEach((row) => {
    const needs = row && row.needs;
    if (!needs || !needs.bills) return;
    out.parties += 1;
    out.bills += needs.bills;
    KINDS.forEach((kind) => (out[kind] += needs[kind] || 0));
    out.overdue_minor += needs.overdue_minor || 0;
  });
  return out;
}

module.exports = { KINDS, ACTION, reasonsOf, partyNeeds, sumNeeds, openMarks, empty };
