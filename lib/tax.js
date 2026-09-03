// @stage tested
// @stage-note GST determination: two addresses in, INV-01 vocabulary out. Pure — no I/O, no rate tables, no DB.
'use strict';
/**
 * tax.js — the determination, not the rates.
 *
 * Athi, 2026-09-02: *"how the tax computation happens and how do we borrow the existing well proven modules"*,
 * and then: *"build tax.js with the two-address context and INV-01 field names."*
 *
 * ── ⭐⭐ WHAT WAS BORROWED, AND WHAT WAS DELIBERATELY NOT ───────────────────────────────────────────────────────
 *
 * BORROWED — **the provider seam**. Every serious platform does the same thing and it is the right thing: define
 * an interface, ship a naive default, delegate real determination outward. Medusa's `ITaxProvider` is two methods
 * (`getIdentifier()`, `getTaxLines(itemLines, shippingLines, context)`) returning
 * `{rate, code, name, provider_id, line_item_id}`, with a built-in `system` provider as the placeholder and
 * Avalara/TaxJar behind the same seam. That shape is proven and costs nothing to adopt.
 *
 * ⚠️ NOT BORROWED — **their context**. Medusa's `TaxCalculationContext` carries ONE address: the destination.
 * Indian GST needs TWO, because the comparison between the supplier's state and the PLACE OF SUPPLY is the entire
 * decision between CGST+SGST and IGST. Copying that interface as written would have built the defect in on day
 * one. So the seam is theirs and the context is ours.
 *
 * BORROWED — **the vocabulary of the GSTN e-invoice schema (INV-01)**, because the field names are the standard
 * an Indian buyer's system already speaks. `SellerDtls` · `BuyerDtls` · `ItemList` · `ValDtls` · `TranDtls`,
 * and inside them `Gstin` · `LglNm` · `Pos` · `HsnCd` · `AssAmt` · `GstRt` · `CgstAmt` · `SgstAmt` · `IgstAmt` ·
 * `TotItemVal` · `RndOffAmt` · `TotInvVal`. If our output already speaks that, "e-invoice ready" and "Tally
 * compatible" stop being claims and become a mapping.
 *
 * ⚠️ THE NAMES WERE VERIFIED, NOT REMEMBERED — and one of them was wrong. Seller and buyer carry **`State`**, not
 * `Stcd`; `Stcd` exists only in `DispDtls`/`ShipDtls`. That is exactly the kind of detail that passes review, ships,
 * and is rejected by the IRP months later.
 *
 * ⚠️⚠️ NOT BORROWED, AND NEVER TO BE — **rate tables**. This file ships no rates. A stale rate in our repository
 * is a compliance liability wearing the costume of a feature: it is wrong silently, it is wrong for everyone, and
 * nobody discovers it until a return is filed. A rate arrives per line — from the entity's own HSN declarations,
 * or from a provider whose business is keeping them current.
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 */

/* ── money ─────────────────────────────────────────────────────────────────────────────────────────────────── */

