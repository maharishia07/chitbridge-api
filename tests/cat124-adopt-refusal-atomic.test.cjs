/**
 * tests/cat124-adopt-refusal-atomic.test.cjs — CAT-124 F1: a refused adopt / catalogue mint leaves NO category behind.
 *
 * Before: the route created the categories (their own transaction), THEN writeItems validated; a refusal answered "nothing was written" while a
 * category "Vegetables" now existed (SIT proof sit-au, case F1). Now catwrite.writeCitedItems does both in ONE transaction and a refusal rolls back.
 * The stand-in db is a transaction that stages its rows and keeps them only when the withEntity callback resolves (rolls back on a throw).
 * Run: node tests/cat124-adopt-refusal-atomic.test.cjs   (no live database)
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(78) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};

const { boundDb, schemaRows } = require('./support/bound-db.cjs');
const STORE = { categories: [], items: [] }; /* what is COMMITTED */
let seq = 0;
const FIELDS = [{ field_key: 'name', field_name: 'Name', field_type: 'text', required: true }];
const bound = boundDb(schemaRows({ e1: { schema_id: 's1', fields: FIELDS } })); /* SEC-75: schema reads are bound; only e1 has a schema */
require.cache[require.resolve(API + '/db')] = {
  exports: {
    query: async () => ({ rows: [] }),
    queryAs: bound.queryAs, queryFor: bound.queryFor, /* SEC-75: bound to the shop; only e1 has a schema, another id reads nothing */
    withEntity: async (_id, fn) => {
      const staged = { categories: STORE.categories.slice(), items: STORE.items.slice() };
      const db = {
        query: async (sql, params) => {
          if (/FROM definition\b/.test(sql) && /SELECT/.test(sql) && !/INSERT/.test(sql)) return { rows: staged.categories.map((c) => ({ id: c.id, name: c.name })) };
          if (/INSERT INTO definition \(/.test(sql)) {
            const rows = params[1].map((name) => ({ definition_id: 'd' + ++seq, name }));
            rows.forEach((r) => staged.categories.push({ id: r.definition_id, name: r.name }));
            return { rows };
          }
          if (/INSERT INTO definition_version/.test(sql)) return { rows: [] };
          if (/INSERT INTO catalogue_items/.test(sql)) {
            const rows = params[2].map((x) => ({ item_id: 'i' + ++seq, item_data: JSON.parse(x) }));
            rows.forEach((r) => staged.items.push(r));
            return { rows };
          }
          return { rows: [] };
        }
      };
      const out = await fn(db); /* a throw leaves STORE untouched = rolled back */
      STORE.categories = staged.categories;
      STORE.items = staged.items;
      return out;
    }
  }
};
require(API + '/lib/regional').currencyFor = async () => 'INR';
require(API + '/lib/catalogue-columns').ensureDeclaredMany = async (o) => ({ items: o.items, invalid: [], schema_id: o.schema_id });
const categories = require(API + '/lib/categories');
categories.listCategories = async (_e, io) => io.withEntity(_e, async (db) => (await db.query('SELECT FROM definition')).rows);
const catwrite = require(API + '/lib/catalogue-write');

(async () => {
  console.log('\n-- CAT-124 F1 · adopt: categories and items in one transaction --\n');

  const refusedRun = await catwrite.writeCitedItems({ entity_id: 'e1', items: [{ name: 'Tomato', categoryName: 'Vegetables' }, { name: '', categoryName: 'Vegetables' }], by: 'u1' });
  t('a refused write answers ok:false, 400, nothing written', [refusedRun.ok, refusedRun.status], [false, 400]);
  t('...and leaves 0 new categories', STORE.categories.length, 0);
  t('...and 0 items', STORE.items.length, 0);

  const good = await catwrite.writeCitedItems({ entity_id: 'e1', items: [{ name: 'Tomato', categoryName: 'Vegetables' }, { name: 'Onion', categoryName: 'Vegetables' }], by: 'u1' });
  t('the success path writes both items', [good.ok, good.rows.length], [true, 2]);
  t('...creates the category once', STORE.categories.map((c) => c.name), ['Vegetables']);
  t('...each item cites it by id and drops the name', STORE.items.map((r) => [r.item_data.categories, r.item_data.categoryName]), [[[STORE.categories[0].id], undefined], [[STORE.categories[0].id], undefined]]);

  categories.ensureCategories = async () => { throw new Error('boom'); };
  const before = STORE.items.length;
  const broke = await catwrite.writeCitedItems({ entity_id: 'e1', items: [{ name: 'Leek', categoryName: 'Herbs' }], by: 'u1' });
  t('categories that cannot be set up are said, not swallowed', [broke.ok, !!broke.categoriesFailed], [false, true]);
  t('...and nothing is written', STORE.items.length, before);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
