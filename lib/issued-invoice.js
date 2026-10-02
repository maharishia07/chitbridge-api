// @stage tested
// @stage-note ONE invoice, everywhere: the figures a counter printed travel on the chit and are what the server stores, posts and reprints.
'use strict';
/**
 * issued-invoice.js — THE INVOICE A COUNTER ISSUED IS THE INVOICE (Athi, DECISIONS.md, 2026-10-02).
 *
 * *"The figures the counter prints ARE the invoice (CGST Act s.31, Rule 46; the buyer's ITC s.16 rests on the invoice as
 * issued) … Nothing recomputes a different tax for an issued invoice; a recompute may only CHECK and name a difference.
 * The total is taxable + tax rounded once, with the round-off declared."*
 *
 * The diagnosis (docs/tasks/TAX-TRUTH-2026-10-02.md): bill C2/26-27/0007 read six ways gave three answers. The counter said
 * ₹998.21 + ₹119.95 CGST/SGST = ₹1,118.16; the server, rebuilding from lines that had lost their tax, said IGST, a total of
 * ₹1,118.15, and a reprint with GST ₹0.00 on a TAX INVOICE. So:
 *   · the counter carries its invoice on the chit — business_json.invoice (issued: 'counter') and per line gross · taxable ·
 *     tax · cgst · sgst · igst (tools/tally-connector/till.html invoiceOf / chitOf, and till.js chitOf);
 *   · toInvoice() turns that carried block into the INV-01 shape every reader already speaks (lib/tax-copy entryFor → the
 *     seller's ledger, the buyer's ledger, GSTR-1, /api/tax/invoice), BY VALUE — nothing is worked out again;
 *   · check() is the recompute, demoted: it compares and NAMES a difference, and never replaces a figure;
 *   · placeOfSupply() is the ONE place-of-supply rule, the counter and the server alike.
 *
 * ⚠️ `business_json.invoice` WAS ALREADY A KEY: the stamp freezeOnComplete() writes (the INV-01 block, ValDtls and all).
 * A counter's block says `issued: 'counter'` and has no ValDtls, so the two can never be read as each other; and since a
 * stamp is never written over an invoice that is already there, the counter's block IS that chit's stamp.
 */
const { round: r2m } = require('./money');
const r2 = (n) => r2m(Number(n) || 0);
const fin = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

/**
 * ⭐⭐⭐ PLACE OF SUPPLY — ONE RULE, THE COUNTER AND THE SERVER ALIKE (IGST Act s.10(1)(a); Athi, 2026-10-02).
 * Goods: where their movement terminates for delivery. A counter bill is handed over at the counter, so it is the SHOP's
 * state — CGST + SGST, even for a registered buyer from another state. Only a bill that RECORDS a delivery to a state
 * (`delivery.state_code`) is supplied there; another state than the shop's makes it inter-state → IGST.
 * ⚠️ WRITTEN ONCE, IN THE SUBSET BOTH HOSTS RUN: tools/tally-connector/till.html carries this function's text byte for
 * byte (tests/tax-truth.test.cjs compares them), because the counter page loads no lib file. Change both or neither.
 */
function placeOfSupply(rec, shopState) {
  var shop = String(shopState == null ? '' : shopState).trim();
  var d = (rec && typeof rec === 'object' && rec.delivery && typeof rec.delivery === 'object') ? rec.delivery : null;
  var to = d ? String(d.state_code == null ? '' : d.state_code).trim() : '';
  if (/^\d$/.test(to)) to = '0' + to;
  return /^\d{2}$/.test(to) ? to : shop;
}

/** the counter's carried invoice on a chit, or null — older bills and other hosts carry none (they keep today's path) */
function issuedOf(bj) {
  const v = bj && typeof bj === 'object' ? bj.invoice : null;
  if (!v || typeof v !== 'object' || v.issued !== 'counter' || v.ValDtls) return null;
  return fin(v.taxable) && fin(v.tax) && fin(v.total) ? v : null;
}

const sumOf = (list, k) => r2((list || []).reduce((a, x) => a + (Number(x && x[k]) || 0), 0));
const lineOk = (l) => l && fin(l.taxable) && fin(l.tax);

