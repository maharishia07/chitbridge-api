'use strict';
/**
 * lib/bill-checks.js — what stands behind each OPEN BILL of one party: the bill's own amount, its day, the reviewer's mark and the evidence state (W15-95, W15-96).
 * OWNER     cb-finance
 * RISK      money
 * OWNS      attach(handle, e, req, prop, opt) → sets bill_minor · bill_date · entry_id · chit_id · mark · evidence_flag on each row of a payment preview's `proposal`, and the root `mark_actions`
 * CALLED BY routes/books.js POST /payments/preview, only when the body says `checks: true` (the Receivables / Payables bill list and the Pay confirm; the Pay sheet's own preview is untouched)
 * FLOW      proposal rows (books.proposeFor) ──▶ each bill's entry (party_item.entry_id) ──▶ marksIn (the Day book's own mark read) + books-evidence.attach (the Day book's own "No tax invoice" rule) ──▶ the row
 * CARD      16-finance/payables
 * ⭐ NO SECOND SOURCE: the mark is lib/mark-embed.marksIn (adopter acc.audit, the one the Day book embeds); the flag is lib/books-evidence.flagOf, handed the same entry shape the Day book hands it.
 *    Nothing here decides a hold, a threshold or a rate. ⚠️ A bill with no entry (no row in party_item.entry_id) simply carries nulls.
 */
const Evidence = require('./books-evidence');
const { marksIn } = require('./mark-embed');

/** the entries (with their lines) behind the given entry ids, in the shape books-evidence wants: { entry, lines } by entry id. ONE read. */
async function entriesOf(handle, e, ids) {
  if (!ids.length) return new Map();
  const found = await handle.query(
    `SELECT h.entry_id, h.entry_no, h.event_type, h.doc_date, h.posting_date, h.source_chit_id, h.reverses_entry_id,
            (SELECT x.entry_id FROM journal_entry x WHERE x.entity_id = h.entity_id AND x.reverses_entry_id = h.entry_id LIMIT 1) AS reversed_by_id,
            a.role AS account_role, l.dr_minor
       FROM journal_entry h JOIN journal_line l ON l.entry_id = h.entry_id AND l.entity_id = h.entity_id
                            JOIN ledger_account a ON a.account_id = l.account_id
      WHERE h.entity_id = $1 AND h.entry_id = ANY($2::uuid[])`,
    [e, ids]
  );
  const out = new Map();
  found.rows.forEach((row) => {
    const have = out.get(String(row.entry_id)) || { entry: row, lines: [] };
    have.lines.push({ account_role: row.account_role, dr_minor: row.dr_minor });
    out.set(String(row.entry_id), have);
  });
  return out;
}

/** the bill rows of a party's items by their ref: { entry_id, amount_minor, doc_date } — a bill is the row whose ref is its own against_ref */
function billsOf(items) {
  const out = new Map();
  (items || []).forEach((item) => {
    if (item && String(item.ref) === String(item.against_ref) && !out.has(String(item.ref))) out.set(String(item.ref), item);
  });
  return out;
}

/** the bill facts one proposal row carries: amount, date, entry, the document behind it, the Day book's mark and its tax-invoice flag */
function setRowFacts(row, found) {
  const { bills, flagged, chits, marks } = found;
  const bill = bills.get(String(row.against_ref)) || {},
    entry = bill.entry_id ? String(bill.entry_id) : null,
    evidence = entry ? flagged.get(entry) : null;
  Object.assign(row, billFigures(bill), { entry_id: entry });
  row.chit_id = (entry && chits.get(entry)) || null;
  Object.assign(row, checkFacts(marks, entry, evidence));
}
/** the Day book's own checks on a proposal row: its mark and its tax-invoice flag (null when there are none) */
const checkFacts = (marks, entry, evidence) => ({ mark: (marks && entry && marks.byId[entry]) || null, evidence_flag: (evidence && evidence.flag) || null });
/** the bill's own figures on a proposal row: its amount and its document date (null when the bill is not found) */
const billFigures = (bill) => ({ bill_minor: bill.amount_minor != null ? Number(bill.amount_minor) : null, bill_date: bill.doc_date ? String(bill.doc_date).slice(0, 10) : null });
/**
 * attach(handle, e, req, prop, opt) — prop is books.proposeFor's answer ({ items, proposal }); opt = { pack, cur }. Mutates prop.proposal rows; returns { mark_actions } (null while marking is off).
 * A failure to read the marks or the evidence never fails the preview: the rows keep their nulls (the web then shows no chip, and says nothing it does not know).
 */
async function attach(handle, e, req, prop, opt) {
  const bills = billsOf(prop.items),
    rows = prop.proposal || [];
  const ids = [...new Set(rows.map((row) => bills.get(String(row.against_ref))).filter((bill) => bill && bill.entry_id).map((bill) => String(bill.entry_id)))];
  const marks = await marksIn(handle, req, 'acc.audit', ids);
  const flagged = new Map(),
    chits = new Map();
  if (opt && opt.pack && ids.length) {
    const entries = await entriesOf(handle, e, ids),
      list = [...entries.values()].map((one) => ({ item: {}, chit_id: one.entry.source_chit_id, ref: null, entry: one.entry, lines: one.lines }));
    await Evidence.attach(handle, list, { pack: opt.pack, cur: opt.cur, flag: true });
    list.forEach((one) => flagged.set(String(one.entry.entry_id), one.item.evidence || null));
    entries.forEach((one, id) => chits.set(id, one.entry.source_chit_id || null)); /* the document behind the bill: the row's number opens it */
  }
  rows.forEach((row) => setRowFacts(row, { bills, flagged, chits, marks }));
  return { mark_actions: marks ? marks.actions : null };
}

module.exports = { attach };
