/**
 * lib/services.js — THE GOVERNED CAPABILITIES AS SERVICES: the shared plumbing behind /api/offers · /api/pricing ·
 * /api/tax · /api/invoice. Rung 2 of the ladder (Athi, 2026-09-05: "the doors become the product"): another system
 * keeps its screens and calls ours for the governed answer — the SAME engines the storefront, compose and the chit use.
 *
 * Every service is STATELESS by default: lines in, answers out. A caller may bring its own structures/offers/rates,
 * or omit them and get THIS entity's shelf (the catalogue's products by item_id or code, its live offers, its tax
 * slabs) — read once per request through the same readers the order path uses.
 *
 * Order of evaluation on a line, everywhere: pricing structure → offers → tax.
 *
 * OWNS      the shared plumbing of the governed services (the caller's lines or this shop's shelf, the shop's party and price-includes-tax).
 * CALLED BY routes/tax.js · routes/pricing.js · routes/invoice.js · lib/home-facts.js
 * FLOW      lines in → shelf (items, offers, slabs) read once → pricing → offers → tax → the answer
 * CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
 */
'use strict';
const { query, withEntity } = require('../db');
const {
  round: roundMoney,
  priceOf
} = require('./money'); /* ⭐ money.round — the one rounder (SPEC-money-one-reader.md): half away from zero, on the decimal value */
const pricing = require('./pricing-engine').CBPricing;
const offersEng = require('./offers-engine').CBOffers;
const taxShelf = require('./tax-shelf');
const T = require('./tax-lines');
const tax = require('./tax');
const chitCeiling = require('./chit-ceiling'); /* ACC-282 / RAIL-205: the widest total, quantity and price a chit holds — the one ceiling */
const catalogueView = require('./catalogue-view');
const regional = require('./regional');

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const R2 = (n) => roundMoney(Number(n) || 0);

/**
 * ⭐ ACC-221 (+ ACC-222 caller side): a number the caller SENT that is not a number is UNREADABLE, named — never 0 and never "ok".
 * SENT_FIELDS: the keys a caller may use for each figure (the first one present wins, as normLines reads them). null / absent = not sent
 * (the shelf may answer); a BLANK discount / rate / cess is also not sent (the old reading: no discount); a blank qty or price, text, NaN, Infinity, a boolean or an object = sent, and not a number.
 */
const SENT_FIELDS = [['qty', ['qty', 'quantity']], ['price', ['listPrice', 'unitPrice', 'price']], ['discount', ['discount']], ['gst_rate', ['gst_rate']], ['cess_rate', ['cess_rate']]];
/** a GST rate as the caller sent it: null or blank = NO rate (the shelf fills it in), never 0% (ACC-221 re-check); a number is itself, text is null (unread names it) */
const rateOrNull = (sent) => (sent == null || (typeof sent === 'string' && sent.trim() === '') ? null : num(sent));
const OPTIONAL_FIELDS = ['discount', 'gst_rate', 'cess_rate', 'list_price', 'total'];
/** ⭐ ACC-271: the keys a CHIT line carries for each figure (the quote lines above use SENT_FIELDS). Each key is its own row so one bad key is never hidden by a good one beside it;
    list_price and total are optional like a discount (a blank is absent); a blank qty or price is sent and not a number, as on the quote routes. A removed line is not on the bill. */
