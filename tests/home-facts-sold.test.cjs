/**
 * tests/home-facts-sold.test.cjs — lib/home-facts-sold.js: the Home Till card's books day (Sold, bills, Takings) from the Day book's own rows (M144, REP-52, BD-F-01).
 * OWNS      the proof that figures are the Day book's rows in major units (never recomputed), that a day with no entry or two currencies reads as no figure (null, never a sum across them),
 *           that the newest usable day is picked from the days already read, that a ledger not provisioned is quiet (null) and any other fault is thrown, not hidden.
 * CALLED BY scripts/guards.cjs · CI. No database: db.withEntity and books-store.soldByDay are stood in.
 * FLOW      soldByDay row → booksFiguresOf → { bills, sales, takings } ; days → newestBooksDay → { key, figures } ; (ctx, day) → booksDay
 * CARD      28-platform-and-operations/home-facts
 * MIN unit-per-rule · MIN refusal-path · MIN fail-closed
 */
'use strict';
const assert = require('assert');
const db = require('../db');
const booksStore = require('../lib/books-store');
let fail = null;
db.withEntity = async (entity, work) => work({});
booksStore.soldByDay = async () => { if (fail) throw fail; return [{ day: '2026-11-20', bills: 3, sold: { minor: 150050, currency: 'INR' }, taken: { minor: 100000, currency: 'INR' } }]; };
const H = require('../lib/home-facts-sold');
let checks = 0;
const ok = async (name, got, want) => { assert.deepStrictEqual(await got, want, name); checks++; console.log('   ok   ' + name); };
const row = (day, sold, taken, cur) => ({ day, bills: 1, sold: { minor: sold, currency: cur || 'INR' }, taken: { minor: taken, currency: cur || 'INR' } });
(async () => {
  await ok('a day is the Day book figures in major units', H.booksFiguresOf(row('2026-11-20', 150050, 100000), 'INR'), { bills: 1, sales: 1500.5, takings: 1000 });
  await ok('no entry that day: no figure', H.booksFiguresOf(undefined, 'INR'), null);
  await ok('two currencies in one day (a null minor): no figure rather than a sum across them', H.booksFiguresOf({ bills: 2, sold: { minor: null, currency: null }, taken: { minor: 5, currency: 'INR' } }, 'INR'), null);
  await ok('newest usable day is picked from the days already read', H.newestBooksDay({ state: 'read', days: [row('2026-11-18', 100, 100), row('2026-11-19', 200, 100)] }, 'INR'), { key: '2026-11-19', figures: { bills: 1, sales: 2, takings: 1 } });
  await ok('a day in another currency is skipped, the older one in this currency is taken', H.newestBooksDay({ state: 'read', days: [row('2026-11-18', 100, 100), row('2026-11-19', 200, 100, 'USD')] }, 'INR'), { key: '2026-11-18', figures: { bills: 1, sales: 1, takings: 1 } });
  await ok('books off or unread: no day', [H.newestBooksDay({ state: 'off', days: [] }, 'INR'), H.newestBooksDay(null, 'INR')], [null, null]);
  await ok('booksDay reads the one named day through the one sold rule', H.booksDay({ entity: 'E1' }, '2026-11-20', 'INR'), { bills: 3, sales: 1500.5, takings: 1000 });
  fail = Object.assign(new Error('relation missing'), { code: '42P01' });
  await ok('a ledger not provisioned yet is quiet: no figure, the card falls back', H.booksDay({ entity: 'E1' }, '2026-11-20', 'INR'), null);
  fail = new Error('db down');
  let thrown = null;
  try { await H.booksDay({ entity: 'E1' }, '2026-11-20', 'INR'); } catch (e) { thrown = e.message; }
  await ok('any other fault is thrown, never hidden as "no sales" (fail closed)', thrown, 'db down');
  console.log('\n' + checks + ' checks');
})().catch((e) => { console.log('   FAIL ' + e.message); process.exit(1); });
