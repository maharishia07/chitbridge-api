/**
 * mint-product.test.cjs — INT7c-READ: lib/mint-product.js, the ONE way a product enters a catalogue, proven offline over stand-ins.
 *
 * Held here:
 *   · the order is declare → stamp the entity's currency → INSERT under the entity's own RLS → meter + shopChanged
 *   · a declare refusal (SERVER_OWNED) returns { error, code } and writes NOTHING
 *   · the stored item_data is the stamped one, with the declared schema id when the declaration names one
 *   · a failing meter never fails the add (best effort, logged)
 *
 * Run: node tests/mint-product.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(88) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const mock = (rel, exports) => { const file = require.resolve(API + rel); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };

const calls = [];
let declareAnswer = { item_data: { name: 'Tea' }, schema_id: 's-declared', declared: ['name'], warnings: [] };
mock('/lib/catalogue-columns', { ensureDeclared: async () => { calls.push('declare'); return declareAnswer; } });
mock('/lib/money', { stampItem: (itemData, currency) => { calls.push('stamp:' + currency); return Object.assign({}, itemData, { currency }); } });
mock('/lib/regional', { currencyFor: async () => 'AUD' });
let meterThrows = false;
mock('/lib/meter', { meter: () => { calls.push('meter'); if (meterThrows) return Promise.reject(new Error('meter down')); return Promise.resolve(); } });
mock('/lib/shopchanged', { shopChanged: () => { calls.push('shopChanged'); } });
mock('/lib/schema-bootstrap', { ensureDefaultSchema: async () => 's-default' });
const inserted = [];
const withEntity = async (entityId, work) => work({ query: async (sql, params) => { calls.push('insert'); inserted.push({ entityId, sql, params }); return { rows: [{ item_id: 'i1' }] }; } });
const { mintProduct } = require(API + '/lib/mint-product');

(async () => {
  let answer = await mintProduct({ query: async () => ({ rows: [] }), withEntity, entity_id: 'e1', schema_id: 's-given', item_data: { name: 'Tea' }, rid: 'r1' });
  await new Promise((resolve) => setImmediate(resolve));
  t('a product goes declare → stamp → insert → meter → shopChanged', calls, ['declare', 'stamp:AUD', 'insert', 'meter', 'shopChanged']);
  t('the row stored is the stamped item under the declared schema id', [inserted[0].entityId, inserted[0].params[1], JSON.parse(inserted[0].params[2])], ['e1', 's-declared', { name: 'Tea', currency: 'AUD' }]);
  t('the answer carries the row, what was declared and the warnings', [answer.item.item_id, answer.declared, answer.warnings], ['i1', ['name'], []]);

  calls.length = 0; inserted.length = 0;
  declareAnswer = { error: 'Pictures are added from Media.', code: 'SERVER_OWNED' };
  answer = await mintProduct({ query: async () => ({ rows: [] }), withEntity, entity_id: 'e1', schema_id: 's-given', item_data: { media: [] } });
  t('a declare refusal comes back with its sentence and code', [answer.error, answer.code], ['Pictures are added from Media.', 'SERVER_OWNED']);
  t('... and nothing is stamped, written or metered', [calls, inserted.length], [['declare'], 0]);

  calls.length = 0; inserted.length = 0; meterThrows = true;
  declareAnswer = { item_data: { name: 'Tea' }, declared: [], warnings: [] };
  answer = await mintProduct({ query: async () => ({ rows: [] }), withEntity, entity_id: 'e1', schema_id: 's-given', item_data: { name: 'Tea' } });
  await new Promise((resolve) => setImmediate(resolve));
  t('a failing meter does not fail the add (the row is still returned)', answer.item.item_id, 'i1');

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
