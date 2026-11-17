/**
 * schemas-chains.cjs — the three express-validator chains routes/schemas.js used before its schemas (the record of what the schemas replaced, never read by the routes).
 *
 * OWNS      the old chains of PATCH /fields/order, PATCH /fields/:field_key and PATCH /visibility, a body that satisfies each, and the differences between chain and schema that were looked at and kept.
 * CALLED BY tests/api-problem-schemas.test.cjs. Not a test itself.
 * FLOW      compare(route, schemaCheck) → tests/lib/chain-compare.cjs over these chains
 * CARD      07-catalogue-and-pricing/catalogue-setup
 * The kept differences are three kinds of body no screen and no script sends, each now refused by the schema where the chain let it through: a LIST given as a field's value (express-validator checks
 * a list element by element, so ['public'] passed isIn and then failed in the database as a 500), a body that is not an object, and a key the handler never read (the Q18 closing).
 */
'use strict';
const { body } = require('express-validator');
const { createComparer } = require('./chain-compare.cjs');

const ORDER = 'PATCH /fields/order';
const COLUMN = 'PATCH /fields/:field_key';
const VISIBILITY = 'PATCH /visibility';
const ROUTES = [ORDER, COLUMN, VISIBILITY];
const CHAINS = {
  [ORDER]: [body('order').isArray({ min: 1 })],
  [COLUMN]: [
    body('field_name').optional().isString().isLength({ min: 1, max: 80 }),
    body('field_type').optional().isString(),
    body('required').optional().isBoolean(),
    body('unit').optional({ nullable: true }).isString().isLength({ max: 16 }),
    body('leg').optional({ nullable: true }).isString(),
    body('via').optional({ nullable: true }).isString()
  ],
  [VISIBILITY]: [body('visibility').isIn(['private', 'restricted', 'public'])]
};
/** a body that satisfies the chain: the single-field cases change one field of it */
const VALID = { [ORDER]: { order: ['name'] }, [COLUMN]: {}, [VISIBILITY]: { visibility: 'public' } };
/* values every field is tried with beyond the shared table: the digits and words isBoolean reads, the lengths at the edges, the lists the chain read element by element */
const MORE_VALUES = ['true', 'false', 'TRUE', 'yes', 'private', 'restricted', 'public', 'PUBLIC', 'x'.repeat(16), 'x'.repeat(17), 'x'.repeat(80), 'x'.repeat(81), '\t', [''], ['', ''], [null], [true], ['public'], ['x', '']];

const LIST_KIND = 'a list given as a field\'s value: the chain looked at each element, the schema asks for the value itself (no screen sends one)';
const WHOLE_BODY_KIND = 'a body that is not an object: a chain over optional fields lets it through, the schema refuses it (the web and the scripts send objects only)';
/** the differences between a chain and its schema that were looked at and kept, each with what it is */
const KNOWN_DIFFERENCES = [LIST_KIND, WHOLE_BODY_KIND, 'an unknown key: the chain never looked at it, the schema refuses it by name (Q18; no caller sends one)'];

const isList = (value) => Array.isArray(value);
/** the kept difference of a case, or null */
function known(description, before, after, given) {
  const wholeBody = !given || typeof given !== 'object' || isList(given);
  if (wholeBody && before.refused !== after.refused) return WHOLE_BODY_KIND;
  const hasList = given && typeof given === 'object' && Object.values(given).some(isList);
  if (hasList && (before.refused !== after.refused || JSON.stringify(before.body) !== JSON.stringify(after.body))) return LIST_KIND;
  return null;
}

const comparer = createComparer({ chains: CHAINS, valid: VALID, known, values: MORE_VALUES });
/** the schema check of a route addressed by a column key is asked with the path argument the router would have filled in */
const withPath = (schemaCheck) => (request, res, next) => schemaCheck(Object.assign({}, request, { params: { field_key: 'grade' } }), res, next);
module.exports = { compare: (route, schemaCheck) => comparer.compare(route, withPath(schemaCheck)), KNOWN_DIFFERENCES, CHAINS, ROUTES, VALID };
