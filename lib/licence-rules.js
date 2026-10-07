'use strict';
/**
 * licence-rules.js — N19: the words and bands for a licence, as DATA keyed by country (Q8, FIT-shell-enterprise 2026-10-07).
 *
 * The header (GET /api/entities/header) shows what `entity_compliance` HOLDS. This file says three things about a held scheme and
 * nothing else: which scheme it is (match), how its days-left falls into a band, and the one sentence that follows a lapse.
 * Which licences are CORE comes from the shop's VERTICAL (CORE_BY_VERTICAL, the lotfields pattern: data per sector).
 *
 * ⚠️ NOTHING HERE IS CITED YET. Every rule carries `verified:false` and an empty `source`; the header passes that flag on, so a
 * screen can say "to be confirmed". A rule becomes `verified:true` only when `source` names a document and the clause was READ
 * (FSSAI Licensing & Registration Regulations 2011 names a late fee — what it is, and the day it starts, are not written down here
 * from memory). The late-fee sentence therefore carries NO amount and NO start day.
 * ⚠️ A licence with no rule gets days only: band null, note null — never a penalty.
 *
 * Bands (the shell's, shell-instruction.md): ok > bands.due days · due 91..120 · soon 0..90 · gone expired. `bands` are the upper
 * limits in days; a rule may move them.
 */
const DEFAULT_BANDS = { due: 120, soon: 90 };

const RULES = {
  IN: {
    schemes: [
      { scheme: 'FSSAI', match: /fssai|foscos|food.?safety/i, label: 'FSSAI licence', bands: DEFAULT_BANDS,
        renew_url: 'https://foscos.fssai.gov.in/',
        fee: { when: ['gone'], text: 'A late fee is charged for each day after the expiry date. Check the amount with FSSAI before you renew.' },
        verified: false, source: '' },
      { scheme: 'DRUG', match: /drug|pharmacy|cdsco/i, label: 'Drug licence', bands: DEFAULT_BANDS,
        renew_url: null, fee: null, verified: false, source: '' },
      { scheme: 'SHOP', match: /shop.?(and|&)?.?establish|shops.?act|trade.?licen/i, label: 'Shop licence', bands: DEFAULT_BANDS,
        renew_url: null, fee: null, verified: false, source: '' },
    ],
    /* the pack key from lib/lotfields.packFor(sectors) -> the schemes the shop is expected to hold. No pack, none core. */
    core_by_vertical: { food: ['FSSAI'], pharma: ['DRUG'] },
  },
};
const rulesFor = (country) => RULES[String(country || 'IN').toUpperCase()] || RULES.IN;

/** the rule for a held row: matched on its standard_key and doc_key together. null when none matches. */
function ruleFor(country, standard_key, doc_key) {
  const text = String(standard_key || '') + ' ' + String(doc_key || '');
  return rulesFor(country).schemes.find((r) => r.match.test(text)) || null;
}
const coreSchemes = (country, vertical) => (rulesFor(country).core_by_vertical[vertical] || []).slice();

/** band for a days-left under a rule. No rule or no date -> null. */
function bandOf(rule, days) {
  if (!rule || days == null) return null;
  if (days < 0) return 'gone';
  const b = rule.bands || DEFAULT_BANDS;
  return days <= b.soon ? 'soon' : days <= b.due ? 'due' : 'ok';
}
/** the sentence after a lapse, only where the rule says it applies to this band. null otherwise. */
const noteOf = (rule, band) => (rule && rule.fee && band && rule.fee.when.includes(band)) ? rule.fee.text : null;

module.exports = { RULES, DEFAULT_BANDS, rulesFor, ruleFor, coreSchemes, bandOf, noteOf };
