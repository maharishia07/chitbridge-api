'use strict';
/**
 * tests/new-firm-access.test.cjs — Athi 21 Nov: a NEW firm starts on client_access = 'assigned' (a staff seat sees its own clients and the unassigned);
 * a row that already exists keeps its stored value. No SQL: the helper sets the value right after the row is made, and only where the column exists (b881).
 * OWNS the stand-in shop below. CALLED BY scripts/guards.cjs.
 */
const assert = require('assert');
const A = require('../lib/assign-register');
let pass = 0;
const ok = (what, fn) => { fn(); pass++; console.log('  ok  ' + what); };
function shop(hasColumn) {
  const calls = [];
  return { calls, query: async (sql, args) => { calls.push(sql.replace(/\s+/g, ' ').slice(0, 60)); if (/information_schema/.test(sql)) return { rows: hasColumn ? [{}] : [] }; return { rows: [{ entity_id: args && args[0] }] }; } };
}
(async () => {
  const s1 = shop(true); await A.newFirmRow(s1, 'e1');
  ok('a new firm: the row is made, then set to assigned, then read back', () => assert.deepStrictEqual(s1.calls.map((c) => c.split(' ')[0] + ' ' + (c.match(/information_schema|SET client_access = 'assigned'|FROM entity_actor_settings|INTO entity_actor_settings/) || [''])[0]), ['INSERT INTO entity_actor_settings', 'SELECT information_schema', 'UPDATE SET client_access = \'assigned\'', 'SELECT FROM entity_actor_settings']));
  const s2 = shop(false); await A.newFirmRow(s2, 'e2');
  ok('a database before b881 has no column: nothing is set, no failing statement', () => assert.ok(!s2.calls.some((c) => /^UPDATE/.test(c))));
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'actors.js'), 'utf8');
  ok('GET /actors/settings makes the default row through newFirmRow, so a stored row is never touched', () => assert.ok(/newFirmRow\(shop, entity_id\)/.test(src) && !/UPDATE entity_actor_settings SET client_access = 'assigned'/.test(src)));
  ok('PUT sets it only when the save made the row (no row before, no client_access in the body)', () => assert.ok(/else if \(!before\.entity_id\) await require\('\.\.\/lib\/assign-register'\)\.newFirmAccess/.test(src)));
  console.log('\n  ' + pass + ' checks');
})().catch((e) => { console.log('FAIL ' + e.message); process.exitCode = 1; });
