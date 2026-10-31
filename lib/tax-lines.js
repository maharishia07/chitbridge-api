// @stage tested
// CALLED BY lib/books-manual.js, lib/books-pack.js, lib/services.js, lib/tax-copy.js, routes/books.js (+3 more)   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
// CARD 15-tax-and-country-packs/tax-compute-rate-invoice-tax
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
const { round: roundMoney } = require('./money'); /* ⭐ money.round — the one rounder (SPEC-money-one-reader.md): half away from zero, on the decimal value */
const tax = require('./tax');
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const uom = require('./units'); /* ⭐ ONE UNIT, THREE NAMES — ours, UN/ECE Rec 20, and India's GST UQC */
const r2 = (n) => roundMoney(Number(n) || 0);

/** GSTIN → state code (its first two digits), or null. */
function stateOfGstin(gstn) {
  const g = String(gstn || '').trim();
  return /^\d{2}/.test(g) ? g.slice(0, 2) : null;
}
/**
 * ⭐ STD2: does a country's tax turn on the STATE? The pack's supply rule (tax-packs: `supply 'state'` = India's CGST/SGST · IGST; a border pack —
 * Australia, the UAE — has one head and no state). No pack known → true, as till /snapshot's stateSplit always read it. ONE reading: the till's
 * shop block and its supplier list both ask here.
 */
function splitsByState(country) {
  const p = require('./tax-packs').packFor(country);
  return !p || !p.supply || p.supply === 'state';
}
/** stateUnder(gstn, country) → the state a tax number names, only under a state-split pack (an ABN's or a TRN's first digits are not a state) */
function stateUnder(gstn, country) {
  return splitsByState(country) ? stateOfGstin(gstn) : null;
}

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
  const recips = (Array.isArray(h.all_recipients) ? h.all_recipients : []).filter(
    (item) => item && item.entity_id && String(item.entity_id) !== String(me) && String(item.role || '').toLowerCase() !== 'sender'
  );
  const to = recips.find((item) => ['receiver', 'to', 'act'].includes(String(item.role || '').toLowerCase())) || recips[0];
  return to ? String(to.entity_id) : null;
}

function partyOf(row, extra) {
  const r = row || {};
  const flags = r.policy_flags && typeof r.policy_flags === 'object' ? r.policy_flags : {};
  /* T2-NATDEF: the party's own pack says whether its tax turns on the state (tax-packs supply 'state'), never the literal India */
  const pk = r.country ? require('./tax-packs').packFor(String(r.country).toUpperCase()) : null;
  return Object.assign(
    {
      /* CX0: a state is read off the tax number only under a state-split GST — an ABN's or a TRN's first digits are not a state */
      Gstin: r.gstn || null,
      LglNm: r.display_name || null,
      State: !r.country || (pk && pk.supply === 'state') ? stateOfGstin(r.gstn) : null,
      /* The border a VAT-type scheme turns on (b202). India's GST turns on the state above. */
      Country: r.country ? String(r.country).toUpperCase() : null,
      RegType: regTypeOf(r, flags)
    },
    extra || {}
  );
}
/**
 * the party's RegType. A row read WITHOUT the governance row (no `tax_registration` key) carries the scheme as stated, regular when none (a
 * flag nobody set is a scheme, not a registration). A row that carries it answers country-setup.registrationOf — 'unknown' when nobody said (ACC-198).
 */
function regTypeOf(row, flags) {
  const flag = String(flags.gst_registration || 'regular');
  if (!Object.prototype.hasOwnProperty.call(row, 'tax_registration')) return flag;
  const answer = require('./country-setup').registrationOf({ number: row.gstn, scheme: flags.gst_registration, tax_registration: row.tax_registration });
  return answer === 'regular' ? flag : answer;
}

/**
 * decorate(lines, shelf) → lines with gst_rate · hsn · tax_slab · tax_slab_name where the seller's catalogue answers.
 * `shelf` = { items:[catalogue rows with item_id + item_data], slabs, categories, face } — read once per send by the
 * route. Pure: a line that already carries a rate keeps it; a line that matches nothing is returned untouched.
 */
