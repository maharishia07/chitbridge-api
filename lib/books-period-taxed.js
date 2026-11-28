/**
 * books-period-taxed.js — the tax-return reads that look at WHICH postings carried the tax (split out of books-period.js, whose size row may not grow).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      settledOf(handle, entity, pack, start, end) (the ONE reader of what a return leaves out) · eventNameOf · taxEventNames · splitInputTax · TAX_ROLES · MONEY_ROLES · SALES_ROLES · addTaxedRows(handle, entity, ctx, start, end, rows) · unsupportedInput(handle, entity, { pack, cur, period, boxes }) · unsupportedInputWithNet(…, filedNetMinor)
 * CALLED BY lib/books-period.js movementsBetween (the rows of a return) · taxReturn (the claimed-with-no-invoice figure)
 * FLOW      the period's movement rows → the taxed income on a non-sales ledger (AU G1) → the boxes that count only postings that carried the tax (AE box 9) · the purchases whose credit is claimed with no tax invoice held (books-evidence)
 * CARD      14-accounting/README
 * Nothing is worked out here: each figure is a store read, carried with its currency; the box figures are not changed.
 */
'use strict';
const Store = require('./books-store');
const { MONEY_ROLES } = require('./cash-roles'); /* ONE-FIGURE RC9 */

/** the ledger roles a settlement of tax moves (the tax ledgers and money), and the sales roles the pack's G1 already reads — fix/bas-monday */
const TAX_ROLES = ['gst_collected', 'gst_paid'],
  SALES_ROLES = ['sales', 'sales_export', 'sales_gst_free', 'sales_input_taxed', 'sales_returns'];

/** the pack's own word for a neutral event (IN · AU gst_setoff / gst_payment), else the neutral word */
const eventNameOf = (pack, neutral) => Object.keys(pack.eventAliases || {}).find((item) => pack.eventAliases[item] === neutral) || neutral;
/** the event names a set-off and a tax payment are stored under in this pack's books — the neutral names and the pack's own aliases */
const taxEventNames = (pack) => Array.from(new Set(['tax_setoff', 'tax_payment'].reduce((all, neutral) => all.concat([neutral, eventNameOf(pack, neutral)]), [])));
/**
 * ⭐ ONE reader of what a tax RETURN leaves out of its boxes (ONE-FIGURE RC1): the period's own set-off and statutory payment entries move the tax ledgers but are not sales or purchases.
 * The return (books-period.movementsBetween) subtracts exactly this, and the Ledger page's "left out of the return" line (returnReading) shows exactly this, so a ledger's movement minus this
 * line IS the return's figure for it. → { byCode: { code: { dr, cr } }, entries: how many entries } — minor units; the currency is the shop's.
 */
async function settledOf(handle, entity, pack, start, end) {
  const lines = await Store.taxEntryLines(handle, entity, start, end, taxEventNames(pack), { tax: TAX_ROLES, money: MONEY_ROLES }),
    byCode = Object.create(null);
  lines.forEach((line) => {
    const sums = byCode[line.code] || (byCode[line.code] = { dr: 0, cr: 0 });
    sums.dr += Number(line.dr_minor);
    sums.cr += Number(line.cr_minor);
  });
  return { byCode, entries: new Set(lines.map((line) => line.entry_id)).size };
}

/** true when the return counts this ledger as itself, once, and keeps every posting of it (no re-label: taxed income, moved export, capital split, only-entries-with-tax) */
const readsPlain = (pack, account, rows) => rows.length === 1 && rows[0].role === (account.role || null) && !((pack.returns || {}).taxedOnly || []).some((spec) => spec.roles.indexOf(rows[0].role) >= 0);
/**
 * ⭐ ONE-FIGURE RC1: how the RETURN reads one ledger over a period — the Ledger page's reconciling view (GET /ledger/:account?reading=return). It runs the return's own movementsBetween (never a second
 * copy of its rules) and says what the box does to this ledger: the entries it leaves out (settledOf: the set-off and tax payment, one labelled line) and every row it counts the ledger as (the sales
 * ledger's taxed part as G1, a stated export moved to G2, the capital part of 1B, only the postings that carried the tax). Both totals are CARRIED, the tie is compared, never worked out twice.
 * → null when the pack has no return or the range cuts a month · { form, from, to, left_out: { entries_n, dr_minor, cr_minor }, rows: [{ role, name, for?, dr_minor, cr_minor }], ledger_minor, left_out_minor, return_minor, tie: 'plain' | 'relabelled', tie_ok }
 * — minor units, Dr − Cr; `tie_ok` (plain only) is: ledger_minor − left_out_minor === return_minor.
 */
async function returnReading(handle, entity, ctx, account, start, end, ledgerMinor) {
  const whole = /-01$/.test(start) && /-01$/.test(require('./books').addDays(end, 1)); /* the return reads whole months (its balance rows): a range that cuts a month has no reading */
  if (!whole || !ctx.pack.returns || !ctx.pack.returns.id) return null;
  const code = String(account.code),
    moved = await require('./books-period').movementsBetween(handle, entity, ctx, start, end),
    settled = await settledOf(handle, entity, ctx.pack, start, end),
    mine = settled.byCode[code] || { dr: 0, cr: 0 },
    rows = moved.rows.filter((row) => String(row.code) === code),
    plain = readsPlain(ctx.pack, account, rows),
    leftOutMinor = mine.dr - mine.cr,
    returnMinor = rows.reduce((sum, row) => sum + Number(row.dr_minor) - Number(row.cr_minor), 0);
  return {
    form: ctx.pack.returns.id,
    from: start,
    to: end,
    left_out: { entries_n: mine.dr || mine.cr ? settled.entries : 0, dr_minor: mine.dr, cr_minor: mine.cr },
    rows: rows.map((row) => Object.assign({ role: row.role, name: row.name, dr_minor: Number(row.dr_minor), cr_minor: Number(row.cr_minor) }, row.for ? { for: row.for } : {})),
    ledger_minor: ledgerMinor,
    left_out_minor: leftOutMinor,
    return_minor: returnMinor,
    tie: plain ? 'plain' : 'relabelled',
    tie_ok: plain ? ledgerMinor - leftOutMinor === returnMinor : null
  };
}

