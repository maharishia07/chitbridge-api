'use strict';
/**
 * tests/bound-db.test.cjs — the self-test of the offline shop-binding double (tests/support/bound-db.cjs): the double is only worth its fail-closed claims if they hold.
 * OWNS    the proof that a blank id sees nothing, an other-shop entity_id predicate sees nothing, schemaRows scopes a schema_id-only statement, and the one documented limit.
 * CALLED BY scripts/guards.cjs · Run: node tests/bound-db.test.cjs · no database
 */
const assert = require('assert');
const { boundDb, schemaRows, refuseUnbound } = require('./support/bound-db.cjs');
const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';
const SHOPS = { [A]: { schema_id: 's-a', fields: [{ field_key: 'k' }] }, [B]: { schema_id: 's-b', fields: [] } };
const BY_ENTITY = 'SELECT schema_id FROM entity_schemas WHERE entity_id = $1';
const BY_SCHEMA = 'SELECT field_key FROM schema_fields WHERE schema_id = $1';
let n = 0;
const t = async (name, fn) => { try { await fn(); n++; console.log('  ok   ' + name); } catch (e) { console.log('  FAIL ' + name + '
       ' + e.message); process.exit(1); } };

(async () => {
  await t('a blank, null or undefined binding sees no row, and the call is still recorded', async () => {
    const db = boundDb(schemaRows(SHOPS));
    for (const id of ['', null, undefined]) assert.strictEqual((await db.queryAs(id, BY_ENTITY, [A])).rowCount, 0);
    assert.strictEqual(db.calls.length, 3);
  });
  await t('an entity_id predicate naming ANOTHER shop than the binding sees no row; the bound shop sees its own', async () => {
    const db = boundDb(schemaRows(SHOPS));
    assert.strictEqual((await db.queryAs(A, BY_ENTITY, [B])).rowCount, 0);
    assert.deepStrictEqual((await db.queryAs(A, BY_ENTITY, [A])).rows, [{ schema_id: 's-a' }]);
  });
  await t('a schema_id-only statement: schemaRows gives shop A nothing for shop B's schema id', async () => {
    const db = boundDb(schemaRows(SHOPS));
    assert.strictEqual((await db.queryAs(A, BY_SCHEMA, ['s-b'])).rowCount, 0);
    assert.strictEqual((await db.queryAs(A, BY_SCHEMA, ['s-a'])).rowCount, 1);
  });
  await t('LIMIT (documented in the header): with a plain rowsFor a schema_id-only statement is NOT refused, the rowsFor decides; refuseUnbound refuses the unbound reader', async () => {
    const db = boundDb(() => [{ field_key: 'leak' }]);
    assert.strictEqual((await db.queryAs(A, BY_SCHEMA, ['s-b'])).rowCount, 1);
    assert.throws(() => refuseUnbound(BY_SCHEMA), /unbound read/);
  });
  console.log('bound-db.test: ' + n + ' checks pass');
})();
