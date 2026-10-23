/**
 * catalogue-chains.cjs — the express-validator chain POST /api/catalogue/enquiry/:item_id used before its schema (the record of what the schema replaced, never read by the route).
 *
 * OWNS      the old chain, a body that satisfies it, and the differences between chain and schema that were looked at and kept.
 * CALLED BY tests/api-problem-catalogue.test.cjs. Not a test itself.
 * FLOW      compare(route, schemaCheck) → tests/lib/chain-compare.cjs over this chain
 * CARD      qa/offline-guards
 */
'use strict';
const { body } = require('express-validator');
const { createComparer } = require('./chain-compare.cjs');

const ROUTE = 'POST /enquiry/:item_id';
const CHAINS = {
  [ROUTE]: [body('message_text').trim().notEmpty().withMessage('Message text required'), body('thread_type').optional().isIn(['external', 'internal'])]
};
const VALID = { [ROUTE]: { message_text: 'hello' } };
const LIST_OR_OBJECT = 'message_text sent as a list or an object is refused: the chain turned it to text ("a,b", "[object Object]") and let it through';
const LIST_THREAD = 'thread_type sent as a list is refused: the chain checked each entry (a list of allowed words passed)';
const KNOWN_DIFFERENCES = [
  { route: ROUTE, what: LIST_OR_OBJECT },
  { route: ROUTE, what: LIST_THREAD }
];

/** the kept difference of a case, or null */
function known(description, before, after, given) {
  const text = given && given.message_text;
  const differs = before.refused !== after.refused || JSON.stringify(before.body) !== JSON.stringify(after.body);
  if (text && typeof text === 'object' && differs) return LIST_OR_OBJECT;
  if (given && Array.isArray(given.thread_type) && differs) return LIST_THREAD;
  return null;
}

const comparer = createComparer({ chains: CHAINS, valid: VALID, known });
module.exports = { compare: (route, schemaCheck) => comparer.compare(route, schemaCheck), KNOWN_DIFFERENCES, CHAINS, ROUTE };