const CHIT_SENT_FIELDS = [['qty', ['quantity']], ['qty', ['qty']], ['price', ['price']], ['price', ['unit_price']], ['list_price', ['list_price']], ['total', ['total']], ['discount', ['discount']], ['gst_rate', ['gst_rate']], ['gst_rate', ['rate']], ['cess_rate', ['cess_rate']]];
const isBlank = (sent) => typeof sent === 'string' && sent.trim() === '';
const readable_ = (sent) => (typeof sent === 'number' || (typeof sent === 'string' && sent.trim() !== '')) && num(sent) !== null;
/** the refusal code of a figure that is not a number: the codes /api/tax/compute already answers (error-codes register) */
const UNREAD_CODE = { qty: 'BAD_QTY', price: 'BAD_PRICE', discount: 'BAD_PRICE', list_price: 'BAD_PRICE', total: 'BAD_PRICE', gst_rate: 'BAD_RATE', cess_rate: 'BAD_RATE' };
function unreadOf(item, fields) {
  const out = [];
  for (const [field, keys] of fields || SENT_FIELDS) {
    const key = keys.find((alias) => item[alias] != null && !(OPTIONAL_FIELDS.includes(field) && isBlank(item[alias])));
    if (key !== undefined && !readable_(item[key])) out.push({ field, value: String(item[key]).slice(0, 24) });
  }
  return out;
}
/** the first line with an unreadable figure, said: [code, sentence] — or null. `name` is the caller's way of naming a line */
const unreadSentence = (label, first) =>
  first.noRate ? 'Line ' + label + ' has no tax rate, and the shelf gave none. Nothing was taxed at 0% for it; send a gst_rate or set one on the item.' : 'Line ' + label + ' has a ' + first.field.replace('_', ' ') + (first.range ? ' of ' + first.range + (first.field === 'cess_rate' ? ' that is below 0' : ' that is outside 0–100%') : ' that is not a number' + (first.value ? ' ("' + first.value + '")' : '')) + '. Nothing was priced for it; fix it and send again.';
function unreadSaid(lines, name) {
  const found = lines.find((row) => row.unread && row.unread.length);
  return found ? [UNREAD_CODE[found.unread[0].field], unreadSentence(name(found), found.unread[0])] : null;
}
/** a line as the services read it: { key, item_id, code, name, qty, listPrice, pricing?, discount?, gst_rate?, cess_rate?, hsn?, categories } */
function normLines(body) {
  return (Array.isArray(body && body.lines) ? body.lines : []).map((item, index) => ({
    key: String(item.key != null ? item.key : index),
    item_id: item.item_id || null,
    code: item.code || item.sku || null,
    name: item.name || item.particulars || '',
    qty: num(item.qty != null ? item.qty : item.quantity) || 0,
    listPrice: num(item.listPrice != null ? item.listPrice : item.unitPrice != null ? item.unitPrice : item.price),
    pricing: item.pricing && typeof item.pricing === 'object' ? item.pricing : null,
    discount: num(item.discount) || 0,
    gst_rate: rateOrNull(item.gst_rate),
    cess_rate: num(item.cess_rate) || 0,
    hsn: item.hsn || null,
    unit: item.unit || '',
    categories: Array.isArray(item.categories) ? item.categories.map(String) : [],
    excluded: Array.isArray(item.excluded) ? item.excluded.map(String) : []
  }));
}
/** normLines, and on each line the figures the caller sent that are not numbers (`unread`; ACC-221) — the routes refuse them, named */
const normLinesChecked = (body) => normLines(body).map((row, index) => Object.assign(row, { unread: unreadOf(body.lines[index]) }));

