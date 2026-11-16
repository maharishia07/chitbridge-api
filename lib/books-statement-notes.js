/**
 * books-statement-notes.js — what the Balance sheet adds beside the engine's lines: the liabilities / equity sub-totals and the "net of" note on a netted tax line.
 *
 * OWNS      totalOf (the sum of the engine's own lines of one side, kept apart from the other side) and netOfNote (a tax line the pack's presentation nets, named with its two ledgers).
 * CALLED BY routes/books.js GET /bs
 * FLOW      the route splits the engine's liabilities line list into liabilities and equity → each side's rows are summed here → the two sums are carried to the page, which only shows them.
 * CARD      02-accounting/ACC-W15-93
 *
 * Computes nothing new: the sums add lines CBLedger.balanceSheet() returned (the same adding sideOf does), and the note names accounts the chart already holds. The page never adds.
 */
'use strict';
/** the sum of one side's rows (integer minor units, sign kept) */
function totalOf(rows) {
  return (rows || []).reduce((total, item) => total + (Number(item.amount_minor) || 0), 0);
}
/**
 * the ledgers a netted tax line stands for, found by the pack's taxNetting roles: { role → [output {code,name}, input {code,name}] }.
 * `accounts` are the entity's chart rows ({ code, name, role }); a head with no input ledger names only its output.
 */
function netOfByRole(taxNetting, accounts) {
  const byRole = new Map((accounts || []).filter((item) => item.role).map((item) => [item.role, { code: String(item.code), name: item.name }]));
  const out = {};
  (taxNetting || []).forEach((head) => {
    const pair = [byRole.get(head.output), head.input ? byRole.get(head.input) : null].filter(Boolean);
    if (pair.length === 2) [head.payableRole, head.creditRole].forEach((role) => role && (out[role] = pair));
  });
  return out;
}
/** the same rows, each netted tax line carrying `net_of` (its output ledger then its input ledger); every other row untouched */
function withNetOf(rows, notes) {
  return (rows || []).map((item) => (item.role && notes[item.role] ? Object.assign({}, item, { net_of: notes[item.role] }) : item));
}
module.exports = { totalOf, netOfByRole, withNetOf };
