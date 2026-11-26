/**
 * books-period-taxed.js — the tax-return reads that look at WHICH postings carried the tax (split out of books-period.js, whose size row may not grow).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      splitInputTax · TAX_ROLES · MONEY_ROLES · SALES_ROLES · addTaxedRows(handle, entity, ctx, start, end, rows) · unsupportedInput(handle, entity, { pack, cur, period, boxes }) · unsupportedInputWithNet(…, filedNetMinor)
 * CALLED BY lib/books-period.js movementsBetween (the rows of a return) · taxReturn (the claimed-with-no-invoice figure)
 * FLOW      the period's movement rows → the taxed income on a non-sales ledger (AU G1) → the boxes that count only postings that carried the tax (AE box 9) · the purchases whose credit is claimed with no tax invoice held (books-evidence)
 * CARD      14-accounting/README
 * Nothing is worked out here: each figure is a store read, carried with its currency; the box figures are not changed.
 */
'use strict';
const Store = require('./books-store');

/** the ledger roles a settlement of tax moves (the tax ledgers and money), and the sales roles the pack's G1 already reads — fix/bas-monday */
const TAX_ROLES = ['gst_collected', 'gst_paid'],
  MONEY_ROLES = ['bank', 'cash', 'card', 'upi', 'bank_od'],
  SALES_ROLES = ['sales', 'sales_export', 'sales_gst_free', 'sales_input_taxed', 'sales_returns'];

/** rows are the period's movements by ledger; this adds and narrows them in place (the pack's own tax ledgers and returns.taxedOnly decide, never a country id) */
async function addTaxedRows(handle, entity, ctx, start, end, rows) {
  /* fix/bas-monday: G1 is taxable supplies by tax code: income taken on a ledger that is not a sales ledger (Sundry income) with GST on it joins as role sales_taxed_other */
  /* read from the pack's own tax ledgers, not its id: a pack whose output tax role is gst_collected (AU's) reads the taxed income; no other pack names that role */
  const gstHead = (ctx.pack.taxLedgers && ctx.pack.taxLedgers.gst) || {};
  if (gstHead.output === 'gst_collected') {
    const taxed = await Store.taxedIncomeLines(handle, entity, start, end, gstHead.output, SALES_ROLES);
    taxed.forEach((line) => rows.push({ code: String(line.code), role: 'sales_taxed_other', name: 'Taxed income on a non-sales ledger', dr_minor: Number(line.dr_minor), cr_minor: Number(line.cr_minor) }));
  }
  await moveStatedExports(handle, entity, ctx, start, end, rows); /* RW1-08: a stated export posted on plain Sales reads as G2 */
  await splitInputTax(handle, entity, ctx, start, end, rows); /* AU G10 / G11 inclusive: the GST of capital purchases, from the posted lines */
  /* l16-accfix ACC-new-1: a box whose AMOUNT counts only the postings that carried the tax (the pack's returns.taxedOnly: VAT201 box 9): the roles it names are read from the entries that also
     carry a line on its tax role — a bill with no VAT, a bank fee, an exempt or zero-rated purchase is not in it. A pack with no such member (AU G11) reads whole accounts as before. */
  for (const spec of (ctx.pack.returns && ctx.pack.returns.taxedOnly) || []) {
    const kept = new Map((await Store.taxedOnlyLines(handle, entity, start, end, spec.tax_role, spec.roles)).map((line) => [String(line.code), line]));
    rows.forEach((row) => {
      if (spec.roles.indexOf(row.role) < 0) return;
      const taxed = kept.get(String(row.code));
      Object.assign(row, { dr_minor: taxed ? Number(taxed.dr_minor) : 0, cr_minor: taxed ? Number(taxed.cr_minor) : 0 });
    });
  }
}

/**
 * RW1-08 (re-walk 25 Nov): a BAS / VAT label follows each line's tax treatment, not the account it hit. A sale that STATED itself an export but was posted before the export-ledger fix sits on plain Sales with
 * no tax line; books are insert-only, so the reader moves it: a debit row on the sales role and a credit row on the pack's export ledger, same code and amount (the label totals and G1 stay, G2 gains it and the
 * taxable base loses it, so 1A against the taxable base and the gap warning stay true). A pack with no export ledger in the shop's chart is read as before.
 */
