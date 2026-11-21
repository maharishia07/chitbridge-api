'use strict';
/**
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
  const out = [];
  const words = (require('./country').meta(pack) || {}).words || {};
  const returns = pack.returns || {};
  const regions = returns.emirates || pack.emirates;
  if (Array.isArray(regions) && regions.length)
    out.push({ key: 'region', label: words.region || 'Region', kind: 'choice', options: regions.map((r) => ({ value: String(r), label: String(r) })), why: 'The return is filed for the one ' + (words.region || 'region').toLowerCase() + ' the shop trades from.' });
  if (returns.staggers && Object.keys(returns.staggers).length)
    out.push({ key: 'period', label: 'Return period', kind: 'choice', options: periodOptions_(returns.staggers), why: 'The tax authority gave the shop one period pattern; the return follows it.' });
  if (pack.designatedZones)
    out.push({ key: 'zone', label: 'In a designated zone', kind: 'choice', options: [{ value: NO, label: 'No, mainland' }, { value: YES, label: 'Yes, inside a designated zone' }], why: 'Goods in a designated zone are treated outside the tax area.' });
  if (Array.isArray(pack.legalForms) && pack.legalForms.length)
    out.push({ key: 'form', label: 'Legal form', kind: 'choice', options: pack.legalForms.map((f) => (typeof f === 'string' ? { value: f, label: f } : { value: String(f.value), label: String(f.label || f.value) })), why: 'How the business is registered.' });
  return out;
}
/** the held answers that still belong to this pack's questions: { region?, period?, zone?, form? } (an answer the pack no longer offers is not shown) */
function askedOf(held, pack) {
  const out = {};
  const source = held && typeof held === 'object' ? held : {};
  for (const ask of asksOf(pack)) {
    const value = source[ask.key];
    if (value != null && ask.options.some((o) => o.value === String(value))) out[ask.key] = String(value);
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
  for (const key of Object.keys(sent)) {
    if (KEYS.indexOf(key) < 0) throw refuse("The setup answers take region, period, zone and form, not '" + key + "'.");
    const ask = asks.find((a) => a.key === key);
    const value = sent[key] == null ? '' : String(sent[key]).trim();
    if (!value) {
      delete out[key];
      continue;
    }
    if (!ask) throw refuse('This country does not ask for the ' + key + '.');
    const option = ask.options.find((o) => o.value.toLowerCase() === value.toLowerCase());
    if (!option) throw refuse(ask.label + ' is one of: ' + ask.options.map((o) => o.label).join('; ') + '.');
    out[key] = option.value;
  }
  return { asked: out, written: true };
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
