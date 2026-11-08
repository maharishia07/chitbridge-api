'use strict';
/**
 * tests/cat-264a-commercial-stamp.test.cjs — CAT-264a: the SQL key list and the JS key lists cannot drift (offline, no database).
 *
 * migrations/b845 holds ONE list, cb_item_commercial_keys(). It must equal the till's RECHECK_FIELDS (tools/tally-connector/till.html) ∪ lib/rate-door.js RATE_KEYS,
 * plus `currency` (CRITIC F3: a currency change at the same amount is a move); `unit` (a price is per unit) is in the till list since CAT-264b. Every key must also be produced by cb_item_fields, or the trigger would compare
 * nothing for it. lib/itemmatch.js STAMP_FIELDS (the books-replay hash, F7) is a different fact, but each of its keys must still be a key cb_item_fields makes.
 * The behaviour itself (each key moves the stamp, is_active does not, the CUR-1 backfill does not) is proven on real Postgres: tests/cat-264a-commercial-stamp.realstack.cjs.
 * CARD 06-catalogue-pim/README
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sql = read('migrations/b845_commercial_changed_at.sql');
const quotedList = (text) => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
/** the body of one function in the migration, from its CREATE line to the closing $$; */
const bodyOf = (name) => { const at = sql.indexOf('CREATE OR REPLACE FUNCTION ' + name + '('); assert(at >= 0, name + ' is not in b845'); return sql.slice(at, sql.indexOf('$$;', sql.indexOf('AS $$', at))); };

const sqlKeys = quotedList(/ARRAY\[([^\]]+)\]/.exec(bodyOf('cb_item_commercial_keys'))[1]);
const till = read('tools/tally-connector/till.html');
const recheckFields = quotedList(/var RECHECK_FIELDS = \[([^\]]+)\]/.exec(till)[1]);
const { RATE_KEYS } = require('../lib/rate-door');
const expected = [...new Set([...recheckFields, ...RATE_KEYS, 'currency', 'unit'])].sort();

let pass = 0;
const ok = (what, fn) => { fn(); pass++; console.log('  ok   ' + what); };

ok('the till list was read (11 keys, unit added by CAT-264b) and RATE_KEYS has the three rate names', () => {
  assert.strictEqual(recheckFields.length, 11, 'RECHECK_FIELDS in till.html: ' + recheckFields);
  assert.deepStrictEqual([...RATE_KEYS].sort(), ['gst_rate', 'tax_slab', 'tax_slab_name']);
});
ok('the trigger key list equals till RECHECK_FIELDS ∪ RATE_KEYS ∪ currency ∪ unit (no key missing, none extra)', () => {
  assert.deepStrictEqual([...sqlKeys].sort(), expected);
  assert.strictEqual(new Set(sqlKeys).size, sqlKeys.length, 'a key is listed twice');
});
ok('category, hsn and mrp are in the list (CRITIC F2, Q3 yes)', () => {
  ['category', 'categories', 'hsn', 'mrp'].forEach((key) => assert(sqlKeys.includes(key), key));
});
ok('is_active is not a key: a soft remove stamps nothing and never moves updated_at (F6)', () => {
  assert(!sqlKeys.includes('is_active'));
  assert(!/updated_at\s*:?=/.test(bodyOf('cb_catalogue_stamp_commercial')), 'the trigger must not write updated_at');
});
ok('cb_item_fields makes every commercial key and every itemmatch STAMP_FIELDS key', () => {
  const made = [...bodyOf('cb_item_fields').matchAll(/^\s+'([a-z_]+)',/gm)].map((m) => m[1]);
  sqlKeys.forEach((key) => assert(made.includes(key), 'cb_item_fields does not make ' + key));
  const stamp = quotedList(/const STAMP_FIELDS = \[([^\]]+)\]/.exec(read('lib/itemmatch.js'))[1]);
  stamp.forEach((key) => assert(made.includes(key), 'itemmatch STAMP_FIELDS key ' + key + ' is not made by cb_item_fields'));
});
ok('one trigger only: the file creates exactly one trigger and it is BEFORE', () => {
  const triggers = sql.match(/^CREATE TRIGGER .*$/gm) || [];
  assert.strictEqual(triggers.length, 1);
  assert(/BEFORE UPDATE OF item_data, commercial_changed_at ON catalogue_items/.test(sql));
});
ok('idempotent by construction: no bare CREATE FUNCTION / ADD COLUMN, header has RLS and ROLL BACK', () => {
  assert(!/^CREATE FUNCTION /m.test(sql));
  assert(!/ADD COLUMN IF NOT EXISTS|ADD COLUMN commercial/.test(sql.replace(/IF fresh THEN[\s\S]*?END IF;/, '')), 'ADD COLUMN must sit inside the fresh-only DO block');
  assert(/^-- RLS:/m.test(sql) && /^-- ROLL BACK:/m.test(sql) && /^-- LOOKED AT/m.test(sql));
});
console.log('\nok ' + pass + ' checks');
