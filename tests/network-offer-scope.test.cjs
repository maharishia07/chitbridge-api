'use strict';
/**
 * tests/network-offer-scope.test.cjs — PRICE-FIX F1: a brand's network offer reaches ONLY the brand's lines at the store.
 * A whole-catalogue / category offer used to be copied unchanged, so it also discounted the store's own products.
 * No DB: db + membership are stubbed.  Run: node tests/network-offer-scope.test.cjs
 */
const path = require('path'), API = path.join(__dirname, '..');
const BRAND = 'brand-1', STORE = 'store-1', OFF = 'off-1', CAT = 'cat-1';
const dbPath = require.resolve(path.join(API, 'db'));
const flags = { network_offers: { policy: 'opt_out', released: { [OFF]: { version: 1, at: '2026-10-01T00:00:00.000Z' } } } };
const mk = (applies_to) => (sql) => {
  if (/FROM identities i WHERE/.test(sql)) return [{ display_name: 'Brand', policy_flags: flags, title: 'Brand' }];
  if (/FROM definition d JOIN definition_version/.test(sql)) return [{ definition_id: OFF, name: '10% off', sub_kind: 'discount', version: 1, rules: { percent: 10, applies_to } }];
  if (/kind = 'category'/.test(sql)) return [{ id: CAT, name: 'Tea' }];
  return [];
};
let rowsFor = mk({});
const run = async (sql, p) => ({ rows: rowsFor(sql, p) });
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: run, withEntity: async (id, fn) => fn({ query: run }), withTransaction: async (fn) => fn({ query: run }) } };
const net = require(path.join(API, 'lib', 'network-offers.js'));
require(path.join(API, 'lib', 'network-membership.js')).brandsOf = async () => new Set([BRAND]);
let pass = 0, fail = 0;
const t = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? ' ' + JSON.stringify(x) : '')); } };
const lines = { [BRAND]: [{ name: 'Masala Tea', id: 'src:s:TEA' }, { name: 'Biscuit', id: 'src:s:BIS' }] };
const ids = (o) => ((o.applies_to || {}).item_ids || []).map(String).sort();
const clean = (o) => !(o.applies_to && (o.applies_to.category_ids || o.applies_to.category || o.applies_to.skus));
(async () => {
  const opts = { choices: {} };
  rowsFor = mk(undefined);
  let out = await net.forStore(STORE, [BRAND], lines, opts);
  t('whole-catalogue offer → only the brand lines', out.length === 1 && ids(out[0]).join() === 'src:s:BIS,src:s:TEA', out);
  rowsFor = mk({ category_ids: [CAT] });
  out = await net.forStore(STORE, [BRAND], lines, opts);
  t('category offer → the brand lines, never a category name that matches own products', out.length === 1 && ids(out[0]).length === 2 && clean(out[0]), out);
  rowsFor = mk({ min_qty: 3 });
  out = await net.forStore(STORE, [BRAND], lines, opts);
  t('a quantity bound is kept beside the narrowed lines', out.length === 1 && out[0].applies_to.min_qty === 3 && ids(out[0]).length === 2, out);
  out = await net.forStore(STORE, [BRAND], { [BRAND]: [] }, opts);
  t('the store holds no brand line → the offer is not handed over', out.length === 0, out);
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
