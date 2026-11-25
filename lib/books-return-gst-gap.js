/**
 * books-return-gst-gap.js — "taxable sales that carry no GST": the one reasonableness check a single-rate GST return needs (FW-32, walk 25 Nov).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      gapOf(pack, rows, boxes, currency, need) → null | { taxable_minor, expected_minor, collected_minor, gap_minor, rate, currency } · markGap(...) → { boxes (the tax box's `note`), notes }
 * CALLED BY lib/books-period.taxReturn (after the boxes are built; nothing it reads is changed)
 * FLOW      the period's movement rows (sales roles) + the tax box the pack names (its output tax ledger) ──▶ taxable x the pack's standard_rate against the tax collected ──▶ a sentence on the box
 * CARD      14-accounting/README
 *
 * ⭐ WHY. The BAS counts a sale on the plain Sales ledger in G1 whatever its tax; only 1A shows the GST. A sale posted with no GST (a rate missing, a manual journal, a cross-border buyer) sits in
 *   Sales and the return still adds up, so nothing said so. Xero's GST reconciliation and MYOB's "GST on sales" check do the same sum: taxable sales x the rate against the tax collected.
 * ⭐ ONE CALCULATION, TWO CARRIED TOTALS. The taxable base is read from the rows of the roles the pack names; the tax collected is the return's OWN tax box (the engine's figure, not re-added here).
 *   The rate is the PACK's `tax.standard_rate` (data, never typed here); a pack with no single head, no numeric rate, or no one tax box is not checked (no guess). Law is not a switch: this never changes a figure.
 * ⭐ ROUNDING. Tax is rounded per line (half-up), so a sum of lines may differ from the sum x rate by a few minor units: a gap under ONE whole currency unit is rounding, never a warning (the
 *   same band parallel-run uses). Only a SHORTFALL is said (tax collected below the rate): a surplus is taxed income on a ledger the check does not read.
 * ⭐ NOT TWICE. The 0%-no-kind answer (ACC-290 `needs_answer`) already names a 0% sale with no kind; a gap that answer covers is not said a second time.
 */
'use strict';
const ops = require('./books-money-ops');
const money = require('./money');

/** the sales ledgers whose net is the taxable base: the plain sales role the pack names for an unnamed 0% sale, the taxed income on other ledgers, less returns */
const baseRolesOf = (pack) => {
  const row = pack && pack.returns && pack.returns.unknownKind;
  return row && row.role ? { sales: row.role, returns: row.role + '_returns', other: 'sales_taxed_other' } : null;
};

/** the pack's one tax head and its output ledger, or null when the check does not apply (no single head, no numeric standard rate) */
function taxOf(pack) {
  const heads = (pack && pack.taxHeads) || [];
  if (heads.length !== 1 || !pack.taxLedgers || !pack.taxLedgers[heads[0]] || typeof pack.taxLedgers[heads[0]].output !== 'string') return null;
  const rate = Number(pack.tax && pack.tax.standard_rate);
  return Number.isFinite(rate) && rate > 0 ? { role: pack.taxLedgers[heads[0]].output, rate } : null;
}

function gapOf(pack, rows, boxes, currency, need) {
  const roles = baseRolesOf(pack),
    tax = taxOf(pack);
  if (!roles || !tax) return null;
  const taxBoxes = (boxes || []).filter((box) => box.roles && box.roles.length === 1 && box.roles[0] === tax.role);
  if (taxBoxes.length !== 1 || taxBoxes[0].amount_minor == null) return null;
  const net = (role, side) => ops.sumMinor((rows || []).filter((row) => row.role === role), currency, (row) => (side === 'cr' ? Number(row.cr_minor) - Number(row.dr_minor) : Number(row.dr_minor) - Number(row.cr_minor)));
  const taxable = ops.diffMinor(ops.addMinor(net(roles.sales, 'cr'), net(roles.other, 'cr'), currency), net(roles.returns, 'dr'), currency),
    expected = ops.percentMinor(taxable, tax.rate, currency),
    collected = Number(taxBoxes[0].amount_minor),
    gap = ops.diffMinor(expected, collected, currency);
  if (!(taxable > 0) || gap < Math.pow(10, money.decimals ? money.decimals(currency) : 2)) return null;
  const named = need && need.total_minor > 0 ? ops.percentMinor(need.total_minor, tax.rate, currency) : 0;
  if (named > 0 && gap <= named + Math.pow(10, money.decimals ? money.decimals(currency) : 2)) return null; /* the 0%-no-kind answer already says it */
  return { taxable_minor: taxable, expected_minor: expected, collected_minor: collected, gap_minor: gap, rate: tax.rate, currency, box: taxBoxes[0].code };
}

/** the two sentences: the short one a box carries on its `note` (the slot every box has), the whole one for "How it was read" */
function wordsOfGap(gap) {
  const words = (minor) => require('./cash-step').wordsOf(minor, gap.currency);
  return {
    box: words(gap.gap_minor) + ' of tax missing on sales: open Sales',
    note:
      'Taxable sales ' + words(gap.taxable_minor) + ' at ' + gap.rate + '% is ' + words(gap.expected_minor) + ' tax, but ' + words(gap.collected_minor) + ' was collected: ' + words(gap.gap_minor) +
      ' short. A sale on Sales with no tax on it (a rate missing, or a journal) is counted in the sales total and not in the tax box. Open Sales and find which sale it is.'
  };
}

/** → { boxes, notes }: the tax box with the short sentence on its own `note`, the whole one in the notes; every figure unchanged, nothing added when there is no gap */
function markGap(pack, rows, boxes, currency, need) {
  const gap = gapOf(pack, rows, boxes, currency, need);
  if (!gap) return { boxes, notes: [] };
  const said = wordsOfGap(gap);
  return { boxes: boxes.map((box) => (box.code === gap.box ? Object.assign({}, box, { note: box.note ? box.note + ' · ' + said.box : said.box }) : box)), notes: [said.note] };
}

module.exports = { gapOf, markGap };
