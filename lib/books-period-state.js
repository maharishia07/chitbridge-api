/**
 * books-period-state.js — the year-close state of a pack that does not guess its tax period (split out of books-period.js, whose size row may not grow).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      uncoveredState(rows, fiscalYear, table)
 * CALLED BY lib/books-period.js returnStateFor
 * FLOW      the month rows of the year + the period table's refusal → the months no closed tax period covers, in words
 * CARD      14-accounting/README
 */
'use strict';
const Engines = require('./books-engines');
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

module.exports = { uncoveredState, heldAnswersInto, shopChargesTax };
