'use strict';
/**
 * lib/jurisdiction.js — WHERE A PARTY IS, AND WHAT THAT DECIDES. Pure: no database, no network, no state.
 *   (classic script shape — written so it CAN be vendored to the browser, like the other engines)
 *
 * ⚠️⚠️ IT IS NOT ACTUALLY VENDORED, AND THIS LINE USED TO SAY IT WAS. `public/engine/` holds twelve engines —
 * money, nums, docnumber, tax, offers, rewards, locale, lots, gs1, pricing, search, qr — and jurisdiction is
 * not among them. So the counter cannot decide, offline, which payment schemes a shop's COUNTRY allows; it is
 * a server answer only.
 *
 * ⭐ The shape is right and the wiring is missing, which is a backlog item rather than a defect. What was a
 * defect is the sentence: a header claiming a file exists sends somebody looking for it, and a claim in a
 * comment is believed exactly as much as a claim in code. Found 2026-09-11 while writing this file's tests.
 *
 * Athi, 2026-09-10: *"can we convert the country, currency, ie the localisation as a capability so it can be used in
 * any product?"*
 *
 * ── ⭐⭐ WHAT THIS OWNS, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────────────────────────────────────
 * It owns the PURE country-shaped answers — the ones that are the same for everybody and need nothing looked up:
 *   · which country a party is in, derived from what is known about them
 *   · what a shop in that country can be PAID by, as (scheme, value) pairs
 *   · which of those schemes we can honestly encode, and which we can only record
 *
 * It does NOT own three things, on purpose:
 *   1. THE GOVERNED FACTS PER REGION — currency, units, language, jurisdiction — which live in the `region_layer`
 *      TABLE and are read by lib/regional.js. Those are policy a platform operator can change; a table in code
 *      would be a second opinion that drifts from the one the platform actually enforces.
 *   2. FORMATTING — how a figure or a date is rendered. That is CBLocale (app/locale.js), which is ECMA-402 and
 *      CLDR, and knows far more about 200 locales than any list we would keep.
 *   3. TRANSLATION — which language a string is shown in. Region BOUNDS the languages offered (RFC 4647), but the
 *      choice is the reader's, and the strings are a catalogue, not a country fact.
 *
 * ⚠️ SO THE CAPABILITY IS THREE PARTS, NOT ONE FILE: this pure core · `region_layer` for what an operator governs ·
 * CBLocale for how it is rendered. Collapsing them would make the pure part un-shippable, because the moment it
 * needs a database it stops being usable in a product that has not got ours.
 */
