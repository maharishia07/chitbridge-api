// OWNS      tax on the chit: rate / HSN / slab on every minted line (decorate), the invoice for a chit (invoiceFor), the month's ledger and the GSTR-1 / GSTR-3B shapes
// FLOW      send ──▶ decorate(lines, shelf) stamps each line ──▶ invoiceFor(input) ──▶ ledger(entries, me) ──▶ gstr1 / gstr3b(ledgerRows, me, period)
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
 *   gstr1() / gstr3b() — the offline-tool shapes a return preparer or Tally imports. gstr1 is the ADOPTED engine's
 *                     (gst-returns.gstr1, B2CL by its B2CL_LIMITS) fed the ledger's rows as documents (ACC-225); gstr3b is
 *                     built here. ⚠️ Validate with the portal's offline tool before filing. WE DO NOT FILE.
 *
 * ── DECISIONS TAKEN WITHOUT ASKING (Athi asleep, "do not ask permission") ──────────────────────────────────────
 *   G3 · freeze at COMPLETED, not at send: completed is the moment both sides have finished, which is what a
 *        stamp means here. Until then the invoice is a live computation labelled `provisional`.
 *   G4 · period = calendar month (the law's); the month is the copy's completed_at when frozen, else sent_at.
 *   G5 · one entity per GSTIN — the network already models it; nothing to build for cross charge until then.
 *
 * ── ZERO DEPENDENCIES beyond siblings (DB access is injected) · TIER A ───────────────────────────────────────
 */
const slab = require('./tax-slab');
const money = require('./money');
const { round: roundMoney } = money; /* ⭐ money.round — the one rounder (SPEC-money-one-reader.md): half away from zero, on the decimal value */
const taxRules = require('./tax');
const num = (values) => {
  const n = Number(values);
  return Number.isFinite(n) ? n : null;
};
const units = require('./units'); /* ⭐ ONE UNIT, THREE NAMES — ours, UN/ECE Rec 20, and India's GST UQC */
const round2 = (n) => roundMoney(Number(n) || 0);

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
  const headTotals = hdr || {};
  const sent = String(headTotals.sender_entity_id) === String(me);
  if (!sent) return headTotals.sender_entity_id ? String(headTotals.sender_entity_id) : null;
  const recips = (Array.isArray(headTotals.all_recipients) ? headTotals.all_recipients : []).filter(
    (item) => item && item.entity_id && String(item.entity_id) !== String(me) && String(item.role || '').toLowerCase() !== 'sender'
  );
  const to = recips.find((item) => ['receiver', 'to', 'act'].includes(String(item.role || '').toLowerCase())) || recips[0];
  return to ? String(to.entity_id) : null;
}

function partyOf(row, extra) {
  const rowData = row || {};
  const flags = rowData.policy_flags && typeof rowData.policy_flags === 'object' ? rowData.policy_flags : {};
  /* T2-NATDEF: the party's own pack says whether its tax turns on the state (tax-packs supply 'state'), never the literal India */
  const pack = rowData.country ? require('./tax-packs').packFor(String(rowData.country).toUpperCase()) : null;
  return Object.assign(
    {
      /* CX0: a state is read off the tax number only under a state-split GST — an ABN's or a TRN's first digits are not a state */
      Gstin: rowData.gstn || null,
      LglNm: rowData.display_name || null,
      State: !rowData.country || (pack && pack.supply === 'state') ? stateOfGstin(rowData.gstn) : null,
      /* The border a VAT-type scheme turns on (b202). India's GST turns on the state above. */
      Country: rowData.country ? String(rowData.country).toUpperCase() : null,
      RegType: regTypeOf(rowData, flags)
    },
    extra || {}
  );
}
/**
 * the party's RegType. A row read WITHOUT the governance row (no `tax_registration` key) carries the scheme as stated, regular when none (a
 * flag nobody set is a scheme, not a registration). A row that carries it answers country-setup.registrationOf — 'unknown' when nobody said (ACC-198).
 */
function regTypeOf(row, flags) {
  if (Object.prototype.hasOwnProperty.call(row, 'registration')) return require('./country-setup').registrationWord(row.registration, flags.gst_registration); /* ACC-273: withRegistration read the shop's own answer */
  if (!Object.prototype.hasOwnProperty.call(row, 'tax_registration')) return String(flags.gst_registration || 'regular'); /* no reader asked: the flag as stated */
  const countrySetup = require('./country-setup');
  const answer = countrySetup.registrationOf({ country: row.country, number: row.gstn, scheme: flags.gst_registration, tax_registration: row.tax_registration });
  return countrySetup.registrationWord(answer, flags.gst_registration);
}

/**
 * ⭐ ACC-273 / ACC-277 · withRegistration(row) → the identities row plus `registration`, the ONE reader's answer (country-setup.registrationOfShop: 'unknown' · 'unregistered' ·
 * 'composition' · 'regular') for a shop that carries no tax number of its own — read once here so partyOf (sync, pure) carries the owner's word as RegType, the way the till
 * snapshot does (routes/till.js shop.reg_type). A row with a tax number, no country or no id is returned as it is: a number is a registration. EVERY door that builds a
 * party from an identities row for a SALE reads the row through this (services.shopOf, send-money.partiesOf, tax-copy.partiesFor / ledgerFor); never a second reader.
 */