/** the heads of the carried block, summed (CGST · SGST · IGST) — from the lines when they carry them, else by rate */
function headsOf(block, lines) {
  const ls = (lines || []).filter((l) => l && !l.removed);
  if (ls.length && ls.every(lineOk) && ls.some((l) => fin(l.cgst) || fin(l.igst))) {
    return { cgst: sumOf(ls, 'cgst'), sgst: sumOf(ls, 'sgst'), igst: sumOf(ls, 'igst') };
  }
  const by = block.by_rate || {};
  return { cgst: sumOf(Object.values(by), 'cgst'), sgst: sumOf(Object.values(by), 'sgst'), igst: sumOf(Object.values(by), 'igst') };
}

/**
 * toInvoice({ block, lines, seller, buyer, currency, chit_id, doc_no, at }) → the INV-01 shape lib/tax.js determine() returns,
 * built BY VALUE from what the counter issued: AssAmt is the line's carried taxable, the heads its carried heads, TotInvVal
 * the carried total, RndOffAmt the declared difference. `seller`/`buyer` are the parties (lib/tax-copy partiesFor).
 * ⚠️ A block whose lines did not travel with their figures (a block with no per-line tax) is written per RATE from by_rate —
 * still the issued figures, said so in the notes — never re-split from the lines.
 */
