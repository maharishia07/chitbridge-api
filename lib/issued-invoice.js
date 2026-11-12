// @stage tested
// CALLED BY lib/tax-copy.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
// CARD 15-tax-and-country-packs/tax-compute-rate-invoice-tax
// @stage-note ONE invoice, everywhere: the check that may only NAME a difference from the invoice a counter issued.
'use strict';
/**
 * issued-invoice.js — ONE THING, AND NOTHING THAT COMPUTES AN INVOICE (Athi, 2026-10-02: "the computation should happen in
 * only one place like billing, rest all the places the value has to only read, no recomputation … recomputation can be done,
 * but cannot rewrite what has been already wrote").
 *
 * The invoice is computed ONCE, at the counter, by the engine — CBTax.determine() (lib/tax.js) inside till.html billMoney() —
 * and its result travels unchanged as business_json.invoice, the frozen invoice lib/tax-copy entryFor posts both ledgers
 * from. The place-of-supply rule and the reading of an issued invoice are the engine's (lib/tax.js placeOfSupply, moneyOf —
 * window.CBTax on the counter), never a copy here. What is left for the server is:
 *   · check() — the server's recompute, demoted: it compares two INV-01 invoices and NAMES a difference. It never returns a
 *     figure anyone posts.
 *   · priceBasisOf() — ACC-301: the price basis an issued invoice carries (read, never recomputed), for a note priced on it.
 * OWNS      the check of an issued invoice against the server's recompute, and the reading of its price basis.
 * CALLED BY lib/tax-copy.js (check) · lib/chit-proposal.js priceMoney (priceBasisOf).
 * FLOW      issued invoice (business_json.invoice) → priceBasisOf → send-money.invoiceOfLines { priceIncludesTax } → the note's money.
 */
const { round: r2m } = require('./money');
const r2 = (n) => r2m(Number(n) || 0);

/**
 * check(issued, server) → { ok, differences: [{ what, issued, server }], says } — THE RECOMPUTE, ONLY TO CHECK. `issued` is
 * the stored invoice (determine() at the counter), `server` lib/tax-lines invoiceFor()'s over the same lines and parties.
 * Compared: the place of supply, the supply, the taxable value, each head and the total — in total and rate by rate — and
 * the issued invoice's own sum (TotInvVal = AssVal + the heads + RndOffAmt). Any difference above ₹0.00 is named; `says` is
 * the one line a person (or the health view) reads. Nothing here is ever written over the issued invoice.
 */
function check(issued, server) {
  const out = [],
    iv = (issued && issued.ValDtls) || {},
    sv = (server && server.ValDtls) || {};
  const ic = (issued && issued._cb) || {},
    sc = (server && server._cb) || {};
  const say = (what, nestedA, nestedB) => out.push({ what, issued: nestedA, server: nestedB });
  if (String(ic.place_of_supply || '') !== String(sc.place_of_supply || '')) say('place_of_supply', ic.place_of_supply || null, sc.place_of_supply || null);
  if (String(ic.supply || '') !== String(sc.supply || '')) say('supply', ic.supply || null, sc.supply || null);
  for (const [k, n] of [
    ['AssVal', 'taxable'],
    ['CgstVal', 'cgst'],
    ['SgstVal', 'sgst'],
    ['IgstVal', 'igst'],
    ['CesVal', 'cess'],
    ['TotInvVal', 'total']
  ]) {
    if (r2(iv[k]) !== r2(sv[k])) say(n, r2(iv[k]), r2(sv[k]));
  }
  const slab = (inv) => {
    const m = {};
    for (const s of (inv && inv._cb && inv._cb.slabs) || []) m[String(s.GstRt)] = s;
    return m;
  };
  const a = slab(issued),
    b = slab(server);
  for (const rt of Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort((x, y) => Number(x) - Number(y))) {
    const x = a[rt] || {},
      y = b[rt] || {};
    const tx = (s) => r2((Number(s.CgstVal) || 0) + (Number(s.SgstVal) || 0) + (Number(s.IgstVal) || 0));
    if (r2(x.AssVal) !== r2(y.AssVal)) say('taxable at ' + rt + '%', r2(x.AssVal), r2(y.AssVal));
    if (tx(x) !== tx(y)) say('tax at ' + rt + '%', tx(x), tx(y));
  }
  const own = r2(r2(iv.AssVal) + r2(iv.CgstVal) + r2(iv.SgstVal) + r2(iv.IgstVal) + r2(iv.CesVal) + r2(iv.TaxVal));
  if (r2(iv.TotInvVal) !== r2(own + r2(iv.RndOffAmt))) say("the invoice's own sum", r2(iv.TotInvVal), r2(own + r2(iv.RndOffAmt)));
  return { ok: out.length === 0, differences: out, says: out.map((item) => item.what + ': issued ' + item.issued + ', server ' + item.server).join(' · ') };
}

/** a tax amount of one issued line, in major units: the heads and the cess it carries (a non-GST scheme's single head is TaxAmt) */
const lineTax = (item) => ['IgstAmt', 'CgstAmt', 'SgstAmt', 'TaxAmt', 'CesAmt'].reduce((sum, key) => sum + (Number(item[key]) || 0), 0);
/** ACC-301 · one issued line's basis from its own figures: true (TotItemVal = the priced amount) · false (= priced + tax) · null (no tax on it, or it fits neither) */
function lineBasisOf(item) {
  const taxAmount = r2(lineTax(item));
  if (!taxAmount) return null;
  const priced = r2((item.TotAmt != null ? Number(item.TotAmt) : (Number(item.UnitPrice) || 0) * (Number(item.Qty) || 0)) - (Number(item.Discount) || 0));
  const total = r2(item.TotItemVal);
  if (total === priced) return true;
  return total === r2(priced + taxAmount) ? false : null;
}
/**
 * ACC-301 · the basis an ISSUED invoice was priced on → true (the prices held the tax) · false (the tax was added) · null (cannot be told).
 * Read, never recomputed: the engine stamps it on every invoice (_cb.price_includes_tax, lib/tax.js). An invoice issued before the stamp is told from its own
 * lines: TotItemVal equals the priced amount (UnitPrice x Qty - Discount) when inclusive, and that amount plus the line's tax when exclusive; a line with no tax
 * cannot tell and is passed over (an invoice of such lines only prices the same on either basis: false). The seller's LIVE flag is never the answer for a document that is already issued.
 */
function priceBasisOf(invoice) {
  const stamped = invoice && invoice._cb && invoice._cb.price_includes_tax;
  if (typeof stamped === 'boolean') return stamped;
  const items = (invoice && Array.isArray(invoice.ItemList) && invoice.ItemList) || [];
  const told = items.map(lineBasisOf).find((basis) => basis !== null);
  return told !== undefined ? told : items.length ? false : null; /* every line tax-free: either basis prices it the same */
}

module.exports = { check, priceBasisOf };