async function withRegistration(row) {
  if (!row) return row;
  const id = row.identity_id || row.entity_id;
  if (!id || !row.country || (String(row.gstn || '').trim() && require('./tax-facts').numberRegisters(row.country)) || Object.prototype.hasOwnProperty.call(row, 'registration')) return row;
  return Object.assign({}, row, { registration: await require('./country-setup').registrationOfShop(id) });
}
/** a seller whose registration nobody said (RegType 'unknown', no tax number): it may not charge tax, and the engine reads an unknown word as REGULAR, so invoiceFor hands it 'unregistered' and the answer says why */
const unknownSeller = (seller) => !!seller && seller.RegType === 'unknown' && !!seller.Country && !String(seller.Gstin || '').trim();

/** the product's bill of materials as the line carries it (the line's own wins): [{ item, qty }], or nothing */
function bomOf(line, itemData) {
  return line.bom || (Array.isArray(itemData.bom) && itemData.bom.length ? itemData.bom.filter((buyerData) => buyerData && buyerData.item).map((buyerData) => ({ item: String(buyerData.item), qty: Number(buyerData.qty) || 1 })) : undefined);
}

/** the fields a catalogue slab adds to one bill line: rate, cess, slab, supply kind, the product's bill of materials, HSN (decorate's answer for a line that has none) */
function slabFieldsOf(line, itemData, resolved) {
  return Object.assign({}, line, {
    gst_rate: resolved.rate,
    cess_rate: resolved.cess || 0 /* a cess the slab declares but could not be read rides as cess_unreadable below (TAX-EXPLICIT); an absent cess is no cess */,
    ...(resolved.cess_unreadable ? { cess_unreadable: true } : {}),
    tax_slab: resolved.slab_id || null,
    tax_slab_name: resolved.name || null,
    /* SUPPLY KIND (AE-F-11): the slab's answer rides on the line so a SENT invoice or an order files as the counter bill does (a 0% line with a kind is answered); only when the slab says one */
    ...(resolved.tax_kind ? { tax_kind: resolved.tax_kind } : {}),
    ...(resolved.nil_kind ? { nil_kind: resolved.nil_kind } : {}),
    /* The product's bill of materials rides on the line AS DETAIL (BACKLOG "BOM": one line, components attached —
       the line count and the totals do not change; what the line is MADE OF travels with it, frozen at send). */
    bom: bomOf(line, itemData),
    tax_source: resolved.source,
    tax_scheme: resolved.scheme || 'GST',
    hsn: line.hsn || itemData.hsn || itemData.hs_code || itemData.hsn_code || (resolved.hsn && resolved.hsn[0]) || null
  });
}

/**
 * decorate(lines, shelf) → lines with gst_rate · hsn · tax_slab · tax_slab_name where the seller's catalogue answers.
 * `shelf` = { items:[catalogue rows with item_id + item_data], slabs, categories, face } — read once per send by the
 * route. Pure: a line that already carries a rate keeps it; a line that matches nothing is returned untouched.
 */
/** resolveItem(item_data, shelf) → tax-slab.resolve's answer for one product on this shelf. ONE place the shelf meets the slab rule: decorate (every
 *  line) and Home's Tax Lab count (lib/home-facts taxLab: source 'none' = no slab on the product, its categories or the catalogue) both read it. */
