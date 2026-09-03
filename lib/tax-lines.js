// @stage tested
// @stage-note Tax on the CHIT: rate/HSN/slab on every minted line, the INV-01 invoice for a chit, the month's ledger, GSTR shapes.
'use strict';
/**
 * tax-lines.js — the engine reaches the chit (STUDY-gst-structure-2026-09-04 §6: G1 · G3 · G4).
 *
 * Athi, 2026-09-04: *"as a network entity, we should be able to say, if you use our networking capability your tax
 * liability can be computed or organised — is it possible?"* — and that night: *"complete all on your own."*
 *
 * ── THE THREE THINGS THIS FILE DOES ──────────────────────────────────────────────────────────────────────────
 *   decorate()   G1 — at SEND, every line that names a catalogue item (item_id, else an exact name) gets the rate
 *                     the seller's catalogue resolves for it: gst_rate · hsn · tax_slab · tax_slab_name. The line
 *                     carries its rate for life; a later slab change never re-rates a chit already sent.
 *   invoiceFor() G3 — the INV-01 block for ONE copy of a chit: seller and buyer from identities (GSTIN → state,
 *                     registration type from policy_flags), lines with their rates, lib/tax.js determines. Frozen
 *                     into business_json.invoice when the copy reaches `completed` (the stamp); computed live and
 *                     marked provisional until then.
 *   ledger()     G4 — one GSTIN, one calendar month: output tax by head over my SENT copies, input tax credit by
 *                     head over my RECEIVED copies, net. A self-chit (both parties me) is not a supply and is
 *                     excluded. A copy whose counterparty is a composition dealer or unregistered yields no ITC.
 *   gstr1() / gstr3b() — the offline-tool shapes a return preparer or Tally imports. ⚠️ Best-effort against the
 *                     published formats; validate with the portal's offline tool before filing. WE DO NOT FILE.
 *
 * ── DECISIONS TAKEN WITHOUT ASKING (Athi asleep, "do not ask permission") ──────────────────────────────────────
 *   G3 · freeze at COMPLETED, not at send: completed is the moment both sides have finished, which is what a
 *        stamp means here. Until then the invoice is a live computation labelled `provisional`.
 *   G4 · period = calendar month (the law's); the month is the copy's completed_at when frozen, else sent_at.
 *   G5 · one entity per GSTIN — the network already models it; nothing to build for cross charge until then.
 *
 * ── ZERO DEPENDENCIES beyond siblings (DB access is injected) · TIER A ───────────────────────────────────────
 */
const S = require('./tax-slab');
const tax = require('./tax');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** GSTIN → state code (its first two digits), or null. */
function stateOfGstin(gstn) { const g = String(gstn || '').trim(); return /^\d{2}/.test(g) ? g.slice(0, 2) : null; }

/** A party for tax.determine from an identities row (gstn · display_name · policy_flags · country). */
/**
 * otherPartyId(hdr, me) → the counterparty of MY copy. all_recipients holds the SENDER too ({role:'sender'}) and the
 * receivers as {role:'receiver'|'cc'|'for'} — the first entry is the sender, so "recips[0]" made every sent chit a
 * self-supply and the seller's ledger came back EMPTY ([TAX-03], 2026-09-04). Sent → the 'receiver'; received → the sender.
 */
function otherPartyId(hdr, me) {
  const h = hdr || {};
  const sent = String(h.sender_entity_id) === String(me);
  if (!sent) return h.sender_entity_id ? String(h.sender_entity_id) : null;
  const recips = (Array.isArray(h.all_recipients) ? h.all_recipients : []).filter((r) => r && r.entity_id && String(r.entity_id) !== String(me) && String(r.role || '').toLowerCase() !== 'sender');
  const to = recips.find((r) => ['receiver', 'to', 'act'].includes(String(r.role || '').toLowerCase())) || recips[0];
  return to ? String(to.entity_id) : null;
}

function partyOf(row, extra) {
  const r = row || {};
  const flags = (r.policy_flags && typeof r.policy_flags === 'object') ? r.policy_flags : {};
  return Object.assign({
    Gstin: r.gstn || null, LglNm: r.display_name || null, State: stateOfGstin(r.gstn),
    /* The border a VAT-type scheme turns on (b202). India's GST turns on the state above. */
    Country: r.country ? String(r.country).toUpperCase() : null,
    RegType: String(flags.gst_registration || 'regular'),
  }, extra || {});
}

/**
 * decorate(lines, shelf) → lines with gst_rate · hsn · tax_slab · tax_slab_name where the seller's catalogue answers.
 * `shelf` = { items:[catalogue rows with item_id + item_data], slabs, categories, face } — read once per send by the
 * route. Pure: a line that already carries a rate keeps it; a line that matches nothing is returned untouched.
 */