/** 2dp, half-up, on a value already in the invoice currency. Never a place to be clever. */
function r2(n) {
  const x = Number(n) || 0;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* ── the one decision GST turns on ─────────────────────────────────────────────────────────────────────────── */

/**
 * supplyType(sellerState, placeOfSupply) → 'intra' | 'inter' | 'unknown'
 *
 * ⚠️⚠️ THIS IS THE WHOLE REASON THE CONTEXT NEEDS TWO ADDRESSES. Same goods, same price, same buyer: if the place
 * of supply is the seller's own state the tax is CGST+SGST, and if it is another state it is IGST. Get it
 * backwards and the invoice is not merely displaying a wrong number — the wrong tax has been charged, under the
 * wrong heads, and the buyer cannot claim the credit.
 *
 * ⚠️ AND 'unknown' IS A REAL ANSWER. A missing place of supply must not silently default to intra-state — that is
 * the guess that produces a confidently wrong invoice. The caller is told, and decides.
 */
function supplyType(sellerState, placeOfSupply) {
  const a = String(sellerState == null ? '' : sellerState).trim();
  const b = String(placeOfSupply == null ? '' : placeOfSupply).trim();
  if (!a || !b) return 'unknown';
  /* State codes are two-digit strings ("29"); a leading zero must not be lost by a numeric comparison. */
  return a.replace(/^0+/, '') === b.replace(/^0+/, '') ? 'intra' : 'inter';
}

/* ── one line ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * itemLine(line, ctx, i) → an ItemList entry.
 *
 * ⚠️⚠️ ORDER OF OPERATIONS: DISCOUNT FIRST, THEN TAX ON WHAT REMAINS. `AssAmt = TotAmt − Discount`, and the rate
 * applies to `AssAmt`. Taxing before the discount overcharges; discounting after tax under-remits. Either way it
 * is a compliance error rather than a display bug, and it is the single most common way a hand-built invoice is
 * wrong.
 *
 * ⚠️ INCLUSIVE PRICING IS DECLARED, NEVER INFERRED. If a catalogue's prices already contain tax, the assessable
 * value is `gross × 100 / (100 + rate)`. Guessing this is how a price becomes wrong by exactly the tax rate — an
 * error large enough to lose money on every line and subtle enough to look like a rounding problem.
 */
function itemLine(line, ctx, i) {
  const l = line || {};
  const qty = num(l.qty !== undefined ? l.qty : l.quantity) || 0;
  const unitPrice = num(l.unit_price !== undefined ? l.unit_price : l.price);
  const rate = num(l.rate !== undefined ? l.rate : l.gst_rate);
  const gross = r2(qty * unitPrice);
  const discount = r2(num(l.discount));

  const net = Math.max(0, r2(gross - discount));
  const assessable = ctx.priceIncludesTax ? r2(net * 100 / (100 + rate)) : net;
  /* zero-rated (SEZ) or a composition seller: the rate is recorded, nothing is charged. */
  const taxTotal = ctx.zeroRate ? 0 : r2(assessable * rate / 100);

  /**
   * ⭐ THE SPLIT IS ARITHMETIC, THE DECISION WAS MADE ABOVE. Intra-state halves the rate into CGST and SGST;
   * inter-state puts the whole rate on IGST. Halving an odd rate (5% → 2.5% + 2.5%) is exact in the rate and can
   * be a half-paisa in the amount, so CGST takes the rounded half and SGST takes the remainder — the two always
   * sum to the total, which is what a counterparty's system reconciles against.
   */
  let CgstAmt = 0, SgstAmt = 0, IgstAmt = 0;
  if (ctx.supply === 'inter') {
    IgstAmt = taxTotal;
  } else if (ctx.supply === 'intra') {
    CgstAmt = r2(taxTotal / 2);
    SgstAmt = r2(taxTotal - CgstAmt);
  }

  return {
    SlNo: String(i + 1),
    PrdDesc: String(l.name || l.description || l.PrdDesc || ''),
    IsServc: l.is_service ? 'Y' : 'N',
    HsnCd: String(l.hsn || l.hsn_code || l.HsnCd || ''),
    Qty: qty,
    Unit: String(l.unit || ''),
    UnitPrice: r2(unitPrice),
    TotAmt: gross,
    Discount: discount,
    AssAmt: assessable,
    GstRt: rate,
    IgstAmt, CgstAmt, SgstAmt,
    CesRt: num(l.cess_rate),
    CesAmt: r2(assessable * num(l.cess_rate) / 100),
    TotItemVal: r2(assessable + IgstAmt + CgstAmt + SgstAmt + r2(assessable * num(l.cess_rate) / 100)),
    /* Not INV-01 — ours, so a caller can join a computed line back to the chit line it came from. */
    _line_id: l.id !== undefined ? l.id : null,
  };
}

/* ── the invoice ───────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * determine({ seller, buyer, lines, priceIncludesTax, reverseCharge, supplyKind }) → the INV-01 shape + notes.
 *
 * `seller` { Gstin, LglNm, State, … }   ·   `buyer` { Gstin, LglNm, Pos, State, … }
 *
 * ⚠️ `Pos` (place of supply) IS NOT THE BUYER'S ADDRESS. It is usually the delivery state, and for services it
 * can be neither party's registered state. It is therefore taken as its own field and falls back to the buyer's
 * `State` only when absent — with a note saying so, because a silent fallback is how the wrong tax gets charged
 * without anyone being able to see why afterwards.
 */
function determine(input) {
  const inp = input || {};
  const seller = inp.seller || {};
  const buyer = inp.buyer || {};
  const notes = [];

  let pos = String(buyer.Pos || buyer.place_of_supply || '').trim();
  if (!pos && (buyer.State || buyer.state)) {
    pos = String(buyer.State || buyer.state).trim();
    notes.push('Place of supply was not given, so the buyer\'s state was used. For a delivery elsewhere, or for '
      + 'a service, state the place of supply — it, not the address, decides the tax.');
  }
  const sellerState = String(seller.State || seller.state || '').trim();
  const supply = supplyType(sellerState, pos);
  if (supply === 'unknown') {
    notes.push(sellerState
      ? 'No place of supply, so CGST/SGST vs IGST cannot be decided. Nothing was assumed.'
      : 'The seller has no state on record, so CGST/SGST vs IGST cannot be decided. Nothing was assumed.');
  }

  const priceIncludesTax = !!inp.priceIncludesTax;
  const reverseCharge = !!inp.reverseCharge;
  /**
   * ⭐ REGISTRATION TYPE DECIDES WHAT MAY BE CHARGED, BEFORE ANY RATE DOES (Tally's M1/M2; STUDY §6 G2).
   *   seller composition → the invoice carries NO tax: the dealer pays a flat % on turnover and may not collect
   *                        GST from the buyer. The slab rate is still recorded per line (for the trader's own
   *                        books) but every head is zero and the total is the assessable value.
   *   buyer sez          → zero-rated supply (with LUT): rate 0 on the invoice, SupTyp SEZWOP, credit retained.
   *   buyer unregistered → B2C, by definition (also what a missing GSTIN already implied).
   * `RegType` on either party: 'regular' | 'composition' | 'unregistered' | 'sez'. Absent = regular.
   */
  const regOf = (p) => String(p.RegType || p.reg_type || p.gst_registration || 'regular').trim().toLowerCase();
  const sellerComposition = regOf(seller) === 'composition';
  const buyerSez = regOf(buyer) === 'sez';
  const buyerUnregistered = regOf(buyer) === 'unregistered';
  const zeroRate = sellerComposition || buyerSez || !!inp.zeroRated;
  if (sellerComposition) notes.push('Composition scheme: no GST is charged on this invoice. The tax is paid on turnover, and the buyer cannot claim credit.');
  if (buyerSez) notes.push('Supply to an SEZ unit: zero-rated (under LUT). The rate is stated for the record; no tax is charged.');
  const ctx = { supply, priceIncludesTax, zeroRate };
  const ItemList = (Array.isArray(inp.lines) ? inp.lines : []).map((l, i) => itemLine(l, ctx, i));

  /**
   * ⚠️⚠️ SUMMED PER SLAB, ROUNDED ONCE — not rounded per line and added up. Every line is already 2dp, but the
   * INVOICE total is what a counterparty reconciles, and the round-off is a declared field (`RndOffAmt`) rather
   * than a silent adjustment. A paise mismatch here is not cosmetic: it is the single most common reason a
   * counterparty's system rejects an otherwise correct invoice.
   */
  const bySlab = {};
  let AssVal = 0, CgstVal = 0, SgstVal = 0, IgstVal = 0, CesVal = 0, Discount = 0;
  for (const it of ItemList) {
    AssVal += it.AssAmt; CgstVal += it.CgstAmt; SgstVal += it.SgstAmt;
    IgstVal += it.IgstAmt; CesVal += it.CesAmt; Discount += it.Discount;
    const k = String(it.GstRt);
    const s = bySlab[k] || (bySlab[k] = { GstRt: it.GstRt, AssVal: 0, CgstVal: 0, SgstVal: 0, IgstVal: 0 });
    s.AssVal += it.AssAmt; s.CgstVal += it.CgstAmt; s.SgstVal += it.SgstAmt; s.IgstVal += it.IgstAmt;
  }
  AssVal = r2(AssVal); CgstVal = r2(CgstVal); SgstVal = r2(SgstVal);
  IgstVal = r2(IgstVal); CesVal = r2(CesVal); Discount = r2(Discount);
  for (const k of Object.keys(bySlab)) {
    const s = bySlab[k];
    s.AssVal = r2(s.AssVal); s.CgstVal = r2(s.CgstVal); s.SgstVal = r2(s.SgstVal); s.IgstVal = r2(s.IgstVal);
  }

  const beforeRound = r2(AssVal + CgstVal + SgstVal + IgstVal + CesVal);
  const TotInvVal = Math.round(beforeRound);
  const RndOffAmt = r2(TotInvVal - beforeRound);

  /**
   * ⚠️ REVERSE CHARGE IS SHOWN, NOT COLLECTED. When the buyer accounts for the tax, the invoice still states the
   * rate and the amount — the buyer needs both to self-assess — but the seller does not collect it, so the
   * payable is the assessable value alone. Printing the tax-inclusive total as the amount due would ask the
   * customer to pay tax twice, once here and once to the government.
   */
  const AmountPayable = reverseCharge ? Math.round(r2(AssVal + Discount * 0)) : TotInvVal;
  if (reverseCharge) {
    notes.push('Reverse charge: the buyer accounts for the tax. The tax is stated for their records; '
      + 'only the taxable value is payable to you.');
  }
  if (priceIncludesTax) {
    notes.push('Your prices include tax, so the taxable value was worked back out of each price.');
  }

  return {
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: String(inp.supplyKind || (buyerSez ? 'SEZWOP' : ((buyer.Gstin && !buyerUnregistered) ? 'B2B' : 'B2C'))),
      RegRev: reverseCharge ? 'Y' : 'N',
      IgstOnIntra: 'N',
    },
    SellerDtls: pick(seller, ['Gstin', 'LglNm', 'TrdNm', 'Addr1', 'Addr2', 'Loc', 'Pin', 'State', 'Ph', 'Em']),
    BuyerDtls: Object.assign(
      pick(buyer, ['Gstin', 'LglNm', 'TrdNm', 'Addr1', 'Addr2', 'Loc', 'Pin', 'State', 'Ph', 'Em']),
      { Pos: pos }),
    ItemList,
    ValDtls: { AssVal, CgstVal, SgstVal, IgstVal, CesVal, StCesVal: 0, Discount, RndOffAmt, TotInvVal },
    /* Ours, beside the standard shape rather than inside it — a caller needs these and INV-01 has nowhere for them. */
    _cb: { supply, place_of_supply: pos, seller_state: sellerState, slabs: Object.values(bySlab),
           amount_payable: AmountPayable, reverse_charge: reverseCharge, price_includes_tax: priceIncludesTax,
           notes },
  };
}