/** this entity's shelf: products (by item_id / code), tax slabs, categories, face — one read */
async function shelfOf(entity_id) {
  const sh = await taxShelf.readShelf(
    entity_id,
    { withEntity, query, regionLayer: regional.regionLayer, getFace: (eid) => catalogueView.getFace({ entity_id: eid, withEntity }) },
    { withItems: true }
  );
  const items = (sh && sh.items) || [];
  /* TAX-SRV1 G3: no shelf (a GST shop with no GSTIN — tax-shelf answers null: "no GSTIN, no GST") still has PRODUCTS to price.
     The items are read on their own; `shelf` stays null, so rateLines resolves no rate for it (the counter zero-rates it too). */
  if (!sh) {
    const r = await withEntity(entity_id, (db) =>
      db.query('SELECT item_id, item_data FROM catalogue_items WHERE entity_id = $1 AND is_active = true', [entity_id])
    );
    items.push(...((r && r.rows) || []));
  }
  const byId = new Map(),
    byCode = new Map(),
    idOfCode = new Map();
  for (const it of items) {
    const d = it.item_data || {};
    byId.set(String(it.item_id), d);
    const c = String(d.code || d.sku || '')
      .trim()
      .toLowerCase();
    if (c && !byCode.has(c)) {
      byCode.set(c, d);
      idOfCode.set(c, String(it.item_id));
    }
  }
  const idOf = (l) => (l.item_id ? String(l.item_id) : (l.code && idOfCode.get(String(l.code).trim().toLowerCase())) || null);
  return {
    shelf: sh,
    items,
    byId,
    byCode,
    idOf,
    productOf: (l) => (l.item_id && byId.get(String(l.item_id))) || (l.code && byCode.get(String(l.code).trim().toLowerCase())) || null
  };
}

/** ── PRICING: the unit price at the quantity, from the line's own structure or the product's travelling copy ── */
function priceLine(l, product) {
  const d = l.pricing
    ? Object.assign({}, product || {}, {
        pricing_kind: l.pricing.kind || l.pricing.pricing_kind,
        pricing_tiers: l.pricing.tiers || l.pricing.pricing_tiers,
        pricing_amount: l.pricing.amount != null ? l.pricing.amount : l.pricing.pricing_amount,
        pricing_min: l.pricing.min != null ? l.pricing.min : l.pricing.pricing_min,
        pricing_max: l.pricing.max != null ? l.pricing.max : l.pricing.pricing_max,
        pricing_def_name: l.pricing.name || l.pricing.pricing_def_name || null
      })
    : product || {};
  /* ⭐ THE ONE PRICE READER — a product with no price is null here, never 0 (SPEC-money-one-reader.md, D3) */
  const list = l.listPrice != null ? l.listPrice : priceOf(product && product.price);
  /* ⚠️ undefined, never null, for "no price": the engine's num(null) is Number(null) = 0, which priced an unpriced product at 0 (TAX-SRV1; the
     engines fix — pricing.unitPrice reading null as absent — is queued, engines are serial). undefined → its own priceOf_ → null. */
  const u = pricing.unitPrice(d, l.qty || 1, list == null ? undefined : list);
  return {
    key: l.key,
    item_id: l.item_id,
    code: l.code,
    name: l.name || (product && product.name) || '',
    qty: l.qty,
    list_price: list,
    unit_price: u.amount,
    structure: u.kind || null,
    structure_name: u.name || null,
    tier: u.tier,
    why: u.why,
    violation: u.violation,
    bands: u.kind === 'tiered' ? bandsOf(d, list) : []
  };
}

/** ⭐ CAT-258: the bands of a tiered line. The engine's num(null) reads "no list price" as 0, so an unpriced ladder said its first band was FREE
 *  ({from:1,to:9,price:0}); undefined reaches its own null, and the band says so in words. A real 0 list price stays 0. */
function bandsOf(structure, list) {
  return pricing.bands(structure, list == null ? undefined : list).map((band) => (band.price === null ? Object.assign({}, band, { why: 'no price set' }) : band));
}

/** ⭐ CAT-258: the refusal of a line nobody priced, in the one set of words (tax/compute and invoice/build both say it): [code, sentence] — asks, never prices at 0 */
function unpricedSaid(line, product, nameOf) {
  return ['NO_PRICE', (product && product.name ? '"' + String(product.name).slice(0, 60) + '"' : 'Line ' + nameOf(line)) + ' has no price on the shelf. Set its price, or send one.'];
}

