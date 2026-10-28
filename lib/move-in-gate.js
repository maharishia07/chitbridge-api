// @stage tested
// @stage-note [BOOKS · MOVE IN · COUNTRY GATE] the books moved in must be from the shop's own country, read through the shop's own pack — else
// @stage-note the WHOLE import is refused with one sentence and a code (DECISIONS 2026-10-18:62 · :70; move-in W1.1 · W1.1b · W1.4).
'use strict';
/**
 * lib/move-in-gate.js — THE COUNTRY GATE OF A MOVE-IN (MOVE-IN-GAPS-REQUIREMENT W1.1 · W1.1b · W1.4, 2026-10-18).
 * OWNS      gate(): the shop's pack + its move-in map through engines country.moveInFor (never a fallback pack, never India for an unknown) ·
 *           the stated / read source country against it · foreign(): a file's tax codes or tax IDs that belong to another country
 *           (engines country.fingerprint) · company(): one source company per shop and source (their company id) ·
 *           W1.11 the lanes that carry NO tax (NO_TAX_KINDS) for a pack with no map that says so (moveInFor().noTax, engines v1.68.0) ·
 *           taxBearing(): the one test of "this row carries tax" (TAX_FIELDS) · notReady(): the not-ready sentence, refused or held
 * CALLED BY lib/move-in.js plan() — first, before any row is read, for every kind
 * CARD      14-accounting/move-in-from-xero-quickbooks · 23-connectors-and-integrations/xero-quickbooks-myob
 * FLOW      plan(kind, inp) → gate(inp) → company(gate, inp) → foreign(gate, kind, rows) → the planner, handed gate.map
 * ⭐ Every refusal is a thrown { refused, code, status 422 } — routes/books.js fail() answers 422 with the code and the sentence. Nothing is half-done:
 *    the gate runs before the first row, so a refused import has 0 rows planned and 0 written.
 *   MOVE_IN_COUNTRY            the shop has no pack, its pack has no move-in map (W1.11: a no-tax lane of a pack that allows it passes), or the source
 *                              company is from another country
 *   MOVE_IN_COUNTRY_UNSTATED   a file with no stated country (the owner must say it)
 *   MOVE_IN_COUNTRY_WORD       a country given as a word, not its two-letter code (W2.3 will read words; until then, never guessed)
 *   MOVE_IN_FOREIGN            the file carries another country's tax code or tax ID
 *   MOVE_IN_COMPANY            a second, different source company for the same shop and system
 */
const country = require('./country');

const STATUS = 422;
const COUNTRY_HOW = ['stated', 'read']; /* the owner said it (a file) · we read it from their system (a connection) */
const TWO_LETTERS = /^[A-Za-z]{2}$/;
const NOTHING = ' Nothing was imported.';

/** a refusal of the whole import: a sentence, a code, 422 */
function refusal(sentence, code) {
  const error = new Error(sentence);
  error.refused = true;
  error.code = code;
  error.status = STATUS;
  return error;
}
const nameOf = (code) => require('./country-setup').nameOf(code);
const trimmed = (value) => String(value == null ? '' : value).trim();

/** W1.11 (DECISIONS 2026-10-18:83): the lanes that carry NO tax — a pack with no map whose engines answer says noTax takes these; every other lane
 *  (bills · trial balance · chart) stays refused. Contacts carry no tax code; an item does only through TAX_FIELDS, and such an item is HELD. */
const NO_TAX_KINDS = ['contacts', 'items'];
/** the sentence when a country's pack has no move-in map — the whole file refused, or one taxed row held */
const notReady = (id) => 'Moving books in is not ready for ' + nameOf(id) + ' yet — its tax codes have no map here.';
/** the shop's own pack and map — refused when the pack is missing (C1), or the map is and this lane carries tax (C2 · W1.11) */
function shopRules_(shopCode, kind) {
  const rules = country.moveInFor(trimmed(shopCode).toUpperCase());
  if (!rules.pack) throw refusal('This shop has no country we hold rules for, so books cannot be moved in.' + NOTHING, 'MOVE_IN_COUNTRY');
  const noTaxLane = rules.noTax === true && NO_TAX_KINDS.indexOf(kind) >= 0;
  if (!rules.map && !noTaxLane) throw refusal(notReady(rules.id) + NOTHING, 'MOVE_IN_COUNTRY');
  return rules;
}
/** the source's country, as stated or read → its two-letter code, or a refusal in words */
function sourceCode_(stated, shopId) {
  const given = trimmed(stated);
  if (!given) throw refusal('Say which country these books are from — they must be from ' + nameOf(shopId) + '.' + NOTHING, 'MOVE_IN_COUNTRY_UNSTATED');
  if (!TWO_LETTERS.test(given))
    throw refusal(
      'Give the country as its two-letter code (' + shopId + ' for ' + nameOf(shopId) + '), not "' + given.slice(0, 40) + '".' + NOTHING,
      'MOVE_IN_COUNTRY_WORD'
    );
  return given.toUpperCase();
}