/** resolveItem(item_data, shelf) → tax-slab.resolve's answer for one product on this shelf. ONE place the shelf meets the slab rule: decorate (every
 *  line) and Home's Tax Lab count (lib/home-facts taxLab: source 'none' = no slab on the product, its categories or the catalogue) both read it. */
function resolveItem(d, shelf) {
  const sh = shelf || {};
  return S.resolve({ item_data: d || {}, face: sh.face || {}, slabs: sh.slabs || [], categories: sh.categories || [] });
}
function decorate(lines, shelf) {
  const sh = shelf || {};
  const items = Array.isArray(sh.items) ? sh.items : [];
  const byId = new Map(),
    byName = new Map();
  for (const it of items) {
    const d = it.item_data || it;
    if (it.item_id) byId.set(String(it.item_id), d);
    const nm = String(d.name || '')
      .trim()
      .toLowerCase();
    if (nm && !byName.has(nm)) byName.set(nm, d);
  }
  return (Array.isArray(lines) ? lines : []).map((l) => {
    if (!l || typeof l !== 'object') return l;
    if (l.gst_rate !== undefined && l.gst_rate !== null) return l; // the line already knows
    const d =
      (l.item_id && byId.get(String(l.item_id))) ||
      byName.get(
        String(l.name || l.particulars || '')
          .trim()
          .toLowerCase()
      );
    if (!d) return l;
    const r = resolveItem(d, sh);
    if (r.rate === null || r.rate === undefined) return l;
    return Object.assign({}, l, {
      gst_rate: r.rate,
      cess_rate: r.cess || 0,
      tax_slab: r.slab_id || null,
      tax_slab_name: r.name || null,
      /* The product's bill of materials rides on the line AS DETAIL (BACKLOG "BOM": one line, components attached —
         the line count and the totals do not change; what the line is MADE OF travels with it, frozen at send). */
      bom:
        l.bom ||
        (Array.isArray(d.bom) && d.bom.length ? d.bom.filter((b) => b && b.item).map((b) => ({ item: String(b.item), qty: Number(b.qty) || 1 })) : undefined),
      tax_source: r.source,
      tax_scheme: r.scheme || 'GST',
      hsn: l.hsn || d.hsn || d.hs_code || d.hsn_code || (r.hsn && r.hsn[0]) || null
    });
  });
}

/**
 * ⭐⭐ walkIn(seller, buyer) → { buyer, note } — A WALK-IN IS TAXED AS A SALE INSIDE THE SHOP (BUY1, 2026-10-12; found by AE1).
 * The engine is right to refuse a guess: a buyer with no country under a BORDER pack (Australia, the UAE) is 'unknown' — no GST,
 * no VAT — and under India's STATE pack a buyer with no place of supply and no state is 'unknown' too. But the CALLER knows the
 * shop, and a walk-in at the counter is handed the goods inside it: the sale is domestic (the full rate) and, in India, intra-state
 * (CGST + SGST — IGST Act s.10(1)(a), the rule lib/tax placeOfSupply already applies to a counter bill). So the buyer takes the
 * SELLER's country when they have none, and the seller's state as place of supply when they have neither a place of supply nor a
 * state; the invoice SAYS so in its notes. A buyer with a country of their own keeps it — a real foreign buyer stays cross-border
 * (zero-rated / export), and a registered buyer's own state keeps deciding. Pure; the input is not mutated. ONE place: invoiceFor
 * (every chit's invoice) and services.computeTax (the quote routes) both go through here — never a second copy of the rule.
 */
