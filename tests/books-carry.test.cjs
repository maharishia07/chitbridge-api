/**
 * books-carry.test.cjs — l16-scale (5-year growth): a year's carry kept under its key (b873) answers EXACTLY what the carry made from every year answers.
 * Never a second calculation: the kept rows are the engine's own; this compares the two carried answers (kept vs made), and proves the key moves when any earlier year's month rows move,
 * that a carry made FROM the year still being posted into is never kept, and that a kept carry costs one year's rows, not every year's.
 * No database: the store's reads are stand-ins. Run: node tests/books-carry.test.cjs
 */
'use strict';
process.env.DATABASE_URL = '';
const assert = require('assert');
const path = require('path');
const B = require(path.join(__dirname, '..', 'lib', 'books.js'));
const S = require(path.join(__dirname, '..', 'lib', 'books-store.js'));
const E = require(path.join(__dirname, '..', 'lib', 'books-engines.js'));
const SCHEMA = require(path.join(__dirname, '..', 'lib', 'schema.js'));
const CLOCK = require(path.join(__dirname, '..', 'lib', 'shop-clock.js'));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const ENT = '11111111-1111-4111-8111-111111111111';
const setting = { country: 'IN', fy_start_month: 4, functional_currency: 'INR' };
const pack = E.packWith(B.packOf(setting), []);
const YEARS = ['2021-22', '2022-23', '2023-24', '2024-25', '2025-26', '2026-27'];
const NOW = Date.UTC(2026, 10, 16, 6, 0, 0); /* 16 Nov 2026: FY 2026-27 is the one being posted into */
const realNow = CLOCK.now;
CLOCK.now = () => new Date(NOW);

/** each year's month rows: cash Dr / sales Cr / a creditor party, a different size each year */
const rowsOf = (year, bump) => {
  const n = YEARS.indexOf(year) + 1, extra = bump && bump === year ? 777 : 0;
  return [
    { fiscal_year: year, period: 1, code: '1400', party_key: '00000000-0000-0000-0000-000000000000', dr_minor: 100000 * n + extra, cr_minor: 0 },
    { fiscal_year: year, period: 1, code: '4000', party_key: '00000000-0000-0000-0000-000000000000', dr_minor: 0, cr_minor: 100000 * n + extra },
    { fiscal_year: year, period: 2, code: '1400', party_key: '00000000-0000-0000-0000-000000000000', dr_minor: 5000, cr_minor: 0 },
    { fiscal_year: year, period: 2, code: '3000', party_key: '00000000-0000-0000-0000-000000000000', dr_minor: 0, cr_minor: 5000 }
  ];
};

function rig(opt) {
  const o = opt || {};
  const kept = o.kept || new Map();
  const calls = { yearRows: [], carryRead: 0, carryWrite: 0, stamps: 0 };
  const sum = (rows) => ({ n: rows.length, dr: String(rows.reduce((t, r) => t + r.dr_minor, 0)), cr: String(rows.reduce((t, r) => t + r.cr_minor, 0)), lines: String(rows.length) });
  const held = o.rowYears || YEARS; /* the years that hold rows (a year with none is simply absent, as the store's years() lists) */
  S.yearRows = async (db, e, fy) => { calls.yearRows.push(fy); return [].concat(...[].concat(fy).filter((year) => held.includes(year)).map((year) => rowsOf(year, o.bump))); };
  S.yearStamps = async () => { calls.stamps++; return held.map((year) => Object.assign({ fiscal_year: year }, sum(rowsOf(year, o.bump)))); };
  S.carryRead = async (db, e, fy, key) => { calls.carryRead++; return o.noTable ? null : kept.get(fy + '|' + key) || null; };
  S.carryWrite = async (db, e, fy, key, carry) => { calls.carryWrite++; if (!o.noTable) kept.set(fy + '|' + key, JSON.parse(JSON.stringify(carry))); return true; };
  SCHEMA.hasTable = async (name) => (name === 'year_carry' ? !o.noTable : true);
  return { kept, calls, ctx: () => ({ s: setting, chart: [], pack, years: held.slice(), cache: {} }) };
}

