/**
 * network-chains.cjs — the express-validator chains routes/connections.js used before its schemas (the record of what the schemas replaced, never read by the route).
 *
 * OWNS      the old chains of POST /request and PUT /:id/respond, a body that satisfies each, and the differences between chain and schema that were looked at and kept.
 * CALLED BY tests/api-problem-network.test.cjs. Not a test itself.
 * FLOW      compare(route, schemaCheck) → tests/lib/chain-compare.cjs over these chains
 * CARD      qa/offline-guards
 */
'use strict';
const { body } = require('express-validator');
const { createComparer } = require('./chain-compare.cjs');

const CHAINS = {
  'POST /request': [body('to_entity_id').trim().notEmpty().withMessage('Receiver entity ID required'), body('note').optional().trim().isLength({ max: 500 })],
  'PUT /:id/respond': [body('action').trim().isIn(['accept', 'reject']).withMessage('Action must be accept or reject')]
};
const VALID = { 'POST /request': { to_entity_id: 'x' }, 'PUT /:id/respond': { action: 'accept' } };
const LIST_VALUE = 'a field sent as a list is refused: the chain checked each entry of it (an empty list, or a list of entries that each passed, went through; a list of bad ones was refused entry by entry), the schema asks for one value';
/** the differences between a chain and its schema that were looked at and kept, each with what it is (a body no screen sends) */
const KNOWN_DIFFERENCES = [
  { route: 'POST /request', what: LIST_VALUE },
  { route: 'PUT /:id/respond', what: LIST_VALUE }
];
/** the kept difference of a case, or null (the case is told by its description: the trim in front of the schema has already turned the sent list in the body to text) */
function known(description, before, after) {
  const sentAsList = description.includes(' = [') || description.includes(' = "array of ');
  const differs = before.refused !== after.refused || JSON.stringify(before.body) !== JSON.stringify(after.body);
  return sentAsList && differs ? LIST_VALUE : null;
}
module.exports = { CHAINS, VALID, KNOWN_DIFFERENCES, known, createComparer };