function walkIn(seller, buyer) {
  const s = seller || {},
    b = Object.assign({}, buyer || {});
  const sc = String(s.Country || s.country || '')
    .trim()
    .toUpperCase();
  const ss = String(s.State || s.state || '').trim();
  const text = String(b.Country || b.country || '').trim();
  const bPos = String(b.Pos || b.place_of_supply || b.State || b.state || '').trim();
  const tookCountry = !text && !!sc,
    tookState = !bPos && !!ss;
  if (tookCountry) b.Country = sc;
  if (tookState) b.Pos = ss;
  if (!tookCountry && !tookState) return { buyer: b, note: null };
  const inside = tookCountry ? sc : text.toUpperCase() || sc || "the seller's country";
  return { buyer: b, note: 'Walk-in: taxed as a sale inside ' + inside + (tookState ? ' (place of supply ' + ss + ", the seller's state)" : '') + '.' };
}

/**
 * RCM-POST: the reverse-charge category a line NAMES — `line_items[].rcm_category`, the pack's id (docs/FIELDS.md) — or null. Not a lookup:
 * tax-packs.rcmCategoryFor resolves the id against the pack and tax.determine applies the registration tests; this only reads the mark.
 * ⚠️ On a bill that carries one marked line the engine also matches the OTHER lines by SAC/HSN prefix (its v1.20 rule) — the one place that changes is the engine.
 */
function rcmCategoryOf(l) {
  const v = l && (l.rcm_category != null ? l.rcm_category : l.rcmCategory);
  const s = v == null ? '' : String(v).trim().toLowerCase();
  return s || undefined;
}

/**
 * invoiceFor({ lines, seller, buyer, currency, chit_id, at }) → { invoice (INV-01 shape), rated, unrated, provisional }
 * `rated` / `unrated` say how many lines carried a rate — an invoice with unrated lines is honest about being partial.
 */
function invoiceFor(inp) {
  const i = inp || {};
  const lines = (Array.isArray(i.lines) ? i.lines : []).filter((item) => item && !item.removed);
  /* RCM-POST: a line that names its reverse-charge category is rated by the pack's notification when it carries no rate of its own */
  const rated = lines.filter((item) => num(item.gst_rate) !== null || num(item.rate) !== null || !!rcmCategoryOf(item)).length;
  const w = walkIn(i.seller, i.buyer); /* ⭐ BUY1: a buyer with no country / no place of supply is taxed inside the shop */
  const det = tax.determine({
    seller: i.seller || {},
    buyer: w.buyer,
    lines: lines.map((item) => ({
      id: item.line_id || null,
      name: item.name || item.particulars || '',
      qty: num(item.quantity) !== null ? num(item.quantity) : num(item.qty) || 0,
      unit_price: num(item.price) !== null ? num(item.price) : num(item.unit_price) || 0,
      unit: item.unit || '',
      /* ⭐ THE OFFER IS A DISCOUNT ON THE INVOICE, SHOWN SEPARATELY — the storefront order path writes the offer as
         l.offer = { off, label } and lowers l.total, leaving l.price at the listed price; without this the invoice said
         Discount 0 and taxed the listed price (the two-party tour, 2026-09-05). Athi: "is the invoice showing offer and
         tax separately?" — it does now: UnitPrice listed · Discount = the offer · AssAmt after it · GST on that. */
      discount: num(item.discount) || (item.offer && num(item.offer.off)) || 0,
      /* RCM-POST: a reverse-charge line with no rate of its own takes the pack's notified option (rate undefined, never 0 — 0 would tax nothing and note it) */
      rate: num(item.gst_rate) !== null ? num(item.gst_rate) : num(item.rate) !== null ? num(item.rate) : rcmCategoryOf(item) ? undefined : 0,
      cess_rate: num(item.cess_rate) || 0,
      hsn: item.hsn || '',
      tax_scheme: item.tax_scheme || undefined,
      /* RCM-POST: the line's reverse-charge category — the PACK's id (reg-in rcm.categories: gta · legal · rent_unregistered …), carried as the line names it */
      rcm_category: rcmCategoryOf(item)
    })),
    priceIncludesTax: !!i.priceIncludesTax,
    reverseCharge: !!i.reverseCharge,
    /**
     * ⭐ RCM-POST (2026-10-14): ASSESS AS THE RECIPIENT when a line SAYS it is under reverse charge. tax.determine's `rcm` is opt-in
     * (engines v1.20.0); until this round nothing passed it, so no invoice ever carried an RCM line and the books' reverse-charge
     * path (books-hooks rcmOf → posting rcmLines_ → 2204–2206 → GSTR-3B 3.1(d)) was reached only by tests. The pack still decides:
     * the category's rate options and credit, the registered-recipient and unregistered-supplier tests; a pack with no RCM table
     * (AU `rcm: null`) or no state split (AE) marks nothing — no national default. ⚠️ NOT switched on for every invoice:
     * tax-packs.rcmCategoryFor falls back to a 4-digit SAC/HSN PREFIX (reg-in `legal` = 9982, `security` = 9985, `insurance_agent`
     * = 9971), so an accountant's 998222 or an insurer's 9971 bill would be marked reverse charge wrongly. Until the engine matches
     * at the notified precision (an engines round), only a bill whose line NAMES its category is assessed.
     */
    rcm: lines.some((item) => !!rcmCategoryOf(item))
  });
  if (w.note && det._cb) det._cb.notes = (Array.isArray(det._cb.notes) ? det._cb.notes : []).concat(w.note);
  return {
    invoice: Object.assign({ DocDtls: { Typ: 'INV', No: i.chit_id || null, Dt: i.at || null }, currency: i.currency || currencyOf(i.seller) }, det),
    rated,
    unrated: lines.length - rated,
    provisional: !i.frozen
  };
}

