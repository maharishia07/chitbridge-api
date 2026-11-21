'use strict';
/**
 * lib/country-asks.js — THE SETUP QUESTIONS A COUNTRY'S PACK PUTS TO THE SHOP, and the answers kept per shop.
 * OWNER     cb-country
 * RISK      money
 * OWNS      the questions a country's pack puts to the shop AT SETUP, beyond the tax number (AE-F-03, Walk AE 21 Nov): which Emirate (region), which VAT period
 *           (period), inside a designated zone (zone), which legal form (form) — asksOf(pack), and the answers kept per shop (mergeAsked)
 * CALLED BY lib/country-setup.js (profile → asks · asked; save → particulars) · lib/books-period.js (the return reads the held answers)
 * FLOW      pack members (returns.emirates · returns.staggers · designatedZones · legalForms) → asksOf → the setup screen draws them → PUT /country-setup { particulars }
 *           → entity_governance.tax_registration.asked → the return reads them (a question on the return screen only overrides, never stores)
 * CARD      15-tax-and-country-packs/country-setup-and-country-lab
 * One home: entity_governance.tax_registration.asked (FIELDS.md: country-setup `asked`). The pack decides which questions exist — a pack with none of the
 * members asks nothing, and no country is named here.
 */
const KEYS = ['region', 'period', 'zone', 'form'];
const YES = 'yes';
const NO = 'no';
const refuse = (message) => Object.assign(new Error(message), { status: 400, code: 'COUNTRY_SETUP_BAD' });

/** the choices of a pack's staggers table: { 1: { first_month, tax_year_end, monthly? } } → [{ value, label }] in the pack's order */
function periodOptions_(staggers) {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return Object.keys(staggers || {}).map((key) => {
    const row = staggers[key] || {};
    const label = row.monthly ? 'Every month' : 'Every three months, from ' + (names[(Number(row.first_month) || 1) - 1] || '') + (row.tax_year_end ? ' (tax year ends ' + row.tax_year_end + ')' : '');
    return { value: String(key), label };
  });
}
/**
 * asksOf(pack) → [{ key, label, kind: 'choice', options: [{ value, label }], why }] — what this pack asks, in the order it asks.
 * `label` is the pack's own word (region: its words.region, e.g. Emirate · State).
 */
function asksOf(pack) {
  if (!pack) return [];
  const words = (require('./country').meta(pack) || {}).words || {};
  const returns = pack.returns || {};
  return [regionAsk(pack, returns, words), periodAsk(returns), zoneAsk(pack), formAsk(pack)].filter(Boolean);
}
/** the region question (Emirate · State): only when the pack lists regions */
function regionAsk(pack, returns, words) {
  const regions = returns.emirates || pack.emirates;
  if (!Array.isArray(regions) || !regions.length) return null;
  const region = words.region || 'Region';
  return { key: 'region', label: region, kind: 'choice', options: regions.map((r) => ({ value: String(r), label: String(r) })), why: 'The return is filed for the one ' + region.toLowerCase() + ' the shop trades from.' };
}
/** the return-period question: only when the pack has a staggers table */
function periodAsk(returns) {
  if (!returns.staggers || !Object.keys(returns.staggers).length) return null;
  return { key: 'period', label: 'Return period', kind: 'choice', options: periodOptions_(returns.staggers), why: 'The tax authority gave the shop one period pattern; the return follows it.' };
}
/** the designated-zone question: only when the pack has zones */
function zoneAsk(pack) {
  if (!pack.designatedZones) return null;
  return { key: 'zone', label: 'In a designated zone', kind: 'choice', options: [{ value: NO, label: 'No, mainland' }, { value: YES, label: 'Yes, inside a designated zone' }], why: 'Goods in a designated zone are treated outside the tax area.' };
}
/** the legal-form question: only when the pack lists forms (a string or { value, label }) */
function formAsk(pack) {
  if (!Array.isArray(pack.legalForms) || !pack.legalForms.length) return null;
  const options = pack.legalForms.map((f) => (typeof f === 'string' ? { value: f, label: f } : { value: String(f.value), label: String(f.label || f.value) }));
  return { key: 'form', label: 'Legal form', kind: 'choice', options, why: 'How the business is registered.' };
}
/** the held answers that still belong to this pack's questions: { region?, period?, zone?, form? } (an answer the pack no longer offers is not shown) */
function askedOf(held, pack) {
  const out = {};
  const source = held && typeof held === 'object' ? held : {};
  for (const question of asksOf(pack)) {
    const value = source[question.key];
    if (value != null && question.options.some((o) => o.value === String(value))) out[question.key] = String(value);
  }
  return out;
}
/**
 * mergeAsked(held, sent, pack) → the answers to keep. A MERGE-PATCH like the tax answer: an omitted key is unchanged, null or '' clears one, a value must be one
 * of the pack's options, a key the pack does not ask is refused by name (400, words). `sent` undefined → held (nothing written).
 */
function mergeAsked(held, sent, pack) {
  if (sent === undefined) return { asked: askedOf(held, pack), written: false };
  if (sent === null || typeof sent !== 'object' || Array.isArray(sent)) throw refuse('The setup answers are { region, period, zone, form }.');
  const asks = asksOf(pack);
  const out = askedOf(held, pack);
  for (const key of Object.keys(sent)) applyAnswer(out, asks, key, sent[key]);
  return { asked: out, written: true };
}
/** one sent answer into the kept set: '' clears it; a key the pack does not ask, or a value outside its options, is refused in words */
function applyAnswer(out, asks, key, sentValue) {
  if (KEYS.indexOf(key) < 0) throw refuse("The setup answers take region, period, zone and form, not '" + key + "'.");
  const value = sentValue == null ? '' : String(sentValue).trim();
  if (!value) {
    delete out[key];
    return;
  }
  const asked = asks.find((candidate) => candidate.key === key);
  if (!asked) throw refuse('This country does not ask for the ' + key + '.');
  const option = asked.options.find((o) => o.value.toLowerCase() === value.toLowerCase());
  if (!option) throw refuse(asked.label + ' is one of: ' + asked.options.map((o) => o.label).join('; ') + '.');
  out[key] = option.value;
}
/** the return reads the held answers as the query it would have been given: { emirate, stagger } — a query value the screen sends still wins */
function returnQueryOf(asked, query) {
  const base = {};
  if (asked && asked.region) base.emirate = asked.region;
  if (asked && asked.period) base.stagger = asked.period;
  const q = query || {};
  const out = Object.assign({}, q);
  for (const key of Object.keys(base)) if (q[key] == null || q[key] === '') out[key] = base[key];
  return out;
}
module.exports = { KEYS, asksOf, askedOf, mergeAsked, returnQueryOf };
