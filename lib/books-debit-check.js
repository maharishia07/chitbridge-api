'use strict';
/**
 * lib/books-debit-check.js — B6-14: a debit note is raised only against a bill that is BOOKED for that supplier, and never for more than the bill still owes.
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
async function holds(entity, note) {
  const books = require('./books');
  const ref = String(note.against_ref);
  const read = await require('../db').withEntity(entity, async (handle) => {
    const on = await require('./books-store').partyOn(handle, entity, note.supplier);
    return on && (on.customer || on.supplier) ? books.partyItems(handle, entity, note.supplier, (await books.controlOf(handle, entity, 'supplier')).account_id) : null;
  });
  if (!read) return; /* not a party of this shop: the writer's own 404 answers */
  const items = read;
  const open = openOf(items, ref, require('./books-engines').receivables());
  if (open === null) throw refuse('There is no booked bill ' + ref + ' from that supplier in this shop, so a debit note cannot be raised against it. Check the bill reference. Nothing was posted.', 'DEBIT_NOTE_NO_BILL');
  if (note.total_minor > open) throw refuse('Bill ' + ref + ' has ' + require('./books-payment-advice').money(open, note.currency) + ' still open; a debit note of ' + require('./books-payment-advice').money(note.total_minor, note.currency) + ' is more than that. Nothing was posted.', 'DEBIT_NOTE_TOO_BIG');
}
module.exports = { holds, openOf };