/**
 * ⭐ CX1 (T5): the money an invoice with no currency of its own is in — the SELLER's pack's (regulation.packFor(Country).currency: AUD · AED · INR),
 * never INR by name. T2-NATDEF: a seller with no country (or one with no pack) has no stated money — null, never the default pack's INR.
 */
function currencyOf(seller) {
  const p = require('./regulation').lookup(seller && (seller.Country || seller.country)); /* no country / no pack → the DEFAULT pack, said by lookup */
  return (p && !p.fallback && p.currency) || null; /* T2-NATDEF: no country → no pack's money; the invoice says none rather than INR */
}

/** The heads, summed. */
function heads(inv) {
  const v = (inv && inv.ValDtls) || {};
  return {
    taxable: r2(v.AssVal),
    cgst: r2(v.CgstVal),
    sgst: r2(v.SgstVal),
    igst: r2(v.IgstVal),
    cess: r2(v.CesVal),
    vat: r2(v.TaxVal) /* the one head of a non-GST scheme; 0 under GST */,
    total: r2(v.TotInvVal),
    tax: r2((v.CgstVal || 0) + (v.SgstVal || 0) + (v.IgstVal || 0) + (v.CesVal || 0) + (v.TaxVal || 0))
  };
}
const zero = () => ({ taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, vat: 0, total: 0, tax: 0 });
const add = (a, b) => {
  for (const k of Object.keys(a)) a[k] = r2(a[k] + (b[k] || 0));
  return a;
};
const sub = (a, b) => {
  for (const k of Object.keys(a)) a[k] = r2(a[k] - (b[k] || 0));
  return a;
};
/**
 * ⚠️⚠️ A CREDIT NOTE REDUCES TAX — IT IS NOT ANOTHER SALE (2026-09-28). A counter return is a self chit with a customer,
 * exactly like a counter bill, so partiesFor() made the shop its seller and every return was ADDED to output tax: the
 * ledger, GSTR-1 and GSTR-3B all overstated what the shop owed by every refund it gave. Known by the chit's purpose (the
 * counter writes 'credit_note') or by an invoice that says CRN.
 */
const isCreditNote = (e) => String((e && e.purpose) || '') === 'credit_note' || !!(e && e.invoice && e.invoice.DocDtls && e.invoice.DocDtls.Typ === 'CRN');

