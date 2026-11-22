/**
 * books-period-taxed.js — the tax-return reads that look at WHICH postings carried the tax (split out of books-period.js, whose size row may not grow).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      splitInputTax · TAX_ROLES · MONEY_ROLES · SALES_ROLES · addTaxedRows(handle, entity, ctx, start, end, rows) · unsupportedInput(handle, entity, { pack, cur, period, boxes })
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
 * AU BAS G10 / G11 GST-INCLUSIVE (Athi 22 Nov 2026, AP-F-09; ACC-351): when the pack's dated row `returns.g10_g11` for the period's first day says inclusive, the GST ledger's movement is split in two
 * rows of the SAME code (1B is their sum, unchanged): the GST of the entries that carry a capital line (tagged for: 'capital') and the rest (for: 'non_capital'). Read from the posted journal lines
 * (the GST each purchase's by_rate already posted), never recomputed from a bill. A pack with no such rows, or a period before the inclusive row, is read exactly as before.
 */
async function splitInputTax(handle, entity, ctx, start, end, rows) {
  const dated = ctx.pack.returns && ctx.pack.returns.g10_g11,
    row = Array.isArray(dated) ? require('./tax-packs').rowAsOf(dated, start) : null,
    inRole = ctx.pack.taxLedgers && ctx.pack.taxLedgers.gst && ctx.pack.taxLedgers.gst.input,
    capitalRoles = (ctx.pack.asset_classes || []).map((item) => item.cost_role).filter(Boolean);
  if (!row || row.basis !== 'inclusive' || !inRole || !capitalRoles.length) return;
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
