// @stage tested
'use strict';
/**
 * rcm-lines.js — THE ONE RESOLVER of "is this bill line under reverse charge?" (AQ-F-01, fixAQ 1129).
 *
 * OWNS      resolve (the lines, each given the category its words and the pack's list decide; the notes; the refusals) · refusalOf (the 422 in words).
 * OWNER     cb-accounting
 * CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
 * CALLED BY lib/tax-lines.js invoiceFor (one call, before the engine) · lib/send-money.js (throws the refusals; a door that only READS an old chit never refuses).
 * FLOW      lines + the flags the shop sent → resolve → lines with `rcm_category` set where the law's list and the shop's words agree → tax.determine (rcm) → frozen invoice RegRev Y.
 * RISK      a flag the engine never read (reverse_charge on the line, the bill or business_json answered 200 and billed forward charge); an HSN prefix that marks a bill the shop never said was RCM
 *           (reg-in `legal` = 9982 also matches an accountant's 998222; a GTA may opt for forward charge) — so an HSN ALONE only ASKS (a note), it never switches the tax.
 *
 * THE RULE (CGST Act s.9(3)/9(4) — the categories are the India pack's DATA, none is named here; statute wording is not quoted: not cited in CITE-1129):
 *   a line is RCM when it NAMES a category the pack has (`rcm_category`), or when the shop SAYS so (`reverse_charge: true` on the line, else on the bill or in business_json) AND the pack's list
 *   has a category for its HSN. HSN alone: not RCM, and a note asks. `reverse_charge: false` = forward charge on purpose (a GTA that opted for it): no note.
 *   An input this cannot read is REFUSED in words, never ignored: a flag that is not true/false, a category the pack does not have, a flag that matches no category, a flag for a country whose pack has no table.
 */
const packs = require('./tax-packs');

/** the one reader of a flag: true | false | undefined (not sent) | 'unreadable' (sent, but not a boolean) */
function flagOf(value) {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'boolean' ? value : 'unreadable';
}
const lineFlagOf = (line) => flagOf(line.reverse_charge !== undefined ? line.reverse_charge : line.reverseCharge);
const categoryNamed = (line) => {
  const given = line.rcm_category != null ? line.rcm_category : line.rcmCategory;
  const text = given == null ? '' : String(given).trim().toLowerCase();
  return text || undefined;
};
const nameOf = (line) => line.name || line.particulars || '';
const hsnOf = (line) => line.hsn || line.hsn_code || line.HsnCd || '';

/**
 * resolve({ lines, flag, country }) → { lines, notes: [], refusals: [{ line, code, words }] }
 * `flag` is the bill-wide word as sent (business_json.reverse_charge, else the body's): true | false | anything else (unreadable). `lines` come back in the same order, copies with
 * `rcm_category` set on every line the rule marks; a line the rule does not mark is returned as it came.
 */
function resolve(input) {
  const given = input || {};
  const lines = Array.isArray(given.lines) ? given.lines : [];
  const out = { lines: lines.slice(), notes: [], refusals: [] };
  const pack = given.country ? packs.packFor(String(given.country).toUpperCase()) : null;
  const table = pack && pack.rcm && Array.isArray(pack.rcm.categories) ? pack.rcm : null;
  const billFlag = flagOf(given.flag);
  const refuse = (index, code, words) => out.refusals.push({ line: index, code, words: 'Line ' + (index + 1) + (nameOf(lines[index] || {}) ? ' (' + nameOf(lines[index]) + ') ' : ' ') + words });
  if (billFlag === 'unreadable') out.refusals.push({ line: null, code: 'rcm_flag_unreadable', words: 'The reverse-charge answer must be true or false; it could not be read.' });
  const ctx = { out, lines, pack, table, billFlag, refuse, billFlagUsed: false };
  lines.forEach((rawLine, index) => judgeLine(ctx, rawLine, index));
  refuseUnusedBillFlag(ctx);
  return out;
}

/** a line's own reverse-charge word beats the bill's: true | false | undefined (said by neither) */
function saidOf(ownFlag, billFlag) {
  return ownFlag !== undefined ? ownFlag : billFlag === true ? true : undefined;
}