/**
 * ledger(entries, me) → { output, itc, net, count, rows }
 * entries: [{ chit_id, direction:'sent'|'received', invoice, provisional, seller, buyer, at, subject }]
 * ⚠️ ITC only when I am a regular taxpayer AND the seller charged tax (regular seller, not zero-rated to me).
 */
function ledger(entries, me) {
  const myReg = String((me && me.RegType) || 'regular');
  const output = zero(),
    itc = zero(),
    rows = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || !e.invoice) continue;
    const self = e.seller && e.buyer && e.seller.entity_id && e.seller.entity_id === e.buyer.entity_id;
    if (self) continue; // not a supply
    const h = heads(e.invoice);
    const cn = isCreditNote(e);
    /* output tax follows WHO SELLS (e.sells, from tax-copy) — a received storefront order is the shop's own sale */
    if (e.sells !== undefined ? e.sells : e.direction === 'sent') {
      if (cn) {
        sub(output, h);
        rows.push(Object.assign({ side: 'output_cn' }, e, { heads: h }));
      } else {
        add(output, h);
        rows.push(Object.assign({ side: 'output' }, e, { heads: h }));
      }
    } else if (e.direction === 'received') {
      const sellerReg = String((e.seller && e.seller.RegType) || 'regular');
      const eligible = myReg === 'regular' && sellerReg === 'regular' && h.tax > 0;
      /* a supplier's credit note to me gives back input credit I took — it reduces ITC, it never adds to it */
      if (eligible) {
        if (cn) sub(itc, h);
        else add(itc, h);
      }
      rows.push(Object.assign({ side: cn ? (eligible ? 'itc_cn' : 'no-itc') : eligible ? 'itc' : 'no-itc' }, e, { heads: h }));
    }
  }
  const net = { cgst: r2(output.cgst - itc.cgst), sgst: r2(output.sgst - itc.sgst), igst: r2(output.igst - itc.igst), cess: r2(output.cess - itc.cess) };
  net.total = r2(net.cgst + net.sgst + net.igst + net.cess);
  return { output, itc, net, count: rows.length, provisional: rows.some((item) => item.provisional), rows };
}

/**
 * ⚠️ The seller's word → the code the portal expects. 'OTH' is the honest answer for anything we cannot map: it is a
 * value the GSTR accepts, and a code we cannot vouch for would be a false statement on a return.
 */
function uqcFor(word) {
  try {
    return uom.uqcOf(word) || 'OTH';
  } catch (_) {
    return 'OTH';
  }
}

/**
 * GSTR-1 (offline tool JSON, best effort): b2b by counterparty GSTIN, b2cs summary by POS+rate; hsn summary;
 * ⭐ (2026-09-28) cdnr — credit notes to a REGISTERED buyer, by GSTIN; cdnur — only a B2C LARGE credit note (inter-state,
 * over ₹2.5 lakh); an ordinary walk-in return is NOT reported note by note — it nets off b2cs at its place of supply and
 * rate, as the return expects; and doc_issue — Table 13, the documents issued (invoices · credit notes), first · last · count.
 * ⚠️ Best effort: validate with the offline tool before filing (a CA's review is the gate for anything shown as advice).
 */
