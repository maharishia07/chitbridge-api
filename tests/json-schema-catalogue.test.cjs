/**
 * json-schema-catalogue.test.cjs — the catalogue shape the web model emits (toJSONSchema) is a real JSON Schema 2020-12.
 *
 * OWNS      the proof for the register row json-schema-2020-12: the emitted schema COMPILES under a 2020-12 validator, accepts a good item,
 *           refuses a missing required field and a wrong type, and carries the x-cb-* keywords only as annotations (never changing validity).
 * CALLED BY the Standards register (public/app/cap-standards.js row json-schema-2020-12) · CI. Reads the web model by the sibling path, as units-alias.test.js does.
 * FLOW      CBCatalogue.toJSONSchema → ajv/dist/2020 (strict off: x-cb-* are our own keywords)
 * CARD      06-catalogue-pim/categories-and-fields
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const Ajv2020 = require('ajv/dist/2020');

function webModel() {
  global.CBCatalogue = null;
  require('../../chitbridge-web/public/app/catalogue-model.js');
  assert.ok(global.CBCatalogue && global.CBCatalogue.toJSONSchema, 'the web catalogue model is not beside the api checkout');
  return global.CBCatalogue;
}

const DRAFT = {
  product: 'Tea',
  baseUnit: 'kg',
  fields: [
    { name: 'Weight', type: 'number', leg: 'customer' },
    { name: 'Best before', type: 'date', leg: 'customer' },
    { name: 'Blend', type: 'text', leg: 'system', via: 'ERP' },
    { name: 'Made of', type: 'composition', leg: 'customer' }
  ],
  standards: [{ scheme: 'GS1 GTIN', code: '08901234567894' }]
};

function compile() {
  const schema = webModel().toJSONSchema(DRAFT, { method: 'cart' });
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
  return { schema, validate: ajv.compile(schema) };
}

test('the output declares draft 2020-12 and compiles under a 2020-12 validator', () => {
  const { schema } = compile();
  assert.strictEqual(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.strictEqual(schema.type, 'object');
});

test('a good item validates', () => {
  const { validate } = compile();
  const ok = validate({ product: 'Tea', unit: 'kg', weight: 2.5, best_before: '2027-01-31', blend: 'Assam', made_of: [{ item: 'leaf', qty: 1, unit: 'kg' }], gs1_gtin: '08901234567894' });
  assert.ok(ok, JSON.stringify(validate.errors));
});

test('a missing required field, a wrong type and a malformed composition are refused', () => {
  const { validate } = compile();
  assert.strictEqual(validate({ unit: 'kg' }), false, 'product is required');
  assert.strictEqual(validate({ product: 'Tea', weight: 'heavy' }), false, 'a number field takes a number');
  assert.strictEqual(validate({ product: 'Tea', made_of: [{ qty: 1 }] }), false, 'a composition line names its item');
});

test('the x-cb-* keywords are annotations: they sit on the schema and do not change validity', () => {
  const { schema, validate } = compile();
  assert.strictEqual(schema['x-cb-method'], 'cart');
  assert.strictEqual(schema.properties.product['x-cb-role'], 'identity');
  assert.ok(validate({ product: 'Tea', extra_key_we_do_not_know: 1 }), 'unknown properties stay allowed');
});
