'use strict';
/**
 * lib/books-bill-ref.js — AZ-F-03: THE NAMES A PERSON CALLS ONE BOOKED BILL BY, resolved to the reference its supplier rows hold
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      namedRef(handle, entity, items, typed) → the ref of the supplier's bill that `typed` names, or null: the stored ref · ev:expense:<client_ref> (AW-F-05) · the entry's id · the entry's number (MJ/2026-27/000001) · the bill's own number (lib/bill-no.js, the ONE reader)
 * CALLED BY lib/books-debit-check.js (a debit note names its bill); the same answer Payables lists under
 * CARD      14-accounting/README
 * FLOW      typed → the stored ref's two spellings (no read) → an entry id (no read) → ONE read of the entries' numbers and ONE of the rail bills' numbers (books-store.billNos) → compared the way people read a number (billNoOf)
 * ⚠️ Money is never decided here: this only says WHICH bill; books-debit-check.openOf still says how much is open.
 */
const { billNoOf } = require('./bill-no');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** the refs of the supplier's own positive documents (bills), each with the entry that posted it */
const billsOf = (items) => {
  const seen = new Map();
  (items || []).forEach((row) => { if (Number(row.amount_minor) > 0 && !seen.has(String(row.ref))) seen.set(String(row.ref), row.entry_id || null); });
  return seen;
};
/** entry_id → entry_no for the bills' entries, one read */
async function entryNos(handle, entity, ids) {
  if (!ids.length) return {};
  const found = await handle.query('SELECT entry_id, entry_no FROM journal_entry WHERE entity_id = $1 AND entry_id = ANY($2::uuid[])', [entity, ids]);
  return Object.fromEntries(found.rows.map((row) => [row.entry_id, row.entry_no]));
}
const same = (one, other) => !!one && billNoOf({ bill_no: one }) === billNoOf({ bill_no: other });
/** the reference of the bill `typed` names among `items` (a supplier's party rows), or null; `typed` is as the person gave it */
async function namedRef(handle, entity, items, typed) {
  if (!billNoOf({ bill_no: typed })) return null;
  const bills = billsOf(items), refs = Array.from(bills.keys());
  const direct = refs.find((ref) => same(ref, typed) || same(ref, 'ev:expense:' + typed) || (UUID.test(typed) && bills.get(ref) === typed.toLowerCase()));
  if (direct) return direct;
  const numbers = await entryNos(handle, entity, Array.from(new Set(Array.from(bills.values()).filter(Boolean))));
  const railNos = await require('./books-store').billNos(handle, entity, refs);
  return refs.find((ref) => same(numbers[bills.get(ref)], typed) || same(railNos[ref], typed)) || null;
}
module.exports = { namedRef };
