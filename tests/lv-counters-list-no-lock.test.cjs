/**
 * lv-counters-list-no-lock.test.cjs — speed-counter-01 F6 (batch 1129): GET /api/counters lists the register WITHOUT FOR UPDATE on the shop's identities row; every write path still reads it FOR UPDATE.
 * A list that finds a till key not yet adopted (a write follows) falls through to the locked read, so adoption is unchanged. Same answer either way, on a fixture db. Run: node tests/lv-counters-list-no-lock.test.cjs
 */
'use strict';
process.env.DATABASE_URL = '';
const path = require('path');
const fs = require('fs');
const store = require(path.join(__dirname, '..', 'lib', 'counters-store.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const fake = (flags) => { const sql = []; return { sql, query: async (text) => { sql.push(text); return { rows: [{ policy_flags: JSON.parse(JSON.stringify(flags)) }] }; } }; };
const adopted = { counters: { C1: { id: 'C1', name: 'Counter C1', held_by: 'jti1', held_at: '2026-11-22T01:00:00Z' } }, api_keys: [{ jti: 'jti1', scopes: ['till'], till: { id: 'c1' }, counter: 'C1', created_at: '2026-11-21T01:00:00Z' }, { jti: 'jti2', scopes: ['read'] }], devices: { d1: { label: 'phone' } } };
const unadopted = { counters: {}, api_keys: [{ jti: 'jti9', scopes: ['till'], till: { id: 'C2' }, created_at: '2026-11-21T01:00:00Z' }] };
const closedKey = { counters: {}, api_keys: [{ jti: 'jti8', scopes: ['till'], till: { id: 'C3', closed_at: '2026-11-20T01:00:00Z' } }] };
const locked = (db) => db.sql.some((text) => /FOR UPDATE/.test(text));

(async () => {
  console.log('LV · the counters list takes no row lock');
  const listDb = fake(adopted), writeDb = fake(adopted);
  const listed = await store.readLocked(listDb, 'e1', { readOnly: true }), lockedRead = await store.readLocked(writeDb, 'e1');
  ok('the list read of an adopted register issues no FOR UPDATE (one plain SELECT)', !locked(listDb) && listDb.sql.length === 1, JSON.stringify(listDb.sql));
  ok('the write-path read (no option) still issues FOR UPDATE', locked(writeDb));
  ok('same answer: counters, key list, till keys, devices, flags are equal either way', JSON.stringify(listed) === JSON.stringify(lockedRead));
  const pendingDb = fake(unadopted);
  try { await store.readLocked(pendingDb, 'e1', { readOnly: true }); } catch (_) { /* the fixture has no policy writer: adoption reaching the write is the point */ }
  ok('a till key not yet adopted: the list falls through to the locked read (the write path is unchanged)', locked(pendingDb) && pendingDb.sql.length >= 2, JSON.stringify(pendingDb.sql.slice(0, 2)));
  const closedDb = fake(closedKey);
  await store.readLocked(closedDb, 'e1', { readOnly: true });
  ok('a closed key needs no adoption: no lock', !locked(closedDb));
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'counters.js'), 'utf8');
  const lines = route.split('\n').filter((line) => /readLocked\(db, entity_id/.test(line));
  ok('only the GET / list passes readOnly; the five write handlers read locked', lines.filter((line) => /readOnly: true/.test(line)).length === 1 && lines.length === 6, lines.join(' | '));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
