// @stage tested
// CALLED BY routes/chits.js   [sendSupplyKind — the step after sendCashStep]
// CARD      14-accounting/README
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
const { boundRead } = require('./bound-read'); /* SEC-198: the identities read runs under its own id's binding */
const CODE = 'SUPPLY_KIND_UNKNOWN';
const FIELD = 'business_json.invoice.ItemList';

/** the pack's one question for a 0% sale that names no kind: `returns.unknownKind` (a ledger-read return: AE, AU) else `tax.unknownKind` (India 1.1.0, whose returns read the frozen invoice); null when the pack asks none */
const unknownKindRowOf = (pack) => (pack && ((pack.returns && pack.returns.unknownKind) || (pack.tax && pack.tax.unknownKind))) || null;

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

/** takes the unknown kind off one line and notes the line number and the (cut) kind word in `lines` and `kinds` */
function takeOffLine(item, lineNo, named, lines, kinds) {
  lines.push(lineNo);
  kinds.push(String(named).trim().slice(0, 30));
  delete item.supply_kind;
  delete item.tax_kind;
}
/** the invoice's carried `_cb.kinds` rows that name an unknown kind are removed, and the list itself when none is left */
function dropUnknownCarried(invoice, unknown) {
  if (!invoice._cb || !Array.isArray(invoice._cb.kinds)) return;
  invoice._cb.kinds = invoice._cb.kinds.filter((entry) => !(entry && entry.kind && unknown(spell(entry.kind))));
  if (!invoice._cb.kinds.length) delete invoice._cb.kinds;
}
/**
 * withdrawUnknown(invoice, country) → null | { code, lines, kinds, why } — a PAID counter bill (offline, cash already taken) that names a kind the pack does not know is NEVER refused or
 * dropped (critic change 5): the kind is taken off its line and out of `_cb.kinds`, the bill posts as a 0% sale with no kind (so the return's needs_answer counts it), and the
 * answer says which line and which word. Mutates the invoice it is given (the send's own copy). No kind named, or all known → null and nothing touched.
 */
function withdrawUnknown(invoice, country) {
  if (!invoice || typeof invoice !== 'object') return null;
  const defined = kindsOf(country), unknown = (key) => defined.indexOf(key) < 0, lines = [], kinds = [];
  (invoice.ItemList || []).forEach((item, index) => {
    const named = item && (item.supply_kind || item.tax_kind);
    if (named && unknown(spell(named))) takeOffLine(item, index + 1, named, lines, kinds);
  });
  dropUnknownCarried(invoice, unknown);
  if (!lines.length) return null;
  /* the line keeps the rate the till sent: only a line that IS at 0% counts as "0% with no kind" (a 5% line stays a 5% sale, only the kind comes off) */
  const rateOf = (n) => { const item = (invoice.ItemList || [])[n - 1] || {}; return item.gst_rate !== undefined ? item.gst_rate : item.GstRt; };
  const atZero = lines.filter((n) => !rateIsNonZero(rateOf(n)));
  const tail = atZero.length === lines.length ? 'The bill is saved and counts as a sale at 0% with no kind until you say what it is.' : atZero.length ? 'The bill is saved; a line at 0% counts as a sale with no kind until you say what it is, and a line with a rate keeps that rate.' : 'The bill is saved and the line keeps its rate; only the kind came off.';
  return { code: CODE, lines, kinds, why: 'The kind "' + kinds[0] + '" is not one your tax rules know, so it was taken off line ' + lines[0] + (lines.length > 1 ? ' and ' + (lines.length - 1) + ' more' : '') + '. ' + tail };
}

/** a kind that is absent or only spaces: nothing to judge */
const isBlankKind = (kind) => kind === undefined || kind === null || String(kind).trim() === '';
/**
 * keepRefusal({ country, kind, rate }) → null | { code, kinds, why } — the catalogue door's check of a `tax_kind` stored beside a rate (AE-F-11, ACC-290). The kind must be a row of the shop
 * pack's own table (the table is the judge, never a literal here); a kind whose pack rate is 0 needs the rate 0 (a 5% line cannot be zero-rated); a kind with a rate needs that rate.
 * A blank kind is nothing to judge: there is NO default, a 0% with no kind stays unknown. NOT the supplier list's `supply_kind` (resale | own_use), NOT the India SupTyp (`inp.supplyKind`).
 */
function keepRefusal(input) {
  const named = input && input.kind;
  if (isBlankKind(named)) return null;
  const key = spell(named), pack = COUNTRY.packFor(input.country), table = pack && pack.tax && pack.tax.supplyKinds, defined = kindsOf(input.country);
  const sentence = (why) => ({ code: CODE, kinds: defined, why });
  if (!table || !Object.prototype.hasOwnProperty.call(table, key))
    return sentence('"' + String(named).trim().slice(0, 30) + '" is not a supply kind your tax rules know. ' + (defined.length ? 'The kinds here are ' + defined.join(', ') + '.' : 'Your tax rules name no supply kinds, so none can be set.'));
  const mismatch = rateMismatch(table[key], key, input.rate);
  return mismatch ? sentence(mismatch) : null;
}
/** the words for a rate that is not the one the kind means, or null when the rate is absent or agrees */
function rateMismatch(row, key, given) {
  const rate = given === undefined || given === null || given === '' ? null : Number(given);
  if (rate !== null && Number.isFinite(rate) && rate !== Number(row.rate)) return (row.short || row.name || key) + ' means a rate of ' + row.rate + '%, not ' + rate + '%. Change the rate or the kind.';
  return null;
}

