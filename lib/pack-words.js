'use strict';
// lib/pack-words.js — THE WORDS A SCREEN SAYS FOR A SHOP'S COUNTRY (AU-WORDS, 2026-10-15).
// OWNS  the country pack's words the engines packs do not carry yet: the tax's name (GST · VAT), the registration kinds a shop may
//       choose and their words, the trade-ready check list, the return's short name, the records floor in words.
// CALLED BY lib/sides.js (the Filings row · the impact box) · lib/entity-header.js (trade_ready.checks) · lib/policy.js (schemaFor: the
//       Policy › registration row and the expiry / retention words) · routes/entities.js PATCH /policy (a kind the pack does not offer).
// FLOW  wordsFor(country | pack) → the pack (regulation.packFor) → pack.words / pack.tax.registrationKinds when the engines carry them
//       → else the table here by pack id → NO pack: neutral words (never India's)
// CARD 15-tax-and-country-packs/pack-words
/**
 * Athi on live austore1 (AU), 15 Oct: Home said "Name your GSTIN", Policy offered REGULAR · COMPOSITION · SEZ, the sheet asked for a PAN.
 * Each read India's words directly. Rule: country first, no national default — a screen asks the shop's PACK, through ONE reader.
 *
 * ⭐ REUSE, NOT A SECOND PATH
 *   the tax-id word      profile.taxIdWordOf — the ONE reader (GSTIN · ABN · TRN; null with no pack). Never a second table of it here.
 *   the thresholds       the pack's own numbers (reg-au tax.registration.turnover_minor · reg-ae tax.registration.mandatory_minor) — never typed.
 *   the return's name    the pack's `returns.short` (BAS · VAT return); India's pack states none, the table says GSTR-3B.
 *   the records floor    the pack's `retentionYears` (the primitive W2-BOOKS books-pack.retentionOf reads) and policy.RECORDS_FLOOR_YEARS.
 *
 * ⚠️ THE STORED ENUM NEVER CHANGES. policy.FLAGS.gst_registration keeps regular · composition · unregistered · sez (tax.js regOf, tax-lines,
 * the till branch on them). A pack says which of those it OFFERS and what each is called. "GST-free" is a SUPPLY kind (reg-au supplyKinds),
 * decided per line by the tax engine — not a registration; the AU help says so.
 *
 * ENGINES WIDENING ASKED FOR (serial, not this round): reg-*.js `words: { taxName, registration, returnShort }`, `tax.registrationKinds[]`,
 * `checks.tradeReady[]` — read FIRST below, so the table here retires with no api change.
 */
const log = require('./logger');

const NO_PACK_WORDS = Object.freeze({ taxName: 'Tax', taxId: 'Tax number', registration: 'Tax registration', returnShort: null });
const CHECK_LABELS = Object.freeze({ address: 'Address proven', phone: 'Phone verified', pan: 'PAN on file', trade_licence: 'Trade licence' });
const CHECKS_DEFAULT = Object.freeze(['address', 'phone', 'tax_id']);

/* what each pack OFFERS of the stored enum, in the order shown; `help` is one shopkeeper sentence per kind. {threshold} is the pack's number. */
const KINDS_BY_PACK = Object.freeze({
  IN: [
    { key: 'regular', label: 'Regular', help: 'Charges GST and claims input credit (a GSTIN on the profile).' },
    { key: 'composition', label: 'Composition', help: 'A flat % on turnover: no GST on your invoices, no credit; your slip is a bill of supply.' },
    { key: 'unregistered', label: 'Unregistered (no GSTIN)', help: 'No GSTIN: you buy as a consumer and charge nothing.' },
    { key: 'sez', label: 'SEZ', help: 'Supplies to you are zero-rated under LUT.' }
  ],
  AU: [
    {
      key: 'regular',
      label: 'GST registered',
      help: 'Charges 10% GST on taxable sales, claims input tax credits, lodges a BAS. GST-free items (fresh food, health) are set on the item, not here.'
    },
    { key: 'unregistered', label: 'Not registered', help: 'GST turnover under {threshold}: no GST on your invoices, no credits.' }
  ],
  AE: [
    { key: 'regular', label: 'VAT registered', help: 'Charges 5% VAT, recovers input tax, files the VAT return with the FTA.' },
    { key: 'unregistered', label: 'Not registered', help: 'Taxable supplies under {threshold} in twelve months: no VAT on your invoices, no input tax.' }
  ]
});
const WORDS_BY_PACK = Object.freeze({
  IN: { taxName: 'GST', registration: 'GST registration', returnShort: 'GSTR-3B', checks: ['address', 'phone', 'pan', 'tax_id'] },
  AU: { taxName: 'GST', registration: 'GST registration', checks: CHECKS_DEFAULT },
  AE: { taxName: 'VAT', registration: 'VAT registration', checks: ['address', 'phone', 'tax_id', 'trade_licence'] }
});
/* with no pack, or a pack with no kinds: registered or not, in neutral words */
const KINDS_NO_PACK = Object.freeze([
  { key: 'regular', label: 'Registered for tax', help: 'Charges tax on your sales and claims it back on what you buy.' },
  { key: 'unregistered', label: 'Not registered', help: 'No tax on your invoices, nothing claimed back.' }
]);

