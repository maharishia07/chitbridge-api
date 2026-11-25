/**
 * reviews4-stock-gates.test.cjs — batch 1129, GF-orders-stock-01 M8 / M9 / M10. Run: node tests/reviews4-stock-gates.test.cjs (no DB).
 * M8 one non-uuid item id does not make every line's flag read fail; M9 a sale line with an unreadable lot still moves stock; M10 supplies writes carry the write gate.
 */
'use strict';
const assert = require('assert'), path = require('path'), fs = require('fs');
const API = path.join(__dirname, '..');
const stubId = require.resolve(path.join(API, 'db'));
require.cache[stubId] = { id: stubId, filename: stubId, loaded: true, exports: { withEntity: async (_e, fn) => fn({ query: async () => ({ rows: [] }) }), query: async () => ({ rows: [] }), readBatch: async () => [{ rows: [] }] } };
const stocked = require(path.join(API, 'lib', 'stocked'));
const SF = require(path.join(API, 'lib', 'stock-from-chit'));
let pass = 0, fail = 0;
const it = async (n, f) => { try { await f(); pass++; console.log('  ok  ' + n); } catch (e) { fail++; console.log('  XX  ' + n + ' — ' + e.message); } };
(async () => {
  await it('M8 a stray non-uuid id does not make the flag read unreadable for the real ids', async () => {
    const GOOD = 'a1000000-0000-4000-8000-00000000d05a';
    const withEntity = async (_e, fn) => fn({ query: async (sql, p) => { if (p[1].some((x) => !/^[0-9a-f-]{36}$/i.test(x))) throw Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' }); return { rows: [{ item_id: GOOD, batch_tracked: null, stocked: false }] }; } });
    const read = await stocked.flagsFor('E1', [GOOD, 'abc'], withEntity, { trade: null });
    assert.strictEqual(read.by.get(GOOD).counted, true === false);
    
  });
  await it('M9 a counter-bill line with an unreadable lot still issues its quantity (a sale never drops for its lot)', () => {
    const mv = SF.movementsFor({ chit_id: 'c1', purpose: 'order', business_json: { bill_no: 'B1' }, created_at: '2026-11-21T10:00:00Z', line_items: [{ item_id: 'a1000000-0000-4000-8000-00000000d05a', quantity: 2, item_data: { lot: 'x'.repeat(25) } }] });
    assert.ok(mv.length === 1 && !mv[0].skip, JSON.stringify(mv));
    assert.strictEqual(mv[0].lot, null);
  });
  await it('M10 every supplies write carries the one write gate', () => {
    const src = fs.readFileSync(path.join(API, 'routes', 'supplies.js'), 'utf8');
    const writes = src.match(/router\.(post|patch|put|delete)\([^\n]*/g) || [];
    assert.ok(writes.length >= 4);
    for (const w of writes) assert.ok(/access\.writeGate/.test(w), w);
  });
  console.log('\n' + (fail ? 'FAIL ' + fail + ', ' : 'ok ') + pass + ' passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