(async () => {
  console.log('══ b873 year carry: kept = made ══');

  /* 1. the answer without the table (the carry made from every year, as it always was) is the reference */
  const base = rig({ noTable: true });
  const madeRows = await B.yearBalances({}, ENT, '2026-27', base.ctx());
  ok('without the table the carry is made from every year (no carry write)', base.calls.carryWrite === 0 && madeRows.length > 0);

  /* 2. with the table, a first read makes the carry and keeps one per year that is not carried from the current year */
  const a = rig();
  const first = await B.yearBalances({}, ENT, '2026-27', a.ctx());
  ok('the first read answers the same as the carry made from every year', JSON.stringify(first) === JSON.stringify(madeRows));
  ok('every year\'s carry was kept once (2022-23 … 2026-27 = five); the carry made FROM the year being posted into is never kept', a.kept.size === 5 && ![...a.kept.keys()].some((key) => key.startsWith('2027-28')), 'kept: ' + [...a.kept.keys()].map((k) => k.slice(0, 8)).join(','));

  /* 3. a second read, a fresh context: the kept carry answers, and only this year's rows are read */
  const b = rig({ kept: a.kept });
  const second = await B.yearBalances({}, ENT, '2026-27', b.ctx());
  ok('a kept carry answers exactly what the made carry answered', JSON.stringify(second) === JSON.stringify(madeRows));
  ok('a kept carry costs one year\'s rows (not every year\'s) and writes nothing', b.calls.yearRows.length === 1 && b.calls.yearRows[0] === '2026-27' && b.calls.carryWrite === 0, JSON.stringify(b.calls.yearRows));

  /* 4. the opening-years strip reads each year's carry-out through the same keys: kept = made (retained, profit and rows) */
  const madeOut = await B.carryOut({}, ENT, base.ctx(), '2024-25', await B.yearBalances({}, ENT, '2024-25', base.ctx()));
  const keptOut = await B.carryOut({}, ENT, b.ctx(), '2024-25', await B.yearBalances({}, ENT, '2024-25', b.ctx()));
  ok('a year\'s carry-out kept = made (rows, retained, profit)', madeOut.ok && keptOut.ok && JSON.stringify([keptOut.rows, keptOut.retained_minor, keptOut.profit_minor]) === JSON.stringify([madeOut.rows.map((r) => ({ fiscal_year: r.fiscal_year, period: 0, code: r.code, party: r.party, dr_minor: r.dr_minor, cr_minor: r.cr_minor })), madeOut.retained_minor, madeOut.profit_minor]));

  /* 5. a late correction in an EARLIER year moves its sums, so every later key moves: the old kept carry is not asked for, the carry is made again from the corrected year */
  const sizeBefore = a.kept.size;
  const c = rig({ kept: a.kept, bump: '2022-23' });
  const corrected = await B.yearBalances({}, ENT, '2026-27', c.ctx());
  const reference = rig({ noTable: true, bump: '2022-23' });
  const referenceRows = await B.yearBalances({}, ENT, '2026-27', reference.ctx());
  ok('a correction to an earlier year flows through (the carry is made again, not read from the old key)', JSON.stringify(corrected) === JSON.stringify(referenceRows) && JSON.stringify(corrected) !== JSON.stringify(madeRows));
  ok('and the corrected carry is kept under its own key (the old rows are left, never changed)', c.kept.size > sizeBefore);

  /* 6. a change in the pack the carry is made under (the engine pin) moves the key too */
  const lock = require(path.join(__dirname, '..', 'engines.lock.json'));
  const pinned = lock.pins.ledger;
  lock.pins.ledger = '0.0.1';
  const d = rig({ kept: a.kept });
  await B.yearBalances({}, ENT, '2026-27', d.ctx());
  lock.pins.ledger = pinned;
  ok('another engine pin is another key (the kept rows of the old engine are not read)', d.calls.carryWrite > 0);

  /* 7. F1 (Fable 17 Nov): a year with NO entries must not break the chain of keys. FY 2023-24 has rows, FY 2024-25 none, FY 2025-26 rows; 2026-27 is the open year.
     Hand-computed: the correction adds Dr cash 777 / Cr sales 777 to 2023-24, so 2026-27 must open with 777 more in cash (1400) than before it. */
  const gapYears = ['2023-24', '2025-26'];
  const g1 = rig({ rowYears: gapYears });
  const gapFirst = await B.yearBalances({}, ENT, '2026-27', g1.ctx());
  const g2 = rig({ kept: g1.kept, rowYears: gapYears, bump: '2023-24' });
  const gapAfter = await B.yearBalances({}, ENT, '2026-27', g2.ctx());
  const gapRef = rig({ noTable: true, rowYears: gapYears, bump: '2023-24' });
  const gapRefRows = await B.yearBalances({}, ENT, '2026-27', gapRef.ctx());
  const cashIn = (rows) => rows.filter((r) => r.fiscal_year === '2026-27' && r.period === 0 && r.code === '1400').reduce((t, r) => t + r.dr_minor - r.cr_minor, 0);
  ok('gap year: the carry after a correction in 2023-24 = the carry made from every year', JSON.stringify(gapAfter) === JSON.stringify(gapRefRows));
  ok('gap year: 2026-27 opens with exactly 777 more cash than before the correction', cashIn(gapAfter) - cashIn(gapFirst) === 777, 'before ' + cashIn(gapFirst) + ' after ' + cashIn(gapAfter));

  CLOCK.now = realNow;
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