function toInvoice(inp) {
  const i = inp || {}, b = i.block, seller = i.seller || {}, buyer = i.buyer || {};
  const lines = (Array.isArray(i.lines) ? i.lines : []).filter((l) => l && !l.removed);
  const supply = b.supply === 'inter' ? 'inter' : (b.supply === 'intra' ? 'intra' : String(b.supply || 'unknown'));
  const notes = [];
  let ItemList;
  if (lines.length && lines.every(lineOk)) {
    ItemList = lines.map((l, k) => {
      const qty = Number(l.quantity != null ? l.quantity : l.qty) || 0, price = Number(l.price) || 0;
      const tax = r2(l.tax), heads = fin(l.cgst) || fin(l.igst) ? { cgst: r2(l.cgst), sgst: r2(l.sgst), igst: r2(l.igst) }
        : (supply === 'inter' ? { cgst: 0, sgst: 0, igst: tax } : { cgst: r2(tax / 2), sgst: r2(tax - r2(tax / 2)), igst: 0 });
      return { SlNo: String(k + 1), PrdDesc: String(l.particulars || l.name || ''), IsServc: 'N', HsnCd: String(l.hsn || ''),
               Qty: qty, Unit: String(l.unit || ''), UnitPrice: r2(price), TotAmt: fin(l.gross) ? r2(l.gross) : r2(qty * price),
               Discount: r2((l.offer && l.offer.off) || l.discount || 0), AssAmt: r2(l.taxable), GstRt: Number(l.gst_rate) || 0,
               IgstAmt: heads.igst, CgstAmt: heads.cgst, SgstAmt: heads.sgst, TaxAmt: 0, CesRt: 0, CesAmt: 0,
               TotItemVal: r2(Number(l.taxable) + tax), _line_id: l.line_id || null };
    });
  } else {
    const by = b.by_rate || {};
    ItemList = Object.keys(by).sort((x, y) => Number(x) - Number(y)).map((rt, k) => {
      const o = by[rt] || {}, tax = r2(o.tax);
      const h = fin(o.cgst) || fin(o.igst) ? { cgst: r2(o.cgst), sgst: r2(o.sgst), igst: r2(o.igst) }
        : (supply === 'inter' ? { cgst: 0, sgst: 0, igst: tax } : { cgst: r2(tax / 2), sgst: r2(tax - r2(tax / 2)), igst: 0 });
      return { SlNo: String(k + 1), PrdDesc: 'Goods at ' + rt + '%', IsServc: 'N', HsnCd: '', Qty: 1, Unit: '', UnitPrice: r2(o.base),
               TotAmt: r2(o.base), Discount: 0, AssAmt: r2(o.base), GstRt: Number(rt), IgstAmt: h.igst, CgstAmt: h.cgst, SgstAmt: h.sgst,
               TaxAmt: 0, CesRt: 0, CesAmt: 0, TotItemVal: r2(Number(o.base) + tax), _line_id: null };
    });
    notes.push('The bill\'s lines did not carry their own tax, so the invoice is stated rate by rate, as the counter issued it.');
  }
  const h = headsOf(b, lines);
  const AssVal = r2(b.taxable), total = r2(b.total);
  const bySlab = {};
  for (const it of ItemList) {
    const s = bySlab[it.GstRt] || (bySlab[it.GstRt] = { GstRt: it.GstRt, AssVal: 0, CgstVal: 0, SgstVal: 0, IgstVal: 0 });
    s.AssVal = r2(s.AssVal + it.AssAmt); s.CgstVal = r2(s.CgstVal + it.CgstAmt); s.SgstVal = r2(s.SgstVal + it.SgstAmt); s.IgstVal = r2(s.IgstVal + it.IgstAmt);
  }
  const pos = String(b.pos_state || '');
  const unreg = String(buyer.RegType || '').toLowerCase() === 'unregistered';
  const pick = (o, ks) => { const out = {}; for (const k of ks) if (o[k] !== undefined && o[k] !== null && String(o[k]) !== '') out[k] = o[k]; return out; };
  return {
    DocDtls: { Typ: 'INV', No: i.doc_no || i.chit_id || null, Dt: i.at || null }, currency: i.currency || 'INR',
    TranDtls: { TaxSch: 'GST', SupTyp: buyer.Gstin && !unreg ? 'B2B' : 'B2C', RegRev: 'N', IgstOnIntra: 'N' },
    SellerDtls: pick(seller, ['Gstin', 'LglNm', 'TrdNm', 'Addr1', 'Addr2', 'Loc', 'Pin', 'State', 'Ph', 'Em']),
    BuyerDtls: Object.assign(pick(buyer, ['Gstin', 'LglNm', 'TrdNm', 'Addr1', 'Addr2', 'Loc', 'Pin', 'State', 'Ph', 'Em']), { Pos: pos }),
    ItemList,
    ValDtls: { AssVal, CgstVal: h.cgst, SgstVal: h.sgst, IgstVal: h.igst, CesVal: 0, StCesVal: 0, Discount: sumOf(ItemList, 'Discount'),
               RndOffAmt: r2(total - r2(AssVal + Number(b.tax))), TotInvVal: total, TaxVal: 0 },
    _cb: { scheme: 'GST', supply, place_of_supply: pos, seller_state: String(seller.State || ''), slabs: Object.values(bySlab),
           amount_payable: total, reverse_charge: false, price_includes_tax: !!b.priced_inclusive, issued: 'counter',
           /* the paisa between the shelf prices and the invoice — declared on the bill, never lost (₹1,118.15 → ₹1,118.16) */
           counter_round_off: fin(b.round_off) ? r2(b.round_off) : 0, notes },
  };
}

/**
 * check(issued, server) → { ok, differences: [{ what, issued, server }] } — THE RECOMPUTE, ONLY TO CHECK. `issued` is
 * toInvoice()'s, `server` lib/tax-lines invoiceFor()'s over the same lines and parties. Compared: the place of supply, the
 * supply, the taxable value and each head — in total and rate by rate — and the block's own sum (total = taxable + tax).
 * ⚠️ The TOTAL is not compared with the server's: lib/tax.js rounds an invoice to the whole rupee, the counter to the paisa;
 * that is a rounding convention, not a tax. Any difference above ₹0.00 is named; none is ever written over the issued one.
 */
