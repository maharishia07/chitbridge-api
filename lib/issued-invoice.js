// @stage tested
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
  const out = [], iv = (issued && issued.ValDtls) || {}, sv = (server && server.ValDtls) || {};
  const ic = (issued && issued._cb) || {}, sc = (server && server._cb) || {};
  const say = (what, a, b) => out.push({ what, issued: a, server: b });
  if (String(ic.place_of_supply || '') !== String(sc.place_of_supply || '')) say('place_of_supply', ic.place_of_supply || null, sc.place_of_supply || null);
  if (String(ic.supply || '') !== String(sc.supply || '')) say('supply', ic.supply || null, sc.supply || null);
  for (const [k, n] of [['AssVal', 'taxable'], ['CgstVal', 'cgst'], ['SgstVal', 'sgst'], ['IgstVal', 'igst'], ['CesVal', 'cess'], ['TotInvVal', 'total']]) {
    if (r2(iv[k]) !== r2(sv[k])) say(n, r2(iv[k]), r2(sv[k]));
  }
  const slab = (inv) => { const m = {}; for (const s of ((inv && inv._cb && inv._cb.slabs) || [])) m[String(s.GstRt)] = s; return m; };
  const a = slab(issued), b = slab(server);
  for (const rt of Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort((x, y) => Number(x) - Number(y))) {
    const x = a[rt] || {}, y = b[rt] || {};
    const tx = (s) => r2((Number(s.CgstVal) || 0) + (Number(s.SgstVal) || 0) + (Number(s.IgstVal) || 0));
    if (r2(x.AssVal) !== r2(y.AssVal)) say('taxable at ' + rt + '%', r2(x.AssVal), r2(y.AssVal));
    if (tx(x) !== tx(y)) say('tax at ' + rt + '%', tx(x), tx(y));
  }
  const own = r2(r2(iv.AssVal) + r2(iv.CgstVal) + r2(iv.SgstVal) + r2(iv.IgstVal) + r2(iv.CesVal) + r2(iv.TaxVal));
  if (r2(iv.TotInvVal) !== r2(own + r2(iv.RndOffAmt))) say('the invoice\'s own sum', r2(iv.TotInvVal), r2(own + r2(iv.RndOffAmt)));
  return { ok: out.length === 0, differences: out, says: out.map((d) => d.what + ': issued ' + d.issued + ', server ' + d.server).join(' · ') };
}

module.exports = { check };
