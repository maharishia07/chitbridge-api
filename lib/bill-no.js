'use strict';
/**
 * lib/bill-no.js — THE ONE READER OF THE NUMBER A BILL CARRIES (AS critic 1129; widened from books-hooks' billNoOf, which moved here so books-hooks holds its size row)
 * OWNS      billNoRawOf (the number as typed) · billNoOf (the same, compared the way people read it: case and spaces aside) · BILL_NO_FIELDS
 * OWNER     cb-accounting with cb-rail
 * CALLED BY lib/books-hooks.js (a booked receipt against an invoice) · lib/rail-invoice-number.js (the send door's number step)
 * RULE      bill_no, else printed_as (the number the server stamped), else invoice_no (the field id of lib/forms.js and of the move-in rows), else doc_no. Never a second list of these fields.
 */
const BILL_NO_FIELDS = ['bill_no', 'printed_as', 'invoice_no', 'doc_no'];

/** the number a document carries, as typed (trimmed); '' when it carries none */
function billNoRawOf(business) {
  const held = business && typeof business === 'object' ? business : {};
  for (const field of BILL_NO_FIELDS) {
    const given = held[field];
    if ((typeof given === 'string' && given.trim()) || typeof given === 'number') return String(given).trim();
  }
  return '';
}
/** a bill number compared the way people read it: case and spaces aside; '' when none */
const billNoOf = (business) => billNoRawOf(business).replace(/ +/g, '').toUpperCase();

module.exports = { billNoRawOf, billNoOf, BILL_NO_FIELDS };
