'use strict';
/**
 * lib/books-bill-order.js — THE ORDER A PAYMENT POURS INTO A PARTY'S OPEN BILLS (split out of lib/books.js proposeFor so that file holds its size row)
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      oldestFirst(billNumbers) → the sort comparator: due date, then bill date, then the bill's NUMBER on the paper, then the chit id
 * CALLED BY lib/books.js proposeFor (AC-F-09: the same order is given to the allocator as `against`, so the screen's proposal and the pour agree)
 * FLOW      an open bill with its due date, date and ref ──> comparator ──> oldest first; the chit id is the last tie-break only, never the first (it is arbitrary)
 * CARD      14-accounting/README
 */

/** the day a bill falls due, else its own day, as text ('' when neither is known) */
const dueDayOf = (bill) => String(bill.due_date || bill.date || '');

/** the comparator for open bills: due date, then bill date, then the number on the paper (numeric aware; `billNumbers` maps a ref to its number), then the ref */
function oldestFirst(billNumbers) {
  const numberOn = (bill) => String(billNumbers[bill.ref] || '');
  return (first, second) =>
    dueDayOf(first).localeCompare(dueDayOf(second)) ||
    String(first.date || '').localeCompare(String(second.date || '')) ||
    numberOn(first).localeCompare(numberOn(second), 'en', { numeric: true }) ||
    String(first.ref).localeCompare(String(second.ref));
}

module.exports = { oldestFirst };
