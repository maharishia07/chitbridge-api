'use strict';
/**
 * money.js — an amount is never a bare number.
 *
 * Athi, 2026-07-31: "The product price cannot be currency-less. Assume someone spoofs the currency, everything is
 * going for a toss."
 *
 * The exposure was never spoofing. Every price in this codebase is a bare number whose denomination is resolved LIVE
 * from `identities.currency_code` at read time — so an entity editing its own currency setting silently redenominates
 * every price it has ever published. Nothing is rewritten and nothing logs. This module makes the denomination travel
 * WITH the amount, so meaning is fixed at write time instead of inferred at read time.
 *
 *   { "amount": 3290, "currency": "INR" }
 *
 * ── THE RULES, and why each is shaped this way ──────────────────────────────────────────────────────────────────
 *
 * 1. IT NEVER CONVERTS. There is no rate table here and no function that takes one. Conversion is a presentation act
 *    or an ERP act; a converted number must never reach a minted record. If you find yourself wanting `convert()`,
 *    what you want is a display overlay in the UI — see BACKLOG-currency-governance.md OPEN 3.
 *
 * 2. `read()` NEVER INVENTS A CURRENCY. A bare legacy number can only be read by passing the currency to assume, and
 *    the result is flagged `assumed: true` so a caller can tell an inferred denomination from a declared one. There
 *    is no default. A module-level fallback here would recreate the exact bug this module exists to end.
 *
 * 3. `amountOf()` RETURNS null FOR ABSENT, NEVER 0. The prevailing idiom in the front end is `+d.price || 0`, which
 *    turns an unreadable price into a FREE PRODUCT rather than an error — silent, and correct-looking on the page.
 *    Returning null forces the caller to decide. Zero is a price; absent is not.
 *
 * 4. `sum()` REFUSES MIXED CURRENCIES. The network-order path aggregates items across several stores, which may be
 *    in different countries. Today `items.reduce((s,i) => s + i.price*i.qty, 0)` will happily add INR to AED and
 *    produce a confident wrong number. This is a LATENT bug that the money type makes visible; sum() throws instead.
 *
 * ── PRECISION — a deliberate non-change ─────────────────────────────────────────────────────────────────────────
 * Amounts stay JS numbers in MAJOR units, exactly as today. Floats are a genuine hazard for money and integer minor
 * units are the correct long-term answer (it is what Medusa does) — but changing precision AND adding currency in one
 * migration means a failure could come from either, and neither is separately reversible. One change at a time.
 * Rounding is centralised in `round2()` so the eventual switch has one place to happen.
 */

const SHAPE = '{ amount: <number>, currency: "XXX" }';
const CODE_RE = /^[A-Z]{3}$/;   // ISO 4217 alphabetic. Deliberately strict: a typo must fail, not travel.

/** Is this already a money value? */
function isMoney(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
    && typeof v.amount === 'number' && Number.isFinite(v.amount)
    && typeof v.currency === 'string' && CODE_RE.test(v.currency);
}

/** Build one. Throws rather than produce a currency-less price — this is the write-path guard. */
function make(amount, currency) {
  const n = typeof amount === 'string' && amount.trim() !== '' ? Number(amount) : amount;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    const e = new Error(`Price must be a finite number, got ${JSON.stringify(amount)}`); e.status = 422; throw e;
  }
  const c = String(currency || '').trim().toUpperCase();
  if (!CODE_RE.test(c)) {
    const e = new Error(`Price must carry a currency — expected ${SHAPE}, got currency ${JSON.stringify(currency)}`);
    e.status = 422; throw e;
  }
  return { amount: n, currency: c };
}

/**
 * TOLERANT READ — the migration's safety net. Accepts BOTH shapes, so old rows and new rows coexist.
 *
 * This must be deployed and stable BEFORE any data is stamped. Deploying the write path first would put objects in
 * front of readers that coerce them to zero (see rule 3).
 *
 *   read(3290, { assume: 'INR' })                  → { amount: 3290, currency: 'INR', assumed: true }
 *   read({ amount: 3290, currency: 'INR' })        → { amount: 3290, currency: 'INR' }
 *   read(null) / read('') / read(undefined)        → null    (price on request — a real state, not an error)
 *   read(3290)                                     → throws  (no currency to assume; never guesses)
 */
