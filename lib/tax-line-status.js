// @stage tested
'use strict';
/**
 * tax-line-status.js — ONE tax status per bill line (RATED / ZERO / UNAVAILABLE), read off what the engine already decided.
 *
 * OWNS      lineTaxStatusOf (the status of each line) and refuseUnavailable (the 422 TAX_LINE_UNAVAILABLE refusal); no second tax rule.
 * OWNER     cb-accounting
 * CALLED BY lib/tax-lines.js (re-exports both) · lib/send-money.js · lib/services.js
 * FLOW      engine invoice (ItemList + _cb) → lineTaxStatusOf → status per line → refuseUnavailable throws on the first UNAVAILABLE
 * CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
 * RISK      a line shown as 0 with no reason (a silent zero) — pinned by tests/tax-explicit-1129.test.cjs
 * ZERO DEPENDENCIES beyond siblings · TIER A
 */
const money = require('./money');
const num = (values) => {
  const n = Number(values);
  return Number.isFinite(n) ? n : null;
};

const NIL_KINDS = new Set(['nil', 'exempt', 'non_gst']);
/** the line's own zero word: the pack's supply kind, else the slab's nil kind, else an export, else null (no word = the line carries no reason) */
function zeroWordOf(item, index, ctx) {
  const nilKind = NIL_KINDS.has(item._nil_kind) ? item._nil_kind : null;
  const exportWord = ctx.cb.export === 'stated' ? 'zero_rated_export' : null;
  return ctx.kindOf[index] || nilKind || exportWord;
}
/** the line's tax heads added up (CGST + SGST + IGST + tax + cess); summing an absent HEAD on a line whose rate is known: SAFE */
const HEAD_KEYS = ['CgstAmt', 'SgstAmt', 'IgstAmt', 'TaxAmt', 'CesAmt'];
/** the heads a line carries (non-zero figures, in key order): none = the engine charged nothing on it */
const headsOf = (item) => HEAD_KEYS.map((key) => num(item[key])).filter((value) => value !== null && value !== 0);
/** their total through the money value type (money.sum: one currency, labelled, never a bare +) */
const headsTotalOf = (heads, currency) => (heads.length ? money.sum(heads.map((amount) => ({ amount, currency })), { empty: currency }).amount : 0);
/** a line with a rate above 0: RATED, its tax in minor units (null when the seller has no money), and the reverse-charge word when the engine marked it */
function ratedStatus(item, index, rate, heads, currency) {
  const tax = currency ? { amount_minor: money.toMinor(headsTotalOf(heads, currency), currency), currency } : null;
  return Object.assign({ line: index, status: 'RATED', rate, tax }, item.RcmCd ? { reason: 'reverse_charge' } : {});
}
/** why a line has no answer yet: no rate, a cess that could not be read, or a supply the engine could not decide; null when it has one */
function noAnswerReasonOf(item, index, rate, heads, ctx) {
  if (item._unrated) return 'rate_missing';
  if (ctx.input[index] && ctx.input[index].cess_unreadable) return 'cess_rate_unreadable';
  return rate > 0 && ctx.cb.supply === 'unknown' && heads.length === 0 ? 'supply_undecided' : null;
}
/** a line at 0%: ZERO with the word that says why; no word is UNAVAILABLE, never a silent 0 */
function zeroStatusOf(item, index, ctx) {
  const zeroWord = zeroWordOf(item, index, ctx);
  if (!zeroWord) return { line: index, status: 'UNAVAILABLE', reason: 'zero_reason_missing' }; /* ZERO-REASON (Athi 21 Nov): a rate with no reason is no answer; 'unanswered' is never a ZERO reason; an unregistered seller already answered above (docWord) */
  return { line: index, status: 'ZERO', reason: zeroWord };
}
/** the status of ONE line from its engine row; the first answer that applies wins (a charge-nothing document, no rate, an unreadable cess, an undecided supply, a rate, a zero with its word) */
function statusOfLine(item, index, ctx) {
  const rate = num(item.GstRt) || 0;
  const heads = headsOf(item);
  const unavailable = (reason) => ({ line: index, status: 'UNAVAILABLE', reason });
  if (ctx.docWord) return { line: index, status: 'ZERO', reason: ctx.docWord };
  const noAnswer = noAnswerReasonOf(item, index, rate, heads, ctx);
  if (noAnswer) return unavailable(noAnswer);
  if (rate > 0) return ratedStatus(item, index, rate, heads, ctx.currency);
  return zeroStatusOf(item, index, ctx);
}
/**
 * ⭐⭐ TAX-EXPLICIT (21 Nov 2026, Athi: "each product should be tied with a tax line, either a value or a zero should come; no value coming means it is a failure, like a capability not answering").
 * lineTaxStatusOf(invoice, lines) → ONE status per bill line, read off what the engine ALREADY decided (no second rule):
 *   RATED        { rate, tax }       a rate above 0 (tax = { amount_minor, currency }, null when the seller has no money)
 *   ZERO         { reason }          a rate 0 or a charge-nothing document, WITH the word that says why: the pack's own supply kind (gst_free · input_taxed · zero_rated · exempt …),
 *                                    the slab's nil_kind (nil · exempt · non_gst), the document's (composition · unregistered_seller · sez · zero_rated_export), (an explicit 0% that names no kind is UNAVAILABLE 'zero_reason_missing': the books-todo zero_kind_unanswered question counts them)
 *   UNAVAILABLE  { reason }          the line carries NO answer: no rate ('rate_missing'), a cess rate that could not be read ('cess_rate_unreadable'), or a supply the engine could not decide ('supply_undecided', ACC-191)
 * An UNAVAILABLE line is never sent as 0: refuseUnavailable() throws TAX_LINE_UNAVAILABLE (the TAX_SHELF_UNREADABLE shape: refused, in words). `lines` = the input lines the engine saw, in ItemList order.
 */