function decorate(lines, shelf) {
  const sh = shelf || {};
  const items = Array.isArray(sh.items) ? sh.items : [];
  const byId = new Map(), byName = new Map();
  for (const it of items) {
    const d = it.item_data || it;
    if (it.item_id) byId.set(String(it.item_id), d);
    const nm = String(d.name || '').trim().toLowerCase();
    if (nm && !byName.has(nm)) byName.set(nm, d);
  }
  return (Array.isArray(lines) ? lines : []).map((l) => {
    if (!l || typeof l !== 'object') return l;
    if (l.gst_rate !== undefined && l.gst_rate !== null) return l;               // the line already knows
    const d = (l.item_id && byId.get(String(l.item_id)))
           || byName.get(String(l.name || l.particulars || '').trim().toLowerCase());
    if (!d) return l;
    const r = S.resolve({ item_data: d, face: sh.face || {}, slabs: sh.slabs || [], categories: sh.categories || [] });
    if (r.rate === null || r.rate === undefined) return l;
    return Object.assign({}, l, {
      gst_rate: r.rate, cess_rate: r.cess || 0, tax_slab: r.slab_id || null, tax_slab_name: r.name || null,
      /* The product's bill of materials rides on the line AS DETAIL (BACKLOG "BOM": one line, components attached —
         the line count and the totals do not change; what the line is MADE OF travels with it, frozen at send). */
      bom: (l.bom || (Array.isArray(d.bom) && d.bom.length ? d.bom.filter((b) => b && b.item).map((b) => ({ item: String(b.item), qty: Number(b.qty) || 1 })) : undefined)),
      tax_source: r.source, tax_scheme: r.scheme || 'GST', hsn: l.hsn || d.hsn || d.hs_code || d.hsn_code || (r.hsn && r.hsn[0]) || null,
    });
  });
}

/**
 * invoiceFor({ lines, seller, buyer, currency, chit_id, at }) → { invoice (INV-01 shape), rated, unrated, provisional }
 * `rated` / `unrated` say how many lines carried a rate — an invoice with unrated lines is honest about being partial.
 */
function invoiceFor(inp) {
  const i = inp || {};
  const lines = (Array.isArray(i.lines) ? i.lines : []).filter((l) => l && !l.removed);
  const rated = lines.filter((l) => num(l.gst_rate) !== null || num(l.rate) !== null).length;
  const det = tax.determine({
    seller: i.seller || {}, buyer: i.buyer || {},
    lines: lines.map((l) => ({
      id: l.line_id || null, name: l.name || l.particulars || '', qty: num(l.quantity) !== null ? num(l.quantity) : num(l.qty) || 0,
      unit_price: num(l.price) !== null ? num(l.price) : num(l.unit_price) || 0, unit: l.unit || '',
      discount: num(l.discount) || 0, rate: num(l.gst_rate) !== null ? num(l.gst_rate) : (num(l.rate) || 0),
      cess_rate: num(l.cess_rate) || 0, hsn: l.hsn || '', tax_scheme: l.tax_scheme || undefined,
    })),
    priceIncludesTax: !!i.priceIncludesTax, reverseCharge: !!i.reverseCharge,
  });
  return { invoice: Object.assign({ DocDtls: { Typ: 'INV', No: i.chit_id || null, Dt: i.at || null }, currency: i.currency || 'INR' }, det),
           rated, unrated: lines.length - rated, provisional: !i.frozen };
}

/** The heads, summed. */
function heads(inv) {
  const v = (inv && inv.ValDtls) || {};
  return { taxable: r2(v.AssVal), cgst: r2(v.CgstVal), sgst: r2(v.SgstVal), igst: r2(v.IgstVal), cess: r2(v.CesVal),
           vat: r2(v.TaxVal), /* the one head of a non-GST scheme; 0 under GST */
           total: r2(v.TotInvVal), tax: r2((v.CgstVal || 0) + (v.SgstVal || 0) + (v.IgstVal || 0) + (v.CesVal || 0) + (v.TaxVal || 0)) };
}
const zero = () => ({ taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, vat: 0, total: 0, tax: 0 });
const add = (a, b) => { for (const k of Object.keys(a)) a[k] = r2(a[k] + (b[k] || 0)); return a; };

/**
 * ledger(entries, me) → { output, itc, net, count, rows }
 * entries: [{ chit_id, direction:'sent'|'received', invoice, provisional, seller, buyer, at, subject }]
 * ⚠️ ITC only when I am a regular taxpayer AND the seller charged tax (regular seller, not zero-rated to me).
 */
