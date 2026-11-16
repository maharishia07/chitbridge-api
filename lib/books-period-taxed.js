/**
 * books-period-taxed.js — the tax-return reads that look at WHICH postings carried the tax (split out of books-period.js, whose size row may not grow).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      TAX_ROLES · MONEY_ROLES · SALES_ROLES · addTaxedRows(handle, entity, ctx, start, end, rows) · unsupportedInput(handle, entity, { pack, cur, period, boxes })
 * CALLED BY lib/books-period.js movementsBetween (the rows of a return) · taxReturn (the claimed-with-no-invoice figure)
 * FLOW      the period's movement rows → the taxed income on a non-sales ledger (AU G1) → the boxes that count only postings that carried the tax (AE box 9) · the purchases whose credit is claimed with no tax invoice held (books-evidence)
 * CARD      14-accounting/README
 * Nothing is worked out here: each figure is a store read, carried with its currency; the box figures are not changed.
 */
'use strict';
const S = require('./books-store');

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
    const taxed = await S.taxedIncomeLines(handle, entity, start, end, gstHead.output, SALES_ROLES);
    taxed.forEach((line) => rows.push({ code: String(line.code), role: 'sales_taxed_other', name: 'Taxed income on a non-sales ledger', dr_minor: Number(line.dr_minor), cr_minor: Number(line.cr_minor) }));
  }
  /* l16-accfix ACC-new-1: a box whose AMOUNT counts only the postings that carried the tax (the pack's returns.taxedOnly: VAT201 box 9): the roles it names are read from the entries that also
     carry a line on its tax role — a bill with no VAT, a bank fee, an exempt or zero-rated purchase is not in it. A pack with no such member (AU G11) reads whole accounts as before. */
  for (const spec of (ctx.pack.returns && ctx.pack.returns.taxedOnly) || []) {
    const kept = new Map((await S.taxedOnlyLines(handle, entity, start, end, spec.tax_role, spec.roles)).map((line) => [String(line.code), line]));
    rows.forEach((row) => {
      if (spec.roles.indexOf(row.role) < 0) return;
      const taxed = kept.get(String(row.code));
      Object.assign(row, { dr_minor: taxed ? Number(taxed.dr_minor) : 0, cr_minor: taxed ? Number(taxed.cr_minor) : 0 });
    });
  }
}

/** the credit claimed with no tax invoice held: the Day book's own flag, carried, with the box that counts the input tax (found by the pack's own role, never a number here) → { count, tax_minor, …, box } */
async function unsupportedInput(handle, entity, ask) {
  const { pack, cur, period, boxes } = ask;
  const Ev = require('./books-evidence');
  const found = await Ev.unsupportedIn(handle, entity, { pack, cur }, period.start, period.end);
  const inRoles = Ev.inputRoles(pack),
    inBox = boxes.find((item) => item.roles.length === 1 && inRoles.has(item.roles[0]));
  found.box = inBox ? inBox.code : null;
  return found;
}

module.exports = { TAX_ROLES, MONEY_ROLES, SALES_ROLES, addTaxedRows, unsupportedInput };