const DOC_ZERO_WORD = { composition: 'composition', unregistered: 'unregistered_seller', sez: 'sez', zero_rated: 'zero_rated_export' }; /* the engine's applicability.reason → the status word */
function lineTaxStatusOf(invoice, lines) {
  const cb = (invoice && invoice._cb) || {};
  const kindOf = {};
  (cb.kinds || []).forEach((entry) => {
    kindOf[entry.line] = entry.kind;
  });
  const ctx = { cb, kindOf, input: Array.isArray(lines) ? lines : [], currency: (invoice && invoice.currency) || null, docWord: cb.reason ? DOC_ZERO_WORD[cb.reason] || cb.reason : null };
  return ((invoice && invoice.ItemList) || []).map((item, index) => statusOfLine(item, index, ctx));
}
/** TAX_LINE_UNAVAILABLE (422, refused: true): the bill is not made, in words, naming the first line with no tax answer; never a bill with 0 on it */
function refuseUnavailable(statuses, lines) {
  const bad = (statuses || []).filter((entry) => entry.status === 'UNAVAILABLE')[0];
  if (!bad) return;
  const named = lines && lines[bad.line] && (lines[bad.line].name || lines[bad.line].particulars);
  const why = { rate_missing: 'has no tax rate', cess_rate_unreadable: 'has a cess rate that could not be read', zero_reason_missing: 'is at 0% and nothing says why', supply_undecided: 'has a supply the tax could not be decided for' }[bad.reason] || 'has no tax answer';
  throw Object.assign(new Error('Line ' + (bad.line + 1) + (named ? ' (' + named + ')' : '') + ' ' + why + ', so this was not made. Nothing was saved. ' + (bad.reason === 'zero_reason_missing' ? 'Say why ' + (named || 'this item') + ' is zero-rated or exempt in Catalogue.' : 'Set its tax, or mark it zero with the reason.')), { refused: true, status: 422, code: 'TAX_LINE_UNAVAILABLE', title: 'Tax not set on a line', line: bad.line, reason: bad.reason });
}

module.exports = { lineTaxStatusOf, refuseUnavailable };