/** one line of the bill: refuse what cannot be read, mark the category the rule decides, or note an HSN that asks (ctx = resolve's working state) */
function judgeLine(ctx, rawLine, index) {
  const line = rawLine || {};
  const ownFlag = lineFlagOf(line);
  const named = categoryNamed(line);
  if (ownFlag === 'unreadable') return ctx.refuse(index, 'rcm_flag_unreadable', 'has a reverse-charge answer that is not true or false.');
  const said = saidOf(ownFlag, ctx.billFlag);
  if (!ctx.table) return judgeWithoutTable(ctx, { named, said, index });
  if (named) return judgeNamed(ctx, { named, ownFlag, index });
  const byHsn = packs.rcmCategoryFor(ctx.pack, { code: hsnOf(line) });
  if (said === true) return judgeSaid(ctx, { line, byHsn, ownFlag, index });
  if (said === undefined && byHsn)
    ctx.out.notes.push(
      'Line ' + (index + 1) + ': HSN ' + hsnOf(line) + ' is on the reverse-charge list (' + byHsn.name + ') and was billed as forward charge. If the buyer pays the tax, say reverse_charge: true on the line; if the supplier opted for forward charge, say reverse_charge: false.'
    );
}

/** a line of a country whose pack has no reverse-charge list: a named category or a true flag is refused in words, never applied */
function judgeWithoutTable(ctx, { named, said, index }) {
  if (named || said === true) ctx.refuse(index, 'rcm_not_in_pack', "says reverse charge, but this country's tax pack has no reverse-charge list, so it was not applied.");
}

/** a line that names a category: it must be one the pack has, and must not also say forward charge */
function judgeNamed(ctx, { named, ownFlag, index }) {
  const category = packs.rcmCategoryFor(ctx.pack, { id: named });
  if (!category) return ctx.refuse(index, 'rcm_category_unknown', 'names the reverse-charge category "' + named.slice(0, 30) + '", which is not on the list (' + ctx.table.categories.map((row) => row.id).join(', ') + ').');
  if (ownFlag === false) return ctx.refuse(index, 'rcm_flag_conflict', 'names a reverse-charge category and also says it is not reverse charge. Say one.');
}

/** a line the shop says is reverse charge: an HSN on the list gives it its category (and uses up the bill's word when that was the only word); a line's own true with no category on the list is refused */
function judgeSaid(ctx, { line, byHsn, ownFlag, index }) {
  if (byHsn) {
    ctx.out.lines[index] = Object.assign({}, line, { rcm_category: byHsn.id });
    if (ownFlag === undefined) ctx.billFlagUsed = true;
  } else if (ownFlag === true) ctx.refuse(index, 'rcm_no_category', 'says reverse charge, but its HSN ' + (hsnOf(line) || '(none)') + ' is on no reverse-charge list. Name the category in rcm_category (' + ctx.table.categories.map((row) => row.id).join(', ') + ').');
}

/** the bill says reverse charge but no line used it, was named, or said it: one refusal asking for the category */
function refuseUnusedBillFlag(ctx) {
  const { billFlag, out, table, lines } = ctx;
  if (billFlag === true && !ctx.billFlagUsed && !out.refusals.length && table && !lines.some((line) => line && (categoryNamed(line) || lineFlagOf(line) === true)))
    out.refusals.push({ line: null, code: 'rcm_no_category', words: 'The bill says reverse charge, but no line has an HSN on the reverse-charge list. Name the category on the line in rcm_category (' + table.categories.map((row) => row.id).join(', ') + ').' });
}

/** TAX 422 in words for the FIRST refusal (the TAX_LINE_UNAVAILABLE shape: refused, nothing saved); no refusals → returns */
function refusalOf(refusals) {
  const first = (refusals || [])[0];
  if (!first) return;
  throw Object.assign(new Error(first.words + ' Nothing was saved.'), { refused: true, status: 422, code: 'RCM_INPUT_UNREADABLE', title: 'Reverse charge not understood', line: first.line, reason: first.code });
}

module.exports = { resolve, refusalOf };