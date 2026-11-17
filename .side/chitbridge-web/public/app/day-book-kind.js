/* day-book-kind.js — the Day book's group and party line: ONE rule for the owner's Day book and the auditor's.
 * OWNS      DAY_BOOK_KINDS (the rows, in rule order) · dayBookKind (Sales, Receipts, Purchases, Payments, Expenses, Returns, Other) · dayBookPartyLine · dayBookPartyRef; moved out of helpers.js (2026-11-17, size ratchet; behaviour unchanged)
 * CALLED BY cap-books.js (the owner Day book) · books-grant-filters.js · books-grant-reports.js (the auditor / firm Day book); loaded by accounts.html, crm.html, finance.html, network.html, tasks.html and app.html, right after helpers.js
 * FLOW      an entry (event_type, source.kind, lines) → dayBookKind → its group; dayBookPartyRef → "Party · document number"
 * CARD      16-finance/cb-accounts
 */
/** ONE rule: which day-book group an entry belongs to — the owner Day book (cap-books.js) and the auditor/firm Day book (books-grant-view.js) both read it (Sales, Receipts, Purchases, Payments, Expenses, Returns, Other) */
/* [group, the event_type pattern, the source.kind it also takes] — the first row that fits wins, so the order is the rule */
var DAY_BOOK_KINDS = [
  ['Returns', /return|credit_note|debit_note/, 'credit_note'],
  ['Purchases', /purchase/, null],
  ['Expenses', /expense/, 'expense'],
  ['Sales', /sale|walkin/, 'day'],
  ['Receipts', /received|receipt/, 'receipt'],
  ['Payments', /payment/, 'payment']
];
/** ONE rule: the line of a Day book entry that names its party (the first with one): the owner Day book (cap-books.js bkDvParty) and the auditor Day book (books-grant-view.js) both read it */
function dayBookPartyLine(entry) {
  return ((entry && entry.lines) || []).filter(function (line) {
    return line.party_name || line.party_id;
  })[0];
}
/** "Kensington Strata · HP-INV-1": the party and the document number a Day book row stands on (R70: one source for the owner and the auditor); the entry's own words when it has neither (an opening, a hand-keyed journal) */
function dayBookPartyRef(entry) {
  var line = dayBookPartyLine(entry),
    ref = entry && entry.source && entry.source.ref;
  return [line && line.party_name, ref].filter(Boolean).join(' · ') || (entry && entry.narration) || '';
}
function dayBookKind(entry) {
  var type = String((entry && entry.event_type) || ''),
    sourceKind = String((entry && entry.source && entry.source.kind) || '');
  var hit = DAY_BOOK_KINDS.filter(function (row) {
    return row[1].test(type) || (row[2] !== null && row[2] === sourceKind);
  })[0];
  if (hit) return hit[0];
  return sourceKind === 'bill' ? 'Sales' : 'Other';
}
