/*
 * OWNS      the contract of routes/facts.js: each route's OpenAPI operation (S9) and the words its refusals answer in.
 * CALLED BY routes/facts.js (schemaValidate on the card route, router.openapi, problem(req, res, { status, ...said(...) })) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-finance.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...said(code, error, message) }) → the old { error, message } beside the Problem fields
 * CARD      28-platform-and-operations/facts-route
 * This file shapes NO answer: every card and the rail's chit list are built in lib/home-facts, as before.
 *
 * ⚠️ The card name is declared as plain text: the handler answers a name it does not know with its own 404 sentence (frozen in docs/contracts/api-legacy.json), and a schema that refused
 *    it first would turn that 404 into a different refusal no caller has ever had.
 */
'use strict';
const { contractOf, object, array } = require('./contract-kit');

/** the old body of a refusal, as the spec parts problem() takes: { code, detail, legacy } */
const said = (code, error, message) => ({ code, detail: message, legacy: { error, message } });
/** a key is not a person: the Home figures are for a signed-in page (the same sentence on both routes) */
const KEY_REFUSED = 'Sign in to see the Home figures.';
const keyRefused = () => ({ code: 'KEY_CANNOT_SEE_HOME', detail: KEY_REFUSED, legacy: { error: 'Forbidden', message: KEY_REFUSED } });

const ROUTES = {
  'GET /rail/chits': { summary: "The chits behind the rail's In, Out and Stuck numbers (a signed-in person, not a key)", inline: [403], out: object(['overdue_days', 'truncated', 'items'], { items: array() }) },
  'GET /:card': { summary: 'What one Home card says: its lines, its figures and its state (a signed-in person, not a key)', inline: [403, 404], out: object(['lines', 'state'], { lines: array() }) }
};

module.exports = Object.assign({ said, keyRefused, KEY_REFUSED, ROUTES }, contractOf({ mount: '/api/facts', routes: ROUTES }));
