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
  if (Object.prototype.hasOwnProperty.call(row, 'registration')) return require('./country-setup').registrationWord(row.registration, flags.gst_registration); /* ACC-273: withRegistration read the shop's own answer */
  if (!Object.prototype.hasOwnProperty.call(row, 'tax_registration')) return String(flags.gst_registration || 'regular'); /* no reader asked: the flag as stated */
  const countrySetup = require('./country-setup');
  const answer = countrySetup.registrationOf({ number: row.gstn, scheme: flags.gst_registration, tax_registration: row.tax_registration });
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
  if (!id || !row.country || String(row.gstn || '').trim() || Object.prototype.hasOwnProperty.call(row, 'registration')) return row;
  return Object.assign({}, row, { registration: await require('./country-setup').registrationOfShop(id) });
}
/** a seller whose registration nobody said (RegType 'unknown', no tax number): it may not charge tax, and the engine reads an unknown word as REGULAR, so invoiceFor hands it 'unregistered' and the answer says why */
const unknownSeller = (seller) => !!seller && seller.RegType === 'unknown' && !!seller.Country && !String(seller.Gstin || '').trim();

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

/* ⭐ ACC-206 (engines v1.75.1, Athi 2026-11-02): the line's list price rides to the ENGINE, which says the savings of a line sold below it (gross at list,
   the difference as Discount; owed and tax unchanged); absent, null or blank = NO list_price key (num() would read them as 0), as the engine reads it. The api adds nothing up (keepOffer is gone). */
const listPriceOf = (item) => {
  const given = item.list_price !== undefined && item.list_price !== null && String(item.list_price).trim() !== '';
  return given && num(item.list_price) !== null ? { list_price: num(item.list_price) } : {};
};