function check(issued, server) {
  const out = [], iv = (issued && issued.ValDtls) || {}, sv = (server && server.ValDtls) || {};
  const ic = (issued && issued._cb) || {}, sc = (server && server._cb) || {};
  const say = (what, a, b) => out.push({ what, issued: a, server: b });
  if (String(ic.place_of_supply || '') !== String(sc.place_of_supply || '')) say('place_of_supply', ic.place_of_supply || null, sc.place_of_supply || null);
  if (String(ic.supply || '') !== String(sc.supply || '')) say('supply', ic.supply || null, sc.supply || null);
  for (const [k, n] of [['AssVal', 'taxable'], ['CgstVal', 'cgst'], ['SgstVal', 'sgst'], ['IgstVal', 'igst']]) {
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
  const own = r2(r2(iv.AssVal) + r2(iv.CgstVal) + r2(iv.SgstVal) + r2(iv.IgstVal));
  if (r2(iv.TotInvVal) !== r2(own + r2(iv.RndOffAmt))) say('total', r2(iv.TotInvVal), own);
  return { ok: out.length === 0, differences: out };
}

/** the check, in one line a person (or the health view) can read — "tax at 12%: issued 119.51, server 119.49" */
function checkWords(c) {
  if (!c || c.ok) return '';
  return c.differences.map((d) => d.what + ': issued ' + d.issued + ', server ' + d.server).join(' · ');
}

/**
 * headerMoney(block, lines) → what a counter bill's chit header carries: the figures as ISSUED — total_value is the invoice
 * total (taxable + tax, rounded once), never the sum of line nets (₹1,118.15 for a ₹1,118.16 bill: the round-off, lost).
 */
function headerMoney(block, lines) {
  const li = Array.isArray(lines) ? lines : [];
  const qty = (l) => Number(l.quantity != null ? l.quantity : l.qty) || 0;
  const gross = r2(li.reduce((a, l) => a + (fin(l.gross) ? Number(l.gross) : (Number(l.list_price != null ? l.list_price : l.price) || 0) * qty(l)), 0));
  const net = r2(li.reduce((a, l) => a + (Number(l.total != null ? l.total : (Number(l.price) || 0) * qty(l)) || 0), 0));
  return { total_value: r2(block.total),
           money: { gross, savings: r2(gross - net), net, taxable: r2(block.taxable), tax: r2(block.tax), total: r2(block.total),
                    round_off: fin(block.round_off) ? r2(block.round_off) : 0, provisional: false, issued: true } };
}

/**
 * billRow(x) → one row of "Earlier bills" (routes/till.js GET /api/till/bills), from a chit header + its lines. The row
 * carries the INVOICE as issued — so a reprint prints the original (till.html slipOfRow) — and each line its gross,
 * taxable and tax. `invoice` is null for a bill that never carried one; the slip then says so rather than GST 0.00.
 */
function billRow(x) {
  const b = x.business_json || {}, t = b.till || {}, s = x.summary_json || {}, m = s.money || {};
  const inv = issuedOf(b);
  const n = (v) => (fin(v) ? r2(v) : null);
  return { chit_id: x.chit_id, no: b.bill_no || null, at: b.billed_at || x.created_at,
           customer: (b.customer && b.customer.name) || 'Walk-in',
           by: t.by || null, till: { id: t.id || null, name: t.name || null },
           total: inv ? r2(inv.total) : (m.total != null ? m.total : (m.net != null ? m.net : s.total_value)),
           saved: m.savings != null ? m.savings : null,
           taxable: inv ? r2(inv.taxable) : (m.net != null ? m.net : null), tax: inv ? r2(inv.tax) : (m.tax != null ? m.tax : null),
           kind: b.slip || 'cash',
           payments: (b.payment && b.payment.parts) || [],
           invoice: inv,
           lines: (Array.isArray(x.line_items) ? x.line_items : []).map((l) => ({
             name: l.particulars || l.name, qty: l.quantity, unit: l.unit, price: l.price, net: l.total,
             gross: fin(l.gross) ? r2(l.gross) : r2((Number(l.price) || 0) * (Number(l.quantity) || 0)),
             taxable: n(l.taxable), tax: n(l.tax),
             save: (l.offer && l.offer.off) || 0, off: !!l.offer, off_label: (l.offer && l.offer.label) || '', offers: l.offers || undefined,
             gst_rate: l.gst_rate, hsn: l.hsn })) };
}

module.exports = { placeOfSupply, issuedOf, toInvoice, check, checkWords, headerMoney, billRow };
