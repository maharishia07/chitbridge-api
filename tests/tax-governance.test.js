// tests/tax-governance.test.js — the jurisdiction's slabs, served as read-only definitions.  node tests/tax-governance.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../lib/tax-governance');
const S = require('../lib/tax-slab');
const tax = require('../lib/tax');

const IN = { region_code: 'IN', currency: 'INR', jurisdiction: { mode: 'India', tax: { scheme: 'GST', authority: 'CBIC', since: '2017-07-01',
  slabs: [ { id: 'IN-GST-0', name: 'GST 0% (nil-rated / exempt)', rate: 0 }, { id: 'IN-GST-5', name: 'GST 5%', rate: 5 },
           { id: 'IN-GST-18', name: 'GST 18%', rate: 18, effective_from: '2017-07-01' }, { id: 'IN-GST-BAD', name: 'no rate' } ] } } };

test('a governed id is <country>-<scheme>-<key>, never a uuid', () => {
  assert.equal(G.isGovernedId('IN-GST-18'), true);
  assert.equal(G.isGovernedId('IN-GST-CESS-12'), true);
  assert.equal(G.isGovernedId('3fa85f64-5717-4562-b3fc-2c963f66afa6'), false);
  assert.equal(G.isGovernedId(''), false);
});

test('the layer becomes definition-shaped rows — live, entity-less, rules carrying the rate; a slab without a rate is dropped', () => {
  const rows = G.slabsFromLayer(IN, 'IN');
  assert.equal(rows.length, 3, 'IN-GST-BAD has no rate and must not be served');
  const r18 = rows.find((r) => r.definition_id === 'IN-GST-18');
  assert.equal(r18.kind, 'tax'); assert.equal(r18.sub_kind, 'gst_slab'); assert.equal(r18.status, 'live');
  assert.equal(r18.entity_id, null);
  assert.equal(r18.rules.rate, 18); assert.equal(r18.rules.scheme, 'GST');
  assert.deepEqual(r18.governance, { jurisdiction: 'IN', scheme: 'GST', authority: 'CBIC' });
});

test('⚠️ 0% is served — nil-rated is a real answer, not "no slab"', () => {
  const r0 = G.slabsFromLayer(IN, 'IN').find((r) => r.definition_id === 'IN-GST-0');
  assert.ok(r0); assert.equal(r0.rules.rate, 0);
});

test('a layer with no tax block yields nothing, quietly', () => {
  assert.deepEqual(G.slabsFromLayer({ region_code: 'US', jurisdiction: {} }, 'US'), []);
  assert.deepEqual(G.slabsFromLayer(null, 'XX'), []);
});

test('⭐ the resolver takes a governed slab like any other — cited on the product, it answers with the rate and says so', () => {
  const slabs = G.slabsFromLayer(IN, 'IN');
  const row = S.setOn({ name: 'Rice', price: 620 }, S.slabOf(slabs.find((r) => r.definition_id === 'IN-GST-18')));
  assert.equal(row.tax_slab, 'IN-GST-18');
  const r = S.resolve({ item_data: row, face: {}, slabs, categories: [] });
  assert.equal(r.rate, 18); assert.equal(r.source, 'product'); assert.equal(r.name, 'GST 18%');
});

test('⭐ and as the catalogue default it is inherited without any entity authoring a slab', () => {
  const slabs = G.slabsFromLayer(IN, 'IN');
  const r = S.resolve({ item_data: { name: 'Rice', price: 620 }, face: { tax: { default_slab: 'IN-GST-5' } }, slabs, categories: [] });
  assert.equal(r.rate, 5); assert.equal(r.source, 'catalogue');
});

test('the governed rate reaches lib/tax.js unchanged — intra halves it, inter puts it all on IGST', () => {
  const slabs = G.slabsFromLayer(IN, 'IN');
  const r = S.resolve({ item_data: { tax_slab: 'IN-GST-18' }, face: {}, slabs, categories: [] });
  const line = S.applyToLine({ qty: 1, price: 100 }, r);
  const intra = tax.determine({ lines: [line], seller: { State: '33' }, buyer: { Pos: '33' } });
  const inter = tax.determine({ lines: [line], seller: { State: '33' }, buyer: { Pos: '29' } });
  const li = intra.ItemList[0], le = inter.ItemList[0];
  assert.equal(li.CgstAmt, 9); assert.equal(li.SgstAmt, 9); assert.equal(li.IgstAmt, 0);
  assert.equal(le.IgstAmt, 18); assert.equal(le.CgstAmt, 0);
});

test('jurisdictionFor: identities.country wins; INR alone infers IN; anything else is null', async () => {
  const q = (rows) => ({ query: async () => ({ rows }) });
  assert.equal(await G.jurisdictionFor('e1', q([{ country: 'ae', currency_code: 'INR' }])), 'AE');
  assert.equal(await G.jurisdictionFor('e1', q([{ country: null, currency_code: 'INR' }])), 'IN');
  assert.equal(await G.jurisdictionFor('e1', q([{ country: null, currency_code: 'USD' }])), null);
  assert.equal(await G.jurisdictionFor('e1', q([])), null);
});

test('governedSlabsFor reads the layer for the jurisdiction and serves its slabs', async () => {
  const deps = { query: async () => ({ rows: [{ country: 'IN' }] }), regionLayer: async (c) => (c === 'IN' ? IN : null) };
  const rows = await G.governedSlabsFor('e1', deps);
  assert.equal(rows.length, 3);
  const none = await G.governedSlabsFor('e1', { query: async () => ({ rows: [{ country: 'US', currency_code: 'USD' }] }), regionLayer: async () => null });
  assert.deepEqual(none, []);
});

test('a frozen copy of a governed slab carries the rules BY VALUE and the jurisdiction version key', () => {
  const row = G.slabsFromLayer(IN, 'IN').find((r) => r.definition_id === 'IN-GST-18');
  const f = G.frozenCopy(row, '2026-09-04T00:00:00.000Z');
  assert.equal(f.definition_id, 'IN-GST-18'); assert.equal(f.version, '2017-07-01'); assert.equal(f.rules.rate, 18);
  assert.equal(f.governance.jurisdiction, 'IN');
});

test('⭐ an INR sub-region with no tax block of its own (TN, HI) inherits India\'s GST slabs', async () => {
  const TN = { region_code: 'TN', currency: 'INR', jurisdiction: {} };
  const deps = { query: async () => ({ rows: [{ country: 'TN' }] }), regionLayer: async (c) => (c === 'IN' ? IN : c === 'TN' ? TN : null) };
  const rows = await G.governedSlabsFor('e1', deps);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].governance.jurisdiction, 'IN');
});
