'use strict';
/**
 * lib/books-bad-debt.js — ACC-418: the invoice a bad-debt write-off (or its recovery) is made against, read from the books for the posting engine.
 * OWNER     cb-accounting
 * OWNS      adjusted (the route's one call) · invoiceOf (the GST actually charged on the named invoice and its gross, from its own posted tax lines) · withInvoice (an event gains `invoice` when the pack asks for it)
 * CALLED BY routes/books.js POST /write-off · POST /write-off/recover
 * RISK      money
 * FLOW      against_ref (the bill's chit id) → its unreversed entries' tax-role and debtors lines (books-store.inputTaxOfChits, one read, a wide window) → { gross_minor, tax_minor } → the event
 * CARD      14-accounting/README
 * The engine (posting write_off / write_off_recovery, the pack's tax.badDebt row) does the split; a pack without the row, no ref, or a ref that holds no tax line leaves the event as it was: the whole amount goes to bad debts, never a guess.
 */
const Store = require('./books-store');
const WHOLE_LIFE = ['0001-01-01', '9999-12-31']; /* the window is every date: a bill is read as it stands, not as of a month */
const CHIT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** the pack's tax.badDebt row names the tax head whose output ledger holds the GST of a sale; null when the pack has no such row */
function outputRoleOf(pack) {
  const rule = pack && pack.tax && pack.tax.badDebt,
    head = rule && pack.taxLedgers && pack.taxLedgers[rule.head];
  return (head && head.output) || null;
}

/** → { gross_minor, tax_minor } | null: the debtors and output-tax lines the named bill's own unreversed entries carry (a credit-noted part is already out of both) */
async function invoiceOf(handle, entity, pack, againstRef) {
  const role = outputRoleOf(pack),
    ref = String(againstRef || '');
  if (!role || !CHIT.test(ref)) return null;
  const read = await Store.inputTaxOfChits(handle, entity, [ref], [role, 'debtors'], WHOLE_LIFE[0], WHOLE_LIFE[1]),
    held = read[ref.toLowerCase()] || read[ref] || {},
    tax = -Number(held[role] || 0),
    gross = Number(held.debtors || 0);
  return positive(tax) && positive(gross) ? { gross_minor: gross, tax_minor: tax } : null;
}
/** a whole amount of minor units above nothing */
const positive = (minor) => Number.isSafeInteger(minor) && minor > 0;

/** the event with its `invoice` when the pack asks for it and the bill is found; the answer says in words when no GST could be adjusted → { event, note } */
async function withInvoice(handle, entity, pack, event) {
  if (!outputRoleOf(pack)) return { event, note: null };
  const invoice = await invoiceOf(handle, entity, pack, event.against_ref);
  if (invoice) return { event: Object.assign({}, event, { invoice }), note: null };
  return { event, note: 'No GST was adjusted: name the invoice (against_ref) and its tax lines must be on file. The whole amount went to bad debts.' };
}

/** the route's one call: read the shop's pack and the invoice in the shop's own transaction → { event, note } */
async function adjusted(entity, event) {
  const { withEntity } = require('../db'),
    B = require('./books');
  return withEntity(entity, async (handle) => withInvoice(handle, entity, (await B.ledgerCtx(handle, entity)).pack, event));
}

module.exports = { invoiceOf, withInvoice, outputRoleOf, adjusted };