/** the first of these words that is set (the pack's own, then the table's, then the neutral one); the last when none is */
function firstSet(...candidates) {
  return candidates.reduce((found, word) => found || word);
}

/** the pack for a country code, or the pack handed in; null with no country or no pack (never India's for an unstated country) */
function packOf(countryOrPack) {
  if (countryOrPack && typeof countryOrPack === 'object') return countryOrPack;
  const code = String(countryOrPack || '')
    .trim()
    .toUpperCase();
  if (!code) return null;
  try {
    return require('./regulation').packFor(code) || null;
  } catch (e) {
    log.fellBack('pack-words: no pack for ' + code + ' — answered with neutral words', e);
    return null;
  }
}

/** a minor-unit threshold in the pack's money as words: 7500000 AUD → "AUD 75,000" (the pack's number, never typed) */
function thresholdWords(pack) {
  const registration = pack && pack.tax && pack.tax.registration;
  const minor = registration && (registration.turnover_minor || registration.mandatory_minor);
  if (!minor || !pack.currency) return null;
  return pack.currency + ' ' + Math.round(minor / 100).toLocaleString('en');
}

/** the kinds a pack offers of the stored enum: the pack's own list first (engines widening), else the table, else neutral */
function registrationKindsFor(countryOrPack) {
  const pack = packOf(countryOrPack);
  const ownKinds = pack && pack.tax && Array.isArray(pack.tax.registrationKinds) ? pack.tax.registrationKinds : null;
  const kinds = ownKinds || (pack && KINDS_BY_PACK[pack.id]) || KINDS_NO_PACK;
  const threshold = thresholdWords(pack) || 'the registration threshold';
  return kinds.map((kind) => ({ key: kind.key, label: kind.label, help: String(kind.help || '').replace('{threshold}', threshold) }));
}

/** the trade-ready checks a pack asks for, as { key, label } in order: the tax id's label is the pack's own word */
function tradeChecksFor(countryOrPack) {
  const pack = packOf(countryOrPack);
  const words = wordsFor(pack);
  const ownChecks = pack && pack.checks && Array.isArray(pack.checks.tradeReady) ? pack.checks.tradeReady : null;
  const keys = ownChecks || (pack && WORDS_BY_PACK[pack.id] && WORDS_BY_PACK[pack.id].checks) || CHECKS_DEFAULT;
  return keys.map((key) => ({ key, label: key === 'tax_id' ? words.taxId : CHECK_LABELS[key] || key }));
}

/** the records floor in words: the pack's retentionYears ("keep 5 years — Australia") else the platform's floor (policy.RECORDS_FLOOR_YEARS) */
function retentionWordsFor(countryOrPack) {
  const pack = packOf(countryOrPack);
  const years = pack && typeof pack.retentionYears === 'number' && pack.retentionYears > 0 ? pack.retentionYears : null;
  const floor = require('./policy').RECORDS_FLOOR_YEARS;
  if (years) return { years, words: 'Keep — the law here asks ' + years + ' years' };
  return { years: floor, words: 'Keep — at least ' + floor + ' years' };
}

/** the pack's own short name for its return (returns.short), or null */
function returnsShortOf(pack) {
  return pack && pack.returns && pack.returns.short ? String(pack.returns.short) : null;
}

/**
 * wordsFor(country | pack) → { country, hasPack, taxName, taxId, registration, returnShort, currency }: the pack's own `words` first,
 * then the table, then neutral words. The tax id is profile.taxIdWordOf's answer — the one reader — "Tax number" when it names none.
 */
function wordsFor(countryOrPack) {
  const pack = packOf(countryOrPack);
  const packWords = (pack && pack.words) || {};
  const table = (pack && WORDS_BY_PACK[pack.id]) || {};
  const fromReturns = returnsShortOf(pack);
  return {
    country: pack ? pack.id : null,
    hasPack: !!pack,
    taxName: firstSet(packWords.taxName, table.taxName, NO_PACK_WORDS.taxName),
    taxId: require('./profile').taxIdWordOf(pack) || NO_PACK_WORDS.taxId,
    registration: firstSet(packWords.registration, table.registration, NO_PACK_WORDS.registration),
    returnShort: firstSet(packWords.returnShort, fromReturns, table.returnShort, NO_PACK_WORDS.returnShort),
    currency: pack ? pack.currency : null
  };
}

module.exports = { wordsFor, registrationKindsFor, tradeChecksFor, retentionWordsFor, thresholdWords, CHECK_LABELS };
