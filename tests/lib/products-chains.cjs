/**
 * products-chains.cjs — the express-validator chains routes/products.js used before its schemas (the record of what the schemas replaced, never read by the route).
 *
 * OWNS      the old chains of the products routes, a body that satisfies each, and the differences between chain and schema that were looked at and kept.
 * CALLED BY tests/api-problem-products.test.cjs. Not a test itself.
 * FLOW      compare(route, operation, schemaCheck) → tests/lib/chain-compare.cjs over these chains
 * CARD      qa/offline-guards
 */
'use strict';
const { body } = require('express-validator');
const { createComparer } = require('./chain-compare.cjs');

const CHAINS = {
  'POST /': [body('item_data').isObject()],
  'POST /bulk': [body('items').isArray({ min: 1 })],
  'POST /status/bulk': [body('ids').isArray({ min: 1 }), body('status').isString()],
  'POST /bulk-update': [body('items').isArray({ min: 1 })],
  'POST /import/preflight': [body('csv').optional().isString(), body('xlsx').optional().isString(), body('header_row').optional().isInt({ min: 1, max: 1000 })],
  'POST /import': [body('csv').optional().isString(), body('xlsx').optional().isString(), body('header_row').optional().isInt({ min: 1, max: 1000 }), body('decisions').isArray()],
  'POST /starter-columns': [body('vertical').isString()],
  'PATCH /:id': [body('item_data').isObject()],
  'POST /:id/schedule': [body('effective_at').isString(), body('item_data').isObject()],
  'POST /availability/bulk': [body('items').isArray({ min: 1, max: 2000 })],
  'PUT /:id/availability': [body('qty').exists(), body('source').optional().isString(), body('as_of').optional().isString()],
  'PUT /:id/status': [body('status').isString()],
  'POST /lists/adopt': [body('list').isString()]
};
/** a body that satisfies the chain: the single-field cases change one field of it */
const VALID = {
  'POST /': { item_data: {} },
  'POST /bulk': { items: [{}] },
  'POST /status/bulk': { ids: ['x'], status: 'available' },
  'POST /bulk-update': { items: [{}] },
  'POST /import/preflight': {},
  'POST /import': { decisions: [] },
  'POST /starter-columns': { vertical: 'gold' },
  'PATCH /:id': { item_data: {} },
  'POST /:id/schedule': { effective_at: 'x', item_data: {} },
  'POST /availability/bulk': { items: [{}] },
  'PUT /:id/availability': { qty: 1 },
  'PUT /:id/status': { status: 'available' },
  'POST /lists/adopt': { list: 'veg' }
};

const HEADER_ROW_LIST = 'header_row sent as a list is refused: the chain checked each entry of it (an empty list or a list of one whole number passed), the schema asks for one number';
const WHOLE_BODY_WORDS = 'a body that is not an object is refused by the schema (400) where the handler refused it in its own words (400)';
/** the differences between a chain and its schema that were looked at and kept, each with what it is (a body no screen sends) */
const KNOWN_DIFFERENCES = [
  { route: 'POST /import/preflight', what: WHOLE_BODY_WORDS },
  { route: 'POST /import/preflight', what: HEADER_ROW_LIST },
  { route: 'POST /import', what: HEADER_ROW_LIST }
];

/** the kept difference of a case, or null */
function known(description, before, after, given) {
  if (given && Array.isArray(given.header_row) && (before.refused !== after.refused || JSON.stringify(before.body) !== JSON.stringify(after.body))) return HEADER_ROW_LIST;
  const wholeBody = !given || typeof given !== 'object' || Array.isArray(given);
  if (wholeBody && !before.refused && after.refused && after.status === 400) return WHOLE_BODY_WORDS;
  return null;
}

const comparer = createComparer({ chains: CHAINS, valid: VALID, known });
module.exports = { compare: (route, operation, schemaCheck) => comparer.compare(route, schemaCheck), KNOWN_DIFFERENCES, CHAINS };
