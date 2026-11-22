/**
 * tests/books-store-gstclass.test.cjs — lib/books-store-gstclass.js taxOfEntriesWith: the net tax of the entries that ALSO carry a line on given ledger roles (AU BAS G10, the capital purchases' GST).
 * OWNS      the proof that the one statement is asked with the shop, the window, the tax role and the roles in that order, that its net comes back as a plain number, that no row reads as nil
 *           (never a guess), and that a read which is down is not swallowed into a nil (the caller refuses).
 * CALLED BY scripts/guards.cjs · CI. No database: a stand-in handle records the statement and answers rows.
 * FLOW      (db, entity, from, to, taxRole, roles) → one query → { net_minor }
 * CARD      14-accounting/README
 * MIN unit-per-rule · MIN refusal-path · MIN fail-closed
 */
'use strict';
const assert = require('assert');
const { taxOfEntriesWith } = require('../lib/books-store-gstclass');
let checks = 0;
const ok = async (name, got, want) => { assert.deepStrictEqual(await got, want, name); checks++; console.log('   ok   ' + name); };
const handle = (rows, boom) => { const seen = []; return { seen, query: async (sql, params) => { seen.push({ sql, params }); if (boom) throw new Error('read down'); return { rows }; } }; };
(async () => {
  const db = handle([{ net_minor: '12345' }]);
  await ok('the net comes back as a number, whatever the driver sent', taxOfEntriesWith(db, 'E1', '2026-07-01', '2026-09-30', 'gst_paid', ['fixed_assets']), { net_minor: 12345 });
  await ok('the statement is asked with the shop, the window, the tax role and the roles, in that order, once', [db.seen.length, db.seen[0].params], [1, ['E1', '2026-07-01', '2026-09-30', 'gst_paid', ['fixed_assets']]]);
  await ok('opening entries are left out and the other role must be on the same entry', [/is_opening IS NOT TRUE/.test(db.seen[0].sql), /b\.role = ANY\(\$5::text\[\]\)/.test(db.seen[0].sql)], [true, true]);
  await ok('no row at all reads as nil, never a guess', taxOfEntriesWith(handle([]), 'E1', '2026-07-01', '2026-09-30', 'gst_paid', ['fixed_assets']), { net_minor: 0 });
  await ok('a null sum reads as nil', taxOfEntriesWith(handle([{ net_minor: null }]), 'E1', '2026-07-01', '2026-09-30', 'gst_paid', ['fixed_assets']), { net_minor: 0 });
  await ok('a credit net stays negative', taxOfEntriesWith(handle([{ net_minor: '-500' }]), 'E1', '2026-07-01', '2026-09-30', 'gst_paid', ['fixed_assets']), { net_minor: -500 });
  let thrown = null;
  try { await taxOfEntriesWith(handle([], true), 'E1', '2026-07-01', '2026-09-30', 'gst_paid', ['fixed_assets']); } catch (e) { thrown = e.message; }
  await ok('a read that is down is not swallowed into a nil (fail closed: the caller refuses)', thrown, 'read down');
  console.log('\n' + checks + ' checks');
})().catch((e) => { console.log('   FAIL ' + e.message); process.exit(1); });
