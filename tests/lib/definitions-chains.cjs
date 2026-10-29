/**
 * definitions-chains.cjs — the two express-validator chains routes/definitions.js used before its schemas (the record of what the schemas replaced, never read by the routes).
 *
 * OWNS      the old chains of POST / and POST /freeze, a body that satisfies each, and the differences between chain and schema that were looked at and kept (none today).
 * CALLED BY tests/api-problem-definitions.test.cjs. Not a test itself.
 * FLOW      compare(route, schemaCheck) → tests/lib/chain-compare.cjs over these chains
 * CARD      07-catalogue-and-pricing/definitions
 */
'use strict';
const { body } = require('express-validator');
const { createComparer } = require('./chain-compare.cjs');

const CREATE = 'POST /';
const FREEZE = 'POST /freeze';
const CHAINS = {
  [CREATE]: [body('kind').isString().trim().notEmpty(), body('name').isString().trim().notEmpty()],
  [FREEZE]: [body('definition_ids').isArray()]
};
const VALID = { [CREATE]: { kind: 'pricing', name: 'Carton of 6' }, [FREEZE]: { definition_ids: [] } };
/* values every field is tried with beyond the shared table: a list is listed once for itself and once per empty element, as the chain did */
const MORE_VALUES = [[''], ['', ''], [null], [[]], ['x', ''], [' '], [undefined, 'x'], '\t\n', ['x', 'y'], [0], [false]];
const KNOWN_DIFFERENCES = [];

const comparer = createComparer({ chains: CHAINS, valid: VALID, known: () => null, values: MORE_VALUES });
module.exports = { compare: (route, schemaCheck) => comparer.compare(route, schemaCheck), KNOWN_DIFFERENCES, CHAINS, CREATE, FREEZE, VALID };