/**
 * kindWordsFor(entity_id, kind, rate) → null | the sentence — keepRefusal over the SHOP's own country (identities.country, else its tax number: lib/profile.countryOf, the one reader; the same read
 * chit-proposal.countryOf makes, which a later round lifts into this one). The catalogue doors (slab POST / PUT, item write) call it; a blank kind is nothing to judge.
 */
async function kindWordsFor(entity_id, kind, rate) {
  if (isBlankKind(kind)) return null;
  const found = await boundRead(require('../db').query, entity_id, 'SELECT country, gstn FROM identities WHERE identity_id = $1', [entity_id]);
  const row = found.rows[0] || {};
  const refusal = keepRefusal({ country: require('./profile').countryOf({ country: row.country, gstin: row.gstn }), kind, rate });
  return refusal ? refusal.why : null;
}

/* words that doubt a name: no kind is suggested from it (a question mark, check, unsure, maybe, tbc, confirm) */
const UNSURE = /[?]|(^|[^a-z])(check|unsure|not sure|maybe|perhaps|tbc|tbd|confirm)([^a-z]|$)/;
/** is the kind word negated? a negation anywhere earlier in the SAME clause ("Not currently zero-rated", "No longer exempt", "isn't exempt"), or a prefix stuck to the word ("non-exempt", "unexempt"); a comma, semicolon, colon, dash, slash or bracket starts a new clause */
function negated(before) {
  const clause = before.split(/[,;:()/]| [-–—] /).pop();
  return /(^|[^a-z])(not|non|no|never|nor|neither|without|isnt|isn't|arent|aren't|cannot|cant|can't|wasnt|wasn't)([^a-z]|$)/.test(clause) || /(^|[^a-z])(non|un)[ -]?$/.test(before);
}

/** does the text carry the kind word (matcher is its global word-bounded regex) at least once without a negation before it? */
function namesKindAffirmed(text, matcher) {
  let at, any = false;
  while ((at = matcher.exec(text))) {
    if (!negated(text.slice(0, at.index + at[1].length))) any = true;
  }
  return any;
}

/**
 * suggestFromName(name, country) → the kind id the slab's OWN NAME says, or null. A SUGGESTION only (the owner confirms each one by its own tap; nothing is saved or posted from it).
 * Rule (critic change 6): the whole `short` or `name` of exactly ONE rate-0 kind of the shop pack, word-bounded, case-folded, not negated ("not", "non", "un" before it) and
 * not beside the word of another kind. "VAT 0% zero-rated" gives zero_rated; "Not zero-rated", "Non-exempt 0%", "Zero-rated or exempt", "Free sample 0%", "Tax free delivery",
 * "Exempted" and "Unexempt" give null. Hostile names are fixtures in tests/supply-kind-door.test.cjs.
 */
function suggestFromName(name, country) {
  const pack = COUNTRY.packFor(country), table = pack && pack.tax && pack.tax.supplyKinds;
  if (!table || typeof name !== 'string') return null;
  const text = name.toLowerCase().replace(/\s+/g, ' ').trim();
  if (UNSURE.test(text)) return null;
  const words = (row) => [row.short, row.name].filter(Boolean).map((word) => String(word).toLowerCase());
  const bounded = (word) => new RegExp('(^|[^a-z0-9])' + word.replace(/[^a-z -]/g, '') + '(?![a-z0-9])', 'g'); /* the pack's kind words are letters, spaces and hyphens only */
  const found = [];
  Object.keys(table).forEach((id) => {
    if (Number(table[id].rate) !== 0) return;
    if (words(table[id]).some((word) => namesKindAffirmed(text, bounded(word)))) found.push(id);
  });
  return found.length === 1 ? found[0] : null;
}

/**
 * RATE CHANGE CLEARS THE KIND (EGM-T1, 21 Nov): a supply kind answers WHY a line is at 0%, so it applies only at rate 0. A write that leaves a non-zero rate on the record drops the kind the
 * record held for the old rate (it would otherwise force the line back to 0%: AED 100 tea billed at VAT 0.00 after the owner tapped 5%). The ONE reader of that rule; the item PATCH and the
 * one product writer (catalogue-write.patchItems) both call it. A kind the write itself SETS is not touched here (the door judges that one, kindRefusal).
 */
const rateIsNonZero = (rate) => rate !== undefined && rate !== null && String(rate).trim() !== '' && Number.isFinite(Number(rate)) && Number(rate) !== 0;
/** dropStaleKind(record, sent) → the record without its `tax_kind` when its rate is non-zero and `sent` (the body of this write) names no kind; else the record itself */
function dropStaleKind(record, sent) {
  if (!record || typeof record !== 'object' || !('tax_kind' in record) || !rateIsNonZero(record.gst_rate)) return record;
  if (sent && sent.tax_kind !== undefined && sent.tax_kind !== null) return record;
  const out = Object.assign({}, record);
  delete out.tax_kind;
  return out;
}
/** nullStaleKind(patch) → a merge patch that also unsets the kind when it sets a non-zero rate and names no kind (`||` cannot delete a key: a null kind reads as none everywhere) */
function nullStaleKind(patch) {
  if (!patch || typeof patch !== 'object' || !rateIsNonZero(patch.gst_rate) || patch.tax_kind !== undefined) return patch;
  return Object.assign({}, patch, { tax_kind: null });
}

module.exports = { dropStaleKind, nullStaleKind, rateIsNonZero, unknownKindRowOf, refusalOf, withdrawUnknown, kindsOf, namedIn, keepRefusal, kindWordsFor, suggestFromName, CODE };