/** ── OFFERS: what comes off, and why ── */
async function offerLines(entity_id, priced, offers, ctx) {
  const list = Array.isArray(offers) && offers.length ? offers : entity_id ? await catalogueView.liveOffers({ entity_id, withEntity }) : [];
  const lines = priced.map((item, index) => ({
    key: item.key,
    item_id: item.item_id,
    sku: item.code,
    categories: item.categories || [],
    excluded: item.excluded || [],
    qty: item.qty,
    unitPrice: item.unit_price
  }));
  const c = Object.assign({ now: new Date(), currency: null }, ctx || {}); /* T2-NATDEF: the caller's stated money, never INR by name */
  if (typeof c.money !== 'function') c.money = (n) => (c.currency ? String(c.currency) + ' ' : '') + R2(n).toFixed(2);
  if (!list.length || !offersEng)
    return {
      ev: {
        subtotal: lines.reduce((total, item) => total + item.unitPrice * item.qty, 0),
        total: lines.reduce((total, item) => total + item.unitPrice * item.qty, 0),
        adjustments: [],
        notes: [],
        skipped: []
      },
      per: {},
      offers_considered: 0
    };
  const ev = offersEng.evaluate({ lines, offers: list, ctx: c });
  return { ev, per: offersEng.perLine ? offersEng.perLine(ev, lines) || {} : {}, offers_considered: list.length };
}

/** ── TAX: the rate each line resolves to (from the caller, else the entity's shelf), then the INV-01 block ── */
/* the caller may name a line by CODE; the tax decorator matches by item_id or name, so the shelf answers the id first */
function rateLines(lines, sh) {
  const shelf = sh && 'shelf' in sh ? sh.shelf : sh; /* a shelfOf() answer with shelf null = no tax shelf; its items price, they never rate */
  const asLines = lines.map((item) => {
    const prod = sh && sh.productOf ? sh.productOf(item) : null;
    return {
      item_id: item.item_id || (sh && sh.idOf ? sh.idOf(item) : null),
      name: item.name || (prod && prod.name) || '',
      particulars: item.name || (prod && prod.name) || '',
      gst_rate: item.gst_rate,
      cess_rate: item.cess_rate,
      hsn: item.hsn
    };
  });
  const dec = shelf ? T.decorate(asLines, shelf) : asLines;
  const noTaxShelf = !!sh && 'shelf' in sh && !sh.shelf; /* a GST shop with no GSTIN: no GST is DECIDED (tax-shelf), so a line with no rate of its own is 0% on purpose, not unread */
  return lines.map((item, index) =>
    Object.assign({}, item, {
      name: item.name || asLines[index].name,
      item_id: item.item_id || asLines[index].item_id,
      gst_rate: dec[index].gst_rate != null ? num(dec[index].gst_rate) : item.gst_rate == null && noTaxShelf ? 0 : item.gst_rate,
      cess_rate: num(dec[index].cess_rate) || item.cess_rate || 0,
      hsn: dec[index].hsn || item.hsn || null,
      tax_slab_name: dec[index].tax_slab_name || null,
      tax_source: dec[index].tax_source || (item.gst_rate != null ? 'caller' : null),
      tax_scheme: dec[index].tax_scheme || item.tax_scheme || null
    })
  );
}
/**
 * shopOf(entity_id) → { party, priceIncludesTax } — the seller as the invoice reads it AND whether its prices include tax, from the ONE
 * identities read partyOfEntity always made (policy_flags was selected and dropped). TAX-SRV1 G2: a caller that leaves the flag out gets
 * the SHOP's setting — policy.flagOf, the same read the counter (till.html taxIncluded) and every chit (tax-copy partiesFor) use.
 */
