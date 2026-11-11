/**
 * qa130-bulk-categories.test.cjs — POST /api/products/categories/bulk (QA-130): add / remove a category per product.
 *
 * Drives the real route through express with a stand-in db that keeps the rows, so a second request meets what the first wrote. Proves:
 *   the result per product (done · unchanged · refused NOT_FOUND) · a repeat changes nothing and writes nothing (resume) · no other key moves
 *   (a price edited between two steps survives the second) · the legacy single `category` is folded in as the single attach does ·
 *   an unknown category, a both-ways request, an empty request, too many ids, non-string ids are refused with nothing written ·
 *   a cost-blind co-assist is refused under the cost code · the owner and a cost-allowed co-assist pass.
 * Run: node tests/qa130-bulk-categories.test.cjs
 * CARD      06-catalogue-pim/categories-and-fields
 */
'use strict';
const path = require('path');
const express = require('express');
const http = require('http');

const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(78) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};

const OWNER = { identity_id: 'e1', identity_type: 'entity', display_name: 'Owner' };
const BLIND = { identity_id: 'a1', identity_type: 'actor', access_level: 'editor', parent_entity_id: 'e1', display_name: 'Blind' };
const SEEING = { identity_id: 'a2', identity_type: 'actor', access_level: 'editor', parent_entity_id: 'e1', display_name: 'Seeing' };
const P = (n) => '00000000-0000-4000-8000-00000000000' + n;
const [A, B, C, GONE, LEGACY, SHORT, ORPHANED] = [P(1), P(2), P(3), P(9), P(4), P(5), P(6)];
const RETIRED = 'f0000000-0000-4000-8000-000000000003';
const ORPHAN = 'f0000000-0000-4000-8000-0000000000aa';
const FRUIT = 'f0000000-0000-4000-8000-000000000001';
const VEG = 'f0000000-0000-4000-8000-000000000002';
const ROW = (data) => JSON.parse(JSON.stringify(data));

const call = (port, body) => new Promise((ok) => {
  const b = JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port, path: '/api/products/categories/bulk', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let json = {}; try { json = JSON.parse(raw || '{}'); } catch (_) { /* html 404 */ } ok({ status: res.statusCode, body: json }); }); });
  r.end(b);
});

