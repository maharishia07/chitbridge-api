// lib/books-hooks-use.js — the events of a bill whose goods are (partly) for the shop's own use (a part of lib/books-hooks.js, split out to keep its size row)
// OWNS  useEvents(tools, copy, base, supplier, split, paid, round_off, dueDate, setting, asset) → { event, events }: purchase_bill (resale) · purchase_bill accept:'asset' · expense (use) · payment_made per mode
// CALLED BY lib/books-hooks.js (useEventsVerdict, through its one-line wrapper that hands in byRateOf and roundMoney, so this file never requires its parent)
// FLOW  a classified bill → split by use → one event per kind, each with its own source_ref → the caller posts what has not posted
// CARD 16-finance/books-posting
'use strict';

/**
 * ⭐⭐ A BILL WHOSE GOODS ARE (PARTLY) FOR THE SHOP'S OWN USE (Athi, 2026-10-01) — with the posting engine's own events,
 * never a new one (the adopted engines are not edited):
 *   resale lines → purchase_bill  Dr Purchases + input GST · Cr the supplier       (source chit:<id>)
 *   asset lines  → purchase_bill  accept: 'asset' — Dr the class's PPE cost ledger + input GST · Cr the supplier (chit:<id>:asset when the bill has resale too);
 *                                 only once the asset register exists (b280); postChit then adds the register row
 *   use lines    → expense        Dr <class> (default sundry_expense) + input GST · Cr the supplier
 *                                 (source chit:<id> when it is the whole bill, else chit:<id>:use)
 *   paid at the counter → payment_made per mode, against this bill  Dr the supplier · Cr the mode   (chit:<id>:paid:<mode>)
 * So the supplier's account always shows the whole bill and what was paid on it. The round-off rides the purchase, or the
 * expense when there is no purchase. Every event has its own source, so a retry posts only what has not posted.
 * `tools` = { byRateOf, roundMoney }: the parent's two helpers, handed in.
 */
function useEvents(tools, copy, base, supplier, split, paid, round_off, dueDate, setting, asset) {
  const bill = { id: copy.chit_id, base, supplier, split, round_off, dueDate };
  const hasResale = split.resale.length > 0,
    hasAsset = split.asset.length > 0;
  const events = [];
  if (hasResale) events.push(resaleEvent(tools, bill));
  if (hasAsset) events.push(assetEvent(tools, bill, asset, hasResale));
  if (split.use.length) events.push(expenseEvent(tools, bill, setting, hasResale || hasAsset));
  const all = events.concat(paidEvents(bill, paid));
  return { event: all[0], events: all };
}
/** resale lines: the purchase on the supplier's account */
function resaleEvent(tools, bill) {
  return Object.assign({}, bill.base, {
    type: 'purchase_bill',
    party: bill.supplier,
    by_rate: tools.byRateOf({ ItemList: bill.split.resale, _cb: bill.split._cb }).rows,
    paid: {},
    round_off: bill.round_off,
    counter: null,
    source_ref: 'chit:' + bill.id,
    against_ref: bill.id,
    due_date: bill.dueDate
  });
}
/* ⭐ AN ASSET LINE (engines v1.14 R2): the purchase rule with accept: 'asset' puts the cost on the class's PPE ledger; the register row
   (lib/books-assets) is made by postChit once THIS entry has posted — `asset_register` is what it needs, never read by the engine */
function assetEvent(tools, bill, asset, hasResale) {
  return Object.assign({}, bill.base, {
    type: 'purchase_bill',
    accept: 'asset',
    asset_class: asset.class,
    put_to_use: asset.put_to_use,
    party: bill.supplier,
    by_rate: tools.byRateOf({ ItemList: bill.split.asset, _cb: bill.split._cb }).rows,
    paid: {},
    round_off: hasResale ? 0 : bill.round_off,
    counter: null,
    source_ref: hasResale ? 'chit:' + bill.id + ':asset' : 'chit:' + bill.id,
    against_ref: bill.id,
    due_date: bill.dueDate,
    asset_register: asset.register
  });
}
/** use lines: the expense, its input tax summed per head from the rate rows */
function expenseEvent(tools, bill, setting, hasBefore) {
  const list = tools.byRateOf({ ItemList: bill.split.use, _cb: bill.split._cb }).rows;
  const sum = (field) => tools.roundMoney(list.reduce((total, item) => total + (item[field] || 0), 0));
  const inputTax = { cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), cess: sum('cess') };
  const singleHead = bill.split._cb && bill.split._cb.scheme ? String(bill.split._cb.scheme).toLowerCase() : null;
  if (singleHead && sum(singleHead)) inputTax[singleHead] = sum(singleHead); /* AU GST: the one head (byRateOf) */
  return Object.assign({}, bill.base, {
    type: 'expense',
    class: (setting && setting.use_class) || 'sundry_expense',
    amount: tools.roundMoney(sum('taxable') + (hasBefore ? 0 : bill.round_off)),
    input_tax: inputTax.cgst || inputTax.sgst || inputTax.igst || inputTax.cess || (singleHead && inputTax[singleHead]) ? inputTax : undefined,
    supplier: bill.supplier,
    counter: null,
    source_ref: hasBefore ? 'chit:' + bill.id + ':use' : 'chit:' + bill.id,
    against_ref: bill.id,
    due_date: bill.dueDate
  });
}
/** paid at the counter: one payment_made per mode, against this bill */
function paidEvents(bill, paid) {
  return Object.keys(paid || {})
    .filter((mode) => paid[mode])
    .map((mode) =>
      Object.assign({}, bill.base, {
        type: 'payment_made',
        party: bill.supplier,
        mode: mode,
        amount: paid[mode],
        counter: null,
        source_ref: 'chit:' + bill.id + ':paid:' + mode,
        against_ref: bill.id
      })
    );
}

module.exports = { useEvents };