async function shopOf(entity_id, extra) {
  const r = await query('SELECT identity_id, gstn, display_name, policy_flags, country FROM identities WHERE identity_id = $1', [entity_id]);
  const row = await T.withRegistration(r.rows[0] || {}); /* ACC-273/277: the shop's own registration word rides its party, whatever door built it */
  return {
    party: T.partyOf(row, Object.assign({ entity_id: String(entity_id) }, extra || {})),
    priceIncludesTax: require('./policy').flagOf(row.policy_flags, 'price_includes_tax', row.country) === 'yes'
  };
}
async function partyOfEntity(entity_id, extra) {
  return (await shopOf(entity_id, extra)).party;
}
/** the caller's own `priceIncludesTax` (or `price_includes_tax`) when it said one — true/false/'yes'/'no' — else undefined; anything else is null (refused) */
function saidInclusive(body) {
  const b = body || {},
    v = b.priceIncludesTax !== undefined ? b.priceIncludesTax : b.price_includes_tax;
  if (v === undefined || v === null) return undefined;
  if (v === true || v === 'yes' || v === 'true') return true;
  if (v === false || v === 'no' || v === 'false') return false;
  return null;
}
/** true when the caller's seller carries a tax number of its own (Gstin / gstin: the one field every pack's tax id travels in) */
const namesOwnTaxNumber = (given) => !!given && typeof given === 'object' && !!String(given.Gstin || given.gstin || '').trim();
/** the country the caller's seller would be priced in: the shop's own, else the one body.seller names (party() fills the seller in the same order) */
const sellerCountryOf = (shop, body) => {
  const given = body && body.seller && typeof body.seller === 'object' ? body.seller : {};
  return shop.party.Country || given.Country || given.country || null;
};
/** the ONE refusal for an unasked registration, in the pack's word for its tax: thrown by askedShopOf and by computeTax's last look */
function registrationUnknown_(country) {
  const question = require('./country-setup').registrationAsk(country);
  const said = [question.code, question.question + ' Answer it in Settings → Country setup.'];
  return Object.assign(new Error('registration_unknown: ' + said[1]), { code: 'registration_unknown', said });
}
/**
 * CTRY-114: the engine (an adopted file, never edited here) throws a plain Error "no tax scheme: ..." for a seller whose country has no tax pack (HU, DK), which every route answered
 * 500. It is a refusal the shop can read: 422 NO_COUNTRY_PACK, the country by name (the same code and shape CTRY-94 gave a shop with no country; lib/tax-contract countryRefusal).
 * A seller with no country at all keeps the engine's own NO_COUNTRY refusal, which it throws already refused.
 */
function noPackRefused(seller, work) {
  try {
    return work();
  } catch (e) {
    if (!e || e.refused || !/^no tax scheme:/.test(String(e.message))) throw e;
    const country = String((seller && (seller.Country || seller.country)) || '').trim();
    const name = require('./country-setup').nameOf(country);
    throw Object.assign(new Error(name + ' does not have a tax pack yet, so ChitBridge cannot build its invoice. We add countries one at a time.'), { refused: true, status: 422, code: 'NO_COUNTRY_PACK' });
  }
}
/**
 * ACC-272 · askedShopOf(entity_id, body) → shopOf, or THROWS 'registration_unknown' when nobody said whether the shop is registered for its tax and it has
 * no tax number (the ONE reader, country-setup.registrationOfShop; the same predicate and code as the till's POST /till/rate: tax-shelf.chargesTax null →
 * TAX_REGISTRATION_UNKNOWN). "No GSTIN, no GST" (Athi 2026-09-05) holds once the owner confirmed unregistered. A caller that names its own seller WITH ITS OWN tax
 * number (body.seller.Gstin) prices that party, not this shop (party() fills any other seller in from the shop, so {} or {name} is still the shop), and a seller with no country at all (the shop's, else body.seller's) is NO_COUNTRY's to refuse: nothing is asked. The routes answer the throw as a 409.
 */
