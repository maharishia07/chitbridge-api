/**
 * tests/books-bill-ref.test.cjs — AZ-F-03: the one resolver of the names a person calls a booked bill by (lib/books-bill-ref.js namedRef).
 * OWNS      the proof that a stored ref, the keyed client_ref, the entry id, the entry number and the rail bill number each name the same bill; that a name no bill carries
 *           is refused (null, never a guess at the nearest bill); that an empty name is refused before any read; that a read which is down is not swallowed.
 * CALLED BY scripts/guards.cjs · CI. No database: a stand-in handle answers the entry-number read, books-store.billNos is stood in.
 * FLOW      typed + the supplier's party rows → namedRef → the ref or null
 * CARD      14-accounting/README
 * MIN unit-per-rule · MIN refusal-path · MIN fail-closed
 */
'use strict';
const assert = require('assert');
const store = require('../lib/books-store');
const { namedRef } = require('../lib/books-bill-ref');
const ENTITY = '10000000-0000-4000-8000-000000000001';
const ID = '20000000-0000-4000-8000-000000000002';
let reads = 0, fail = false;
store.billNos = async () => ({ 'rail:b1': 'SB-77' });
const handle = { query: async () => { reads++; if (fail) throw new Error('read down'); return { rows: [{ entry_id: ID, entry_no: 'JE-9' }] }; } };
const items = [{ ref: 'bill:1', entry_id: ID, amount_minor: 5000 }, { ref: 'ev:expense:K1', entry_id: null, amount_minor: 100 }, { ref: 'rail:b1', entry_id: null, amount_minor: 900 }, { ref: 'pay:1', entry_id: null, amount_minor: -5000 }];
let checks = 0;
const ok = async (name, got, want) => { assert.deepStrictEqual(await got, want, name); checks++; console.log('   ok   ' + name); };
(async () => {
  await ok('the stored ref names its own bill (no read)', namedRef(handle, ENTITY, items, 'bill:1'), 'bill:1');
  await ok('the keyed client_ref names the expense bill', namedRef(handle, ENTITY, items, 'K1'), 'ev:expense:K1');
  await ok('the entry id names the bill its entry posted', namedRef(handle, ENTITY, items, ID), 'bill:1');
  await ok('the entry number names it (one read of the entries)', namedRef(handle, ENTITY, items, 'JE-9'), 'bill:1');
  await ok('the rail bill number names its bill', namedRef(handle, ENTITY, items, 'SB-77'), 'rail:b1');
  await ok('a payment row is never a bill: its ref is refused', namedRef(handle, ENTITY, items, 'pay:1'), null);
  await ok('a name no bill carries is refused, never the nearest bill', namedRef(handle, ENTITY, items, 'NOPE-1'), null);
  reads = 0;
  await ok('an empty name is refused before any read', [await namedRef(handle, ENTITY, items, ''), reads], [null, 0]);
  fail = true;
  let thrown = null;
  try { await namedRef(handle, ENTITY, items, 'JE-9'); } catch (e) { thrown = e.message; }
  await ok('a read that is down is not swallowed into "no such bill" (fail closed: the caller refuses)', thrown, 'read down');
  console.log('\n' + checks + ' checks');
})().catch((e) => { console.log('   FAIL ' + e.message); process.exit(1); });