async function moveStatedExports(handle, entity, ctx, start, end, rows) {
  const exportLedger = (ctx.chart || []).find((item) => item.role === 'sales_export');
  if (!exportLedger) return;
  const taxRoles = Object.values(ctx.pack.taxLedgers || {}).flatMap((head) => [head && head.output, head && head.input]).filter(Boolean),
    lines = await Store.statedExportLines(handle, entity, start, end, taxRoles, 'sales');
  lines.forEach((line) => {
    const moved = { dr_minor: Number(line.cr_minor), cr_minor: Number(line.dr_minor) };
    rows.push(Object.assign({ code: String(line.code), role: 'sales', name: 'Stated export posted on Sales' }, moved));
    rows.push({ code: String(exportLedger.code), role: 'sales_export', name: exportLedger.name, dr_minor: Number(line.dr_minor), cr_minor: Number(line.cr_minor) });
  });
}

/** the GST input role and the capital cost roles to split on, when the pack's dated row for the period's first day says inclusive; null when the pack has no such row or role */
function inclusiveSplitRoles(pack, start) {
  const dated = pack.returns && pack.returns.g10_g11,
    row = Array.isArray(dated) ? require('./tax-packs').rowAsOf(dated, start) : null,
    inRole = pack.taxLedgers && pack.taxLedgers.gst && pack.taxLedgers.gst.input,
    capitalRoles = (pack.asset_classes || []).map((item) => item.cost_role).filter(Boolean);
  if (!row || row.basis !== 'inclusive' || !inRole || !capitalRoles.length) return null;
  return { inRole, capitalRoles };
}
/**
 * AU BAS G10 / G11 GST-INCLUSIVE (Athi 22 Nov 2026, AP-F-09; ACC-351): when the pack's dated row `returns.g10_g11` for the period's first day says inclusive, the GST ledger's movement is split in two
 * rows of the SAME code (1B is their sum, unchanged): the GST of the entries that carry a capital line (tagged for: 'capital') and the rest (for: 'non_capital'). Read from the posted journal lines
 * (the GST each purchase's by_rate already posted), never recomputed from a bill. A pack with no such rows, or a period before the inclusive row, is read exactly as before.
 */
async function splitInputTax(handle, entity, ctx, start, end, rows) {
  const split = inclusiveSplitRoles(ctx.pack, start);
  if (!split) return;
  const { inRole, capitalRoles } = split;
  const at = rows.findIndex((item) => item.role === inRole);
  if (at < 0) return;
  const { net_minor: capital } = await Store.taxOfEntriesWith(handle, entity, start, end, inRole, capitalRoles),
    whole = rows[at],
    capitalDr = capital > 0 ? capital : 0,
    capitalCr = capital < 0 ? -capital : 0;
  rows.splice(at, 1,
    Object.assign({}, whole, { for: 'capital', dr_minor: capitalDr, cr_minor: capitalCr }),
    Object.assign({}, whole, { for: 'non_capital', dr_minor: Number(whole.dr_minor) - capitalDr, cr_minor: Number(whole.cr_minor) - capitalCr }));
}

/** the credit claimed with no tax invoice held: the Day book's own flag, carried, with the box that counts the input tax (found by the pack's own role, never a number here) → { count, tax_minor, …, box } */
async function unsupportedInput(handle, entity, request) {
  const { pack, cur: currency, period, boxes } = request;
  const evidence = require('./books-evidence');
  const found = await evidence.unsupportedIn(handle, entity, { pack, cur: currency }, period.start, period.end);
  const inRoles = evidence.inputRoles(pack),
    inBox = boxes.find((item) => item.roles.length === 1 && inRoles.has(item.roles[0]));
  found.box = inBox ? inBox.code : null;
  /* AC-F-04 (walk AC 1129): the part of a box that has no tax invoice can never be more than the box itself (a credit note had taken 5.00 off Box 13, so "35.00 of 30.00" read wrong):
     the figure is carried at most as the box's own posted amount, and net_if_unclaimed follows from it. The box figure is not changed. */
  const boxMinor = inBox && inBox.amount_minor != null ? Number(inBox.amount_minor) : null;
  if (boxMinor != null && found.tax_minor > boxMinor) found.tax_minor = Math.max(0, boxMinor);
  return found;
}

/** unsupportedInput with ACC-357: what the return would say to pay if those purchases' credit is NOT claimed (`filedNetMinor` + their tax), carried with its currency; the box figures are untouched (the page shows both and adds nothing) */
async function unsupportedInputWithNet(handle, entity, request, filedNetMinor) {
  const found = await unsupportedInput(handle, entity, request);
  found.net_if_unclaimed_minor = found.count ? require('./books-money-ops').addMinor(filedNetMinor, found.tax_minor, request.cur) : null;
  return found;
}

module.exports = { TAX_ROLES, MONEY_ROLES, SALES_ROLES, addTaxedRows, unsupportedInput, unsupportedInputWithNet };