async function askedShopOf(entity_id, body) {
  const shop = await shopOf(entity_id);
  const seller = shop.party;
  const country = sellerCountryOf(shop, body);
  if (namesOwnTaxNumber(body && body.seller) || !country || String(seller.Gstin || '').trim()) return shop;
  const countrySetup = require('./country-setup'); /* the shop's own word (withRegistration); a shop with no country of its own was not read there, the caller's country asks it here */
  const regType = shop.party.Country ? seller.RegType : countrySetup.registrationWord(await countrySetup.registrationOfShop(entity_id), seller.RegType);
  if (taxShelf.chargesTax({ gstin: seller.Gstin, reg_type: regType }, require('./tax-packs').packFor(country)) !== null) return shop;
  throw registrationUnknown_(country);
}
/**
 * ACC-273/277: the RegType a named party carries. A party naming no tax number of its own and saying 'regular' (or nothing) is the calling shop itself, so the
 * shop's own said-no / never-said (fallback.RegType 'unregistered' | 'unknown') wins: a word cannot talk it into charging. Anything else the caller says
 * (its own number, a stricter word) stands, so a different party still quotes (CTRY-75).
 */
function regTypeOfNamed(namedParty, gstin, fallback) {
  const said = namedParty.RegType || namedParty.reg_type;
  const shopWord = fallback && fallback.RegType;
  if (!gstin && (!said || said === 'regular') && (shopWord === 'unregistered' || shopWord === 'unknown')) return shopWord;
  return said || shopWord || 'regular';
}
function party(p, fallback) {
  if (!p || typeof p !== 'object') return fallback || {};
  const g = p.Gstin || p.gstin || null;
  return Object.assign({}, fallback || {}, {
    Gstin: g,
    LglNm: p.LglNm || p.name || (fallback && fallback.LglNm) || null,
    State: p.State || p.state || T.stateOfGstin(g) || (fallback && fallback.State) || null,
    Pos: p.Pos || p.pos || undefined,
    Country: p.Country || p.country || (fallback && fallback.Country) || null,
    RegType: regTypeOfNamed(p, g, fallback)
  });
}
/** the figures of a line exactly as computeTax hands them to the engine (an absent discount / cess is its own 0; an absent price or GST RATE is not: no rate is refused, never taxed at 0%) */
const engineFigures = (item) => ({
  qty: item.qty,
  price: item.unit_price != null ? item.unit_price : item.listPrice,
  discount: item.discount == null ? 0 : item.discount,
  gst_rate: item.gst_rate,
  cess_rate: item.cess_rate == null ? 0 : item.cess_rate
});
const isFigure = (value) => typeof value === 'number' && Number.isFinite(value);
/** ACC-222: a GST rate is a percentage — below 0 or above 100 (cess: below 0 only, it is uncapped ad valorem, tobacco was above 100% to Jan 2026) the engine would answer a negative tax with bridge ok (routes/tax.js refuses it on its own route; every other caller reaches here) */
const isRateOutOfRange = (field, value) => isFigure(value) && ((field === 'gst_rate' && (value < 0 || value > 100)) || (field === 'cess_rate' && value < 0));
/** which figures of ONE line the engine would misread: the ones the caller sent unreadable (marked `unread`), plus any that is not a finite number, a GST rate with none, or a rate out of range */
function unreadFieldsOf(item) {
  const marked = item.unread || [];
  const seen = engineFigures(item);
  const missing = (field) => !marked.some((entry) => entry.field === field);
  const fields = marked.map((entry) => entry.field).concat(Object.keys(seen).filter((field) => (!isFigure(seen[field]) || isRateOutOfRange(field, seen[field])) && missing(field)));
  const field = fields[0];
  const first = marked[0] || { field, value: '', range: isRateOutOfRange(field, seen[field]) ? String(seen[field]) : '', noRate: field === 'gst_rate' && seen[field] == null };
  return { fields, first };
}
/** ⭐ ACC-221: the lines as the engine would see them, each with its unreadable figures named: a typo is not a free line */
function unreadForEngine(lines) {
  const out = [];
  lines.forEach((item, index) => {
    const found = unreadFieldsOf(item);
    if (found.fields.length) out.push({ index, key: item.key == null ? null : item.key, name: item.name || '', fields: found.fields, first: found.first });
  });
  return out;
}
/**
 * ⭐ ACC-282: a line the engine would price past what a chit holds, or take a discount larger than itself off. The ceiling is chit-ceiling's (RAIL-205: the chit total's column, the
 * quantity's and the price's), never a number typed here; the currency is the seller country's pack, said beside the maximum. A discount can take a line to 0, not below it.
 * → [code, sentence] for the first line past either, else null. Runs after the unreadable-figure check, so every figure here is a finite number.
 */