const B2CL_LIMIT = 250000;
function gstr1(led, me, period) {
  const g = {
    gstin: (me && me.Gstin) || null,
    fp: period,
    version: 'GST3.1.4',
    hash: 'hash',
    b2b: [],
    b2cs: [],
    cdnr: [],
    cdnur: [],
    hsn: { data: [] },
    doc_issue: { doc_det: [] }
  };
  const byCtin = new Map(),
    b2cs = new Map(),
    lookup = new Map(),
    cdnr = new Map(),
    docs = { inv: [], cn: [] };
  const itmsOf = (inv) =>
    (inv.ItemList || []).map((item, index) => ({
      num: index + 1,
      itm_det: { txval: item.AssAmt, rt: item.GstRt, iamt: item.IgstAmt, camt: item.CgstAmt, samt: item.SgstAmt, csamt: item.CesAmt }
    }));
  const numOf = (r) => String(r.doc_no || r.chit_id || '').slice(0, 16);
  for (const r of (led.rows || []).filter((x) => x.side === 'output_cn')) {
    const inv = r.invoice,
      v = inv.ValDtls || {},
      pos = (inv._cb && inv._cb.place_of_supply) || (inv.BuyerDtls && inv.BuyerDtls.Pos) || '';
    docs.cn.push(numOf(r));
    /* the HSN summary is NET of returns */
    (inv.ItemList || []).forEach((item) => {
      const k = item.HsnCd || '-';
      const h = lookup.get(k) || { hsn_sc: k, desc: item.PrdDesc, uqc: uqcFor(item.Unit), qty: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
      h.qty = r2(h.qty - item.Qty);
      h.txval = r2(h.txval - item.AssAmt);
      h.iamt = r2(h.iamt - item.IgstAmt);
      h.camt = r2(h.camt - item.CgstAmt);
      h.samt = r2(h.samt - item.SgstAmt);
      h.csamt = r2(h.csamt - item.CesAmt);
      lookup.set(k, h);
    });
    const ctin = inv.BuyerDtls && inv.BuyerDtls.Gstin;
    const note = { ntty: 'C', nt_num: numOf(r), nt_dt: docDay(r), val: v.TotInvVal, pos, itms: itmsOf(inv) };
    if (ctin && inv.TranDtls && inv.TranDtls.SupTyp !== 'B2C') {
      const e = cdnr.get(ctin) || { ctin, nt: [] };
      e.nt.push(Object.assign(note, { rchrg: inv.TranDtls.RegRev || 'N', inv_typ: inv.TranDtls.SupTyp === 'SEZWOP' ? 'SEWOP' : 'R' }));
      cdnr.set(ctin, e);
    } else if ((inv._cb && inv._cb.supply) === 'inter' && Number(v.TotInvVal) > B2CL_LIMIT) {
      g.cdnur.push(Object.assign({ typ: 'B2CL' }, note));
    } else {
      (inv.ItemList || []).forEach((item) => {
        const k = pos + '|' + item.GstRt;
        const s = b2cs.get(k) || {
          sply_ty: (inv._cb && inv._cb.supply) === 'inter' ? 'INTER' : 'INTRA',
          pos,
          typ: 'OE',
          rt: item.GstRt,
          txval: 0,
          iamt: 0,
          camt: 0,
          samt: 0,
          csamt: 0
        };
        s.txval = r2(s.txval - item.AssAmt);
        s.iamt = r2(s.iamt - item.IgstAmt);
        s.camt = r2(s.camt - item.CgstAmt);
        s.samt = r2(s.samt - item.SgstAmt);
        s.csamt = r2(s.csamt - item.CesAmt);
        b2cs.set(k, s);
      });
    }
  }
  for (const r of (led.rows || []).filter((x) => x.side === 'output')) {
    docs.inv.push(numOf(r));
    const inv = r.invoice,
      v = inv.ValDtls || {},
      pos = (inv._cb && inv._cb.place_of_supply) || (inv.BuyerDtls && inv.BuyerDtls.Pos) || '';
    const itms = (inv.ItemList || []).map((item, index) => ({
      num: index + 1,
      itm_det: { txval: item.AssAmt, rt: item.GstRt, iamt: item.IgstAmt, camt: item.CgstAmt, samt: item.SgstAmt, csamt: item.CesAmt }
    }));
    (inv.ItemList || []).forEach((item) => {
      const k = item.HsnCd || '-';
      const h = lookup.get(k) || { hsn_sc: k, desc: item.PrdDesc, uqc: uqcFor(item.Unit), qty: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
      h.qty = r2(h.qty + item.Qty);
      h.txval = r2(h.txval + item.AssAmt);
      h.iamt = r2(h.iamt + item.IgstAmt);
      h.camt = r2(h.camt + item.CgstAmt);
      h.samt = r2(h.samt + item.SgstAmt);
      h.csamt = r2(h.csamt + item.CesAmt);
      lookup.set(k, h);
    });
    const ctin = inv.BuyerDtls && inv.BuyerDtls.Gstin;
    if (ctin && inv.TranDtls && inv.TranDtls.SupTyp !== 'B2C') {
      const e = byCtin.get(ctin) || { ctin, inv: [] };
      /* ⚠️ the number on the BUYER's paper (the bill number — numOf, as Table 13 and cdnr already use), not the chit id:
         a b2b row the buyer's GSTR-2B cannot match to the bill in their hand is a credit they cannot take (2026-10-01) */
      e.inv.push({
        inum: numOf(r),
        idt: docDay(r),
        val: v.TotInvVal,
        pos,
        rchrg: inv.TranDtls.RegRev || 'N',
        inv_typ: inv.TranDtls.SupTyp === 'SEZWOP' ? 'SEWOP' : 'R',
        itms
      });
      byCtin.set(ctin, e);
    } else {
      (inv.ItemList || []).forEach((item) => {
        const k = pos + '|' + item.GstRt;
        const s = b2cs.get(k) || {
          sply_ty: (inv._cb && inv._cb.supply) === 'inter' ? 'INTER' : 'INTRA',
          pos,
          typ: 'OE',
          rt: item.GstRt,
          txval: 0,
          iamt: 0,
          camt: 0,
          samt: 0,
          csamt: 0
        };
        s.txval = r2(s.txval + item.AssAmt);
        s.iamt = r2(s.iamt + item.IgstAmt);
        s.camt = r2(s.camt + item.CgstAmt);
        s.samt = r2(s.samt + item.SgstAmt);
        s.csamt = r2(s.csamt + item.CesAmt);
        b2cs.set(k, s);
      });
    }
  }
  g.b2b = [...byCtin.values()];
  g.b2cs = [...b2cs.values()];
  g.cdnr = [...cdnr.values()];
  g.hsn.data = [...lookup.values()].map((item, index) => Object.assign({ num: index + 1 }, item));
  /* Table 13 — documents issued in the period: first · last · how many (cancelled documents are not on the rail) */
  const span = (list) => {
    const s = list.filter(Boolean).sort();
    return s.length ? [{ num: 1, from: s[0], to: s[s.length - 1], totnum: s.length, cancel: 0, net_issue: s.length }] : [];
  };
  if (docs.inv.length) g.doc_issue.doc_det.push({ doc_num: 1, doc_typ: 'Invoices for outward supply', docs: span(docs.inv) });
  if (docs.cn.length) g.doc_issue.doc_det.push({ doc_num: 5, doc_typ: 'Credit Note', docs: span(docs.cn) });
  return g;
}
/** the day a return names a document by: the shop's calendar day (tax-copy ledgerFor sets `day`), else the UTC date of the moment (a row built without it) */
const docDay = (row) => row.day || String((row && row.at) || '').slice(0, 10);

/* GSTR-3B 3.1(b): the supply types (INV-01 TranDtls.SupTyp, the e-invoice schema's codes) that are ZERO-RATED — an export or a supply to an SEZ */
const ZERO_RATED_SUPTYP = /^(SEZWP|SEZWOP|EXPWP|EXPWOP)$/;
/* GSTR-3B 3.1(e): a line whose supply kind the PACK names non-GST (the invoice's _cb.kinds, tax.js supplyKinds). India's pack names none yet, so until it does
   a rate-0 line that is not zero-rated goes to 3.1(c) — said in the return's note, never silently. */
const NON_GST_KIND = /^non[-_ ]?gst/i;

/** which GSTR-3B 3.1 box one invoice line's taxable value belongs in, when it is not 3.1(a): 'b' zero-rated · 'e' non-GST · 'c' nil-rated / exempt · null (taxable) */
function outwardBoxOf(invoice, item, index) {
  /* an export / SEZ supply states its rate for the record and charges none — it is 3.1(b) whatever the rate says */
  if (ZERO_RATED_SUPTYP.test(String((invoice.TranDtls && invoice.TranDtls.SupTyp) || ''))) return 'b';
  if (isTaxedLine(item)) return null;
  return isNamedNonGst(invoice, index) ? 'e' : 'c';
}
/** a line that states a rate or carries any tax head */
const isTaxedLine = (item) => [item.GstRt, item.CgstAmt, item.SgstAmt, item.IgstAmt, item.CesAmt].some((figure) => Number(figure) > 0);
/** the pack named this line's supply kind non-GST (the invoice's _cb.kinds, which the books read the same way — byRateOf) */
function isNamedNonGst(invoice, index) {
  const kinds = invoice._cb && Array.isArray(invoice._cb.kinds) ? invoice._cb.kinds : [];
  const named = kinds.find((entry) => entry && entry.line === index);
  return !!named && NON_GST_KIND.test(String(named.kind || ''));
}

/**
 * The outward taxable value of the month by GSTR-3B box (3.1(b), (c), (e)) — signed: a credit note takes away. Read from the ledger's own rows, so a
 * cancelled or refused copy the ledger already left out is not here either. Returns the three totals; 3.1(a) is the rest (the ledger's taxable minus these).
 */
function outwardBoxes(month) {
  const out = { b: 0, c: 0, e: 0 };
  for (const row of Array.isArray(month.rows) ? month.rows : []) {
    if (row.side !== 'output' && row.side !== 'output_cn') continue;
    const sign = row.side === 'output_cn' ? -1 : 1,
      invoice = row.invoice || {};
    (invoice.ItemList || []).forEach((item, index) => {
      const box = outwardBoxOf(invoice, item, index);
      if (box) out[box] = r2(out[box] + sign * (Number(item.AssAmt) || 0));
    });
  }
  return out;
}

/**
 * GSTR-3B (offline JSON, best effort): outward supplies and eligible ITC.
 * 3.1 is split the way the GSTN form instructions split it: (a) taxable, (b) zero-rated, (c) nil-rated and exempt, (e) non-GST. The four taxable values add up to the
 * ledger's taxable value, so the tax figures (3.1(a)) and ITC are exactly what the books carry; only where the value is shown moved.
 */
function gstr3b(led, me, period) {
  const o = led.output || zero(),
    i = led.itc || zero(),
    box = outwardBoxes(led);
  return {
    gstin: (me && me.Gstin) || null,
    ret_period: period,
    sup_details: {
      osup_det: { txval: r2(o.taxable - box.b - box.c - box.e), iamt: o.igst, camt: o.cgst, samt: o.sgst, csamt: o.cess },
      osup_zero: { txval: box.b, iamt: 0, csamt: 0 },
      osup_nil_exmp: { txval: box.c },
      osup_nongst: { txval: box.e }
    },
    itc_elg: {
      itc_avl: [{ ty: 'OTH', iamt: i.igst, camt: i.cgst, samt: i.sgst, csamt: i.cess }],
      itc_net: { iamt: i.igst, camt: i.cgst, samt: i.sgst, csamt: i.cess }
    },
    _cb: {
      net: led.net,
      provisional: !!led.provisional,
      note: 'Computed from the chits the books count (not cancelled; a bill bought only once accepted), by the month of the shop day; off-rail purchases are not here. 3.1(c) holds every rate-0 line that is not an export or SEZ supply until the country pack names non-GST kinds (3.1(e)). Validate with the offline tool before filing.'
    }
  };
}

module.exports = {
  otherPartyId,
  stateOfGstin,
  splitsByState,
  stateUnder,
  partyOf,
  walkIn,
  currencyOf,
  resolveItem,
  decorate,
  invoiceFor,
  heads,
  ledger,
  gstr1,
  gstr3b,
  outwardBoxes,
  isCreditNote
};