function pick(o, keys) {
  const src = o || {};
  const out = {};
  for (const k of keys) {
    const v = src[k] !== undefined ? src[k] : src[k.toLowerCase()];
    if (v !== undefined && v !== null && String(v) !== '') out[k] = v;
  }
  return out;
}

/* ── the provider seam ─────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⭐ THE SEAM, BORROWED FROM MEDUSA'S ITaxProvider AND WIDENED. Same two methods, same "return tax lines" idea —
 * so a future Avalara/ClearTax provider is a drop-in — but the context carries BOTH parties, because a provider
 * that cannot see the place of supply cannot answer an Indian question.
 *
 * ⚠️ THE DEFAULT PROVIDER DETERMINES NOTHING IT WAS NOT TOLD. It applies the rate on the line and splits it by
 * the supply type. It has no rate table, so it can never be stale — and it can never answer "what rate is this?"
 * either. That question belongs to the entity's HSN declarations or to a real provider, and pretending otherwise
 * is how a compliance liability gets shipped as a convenience.
 */
const systemProvider = {
  getIdentifier() { return 'cb_system'; },
  getTaxLines(lines, context) {
    const out = determine(Object.assign({}, context, { lines }));
    return out.ItemList.map((it) => ({
      line_item_id: it._line_id,
      rate: it.GstRt,
      code: it.HsnCd,
      name: out._cb.supply === 'inter' ? 'IGST' : 'CGST+SGST',
      provider_id: 'cb_system',
      CgstAmt: it.CgstAmt, SgstAmt: it.SgstAmt, IgstAmt: it.IgstAmt, AssAmt: it.AssAmt,
    }));
  },
};

module.exports = { determine, supplyType, systemProvider, r2 };