function resolveItem(itemData, shelf) {
  const shelfData = shelf || {};
  return slab.resolve({ item_data: itemData || {}, face: shelfData.face || {}, slabs: shelfData.slabs || [], categories: shelfData.categories || [], asOf: require('./shop-clock').today(shelfData.zone) }); /* M3: the shop's day */
}
function decorate(lines, shelf) {
  const shelfData = shelf || {};
  const items = Array.isArray(shelfData.items) ? shelfData.items : [];
  const byId = new Map(),
    byName = new Map();
  for (const it of items) {
    const itemData = it.item_data || it;
    if (it.item_id) byId.set(String(it.item_id), itemData);
    const name = String(itemData.name || '')
      .trim()
      .toLowerCase();
    if (name && !byName.has(name)) byName.set(name, itemData);
  }
  return (Array.isArray(lines) ? lines : []).map((l) => {
    if (!l || typeof l !== 'object') return l;
    if (l.gst_rate !== undefined && l.gst_rate !== null) return l; // the line already knows
    const itemData =
      (l.item_id && byId.get(String(l.item_id))) ||
      byName.get(
        String(l.name || l.particulars || '')
          .trim()
          .toLowerCase()
      );
    if (!itemData) return l;
    const resolved = resolveItem(itemData, shelfData);
    if (resolved.rate === null || resolved.rate === undefined) return l;
    return slabFieldsOf(l, itemData, resolved);
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
  const sellerData = seller || {},
    buyerData = Object.assign({}, buyer || {});
  const sellerCountry = String(sellerData.Country || sellerData.country || '')
    .trim()
    .toUpperCase();
  const sellerState = String(sellerData.State || sellerData.state || '').trim();
  const text = String(buyerData.Country || buyerData.country || '').trim();
  const bPos = String(buyerData.Pos || buyerData.place_of_supply || buyerData.State || buyerData.state || '').trim();
  const tookCountry = !text && !!sellerCountry,
    tookState = !bPos && !!sellerState;
  if (tookCountry) buyerData.Country = sellerCountry;
  if (tookState) buyerData.Pos = sellerState;
  if (!tookCountry && !tookState) return { buyer: buyerData, note: null };
  const inside = tookCountry ? sellerCountry : text.toUpperCase() || sellerCountry || "the seller's country";
  return { buyer: buyerData, note: 'Walk-in: taxed as a sale inside ' + inside + (tookState ? ' (place of supply ' + sellerState + ", the seller's state)" : '') + '.' };
}

const { engineLineOf, rcmCategoryOf } = require('./tax-engine-line'); /* one bill line as the engine reads it, and the reverse-charge category a line names */

/**
 * ⭐ CTRY-139: the DAY the engine reads a law-set price band by — the shop's calendar day of the document, never a UTC slice of an instant.
 * A bill / invoice: its own billed_at (else the moment `at` the caller holds). A credit or debit NOTE is never banded (null = no band): its lines are the original invoice's lines at their stated
 * rate, or DELTA lines (old price minus new price, price-note.replacementDeltas), and a band read on a delta's own value would re-rate the original supply (a 500 price difference on a 3,000
 * garment at 18% would read 5%). The note keeps the rate its line carries, stamped when the invoice was issued (critic, 11 Nov).
 * `shop` is the seller party (its timezone, else its Country / country); null when the moment is no moment.
 */
/**
 * ⭐ R6-01 (Fable country review): did the sale STATE that it is an export? `business_json.is_export`, a boolean the shop answers when the buyer is foreign (docs/FIELDS.md); anything else is
 * no answer (undefined), never defaulted, so a buyer's country alone never removes the tax. The engine (tax.determine `isExport`) reads it; one reader for every caller of invoiceFor.
 */
const exportStatedOf = (business) => (business && typeof business.is_export === 'boolean' ? business.is_export : undefined);

/**
 * EGM-T1: the shop's day of the ORIGINAL bill a counter credit/debit note names (the till stamps business_json.against.billed_at), or null. A return reads a note's 0%-kind rule by this day
 * (engine against_date) so a December note of a November nil line takes back November's nil row. Null: not a note, or it names no readable moment: the note is read by its own day.
 */
function againstDayOf(business, purpose, shop) {
  const named = business && business.against && typeof business.against === 'object' ? business.against.billed_at : null;
  if (!(purpose === 'credit_note' || purpose === 'debit_note') || !named) return null;
  const day = require('./books-hooks').dayOf(named, shop && (shop.timezone || shop.Country || shop.country));
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(day || '')) ? day : null;
}
/** is this document a credit or debit note: it carries the rate of the ORIGINAL bill (the ONE note rule: billDayOf and invoiceFor both read it) */
const isNoteOf = (purpose) => purpose === 'credit_note' || purpose === 'debit_note';
function billDayOf(business, purpose, at, shop) {
  if (isNoteOf(purpose)) return null;
  const moment = (business && business.billed_at) || at;
  return moment ? require('./books-hooks').dayOf(moment, shop && (shop.timezone || shop.Country || shop.country)) : null;
}

/**
 * invoiceFor({ lines, seller, buyer, currency, chit_id, at, bill_day }) → { invoice (INV-01 shape), rated, unrated, provisional }
 * `bill_day` (YYYY-MM-DD, the shop's day, see billDayOf) is handed to the engine as `asOf`: the dated rate rows (price bands) are read as of it. Absent = no band.
 * `rated` / `unrated` say how many lines carried a rate — an invoice with unrated lines is honest about being partial.
 */
function invoiceFor(input) {
  const i = input || {};
  const lines = (Array.isArray(i.lines) ? i.lines : []).filter((item) => item && !item.removed);
  /* RCM-POST: a line that names its reverse-charge category is rated by the pack's notification when it carries no rate of its own */
  const rated = lines.filter((item) => num(item.gst_rate) !== null || num(item.rate) !== null || !!rcmCategoryOf(item)).length;
  const walkInResult = walkIn(i.seller, i.buyer); /* ⭐ BUY1: a buyer with no country / no place of supply is taxed inside the shop */
  const asked = unknownSeller(i.seller);
  const determined = taxRules.determine({
    seller: asked ? Object.assign({}, i.seller, { RegType: 'unregistered' }) : i.seller || {},
    buyer: walkInResult.buyer,
    lines: lines.map(engineLineOf),
    priceIncludesTax: !!i.priceIncludesTax,
    reverseCharge: !!i.reverseCharge,
    isExport: exportStatedOf(i), /* R6-01: the sale STATES an export (true) or says it is not (false); absent = not answered, so a border pack taxes it as domestic */
    asOf: /^\d{4}-\d{2}-\d{2}$/.test(String(i.bill_day || '')) ? i.bill_day : undefined,
    rateFromOriginal: isNoteOf(i.purpose), /* CTRY-139: a note keeps the original bill rate: no band, no mark (engine 1.86.0) */
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
  if (walkInResult.note && determined._cb) determined._cb.notes = (Array.isArray(determined._cb.notes) ? determined._cb.notes : []).concat(walkInResult.note);
  if (asked && determined._cb) determined._cb.registration = unknownNote(i.seller.Country);
  const invoice = Object.assign({ DocDtls: { Typ: 'INV', No: i.chit_id || null, Dt: i.at || null }, currency: i.currency || currencyOf(i.seller) }, determined);
  return {
    invoice,
    tax_status: lineTaxStatusOf(invoice, lines) /* TAX-EXPLICIT: one status per line; the caller that makes a bill refuses an UNAVAILABLE one (refuseUnavailable) */,
    rated,
    unrated: lines.length - rated,
    provisional: !i.frozen
  };
}

const { lineTaxStatusOf, refuseUnavailable } = require('./tax-line-status'); /* TAX-EXPLICIT: the status of each line moved to its own small module */

/** ACC-273: what an invoice from a seller nobody asked says: no tax charged, not a tax invoice, and the question (the till's own code and sentence, country-setup.registrationAsk) */
function unknownNote(country) {
  const question = require('./country-setup').registrationAsk(country);
  return { state: 'unknown', code: question.code, tax_invoice: false, warning: 'No tax is charged and this is not a tax invoice: nobody said whether this business is registered. ' + question.question };
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
function heads(invoice) {
  const values = (invoice && invoice.ValDtls) || {};
  return {
    taxable: round2(values.AssVal),
    cgst: round2(values.CgstVal),
    sgst: round2(values.SgstVal),
    igst: round2(values.IgstVal),
    cess: round2(values.CesVal),
    vat: round2(values.TaxVal) /* the one head of a non-GST scheme; 0 under GST */,
    total: round2(values.TotInvVal),
    tax: round2((values.CgstVal || 0) + (values.SgstVal || 0) + (values.IgstVal || 0) + (values.CesVal || 0) + (values.TaxVal || 0))
  };
}
const zero = () => ({ taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, vat: 0, total: 0, tax: 0 });
const add = (a, buyerData) => {
  for (const k of Object.keys(a)) a[k] = round2(a[k] + (buyerData[k] || 0));
  return a;
};
const sub = (a, buyerData) => {
  for (const k of Object.keys(a)) a[k] = round2(a[k] - (buyerData[k] || 0));
  return a;
};
/**
 * ⚠️⚠️ A CREDIT NOTE REDUCES TAX — IT IS NOT ANOTHER SALE (2026-09-28). A counter return is a self chit with a customer,
 * exactly like a counter bill, so partiesFor() made the shop its seller and every return was ADDED to output tax: the
 * ledger, GSTR-1 and GSTR-3B all overstated what the shop owed by every refund it gave. Known by the chit's purpose (the
 * counter writes 'credit_note') or by an invoice that says CRN.
 */
const isCreditNote = (e) => String((e && e.purpose) || '') === 'credit_note' || !!(e && e.invoice && e.invoice.DocDtls && e.invoice.DocDtls.Typ === 'CRN');

/** ACC-192 slice 2: a DEBIT note raises tax (s.34(3)); it is an outward supply that GSTR-1 files in table 9B as 'D', not as an invoice in table 4. Known by the chit's purpose or an invoice that says DBN. */
const isDebitNote = (e) => String((e && e.purpose) || '') === 'debit_note' || !!(e && e.invoice && e.invoice.DocDtls && e.invoice.DocDtls.Typ === 'DBN');

/** the ledger side of an outward row that is not a credit note: a debit note is output_dn, anything else output */
const outwardSideOf = (e) => (isDebitNote(e) ? 'output_dn' : 'output');

/**
 * output tax less input credit, by head, with the total — F-F-08 (WALK F, batch 1128): the credit is SET OFF in the statutory order (CGST Act s.49(5), Rule 88A), by the pack's ONE set-off
 * (posting.gstSetOff, the engine the month close and the GSTR-3B 6.1 call): IGST credit → IGST, CGST, SGST; CGST credit → CGST, IGST; SGST credit → SGST, IGST. A head is what is still PAYABLE
 * after it (a credit left over shows as a negative head, the carry), so `total` is unchanged. A head already negative (credit notes beyond the sales) stays as it is, outside the set-off.
 * Hand: IGST credit 600.00 against IGST 160.16, CGST 247.50, SGST 247.50 → IGST 0, CGST 0, SGST 55.16.
 */
function netOf(output, credit) {
  const pos = (n) => Math.max(0, Number(n) || 0),
    negPart = (n) => Math.min(0, Number(n) || 0),
    heads4 = ['cgst', 'sgst', 'igst', 'cess'];
  const side = (o) => ({ cgst: pos(o.cgst), sgst: pos(o.sgst), igst: pos(o.igst), cess: pos(o.cess) });
  const answer = require('./books-engines').posting().gstSetOff({ country: 'IN', ref: 'LEDGER-NET', date: null, output: side(output), input: side(credit) });
  const netTax = {};
  for (const head of heads4) {
    netTax[head] = answer && answer.ok ? round2(answer.payable[head] - answer.carried[head] + negPart(output[head]) - negPart(credit[head])) : round2(output[head] - credit[head]); /* refused: the plain difference, never a guessed order */
  }
  netTax.vat = round2((output.vat || 0) - (credit.vat || 0));
  netTax.total = round2(netTax.cgst + netTax.sgst + netTax.igst + netTax.cess + netTax.vat); /* G-F-08: the one head of a non-GST scheme (VAT, GST) is part of what is payable, not left at 0 */
  return netTax;
}
/** output tax follows WHO SELLS (e.sells, from tax-copy) — a received storefront order is the shop's own sale */
const sellsIn = (entry) => (entry.sells !== undefined ? entry.sells : entry.direction === 'sent');
/** why the ledger does not count an entry at all: no invoice to read · the shop on both sides (not a supply) · a copy I sent and do not sell (neither my sale nor my purchase) · else null (it is counted) */
function leftOutKind(entry) {
  if (!entry || !entry.invoice) return 'no_invoice';
  const bothSides = entry.seller && entry.buyer && entry.seller.entity_id && entry.seller.entity_id === entry.buyer.entity_id;
  if (bothSides) return 'self_supply';
  return !sellsIn(entry) && entry.direction !== 'received' ? 'no_side' : null;
}
/**
 * ledger(entries, me) → { output, itc, net, count, rows, skipped }
 * skipped (ACC-268): [{ at, kind }] — an entry the ledger left out, by its INDEX in `entries` (kind: no_invoice · self_supply · no_side); the caller names it, this file never sums it
 * entries: [{ chit_id, direction:'sent'|'received', invoice, provisional, seller, buyer, at, subject }]
 * ⚠️ ITC only when I am a regular taxpayer AND the seller charged tax (regular seller, not zero-rated to me).
 */
function ledger(entries, me) {
  const myReg = String((me && me.RegType) || 'regular');
  const output = zero(),
    inputCredit = zero(),
    rows = [],
    list = Array.isArray(entries) ? entries : [],
    skipped = list.map((entry, at) => ({ at, kind: leftOutKind(entry) })).filter((item) => item.kind);
  for (const e of list) {
    if (leftOutKind(e)) continue;
    const headTotals = heads(e.invoice);
    const creditNote = isCreditNote(e);
    /* output tax follows WHO SELLS (e.sells, from tax-copy) — a received storefront order is the shop's own sale */
    if (sellsIn(e)) {
      if (creditNote) {
        sub(output, headTotals);
        rows.push(Object.assign({ side: 'output_cn' }, e, { heads: headTotals }));
      } else {
        add(output, headTotals);
        rows.push(Object.assign({ side: outwardSideOf(e) }, e, { heads: headTotals }));
      }
    } else {
      const sellerReg = String((e.seller && e.seller.RegType) || 'regular');
      const eligible = myReg === 'regular' && sellerReg === 'regular' && headTotals.tax > 0;
      /* a supplier's credit note to me gives back input credit I took — it reduces ITC, it never adds to it */
      if (eligible) {
        if (creditNote) sub(inputCredit, headTotals);
        else add(inputCredit, headTotals);
      }
      rows.push(Object.assign({ side: creditNote ? (eligible ? 'itc_cn' : 'no-itc') : eligible ? 'itc' : 'no-itc' }, e, { heads: headTotals }));
    }
  }
  return { output, itc: inputCredit, net: netOf(output, inputCredit), count: rows.length, provisional: rows.some((item) => item.provisional), rows, skipped };
}

/**
 * ⚠️ The seller's word → the code the portal expects. 'OTH' is the honest answer for anything we cannot map: it is a
 * value the GSTR accepts, and a code we cannot vouch for would be a false statement on a return.
 */
function uqcFor(word) {
  try {
    return units.uqcOf(word) || 'OTH';
  } catch (_) {
    return 'OTH';
  }
}

/*
 * ── GSTR-1: ONE BUILDER (ACC-225, 2026-11-05) ───────────────────────────────────────────────────────────────────
 * The adopted engine gst-returns.gstr1 builds the file: B2B · B2CL (Table 5, the limit by the month from its B2CL_LIMITS — ₹1 lakh
 * from August 2024, Notification 12/2024-Central Tax; ₹2.5 lakh before) · B2CS · CDNR / CDNUR · nil · HSN · Table 13. This file
 * only turns the month's ledger rows into the engine's documents; nothing is summed or sorted here. The builder that lived here
 * had no B2CL table and the old limit, so a large inter-state B2C bill was summed into B2CS — two builders, the filed one wrong.
 */
const gstReturns = require('./gst-returns');
const GSTR1_SCHEMA_VERSION = 'GST3.1.4'; /* the file's version label, written untouched (what this file always wrote) */
/** the bill number as the return names the document (Table 13, cdnr, b2b): the number on the buyer's paper, WHOLE. EL-TAX F6 (1128): it was cut to 16 characters here, so 99 notes CN/C1/26-27/10/0001..0099 all became the same ref and Table 13 counted one.
 *  The 16-character rule (CGST Rule 46(b)) is for the number an invoice is ISSUED with; a longer ref reaches the engine, which names it in Table 13 (`incomplete`, omitted) instead of merging it. */
const numOf = (rowData) => String(rowData.doc_no || rowData.chit_id || '');
/** the last day of the 'MMYYYY' period as YYYY-MM-DD (the day the pack's dated rows are read by) */
const lastDayOf = (period) => { const year = Number(String(period).slice(2)), month = Number(String(period).slice(0, 2)); return year + '-' + String(month).padStart(2, '0') + '-' + String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0'); };
/** 'MMYYYY' (tax-copy monthBounds period) → the engine's 'YYYY-MM' */
const monthOfPeriod = (period) => String(period).slice(2) + '-' + String(period).slice(0, 2);
/** the frozen invoice for the HSN summary: each line's Unit as the portal's UQC (uqcFor), the record itself untouched */
function withUqc(invoice) {
  const lines = (invoice.ItemList || []).map((item) => Object.assign({}, item, { Unit: uqcFor(item.Unit) }));
  return Object.assign({}, invoice, { ItemList: lines });
}
/** the ledger side of an outward row → the engine's document kind (output_dn: ACC-192, GSTR-1 table 9B 'D') */
const GSTR1_KIND = { output: 'invoice', output_cn: 'credit_note', output_dn: 'debit_note' };
/** one ledger row as the engine's document: an output row is an invoice, an output_cn row a credit note, an output_dn row a debit note; an export / SEZ supply is said zero-rated */
function gstr1DocumentOf(row) {
  const doc = { kind: GSTR1_KIND[row.side],  ref: numOf(row), date: docDay(row), inv: withUqc(row.invoice) };
  if (row.against_day) doc.against_date = row.against_day; /* EGM-T1: a note is read by its original's day */
  if (row.period_of_record) doc.period = row.period_of_record; /* ACC-224: the month the BOOKS hold it in — a late invoice of an earlier month keeps its own date and sits in this return */
  if (ZERO_RATED_SUPTYP.test(String((row.invoice.TranDtls && row.invoice.TranDtls.SupTyp) || ''))) doc.zero_rated = true;
  return doc;
}
/** the month's outward rows (ledger sides output · output_cn) as the engine's documents */
function gstr1Documents(monthLedger) {
  return ((monthLedger && monthLedger.rows) || []).filter((row) => row.invoice && Object.prototype.hasOwnProperty.call(GSTR1_KIND, row.side)).map(gstr1DocumentOf);
}
/**
 * ACC-254: a GSTR return is India's. A shop whose country is stated and is not India is refused in those words, naming its country (country-setup.nameOf,
 * the one name reader) — never the India GSTIN sentence, and never a file built from an ABN or a TRN that happens to be 15 characters. A shop with no country stated
 * is not guessed at: it takes the engine's own refusal, as before.
 */
function gstrIndiaOnly(shopParty) {
  const country = String((shopParty && (shopParty.Country || shopParty.country)) || '').toUpperCase();
  if (!country || country === 'IN') return null;
  return { ok: false, why: 'GSTR returns are for shops registered for GST in India. This shop is in ' + require('./country-setup').nameOf(country) + '.' };
}
/**
 * ACC-278: the engine's own refusal for a shop with no usable GSTIN, or null. The rule and its sentence live in the engine (gst-returns ctx_); we ask it with no documents
 * instead of copying the regex, so GSTR-3B and GSTR-1 can never disagree about what a GSTIN is.
 */
function gstinRefusal(shopParty, period) {
  const asked = gstReturns.gstr1({ gstin: (shopParty && shopParty.Gstin) || '', month: monthOfPeriod(period), documents: [] });
  return asked.ok ? null : asked;
}
/**
 * gstr1(led, me, period) → the GSTR-1 offline-tool JSON for the month (gstin · fp · version · b2b · b2cl · b2cs · cdnr · cdnur · nil · hsn ·
 * doc_issue) plus `_cb` { b2cl_limit, warnings, summary } — what the engine said beside the file; or the engine's refusal { ok: false, why }
 * (no 15-character GSTIN on me). `period` is tax-copy's 'MMYYYY'. ⚠️ Validate with the portal's offline tool before filing. WE DO NOT FILE.
 */
/** how many invoices the B2B rows hold (a count of documents, not money) */
function invoicesOf(buyers) {
  let count = 0;
  (buyers || []).forEach((buyer) => { count += (buyer.inv || []).length; });
  return count;
}
function gstr1(ledgerRows, me, period) {
  const away = gstrIndiaOnly(me);
  if (away) return away;
  const built = gstReturns.gstr1({ gstin: (me && me.Gstin) || '', month: monthOfPeriod(period), documents: gstr1Documents(ledgerRows), schema_version: GSTR1_SCHEMA_VERSION });
  if (!built.ok) return built;
  const einvoice = require('./einvoice-note').einvoiceNoteFor({ country: me && (me.Country || me.country), day: lastDayOf(period), b2b: invoicesOf(built.json.b2b) }); /* F13 (1128): the IRN warning, null when no registered buyer */
  return Object.assign(built.json, { _cb: { b2cl_limit: built.b2cl_limit, warnings: built.warnings, summary: built.summary, prior_period: priorPeriodOf(ledgerRows), reversed: reversedOf(ledgerRows), not_in_books: notInBooksOf(ledgerRows),
      tax_differs: taxDiffersOf(ledgerRows), expense_no_tax: expenseNoTaxOf(ledgerRows), unanswered: built.unanswered || 0, einvoice, ...(built.table13 ? { table13: built.table13 } : {}) } }); /* F6: Table 13 names the refs the portal cannot take (over 16), whole, instead of merging them */
}
/** ACC-224: the late bills of an earlier month this month's rows carry (tax-copy monthOfRecord), as the return names them */
/** ACC-270: bills reversed this month after an earlier month held them / counter bills the books hold no entry for — named beside the return (tax-copy ledgerFor sets them on the month's ledger) */
const reversedOf = (monthLedger) => (monthLedger && monthLedger.reversed) || [];
const notInBooksOf = (monthLedger) => (monthLedger && monthLedger.not_in_books) || [];
/** F5b: issued invoices the server's check disagrees with (tax-copy taxDiffersItem) — named in the return's _cb */
const taxDiffersOf = (monthLedger) => (monthLedger && monthLedger.tax_differs) || [];
/** ACC-269: till expenses the month holds with no ITC claimed (no GST stated, or stated and not in the books) — named, never a silent 0 */
const expenseNoTaxOf = (monthLedger) => (monthLedger && monthLedger.expense_no_tax) || [];
const priorPeriodOf = (monthLedger) => ((monthLedger && monthLedger.rows) || []).filter((row) => row.prior_period).map((row) => row.prior_period);
/** the day a return names a document by: the shop's calendar day (tax-copy ledgerFor sets `day`), else the UTC date of the moment (a row built without it) */
const docDay = (row) => row.day || String((row && row.at) || '').slice(0, 10);

/* GSTR-3B 3.1(b): the supply types (INV-01 TranDtls.SupTyp, the e-invoice schema's codes) that are ZERO-RATED — an export or a supply to an SEZ */
const ZERO_RATED_SUPTYP = /^(SEZWP|SEZWOP|EXPWP|EXPWOP)$/;
/**
 * ⭐ GSTR-3B: ONE BUILDER (F1, batch 1128). The adopted engine gst-returns.gstr3b builds the figures — 3.1(a)(b)(c)(d)(e), 4(A)(3) and (5), 4(B), 4(D) — from the month's ledger rows turned into its
 * documents (an output row an invoice / credit / debit note, an itc row a purchase, an itc_cn row a purchase return); this file only shapes the engine's answer as the GSTN offline tool's JSON.
 * The builder that lived here read no reverse-charge head (RcmIgstVal), so GTA freight of ₹1,00,000 at 5% RCM showed 3.1(d) 0 while the books owed ₹5,000.
 * A purchase whose seller charged no tax (an unregistered GTA) is an itc-less 'no-itc' row, but under reverse charge its tax is OURS: those rows go to the engine too, for 3.1(d) and 4(A)(3).
 * A shop that is not a regular taxpayer takes no input credit and owes no 3.1(d) here (composition files CMP-08, not 3B), as the ledger already decides.
 */
const GSTR3B_INWARD_KIND = { itc: 'purchase', itc_cn: 'purchase_return' };
/** does this frozen invoice carry reverse-charge tax (the RCM heads, written when a line names its category: tax.determine)? */
const carriesRcm = (invoice) => ['RcmIgstVal', 'RcmCgstVal', 'RcmSgstVal'].some((key) => Number(invoice && invoice.ValDtls && invoice.ValDtls[key]) > 0);
/**
 * the invoice the engine reads: a line the PACK names non-GST (the invoice's _cb.kinds, tax.js supplyKinds) carries the engine's own per-line word (_nil_kind, 3.1(e)), so the engine files it there instead of 3.1(c).
 * A line whose slab already said its word keeps it. The record itself is untouched (a copy).
 */
function withNamedKinds(invoice) {
  const kinds = invoice._cb && Array.isArray(invoice._cb.kinds) ? invoice._cb.kinds.filter((entry) => entry && /^non[-_ ]?gst/i.test(String(entry.kind || ''))) : [];
  if (!kinds.length) return invoice;
  const lines = (invoice.ItemList || []).map((item, index) => (!item._nil_kind && kinds.some((entry) => entry.line === index) ? Object.assign({}, item, { _nil_kind: 'non_gst' }) : item));
  return Object.assign({}, invoice, { ItemList: lines });
}
/** the month's ledger rows as the engine's documents (outward as GSTR-1's, inward by the row's side); every document is placed in the month asked, the ledger having chosen it already.
 *  An expense chit's input tax (expense_itc) has posted tax heads and NO lines for the engine to read: it is not a document, it is added by gstr3b from its own heads (expenseItcOf). */
function gstr3bDocuments(monthLedger, seller, month) {
  const regular = String((seller && seller.RegType) || 'regular') === 'regular',
    rows = (monthLedger && monthLedger.rows) || [];
  const outward = gstr1Documents(monthLedger).map((doc) => Object.assign(doc, { inv: withNamedKinds(doc.inv) }));
  const inward = regular
    ? rows
        .filter((row) => row.invoice && !row.expense_itc && (Object.prototype.hasOwnProperty.call(GSTR3B_INWARD_KIND, row.side) || (row.side === 'no-itc' && !isCreditNote(row) && carriesRcm(row.invoice))))
        .map((row) => ({ kind: GSTR3B_INWARD_KIND[row.side] || 'purchase', ref: numOf(row), date: docDay(row), inv: row.invoice }))
    : [];
  return outward.concat(inward).map((doc) => Object.assign(doc, { period: month }));
}
/** the input tax of the month's expense chits, by head in rupees (their posted tax, ACC-269) — the credit the engine cannot read from lines; none for a shop that is not a regular taxpayer */
function expenseItcOf(monthLedger, me) {
  const sum = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
  if (String((me && me.RegType) || 'regular') !== 'regular') return sum;
  for (const row of (monthLedger && monthLedger.rows) || []) {
    if (!row.expense_itc || row.side !== 'itc') continue;
    for (const head of Object.keys(sum)) sum[head] = round2(sum[head] + (row.heads[head] || 0));
  }
  return sum;
}
/**
 * IN-F-08: the month's set-off, READ and never posted — the engine's own CBPosting.gstSetOff (CGST Act s.49(5): IGST credit against IGST, then CGST, then SGST), fed this return's output tax and net input
 * credit per head. → { utilised[], payable{}, carried{}, pay_total } in rupees, or null when the engine is not there or refuses (the return itself is unaffected). One calculation: the GST close posts the same one.
 */
function setOffPreview(output, input) {
  try {
    const answer = require('./books-engines').posting().gstSetOff({
      country: 'IN',
      ref: 'PREVIEW',
      output: { cgst: output.cgst, sgst: output.sgst, igst: output.igst },
      input: { cgst: input.cgst, sgst: input.sgst, igst: input.igst }
    });
    if (!answer || !answer.ok) return null;
    const payTotal = require('./money').sum(['cgst', 'sgst', 'igst'].map((head) => ({ amount: answer.payable[head] || 0, currency: currencyOf({ country: 'IN' }) }))).amount; /* the money module's own total (red1128: no reduce here) */
    return { utilised: answer.utilised, payable: answer.payable, carried: answer.carried, pay_total: payTotal };
  } catch (e) {
    require('./logger').fellBack('tax-lines set-off preview: the helper failed — answered no preview (never a payable of 0)', e);
    return null;
  }
}
/** one engine five-column line (rupees) → the offline tool's names */
const gstnLine = (line, withTax) => Object.assign({ txval: line.txval }, withTax === false ? {} : { iamt: line.igst, camt: line.cgst, samt: line.sgst, csamt: line.cess });
const hasTax = (line) => [line.igst, line.cgst, line.sgst, line.cess].some((figure) => figure !== 0); /* a row the form needs only when it holds tax */
const gstnItc = (ty, line) => ({ ty, iamt: line.igst, camt: line.cgst, samt: line.sgst, csamt: line.cess });
function gstr3b(ledgerRows, me, period) {
  const refusal = gstrIndiaOnly(me) || gstinRefusal(me, period);
  if (refusal) return refusal;
  const month = monthOfPeriod(period);
  const built = gstReturns.gstr3b({ gstin: (me && me.Gstin) || '', month, documents: gstr3bDocuments(ledgerRows, me, month), opening_itc: (ledgerRows && ledgerRows.opening_itc) || undefined }); /* F2: the credit the books carry in, so a shortfall is paid or carried, never dropped */
  if (!built.ok) return built;
  const outwardLine = built.s3_1.a, itc4 = built.s4, expense = expenseItcOf(ledgerRows, me);
  const plus = (line) => ({ igst: round2(line.igst + expense.igst), cgst: round2(line.cgst + expense.cgst), sgst: round2(line.sgst + expense.sgst), cess: round2(line.cess + expense.cess) });
  return {
    gstin: (me && me.Gstin) || null,
    ret_period: period,
    sup_details: {
      osup_det: gstnLine(outwardLine),
      osup_zero: { txval: built.s3_1.b.txval, iamt: built.s3_1.b.igst, csamt: built.s3_1.b.cess },
      osup_nil_exmp: { txval: built.s3_1.c.txval },
      isup_rev: gstnLine(built.s3_1.d), /* 3.1(d) inward supplies liable to reverse charge */
      osup_nongst: { txval: built.s3_1.e.txval }
    },
    itc_elg: {
      itc_avl: [gstnItc('OTH', plus(itc4.available.other))].concat(hasTax(itc4.available.reverse_charge) ? [gstnItc('ISRC', itc4.available.reverse_charge)] : []), /* 4(A)(5) all other (the engine's, plus the expense chits' posted input tax) · 4(A)(3) reverse charge */
      itc_rev: [['RUL', itc4.reversed.rules_and_17_5], ['OTH', itc4.reversed.others]].filter(([, line]) => hasTax(line)).map(([ty, line]) => gstnItc(ty, line)), /* 4(B)(1) · 4(B)(2): a purchase return the supplier's credit note gave back */
      itc_net: (({ iamt, camt, samt, csamt }) => ({ iamt, camt, samt, csamt }))(gstnItc('', plus(itc4.net))),
      itc_inelg: hasTax(itc4.ineligible.other) ? [gstnItc('OTH', itc4.ineligible.other)] : [] /* 4(D)(2): blocked credit the engine lists with its reason (s.17(5)) */
    },
    _cb: {
      net: ledgerRows.net,
      payment: built.s6_1, /* F-F-08: table 6.1 from the one builder (tax payable, ITC used by head in the s.49 order, cash) beside the file */
      provisional: !!ledgerRows.provisional,
      setoff: setOffPreview(outwardLine, plus(itc4.net)), /* IN-F-08: the month's set-off read from the ONE builder's figures (3.1(a) tax, the net credit), never posted */
      unanswered: (built.s3_1.unanswered && built.s3_1.unanswered.txval) || 0, /* the 0% lines that name no kind, in no 3.1 row (engine, from the pack's effective day) */
      prior_period: priorPeriodOf(ledgerRows),
      reversed: reversedOf(ledgerRows),
      not_in_books: notInBooksOf(ledgerRows),
      tax_differs: taxDiffersOf(ledgerRows),
      expense_no_tax: expenseNoTaxOf(ledgerRows),
      warnings: built.warnings,
      note: 'Built by the same engine as GSTR-1, from the chits the books count (not cancelled; a bill bought only once accepted), by the month of the shop day; off-rail purchases are not here. 3.1(c) holds every rate-0 line that is not an export or SEZ supply until the country pack names non-GST kinds (3.1(e)). Validate with the offline tool before filing.'
    }
  };
}

/**
 * AP-F-08: the first line whose rate is not one of the country pack's own (Australia: 0 and 10), or null. The SAME rate list the manual bill door reads (books-manual-bill-tax.packRatesOf), so a 15% line on
 * an Australian bill is refused where it is made, never claimed as input tax on the other side. A line with no rate, or a pack that names no rates (fallback, a country not built), is not judged here.
 * THE DOCUMENT'S OWN DAY (critic 1129): where the pack dates its menu (India) the list is the one in force on `opts.day` (billDayOf for a bill, againstDayOf for a note, which carries the ORIGINAL bill's rate), so a
 * back-dated bill or a note on a bill of 12% / 28% before 22 Sep 2025 passes. A note that names no original day is not judged (its rate is the bill's, which this door cannot date); a document that STATES an
 * export (opts.exported: the zero-rated / merchant-export (0.1%) rule, not the domestic menu) is not judged on the domestic list. No day on a bill = the menu in force now.
 * → { index (1-based), rate, rates: [the pack's non-zero rates] } | null
 */
function unlistedRateOf(country, lines, opts) {
  const o = opts || {};
  if (o.exported || (o.note && !o.day)) return null;
  const rates = require('./books-manual-bill-tax').packRatesOf({ s: { country } }, o.day || undefined);
  if (!rates.length) return null;
  const at = (lines || []).findIndex((line) => line && line.gst_rate != null && line.gst_rate !== '' && Number.isFinite(Number(line.gst_rate)) && rates.indexOf(Number(line.gst_rate)) < 0);
  return at < 0 ? null : { index: at + 1, rate: Number(lines[at].gst_rate), rates: rates.filter((rate) => rate > 0) };
}
module.exports = {
  lineTaxStatusOf,
  refuseUnavailable,
  otherPartyId,
  stateOfGstin,
  splitsByState,
  stateUnder,
  partyOf,
  withRegistration,
  walkIn,
  currencyOf,
  resolveItem,
  decorate,
  invoiceFor,
  exportStatedOf,
  billDayOf,
  againstDayOf,
  isNoteOf,
  heads,
  ledger,
  netOf,
  gstr1,
  gstr3b,
  priorPeriodOf,
  reversedOf,
  notInBooksOf,
  expenseNoTaxOf,
  isCreditNote,
  isDebitNote,
  unlistedRateOf
};
