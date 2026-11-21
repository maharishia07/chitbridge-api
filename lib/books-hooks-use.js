// lib/books-hooks-use.js — the events of a bill whose goods are (partly) for the shop's own use (a part of lib/books-hooks.js, split out to keep its size row)
// OWNS  useEvents(copy, base, supplier, split, paid, round_off, dueDate, setting, asset) → { event, events }: purchase_bill (resale) · purchase_bill accept:'asset' · expense (use) · payment_made per mode
// CALLED BY lib/books-hooks.js (useEventsVerdict); byRateOf and roundMoney are handed in so this file never requires its parent
// FLOW  a classified bill → split by use → one event per kind, each with its own source_ref → the caller posts what has not posted
// CARD 16-finance/books-posting
'use strict';

/** the parent's two helpers handed in (byRateOf groups lines by rate, roundMoney is the books' one money round) → the use-events builder */
module.exports = function booksHooksUse({ byRateOf, roundMoney }) {
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
   */
  function useEvents(copy, base, supplier, split, paid, round_off, dueDate, setting, asset) {
    const id = copy.chit_id,
      events = [],
      hasResale = split.resale.length > 0,
      hasAsset = split.asset.length > 0;
    if (hasResale)
      events.push(
        Object.assign({}, base, {
          type: 'purchase_bill',
          party: supplier,
          by_rate: byRateOf({ ItemList: split.resale, _cb: split._cb }).rows,
          paid: {},
          round_off,
          counter: null,
          source_ref: 'chit:' + id,
          against_ref: id,
          due_date: dueDate
        })
      );
    /* ⭐ AN ASSET LINE (engines v1.14 R2): the purchase rule with accept: 'asset' puts the cost on the class's PPE ledger; the register row
       (lib/books-assets) is made by postChit once THIS entry has posted — `asset_register` is what it needs, never read by the engine */
    if (hasAsset)
      events.push(
        Object.assign({}, base, {
          type: 'purchase_bill',
          accept: 'asset',
          asset_class: asset.class,
          put_to_use: asset.put_to_use,
          party: supplier,
          by_rate: byRateOf({ ItemList: split.asset, _cb: split._cb }).rows,
          paid: {},
          round_off: hasResale ? 0 : round_off,
          counter: null,
          source_ref: hasResale ? 'chit:' + id + ':asset' : 'chit:' + id,
          against_ref: id,
          due_date: dueDate,
          asset_register: asset.register
        })
      );
    const hasBefore = hasResale || hasAsset;
    if (split.use.length) {
      const list = byRateOf({ ItemList: split.use, _cb: split._cb }).rows;
      const sum = (field) => roundMoney(list.reduce((total, item) => total + (item[field] || 0), 0));
      const inputTax = { cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), cess: sum('cess') };
      const singleHead = split._cb && split._cb.scheme ? String(split._cb.scheme).toLowerCase() : null;
      if (singleHead && sum(singleHead)) inputTax[singleHead] = sum(singleHead); /* AU GST: the one head (byRateOf) */
      events.push(
        Object.assign({}, base, {
          type: 'expense',
          class: (setting && setting.use_class) || 'sundry_expense',
          amount: roundMoney(sum('taxable') + (hasBefore ? 0 : round_off)),
          input_tax: inputTax.cgst || inputTax.sgst || inputTax.igst || inputTax.cess || (singleHead && inputTax[singleHead]) ? inputTax : undefined,
          supplier: supplier,
          counter: null,
          source_ref: hasBefore ? 'chit:' + id + ':use' : 'chit:' + id,
          against_ref: id,
          due_date: dueDate
        })
      );
    }
    for (const mode of Object.keys(paid || {}))
      if (paid[mode])
        events.push(
          Object.assign({}, base, {
            type: 'payment_made',
            party: supplier,
            mode: mode,
            amount: paid[mode],
            counter: null,
            source_ref: 'chit:' + id + ':paid:' + mode,
            against_ref: id
          })
        );
    return { event: events[0], events };
  }
  return { useEvents };
};