/**
 * ⭐ ONE-FIGURE RC2: a LODGED period's net is the stored close (what was shown at the close); the live return moves when something is posted into the period afterwards. This says so, in words, with both carried:
 * the entries dated in the period but posted after the close (lateTaxEntries) and what they moved on the tax ledgers (Cr - Dr, output positive). It never re-solves the close (the balance after the close
 * already holds its own set-off), and never merges the two readings. → null when nothing was posted late · { entries_n, tax_moved_minor, note }
 */
async function changedSinceClose(handle, entity, pack, item, closedAt) {
  const roles = TAX_ROLES.concat(Object.values(pack.taxLedgers || {}).flatMap((head) => [head && head.output, head && head.input, head && head.rcm]).filter(Boolean)),
    taxRoles = Array.from(new Set(roles)),
    late = await require('./books-store-late').lateTaxEntries(handle, entity, item.start, item.end, closedAt, taxRoles, taxRoles.concat(MONEY_ROLES));
  if (!late.length) return null;
  const moved = late.reduce((sum, row) => sum + Number(row.cr_minor) - Number(row.dr_minor), 0);
  return { entries_n: late.length, tax_moved_minor: moved, note: late.length + ' ' + (late.length === 1 ? 'entry' : 'entries') + ' dated in this period ' + (late.length === 1 ? 'was' : 'were') + ' posted after it was closed: the return read now differs from the net it carried.' };
}

/** one lodged period's list row: the net its own close carried (never re-worked), the close date, and — only when something moved since — the said late posting; null for a period with no carried close */
async function lodgedEntry(handle, entity, pack, item, row) {
  const answer = row && row.tax_close && row.tax_close.answer;
  if (!answer) return null;
  const netTotal = answer.owed_before_payments_total_minor != null ? answer.owed_before_payments_total_minor : answer.pay_total_minor,
    closedAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    changed = await changedSinceClose(handle, entity, pack, item, closedAt);
  return Object.assign({ period: item.period, net_minor: Number(netTotal) || 0, closed_at: closedAt, source: 'close' }, changed ? { changed_since_close: changed } : {});
}

/** the Ledger route's one call: the reading when  asks for it on a party-less ledger, else undefined (the key leaves the JSON); the movement is CARRIED from the route's own read (a page's range sums, else closing less opening) */
async function readingOf(ask, handle, entity, account, range) {
  if (ask.asked !== 'return' || ask.party) return undefined;
  const moved = range.t ? range.t.dr - range.t.cr : range.run - range.open;
  return returnReading(handle, entity, await require('./books').ledgerCtx(handle, entity), account, range.from, range.to, moved);
}

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
  await splitAdjustments(handle, entity, ctx, start, end, rows); /* ACC-417: before the capital split, so the plain row stays first */
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

/**
 * ACC-417 (AU BAS 1A / 1B): the pack's returns.adjustments.events (credit note, return, purchase return, write-off: ONE list, in the pack) name the entries whose tax is an ADJUSTMENT (GST Act s.17-10, s.19-55).
 * Each tax-role row is split in two rows of the SAME code: the lines of those entries tagged adj:'adjustment' and the rest, so the row sum (the movement) is unchanged; the pack's bas() reads a decreasing
 * adjustment at 1B and an increasing one at 1A. Read from the posted journal by the entry's stored event type. A pack with no such row is read as before. A reversal (event 'reversal') is not tagged: it nets
 * in the same period and reads as an ordinary movement in a later one.
 */
async function splitAdjustments(handle, entity, ctx, start, end, rows) {
  const events = ctx.pack.returns && ctx.pack.returns.adjustments && ctx.pack.returns.adjustments.events;
  if (!Array.isArray(events) || !events.length) return;
  const heads = ctx.pack.taxLedgers || {};
  const roles = [...new Set(Object.values(heads).flatMap((head) => [head && head.output, head && head.input]).filter(Boolean))];
  for (const role of roles) {
    const at = rows.findIndex((item) => item.role === role && !item.adj);
    if (at < 0) continue;
    const eventTax = await Store.taxOfEvents(handle, entity, start, end, role, events);
    if (!eventTax.dr_minor && !eventTax.cr_minor) continue;
    const whole = rows[at];
    rows.splice(at, 1,
      Object.assign({}, whole, { dr_minor: Number(whole.dr_minor) - eventTax.dr_minor, cr_minor: Number(whole.cr_minor) - eventTax.cr_minor }),
      Object.assign({}, whole, { adj: 'adjustment', dr_minor: eventTax.dr_minor, cr_minor: eventTax.cr_minor }));
  }
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

module.exports = { TAX_ROLES, MONEY_ROLES, SALES_ROLES, splitAdjustments, eventNameOf, taxEventNames, settledOf, returnReading, readingOf, changedSinceClose, lodgedEntry, addTaxedRows, unsupportedInput, unsupportedInputWithNet };
