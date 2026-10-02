/* ADOPTED from chitbridge-engines v1.12.0 · tax · sha256 3fb9c58465bac6550014ea77c6084bae9056b9476471ec863b3948b315dad80a — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · tax. Edited ONLY in chitbridge-engines/src/tax.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note GST determination: two addresses in, INV-01 vocabulary out. Pure — no I/O, no rate tables, no DB.
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
/* ⭐ money.round — THE one rounder (C:devSPEC-money-one-reader.md), found wherever this copy runs: CBMoney in
   a page, lib/money.js on the server. Looked up PER CALL, because an engine can load before money.js does.
   ⚠️ The fallback is the SAME rule, only for when money.js is absent — tests/money-round holds it equal. */
var MONEY_ = null;
function roundMoney_(n) {
  var M = (typeof CBMoney !== 'undefined' && CBMoney.round) ? CBMoney : MONEY_;
  if (M === null && typeof require === 'function') { try { M = MONEY_ = require('./money'); } catch (_) { M = MONEY_ = false; } }
  if (M && M.round) return M.round(n);
  var x = Number(n); if (!isFinite(x)) return x;
  var c = Math.round(Number((Math.abs(x) * 100).toPrecision(15))) / 100;
  return (x < 0 && c !== 0) ? -c : c;
}
/* ⭐ THE COUNTRY IS DATA (tax-packs, 2026-09-28): found wherever this runs — window.CBTaxPacks on a page (the bundle
   loads it first), lib/tax-packs.js on the server. ⚠️ It FAILS LOUDLY when absent: there is no second copy of a country's
   rules in here to fall back to, and a quiet default would be exactly the second copy the packs exist to remove. */
var PACKS_ = null;
function taxPacks_() {
  var P = (typeof CBTaxPacks !== 'undefined' && CBTaxPacks.packFor) ? CBTaxPacks
        : (root.window && root.window.CBTaxPacks && root.window.CBTaxPacks.packFor) ? root.window.CBTaxPacks : PACKS_;
  if (P === null && typeof require === 'function') { try { P = PACKS_ = require('./tax-packs'); } catch (_) { P = PACKS_ = false; } }
  if (!P || !P.packFor) throw new Error('the tax-packs engine is not loaded — load it before this one (a country\'s tax rules are data, and without them nothing can be decided)');
  return P;
}