(async () => {
  let WHO = OWNER, UPDATES = 0, CAN_SEE = {}, DB_DOWN = false;
  const STORE = new Map([
    [A, { name: 'Apple', price: 10, cost: 4 }],
    [B, { name: 'Banana', price: 5, categories: [FRUIT], category_names: ['Fruit'] }],
    [C, { name: 'Carrot', price: 7, categories: [FRUIT, VEG], category_names: ['Fruit', 'Veg'] }],
    [LEGACY, { name: 'Date', price: 20, category: FRUIT, category_name: 'Fruit' }],
    [SHORT, { name: 'Fig', price: 9, categories: [FRUIT, VEG], category_names: ['Fruit'] }],
    [ORPHANED, { name: 'Gourd', price: 3, categories: [ORPHAN, FRUIT], category_names: [] }]
  ]);
  const MASTER = [{ definition_id: FRUIT, name: 'Fruit', status: 'live' }, { definition_id: VEG, name: 'Vegetables', status: 'live' }, { definition_id: RETIRED, name: 'Old shelf', status: 'retired' }];
  const db = {
    query: async (sql, params) => {
      if (DB_DOWN) throw new Error('simulated database failure');
      if (/can_see_costs FROM identities/.test(sql)) return { rows: [{ can_see_costs: !!CAN_SEE[params[0]] }] };
      if (/FROM definition/.test(sql)) return { rows: MASTER };
      if (/FOR UPDATE/.test(sql)) return { rows: params[1].filter((id) => STORE.has(id)).map((id) => ({ item_id: id, item_data: ROW(STORE.get(id)) })) };
      if (/UPDATE catalogue_items/.test(sql)) {
        UPDATES++;
        params[0].forEach((id, at) => { if (params[2][at] === 'replace') STORE.set(id, JSON.parse(params[1][at])); });
        return { rows: params[0].map((id) => ({ item_id: id })) };
      }
      return { rows: [] };
    }
  };
  require.cache[require.resolve(API + '/middleware/auth')] = { exports: Object.assign((req, res, next) => { req.identity = WHO; next(); }, { entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null }) };
  require.cache[require.resolve(API + '/lib/schedule')] = { exports: { enabled: async () => false, TABLE: 'x', pending: async () => [], applyDue: async () => {} } };
  require.cache[require.resolve(API + '/db')] = { exports: { query: async () => ({ rows: [] }), withEntity: async (_id, fn) => fn(db), readBatch: async () => [] } };
  const app = express();
  app.use(express.json());
  app.use('/api/products', require(API + '/routes/products'));
  const srv = app.listen(0);
  const port = srv.address().port;
  const lines = (r) => (r.body.results || []).map((x) => x.id.slice(-1) + ':' + x.result + (x.reason ? '/' + x.reason : ''));

  console.log('\n-- add: per-product result, one write --');
  const first = await call(port, { ids: [A, B, GONE], add: [FRUIT] });
  t('add Fruit to a bare product, one that has it, one that is gone', [first.status, lines(first)], [200, ['1:done', '2:unchanged', '9:refused/NOT_FOUND']]);
  t('the counts', [first.body.done, first.body.unchanged, first.body.refused], [1, 1, 1]);
  t('the product carries the id AND the positional name, like the single attach', [STORE.get(A).categories, STORE.get(A).category_names], [[FRUIT], ['Fruit']]);
  t('no other key of the product moved (price, cost, name)', [STORE.get(A).price, STORE.get(A).cost, STORE.get(A).name], [10, 4, 'Apple']);
  t('one UPDATE for the lot', UPDATES, 1);

  console.log('\n-- repeat = resume: nothing changes, nothing is written --');
  UPDATES = 0;
  STORE.get(A).price = 99; /* a newer edit made between two steps */
  const again = await call(port, { ids: [A, B], add: [FRUIT] });
  t('the same request again answers unchanged for both', lines(again), ['1:unchanged', '2:unchanged']);
  t('...and runs no UPDATE', UPDATES, 0);
  t('...and the newer price survives', STORE.get(A).price, 99);
  const resumed = await call(port, { ids: [A, C], add: [FRUIT, VEG] });
  t('a resume over a part-done set only does the rest', lines(resumed), ['1:done', '3:unchanged']);
  t('the newer price still survives a write that did move the product', STORE.get(A).price, 99);

  console.log('\n-- remove --');
  UPDATES = 0;
  const gone = await call(port, { ids: [C, B], remove: [VEG] });
  t('remove Veg: present → done, absent → unchanged', lines(gone), ['3:done', '2:unchanged']);
  t('the other category and its name stay', [STORE.get(C).categories, STORE.get(C).category_names], [[FRUIT], ['Fruit']]);
  const last = await call(port, { ids: [B], remove: [FRUIT] });
  t('removing the last one drops both keys', [lines(last), 'categories' in STORE.get(B), 'category_names' in STORE.get(B)], [['2:done'], false, false]);
  t('add and remove in one request', lines(await call(port, { ids: [C], add: [VEG], remove: [FRUIT] })), ['3:done']);
  t('...gives the swapped set', STORE.get(C).categories, [VEG]);

  console.log('\n-- the legacy single category is folded in, as the single attach does --');
  t('a product holding only the legacy key: add Veg keeps Fruit and drops the legacy keys', [lines(await call(port, { ids: [LEGACY], add: [VEG] })), STORE.get(LEGACY).categories, 'category' in STORE.get(LEGACY), 'category_name' in STORE.get(LEGACY)], [['4:done'], [FRUIT, VEG], false, false]);

  console.log('\n-- a retired category: no new product, but it can always be taken off --');
  UPDATES = 0;
  const retiredAdd = await call(port, { ids: [A], add: [RETIRED] });
  t('adding a retired category is refused 400 naming it, nothing written', [retiredAdd.status, retiredAdd.body.unknown, UPDATES], [400, [RETIRED], 0]);
  STORE.get(B).categories = [RETIRED]; STORE.get(B).category_names = ['Old shelf'];
  t('removing a retired category is allowed', [lines(await call(port, { ids: [B], remove: [RETIRED] })), 'categories' in STORE.get(B)], [['2:done'], false]);

  console.log('\n-- ids repeated in the request; names shorter than ids --');
  UPDATES = 0;
  const twice = await call(port, { ids: [B, B, A, A], add: [FRUIT, FRUIT] });
  t('a product named twice is answered once', lines(twice), ['2:done', '1:unchanged']);
  t('...and written once', UPDATES, 1);
  t('shorter names: removing the first id leaves ids and names the same length', [lines(await call(port, { ids: [SHORT], remove: [FRUIT] })), STORE.get(SHORT).categories, STORE.get(SHORT).category_names], [['5:done'], [VEG], ['Vegetables']]);
  t('names missing for an id the master lacks: the id stands in, lengths match', [lines(await call(port, { ids: [ORPHANED], add: [VEG] })), STORE.get(ORPHANED).category_names], [['6:done'], [ORPHAN, 'Fruit', 'Vegetables']]);

  console.log('\n-- refusals write nothing --');
  UPDATES = 0;
  const before = JSON.stringify([...STORE]);
  const unknown = await call(port, { ids: [A], add: ['f0000000-0000-4000-8000-0000000000ff'] });
  t('an unknown category to add: 400 naming it', [unknown.status, unknown.body.code, (unknown.body.unknown || []).length], [400, 'PRODUCT_BAD_REQUEST', 1]);
  t('both ways: 400', (await call(port, { ids: [A], add: [FRUIT], remove: [FRUIT] })).status, 400);
  t('nothing to change: 400', (await call(port, { ids: [A] })).status, 400);
  t('more than 200 ids: 400', (await call(port, { ids: Array.from({ length: 201 }, (_, n) => P(0) + n), add: [FRUIT] })).status, 400);
  t('ids that are not strings: 400', (await call(port, { ids: [1], add: [FRUIT] })).status, 400);
  t('an unknown key: 400', (await call(port, { ids: [A], add: [FRUIT], price: 1 })).status, 400);
  t('a product id that is not a uuid is refused NOT_FOUND, not a 500', lines(await call(port, { ids: ['nope'], add: [FRUIT] })), ['e:refused/NOT_FOUND']);
  t('no UPDATE ran and the store is as it was', [UPDATES, JSON.stringify([...STORE]) === before], [0, true]);

  console.log('\n-- who may: the single attach\'s gate --');
  WHO = BLIND; CAN_SEE = {};
  const blind = await call(port, { ids: [A], add: [VEG] });
  t('a cost-blind co-assist is refused under the cost code, nothing written', [blind.status, blind.body.code, UPDATES], [403, 'COST_BLIND', 0]);
  WHO = SEEING; CAN_SEE = { a2: true };
  t('a co-assist who may see costs passes', (await call(port, { ids: [A], add: [VEG] })).status, 200);
  WHO = OWNER;
  t('the owner passes', (await call(port, { ids: [A], remove: [VEG] })).status, 200);

  console.log('\n-- the module itself: lib/product-categories.js (unit per rule, refusal path, fail closed) --');
  const unit = require(path.join(API, 'lib', 'product-categories.js'));
  const NAMES = new Map([[FRUIT, 'Fruit'], [VEG, 'Vegetables']]);
  const tea = { name: 'Tea', categories: [FRUIT], category_names: ['Fruit'] };
  const copy = JSON.stringify(tea);
  t('unit · add keeps the order and appends only the new id', unit.applyChange(tea, { add: [FRUIT, VEG] }, NAMES).item_data.categories, [FRUIT, VEG]);
  t('unit · the name comes from the master, positional to the ids', unit.applyChange(tea, { add: [VEG] }, NAMES).item_data.category_names, ['Fruit', 'Vegetables']);
  t('unit · a name the master cannot resolve keeps the word the product carried', unit.applyChange(tea, { add: [VEG], remove: [] }, new Map()).item_data.category_names, ['Fruit', VEG]);
  t('unit · the argument is never touched', JSON.stringify(tea), copy);
  t('unit · idsOf reads categories, else the legacy single, else nothing', [unit.idsOf({ categories: [FRUIT] }), unit.idsOf({ category: VEG }), unit.idsOf({})], [[FRUIT], [VEG], []]);
  t('unit · removing an absent id or adding a present one is unchanged', [unit.applyChange(tea, { remove: [VEG] }, NAMES).changed, unit.applyChange(tea, { add: [FRUIT] }, NAMES).changed], [false, false]);
  const refusedWrites = [];
  const refusal = await unit.changeCategories({ query: async (sql) => (/FROM definition/.test(sql) ? { rows: [] } : (refusedWrites.push(sql), { rows: [] })) }, 'e1', { ids: [A], add: [FRUIT], remove: [] });
  t('refusal path · an added category the master lacks is named and nothing is read or written after it', [refusal.unknown, refusedWrites.length], [[FRUIT], 0]);
  DB_DOWN = true;
  UPDATES = 0;
  const down = await call(port, { ids: [A], add: [VEG] });
  t('fail closed · a database failure answers 500 and writes nothing', [down.status, UPDATES], [500, 0]);
  DB_DOWN = false;

  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
