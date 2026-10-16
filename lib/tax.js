/* ADOPTED from chitbridge-engines v1.49.0 · tax · sha256 62ec56f708bc5697293a8304e205d682dbdf4ca4d6ae904254dbe160ec4907bb — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
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
 * → { assessable, tax, base } — `assessable` is the line's taxable value; `tax` is the heads' sum before the split;
 *   `base` is the value the rate was applied to (= assessable on an exclusive line).
 *
 * ⭐⭐ v1.43.0 (ENG-R1) — A TAX-INCLUSIVE LINE TOTALS EXACTLY ITS PRICE. The shopper paid `net`, so the invoice line says `net`.
 * Before, the taxable value and the tax were each rounded and then re-added: 2 × 65.00 @ 5% intra printed 130.01 (123.81 + 3.10
 * + 3.10), 3 × 40.00 @ 18% intra 119.99. Now the TAX is computed as it always was (the rate on the worked-back base, each head
 * rounded once, half-up) and the TAXABLE VALUE is the remainder: assessable = net − tax. The cent lands in the taxable value,
 * never in the tax. ⚠️ ONE RULE FOR EVERY PACK, because every pack rounds the TAX per line, half-up, and none fixes the taxable
 * value's last cent: IN — INV-01 carries each item's tax (the IRP allows ±Rs 1 against AssAmt × rate); AU — the ATO lets a
 * supplier round per line or per invoice, and determine() has always rounded per line; AE — ER Art. 61, tax rounded to the fils
 * per supply, half-up (reg-ae `line_tax_rounding`).
 * `supply` / `split` (optional — determine() passes them): the tax taken out is the SUM OF THE HEADS lineHeads gives, so an
 * intra-state line's CGST + SGST (each at half the rate) is exactly what leaves the price. Without them, the whole rate, as before.
 * A line on which no head is levied (zero-rated, a cross-border or undecided supply) keeps the worked-back base — unchanged.
 *
 * ⭐⭐ v1.49.0 (ENG-FIX2, the Claude review C2 · H1 · H7) — ONE EXACT BASE, ONE ROUNDING PER HEAD, THE CESS INSIDE THE PRICE.
 *   H1: v1.43.0 rounded the worked-back base and then rounded each head again — a cent HIGH, always upward, on 9% of AU prices and 5% of
 *       AE ones (AU $9.95 billed GST 0.91 for 0.90); a shop over-reported on every BAS 1A. Every head is now its rate on the EXACT base,
 *       rounded once, half-up: tax = round(price × rate ÷ (100 + rate)), taxable = price − tax.
 *   C2: an MRP already contains the compensation cess, so the base is worked back by (100 + rate + cess rate) — MRP 140 @ 28% + 12% is
 *       taxable 100 · GST 28 · cess 12 · total 140 (v1.43.0 billed 153.13, more than the printed MRP). `cessRate` is the new, optional input.
 *   H7: the cess follows zero-rating as the GST heads always did (a composition seller charged 0 GST and 12 cess).
 * Told the supply, the heads it took out ride on the answer (`heads`); given a cess rate, so does the cess (`cess`) — PRESENT ONLY THEN, so
 * every caller that did not ask keeps the three-key shape { assessable, tax, base }. itemLine paints these heads; it never re-derives them.
 */
