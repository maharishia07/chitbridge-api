'use strict';
/**
 * mint-product.test.cjs — lib/mint-product.js: THE ONE WAY A PRODUCT ENTERS A CATALOGUE (INT7d-GREEN; CRM-FIX/SEC-FIX2 C4 carried the code).
 *
 * Runs the real mintProduct against stand-ins for the database and its helpers (no DB, no network):
 *   · a declared product is stamped in the OWNING entity's currency and inserted ONCE under the entity's own RLS (withEntity)
 *   · a refusal from declaring (SERVER_OWNED) comes back WITH its code and nothing is written
 *   · the meter and the shop-changed signal are best-effort: a helper that throws never blocks the write
 *   · the schema the declaration settled on is the one the row is inserted under
 * Run: node tests/mint-product.test.cjs · MIN unit-per-rule · refusal-path · fail-closed
 */
const assert = require('assert');
const catalogueColumns = require('../lib/catalogue-columns'), regional = require('../lib/regional'), meter = require('../lib/meter'), shopchanged = require('../lib/shopchanged');
const { mintProduct } = require('../lib/mint-product');

let pass = 0;
const it = async (what, run) => { try { await run(); pass++; console.log('  ok  ' + what); } catch (e) { process.exitCode = 1; console.log('  FAIL ' + what + '\n      ' + e.message); } };

/** a stand-in set: what ensureDeclared answers, and a recorder for the INSERT, the meter and the signal */
function standIn(declared) {
  const seen = { inserts: [], metered: 0, signalled: 0 };
  catalogueColumns.ensureDeclared = async () => declared;
  regional.currencyFor = async () => 'AUD';
  meter.meter = () => { seen.metered++; return Promise.resolve(); };
  shopchanged.shopChanged = () => { seen.signalled++; };
  const withEntity = async (entity, run) => run({ query: async (sql, params) => { seen.inserts.push({ entity, sql, params }); return { rows: [{ item_id: 'item-1', item_data: JSON.parse(params[2]) }] }; } });
  return { seen, withEntity };
}

(async () => {
  await it('a declared product is stamped in the entity currency and inserted once, under the schema declaring settled on', async () => {
    const { seen, withEntity } = standIn({ item_data: { name: 'Tea', price: 10 }, schema_id: 'schema-9', declared: ['price'], warnings: [] });
    const out = await mintProduct({ query: async () => ({ rows: [] }), withEntity, entity_id: 'E1', schema_id: 'schema-1', item_data: { name: 'Tea', price: 10 }, rid: 'r1' });
    assert.strictEqual(seen.inserts.length, 1, 'one INSERT');
    assert.strictEqual(seen.inserts[0].entity, 'E1');
    assert.strictEqual(seen.inserts[0].params[1], 'schema-9', 'the declared schema wins over the one passed in');
    assert.deepStrictEqual(JSON.parse(seen.inserts[0].params[2]).price, { amount: 10, currency: 'AUD' });
    assert.deepStrictEqual(out.declared, ['price']);
    assert.strictEqual(out.item.item_id, 'item-1');
  });
  await it('a refusal from declaring comes back with its code, and nothing is written (SERVER_OWNED)', async () => {
    const { seen, withEntity } = standIn({ error: 'Pictures and video are added from the product’s Media.', code: 'SERVER_OWNED' });
    const out = await mintProduct({ query: async () => ({ rows: [] }), withEntity, entity_id: 'E1', schema_id: 'schema-1', item_data: { media: ['x'] } });
    assert.strictEqual(out.code, 'SERVER_OWNED');
    assert.ok(/Media/.test(out.error));
    assert.strictEqual(seen.inserts.length, 0, 'no INSERT on a refusal');
    assert.strictEqual(seen.metered, 0);
  });
  await it('a refusal without a code answers code null (never undefined)', async () => {
    const { withEntity } = standIn({ error: 'That field is not allowed.' });
    const out = await mintProduct({ query: async () => ({ rows: [] }), withEntity, entity_id: 'E1', schema_id: 's', item_data: {} });
    assert.strictEqual(out.code, null);
  });
  await it('the meter and the signal are best-effort: a helper that throws never blocks the write', async () => {
    const { seen, withEntity } = standIn({ item_data: { name: 'Tea' }, schema_id: 's', declared: [], warnings: [] });
    meter.meter = () => { throw new Error('meter down'); };
    shopchanged.shopChanged = () => { throw new Error('signal down'); };
    const out = await mintProduct({ query: async () => ({ rows: [] }), withEntity, entity_id: 'E1', schema_id: 's', item_data: { name: 'Tea' } });
    assert.strictEqual(seen.inserts.length, 1);
    assert.strictEqual(out.item.item_id, 'item-1');
  });
  await it('a failed INSERT surfaces as itself (fail closed — no half-minted product reported as made)', async () => {
    standIn({ item_data: { name: 'Tea' }, schema_id: 's', declared: [], warnings: [] });
    const failing = async () => { throw new Error('rls denied'); };
    await assert.rejects(() => mintProduct({ query: async () => ({ rows: [] }), withEntity: failing, entity_id: 'E1', schema_id: 's', item_data: { name: 'Tea' } }), /rls denied/);
  });
  console.log('\n  ' + pass + ' passed · ' + pass + ' checks');
})();
