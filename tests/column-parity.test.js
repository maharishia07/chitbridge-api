'use strict';
/**
 * column-parity.test.js — the three surfaces must answer "what are my columns" identically.
 *
 * ⚠️⚠️ WHY A KEPT TEST AND NOT A ONE-TIME CHECK. These three surfaces AGREED ONCE TOO. They drifted because each
 * was individually reasonable — the export widened for round-trip safety, the template sampled 200 rows for
 * speed, the panel showed the declaration because that is what a declaration is — and nothing anywhere was
 * responsible for the fact that they were answering the same question. A fix with no guard is a fix with an
 * expiry date; this is the guard.
 *
 * The same lesson as e2e/dup-functions.cjs on the web side: "no duplicate functions" had been a standing rule for
 * months and was broken by the person who wrote it, because nothing could fail when it was.
 *
 * ⚠️ NO DATABASE. The resolver's contract is exercised against a fake `query`/`withEntity`, so this runs in CI and
 * on a laptop with no Postgres. What it cannot prove is the SQL itself — that is what the live run is for.
 */
const assert = require('assert');
const C = require('../lib/catalogue-columns');

let pass = 0, fail = 0;
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log('  ✓ ' + name); pass++; })
    .catch((e) => { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; });
}

/** A stand-in for the two database handles the resolver is given. */
function fakeDb({ declared, itemKeys }) {
  const query = async (sql) => {
    if (/FROM schema_fields/.test(sql)) {
      return { rows: declared.map((k, i) => ({
        field_key: k, field_name: k, field_type: 'text', required: false, display_order: i + 1 })) };
    }
    if (/MAX\(display_order\)/.test(sql)) return { rows: [{ m: declared.length }] };
    return { rows: [] };
  };
  const withEntity = async (_e, fn) => fn({
    query: async () => ({ rows: Object.entries(itemKeys).map(([k, n]) => ({ field_key: k, n })) }),
  });
  return { query, withEntity };
}

(async () => {
  console.log('\ncolumn-parity · the three surfaces');

  await t('⭐ declared and observed agree → one list, in declared order', async () => {
    const db = fakeDb({ declared: ['name', 'unit', 'price'], itemKeys: { name: 3, price: 3 } });
    const r = await C.resolveColumns({ ...db, entity_id: 'e', schema_id: 's' });
    assert.deepStrictEqual(r.columns, ['name', 'unit', 'price']);
    assert.deepStrictEqual(r.undeclared, [], 'a declared-first catalogue has nothing undeclared');
  });

  await t('⚠️ a legacy undeclared key is REPORTED, not hidden and not dropped', async () => {
    const db = fakeDb({ declared: ['name', 'price'], itemKeys: { name: 9, price: 9, grade: 2 } });
    const r = await C.resolveColumns({ ...db, entity_id: 'e', schema_id: 's' });
    assert.deepStrictEqual(r.undeclared, ['grade']);
    assert.ok(r.columns.includes('grade'), 'the export would lose it if the resolver dropped it');
    assert.strictEqual(r.columns.indexOf('grade'), 2, 'legacy keys come after the declaration, never inside it');
  });

  await t('⚠️ system fields never appear as columns — they are managed elsewhere', async () => {
    const db = fakeDb({ declared: ['name'], itemKeys: { name: 5, status: 5, avail: 5, categories: 4 } });
    const r = await C.resolveColumns({ ...db, entity_id: 'e', schema_id: 's' });
    assert.deepStrictEqual(r.columns, ['name']);
    assert.deepStrictEqual(r.system.sort(), ['avail', 'categories', 'status']);
  });

  await t('⚠️ bookkeeping keys never appear as columns', async () => {
    const db = fakeDb({ declared: ['name'], itemKeys: { name: 5, category_names: 5, commercials: 2, item_id: 5 } });
    const r = await C.resolveColumns({ ...db, entity_id: 'e', schema_id: 's' });
    assert.deepStrictEqual(r.columns, ['name']);
  });

  await t('undeclared order is STABLE — sorted, never creation order', async () => {
    const a = await C.resolveColumns({ ...fakeDb({ declared: ['name'], itemKeys: { name: 1, zeta: 1, alpha: 1 } }), entity_id: 'e', schema_id: 's' });
    const b = await C.resolveColumns({ ...fakeDb({ declared: ['name'], itemKeys: { name: 1, alpha: 1, zeta: 1 } }), entity_id: 'e', schema_id: 's' });
    assert.deepStrictEqual(a.columns, b.columns, 'the same catalogue must not describe itself two ways');
    assert.deepStrictEqual(a.columns, ['name', 'alpha', 'zeta']);
  });

  await t('⭐ THE INVARIANT: after a declare-first write, observed ⊆ declared', async () => {
    /* One product carrying a new key, planned against the declaration, yields a plan whose every non-reserved
       key is either already declared or in newFields — which is exactly `declared ⊇ observed` at the moment of
       the write, and is why the three surfaces cannot diverge afterwards. */
    const declared = ['name', 'price'];
    const plan = C.planWrite({ item_data: { name: 'Tea', price: 10, grade: 'A', status: 'available' }, declared, labels: {} });
    const after = declared.concat(plan.newFields.map((f) => f.field_key));
    for (const k of Object.keys(plan.item_data)) {
      if (Object.prototype.hasOwnProperty.call(C.RESERVED, k)) continue;
      assert.ok(after.includes(k), 'stored key "' + k + '" was not declared — the invariant is broken');
    }
  });

  await t('a counting failure shows the columns anyway — never an empty catalogue', async () => {
    const db = fakeDb({ declared: ['name', 'price'], itemKeys: {} });
    db.withEntity = async () => { throw new Error('db down'); };
    const r = await C.resolveColumns({ ...db, entity_id: 'e', schema_id: 's' });
    assert.deepStrictEqual(r.columns, ['name', 'price']);
  });

  await t('no schema at all → no columns, and no crash', async () => {
    const db = fakeDb({ declared: [], itemKeys: {} });
    const r = await C.resolveColumns({ ...db, entity_id: 'e', schema_id: null });
    assert.deepStrictEqual(r.columns, []);
  });

  console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed\n');
  process.exit(fail ? 1 : 0);
})();