function splitLineTax({ net, rate, cessRate, priceIncludesTax, zeroRate, supply, split }) {
  const n = Math.max(0, num(net)), rt = num(rate), cessRt = zeroRate ? 0 : num(cessRate);
  const told = supply !== undefined, splits = split === undefined ? true : !!split;
  const levied = !zeroRate && (!told || (splits ? (supply === 'intra' || supply === 'inter') : supply === 'domestic'));
  const exact = priceIncludesTax ? n * 100 / (100 + rt + cessRt) : n;
  const base = r2(exact);
  const heads = told ? lineHeads({ supply, split: splits, assessable: exact, rate: zeroRate ? 0 : rt }) : null;
  let tax = zeroRate ? 0 : r2(exact * rt / 100);
  if (heads && levied) tax = r2(heads.cgst + heads.sgst + heads.igst + heads.vat);
  const cess = r2(exact * cessRt / 100);
  const assessable = priceIncludesTax && levied ? Math.max(0, r2(n - tax - cess)) : base;
  const out = { assessable, tax, base };
  if (cessRate !== undefined) out.cess = cess;
  if (heads) out.heads = heads;
  return out;
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
  /* v1.43.0: on an inclusive line `assessable` is net − the heads − the cess, so TotItemVal = net exactly; v1.49.0: the heads and the
     cess are the split's own (one exact base, one rounding each) — this paints them, it never works them out again */
  const split = splitLineTax({ net, rate, cessRate: num(l.cess_rate), priceIncludesTax: ctx.priceIncludesTax, zeroRate: ctx.zeroRate,
    supply: ctx.supply, split: ctx.split });
  const assessable = split.assessable, base = split.base, CesAmt = split.cess;

  /**
   * ⭐ THE SPLIT IS ARITHMETIC, THE DECISION WAS MADE ABOVE. Intra-state halves the rate into CGST and SGST;
   * inter-state puts the whole rate on IGST. Halving an odd rate (5% → 2.5% + 2.5%) is exact in the rate and can
   * be a half-paisa in the amount, so CGST takes the rounded half and SGST takes the remainder — the two always
   * sum to the total, which is what a counterparty's system reconciles against.
   */
  /* ⭐ ONE HEAD FOR A VAT-TYPE SCHEME (b202: DE-VAT-19, FR-VAT-20 …). VAT does not split by state; it is charged in
     full on a domestic supply and, between businesses across a border, not charged at all (export zero-rated /
     reverse charge in the buyer's country). The GST heads stay 0 so an Indian reader of the block is not misled. */
  /* each head at its own rate on the taxable value (v1.12.0) — a zero-rated line carries no rate into the heads; told the supply (determine
     always is) the split handed them over, the fallback is for a caller that built a ctx without one */
  const heads = split.heads || lineHeads({ tax: split.tax, supply: ctx.supply, split: ctx.split, assessable: base, rate: ctx.zeroRate ? 0 : rate });
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
    /* the split's cess: its rate on the exact base, inside an MRP (v1.49.0 C2), 0 when the invoice is zero-rated (H7) */
    CesAmt,
    TotItemVal: r2(assessable + IgstAmt + CgstAmt + SgstAmt + TaxAmt + CesAmt),
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
  /* ⭐ v1.34.0 (AU1): the seller's OWN country's pack decides when it carries this scheme — two countries both call their tax 'GST' (India splits by
     state, Australia does not), so the scheme alone cannot pick the pack. A seller with no country, or a scheme its pack does not carry, reads as before. */
  const pack = (homePack && String(homePack.scheme || '').toUpperCase() === scheme) ? homePack : P.packForScheme(scheme);
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
   *   seller unregistered → NO tax may be collected (v1.49.0, ENG-FIX2 C1): a seller not registered for the scheme cannot charge it, in
   *                        every pack — India below the threshold, an AU business under $75k, a UAE trader under the mandatory limit.
   *                        The counter always said so through `zeroRated`; the server's invoice path reads the party and did not.
   *                        ⚠️ Reverse charge is NOT silenced by it: an unregistered SUPPLIER is the commonest RCM case — the recipient
   *                        self-assesses that line's heads (see the RCM branch below), the supplier's own heads stay 0.
   * `RegType` on either party: 'regular' | 'composition' | 'unregistered' | 'sez'. Absent = regular.
   */
  const regOf = (p) => String(p.RegType || p.reg_type || p.gst_registration || 'regular').trim().toLowerCase();
  const sellerComposition = regOf(seller) === 'composition';
  const sellerUnregistered = regOf(seller) === 'unregistered';
  const buyerSez = regOf(buyer) === 'sez';
  const buyerUnregistered = regOf(buyer) === 'unregistered';
  const zeroRatedSupply = sellerComposition || buyerSez || !!inp.zeroRated;
  const zeroRate = zeroRatedSupply || sellerUnregistered;
  if (sellerComposition) notes.push('Composition scheme: no GST is charged on this invoice. The tax is paid on turnover, and the buyer cannot claim credit.');
  if (sellerUnregistered) notes.push('The seller is not registered for ' + scheme + ', so no ' + scheme + ' is charged on this invoice. The rate is stated for the record; the buyer gets no credit.');
  if (buyerSez) notes.push('Supply to an SEZ unit: zero-rated (under LUT). The rate is stated for the record; no tax is charged.');
  const ctx = { supply, priceIncludesTax, zeroRate, scheme, split };
  /**
   * ⭐ REVERSE CHARGE FROM THE PACK (v1.20.0; CGST Act s.9(3) / 9(4) — the categories are tax-packs' DATA, none is named here).
   * Opt-in: `rcm: true` says "assess this as the RECIPIENT's purchase" — the buyer is the shop, the seller its supplier — so no
   * invoice computed before v1.20.0 changes. A line is under reverse charge when the pack has a category for it (the line's
   * `rcm_category`, else its SAC / HSN) AND the recipient is registered AND (the category is always-RCM, or the supplier is
   * unregistered). Such a line carries its tax in the RCM heads (`RcmCgstAmt` · `RcmSgstAmt` · `RcmIgstAmt`, `RcmCd`, `RcmItc`) and
   * NOTHING in CgstAmt / SgstAmt / IgstAmt: the supplier charged none, so the invoice total is the supplier's bill. ITC follows the
   * rate option the line carries (GTA at 5% allows none; at 18% it does). A line with no rate takes the category's first option.
   */
  const rcmPack = inp.rcm && split && !zeroRatedSupply && pack && pack.rcm ? pack : null;
  const supplierRegistered = !!String(seller.Gstin || seller.gstin || '').trim() && regOf(seller) !== 'unregistered';
  const recipientRegistered = !!String(buyer.Gstin || buyer.gstin || '').trim() && regOf(buyer) !== 'unregistered';
  const rcmOf = [], kindsOf = [];
  /**
   * ⭐ v1.34.0 (AU1) — A LINE'S SUPPLY KIND FROM THE PACK (GST Act Div 38 GST-free · Div 40 input taxed; the table is the pack's `supplyKinds`, none is
   * named here). A line that names a kind (`supply_kind`) takes that kind's rate — 0 for a GST-free or input-taxed line — and the invoice SAYS WHY, in
   * the notes and in `_cb.kinds` (present only when a line named one, so every other invoice keeps its shape). A pack with no table reads as before.
   */
  const kinds = pack && pack.supplyKinds && typeof pack.supplyKinds === 'object' ? pack.supplyKinds : null;
  const ItemList = linesIn.map((l, i) => {
    let line = l || {};
    const named = kinds && (line.supply_kind || line.tax_kind);
    if (named) {
      const key = String(named).trim().toLowerCase().replace(/-/g, '_');
      const kind = Object.prototype.hasOwnProperty.call(kinds, key) ? kinds[key] : null;
      if (!kind) notes.push('Line ' + (i + 1) + ': "' + String(named).slice(0, 20) + '" is not a supply kind this pack knows (' + Object.keys(kinds).join(', ') + '); the line\'s own rate was used.');
      else {
        const given = line.rate !== undefined && line.rate !== null && line.rate !== '' ? line.rate : line.gst_rate;
        const rate = kind.rate === 0 ? 0 : (given !== undefined && given !== null && given !== '' ? num(given) : num(kind.rate));
        line = Object.assign({}, line, { rate });
        if (kind.rate === 0) notes.push('Line ' + (i + 1) + ': ' + kind.why);
        kindsOf[i] = { line: i, kind: kind.id || key, rate, credit: kind.credit, bas: kind.bas || null, why: kind.why || null };
        /* v1.37.0 (AE1): a pack whose return is not a BAS names the kind's return BOX (reg-ae: VAT201 Box 1 · 4 · 5) — present only when the pack's row has one, so every AU row keeps its shape */
        if (kind.box != null) kindsOf[i].box = String(kind.box);
      }
    }
    const cat = rcmPack ? P.rcmCategoryFor(rcmPack, { id: line.rcm_category, code: line.hsn || line.hsn_code || line.HsnCd }) : null;
    if (!cat || !recipientRegistered || !(cat.always || !supplierRegistered)) return itemLine(line, ctx, i);
    const given = line.rate !== undefined && line.rate !== null ? line.rate : line.gst_rate;
    const hasRate = given !== undefined && given !== null && given !== '';
    const opt = (hasRate ? cat.rates.find((r) => r.rate === num(given)) : null) || cat.rates[0];
    const rate = hasRate ? num(given) : num(opt.rate);
    if (hasRate && opt.rate !== null && opt.rate !== num(given)) notes.push('Line ' + (i + 1) + ': ' + rate + '% is not a rate the notification gives for ' + cat.name + ' (' + cat.rates.map((r) => r.rate).join(' or ') + '%); credit was read as for the first option.');
    /* the recipient self-assesses this line: its heads are computed even when the (unregistered) supplier may charge none */
    const it = itemLine(Object.assign({}, line, { rate }), Object.assign({}, ctx, { priceIncludesTax: false, zeroRate: false }), i);
    const heads = { cgst: it.CgstAmt, sgst: it.SgstAmt, igst: it.IgstAmt };
    it.RcmCd = cat.id; it.RcmCgstAmt = heads.cgst; it.RcmSgstAmt = heads.sgst; it.RcmIgstAmt = heads.igst; it.RcmItc = !!opt.itc;
    it.CgstAmt = 0; it.SgstAmt = 0; it.IgstAmt = 0;
    it.TotItemVal = r2(it.AssAmt + it.CesAmt);
    rcmOf[i] = { line: i, category: cat.id, section: cat.section, notification: cat.notification, serial: cat.serial, rate, itc: !!opt.itc };
    return it;
  });
  const rcmLines = rcmOf.filter(Boolean);
  if (rcmLines.length) notes.push('Reverse charge on line' + (rcmLines.length > 1 ? 's ' : ' ') + rcmLines.map((x) => x.line + 1).join(', ') + ' (' + Array.from(new Set(rcmLines.map((x) => x.category + ', ' + x.notification))).join('; ') + '): the buyer pays the tax in cash; the supplier\'s bill carries none.');

  /**
   * ⚠️⚠️ SUMMED PER SLAB, ROUNDED ONCE — not rounded per line and added up. Every line is already 2dp, but the
   * INVOICE total is what a counterparty reconciles, and the round-off is a declared field (`RndOffAmt`) rather
   * than a silent adjustment. A paise mismatch here is not cosmetic: it is the single most common reason a
   * counterparty's system rejects an otherwise correct invoice.
   */
  const bySlab = {};
  let AssVal = 0, CgstVal = 0, SgstVal = 0, IgstVal = 0, CesVal = 0, Discount = 0, TaxVal = 0;
  const rcmVal = { c: 0, s: 0, i: 0 };
  for (const it of ItemList) {
    if (it.RcmCd) { rcmVal.c += it.RcmCgstAmt; rcmVal.s += it.RcmSgstAmt; rcmVal.i += it.RcmIgstAmt; }
    AssVal += it.AssAmt; CgstVal += it.CgstAmt; SgstVal += it.SgstAmt; TaxVal += it.TaxAmt || 0;
    IgstVal += it.IgstAmt; CesVal += it.CesAmt; Discount += it.Discount;
    const k = String(it.GstRt);
    const s = bySlab[k] || (bySlab[k] = { GstRt: it.GstRt, AssVal: 0, CgstVal: 0, SgstVal: 0, IgstVal: 0, CesVal: 0 });
    s.AssVal += it.AssAmt; s.CgstVal += it.CgstAmt; s.SgstVal += it.SgstAmt; s.IgstVal += it.IgstAmt; s.CesVal += it.CesAmt;
    if (it.TaxAmt) s.TaxVal = (s.TaxVal || 0) + it.TaxAmt;   /* v1.34.0: the ONE head of a scheme that does not split (AU GST, a VAT) — absent when nil, so every India slab keeps its shape */
  }
  AssVal = r2(AssVal); CgstVal = r2(CgstVal); SgstVal = r2(SgstVal);
  IgstVal = r2(IgstVal); CesVal = r2(CesVal); Discount = r2(Discount); TaxVal = r2(TaxVal);
  for (const k of Object.keys(bySlab)) {
    const s = bySlab[k];
    s.AssVal = r2(s.AssVal); s.CgstVal = r2(s.CgstVal); s.SgstVal = r2(s.SgstVal); s.IgstVal = r2(s.IgstVal); s.CesVal = r2(s.CesVal);
    if (s.TaxVal !== undefined) s.TaxVal = r2(s.TaxVal);
  }
  const kindLines = kindsOf.filter(Boolean);

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
      RegRev: (reverseCharge || rcmLines.length) ? 'Y' : 'N',
      IgstOnIntra: 'N',
    },
    SellerDtls: pick(seller, ['Gstin', 'LglNm', 'TrdNm', 'Addr1', 'Addr2', 'Loc', 'Pin', 'State', 'Ph', 'Em']),
    BuyerDtls: Object.assign(
      pick(buyer, ['Gstin', 'LglNm', 'TrdNm', 'Addr1', 'Addr2', 'Loc', 'Pin', 'State', 'Ph', 'Em']),
      { Pos: pos }),
    ItemList,
    ValDtls: Object.assign({ AssVal, CgstVal, SgstVal, IgstVal, CesVal, StCesVal: 0, Discount, RndOffAmt, TotInvVal, TaxVal },
      /* v1.20.0 — the RCM heads, present ONLY on an invoice with a reverse-charge line (every other invoice keeps its shape) */
      rcmLines.length ? { RcmCgstVal: r2(rcmVal.c), RcmSgstVal: r2(rcmVal.s), RcmIgstVal: r2(rcmVal.i) } : {}),
    /* Ours, beside the standard shape rather than inside it — a caller needs these and INV-01 has nowhere for them. */
    _cb: { scheme, supply, place_of_supply: pos, seller_state: sellerState, slabs: Object.values(bySlab),
           amount_payable: AmountPayable, reverse_charge: reverseCharge, price_includes_tax: priceIncludesTax,
           ...(rcmLines.length ? { rcm: rcmLines } : {}),
           ...(kindLines.length ? { kinds: kindLines } : {}),   /* v1.34.0: the supply kind each line named (GST-free · input-taxed · taxable), with why */
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
 *     by_rate: { "<rate>": { taxable, cgst, sgst, igst, tax, cess? } },     ← every slab the invoice carries
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
  /* v1.34.0 (AU1): the ONE head of a scheme that does not split is named by its scheme, lower case — `gst` for Australia, `vat` for a VAT country — the same
     name the country's pack gives the head (reg-au taxHeads: ['gst']), so the books post by_rate[rate].gst as they post India's cgst. Absent on every India slab. */
  const single = String(cb.scheme || 'tax').toLowerCase();
  for (const s of (cb.slabs || [])) {
    const rt = num(s.GstRt), one = num(s.TaxVal);
    by_rate[String(rt)] = { taxable: r2(num(s.AssVal)), cgst: r2(num(s.CgstVal)), sgst: r2(num(s.SgstVal)), igst: r2(num(s.IgstVal)),
                            tax: r2(num(s.CgstVal) + num(s.SgstVal) + num(s.IgstVal) + num(s.CesVal) + one) };
    if (num(s.CesVal)) by_rate[String(rt)].cess = r2(num(s.CesVal));     /* v1.16.0: the slab's cess, so the books post it; absent when nil (the shape is unchanged for every other invoice) */
    if (one) by_rate[String(rt)][single] = r2(one);
    if (!rt) continue;
    if (one && supply === 'domestic') heads.push({ name: String(cb.scheme || 'TAX').toUpperCase(), rate: rt, base: r2(num(s.AssVal)), amount: r2(one) });
    if (supply === 'inter') heads.push({ name: 'IGST', rate: rt, base: r2(num(s.AssVal)), amount: r2(num(s.IgstVal)) });
    else if (supply === 'intra') {
      heads.push({ name: 'CGST', rate: rt / 2, base: r2(num(s.AssVal)), amount: r2(num(s.CgstVal)) });
      heads.push({ name: 'SGST', rate: rt / 2, base: r2(num(s.AssVal)), amount: r2(num(s.SgstVal)) });
    }
  }
  heads.sort((a, b) => a.rate - b.rate || (a.name < b.name ? -1 : 1));
  /* v1.20.0 — reverse charge, read from the lines that carry it (absent when none does, so every other invoice keeps its shape):
     rcm.rows is what a purchase_bill event takes as `rcm`; rcm.lines names each line's category and notification. */
  let rcm;
  const rl = Array.isArray(cb.rcm) ? cb.rcm : [];
  if (rl.length) {
    const rows = {}, ls = [];
    let rt = 0, rc = 0, rsg = 0, ri = 0;
    rl.forEach((x) => {
      const it = items[x.line] || {}, c = r2(num(it.RcmCgstAmt)), sg = r2(num(it.RcmSgstAmt)), ig = r2(num(it.RcmIgstAmt)), tx = r2(num(it.AssAmt));
      const k = x.rate + '|' + (x.itc ? 1 : 0), row = rows[k] || (rows[k] = { rate: x.rate, itc: !!x.itc, taxable: 0, cgst: 0, sgst: 0, igst: 0 });
      row.taxable += tx; row.cgst += c; row.sgst += sg; row.igst += ig; rt += tx; rc += c; rsg += sg; ri += ig;
      ls.push({ line: x.line, category: x.category, section: x.section, notification: x.notification, rate: x.rate, itc: !!x.itc, taxable: tx, cgst: c, sgst: sg, igst: ig, tax: r2(c + sg + ig) });
    });
    const rr = Object.keys(rows).sort().map((k) => { const w = rows[k]; return { rate: w.rate, itc: w.itc, taxable: r2(w.taxable), cgst: r2(w.cgst), sgst: r2(w.sgst), igst: r2(w.igst) }; });
    rcm = { taxable: r2(rt), cgst: r2(rc), sgst: r2(rsg), igst: r2(ri), tax: r2(rc + rsg + ri), rows: rr, lines: ls };
  }
  return Object.assign({
    gross, savings, net: r2(gross - savings), taxable: r2(num(v.AssVal)), tax: r2(cgst + sgst + igst + cess + vat),
    total: r2(num(v.TotInvVal)), round_off: r2(num(v.RndOffAmt)),
    cgst, sgst, igst, cess, vat, supply, pos_state: cb.place_of_supply || null, currency_code: currency || null,
    by_rate, heads,
    lines: items.map((it) => ({ gross: r2(num(it.TotAmt)), discount: r2(num(it.Discount)), taxable: r2(num(it.AssAmt)),
      cgst: r2(num(it.CgstAmt)), sgst: r2(num(it.SgstAmt)), igst: r2(num(it.IgstAmt)), cess: r2(num(it.CesAmt)),
      tax: r2(num(it.CgstAmt) + num(it.SgstAmt) + num(it.IgstAmt) + num(it.CesAmt) + num(it.TaxAmt)), total: r2(num(it.TotItemVal)) })),
  }, rcm ? { rcm } : {});
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
