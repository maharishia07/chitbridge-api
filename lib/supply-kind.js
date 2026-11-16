// @stage tested
// CALLED BY routes/chits.js   [sendSupplyKind — the step after sendCashStep]
// @stage-note ACC-new-2 (l16-accfix): a carried invoice that names a supply kind the shop's pack does not define is refused, never posted to plain sales.
'use strict';
/**
 * supply-kind.js — A SUPPLY KIND THE SHOP'S PACK DOES NOT DEFINE IS REFUSED (ACC-new-2, e2e money test 16 Nov: an AE shop sent AU's `gst_free`;
 * the books posted it to plain Sales with no VAT and VAT201 box 1 carried it — silence is the bug).
 *
 * OWNS      the server's one check of the kinds a counter bill's invoice names against the shop pack's `tax.supplyKinds` table (reg-au taxable · gst_free ·
 *           input_taxed; reg-ae standard · zero_rated · exempt). A kind is read where the tax engine reads it: a line's `supply_kind` / `tax_kind`
 *           and `_cb.kinds[].kind`; spelled as the engine spells it (trim · lower case · "-" as "_"). A pack with NO table (India) defines no kind, so any
 *           named kind is refused too (the engine would ignore it and bill at the line's own rate, the same silence). No kind named → nothing.
 *           422 SUPPLY_KIND_UNKNOWN, the line and the kinds the pack defines in the words. Nothing is decided here: the table is the pack's.
 * CALLED BY routes/chits.js sendSupplyKind (outside any fail-open try: a refusal must reach the counter)
 * FLOW      invoice.ItemList[].supply_kind|tax_kind + invoice._cb.kinds[] + the shop's country ──▶ country.packFor ──▶ tax.supplyKinds ──▶ null | { code, line, kind, kinds, why }
 */
const COUNTRY = require('./country');
const CODE = 'SUPPLY_KIND_UNKNOWN';
const FIELD = 'business_json.invoice.ItemList';

/** the engine's own spelling of a named kind (lib/tax.js: trim, lower case, "-" → "_") */
const spell = (named) => String(named).trim().toLowerCase().replace(/-/g, '_');

/** the kinds the shop's pack defines, in the pack's order: [] when the country has no pack or no table (never India's, never a guess) */
function kindsOf(country) {
  const pack = COUNTRY.packFor(country);
  const table = pack && pack.tax && pack.tax.supplyKinds && typeof pack.tax.supplyKinds === 'object' ? pack.tax.supplyKinds : null;
  return table ? Object.keys(table) : [];
}

/** the kinds an invoice names, each once: [{ line (1-based, 0 = _cb.kinds only), named, key }] */
function namedIn(invoice) {
  const out = [];
  ((invoice && invoice.ItemList) || []).forEach((item, index) => {
    const named = item && (item.supply_kind || item.tax_kind);
    if (named) out.push({ line: index + 1, named: String(named).trim().slice(0, 30), key: spell(named) });
  });
  (((invoice && invoice._cb && invoice._cb.kinds) || [])).forEach((entry) => {
    if (entry && entry.kind) out.push({ line: Number.isFinite(Number(entry.line)) ? Number(entry.line) + 1 : 0, named: String(entry.kind).trim().slice(0, 30), key: spell(entry.kind) });
  });
  return out;
}

/**
 * refusalOf({ country, business_json }) → null | { code, field, line, kind, kinds, why }
 * Only the FIRST unknown kind is named; the counter fixes it and sends again.
 */
function refusalOf(input) {
  const invoice = input && input.business_json && input.business_json.invoice;
  if (!invoice || typeof invoice !== 'object') return null;
  const defined = kindsOf(input.country),
    bad = namedIn(invoice).find((item) => defined.indexOf(item.key) < 0);
  if (!bad) return null;
  const where = bad.line ? 'Line ' + bad.line + ': ' : '';
  const list = defined.length ? 'The kinds here are ' + defined.join(', ') + '.' : 'Your tax rules name no supply kinds, so none can be set on a line.';
  return { code: CODE, field: FIELD, line: bad.line || null, kind: bad.named, kinds: defined, why: where + '"' + bad.named + '" is not a supply kind your tax rules know. ' + list + ' The bill was not saved: ' + (defined.length ? 'pick one of them' : 'take it off the line') + ' and send it again.' };
}

module.exports = { refusalOf, kindsOf, namedIn, CODE };
