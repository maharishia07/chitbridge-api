'use strict';
/**
 * lib/books-debit-check.js — B6-14: a debit note is raised only against a bill that is BOOKED for that supplier, and never for more than the bill still owes.
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      holds(entity, { supplier, against_ref, total_minor, currency }) → resolves, or throws a refusal in words: DEBIT_NOTE_NO_BILL (no such booked bill of that supplier) · DEBIT_NOTE_TOO_BIG (more than the bill's open amount)
 * CALLED BY lib/books-manual.js BUILD.debit_note (the POST /events and /preview door)
 * CARD      14-accounting/README
 * FLOW      the supplier's party rows (books.partyItems, the same read Payables uses) ──▶ the engine's receivables.outstanding by ref ──▶ the bill's open figure, compared with the note's total
 * Xero and QuickBooks take a supplier credit only against a bill that exists and not above what it owes (the note may not exceed the open amount). Nothing is added or rounded here: figures are compared as the engine carries them.
 * ⚠️ Law is not a switch: this refuses a note that names nothing real, it changes no tax rule.
 */
const refuse = (words, code) => Object.assign(new Error(words), { code, refused: true });
/** the bill `ref` among a supplier's rows (a positive document of its own), → its open minor figure, or null when the supplier holds no such bill */
function openOf(items, ref, receivables) {
  const own = (items || []).filter((row) => String(row.ref) === ref && Number(row.amount_minor) > 0);
  if (!own.length) return null;
  const carried = receivables.outstanding(items).by_ref[ref];
  return carried ? Math.abs(carried.outstanding_minor) : 0;
}
/** resolves (with the ref the bill is held under) when the note may be raised: the supplier is a party of this shop and the bill is booked with enough still open; otherwise a refusal in words (nothing posted) */
async function holds(entity, note) {
  const books = require('./books');
  const typed = String(note.against_ref);
  if (!Number.isFinite(note.total_minor)) throw refuse('The debit note has no total to check against bill ' + typed + '. Nothing was posted.', 'DEBIT_NOTE_NO_TOTAL'); /* MONEY-01 A9: an unknown total never passes (NaN > open is false) */
  const read = await require('../db').withEntity(entity, async (handle) => {
    const on = await require('./books-store').partyOn(handle, entity, note.supplier);
    if (!(on && (on.customer || on.supplier))) return null;
    const items = await books.partyItems(handle, entity, note.supplier, (await books.controlOf(handle, entity, 'supplier')).account_id);
    return { items, ref: await require('./books-bill-ref').namedRef(handle, entity, items, typed) }; /* AW-F-05 · AZ-F-03: the name the person gave → the ref the rows hold */
  });
  if (!read) return; /* not a party of this shop: the writer's own 404 answers */
  const receivables = require('./books-engines').receivables(), ref = read.ref || typed, open = openOf(read.items, ref, receivables);
  if (open === null) throw refuse('There is no booked bill ' + typed + ' from that supplier in this shop, so a debit note cannot be raised against it. Give the number on the bill, the reference it was keyed with, or its entry number. Nothing was posted.', 'DEBIT_NOTE_NO_BILL');
  if (note.total_minor > open) throw refuse('Bill ' + typed + ' has ' + require('./books-payment-advice').money(open, note.currency) + ' still open; a debit note of ' + require('./books-payment-advice').money(note.total_minor, note.currency) + ' is more than that. Nothing was posted.', 'DEBIT_NOTE_TOO_BIG');
  return ref;
}
module.exports = { holds, openOf };
