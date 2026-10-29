/**
 * tests/cat235-create-cost-gate.test.cjs — CAT-235 part 2: a cost-blind co-assist CREATES items (by design) but never sends a cost.
 *
 * Decision (coordinator, option 2): on POST /, POST /bulk and POST /import (new rows and update-by-sku rows) refuse ONLY `cost` and
 * `cost_*` keys, at any depth, for an actor without can_see_costs — the same 403 COST_BLIND as lib/cost.writeRefusal. Price, name and
 * the rest stay untouched; creates stay open. Whole request refused, nothing written. The owner and a cost-allowed actor are unchanged.
 * Run: node tests/cat235-create-cost-gate.test.cjs   (no live database: stubbed auth and db)
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
const BLIND = { identity_id: 'a1', identity_type: 'actor', access_level: 'editor', parent_entity_id: 'e1', hat: 'manager', display_name: 'Blind' };
const GRANTED = { identity_id: 'a2', identity_type: 'actor', access_level: 'editor', parent_entity_id: 'e1', hat: 'manager', display_name: 'Granted' };
const ITEM = '11111111-1111-4111-8111-111111111111';
const NL = String.fromCharCode(10);

const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

(async () => {
  console.log('\n-- CAT-235 part 2 · a cost-blind co-assist creates items, never their cost --\n');
  let WHO = OWNER, writes = [];
  const GRANTS = { a2: true };
  require.cache[require.resolve(API + '/middleware/auth')] = {
    exports: Object.assign((req, res, next) => { req.identity = WHO; next(); }, { entityOf: (req) => (req.identity.parent_entity_id || req.identity.identity_id) })
  };
  require.cache[require.resolve(API + '/lib/schedule')] = { exports: { enabled: async () => false, TABLE: 'x', pending: async () => [], applyDue: async () => {}, diff: () => ({}) } };
  const regional = require(API + '/lib/regional'); regional.currencyFor = async () => 'INR';
  const STORED = { name: 'Tea', price: 10, sku: 'A1', status: 'available' };
  const FAKE = { item_id: ITEM, item_data: STORED };
  /* every INSERT / UPDATE that reaches the store is recorded: "nothing written" means this list stays empty */
  const record = (sql, params) => { if (/^\s*(INSERT|UPDATE)/i.test(sql)) writes.push(params); };
  require.cache[require.resolve(API + '/db')] = {
    exports: {
      query: async (sql, params) => {
        record(sql, params);
        if (/SELECT schema_id FROM entity_schemas/.test(sql)) return { rows: [{ schema_id: ITEM }] };
        if (/FROM schema_fields WHERE schema_id/.test(sql)) return { rows: [{ field_key: 'name', field_name: 'Name', field_type: 'text' }, { field_key: 'sku', field_name: 'SKU', field_type: 'text' }] };
        return { rows: [] };
      },
      withEntity: async (_id, fn) => fn({
        query: async (sql, params) => {
          record(sql, params);
          if (/can_see_costs FROM identities/.test(sql)) return { rows: [{ can_see_costs: !!GRANTS[params[0]] }] };
          if (/SELECT item_id, item_data FROM catalogue_items WHERE entity_id=.1 AND is_active/.test(sql)) return { rows: [{ item_id: ITEM, item_data: Object.assign({}, STORED) }] };
          if (/INSERT INTO catalogue_items/.test(sql)) return { rows: [FAKE] };
          if (/UPDATE catalogue_items/.test(sql)) return { rows: [FAKE] };
          return { rows: [] };
        }
      }),
      readBatch: async () => [{ rows: [FAKE] }, { rows: [] }, { rows: [] }, { rows: [{ n: 0 }] }]
    }
  };
  delete require.cache[require.resolve(API + '/routes/products')];
  const app = express(); app.use(express.json());
  app.use('/api/products', require(API + '/routes/products'));
  const server = app.listen(0); const port = server.address().port;
  const post = (p, body) => { writes = []; return call(port, 'POST', '/api/products' + p, body); };
  const cost = require(API + '/lib/cost');

  t('one definition of a cost key: cost and cost_* only, at any depth, key names not values',
    [cost.isCostKey('cost'), cost.isCostKey('cost_x'), cost.isCostKey('costume'), cost.isCostKey('price'), cost.costKeysIn({ name: 'a', modifiers: [{ options: [{ cost: 3 }, { cost_x: 1 }] }], cost: 9 }).sort()],
    [true, true, false, false, ['cost', 'cost_x']]);

  const NESTED = { name: 'Dosa', price: 70, modifiers: [{ name: 'Size', options: [{ name: 'Large', price: 90, cost: 40 }] }] };
  const PLAIN = { name: 'Dosa', price: 70, modifiers: [{ name: 'Size', options: [{ name: 'Large', price: 90 }] }] };

  console.log('   POST /');
  WHO = BLIND;
  for (const [label, item] of [['top-level cost', { name: 'Dosa', price: 70, cost: 30 }], ['a cost_* key', { name: 'Dosa', cost_x: 1 }], ['nested modifiers[].options[].cost', NESTED]]) {
    const r = await post('', { item_data: item });
    t('blind: ' + label + ' -> 403 COST_BLIND, nothing written', [r.status, r.body.code, writes.length], [403, 'COST_BLIND', 0]);
  }
  const r1 = await post('', { item_data: { name: 'Dosa', price: 70, cost: 30, cost_x: 1 } });
  t('  ...blocked names the keys (never the values)', [r1.body.blocked, /30/.test(JSON.stringify(r1.body))], [['cost', 'cost_x'], false]);
  const blindOk = await post('', { item_data: PLAIN });
  const blindWrote = writes.length > 0;
  WHO = OWNER;
  const ownerSeen = await post('', { item_data: PLAIN });
  t('blind: the same create WITHOUT cost succeeds, answered exactly as the owner is', [blindOk.status, blindWrote, JSON.stringify(blindOk.body) === JSON.stringify(ownerSeen.body)], [200, true, true]);
  WHO = BLIND;
  t('blind: a named, unpriced item (what New item posts) still creates', (await post('', { item_data: { name: 'Plain', unit: 'each' } })).status, 200);
  WHO = OWNER;
  t('owner: a create WITH cost is not refused', (await post('', { item_data: NESTED })).status, 200);
  WHO = GRANTED;
  t('cost-allowed co-assist: a create WITH cost is not refused', (await post('', { item_data: NESTED })).status, 200);

  /* F1 (cb-security): the writer folds a key before storing it, so the gate judges the key as it will be stored */
  const ODD = ['Cost', '_cost', '1cost', 'Cost (INR)', 'COST_x'];
  WHO = BLIND;
  for (const odd of ODD) {
    const top = await post('', { item_data: { name: 'Dosa', [odd]: 5 } });
    t('blind POST /: key ' + JSON.stringify(odd) + ' -> 403, named as sent, nothing written', [top.status, top.body.blocked, writes.length], [403, [odd], 0]);
    const deep = await post('', { item_data: { name: 'Dosa', modifiers: [{ options: [{ name: 'L', [odd]: 5 }] }] } });
    t('blind POST /: nested ' + JSON.stringify(odd) + ' -> 403, nothing written', [deep.status, writes.length], [403, 0]);
    const bulk = await post('/bulk', { items: [{ name: 'A' }, { name: 'B', [odd]: 5 }] });
    t('blind POST /bulk: key ' + JSON.stringify(odd) + ' -> 403, nothing written', [bulk.status, bulk.body.blocked, writes.length], [403, [odd], 0]);
  }
  t('a key that only looks like cost is not one', [cost.isCostKey('costume'), cost.isCostKey('Costume'), cost.isCostKey('discount_cost_x')], [false, false, false]);
  WHO = OWNER;
  t('owner: an odd cost key is not refused', (await post('', { item_data: { name: 'Dosa', 'Cost (INR)': 5 } })).status, 200);
  console.log('   POST /bulk');
  WHO = BLIND;
  const b1 = await post('/bulk', { items: [{ name: 'A', price: 1 }, NESTED] });
  t('blind: one row of the lot carries a nested cost -> whole request 403, nothing written', [b1.status, b1.body.code, b1.body.blocked, writes.length], [403, 'COST_BLIND', ['cost'], 0]);
  const b2 = await post('/bulk', { items: [{ name: 'A', price: 1 }, PLAIN] });
  WHO = OWNER;
  const b3 = await post('/bulk', { items: [{ name: 'A', price: 1 }, PLAIN] });
  t('blind: the lot WITHOUT cost succeeds, answered as the owner is', [b2.status, JSON.stringify(b2.body) === JSON.stringify(b3.body)], [200, true]);
  t('owner: a lot WITH cost is not refused', (await post('/bulk', { items: [NESTED] })).status, 200);
  WHO = GRANTED;
  t('cost-allowed co-assist: a lot WITH cost is not refused', (await post('/bulk', { items: [NESTED] })).status, 200);

  console.log('   POST /import');
  const file = (head, rows) => ({ confirm: true, csv: head + NL + rows.join(NL) + NL, decisions: head.split(',').map((h) => ({ incoming: h, action: h === 'cost' ? 'create' : 'map', field: h })) });
  WHO = BLIND;
  const i1 = await post('/import', file('name,price,cost', ['Tea,10,4', 'Coffee,12,5']));
  t('blind: a NEW-row sheet with a cost column -> 403 COST_BLIND, whole file, nothing written', [i1.status, i1.body.code, i1.body.blocked, writes.length], [403, 'COST_BLIND', ['cost'], 0]);
  const i2 = await post('/import', file('sku,price,cost', ['A1,11,4']));
  t('blind: an UPDATE-by-sku row with a cost column -> 403, nothing written', [i2.status, i2.body.code, writes.length], [403, 'COST_BLIND', 0]);
  const i3 = await post('/import', file('name,price', ['Tea,10', 'Coffee,12']));
  t('blind: a sheet WITHOUT cost is not refused (created)', [i3.status, i3.body.summary && i3.body.summary.created, writes.length > 0], [200, 2, true]);
  const i4 = await post('/import', file('sku,price', ['A1,11']));
  t('blind: an update-by-sku row WITHOUT cost still updates the price', [i4.status, i4.body.summary && i4.body.summary.updated, writes.length > 0], [200, 1, true]);
  WHO = OWNER;
  t('owner: a sheet WITH cost is not refused', (await post('/import', file('name,price,cost', ['Tea,10,4']))).status, 200);
  WHO = GRANTED;
  t('cost-allowed co-assist: a sheet WITH cost is not refused', (await post('/import', file('name,price,cost', ['Tea,10,4']))).status, 200);

  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