function read(v, opts = {}) {
  if (v === null || v === undefined || v === '') return null;
  if (isMoney(v)) return { amount: v.amount, currency: v.currency };

  // A legacy bare number (or a numeric string from a form field).
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  if (typeof n === 'number' && Number.isFinite(n)) {
    const assume = String(opts.assume || '').trim().toUpperCase();
    if (!CODE_RE.test(assume)) {
      const e = new Error(`Legacy price ${n} has no currency and none was supplied to assume. Pass { assume } from the owning entity.`);
      e.status = 500; throw e;
    }
    return { amount: n, currency: assume, assumed: true };
  }

  // An object that is not money, a boolean, an array — unreadable. Loudly.
  const e = new Error(`Unreadable price ${JSON.stringify(v)} — expected a number or ${SHAPE}`);
  e.status = 422; throw e;
}

/** The number, or null when there is no price. NEVER 0 by default — see rule 3. */
function amountOf(v, opts = {}) { const m = read(v, opts); return m ? m.amount : null; }
/** The code, or null when there is no price. */
function currencyOf(v, opts = {}) { const m = read(v, opts); return m ? m.currency : null; }

/** Amount × quantity, staying in one currency. Returns null when there is no price to multiply. */
function times(v, qty, opts = {}) {
  const m = read(v, opts);
  if (!m) return null;
  const q = Number(qty);
  if (!Number.isFinite(q)) { const e = new Error(`Quantity must be a finite number, got ${JSON.stringify(qty)}`); e.status = 422; throw e; }
  return { amount: round2(m.amount * q), currency: m.currency };
}

/**
 * Total a list. THROWS on mixed currencies rather than adding them.
 *
 * An empty list has no currency, so it cannot produce a zero — `{amount:0, currency:???}` would be a lie. Callers
 * that need a displayable zero must supply the currency they mean via opts.empty.
 */
function sum(list, opts = {}) {
  const monies = (list || []).map((v) => read(v, opts)).filter(Boolean);
  if (!monies.length) {
    const empty = String(opts.empty || '').trim().toUpperCase();
    if (CODE_RE.test(empty)) return { amount: 0, currency: empty };
    return null;
  }
  const currencies = [...new Set(monies.map((m) => m.currency))];
  if (currencies.length > 1) {
    // The refusal STATES THE THREE WAYS FORWARD. A blocked caller that is not told its options will reach for the
    // silent sum, which is the one outcome that must never happen.
    const e = new Error(
      `Cannot total across currencies: ${currencies.join(' + ')}. An amount is labelled, never converted. ` +
      `Choose one, explicitly: (1) group by currency and show ${currencies.length} totals; ` +
      `(2) ignore money and total the PRODUCT instead — quantity is summable across currencies; ` +
      `(3) convert to the network's reporting currency using a dated rate table, and label the result derived.`);
    e.status = 409; e.currencies = currencies;
    e.options = ['split_by_currency', 'total_product_only', 'convert_to_reporting_currency'];
    throw e;
  }
  return { amount: round2(monies.reduce((s, m) => s + m.amount, 0)), currency: currencies[0] };
}

/** Guard for anywhere two amounts meet. */
function assertSameCurrency(a, b, where = 'these amounts') {
  const ca = currencyOf(a), cb = currencyOf(b);
  if (ca && cb && ca !== cb) {
    const e = new Error(`${where}: ${ca} and ${cb} cannot be combined. An amount is labelled, never converted.`);
    e.status = 409; throw e;
  }
  return true;
}

/**
 * Display. The CODE, never a symbol — a symbol map is a guess that is wrong for most currencies and unrenderable in
 * some fonts. The UI may choose a symbol; the API states the code.
 */
