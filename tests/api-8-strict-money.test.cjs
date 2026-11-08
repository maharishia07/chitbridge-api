// OWNS      API-8 (S33): the money bodies are allow-lists, and each still names every key its handler reads.
// CALLED BY node tests/api-8-strict-money.test.cjs (by hand and the tests sweep).
// FLOW      each contract's operation → its body schema → closed? names the keys the handler reads? an unknown key answers 422 naming it.
// CARD      28-platform-and-operations/api-standard
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const { bodySchemaOf, bodyEngine, errorsOf } = require('../middleware/validate');
const { OPERATIONS } = require('../lib/tax-contract');
const pricing = require('../lib/pricing-contract');
const till = require('../lib/till-contract');
const integrations = require('../lib/integrations-contract');

const ROWS = {
  'POST /api/tax/rate': [OPERATIONS['POST /api/tax/rate'], ['lines']],
  'POST /api/tax/compute': [OPERATIONS['POST /api/tax/compute'], ['seller', 'buyer', 'lines', 'scheme', 'priceIncludesTax', 'price_includes_tax', 'reverseCharge']],
  'POST /api/invoice/build': [OPERATIONS['POST /api/invoice/build'], ['lines', 'offers', 'currency', 'price_includes_tax', 'priceIncludesTax']],
  'POST /api/pricing/price': [pricing.OPERATIONS['POST /api/pricing/price'], ['lines']],
  'POST /api/till/price': [till.contract.OPERATIONS['POST /api/till/price'], ['item_id', 'price', 'by']],
  'POST /api/till/offer-item': [till.contract.OPERATIONS['POST /api/till/offer-item'], ['offer_id', 'item_id', 'on', 'by']],
  'POST /api/integrations/books': [integrations.BOOKS_OPERATION, ['chit_id', 'kind', 'system', 'ref', 'outcome', 'why', 'at', 'host']]
};

for (const [route, [operation, keys]] of Object.entries(ROWS)) {
  test(route + ': closed body, every key the handler reads is declared, an unknown key is refused by name', () => {
    const schema = bodySchemaOf(operation);
    assert.strictEqual(schema.additionalProperties, false);
    keys.forEach((key) => assert.ok(key in schema.properties, key + ' is read by the handler and must be declared'));
    const check = bodyEngine.compile(schema);
    const found = errorsOf(check, { zz_unknown_field: 1 }).map((one) => one.field || one.detail).join(' ');
    assert.ok(/zz_unknown_field/.test(found), found);
  });
}
