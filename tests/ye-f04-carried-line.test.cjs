/**
 * ye-f04-carried-line.test.cjs — YE-F-04 (walk YE 21 Nov): Retained earnings' opening is named, not a bare balance.
 * The close design (statements R3) computes the roll (no closing entry), also for a year not closed; B.carriedLine says what the roll is:
 * the profit of the year before and the whole retained balance, and whether that year is closed.
 * HAND-COMPUTED  years 2021-22..2025-26 each sell 100000 x n (n = 1..5) with no cost: 2025-26 profit 500000, the roll into 2026-27 = 1,500,000.
 * No database. Run: node tests/ye-f04-carried-line.test.cjs
 */
'use strict';
process.env.DATABASE_URL = '';
const path = require('path');
const B = require(path.join(__dirname, '..', 'lib', 'books.js'));
const S = require(path.join(__dirname, '..', 'lib', 'books-store.js'));
const E = require(path.join(__dirname, '..', 'lib', 'books-engines.js'));
const SCHEMA = require(path.join(__dirname, '..', 'lib', 'schema.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const ENT = '11111111-1111-4111-8111-111111111111';
const setting = { country: 'IN', fy_start_month: 4, functional_currency: 'INR' };
const pack = E.packWith(B.packOf(setting), []);
const YEARS = ['2021-22', '2022-23', '2023-24', '2024-25', '2025-26', '2026-27'];
const rowsOf = (year) => { const n = YEARS.indexOf(year) + 1, z = '00000000-0000-0000-0000-000000000000'; return [{ fiscal_year: year, period: 1, code: '1400', party_key: z, dr_minor: 100000 * n, cr_minor: 0 }, { fiscal_year: year, period: 1, code: '4000', party_key: z, dr_minor: 0, cr_minor: 100000 * n }]; };
const ctx = () => ({ s: setting, chart: [], pack, years: YEARS.slice(), cache: {} });
S.yearRows = async (db, e, fy) => [].concat(...[].concat(fy).map(rowsOf));
S.yearStamps = async () => [];
S.carryRead = async () => null; S.carryWrite = async () => true;
SCHEMA.hasTable = async (name) => name !== 'year_carry';
(async () => {
  let held = (fy) => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((p) => ({ fiscal_year: fy, period: p, status: fy === '2025-26' ? 'hard_locked' : 'open' }));
  S.periods = async (db, e, fy) => held(fy);
  const open = await B.carriedLine({}, ENT, '2026-08-10', ctx());
  ok('2026-27 opens with 2025-26 profit 500000 rolled; the whole roll 1500000', open && open.from_year === '2025-26' && open.to_year === '2026-27' && open.profit_minor === 500000 && open.retained_minor === 1500000, JSON.stringify(open));
  ok('it is labelled computed, and the closed year is said closed', open.computed === true && open.year_closed === true);
  held = (fy) => [1, 2, 3].map((p) => ({ fiscal_year: fy, period: p, status: 'open' }));
  const notClosed = await B.carriedLine({}, ENT, '2026-08-10', ctx());
  ok('a year not closed still rolls (the next balance sheet needs it) and says it is not closed', notClosed.retained_minor === 1500000 && notClosed.year_closed === false, JSON.stringify(notClosed));
  const first = await B.carriedLine({}, ENT, '2021-08-10', ctx());
  ok('the first year has no roll: null', first === null);
  console.log('\n' + (pass + fail) + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