function r2(n) {
  return roundMoney_(Number(n) || 0);
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
/**
 * ⭐⭐⭐ ONE LINE'S TAX SPLIT — THE ONLY PLACE THIS ARITHMETIC IS ALLOWED TO EXIST. `assessable × rate ÷ 100` is
 * what an INV-01 line justifies itself by (AssAmt, GstRt → CgstAmt/SgstAmt/IgstAmt), so it is the number the
 * server's invoice will carry. A caller that instead took the shortcut `net − assessable` gets the same figure
 * MOST of the time, but not always — two roundings (assessable, then net−assessable) can land a paisa away from
 * one rounding (assessable×rate/100), and that paisa is the difference between what a customer was shown at the
 * counter and what the GST invoice later declares. So a preview (a till, a cart) calls this, not its own formula.
 * → { assessable, tax } — `assessable` is what CGST/SGST/IGST are levied on; `tax` is their sum before the split.
 */
function splitLineTax({ net, rate, priceIncludesTax, zeroRate }) {
  const n = Math.max(0, num(net)), rt = num(rate);
  const assessable = priceIncludesTax ? r2(n * 100 / (100 + rt)) : n;
  const tax = zeroRate ? 0 : r2(assessable * rt / 100);
  return { assessable, tax };
}
/**
 * ⭐⭐⭐ ONE LINE'S TAX HEADS — the only place the CGST/SGST/IGST split of a line's tax exists (v1.2.1). Intra-state:
 * CGST takes the rounded half, SGST the remainder, so the two always sum to the line's tax. Inter-state: all IGST.
 * A VAT-type scheme (no split): one head, `vat`. The counter's printed summary SUMS these per line — it must never
 * halve a rate's total on its own, or the slip and the invoice disagree by a paisa (seen 2026-10-01: a bill said
 * 10.45 / 10.45 where its invoice and ledger said 10.46 / 10.44).
 * → { cgst, sgst, igst, vat }
 */
/**
 * ⭐⭐⭐ v1.12.0 — EACH HEAD AT ITS OWN RATE, SO CGST AND SGST ARE EXACT AND EQUAL (Athi, 2026-10-02: "it cannot be
 * different. it has to be the exact … as a layman, i will question the credibility of the engine"). CGST and SGST are two
 * taxes, each levied at its own rate (half the slab) on the same taxable value — so each is computed as
 * taxable × (rate/2) / 100, rounded once, and they are equal on every line, and therefore in every total. The line's tax
 * is their SUM. (v1.9.0 halved the line's total instead — CGST the rounded half, SGST the remainder — and the odd
 * half-paisa always went to CGST: bill C2/26-27/0010 printed CGST 41.89 against SGST 41.84 over thirteen 12% lines.)
 * IGST is the whole rate on the same value. Pass `assessable` and `rate`; given only `tax` (a caller from before
 * v1.12.0), the old halving is kept so nothing that already printed changes meaning.
 */
function lineHeads({ tax, supply, split, assessable, rate }) {
  const out = { cgst: 0, sgst: 0, igst: 0, vat: 0 };
  const splits = split === undefined ? true : !!split;
  const exact = assessable !== undefined && rate !== undefined;
  const base = num(assessable), rt = num(rate), t = r2(num(tax));
  if (!splits) { if (supply === 'domestic') out.vat = exact ? r2(base * rt / 100) : t; return out; }
  if (supply === 'inter') { out.igst = exact ? r2(base * rt / 100) : t; return out; }
  if (supply === 'intra') {
    if (exact) { out.cgst = r2(base * (rt / 2) / 100); out.sgst = out.cgst; }
    else { out.cgst = r2(t / 2); out.sgst = r2(t - out.cgst); }
  }
  return out;
}
function itemLine(line, ctx, i) {
  const l = line || {};
  const qty = num(l.qty !== undefined ? l.qty : l.quantity) || 0;
  const unitPrice = num(l.unit_price !== undefined ? l.unit_price : l.price);
  const rate = num(l.rate !== undefined ? l.rate : l.gst_rate);
  const gross = r2(qty * unitPrice);
  const discount = r2(num(l.discount));

  const net = Math.max(0, r2(gross - discount));
  const { assessable, tax: taxTotal } = splitLineTax({ net, rate, priceIncludesTax: ctx.priceIncludesTax, zeroRate: ctx.zeroRate });

  /**
   * ⭐ THE SPLIT IS ARITHMETIC, THE DECISION WAS MADE ABOVE. Intra-state halves the rate into CGST and SGST;
   * inter-state puts the whole rate on IGST. Halving an odd rate (5% → 2.5% + 2.5%) is exact in the rate and can
   * be a half-paisa in the amount, so CGST takes the rounded half and SGST takes the remainder — the two always
   * sum to the total, which is what a counterparty's system reconciles against.
   */
  /* ⭐ ONE HEAD FOR A VAT-TYPE SCHEME (b202: DE-VAT-19, FR-VAT-20 …). VAT does not split by state; it is charged in
     full on a domestic supply and, between businesses across a border, not charged at all (export zero-rated /
     reverse charge in the buyer's country). The GST heads stay 0 so an Indian reader of the block is not misled. */
  /* each head at its own rate on the taxable value (v1.12.0) — a zero-rated line carries no rate into the heads */
  const heads = lineHeads({ tax: taxTotal, supply: ctx.supply, split: ctx.split, assessable, rate: ctx.zeroRate ? 0 : rate });
  const CgstAmt = heads.cgst, SgstAmt = heads.sgst, IgstAmt = heads.igst, TaxAmt = heads.vat;

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
    /* Not INV-01 — the single head of a non-GST scheme (VAT · TVA · IVA · consumption tax). 0 under GST. */
    TaxAmt,
    CesRt: num(l.cess_rate),
    CesAmt: r2(assessable * num(l.cess_rate) / 100),
    TotItemVal: r2(assessable + IgstAmt + CgstAmt + SgstAmt + TaxAmt + r2(assessable * num(l.cess_rate) / 100)),
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
  /* The scheme comes from the LINES (the slab each cites carries it) or the caller; GST unless someone says otherwise.
     Mixed schemes on one invoice are not a thing — one seller, one jurisdiction — so the first rated line decides. */
  const linesIn = Array.isArray(inp.lines) ? inp.lines : [];
  const firstScheme = (linesIn.find((l) => l && l.tax_scheme) || {}).tax_scheme;
  /* ⭐ …or the seller's COUNTRY's pack, or — for a party with no country, which is every invoice written before packs —
     the default country's (tax-packs DEFAULT_COUNTRY: India, as it always was, now named). */
  const P = taxPacks_();
  const homePack = P.packFor(seller.Country || seller.country) || P.packFor(P.DEFAULT_COUNTRY);
  const scheme = String(inp.scheme || firstScheme || (homePack && homePack.scheme) || '').trim().toUpperCase();
  if (!scheme) throw new Error('no tax scheme: the lines cite none, the caller gave none, and no pack covers the seller');
  /* ⭐ HOW THE SUPPLY IS CLASSIFIED IS THE PACK'S: 'state' splits by place of supply (India); anything else — including a
     scheme no pack describes yet — is decided at the border, as it always was. */
  const pack = P.packForScheme(scheme);
  const split = !!(pack && pack.supply === 'state');
  let supply;
  if (split) {
    supply = supplyType(sellerState, pos);
  } else {
    /* A VAT-type scheme turns on the BORDER, not the state: same country → domestic (full rate); another country
       → cross-border (nothing charged between businesses); unknown when either country is missing. */
    const sc = String(seller.Country || seller.country || '').trim().toUpperCase();
    const bc = String(buyer.Country || buyer.country || '').trim().toUpperCase();
    supply = (!sc || !bc) ? 'unknown' : (sc === bc ? 'domestic' : 'cross');
    if (supply === 'cross') notes.push('Cross-border supply: no ' + scheme + ' is charged. The buyer accounts for it in their own country (reverse charge / import). The rate is stated for the record.');
    if (supply === 'unknown') notes.push('The ' + (sc ? 'buyer' : 'seller') + ' has no country on record, so domestic vs cross-border cannot be decided. Nothing was assumed.');
  }
  if (supply === 'unknown' && split) {
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
  const ctx = { supply, priceIncludesTax, zeroRate, scheme, split };
  const ItemList = (Array.isArray(inp.lines) ? inp.lines : []).map((l, i) => itemLine(l, ctx, i));

  /**
   * ⚠️⚠️ SUMMED PER SLAB, ROUNDED ONCE — not rounded per line and added up. Every line is already 2dp, but the
   * INVOICE total is what a counterparty reconciles, and the round-off is a declared field (`RndOffAmt`) rather
   * than a silent adjustment. A paise mismatch here is not cosmetic: it is the single most common reason a
   * counterparty's system rejects an otherwise correct invoice.
   */
  const bySlab = {};
  let AssVal = 0, CgstVal = 0, SgstVal = 0, IgstVal = 0, CesVal = 0, Discount = 0, TaxVal = 0;
  for (const it of ItemList) {
    AssVal += it.AssAmt; CgstVal += it.CgstAmt; SgstVal += it.SgstAmt; TaxVal += it.TaxAmt || 0;
    IgstVal += it.IgstAmt; CesVal += it.CesAmt; Discount += it.Discount;
    const k = String(it.GstRt);
    const s = bySlab[k] || (bySlab[k] = { GstRt: it.GstRt, AssVal: 0, CgstVal: 0, SgstVal: 0, IgstVal: 0 });
    s.AssVal += it.AssAmt; s.CgstVal += it.CgstAmt; s.SgstVal += it.SgstAmt; s.IgstVal += it.IgstAmt;
  }
  AssVal = r2(AssVal); CgstVal = r2(CgstVal); SgstVal = r2(SgstVal);
  IgstVal = r2(IgstVal); CesVal = r2(CesVal); Discount = r2(Discount); TaxVal = r2(TaxVal);
  for (const k of Object.keys(bySlab)) {
    const s = bySlab[k];
    s.AssVal = r2(s.AssVal); s.CgstVal = r2(s.CgstVal); s.SgstVal = r2(s.SgstVal); s.IgstVal = r2(s.IgstVal);
  }

  const beforeRound = r2(AssVal + CgstVal + SgstVal + IgstVal + CesVal + TaxVal);
  /* ⭐ the unit the total rounds to is the pack's (India: a whole rupee). A scheme with no pack keeps the whole unit it
     always had — ⚠️ wrong for most VAT countries, and the reason a country needs its pack before it bills. */
  const unit = (pack && pack.invoice_round_to) || 1;
  const roundTo = (v) => (unit === 1 ? Math.round(v) : r2(Math.round(v / unit) * unit));
  const TotInvVal = roundTo(beforeRound);
  const RndOffAmt = r2(TotInvVal - beforeRound);

  /**
   * ⚠️ REVERSE CHARGE IS SHOWN, NOT COLLECTED. When the buyer accounts for the tax, the invoice still states the
   * rate and the amount — the buyer needs both to self-assess — but the seller does not collect it, so the
   * payable is the assessable value alone. Printing the tax-inclusive total as the amount due would ask the
   * customer to pay tax twice, once here and once to the government.
   */
  const AmountPayable = reverseCharge ? roundTo(r2(AssVal + Discount * 0)) : TotInvVal;
  if (reverseCharge) {
    notes.push('Reverse charge: the buyer accounts for the tax. The tax is stated for their records; '
      + 'only the taxable value is payable to you.');
  }
  if (priceIncludesTax) {
    notes.push('Your prices include tax, so the taxable value was worked back out of each price.');
  }

  return {
    TranDtls: {
      TaxSch: scheme,
      SupTyp: String(inp.supplyKind || (buyerSez ? 'SEZWOP' : ((buyer.Gstin && !buyerUnregistered) ? 'B2B' : 'B2C'))),
      RegRev: reverseCharge ? 'Y' : 'N',
      IgstOnIntra: 'N',
    },
    SellerDtls: pick(seller, ['Gstin', 'LglNm', 'TrdNm', 'Addr1', 'Addr2', 'Loc', 'Pin', 'State', 'Ph', 'Em']),
    BuyerDtls: Object.assign(
      pick(buyer, ['Gstin', 'LglNm', 'TrdNm', 'Addr1', 'Addr2', 'Loc', 'Pin', 'State', 'Ph', 'Em']),
      { Pos: pos }),
    ItemList,
    ValDtls: { AssVal, CgstVal, SgstVal, IgstVal, CesVal, StCesVal: 0, Discount, RndOffAmt, TotInvVal, TaxVal },
    /* Ours, beside the standard shape rather than inside it — a caller needs these and INV-01 has nowhere for them. */
    _cb: { scheme, supply, place_of_supply: pos, seller_state: sellerState, slabs: Object.values(bySlab),
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


/* ── reading an issued invoice ─────────────────────────────────────────────────────────────────────────────── */

/**
 * ⭐⭐⭐ PLACE OF SUPPLY — ONE RULE, FOR EVERY HOST (Athi, 2026-10-02; IGST Act s.10(1)(a)). Goods are supplied where their
 * movement terminates for delivery. A counter bill is handed over at the counter, so it is the SHOP's state — CGST + SGST,
 * even for a registered buyer from another state. Only a bill that RECORDS a delivery to a state (`delivery.state_code`)
 * is supplied there. Lived as two hand-kept copies (the counter page and the server) for one afternoon; here it is one.
 */
function placeOfSupply(rec, shopState) {
  const shop = String(shopState == null ? '' : shopState).trim();
  const d = (rec && typeof rec === 'object' && rec.delivery && typeof rec.delivery === 'object') ? rec.delivery : null;
  let to = d ? String(d.state_code == null ? '' : d.state_code).trim() : '';
  if (/^\d$/.test(to)) to = '0' + to;
  return /^\d{2}$/.test(to) ? to : shop;
}

/**
 * ⭐⭐⭐ moneyOf(invoice, currency?) — WHAT AN ISSUED INVOICE SAYS, IN THE HEADER'S OWN NAMES. A MAPPING, NOT A CALCULATION
 * (Athi, 2026-10-02: "the final computed values stored and the same has to be seen in every other place, no further
 * computation as the chit is frozen once it become chit"). determine() computed the invoice once; this only reads it out
 * — adding up heads the invoice already holds, nothing re-derived from prices. The counter's screen and slip, the
 * server's summary_json.money, the ledgers' readers and the buyer's popup all take their figures from here, so they can
 * never disagree about one frozen chit.
 *   { gross, savings, net, taxable, tax, total, round_off,          ← summary_json.money's names
 *     cgst, sgst, igst, cess, vat, supply, pos_state, currency_code,
 *     by_rate: { "<rate>": { taxable, cgst, sgst, igst, tax } },     ← every slab the invoice carries
 *     heads:   [ { name, rate, base, amount } ],                      ← the printed tax lines, rate > 0
 *     lines:   [ { gross, discount, taxable, cgst, sgst, igst, cess, tax, total } ] }  ← ItemList, in order
 * `net` is gross − savings (the price after offers, as the header has always meant it); `total` is the invoice's total.
 */
function moneyOf(inv, currency) {
  const v = (inv && inv.ValDtls) || {}, cb = (inv && inv._cb) || {}, items = (inv && Array.isArray(inv.ItemList)) ? inv.ItemList : [];
  const supply = cb.supply || 'unknown';
  const gross = r2(items.reduce((a, it) => a + num(it.TotAmt), 0));
  const savings = r2(num(v.Discount));
  const cgst = r2(num(v.CgstVal)), sgst = r2(num(v.SgstVal)), igst = r2(num(v.IgstVal)), cess = r2(num(v.CesVal)), vat = r2(num(v.TaxVal));
  const by_rate = {}, heads = [];
  for (const s of (cb.slabs || [])) {
    const rt = num(s.GstRt);
    by_rate[String(rt)] = { taxable: r2(num(s.AssVal)), cgst: r2(num(s.CgstVal)), sgst: r2(num(s.SgstVal)), igst: r2(num(s.IgstVal)),
                            tax: r2(num(s.CgstVal) + num(s.SgstVal) + num(s.IgstVal)) };
    if (!rt) continue;
    if (supply === 'inter') heads.push({ name: 'IGST', rate: rt, base: r2(num(s.AssVal)), amount: r2(num(s.IgstVal)) });
    else if (supply === 'intra') {
      heads.push({ name: 'CGST', rate: rt / 2, base: r2(num(s.AssVal)), amount: r2(num(s.CgstVal)) });
      heads.push({ name: 'SGST', rate: rt / 2, base: r2(num(s.AssVal)), amount: r2(num(s.SgstVal)) });
    }
  }
  heads.sort((a, b) => a.rate - b.rate || (a.name < b.name ? -1 : 1));
  return {
    gross, savings, net: r2(gross - savings), taxable: r2(num(v.AssVal)), tax: r2(cgst + sgst + igst + cess + vat),
    total: r2(num(v.TotInvVal)), round_off: r2(num(v.RndOffAmt)),
    cgst, sgst, igst, cess, vat, supply, pos_state: cb.place_of_supply || null, currency_code: currency || null,
    by_rate, heads,
    lines: items.map((it) => ({ gross: r2(num(it.TotAmt)), discount: r2(num(it.Discount)), taxable: r2(num(it.AssAmt)),
      cgst: r2(num(it.CgstAmt)), sgst: r2(num(it.SgstAmt)), igst: r2(num(it.IgstAmt)), cess: r2(num(it.CesAmt)),
      tax: r2(num(it.CgstAmt) + num(it.SgstAmt) + num(it.IgstAmt) + num(it.CesAmt) + num(it.TaxAmt)), total: r2(num(it.TotItemVal)) })),
  };
}

const EXPORTS = { determine, supplyType, systemProvider, r2, splitLineTax, lineHeads, placeOfSupply, moneyOf };

/**
 * ⭐ CBTax.slab — the counter has always asked ONE global for both halves (CBTax.slab.resolve). It is the tax-slab engine
 * itself, found where the page put it, never a copy. Not enumerable, so the export list is exactly the server's.
 * ⚠️ Load tax-slab BEFORE tax on a page (engines.json "needs"); the counter's bundle does. On the server require
 * tax-slab directly — nothing there reads .slab.
 */
Object.defineProperty(EXPORTS, 'slab', { enumerable: false, get: function () {
  return root.CBTaxSlab || (root.window && root.window.CBTaxSlab) || undefined;
} });

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBTax. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBTax = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