(function (root) {

  /* ── ⭐ WHERE ───────────────────────────────────────────────────────────────────────────────────────────────── */

  /**
   * countryOf({ country, gstin, profile }) → 'IN' | null — ISO 3166-1 alpha-2, upper case.
   *
   * ⚠️ NOT A NEW RULE. lib/profile-map.js already declares this field and how to fill it:
   *     { key: 'country', layer: 'jurisdiction', why: 'the scheme (GST vs VAT-type) and the border for
   *       cross-border supply', derive: 'IN when a GSTIN exists' }
   * This honours that line. The order is: what was stated, then what can be derived, then the profile.
   *
   * ⚠️ UNKNOWN STAYS UNKNOWN. A party whose country cannot be established is never assumed into one — a
   * jurisdiction decides the tax scheme, so guessing it is worse than not knowing it. Every caller must be able to
   * tell "we do not know" from "we know it is India".
   */
  function countryOf(o) {
    o = o || {};
    var c = String(o.country == null ? '' : o.country).trim().toUpperCase();
    if (c.length === 2) return c;
    if (o.gstin && String(o.gstin).trim()) return 'IN';     /* profile-map: derive 'IN when a GSTIN exists' */
    var pc = o.profile && String(o.profile.country == null ? '' : o.profile.country).trim().toUpperCase();
    return (pc && pc.length === 2) ? pc : null;
  }

  /* ── ⭐⭐ HOW A PARTY CAN BE PAID ────────────────────────────────────────────────────────────────────────────── */

  /**
   * ⚠️ A PAYEE ADDRESS IS A (SCHEME, VALUE) PAIR, NOT A FIELD CALLED upi_id. This is the same decision the
   * jurisdiction work already made for identifiers — a GSTIN is not "the tax number", it is one scheme's value —
   * and a payee address has exactly the same problem: there is no universal one.
   *
   * ⚠️ TWO CATEGORIES THAT LOOK ALIKE AND ARE NOT:
   *   ACCOUNT-TO-ACCOUNT, MERCHANT-PRESENTED QR — the shop shows a code, the customer's app pushes money bank to
   *     bank, nothing passes through us, and the code can be generated OFFLINE from a string. Encodable.
   *   CARD RAILS — Apple Pay, Google Pay, contactless, a card terminal. The money moves through an acquirer, the
   *     shop needs a merchant account, and touching card data drags PCI scope in. NOT ours to generate: a till can
   *     only record that a terminal took it. Offering to "generate" one would be a promise we cannot keep.
   */
  var PAY_SCHEMES = {
    upi: {
      label: 'UPI', countries: ['IN'], encodes: 'upi-deeplink',
      why: 'NPCI deep link (upi://pay). India only; the customer scans with any UPI app and the money moves bank to bank.',
      valid: function (v) { return isPayeeHandle(v); },
    },
    /**
     * ⭐ THE ONE THAT UNLOCKS SIX COUNTRIES AT ONCE, when it is built. EMVCo published the merchant-presented QR
     * specification in 2017 precisely to stop every country inventing its own, and PIX (Brazil), PromptPay
     * (Thailand), DuitNow (Malaysia), PayNow (Singapore), BharatQR (India) and HKQR (Hong Kong) are all profiles
     * of it. It is declared here — and marked not-yet-encodable — so that adding it is a row's worth of work
     * rather than a second QR generator.
     */
    emvco: {
      label: 'QR', countries: null, encodes: null,
      why: 'EMVCo merchant-presented QR (TLV). PIX, PromptPay, DuitNow, PayNow, BharatQR and HKQR are profiles of it.',
      planned: true,
      valid: function () { return false; },
    },
  };

  /** ⚠️ RECORDED, NEVER GENERATED — kept here so the list of ways to be paid is ONE list, honestly labelled. */
  var PAY_RECORD_ONLY = {
    cash:   { label: 'Cash',   why: 'always, everywhere' },
    card:   { label: 'Card',   why: 'the terminal takes it; the till records that it did' },
    wallet: { label: 'Wallet', why: 'Apple Pay, Google Pay and the like ride a card rail through an acquirer' },
  };

  /**
   * ⚠️ Deliberately narrow: handle@provider, and nothing exotic. This value goes on a code a stranger scans and
   * sends money to — a permissive check on a payee address is not generosity.
   */
  function isPayeeHandle(v) {
    return !!v && /^[\w.\-]{2,}@[\w\-]{2,}$/.test(String(v));
  }

  /**
   * payWays({ country, payees }) → [{ id, label, qr, payee }]
   *
   * COUNTRY decides what is OFFERED. The declared PAYEES decide what can be DRAWN. Cash and card are unconditional
   * because a shop can always be handed notes and can always have a terminal.
   *
   * ⚠️ A SCHEME WITH NO PAYEE IS NOT OFFERED. A QR with no address in it is worse than no QR.
   * ⚠️ AN UNKNOWN COUNTRY FILTERS NOTHING, and that is deliberate: a shop that has written down a UPI id is telling
   * us it can take UPI, and hiding it because a column is empty would be the system overruling the shopkeeper.
   */
  function payWays(o) {
    o = o || {};
    var cc = String(o.country == null ? '' : o.country).trim().toUpperCase();
    var payees = o.payees || {};
    var out = [{ id: 'cash', label: PAY_RECORD_ONLY.cash.label, qr: null }];
    Object.keys(PAY_SCHEMES).forEach(function (id) {
      var s = PAY_SCHEMES[id];
      if (!s.encodes) return;                                   /* declared but not encodable yet — see emvco */
      if (s.countries && cc && s.countries.indexOf(cc) < 0) return;
      /**
       * ⚠️⚠️ VALIDATE WHAT WILL BE ENCODED, NOT WHAT WAS TYPED. This validated the raw value and trimmed only
       * when building the row — so a UPI id with a stray space, which is exactly what a copy-paste produces,
       * failed `valid()` and the scheme was DROPPED. Silently: the shop had given a perfectly good handle and
       * the counter simply did not offer UPI, with nothing anywhere saying why.
       * ⭐ Found 2026-09-11 by tests/jurisdiction.test.js, on its first run.
       */
      var v = payees[id] == null ? '' : String(payees[id]).trim();
      if (!v || !s.valid(v)) return;
      out.push({ id: id, label: s.label, qr: s.encodes, payee: v });
    });
    out.push({ id: 'card', label: PAY_RECORD_ONLY.card.label, qr: null });
    return out;
  }

  var API = {
    countryOf: countryOf,
    payWays: payWays,
    isPayeeHandle: isPayeeHandle,
    PAY_SCHEMES: PAY_SCHEMES,
    PAY_RECORD_ONLY: PAY_RECORD_ONLY,
  };

  root.CBJurisdiction = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : this);
