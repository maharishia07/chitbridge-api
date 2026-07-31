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
    const e = new Error(`Cannot total across currencies: ${currencies.join(' + ')}. An amount is labelled, never converted.`);
    e.status = 409; e.currencies = currencies; throw e;
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

/** ONE place rounding happens, so the eventual move to integer minor units has one site to change. */
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

module.exports = { isMoney, make, read, amountOf, amountOfLoose, currencyOf, times, sum, assertSameCurrency, format, round2, SHAPE, CODE_RE };
