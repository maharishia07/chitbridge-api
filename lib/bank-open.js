/* lib/bank-open.js — THE OPEN DOCUMENTS the bank sheet matches a statement line against (M4, BNK-new-8, l16-bankmatch-fix).
 * OWNS      openDocuments(handle, entity, opts) → { parties, open_items }: every customer / supplier of the shop (not only those on the rail) and every OPEN bill or invoice, each with its currency.
 * CALLED BY routes/books.js GET /bank/rail (the web hands both lists to the engine: bank-recon suggest / explain, `parties` and `open_items`).
 * ⭐ NO SECOND CALCULATION: the open figure of a document is books-engines receivables().outstanding — the amount a payment may still be allocated to, the same figure
 *   Books.proposeFor and POST /payments (allocations) read, so a line proposed against a document can be posted against it.
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 * ⚠️ a supplier's bills are cost money: `withCosts: false` (a co-assist that cannot see costs) leaves the supplier side out, as /dues does for it.
 */
'use strict';
const Engines = require('./books-engines');
const Store = require('./books-store');
const Books = require('./books');

const SIDES = [{ side: 'customer', role: 'debtors' }, { side: 'supplier', role: 'creditors' }];

/** the open bills of one control account → [{ ref, party, side, open_minor, due_date, date, currency }] (the engine's own outstanding figure) */
async function openOf(handle, entity, side, currency) {
  const account = await Books.controlOf(handle, entity, side);
  const items = await Books.partyItems(handle, entity, null, account.account_id);
  if (!items.length) return [];
  const byRef = Engines.receivables().outstanding(items).by_ref;
  return Object.keys(byRef)
    .map((ref) => byRef[ref])
    .filter((doc) => doc.kind === 'bill' && doc.outstanding_minor > 0 && !doc.disputed)
    .map((doc) => ({ ref: doc.ref, party: String(doc.party), side, open_minor: doc.outstanding_minor, due_date: doc.due_date || null, date: doc.date || null, currency }));
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
 * openDocuments(handle, entity, { names: Map(party_id → Store.parties row), currency, withCosts }) → { parties, open_items }
 * one read of each control account's rows, one read of the document numbers (Store.billNos); nothing per row.
 */
async function openDocuments(handle, entity, opts) {
  const withCosts = opts.withCosts !== false;
  const lists = [];
  for (const one of SIDES) {
    if (one.side === 'supplier' && !withCosts) continue;
    lists.push(await openOf(handle, entity, one.side, opts.currency));
  }
  const open = [].concat(...lists);
  const billNos = open.length ? await Store.billNos(handle, entity, open.map((doc) => doc.ref)) : {};
  return { parties: partiesOf(opts.names, withCosts), open_items: open.map((doc) => Object.assign({ bill_no: billNos[doc.ref] || null }, doc)) };
}
module.exports = { openDocuments, partiesOf, openOf };
