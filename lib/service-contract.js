/*
 * OWNS      the contract of routes/service.js (/api/service, the service clock of a chit): each route's OpenAPI operation (S9) and the statuses the handlers write themselves.
 * CALLED BY routes/service.js (contract.checked on each route, router.openapi) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-service.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 * CARD      03-disputes-service-and-register/service-request-sla-pause
 * This file shapes NO answer and moves no refusal: every sentence a service route says stays in routes/service.js, byte for byte.
 *
 * ⚠️ BEHAVIOUR FROZEN. Every body field is declared as anything and the body may be a list (`list`): the handlers (and their express-validator chains) read a missing or odd value in their own
 *    sentence, and the pause clock rules (which reasons, which impacts, when a pause may start or end) are NOT the schema's to decide. A schema that refused a value would be a new rule.
 * ⚠️ All seven routes read an input (the chit id in the address), so all seven have an operation. The id's own guard (a non-uuid answers 404) is router.param in routes/service.js and runs first.
 */
'use strict';
const { contractOf, object } = require('./contract-kit');

const NOT_MIGRATED = 503; /* every route answers this plainly before b147 has run (gone() in routes/service.js) */
const ID = { chit_id: { type: 'string', minLength: 1 } };
const PAUSE_ID = Object.assign({ pause_id: { type: 'string', minLength: 1 } }, ID);

const CLOSED = { additionalProperties: false }; /* S33: any other body key is refused by name */
const ROUTES = {
  'GET /:chit_id': { summary: 'The clock of a chit, computed both ways (as agreed and contested), with its pauses', params: ID, inline: [NOT_MIGRATED], out: object(['tracked', 'chit_id']) },
  'PUT /:chit_id': { summary: 'Start tracking a chit as a service request, or change its impact, urgency or policy', params: ID, inline: [400, NOT_MIGRATED], list: true, rules: CLOSED, body: ['impact', 'urgency', 'priority', 'policy'], out: object(['message', 'record']) },
  'POST /:chit_id/respond': { summary: 'Someone picked it up: the first response is the one that counts', params: ID, inline: [NOT_MIGRATED], list: true, rules: CLOSED, body: [], out: object(['message', 'responded_at']) },
  'POST /:chit_id/resolve': { summary: 'What was done: the resolution code and an optional note', params: ID, inline: [400, NOT_MIGRATED], list: true, rules: CLOSED, body: ['resolution_code', 'note'], out: object(['message']) },
  'POST /:chit_id/pause': { summary: 'Stop the clock, and say on whom', params: ID, inline: [400, 409, NOT_MIGRATED], list: true, rules: CLOSED, body: ['reason', 'from', 'note', 'on_counterparty'], out: object(['message', 'pause_id', 'copies']) },
  'POST /:chit_id/pause/:pause_id/end': { summary: 'Restart the clock', params: PAUSE_ID, inline: [400, 409, NOT_MIGRATED], list: true, rules: CLOSED, body: ['to'], out: object(['message', 'copies']) },
  'POST /:chit_id/pause/:pause_id/answer': { summary: "Accept or reject the other side's pause", params: PAUSE_ID, inline: [400, 409, NOT_MIGRATED], list: true, rules: CLOSED, body: ['accepted'], out: object(['message', 'copies']) }
};
const contract = contractOf({ mount: '/api/service', routes: ROUTES, gateStatus: {} });

module.exports = { contract, ROUTES };