function format(v, opts = {}) {
  const m = read(v, opts);
  if (!m) return null;
  return `${m.currency} ${m.amount.toLocaleString(opts.locale || 'en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * amountOfLoose(v) → the NUMBER, or NaN when there is no readable price. Never throws.
 *
 * ⚠ USE ONLY WHERE THE CURRENCY IS ALREADY KNOWN TO BE UNIFORM — in practice, when every row came from ONE entity's
 * catalogue (`WHERE entity_id = $1`), because an entity owns exactly one currency. There the denomination is a
 * constant, the arithmetic is safe, and the currency is attached once at mint.
 *
 * DO NOT use it to total across entities. The network-order path aggregates items from several stores, which may sit
 * in different countries; there the currency is NOT constant and `sum()` — which refuses to mix — is the right tool.
 *
 * It returns NaN rather than null on purpose: the call sites it replaces already test `Number.isFinite(price)` and
 * reject, so a missing price keeps failing exactly as loudly as it did before. This function changes what shapes are
 * READABLE, and nothing else. That is the whole point of a migration reader.
 */
function amountOfLoose(v) {
  if (isMoney(v)) return v.amount;
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string') { const n = Number(v.trim()); return Number.isFinite(n) ? n : NaN; }
  return NaN;   // an object that is not money, a boolean, an array — unreadable, and NaN is rejected downstream
}

/**
 * ── STAMPING ON WRITE — where a price ACQUIRES its currency ─────────────────────────────────────────────────────
 *
 * Athi, 2026-08-05: *"we don't need to worry about migration — clear the database, create new data, and it should
 * follow the strategy we defined."*
 *
 * Right call, and it removes the migration's one unverifiable assumption (that an entity's CURRENT currency is what
 * its historical prices were written in). But it only holds if new data is born correct, and until now nothing
 * stamped: `money.make()` existed and was called by no write path in the codebase.
 *
 * ── THE ANTI-SPOOF PROPERTY, and why it is a shape rather than a check ─────────────────────────────────────────
 *
 * The currency is taken from the OWNING ENTITY, never from the request. A caller that cannot choose a currency has
 * nothing to spoof, so the guarantee comes from what the function accepts rather than from validation that someone
 * could later relax.
 *
 * One necessary exception, and it is not a hole: a client that READS an item, edits it and writes it back will send
 * the price as `{amount, currency}` — the shape it just read. Rejecting that outright would break every round-trip
 * edit. So a money value is accepted ONLY when its currency already equals the entity's. A DIFFERENT currency is
 * refused, which is precisely the spoof case.
 */

/** Keys treated as prices. Explicit rather than pattern-matched — a new price field is a deliberate addition. */
const PRICE_KEYS = ['price', 'price_min', 'price_max'];

/**
 * stampPrice(value, currency) → a money value, or the absent value unchanged.
 *
 *   3290                        → { amount: 3290, currency: 'INR' }
 *   "3290"                      → { amount: 3290, currency: 'INR' }   (form fields send strings)
 *   { amount, currency: 'INR' } → passed through   (a round-trip edit, currency agrees)
 *   { amount, currency: 'USD' } → THROWS 409       (the spoof case)
 *   null / '' / undefined       → unchanged        ("price on request" is a real state, not a zero)
 */
function stampPrice(value, currency) {
  if (value === null || value === undefined || value === '') return value;
  const c = String(currency || '').trim().toUpperCase();
  if (!CODE_RE.test(c)) {
    const e = new Error('Cannot stamp a price: the owning entity has no valid currency.'); e.status = 500; throw e;
  }
  if (isMoney(value)) {
    if (value.currency !== c) {
      const e = new Error(`This catalogue is priced in ${c}; a price in ${value.currency} cannot be stored on it. The currency comes from the business, not the request.`);
      e.status = 409; throw e;
    }
    /**
     * ⭐⭐ PROVENANCE SURVIVES THE STAMP — Athi, 2026-09-02: *"if it is gold bullion, then the price changes
     * according to market rate, so how do we bring it here?"*
     *
     * ⚠️⚠️ THE SCREEN ALREADY STATED A RULE THE STORAGE COULD NOT KEEP. The Pricing panel says *"a
     * market-referenced price without a reading date is a rumour — the same rule the availability engine applies
     * to a stock figure"*, and `market-ref` / `exchange` have been offered in the registries all along. But a
     * stamped price was `{amount, currency}` and nothing else, so the reading and its date were dropped on the
     * way in. The vocabulary existed; the mechanism did not.
     *
     * ⭐ THE SAME SHAPE AS `avail`, DELIBERATELY. Stock is `{qty, source, as_of}` and a price read from a market
     * is `{amount, currency, source, as_of}` — one rule, applied twice: **a number without a timestamp is not an
     * answer.** A trader quoting bullion off the morning fix and one quoting a price typed in March are making
     * different claims, and a total that cannot tell them apart is the kind of figure a dispute turns on.
     *
     * ⚠️ CARRIED, NEVER FETCHED. cap-definitions says it in the vocabulary itself: *"Recorded, never fetched live
     * at seal — a chit whose total depends on someone else's page being up is a chit two parties can compute
     * differently."* This function is the storage half of that decision and must never become a lookup.
     *
     * ⚠️ STRICTLY ADDITIVE. Absent provenance stays absent — no default source, no `as_of: now`. Stamping "now"
     * on a number somebody typed would manufacture a reading that never happened, which is worse than no reading
     * at all: the second is honest about what it does not know.
     */
    const out = { amount: value.amount, currency: c };
    if (value.source != null && String(value.source).trim() !== '') out.source = String(value.source).slice(0, 120);
    if (value.as_of != null && String(value.as_of).trim() !== '') {
      const t = new Date(value.as_of);
      /* An unreadable date is dropped rather than stored: a malformed timestamp reads as provenance and is not. */
      if (!isNaN(t.getTime())) out.as_of = t.toISOString();
    }
    return out;
  }
  return make(value, c);   // throws 422 on anything unreadable
}

/** Stamp the known price keys on one object (a catalogue item). Returns a COPY; never mutates the caller's input. */
function stampItem(item, currency) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const out = { ...item };
  for (const k of PRICE_KEYS) if (k in out) out[k] = stampPrice(out[k], currency);
  return out;
}

/**
 * Stamp an adoption's commercials — `{ "Tussar": { price, unit, price_min, price_max }, … }`.
 *
 * This is the SECOND price home and the one the seed scripts mostly use, so missing it would leave half the
 * catalogue unstamped while looking finished.
 */
function stampCommercials(commercials, currency) {
  if (!commercials || typeof commercials !== 'object' || Array.isArray(commercials)) return commercials;
  const out = {};
  for (const [name, entry] of Object.entries(commercials)) {
    out[name] = (entry && typeof entry === 'object' && !Array.isArray(entry)) ? stampItem(entry, currency) : entry;
  }
  return out;
}

/**
 * summarise(rows) — the shape every money summary should be built from.
 *
 * Athi, 2026-07-31, on a network holding INR + USD + AED: *"if different currencies are involved then we abruptly
 * say so and show three different totals; if the request is to ignore currency and sum only the product, that can
 * be done; otherwise if a conversion table is available we convert to the common currency used at network level.
 * My only concern is it should not be summed under one currency."*
 *
 * So there are THREE legitimate modes and the choice between them is a BUSINESS decision — this function does not
 * make it. It returns the facts a caller needs to choose, and makes the wrong answer unavailable rather than merely
 * discouraged: there is no field here that holds a cross-currency total.
 *
 *   mode 1 · split      → `by_currency[]`, already computed. The default, and always safe.
 *   mode 2 · product    → not money at all; total the quantity axis instead (see scripts/money-4-mis.sql section B)
 *   mode 3 · convert    → the caller supplies a DATED rate table and labels the result derived. Not done here,
 *                         because a rate belongs to a feed with a timestamp, never to library code.
 *
 * `rows` are `{ value, currency }` — map your own column names in before calling.
 */
function summarise(rows) {
  const list = rows || [];
  const nonMonetary = list.filter((r) => !r.currency).length;
  const pending = list.filter((r) => r.currency && (r.value === null || r.value === undefined)).length;
  /**
   * ⚠️ null IS NOT ZERO, AND Number() DISAGREES. `Number(null)` is 0 and `Number.isFinite(0)` is true, so a row
   * AWAITING AGREEMENT — a chit whose value is genuinely not yet known — was counted as a valued row worth nothing.
   * The same row then appeared in two contradictory places at once: `excluded.awaiting_agreement: 1` and
   * `by_currency[].chits: 2`. The total was unharmed (adding 0 changes nothing), but the COUNT was inflated, so a
   * scorecard could say "12 chits totalling ₹40,000" when only 8 of them had an agreed value.
   *
   * Found 2026-08-10 by the first caller that reported both numbers side by side (lib/measure.js). The comment
   * below already said what the rule was — "a summary that silently drops rows is as misleading as one that
   * silently adds them" — this makes the code agree with it.
   */
  const valued = list.filter((r) => r.currency && r.value !== null && r.value !== undefined && Number.isFinite(Number(r.value)));

  const buckets = {};
  valued.forEach((r) => {
    const c = String(r.currency).toUpperCase();
    buckets[c] = (buckets[c] || 0) + Number(r.value);
  });

  const by_currency = Object.keys(buckets)
    .map((c) => ({ currency: c, total: round2(buckets[c]), chits: valued.filter((r) => String(r.currency).toUpperCase() === c).length }))
    .sort((a, b) => b.total - a.total);

  return {
    by_currency,
    mixed: by_currency.length > 1,
    // Stated, never hidden. A summary that silently drops rows is as misleading as one that silently adds them.
    excluded: { non_monetary: nonMonetary, awaiting_agreement: pending },
    // Deliberately NOT a number. If a screen wants one figure it must pick a mode and say which — and if it picks
    // conversion it owns the rate, its date and the word "derived".
    total: by_currency.length === 1 ? by_currency[0] : null,
  };
}

/** ONE place rounding happens, so the eventual move to integer minor units has one site to change. */
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

module.exports = { isMoney, make, read, amountOf, amountOfLoose, currencyOf, times, sum, summarise,
  stampPrice, stampItem, stampCommercials, PRICE_KEYS,
  assertSameCurrency, format, round2, SHAPE, CODE_RE };