/**
 * ⭐ CTRY-139: the DAY the engine reads a law-set price band by — the shop's calendar day of the document, never a UTC slice of an instant.
 * A bill / invoice: its own billed_at (else the moment `at` the caller holds). A credit or debit NOTE is never banded (null = no band): its lines are the original invoice's lines at their stated
 * rate, or DELTA lines (old price minus new price, price-note.replacementDeltas), and a band read on a delta's own value would re-rate the original supply (a 500 price difference on a 3,000
 * garment at 18% would read 5%). The note keeps the rate its line carries, stamped when the invoice was issued (critic, 11 Nov).
 * `shop` is the seller party (its timezone, else its Country / country); null when the moment is no moment.
 */
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
function invoiceFor(inp) {
  const i = inp || {};
  const lines = (Array.isArray(i.lines) ? i.lines : []).filter((item) => item && !item.removed);
  /* RCM-POST: a line that names its reverse-charge category is rated by the pack's notification when it carries no rate of its own */
  const rated = lines.filter((item) => num(item.gst_rate) !== null || num(item.rate) !== null || !!rcmCategoryOf(item)).length;
  const w = walkIn(i.seller, i.buyer); /* ⭐ BUY1: a buyer with no country / no place of supply is taxed inside the shop */
  const asked = unknownSeller(i.seller);
  const det = tax.determine({
    seller: asked ? Object.assign({}, i.seller, { RegType: 'unregistered' }) : i.seller || {},
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
      discount: num(item.discount) || (item.offer && num(item.offer.off)) || 0, ...listPriceOf(item),
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
  if (w.note && det._cb) det._cb.notes = (Array.isArray(det._cb.notes) ? det._cb.notes : []).concat(w.note);
  if (asked && det._cb) det._cb.registration = unknownNote(i.seller.Country);
  return {
    invoice: Object.assign({ DocDtls: { Typ: 'INV', No: i.chit_id || null, Dt: i.at || null }, currency: i.currency || currencyOf(i.seller) }, det),
    rated,
    unrated: lines.length - rated,
    provisional: !i.frozen
  };
}

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

/** ACC-192 slice 2: a DEBIT note raises tax (s.34(3)); it is an outward supply that GSTR-1 files in table 9B as 'D', not as an invoice in table 4. Known by the chit's purpose or an invoice that says DBN. */
const isDebitNote = (e) => String((e && e.purpose) || '') === 'debit_note' || !!(e && e.invoice && e.invoice.DocDtls && e.invoice.DocDtls.Typ === 'DBN');

/** the ledger side of an outward row that is not a credit note: a debit note is output_dn, anything else output */
const outwardSideOf = (e) => (isDebitNote(e) ? 'output_dn' : 'output');

/** output tax less input credit, by head, with the total */
function netOf(output, credit) {
  const net = { cgst: r2(output.cgst - credit.cgst), sgst: r2(output.sgst - credit.sgst), igst: r2(output.igst - credit.igst), cess: r2(output.cess - credit.cess) };
  net.total = r2(net.cgst + net.sgst + net.igst + net.cess);
  return net;
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
    itc = zero(),
    rows = [],
    list = Array.isArray(entries) ? entries : [],
    skipped = list.map((entry, at) => ({ at, kind: leftOutKind(entry) })).filter((item) => item.kind);
  for (const e of list) {
    if (leftOutKind(e)) continue;
    const h = heads(e.invoice);
    const cn = isCreditNote(e);
    /* output tax follows WHO SELLS (e.sells, from tax-copy) — a received storefront order is the shop's own sale */
    if (sellsIn(e)) {
      if (cn) {
        sub(output, h);
        rows.push(Object.assign({ side: 'output_cn' }, e, { heads: h }));
      } else {
        add(output, h);
        rows.push(Object.assign({ side: outwardSideOf(e) }, e, { heads: h }));
      }
    } else {
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
  return { output, itc, net: netOf(output, itc), count: rows.length, provisional: rows.some((item) => item.provisional), rows, skipped };
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

/*
 * ── GSTR-1: ONE BUILDER (ACC-225, 2026-11-05) ───────────────────────────────────────────────────────────────────
 * The adopted engine gst-returns.gstr1 builds the file: B2B · B2CL (Table 5, the limit by the month from its B2CL_LIMITS — ₹1 lakh
 * from August 2024, Notification 12/2024-Central Tax; ₹2.5 lakh before) · B2CS · CDNR / CDNUR · nil · HSN · Table 13. This file
 * only turns the month's ledger rows into the engine's documents; nothing is summed or sorted here. The builder that lived here
 * had no B2CL table and the old limit, so a large inter-state B2C bill was summed into B2CS — two builders, the filed one wrong.
 */
const gstReturns = require('./gst-returns');
const GSTR1_SCHEMA_VERSION = 'GST3.1.4'; /* the file's version label, written untouched (what this file always wrote) */
/** the bill number as the return names the document (Table 13, cdnr, b2b): the number on the buyer's paper, cut to the portal's 16 */
const numOf = (r) => String(r.doc_no || r.chit_id || '').slice(0, 16);
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
 * gstr1(led, me, period) → the GSTR-1 offline-tool JSON for the month (gstin · fp · version · b2b · b2cl · b2cs · cdnr · cdnur · nil · hsn ·
 * doc_issue) plus `_cb` { b2cl_limit, warnings, summary } — what the engine said beside the file; or the engine's refusal { ok: false, why }
 * (no 15-character GSTIN on me). `period` is tax-copy's 'MMYYYY'. ⚠️ Validate with the portal's offline tool before filing. WE DO NOT FILE.
 */
function gstr1(led, me, period) {
  const away = gstrIndiaOnly(me);
  if (away) return away;
  const built = gstReturns.gstr1({ gstin: (me && me.Gstin) || '', month: monthOfPeriod(period), documents: gstr1Documents(led), schema_version: GSTR1_SCHEMA_VERSION });
  if (!built.ok) return built;
  return Object.assign(built.json, { _cb: { b2cl_limit: built.b2cl_limit, warnings: built.warnings, summary: built.summary, prior_period: priorPeriodOf(led), reversed: reversedOf(led), not_in_books: notInBooksOf(led), expense_no_tax: expenseNoTaxOf(led) } });
}
/** ACC-224: the late bills of an earlier month this month's rows carry (tax-copy monthOfRecord), as the return names them */
/** ACC-270: bills reversed this month after an earlier month held them / counter bills the books hold no entry for — named beside the return (tax-copy ledgerFor sets them on the month's ledger) */
const reversedOf = (monthLedger) => (monthLedger && monthLedger.reversed) || [];
const notInBooksOf = (monthLedger) => (monthLedger && monthLedger.not_in_books) || [];
/** ACC-269: till expenses the month holds with no ITC claimed (no GST stated, or stated and not in the books) — named, never a silent 0 */
const expenseNoTaxOf = (monthLedger) => (monthLedger && monthLedger.expense_no_tax) || [];
const priorPeriodOf = (monthLedger) => ((monthLedger && monthLedger.rows) || []).filter((row) => row.prior_period).map((row) => row.prior_period);
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
    if (!Object.prototype.hasOwnProperty.call(GSTR1_KIND, row.side)) continue;
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
      prior_period: priorPeriodOf(led),
      reversed: reversedOf(led),
      not_in_books: notInBooksOf(led),
      expense_no_tax: expenseNoTaxOf(led),
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
  withRegistration,
  walkIn,
  currencyOf,
  resolveItem,
  decorate,
  invoiceFor,
  billDayOf,
  isNoteOf,
  heads,
  ledger,
  gstr1,
  gstr3b,
  priorPeriodOf,
  reversedOf,
  notInBooksOf,
  expenseNoTaxOf,
  outwardBoxes,
  isCreditNote,
  isDebitNote
};
