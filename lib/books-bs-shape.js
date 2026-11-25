'use strict';
/**
 * lib/books-bs-shape.js — THE SHAPES OF THE P&L AND BALANCE SHEET ANSWERS (moved out of routes/books.js, read1129routes)
 * OWNER     cb-accounting
 * RISK      money-adjacent: regroups the engine's own lines and sums them through books-money-ops; no figure is made up here
 * FLOW      the engine's Schedule III lines -> flat rows · sideOf one side's heads with totals · sched3 both sides and whether they balance · bsTagged each ledger with its earlier days
 * OWNS      flat · sideOf · sched3 · bsTagged
 * CALLED BY routes/books.js (GET /pl, GET /bs) · tests/route-modules-1129.test.cjs
 * CARD      14-accounting/statements-tb-pandl-bs-party-statement
 */
const moneyOps = require('./books-money-ops');

/** Schedule III lines → the flat ledger rows a screen lists ({ code, name, amount_minor, line }) */
function flat(lines) {
  const out = [];
  (lines || []).forEach((item) =>
    (item.accounts || []).forEach((account) => out.push({ code: account.code, name: account.name, amount_minor: account.amount_minor, line: item.label, role: account.role }))
  );
  return out;
}
/**
 * The engine's Schedule III lines → one side as the statement prints it: heads in the pack's order, each with its ledgers and a head total.
 * ⭐ Only a regrouping of what CBLedger.balanceSheet returned — no figure is computed here beyond adding up the engine's own lines.
 * The year's profit so far (the engine's code-less 'profit_to_date' line) is named "Net profit" / "Net loss", sign kept.
 */
function sideOf(lines, order, currency) {
  const rank = (slot) => {
    const position = order.indexOf(slot);
    return position < 0 ? order.length : position;
  };
  const heads = (lines || [])
    .map((item, index) => ({ entry: item, at: index }))
    .sort((first, second) => rank(first.entry.line) - rank(second.entry.line) || first.at - second.at)
    .map(({ entry: ledgerLine }) => ({
      line: ledgerLine.line,
      label: ledgerLine.label,
      total_minor: ledgerLine.amount_minor,
      ledgers: (ledgerLine.accounts || []).map((item) =>
        item.role === 'profit_to_date'
          ? { code: null, name: item.amount_minor < 0 ? 'Net loss' : 'Net profit', amount_minor: item.amount_minor, role: 'profit_to_date' }
          : { code: item.code, name: item.name, amount_minor: item.amount_minor }
      )
    }));
  return { heads, total_minor: moneyOps.sumMinor(heads, currency, (item) => item.total_minor) };
}
function sched3(balanceSheet, order, currency) {
  const equity = sideOf(balanceSheet.liabilities, order, currency),
    assets = sideOf(balanceSheet.assets, order, currency),
    diff = moneyOps.diffMinor(assets.total_minor, equity.total_minor, currency);
  return { equity_and_liabilities: equity, assets: assets, balanced: diff === 0, difference_minor: diff };
}
/** GET /bs: each ledger of one side with its figure at each earlier day, by code (a ledger new since then reads 0, an earlier day that could not be read says null), and its heading */
function bsTagged(list, earlier, headOf, currency) {
  const reportPeriod = require('../lib/books-report-period'),
    yearSide = earlier.year,
    /* leader-compare #2: last year's change only when that day held figures: a year before the books began draws no Last year column, never a column of nils */
    compared = !!yearSide && !!(yearSide.bs.total_assets_minor || yearSide.total_liabilities_minor || yearSide.total_equity_minor);
  return list.map((item) => {
    const was = (key) => {
      const side = earlier[key];
      if (!side) return null;
      const hit = [].concat(side.assets, side.liabilities, side.equity).find((x) => (x.code || x.role) === (item.code || item.role));
      return hit ? hit.amount_minor : 0;
    };
    const vary = compared ? { change_minor: moneyOps.diffMinor(item.amount_minor, was('year'), currency), change_bp: reportPeriod.changeOf(item.amount_minor, was('year'), currency), change_over: reportPeriod.overThreshold(item.amount_minor, was('year'), currency) } : {};
    return Object.assign({}, item, { prior_month_minor: was('month'), prior_year_minor: was('year'), group: item.code ? headOf(item.code) : null }, vary);
  });
}

module.exports = { flat, sideOf, sched3, bsTagged };
