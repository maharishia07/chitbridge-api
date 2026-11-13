/* ADOPTED from chitbridge-engines v1.93.0 · money · sha256 7910439dd6ebf8de8877956854398eac79d3155c97d48e5a7579e53d5aa22618 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · money. Edited ONLY in chitbridge-engines/src/money.js; every platform adopts a released version of it. */
/*
 * OWNS      the one money type: an amount with its currency (the value type, ISO 4217 list and minor units, plus/minus/compare/times/allocate/round/format, assertMoneyShape), the one rounder and the one price reader; never converts
 * CALLED BY src/convert.js, src/locale.js, src/orders.js, src/qty.js, src/rewards.js (+2 more)   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 * FLOW      amount + currency ──▶ makeMinor (strict: refuses an unlisted code; make / read / isMoney / stampPrice read the same ISO_4217 list) ──▶ plusMoney · minusMoney · compareMoney · timesMoney · allocate · roundMoney (each refuses a currency mismatch) ──▶ a frozen { amount_minor, currency }
 * CARD      14-accounting/functions/foreign-currency
 */
(function (root) {
  'use strict';
  /**
   * money.js — THE ONE MONEY TYPE. Every amount in ChitBridge is `{ amount_minor, currency }` (today `{ amount, currency }` in major units
   * until the minor-unit step lands): never a bare number, currency fixed at write time, never read from a setting. Currency code and minor
   * unit follow ISO 4217; carrying the currency on every amount follows UBL AmountType and PEPPOL BIS; the value semantics follow the Money
   * pattern and JSR 354 (immutable, plus and minus and compare refuse a currency mismatch with MONEY_CURRENCY_MISMATCH, rounding explicit and
   * passed the country pack, allocate loses no cent). It never converts. A second money module, a hand-written `reduce`/`+=`/`Math.round`
   * on an amount, or a bare amount in a new column or json slot is a defect. Enforced TODAY in this repo: tests/money-ops.test.js (the value type, the ISO list, assertMoneyShape). Planned, NOT yet in place: tests/money-no-arithmetic.test.cjs widened (api, from slice 7), schema-lint R9 (api, from slice 3a/6) and the unchecked-operations ratchet (from slice 7). (CUR-1 slice 1: the value type is the section "THE VALUE TYPE" at the end of this file; the
   * operators carry the names plusMoney, minusMoney, compareMoney, timesMoney, allocate, roundMoney, formatMoney so no existing function changes.)
   *
   * The older text, kept: an amount is never a bare number.
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
  const CODE_RE = /^[A-Z]{3}$/; // the SHAPE of a code only (kept as an export); WHICH codes exist is ISO_4217, read through isIsoCurrency

  /** Is this already a money value? */
  function isMoney(v, opts) {
    const stored = !!(opts && opts.stored); /* an OLD record may carry a withdrawn code; a request body may not */
    return (
      !!v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      typeof v.amount === 'number' &&
      Number.isFinite(v.amount) &&
      typeof v.currency === 'string' &&
      (stored ? isReadableCurrency(v.currency) : isIsoCurrency(v.currency))
    );
  }

  /** Build one. Throws rather than produce a currency-less price — this is the write-path guard. */
  function make(amount, currency) {
    const n = typeof amount === 'string' && amount.trim() !== '' ? Number(amount) : amount;
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      const e = new Error(`Price must be a finite number, got ${JSON.stringify(amount)}`);
      e.status = 422;
      throw e;
    }
    const c = String(currency || '')
      .trim()
      .toUpperCase();
    if (!isIsoCurrency(c)) {
      const e = new Error(isWithdrawnCurrency(c) ? newMoneyWords_(c) : `Price must carry a currency — expected ${SHAPE}, got currency ${JSON.stringify(currency)}`);
      e.status = 422;
      if (c) e.code = 'MONEY_CURRENCY_UNKNOWN'; // a code was given but is not on the ISO 4217 list
      if (isWithdrawnCurrency(c)) Object.assign(e, { currency: c, withdrawn: true });

      throw e;
    }
    return { amount: n, currency: c };
  }

  /** The refusal for a bare number read with no usable code to assume: 500, and MONEY_CURRENCY_UNKNOWN when a code WAS given but is not on the list. */
  function assumeProblem_(legacyAmount, assume, given) {
    const problem = new Error(assume ? `Legacy price ${legacyAmount} cannot be read as ${JSON.stringify(given)}: that is not an ISO 4217 currency code.` : `Legacy price ${legacyAmount} has no currency and none was supplied to assume. Pass { assume } from the owning entity.`);
    problem.status = 500;
    if (assume) Object.assign(problem, { code: 'MONEY_CURRENCY_UNKNOWN', currency: given });
    return problem;
  }

  /** The 422 for a value read() cannot read; a stored { amount, currency: 'PTS' } also names which code was refused. */
  function unreadableProblem_(text) {
    const e = new Error(`Unreadable price ${JSON.stringify(text)} — expected a number or ${SHAPE}`);
    e.status = 422;
    const named = text && typeof text === 'object' ? text.currency : null;
    if (typeof named === 'string' && named && !isIsoCurrency(named)) Object.assign(e, { code: 'MONEY_CURRENCY_UNKNOWN', currency: named });
    return e;
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
  function read(text, opts = {}) {
    if (text === null || text === undefined || text === '') return null;
    if (isMoney(text, { stored: !!opts.stored })) return { amount: text.amount, currency: text.currency };

    // A legacy bare number (or a numeric string from a form field).
    const n = typeof text === 'string' ? Number(text.trim()) : text;
    if (typeof n === 'number' && Number.isFinite(n)) {
      const assume = String(opts.assume || '')
        .trim()
        .toUpperCase();
      if (!isIsoCurrency(assume)) throw assumeProblem_(n, assume, opts.assume);
      return { amount: n, currency: assume, assumed: true };
    }

    // An object that is not money, a boolean, an array — unreadable. Loudly.
    throw unreadableProblem_(text);
  }

  /** The number, or null when there is no price. NEVER 0 by default — see rule 3. */
  function amountOf(v, opts = {}) {
    const m = read(v, opts);
    return m ? m.amount : null;
  }
  /** The code, or null when there is no price. */
  function currencyOf(v, opts = {}) {
    const m = read(v, opts);
    return m ? m.currency : null;
  }

  /** Amount × quantity, staying in one currency. Returns null when there is no price to multiply. */
  function times(v, qty, opts = {}) {
    const m = read(v, opts);
    if (!m) return null;
    const q = Number(qty);
    if (!Number.isFinite(q)) {
      const e = new Error(`Quantity must be a finite number, got ${JSON.stringify(qty)}`);
      e.status = 422;
      throw e;
    }
    return { amount: round2(m.amount * q, m.currency), currency: m.currency };
  }

  /**
   * Total a list. THROWS on mixed currencies rather than adding them.
   *
   * An empty list has no currency, so it cannot produce a zero — `{amount:0, currency:???}` would be a lie. Callers
   * that need a displayable zero must supply the currency they mean via opts.empty.
   */
  function sum(list, opts = {}) {
    const monies = (list || []).map((item) => read(item, opts)).filter(Boolean);
    if (!monies.length) {
      const empty = String(opts.empty || '')
        .trim()
        .toUpperCase();
      if (isIsoCurrency(empty)) return { amount: 0, currency: empty };
      return null;
    }
    const currencies = [...new Set(monies.map((item) => item.currency))];
    if (currencies.length > 1) {
      // The refusal STATES THE THREE WAYS FORWARD. A blocked caller that is not told its options will reach for the
      // silent sum, which is the one outcome that must never happen.
      const e = new Error(
        `Cannot total across currencies: ${currencies.join(' + ')}. An amount is labelled, never converted. ` +
          `Choose one, explicitly: (1) group by currency and show ${currencies.length} totals; ` +
          `(2) ignore money and total the PRODUCT instead — quantity is summable across currencies; ` +
          `(3) convert to the network's reporting currency using a dated rate table, and label the result derived.`
      );
      e.status = 409;
      e.code = 'MONEY_CURRENCY_MISMATCH';
      e.currencies = currencies;
      e.options = ['split_by_currency', 'total_product_only', 'convert_to_reporting_currency'];
      throw e;
    }
    return {
      amount: round2(
        monies.reduce((total, item) => total + item.amount, 0),
        currencies[0]
      ),
      currency: currencies[0]
    };
  }

  /** Guard for anywhere two amounts meet. */
  function assertSameCurrency(a, b, where = 'these amounts') {
    const ca = currencyOf(a),
      cb = currencyOf(b);
    if (ca && cb && ca !== cb) {
      const e = new Error(`${where}: ${ca} and ${cb} cannot be combined. An amount is labelled, never converted.`);
      e.status = 409;
      e.code = 'MONEY_CURRENCY_MISMATCH';
      throw e;
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
    /* ⭐ READS THROUGH priceOf (SPEC-money-one-reader.md step 3) — one reading of every stored shape, so this and the
     counter and the storefront cannot disagree again. It keeps ITS contract (NaN for "no price", which its 19 callers
     test with Number.isFinite) and gains the one shape it refused: { amount: "12.50" } — the review's §21 case, where
     the counter billed ₹12.50 and the storefront refused the same product as unpriced. */
    const p = priceOf(v);
    return p === null ? NaN : p;
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
    const c = String(currency || '')
      .trim()
      .toUpperCase();
    if (!isIsoCurrency(c)) {
      const e = new Error(isWithdrawnCurrency(c) ? 'Cannot stamp a price: ' + newMoneyWords_(c) : 'Cannot stamp a price: the owning entity has no valid currency.');
      e.status = 500;
      if (c) Object.assign(e, { code: 'MONEY_CURRENCY_UNKNOWN', currency: currency }, isWithdrawnCurrency(c) ? { withdrawn: true } : {});
      throw e;
    }
    refuseUnlistedSpoof_(value, c);
    if (isMoney(value)) {
      if (value.currency !== c) {
        const e = new Error(
          `This catalogue is priced in ${c}; a price in ${value.currency} cannot be stored on it. The currency comes from the business, not the request.`
        );
        e.status = 409;
        throw e;
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
        const date = new Date(value.as_of);
        /* An unreadable date is dropped rather than stored: a malformed timestamp reads as provenance and is not. */
        if (!isNaN(date.getTime())) out.as_of = date.toISOString();
      }
      return out;
    }
    return make(value, c); // throws 422 on anything unreadable
  }

  /** A price object naming an UNLISTED currency that is not the entity's: the spoof case, still 409 (the currency comes from the business), now with the code and the refused currency. */
  function refuseUnlistedSpoof_(value, entityCurrency) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !CODE_RE.test(value.currency) || isIsoCurrency(value.currency)) return; // a code of the wrong SHAPE (XX) stays the old 422 from make()
        const e = new Error(`This catalogue is priced in ${entityCurrency}; a price in ${JSON.stringify(value.currency)} cannot be stored on it (not an ISO 4217 code either). The currency comes from the business, not the request.`);
    Object.assign(e, { status: 409, code: 'MONEY_CURRENCY_UNKNOWN', currency: value.currency });
    throw e;
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
      out[name] = entry && typeof entry === 'object' && !Array.isArray(entry) ? stampItem(entry, currency) : entry;
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
    const nonMonetary = list.filter((item) => !item.currency).length;
    const pending = list.filter((item) => item.currency && (item.value === null || item.value === undefined)).length;
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
    const valued = list.filter((item) => item.currency && item.value !== null && item.value !== undefined && Number.isFinite(Number(item.value)));

    const buckets = {};
    valued.forEach((item) => {
      const c = String(item.currency).toUpperCase();
      buckets[c] = (buckets[c] || 0) + Number(item.value);
    });

    const by_currency = Object.keys(buckets)
      .map((item) => ({ currency: item, total: round2(buckets[item], item), chits: valued.filter((r) => String(r.currency).toUpperCase() === item).length }))
      .sort((first, second) => second.total - first.total);

    return {
      by_currency,
      mixed: by_currency.length > 1,
      // Stated, never hidden. A summary that silently drops rows is as misleading as one that silently adds them.
      excluded: { non_monetary: nonMonetary, awaiting_agreement: pending },
      // Deliberately NOT a number. If a screen wants one figure it must pick a mode and say which — and if it picks
      // conversion it owns the rate, its date and the word "derived".
      total: by_currency.length === 1 ? by_currency[0] : null
    };
  }

  /** ONE place rounding happens, so the eventual move to integer minor units has one site to change. */
  /* ⚠️ KEPT FOR ITS CALLERS, but it IS round() now — the EPSILON rule it used was wrong ~6,200 times in 1.4 M cases (see round) */
  function round2(n, currency) {
    return round(n, currency);
  }

  /**
   * ── ⭐⭐⭐ ONE READER, ONE ROUNDER (2026-09-27) — SPEC-money-one-reader.md ───────────────────────────────────
   *
   * External review §7/§21: fourteen round-to-paisa helpers in two definitions, and five price readers that
   * disagree. Measured against exact integer arithmetic on 1.4 M percentage-off cases, BOTH definitions were
   * wrong ~6,200 times (5% of ₹2.90 → ₹0.14; 5% of ₹42.70 → ₹2.13), and every one assumed two decimals. Athi's
   * decisions: D1 half AWAY from zero · D2 each currency's own decimals · D3 a blank price is unpriced, never 0.
   *
   * ⚠️ NOTHING CALLS THESE YET. They land first, with their golden test, so each old helper can then be moved
   * onto them one file at a time with its own tests run — never fifty call sites in one change.
   */

  /* ISO 4217 (CUR-1, Athi D5; critic change 2): the ONE list of currency codes and their minor-unit exponents, kept here so the till's
   * vendored copy of this file carries it. Active codes (the 1 Jan 2026 list; BGN and HRK left with the euro; funds and metals with no
   * exponent, XXX and XTS are NOT in it). An exponent is ISO's, never Intl's: CLDR rounds IQD, LBP, SYP, YER and a few more to 0 for display,
   * which would change a total between a server and a till on another ICU. */
  const ISO_4217 = (function build() {
    const out = {};
    const GROUPS = [
      [0, 'BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF'],
      [3, 'BHD IQD JOD KWD LYD OMR TND'],
      [4, 'CLF UYW'],
      [
        2,
        'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CNY COP COU CRC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GTQ GYD HKD HNL HTG HUF IDR ILS INR IRR JMD KES KGS KHR KPW KYD KZT LAK LBP LKR LRD LSL MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK PHP PKR PLN QAR RON RSD RUB SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TOP TRY TTD TWD TZS UAH USD USN UYU UZS VED VES WST XCD XCG YER ZAR ZMW ZWG'
      ]
    ];
    GROUPS.forEach(function (group) {
      group[1].split(' ').forEach(function (code) {
        out[code] = group[0];
      });
    });
    return Object.freeze(out);
  })();

  /** Is this EXACT string a listed ISO 4217 code? (upper case only: 'inr', 'PTS', 'XXX', 'INRR' are not.) */
  function isIsoCurrency(code) {
    return typeof code === 'string' && Object.prototype.hasOwnProperty.call(ISO_4217, code);
  }

  /* CUR-1b (DECISIONS 80c547c7): the codes ISO 4217 WITHDREW (list A.3, historic) stay READABLE so an old record keeps its meaning for the
   * 9-year record floor, but are refused for any NEW money. Kept apart from ISO_4217 on purpose: isIsoCurrency (every write door) is the
   * ACTIVE list only. Their exponent is ISO's (all 2). Funds (XDR ...) are on neither list: never a shop's money. */
  const WITHDRAWN_4217 = Object.freeze({ BGN: 2, HRK: 2, CUC: 2, SLL: 2, ZWL: 2 });
  /* The successor ISO names for each withdrawn code (ISO 4217 historical codes: HRK 2023-01-01 EUR; BGN 2025-12-31 EUR; CUC 2021-06-30 CUP; ZWL 2024-09-01 ZWG;
   SLL redenominated 1000:1 to SLE on 1 Jul 2022). Only a POINTER for the owner's words: nothing is ever converted or switched for them. */
  const SUCCESSOR_4217 = Object.freeze({ BGN: 'EUR', HRK: 'EUR', CUC: 'CUP', SLL: 'SLE', ZWL: 'ZWG' });
  /** Is this EXACT string a withdrawn (historic) code? */
  function isWithdrawnCurrency(code) {
    return typeof code === 'string' && Object.prototype.hasOwnProperty.call(WITHDRAWN_4217, code);
  }
  /** Active or withdrawn: a code an OLD record may carry and a reader may still answer for. */
  function isReadableCurrency(code) {
    return isIsoCurrency(code) || isWithdrawnCurrency(code);
  }
  /** The sentence for a code a NEW amount may not use; withdrawn codes say so (same code MONEY_CURRENCY_UNKNOWN, plus withdrawn: true). */
  function newMoneyWords_(code) {
    if (isWithdrawnCurrency(code)) return `${code} has been withdrawn from ISO 4217 and replaced by ${SUCCESSOR_4217[code]}, so it cannot be used for new money. Change the shop currency to ${SUCCESSOR_4217[code]}; nothing is converted, and old records in ${code} stay readable as written.`;
    return `${JSON.stringify(code)} is not an ISO 4217 currency code.`;
  }
  /** refuseNewCurrency(code) → the upper-cased ACTIVE code, or a worded 422 MONEY_CURRENCY_UNKNOWN (withdrawn:true for a withdrawn one). The ONE call every write door that takes a currency makes. */
  function refuseNewCurrency(code) {
    const c = String(code == null ? '' : code).trim().toUpperCase();
    if (isIsoCurrency(c)) return c;
    throw newMoneyRefusal_(code, c);
  }
  function newMoneyRefusal_(given, upper) {
    return moneyError_('MONEY_CURRENCY_UNKNOWN', 422, newMoneyWords_(upper), isWithdrawnCurrency(upper) ? { currency: upper, withdrawn: true } : { currency: given });
  }

  /** exponentOf(code) → the ISO 4217 minor-unit digits of a LISTED code; no default, no Intl, no shim: an absent or unlisted code throws MONEY_CURRENCY_UNKNOWN (422). decimals() is the older, tolerant reader. */
  function exponentOf(code) {
    if (!isReadableCurrency(code)) throw moneyError_('MONEY_CURRENCY_UNKNOWN', 422, `${JSON.stringify(code)} is not an ISO 4217 currency code, so its minor unit is not known.`, { currency: code });
    return isIsoCurrency(code) ? ISO_4217[code] : WITHDRAWN_4217[code];
  }

  /** One named error: the code a caller branches on, the HTTP status the api answers, the sentence a person reads. */
  function moneyError_(code, status, message, extra) {
    const e = new Error(message);
    e.code = code;
    e.status = status;
    return extra ? Object.assign(e, extra) : e;
  }

  /* ISO 4217 'XXX' is the code for "no currency involved": the tax engine's callers (and its golden cases) pass it where there is none, so decimals() reads it as
   * an ABSENT currency (the counted shim, 2), exactly what Intl gave it. It is NOT a currency: the value type refuses it everywhere else. */
  const NO_CURRENCY = 'XXX';

  /* The counted shim: decimals(null) still answers 2 for a caller that has no currency to give (today's behaviour), but every such
   * call is counted, so "silence is the bug" can be measured and the callers moved to a stated currency one by one. */
  let decimalsShimCalls = 0;
  /** How many times decimals() answered 2 because it was given no currency (the shim). */
  function decimalsShimCount() {
    return decimalsShimCalls;
  }
  /** Zero the shim counter (a test, or a deploy-time probe). */
  function decimalsShimReset() {
    decimalsShimCalls = 0;
  }

  /**
   * decimals(currency) → how many minor-unit digits it has, FROM THE ISO 4217 LIST ONLY: INR/USD 2, JPY 0, BHD/OMR/KWD 3.
   * No Intl fallback and no silent 2: a code that is not on the list throws MONEY_CURRENCY_UNKNOWN (422). Only an ABSENT currency
   * (null, undefined, '') takes the counted shim and answers 2. Case and spaces are tolerated here (legacy callers upper-case late).
   */
  function decimals(currency) {
    const c = String(currency || '')
      .trim()
      .toUpperCase();
    if (!c || c === NO_CURRENCY) {
      decimalsShimCalls += 1;
      return 2;
    }
    if (!isReadableCurrency(c)) throw moneyError_('MONEY_CURRENCY_UNKNOWN', 422, `${JSON.stringify(currency)} is not an ISO 4217 currency code, so its minor unit is not known.`, { currency: currency });
    return isIsoCurrency(c) ? ISO_4217[c] : WITHDRAWN_4217[c];
  }

  /**
   * round(n, currency) → n to the currency's minor unit, half AWAY from zero, on the DECIMAL value.
   * ⚠️ toPrecision(15) is the whole trick: 1.005 × 100 is 100.49999999999999 in binary, and rounding THAT gives
   * 100; at 15 significant digits it is 100.500000000000, which is what a person means. Proven 0 wrong in 1.74 M
   * cases (tests/money-round.test.js), where both old rules were wrong thousands of times.
   * ⚠️ No currency → 2 decimals, today's behaviour, through decimals() so the shim counter counts it. A non-finite n is returned as-is so NaN stays loud.
   */
  function round(n, currency) {
    const x = Number(n);
    if (!Number.isFinite(x)) return x;
    const f = Math.pow(10, decimals(currency));
    const c = Math.round(Number((Math.abs(x) * f).toPrecision(15))) / f;
    /* ⚠️ `c !== 0` — without it −0.001 rounds to −0, which prints as "-0.00" on a receipt (the test caught it) */
    return x < 0 && c !== 0 ? -c : c;
  }

  /**
   * toMinor(amount, currency) → the amount in WHOLE minor units (₹12.34 → 1234, ¥1234 → 1234, 0.528 OMR → 528), the same half-away-from-zero
   * rule as round(); null for a non-finite amount, so a blank never reads as 0. v1.73.0: the one home a pack's threshold compare reads
   * (reg-au · reg-ae · reg-in taxInvoice take minor units); posting · receivables · rollup still carry their own copies of this rule.
   */
  function toMinor(amount, currency) {
    const x = Number(amount);
    if (!Number.isFinite(x)) return null;
    const c = Math.round(Number((Math.abs(x) * Math.pow(10, decimals(currency))).toPrecision(15)));
    return x < 0 && c !== 0 ? -c : c;
  }

  /**
   * priceOf(v) → the price as a NUMBER, or null when there is none. THE one reader (§21).
   *
   * Reads a finite number · a numeric string (trimmed) · { amount: number | numeric string, … }.
   * ⚠️⚠️ ABSENT IS null, NEVER 0. `routes/till.js` read '' as 0, so a product imported with a blank price cell
   * sold for ₹0.00 at the counter while the storefront refused it — the same product, free in one place and
   * unsellable in the other. An empty cell is not a price.
   * ⚠️ It READS; it does not validate. Whether 0 or a negative is allowed is the caller's rule, stated there.
   */
  function priceOf(v) {
    const text = v !== null && typeof v === 'object' && !Array.isArray(v) ? v.amount : v;
    if (typeof text === 'number') return Number.isFinite(text) ? text : null;
    if (typeof text === 'string') {
      const t = text.trim();
      if (!t || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  /**
   * roundToStep(minor, pack) → a CASH amount in whole minor units rounded to the pack's coin step (AU: 5c, from pack.cashRounding.step_minor); CTRY-77.
   * Integers only: a non-integer or non-finite input answers null, never a guess. A pack with no cashRounding (India) returns the amount unchanged; a cashRounding whose step_minor is not a positive whole number ("5", 5.5, -5, 0) answers null.
   * TIE RULE: the nearest multiple of the step, an exact half going UP (away from zero), the RBA's "2.5c rounds up": 1c,2c over round down, 3c,4c over round up
   * (10.02 → 10.00, 10.03 → 10.05, 10.07 → 10.05, 10.08 → 10.10). A refund (negative) mirrors its sale: -10.03 → -10.05, so a sale and its return agree.
   * The caller applies it to the CASH tender only (a card or UPI part is the exact total); it never converts, it only snaps.
   */
  function roundToStep(minor, pack) {
    if (typeof minor !== 'number' || !Number.isSafeInteger(minor)) return null;
    const r = pack && pack.cashRounding;
    if (!r) return minor; /* no cashRounding = no coin step (India) */
    const step = r.step_minor;
    if (!(Number.isSafeInteger(step) && step > 0)) return null; /* a step that is not a positive whole number is a pack fault: say so, never pass the amount through */
    const mag = Math.abs(minor);
    const rest = mag % step;
    const snapped = mag - rest + (rest * 2 >= step ? step : 0);
    return minor < 0 && snapped !== 0 ? -snapped : snapped;
  }

  /**
   * ── ⭐⭐⭐ THE VALUE TYPE (CUR-1 slice 1, Athi D5: "money is a value type, like a class in C++") ─────────────────────
   *
   *   { amount_minor: 329000, currency: 'INR' }          optional: source, as_of (provenance, as stampPrice keeps them)
   *
   * A value is FROZEN. Every operator returns a NEW value (or an integer / boolean for compare and equals, never a bare amount), takes
   * the currency from its operands, and refuses a mismatch with MONEY_CURRENCY_MISMATCH (409). The currency must be an exact ISO 4217
   * code from ISO_4217 above: 'PTS', 'XXX', 'inr', 'INRR' are refused with MONEY_CURRENCY_UNKNOWN. Operators also READ the legacy major
   * shape { amount, currency } (converted with toMinor), so the tolerant-read rule holds; a bare number is MONEY_CURRENCY_MISSING.
   * Names carry the suffix Money (plusMoney, timesMoney, roundMoney, formatMoney) so no existing function changes its answer.
   * Errors: MONEY_CURRENCY_MISSING 422 · MONEY_CURRENCY_UNKNOWN 422 · MONEY_CURRENCY_MISMATCH 409 · MONEY_AMOUNT_INVALID 422 ·
   * MONEY_SHAPE_INVALID 422 · MONEY_QTY_UNREADABLE 422 · MONEY_MODE_UNKNOWN 422 · MONEY_RATIOS_INVALID 422 · MONEY_PACK_FAULT 500 ·
   * MONEY_BARE_AMOUNT 422 (the codes are registered in the api's error-code register by cb-api).
   */

  const MONEY_KEYS = ['amount_minor', 'currency', 'source', 'as_of'];

  /** The strict currency check every value-type door shares: the code, or a named refusal (absent → MISSING, anything not listed → UNKNOWN). */
  function strictCurrency_(code) {
    if (code === undefined || code === null || code === '') throw moneyError_('MONEY_CURRENCY_MISSING', 422, 'An amount needs its currency: none was given.');
    if (!isIsoCurrency(code)) throw newMoneyRefusal_(code, code);
    return code;
  }

  /** The whole minor-unit count, or MONEY_AMOUNT_INVALID: a float, a string, NaN or a number past Number.MAX_SAFE_INTEGER is never a stored amount. */
  function strictMinor_(minor) {
    if (typeof minor !== 'number' || !Number.isSafeInteger(minor)) {
      throw moneyError_('MONEY_AMOUNT_INVALID', 422, `An amount in minor units must be a whole number within ±9007199254740991, got ${JSON.stringify(minor)}.`);
    }
    return minor === 0 ? 0 : minor; /* never -0 */
  }

  /** The optional provenance a value may carry; an unreadable as_of is refused here (a malformed timestamp reads as provenance and is not). */
  function provenanceOf_(prov) {
    const out = {};
    if (!prov) return out;
    if (prov.source != null && String(prov.source).trim() !== '') out.source = String(prov.source).slice(0, 120);
    if (prov.as_of != null && String(prov.as_of).trim() !== '') {
      const when = new Date(prov.as_of);
      if (isNaN(when.getTime())) throw moneyError_('MONEY_SHAPE_INVALID', 422, `as_of ${JSON.stringify(prov.as_of)} is not a readable date.`);
      out.as_of = when.toISOString();
    }
    return out;
  }

  /** The one place a value is born: frozen, minor units whole, currency listed. */
  function frozenMoney_(minor, currency, prov) {
    return Object.freeze(Object.assign({ amount_minor: strictMinor_(minor), currency: strictCurrency_(currency) }, provenanceOf_(prov)));
  }

  /** makeMinor(amount_minor, currency[, { source, as_of }]) → a frozen money value. Throws a named error, never returns a bare number. */
  function makeMinor(amountMinor, currency, prov) {
    return frozenMoney_(amountMinor, currency, prov);
  }

  /** The error codes a shape check answers with (anything else thrown inside is a bug and stays loud). */
  const SHAPE_CODES = ['MONEY_SHAPE_INVALID', 'MONEY_CURRENCY_UNKNOWN', 'MONEY_CURRENCY_MISSING', 'MONEY_AMOUNT_INVALID'];

  /** Is this a value-type money (the strict new shape), true or false; the same test assertMoneyShape applies, without the throw. */
  function isMoneyValue(value) {
    try {
      assertMoneyShape(value);
      return true;
    } catch (e) {
      if (SHAPE_CODES.indexOf(e.code) >= 0) return false;
      throw e;
    }
  }

  /** An operand as { minor, currency }: the new shape, or the legacy major shape converted; a bare number or anything else is refused by name. */
  function operandOf_(value) {
    if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
      const word = typeof value === 'number' || typeof value === 'string' ? 'A bare amount has no currency' : 'Not an amount';
      throw moneyError_('MONEY_CURRENCY_MISSING', 422, `${word}: ${JSON.stringify(value)}. Pass { amount_minor, currency }.`);
    }
    if (value.amount_minor !== undefined) return { minor: strictMinor_(value.amount_minor), currency: strictCurrency_(value.currency) };
    if (typeof value.amount === 'number' && Number.isFinite(value.amount)) {
      const code = strictCurrency_(value.currency);
      return { minor: strictMinor_(toMinor(value.amount, code)), currency: code };
    }
    throw moneyError_('MONEY_SHAPE_INVALID', 422, `Unreadable amount ${JSON.stringify(value)}: expected { amount_minor, currency }.`);
  }

  /** "INR 100.00" for a refusal sentence: the code and the amount at the currency's own decimals. */
  function showOperand_(operand) {
    const d = ISO_4217[operand.currency];
    return `${operand.currency} ${(operand.minor / Math.pow(10, d)).toFixed(d)}`;
  }

  /** How each verb words a mismatch: [verb, preposition, which operand is named first]. */
  const MISMATCH_WORDS = { add: ['add', 'to', 'left'], subtract: ['subtract', 'from', 'right'], compare: ['compare', 'with', 'left'] };

  /** Two operands that must share a currency; the one MONEY_CURRENCY_MISMATCH sentence, built for the verb that was asked. */
  function pairOf_(amount, other, verb) {
    const left = operandOf_(amount);
    const right = operandOf_(other);
    if (left.currency === right.currency) return [left, right];
    const says = MISMATCH_WORDS[verb];
    const named = says[2] === 'left' ? [left, right] : [right, left];
    throw moneyError_('MONEY_CURRENCY_MISMATCH', 409, `Cannot ${says[0]} ${showOperand_(named[0])} ${says[1]} ${showOperand_(named[1])}: they are different currencies.`, {
      currencies: [left.currency, right.currency]
    });
  }

  /** a + b, same currency only; the result is a new frozen value. */
  function plusMoney(amount, other) {
    const pair = pairOf_(amount, other, 'add');
    return frozenMoney_(pair[0].minor + pair[1].minor, pair[0].currency);
  }
  /** a − b, same currency only; the result is a new frozen value. */
  function minusMoney(amount, other) {
    const pair = pairOf_(amount, other, 'subtract');
    return frozenMoney_(pair[0].minor - pair[1].minor, pair[0].currency);
  }
  /** −a. */
  function negateMoney(amount) {
    const operand = operandOf_(amount);
    return frozenMoney_(-operand.minor, operand.currency);
  }
  /** |a|. */
  function absMoney(amount) {
    const operand = operandOf_(amount);
    return frozenMoney_(Math.abs(operand.minor), operand.currency);
  }
  /** compareMoney(a, b) → -1, 0 or 1; same currency only (an integer, never an amount). */
  function compareMoney(amount, other) {
    const pair = pairOf_(amount, other, 'compare');
    return pair[0].minor < pair[1].minor ? -1 : pair[0].minor > pair[1].minor ? 1 : 0;
  }
  /** Same currency and same amount (a boolean). A different currency REFUSES (409); it is not "false", which would read as "different amounts". */
  function equalsMoney(amount, other) {
    return compareMoney(amount, other) === 0;
  }
  /** a < b, same currency only. */
  function lessThanMoney(amount, other) {
    return compareMoney(amount, other) < 0;
  }
  /** a > b, same currency only. */
  function greaterThanMoney(amount, other) {
    return compareMoney(amount, other) > 0;
  }
  /** Is the amount exactly zero. */
  function isZeroMoney(amount) {
    return operandOf_(amount).minor === 0;
  }

  /** The explicit rounding modes of timesMoney: half_away (D1, the default), toward_zero, away_from_zero. */
  const TIMES_MODES = {
    half_away: Math.round,
    toward_zero: Math.floor,
    away_from_zero: Math.ceil
  };

  /** A quantity as a finite number, or MONEY_QTY_UNREADABLE (a numeric string from a form is read; '' and NaN are not). */
  function qtyOf_(count) {
    const parsed = typeof count === 'string' && count.trim() !== '' ? Number(count) : count;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) throw moneyError_('MONEY_QTY_UNREADABLE', 422, `Quantity must be a finite number, got ${JSON.stringify(count)}.`);
    return parsed;
  }

  /**
   * timesMoney(a, qty[, { mode }]) → a × qty as a new value, rounded to a whole minor unit by an EXPLICIT mode (default half_away,
   * Athi D1). The product is read at 15 significant digits, as round() does, so 1.005 × 100 does not land on 100.4999… .
   * The pack's cash step is NOT applied here: roundToStep runs once, last, on the cash total (roundMoney).
   */
  function timesMoney(amount, count, opts) {
    const operand = operandOf_(amount);
    const quantity = qtyOf_(count);
    const modeName = (opts && opts.mode) || 'half_away';
    const mode = Object.prototype.hasOwnProperty.call(TIMES_MODES, modeName) ? TIMES_MODES[modeName] : null;
    if (!mode) throw moneyError_('MONEY_MODE_UNKNOWN', 422, `Rounding mode ${JSON.stringify(modeName)} is not one of ${Object.keys(TIMES_MODES).join(', ')}.`);
    const magnitude = mode(Number((Math.abs(operand.minor) * Math.abs(quantity)).toPrecision(15)));
    return frozenMoney_(operand.minor < 0 !== quantity < 0 ? -magnitude : magnitude, operand.currency);
  }

  /** The ratios as BigInt weights: whole numbers as they are, any fraction scaled by 1e9; refuses an empty list, a negative or non-finite ratio, an all-zero list. */
  function weightsOf_(ratios) {
    const refuse = (reason) => moneyError_('MONEY_RATIOS_INVALID', 422, `Cannot split by these ratios: ${reason}.`);
    if (!Array.isArray(ratios) || !ratios.length) throw refuse('there must be at least one ratio');
    if (ratios.some((ratio) => typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0)) throw refuse('every ratio must be a finite number, zero or more');
    const scale = ratios.every((ratio) => Number.isSafeInteger(ratio)) ? 1 : 1e9;
    const weights = ratios.map((ratio) => BigInt(Math.round(ratio * scale)));
    if (weights.every((weight) => weight === BigInt(0))) throw refuse('they add up to zero');
    return weights;
  }

  /** total × weight ÷ Σweights per part, floored, then the leftover minor units go one each to the LARGEST remainders, the lower index first. */
  function splitWhole_(total, weights) {
    const zero = BigInt(0);
    const all = weights.reduce((x, y) => x + y, zero);
    const shares = weights.map((weight) => (total * weight) / all);
    const rests = weights.map((weight) => (total * weight) % all);
    const leftover = Number(total - shares.reduce((x, y) => x + y, zero));
    const order = weights.map((_, index) => index).sort((first, second) => (rests[second] > rests[first] ? 1 : rests[second] < rests[first] ? -1 : first - second));
    for (let place = 0; place < leftover; place++) shares[order[place]] += BigInt(1);
    return shares;
  }

  /**
   * allocate(a, ratios) → an array of frozen values that add back to EXACTLY a, no cent lost or made: largest remainder, the lower index
   * first on a tie. A negative total splits as its magnitude and the parts take its sign. Whole-number ratios are exact (BigInt); a
   * fractional ratio is read to 9 decimals. An empty, negative, non-finite or all-zero ratio list is MONEY_RATIOS_INVALID.
   */
  function allocate(amount, ratios) {
    const operand = operandOf_(amount);
    const shares = splitWhole_(BigInt(Math.abs(operand.minor)), weightsOf_(ratios));
    const sign = operand.minor < 0 ? -1 : 1;
    return Object.freeze(shares.map((share) => frozenMoney_(sign * Number(share), operand.currency)));
  }

  /**
   * roundMoney(a[, pack]) → the amount to its ISO minor unit (a legacy major amount with extra decimals is rounded half away from zero),
   * then, when the pack has a cashRounding, snapped to its coin step by the existing roundToStep. A pack whose step is not a positive
   * whole number is MONEY_PACK_FAULT (500), never passed through. The difference is NOT hidden: the caller posts it as round_off,
   * minusMoney(roundMoney(a, pack), roundMoney(a)). Apply the pack to the CASH part only.
   */
  function roundMoney(amount, pack) {
    const operand = operandOf_(amount);
    if (!pack || !pack.cashRounding) return frozenMoney_(operand.minor, operand.currency);
    const snapped = roundToStep(operand.minor, pack);
    if (snapped === null) throw moneyError_('MONEY_PACK_FAULT', 500, 'The country pack has a cash-rounding rule that is not a positive whole number of minor units.');
    return frozenMoney_(snapped, operand.currency);
  }

  /** totalsMoney(list) → ONE frozen total per currency, sorted by code, never added across (D3). Absent entries are skipped. */
  function totalsMoney(list) {
    const bucket = {};
    (list || []).forEach((item) => {
      if (item === null || item === undefined || item === '') return;
      const operand = operandOf_(item);
      bucket[operand.currency] = (bucket[operand.currency] || 0) + operand.minor;
    });
    return Object.freeze(
      Object.keys(bucket)
        .sort()
        .map((code) => frozenMoney_(bucket[code], code))
    );
  }

  /** formatMoney(a[, { locale, display }]) → text with the currency's own decimals from the ISO list (display 'code' prints the code, else the locale's symbol). */
  function formatMoney(amount, opts) {
    const operand = operandOf_(amount);
    const digits = ISO_4217[operand.currency];
    const settings = opts || {};
    const style = new Intl.NumberFormat(settings.locale || 'en-US', {
      style: 'currency',
      currency: operand.currency,
      currencyDisplay: settings.display === 'code' ? 'code' : 'symbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
    return style.format(operand.minor / Math.pow(10, digits));
  }

  /** moneyToJSON(a) → the one wire shape as a plain object: { amount_minor, currency } plus provenance when the value carries it. */
  function moneyToJSON(amount) {
    const operand = operandOf_(amount);
    return Object.assign({ amount_minor: operand.minor, currency: operand.currency }, provenanceOf_(amount));
  }

  /**
   * assertMoneyShape(v[, { where, legacy }]) → v, or MONEY_SHAPE_INVALID / MONEY_CURRENCY_* / MONEY_AMOUNT_INVALID naming the field.
   * THE RUNTIME BOUNDARY VALIDATOR (critic change 12): a plain object with exactly { amount_minor, currency } (+ source, as_of), a whole safe
   * integer, a listed upper-case ISO code, nothing else. legacy:true also accepts today's { amount (finite number), currency }. A bare number,
   * an array, a string amount, an extra key, a lower-case or unlisted code is refused. It does not convert and it does not default.
   */
  function assertMoneyShape(value, opts) {
    const where = (opts && opts.where) || 'amount';
    const fail = (reason) => moneyError_('MONEY_SHAPE_INVALID', 422, `${where}: ${reason}`, { path: where });
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw fail(`expected { amount_minor, currency }, got ${JSON.stringify(value)}`);
    const legacy = !!(opts && opts.legacy) && value.amount !== undefined && value.amount_minor === undefined;
    const allowed = legacy ? ['amount', 'currency', 'source', 'as_of'] : MONEY_KEYS;
    const stray = Object.keys(value).filter((key) => allowed.indexOf(key) < 0);
    if (stray.length) throw fail(`unexpected ${stray.join(', ')}`);
    if (legacy) {
      if (typeof value.amount !== 'number' || !Number.isFinite(value.amount)) throw fail('amount must be a finite number');
    } else {
      strictMinor_(value.amount_minor);
    }
    strictCurrency_(value.currency);
    provenanceOf_(value);
    return value;
  }

  /** Keys that name an amount: an explicit list (extend it deliberately, never by pattern); a value under one must be a money value, never a bare number. */
  const MONEY_KEY_NAMES = ['amount', 'total', 'price', 'price_min', 'price_max', 'cost', 'value', 'total_value', 'grand_total', 'balance', 'limit', 'credit_limit', 'fee', 'tax', 'net', 'gross', 'refund', 'paid', 'amount_paid', 'due', 'discount'];
  /* an EXACT name from the list, or any key ending _minor; tax_rate, net_weight, discount_pct, value_count, limit_per_day are NOT money */
  const AMOUNT_KEY = { test: (key) => MONEY_KEY_NAMES.indexOf(key) >= 0 || /_minor$/.test(key) };

  /** Is this value a number, or text that reads as one: the two ways a bare amount appears. */
  function looksNumeric_(child) {
    return typeof child === 'number' || (typeof child === 'string' && child.trim() !== '' && Number.isFinite(Number(child)));
  }

  /** Does this object claim to be a money value (it carries a currency or amount_minor) so its shape must be checked, not walked into. */
  function claimsMoney_(child) {
    return !!child && typeof child === 'object' && !Array.isArray(child) && (child.currency !== undefined || child.amount_minor !== undefined);
  }

  /** The problem with one amount-named field, or null: a bare number, or a money-claiming object whose shape is wrong. */
  function amountProblem_(child, at, legacy) {
    if (looksNumeric_(child)) return 'a bare amount: it carries no currency';
    if (!claimsMoney_(child)) return null;
    try {
      assertMoneyShape(child, { where: at, legacy: legacy });
      return null;
    } catch (e) {
      return e.message;
    }
  }

  /** Every bare or malformed amount under a tree: [{ path, why }], walking objects and arrays (a money value is checked, not entered). */
  function findBareMoney(tree, opts) {
    const found = [];
    const allow = (opts && opts.allow) || [];
    const legacy = !!(opts && opts.legacy);
    (function walk(node, path, depth) {
      if (depth > 12 || node === null || typeof node !== 'object') return;
      Object.keys(node).forEach((key) => {
        const at = path ? `${path}.${key}` : key;
        if (allow.indexOf(at) >= 0) return;
        const reason = AMOUNT_KEY.test(key) ? amountProblem_(node[key], at, legacy) : null;
        if (reason) found.push({ path: at, why: reason });
        else if (!(AMOUNT_KEY.test(key) && claimsMoney_(node[key]))) walk(node[key], at, depth + 1);
      });
    })(tree, '', 0);
    return found;
  }

  /** assertNoBareMoney(tree[, { allow, legacy }]) → tree, or MONEY_BARE_AMOUNT (422) listing every path in e.violations. */
  function assertNoBareMoney(tree, opts) {
    const violations = findBareMoney(tree, opts);
    if (violations.length) throw moneyError_('MONEY_BARE_AMOUNT', 422, `Amounts without a currency: ${violations.map((x) => x.path).join(', ')}.`, { violations: violations });
    return tree;
  }

  const EXPORTS = {
    isMoney,
    make,
    read,
    amountOf,
    amountOfLoose,
    currencyOf,
    times,
    sum,
    summarise,
    stampPrice,
    stampItem,
    stampCommercials,
    PRICE_KEYS,
    assertSameCurrency,
    format,
    round2,
    SHAPE,
    CODE_RE,
    decimals,
    round,
    toMinor,
    roundToStep,
    priceOf,
    ISO_4217,
    isIsoCurrency,
    isActiveCurrency: isIsoCurrency,
    isWithdrawnCurrency,
    isReadableCurrency,
    refuseNewCurrency,
    WITHDRAWN_4217,
    SUCCESSOR_4217,
    exponentOf,
    decimalsShimCount,
    decimalsShimReset,
    makeMinor,
    isMoneyValue,
    plusMoney,
    minusMoney,
    negateMoney,
    absMoney,
    compareMoney,
    equalsMoney,
    lessThanMoney,
    greaterThanMoney,
    isZeroMoney,
    timesMoney,
    allocate,
    roundMoney,
    totalsMoney,
    formatMoney,
    moneyToJSON,
    assertMoneyShape,
    findBareMoney,
    assertNoBareMoney
  };

  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBMoney. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBMoney = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