function ledger(entries, me) {
  const myReg = String((me && me.RegType) || 'regular');
  const output = zero(), itc = zero(), rows = [];
  for (const e of (Array.isArray(entries) ? entries : [])) {
    if (!e || !e.invoice) continue;
    const self = e.seller && e.buyer && e.seller.entity_id && e.seller.entity_id === e.buyer.entity_id;
    if (self) continue;                                                  // not a supply
    const h = heads(e.invoice);
    if (e.direction === 'sent') { add(output, h); rows.push(Object.assign({ side: 'output' }, e, { heads: h })); }
    else if (e.direction === 'received') {
      const sellerReg = String((e.seller && e.seller.RegType) || 'regular');
      const eligible = myReg === 'regular' && sellerReg === 'regular' && h.tax > 0;
      if (eligible) add(itc, h);
      rows.push(Object.assign({ side: eligible ? 'itc' : 'no-itc' }, e, { heads: h }));
    }
  }
  const net = { cgst: r2(output.cgst - itc.cgst), sgst: r2(output.sgst - itc.sgst), igst: r2(output.igst - itc.igst),
                cess: r2(output.cess - itc.cess) };
  net.total = r2(net.cgst + net.sgst + net.igst + net.cess);
  return { output, itc, net, count: rows.length, provisional: rows.some((r) => r.provisional), rows };
}

/** GSTR-1 (offline tool JSON, best effort): b2b by counterparty GSTIN, b2cs summary by POS+rate; hsn summary. */
function gstr1(led, me, period) {
  const g = { gstin: (me && me.Gstin) || null, fp: period, version: 'GST3.1.4', hash: 'hash', b2b: [], b2cs: [], hsn: { data: [] } };
  const byCtin = new Map(), b2cs = new Map(), hsn = new Map();
  for (const r of (led.rows || []).filter((x) => x.side === 'output')) {
    const inv = r.invoice, v = inv.ValDtls || {}, pos = (inv._cb && inv._cb.place_of_supply) || (inv.BuyerDtls && inv.BuyerDtls.Pos) || '';
    const itms = (inv.ItemList || []).map((it, i) => ({ num: i + 1, itm_det: { txval: it.AssAmt, rt: it.GstRt, iamt: it.IgstAmt, camt: it.CgstAmt, samt: it.SgstAmt, csamt: it.CesAmt } }));
    (inv.ItemList || []).forEach((it) => { const k = it.HsnCd || '-'; const h = hsn.get(k) || { hsn_sc: k, desc: it.PrdDesc, uqc: it.Unit || 'OTH', qty: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
      h.qty = r2(h.qty + it.Qty); h.txval = r2(h.txval + it.AssAmt); h.iamt = r2(h.iamt + it.IgstAmt); h.camt = r2(h.camt + it.CgstAmt); h.samt = r2(h.samt + it.SgstAmt); h.csamt = r2(h.csamt + it.CesAmt); hsn.set(k, h); });
    const ctin = inv.BuyerDtls && inv.BuyerDtls.Gstin;
    if (ctin && inv.TranDtls && inv.TranDtls.SupTyp !== 'B2C') {
      const e = byCtin.get(ctin) || { ctin, inv: [] };
      e.inv.push({ inum: String(r.chit_id || '').slice(0, 16), idt: String(r.at || '').slice(0, 10), val: v.TotInvVal, pos, rchrg: inv.TranDtls.RegRev || 'N', inv_typ: inv.TranDtls.SupTyp === 'SEZWOP' ? 'SEWOP' : 'R', itms });
      byCtin.set(ctin, e);
    } else {
      (inv.ItemList || []).forEach((it) => { const k = pos + '|' + it.GstRt; const s = b2cs.get(k) || { sply_ty: (inv._cb && inv._cb.supply) === 'inter' ? 'INTER' : 'INTRA', pos, typ: 'OE', rt: it.GstRt, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        s.txval = r2(s.txval + it.AssAmt); s.iamt = r2(s.iamt + it.IgstAmt); s.camt = r2(s.camt + it.CgstAmt); s.samt = r2(s.samt + it.SgstAmt); s.csamt = r2(s.csamt + it.CesAmt); b2cs.set(k, s); });
    }
  }
  g.b2b = [...byCtin.values()]; g.b2cs = [...b2cs.values()]; g.hsn.data = [...hsn.values()].map((h, i) => Object.assign({ num: i + 1 }, h));
  return g;
}
/** GSTR-3B (offline JSON, best effort): outward supplies and eligible ITC. */
function gstr3b(led, me, period) {
  const o = led.output || zero(), i = led.itc || zero();
  return { gstin: (me && me.Gstin) || null, ret_period: period,
    sup_details: { osup_det: { txval: o.taxable, iamt: o.igst, camt: o.cgst, samt: o.sgst, csamt: o.cess } },
    itc_elg: { itc_avl: [{ ty: 'OTH', iamt: i.igst, camt: i.cgst, samt: i.sgst, csamt: i.cess }], itc_net: { iamt: i.igst, camt: i.cgst, samt: i.sgst, csamt: i.cess } },
    _cb: { net: led.net, provisional: !!led.provisional, note: 'Computed from stamped chits on the rail; off-rail purchases are not here. Validate with the offline tool before filing.' } };
}

module.exports = { otherPartyId, stateOfGstin, partyOf, decorate, invoiceFor, heads, ledger, gstr1, gstr3b };
