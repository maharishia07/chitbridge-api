/**
 * books-period-state.js — the year-close state of a pack that does not guess its tax period (split out of books-period.js, whose size row may not grow).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      uncoveredState(rows, fiscalYear, table) · heldAnswersInto · shopChargesTax · markNilRun · redoRef · optionsWithNeed (the small steps of the year-close and the return)
 * CALLED BY lib/books-period.js returnStateFor
 * FLOW      the month rows of the year + the period table's refusal → the months no closed tax period covers, in words
 * CARD      14-accounting/README
 */
'use strict';
const Engines = require('./books-engines');
const Store = require('./books-store');
const Assets = require('./books-assets');
const { lockedByTaxClose } = require('./books-period-lock');

/** the name of a month for a sentence: 'Jan 2026' — from the books' own month row */
const MONTH_WORDS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthWords = (row) => {
  const day = Engines.ymd(row.start_date); /* the one date reader: a pg date arrives as a Date */
  return MONTH_WORDS[Number(day.slice(5, 7)) - 1] + ' ' + day.slice(0, 4);
};
/**
 * l16-accfix CTY-new-1 · a pack that does not guess its tax period (AE: the FTA assigns the stagger, nothing stores it yet) has no period table, so the year close used to find nothing
 * to wait for and never fired. The gate asks the stagger-free question instead: is every month of the year covered by a closed tax period (the months a tax close locked)? The months not covered
 * are the open ones; their codes are the shop's own to give (the close takes the period code the stagger names), so `open_codes` is empty and `needs` says why.
 * → the state's own fields: { applies: true, needs, why, periods: [] (no per-month label without a table), open: [month words], open_codes: [] }
 */
function uncoveredState(rows, fiscalYear, table) {
  const open = rows.filter((row) => row.fiscal_year === fiscalYear && Number(row.period) >= 1 && !lockedByTaxClose(row)).map(monthWords);
  return { applies: true, needs: table.needs, why: table.why, periods: [], open, open_codes: [] };
}

/** the setup answers the shop holds (emirate · period) as the return's own query, a sent value winning; a pack that asks nothing costs no read */
async function heldAnswersInto(handle, entity, pack, query) {
  const asks = require('./country-asks');
  if (!asks.asksOf(pack).length) return query;
  const row = (await handle.query('SELECT tax_registration FROM entity_governance WHERE entity_id = $1', [entity])).rows[0];
  return asks.returnQueryOf(row && row.tax_registration ? row.tax_registration.asked : null, query);
}
/** does the shop charge its tax — tax-shelf.chargesTax over the registration facts (never "has a tax id"); books-todo reads the same door */
async function shopChargesTax(handle, entity, setting) {
  const registration = await require('./books-store').taxRegistration(handle, entity);
  return require('./tax-shelf').chargesTax(registration, require('./tax-packs').packFor(setting && setting.country));
}

/** a year-end run with nothing to depreciate posts no entry: its marker is one change-log row, so the year close reads "depreciation run" (F3 LEFT, 1128) */
async function markNilRun(handle, entity, by, source_ref, run) {
  if (run.plan.event || run.through !== run.range.end) return;
  await Store.logChange(handle, entity, { by, table_name: Assets.NIL_RUN.table, row_id: source_ref, field: Assets.NIL_RUN.field, old: 'not run', new: 'run, nothing to depreciate for ' + run.fiscalYear });
}
/** the redo of a reversed run is its own entry (source_ref is unique): the base reference, with :rN after N-1 earlier runs */
function redoRef(baseRef, earlier) {
  return earlier.length ? baseRef + ':r' + (earlier.length + 1) : baseRef;
}
/** the engine's input-tax note also fires on 0% sales that name no kind: the return's options carry that amount (0 when nothing waits) */
function optionsWithNeed(opts, need) {
  return Object.assign(opts, { unanswered_minor: need ? need.total_minor : 0 });
}
module.exports = { uncoveredState, heldAnswersInto, shopChargesTax, markNilRun, redoRef, optionsWithNeed };
