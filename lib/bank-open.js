/* lib/bank-open.js — THE OPEN DOCUMENTS the bank sheet matches a statement line against (M4, BNK-new-8, l16-bankmatch-fix).
 * OWNS      openDocuments(h, entity, opts) → { parties, open_items }: every customer / supplier of the shop (not only those on the rail) and every OPEN bill or invoice, each with its currency.
 * CALLED BY routes/books.js GET /bank/rail (the web hands both lists to the engine: bank-recon suggest / explain, `parties` and `open_items`).
 * ⭐ NO SECOND CALCULATION: the open figure of a document is books-engines receivables().outstanding — the amount a payment may still be allocated to, the same figure
 *   B.proposeFor and POST /payments (allocations) read, so a line proposed against a document can be posted against it.
 * ⚠️ a supplier's bills are cost money: `withCosts: false` (a co-assist that cannot see costs) leaves the supplier side out, as /dues does for it.
 */
'use strict';
const E = require('./books-engines');
const S = require('./books-store');
const B = require('./books');

const SIDES = [{ side: 'customer', role: 'debtors' }, { side: 'supplier', role: 'creditors' }];

/** the open bills of one control account → [{ ref, party, side, open_minor, due_date, date, currency }] (the engine's own outstanding figure) */
async function openOf(h, entity, side, currency) {
  const account = await B.controlOf(h, entity, side);
  const items = await B.partyItems(h, entity, null, account.account_id);
  if (!items.length) return [];
  const byRef = E.receivables().outstanding(items).by_ref;
  return Object.keys(byRef)
    .map((ref) => byRef[ref])
    .filter((x) => x.kind === 'bill' && x.outstanding_minor > 0 && !x.disputed)
    .map((x) => ({ ref: x.ref, party: String(x.party), side, open_minor: x.outstanding_minor, due_date: x.due_date || null, date: x.date || null, currency }));
}
/** the shop's customers and suppliers as the engine compares names: [{ id, name, kind }] — a party on both lists is ONE row with no kind */
function partiesOf(names, withCosts) {
  const rows = [];
  names.forEach((p) => {
    const name = p.nickname || p.name || null;
    if (!name) return;
    const kinds = [p.customer ? 'customer' : null, p.supplier && withCosts ? 'supplier' : null].filter(Boolean);
    if (kinds.length) rows.push({ id: String(p.party_id), name, kind: kinds.length === 1 ? kinds[0] : undefined }); /* on both lists: one row, no kind (two rows would be 'more than one party' to the engine) */
  });
  return rows;
}
/**
 * openDocuments(h, entity, { names: Map(party_id → S.parties row), currency, withCosts }) → { parties, open_items }
 * one read of each control account's rows, one read of the document numbers (S.billNos); nothing per row.
 */
async function openDocuments(h, entity, opts) {
  const withCosts = opts.withCosts !== false;
  const lists = [];
  for (const one of SIDES) {
    if (one.side === 'supplier' && !withCosts) continue;
    lists.push(await openOf(h, entity, one.side, opts.currency));
  }
  const open = [].concat(...lists);
  const nos = open.length ? await S.billNos(h, entity, open.map((x) => x.ref)) : {};
  return { parties: partiesOf(opts.names, withCosts), open_items: open.map((x) => Object.assign({ bill_no: nos[x.ref] || null }, x)) };
}
module.exports = { openDocuments, partiesOf };
