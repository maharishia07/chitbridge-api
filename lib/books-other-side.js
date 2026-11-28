// OWNS      the ledger line's OTHER SIDE: which ledger(s) the entry's money came from / went to, and who the entry names, from the entry's own lines read in the same statement as the line (books-store.entryLines { others: true }).
// CALLED BY routes/books.js GET /ledger/:account (each line gains `other` and `party_name`).
// FLOW      the entry's lines [{ line_no, code, name, dr_minor, cr_minor, tax, party_name }] + this line → otherOf() → { code, name } | { code: null, name: 'Split', count } | null.
// ⭐ NOTHING IS COMPUTED: it picks and counts what the entry already says. The tax lines (a line on one of the PACK's tax ledgers — taxLedgers, whatever the country calls them — or one that carries a tax rate) stay out of the choice, so "Rent" with its tax line is still the one ledger Rent; only an entry that is nothing but tax names the tax ledger.
// CARD      16-finance/books-ledger
const SPLIT = 'Split';

/** the ledger ROLES the country pack gives its taxes (input · output · rcm · advance …, every head): a Set, empty for a pack with none */
function taxRolesOf(pack) {
  const out = new Set();
  Object.values((pack && pack.taxLedgers) || {}).forEach((head) => head && Object.values(head).forEach((role) => typeof role === 'string' && out.add(role)));
  return out;
}
/** DRIFT RC4 · the ledger ROLES the country pack gives its OUTPUT taxes (every head: AU gst_collected · IN output_cgst/sgst/igst/cess · AE output_vat): an array, empty for a pack with none — the day's output tax is read on these */
function outputRolesOf(pack) {
  return Object.values((pack && pack.taxLedgers) || {}).map((head) => head && head.output).filter((role) => typeof role === 'string');
}
/** the lines on the other side of this one (a debit's credits, a credit's debits), the tax lines left out unless nothing else is there, each ledger once, in line order */
function counterLines(all, own, taxRoles) {
  const debit = Number(own.dr_minor) > 0;
  const across = (all || []).filter((item) => Number(item.line_no) !== Number(own.line_no) && (debit ? Number(item.cr_minor) > 0 : Number(item.dr_minor) > 0));
  const plain = across.filter((item) => !item.tax && !(taxRoles && taxRoles.has(item.role)));
  const seen = new Set();
  return (plain.length ? plain : across).filter((item) => !seen.has(item.code) && seen.add(item.code));
}
/** { code, name } for the one other ledger, { code: null, name: 'Split', count } for several, null for none (an opening, a one-sided entry) */
function otherOf(all, own, taxRoles) {
  const side = counterLines(all, own, taxRoles);
  if (!side.length) return null;
  return side.length === 1 ? { code: String(side[0].code), name: side[0].name } : { code: null, name: SPLIT, count: side.length };
}
/** the name of the one party the entry names (its first named party, in line order), else null */
function partyNameOf(all) {
  const named = (all || []).find((item) => item.party_name);
  return named ? named.party_name : null;
}
module.exports = { otherOf, partyNameOf, counterLines, taxRolesOf, outputRolesOf, SPLIT };
