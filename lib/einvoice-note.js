/**
 * lib/einvoice-note.js — F13 (VERIFY-GF-TAX, batch 1128): THE E-INVOICE (IRN) WARNING A GSTR-1 CARRIES.
 * OWNS      the one sentence a month of invoices to registered buyers gets about e-invoicing, and the one read of the pack's dated limit (the reg-in `einvoice.aato_thresholds` rows — data, never a number here).
 * CALLED BY lib/tax-lines gstr1 (its _cb.einvoice). No IRN is built or checked here: the product files nothing; this is the missing warning, not a figure.
 * FLOW      the month's B2B invoice count + the month's last day ──▶ the pack's row in force that day ──▶ { limit, status, cite, b2b_invoices, words } · null when there is nothing to warn about
 * ⚠️ The shop's aggregate turnover (any financial year from 2017-18) is not known to the api, so the words say IF; they never say the shop is over the limit. The limit is quoted only when the pack row is `confirmed`
 *    (cb-country re-checks the rows); an `unconfirmed` row is named as such, never presented as law. Statute wording (Rule 48(4) and (5), CGST Rules) is the VERIFY-GF-TAX row's: cb-country verifies it.
 */
'use strict';

/** the pack row of the limit in force on `day` (YYYY-MM-DD) → the row or null: the latest row that has started and not ended */
function rowOf(rows, day) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => row.from <= day && (!row.to || day <= row.to));
  return list.length ? list[list.length - 1] : null;
}
/** a figure in paise as 'Rs 5 crore' / 'Rs 50 lakh'-free words: whole crore only (the limits are crores) */
const croreWords = (minor) => 'Rs ' + minor / 100 / 1e7 + ' crore';

/**
 * einvoiceNoteFor({ country, day, b2b }) → null | { b2b_invoices, limit_crore, limit_status, cite, from, words }
 * `b2b` the invoices of the month to registered buyers; none → null (a B2C bill carries the dynamic QR code, not an IRN, and no registered buyer is waiting on one).
 */
function einvoiceNoteFor(opts) {
  const o = opts || {},
    count = Number(o.b2b) || 0;
  if (!count) return null;
  const pack = o.country ? require('./tax-packs').packFor(o.country) : null,
    row = pack && pack.einvoice ? rowOf(pack.einvoice.aato_thresholds, String(o.day)) : null;
  if (!row) return null;
  const limit = row.status === 'confirmed' ? 'above ' + croreWords(row.above_minor) : 'above the limit the pack has not confirmed yet (cb-country re-checks it)';
  return {
    b2b_invoices: count,
    limit_crore: row.above_minor / 100 / 1e7,
    limit_status: row.status || null,
    cite: row.cite,
    from: row.from,
    words:
      'E-invoicing: a registered person whose aggregate turnover in any year from 2017-18 is ' + limit + ' must have an e-invoice number and QR code on every invoice to a registered buyer, and the buyer cannot take credit on one without it. ' +
      'This month holds ' + count + ' invoice(s) to registered buyers. This product does not issue that number; if your turnover is over the limit, get one from the invoice portal for each of them before you file.'
  };
}

module.exports = { einvoiceNoteFor, rowOf };