function overLineSaid(lines, seller) {
  const figures = lines.map(engineFigures);
  const gross = figures.map((figure) => figure.qty * figure.price);
  const over = chitCeiling.overOf({ total: gross.reduce((sum, amount) => sum + amount, 0), lines: figures.map((figure) => ({ quantity: figure.qty, price: figure.price })) });
  if (over) return ['CHIT_AMOUNT_TOO_LARGE', chitCeiling.bodyFor(over, T.currencyOf(seller)).message];
  const index = figures.findIndex((figure, at) => R2(figure.discount) > R2(gross[at]));
  if (index < 0) return null;
  return ['BAD_PRICE', 'Line "' + (lines[index].name || 'line ' + (index + 1)) + '" has discounts and offers together larger than the line itself. They can take a line down to 0, not below it.'];
}
/** what to say of the first unreadable line: [code, sentence] */
const unreadAnswer = (unread) => [UNREAD_CODE[unread[0].first.field], unreadSentence('"' + (unread[0].name || 'line ' + (unread[0].index + 1)) + '"', unread[0].first)];
/**
 * CTRY-75: the engine's regOf reads a registration word it does not know ('unknown' included) as REGULAR, so a seller that still carries 'unknown' and no tax
 * number of its own never reaches it: asked, with the till's own predicate (tax-shelf.registrationMayCharge null) and sentence. A seller with no country is NO_COUNTRY's.
 */
function refuseUnknownSeller(seller) {
  const given = seller || {};
  if (given.Country && !String(given.Gstin || '').trim() && taxShelf.registrationMayCharge(given.RegType) === null) throw registrationUnknown_(given.Country);
}
function computeTax({ seller, buyer, lines, priceIncludesTax, reverseCharge, scheme }) {
  refuseUnknownSeller(seller);
  const unread = unreadForEngine(lines);
  if (unread.length) {
    const said = unreadAnswer(unread);
    throw Object.assign(new Error('line_unreadable: ' + said[1]), { code: 'line_unreadable', unread, said });
  }
  const refused = overLineSaid(lines, seller);
  if (refused) throw Object.assign(new Error('line_refused: ' + refused[1]), { code: 'line_refused', said: refused });
  const w = T.walkIn(seller, buyer); /* ⭐ BUY1: a buyer with no country / no place of supply is taxed inside the shop — the one rule, tax-lines.walkIn */
  const det = noPackRefused(seller, () =>
  tax.determine({
    seller: seller || {},
    buyer: w.buyer,
    scheme,
    lines: lines.map((item) => ({
      id: item.key,
      name: item.name,
      qty: item.qty,
      unit_price: item.unit_price != null ? item.unit_price : item.listPrice,
      unit: item.unit || '',
      discount: item.discount || 0,
      rate: item.gst_rate != null ? item.gst_rate : 0,
      cess_rate: item.cess_rate || 0,
      hsn: item.hsn || '',
      tax_scheme: item.tax_scheme || undefined
    })),
    priceIncludesTax: !!priceIncludesTax,
    reverseCharge: !!reverseCharge
  }));
  if (w.note && det._cb) det._cb.notes = (Array.isArray(det._cb.notes) ? det._cb.notes : []).concat(w.note);
  return det;
}

module.exports = { normLines: normLinesChecked, shelfOf, priceLine, unpricedSaid, offerLines, rateLines, shopOf, askedShopOf, saidInclusive, partyOfEntity, party, computeTax, unreadSaid, unreadSentence, unreadOf, rateOrNull, UNREAD_CODE, CHIT_SENT_FIELDS, R2, num };
