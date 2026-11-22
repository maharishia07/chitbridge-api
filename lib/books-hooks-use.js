/**
 * books-hooks-use.js — the events of a bill whose goods are (partly) for the shop's own use (a part of books-hooks.js, split out to keep its size row)
 * OWNER     cb-accounting (the posting) with cb-operations (the bill's use)
 * RISK      money (every event posts to the ledger)
 * OWNS      useEvents(tools, copy, base, supplier, split, paid, round_off, dueDate, setting, asset) → { event, events }: purchase_bill (resale) · purchase_bill accept:'asset' · expense (use) · payment_made per mode
 * CALLED BY lib/books-hooks.js (useEventsVerdict, through its one-line wrapper that hands in byRateOf, roundMoney and sumOf, so this file never requires its parent)
 * FLOW      a classified bill ──▶ split by use ──▶ one event per kind, each with its own source_ref ──▶ the caller posts what has not posted
 * CARD      16-finance/books-posting
 */
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
 * `tools` = { byRateOf, roundMoney, sumOf }: the parent's helpers, handed in (the money arithmetic stays in books-hooks.js, where the money-scan baseline counts it).
 */
function useEvents(tools, copy, base, supplier, split, paid, round_off, dueDate, setting, asset, underRcm) {
  const bill = { id: copy.chit_id, base, supplier, split, round_off, dueDate, underRcm };
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
    by_rate: tools.byRateOf({ ItemList: bill.split.resale, _cb: bill.split._cb }, bill.base.currency).rows,
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
    by_rate: tools.byRateOf({ ItemList: bill.split.asset, _cb: bill.split._cb }, bill.base.currency).rows,
    paid: {},
    round_off: hasResale ? 0 : bill.round_off,
    counter: null,
    source_ref: hasResale ? 'chit:' + bill.id + ':asset' : 'chit:' + bill.id,
    against_ref: bill.id,
    due_date: bill.dueDate,
    asset_register: asset.register
  });
}
/** the input tax of the use lines, summed per head from the rate rows (undefined when no head carries any) */
function inputTaxOf(tools, list, singleHead) {
  const sum = (field) => tools.sumOf(list, field);
  const inputTax = { cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), cess: sum('cess') };
  if (singleHead && sum(singleHead)) inputTax[singleHead] = sum(singleHead); /* AU GST: the one head (byRateOf) */
  const carried = inputTax.cgst || inputTax.sgst || inputTax.igst || inputTax.cess || (singleHead && inputTax[singleHead]);
  return carried ? inputTax : undefined;
}
/** use lines: the expense */
function expenseEvent(tools, bill, setting, hasBefore) {
  const list = tools.byRateOf({ ItemList: bill.split.use, _cb: bill.split._cb }, bill.base.currency).rows;
  const singleHead = bill.split._cb && bill.split._cb.scheme ? String(bill.split._cb.scheme).toLowerCase() : null;
  const taxable = tools.sumOf(list, 'taxable');
  const useClass = (setting && setting.use_class) || 'sundry_expense',
    useRef = hasBefore ? 'chit:' + bill.id + ':use' : 'chit:' + bill.id;
  /* ⭐ J-F-06: a part for use under REVERSE CHARGE (freight, legal fees) cannot ride an `expense` event (it carries no rcm rows): it is the engine's purchase_bill accepted for use — Dr the expense class + the reverse-charge tax · Cr the supplier, never Purchases of stock-in-trade (posting.purchaseBase_ accept 'use') */
  if (bill.underRcm)
    return Object.assign({}, bill.base, { type: 'purchase_bill', accept: 'use', class: useClass, party: bill.supplier, by_rate: list, paid: {}, round_off: hasBefore ? 0 : bill.round_off, counter: null, source_ref: useRef, against_ref: bill.id, due_date: bill.dueDate });
  return Object.assign({}, bill.base, {
    type: 'expense',
    class: useClass,
    amount: tools.roundMoney(taxable + (hasBefore ? 0 : bill.round_off), bill.base.currency),
    input_tax: inputTaxOf(tools, list, singleHead),
    supplier: bill.supplier,
    counter: null,
    source_ref: useRef,
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