/**
 * gate({ country, source_country, country_how, kind }) → { id, pack, map, source_country, country_how } — or throws a refusal.
 * `country` is the SHOP's (books_setting.country), never a pack's id (accounts-packs falls back to India for an unknown country).
 * map is null only on a no-tax lane (W1.11): the planner then holds every row that is taxBearing().
 */
function gate(input) {
  const rules = shopRules_(input.country, input.kind);
  const theirs = sourceCode_(input.source_country, rules.id);
  if (theirs !== rules.id) {
    throw refusal(
      'These books are from ' +
        nameOf(theirs) +
        ' and this shop is in ' +
        nameOf(rules.id) +
        ". A country's tax rules must match exactly, so nothing can be moved across." +
        NOTHING,
      'MOVE_IN_COUNTRY'
    );
  }
  const howKnown = COUNTRY_HOW.indexOf(input.country_how) >= 0 ? input.country_how : 'stated';
  return { id: rules.id, pack: rules.pack, map: rules.map, source_country: theirs, country_how: howKnown };
}

/** the columns each kind carries its tax codes and tax IDs in */
const CODE_COLUMNS = { accounts: ['tax_code'], items: ['sales_tax', 'purchase_tax'], open_bills: [], contacts: [] };
const ID_COLUMNS = { contacts: ['abn'] };
/** the columns that make a row carry TAX (W1.11): its tax codes, and an item's HSN / SAC (the IN rate follows it) */
const TAX_FIELDS = { items: CODE_COLUMNS.items.concat(['hsn']) };
/** taxBearing(kind, row) → true when any of the kind's tax fields is filled */
const taxBearing = (kind, row) => (TAX_FIELDS[kind] || []).some((column) => trimmed(row && row[column]) !== '');
/** the file's tax codes and tax IDs, by kind (an open bill lists its lines' codes in one cell, split by ";") */
function wordsOf_(kind, rows) {
  const codes = [],
    taxIds = [];
  const keep = (list, value) => {
    const word = trimmed(value);
    if (word) list.push(word);
  };
  for (const row of rows || []) {
    (CODE_COLUMNS[kind] || []).forEach((column) => keep(codes, row[column]));
    (ID_COLUMNS[kind] || []).forEach((column) => keep(taxIds, row[column]));
    if (kind === 'open_bills')
      String(row.tax_codes || '')
        .split(';')
        .forEach((code) => keep(codes, code));
  }
  return { codes, taxIds };
}
/** foreign(rules, kind, source, rows) — the whole file refused when it carries another country's tax code or tax ID (C3) */
function foreign(rules, kind, source, rows) {
  const words = wordsOf_(kind, rows);
  const marks = country.fingerprint(rules.id, { source, codes: words.codes, taxIds: words.taxIds });
  const found = marks.codes[0] || marks.taxIds[0];
  if (!found) return;
  const what = marks.codes[0] ? 'tax code' : 'tax ID';
  throw refusal(
    '"' +
      found.value +
      '" is a ' +
      what +
      ' of ' +
      found.packs.map(nameOf).join(', ') +
      ', not of ' +
      nameOf(rules.id) +
      ' — this file belongs to another country.' +
      NOTHING,
    'MOVE_IN_FOREIGN'
  );
}

/** company(source_company, companies) — one source company per shop and system (W1.4): a different one already moved in → refused */
function company(sourceCompany, companies) {
  const mine = trimmed(sourceCompany);
  if (!mine) return null;
  const other = (companies || []).map(String).find((known) => known && known !== mine);
  if (other)
    throw refusal(
      'This shop already moved books in from another company (' + other.slice(0, 40) + '). One shop takes one company.' + NOTHING,
      'MOVE_IN_COMPANY'
    );
  return mine.slice(0, 80);
}

module.exports = { gate, foreign, company, refusal, taxBearing, notReady, COUNTRY_HOW, NO_TAX_KINDS };
