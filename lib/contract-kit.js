/*
 * OWNS      the building blocks of an area's contract (API-STANDARD S9): the schema shorthands, and contractOf(), which turns a table of routes into OpenAPI operations
 *           (every refusal a Problem response), the OpenAPI paths fragment, and the statuses a test may see from a route.
 * CALLED BY lib/books-contract.js · lib/tax-contract.js · lib/governance-contract.js (an area's contract module is its table of routes + this kit).
 * FLOW      one row per route { summary, gates, query, body, out, inline, ok, media } → operationOf → { 'METHOD /mount/path': operation } → router.openapi + schemaValidate(operation)
 * CARD      28-platform-and-operations/api-standard
 * The statuses a row declares are the ones tools/api-register.cjs can check against the handler's own text: sign-in, a fault of ours, each gate's refusal,
 * a missing id, the schema's 422 for a route that takes input, and what the handler writes itself (row.inline).
 * A status a LIBRARY chooses (a route that passes err.status through) is not in the handler's text: the row names it in row.refusals (or the area names the ones a gate brings in spec.refusals).
 */
'use strict';
const { problemResponse } = require('./problem');

/** a JSON media type holding a schema */
const json = (schema) => ({ 'application/json': { schema } });
/** OpenAPI 3.1: a body that is not JSON is a string of its media type (API-STANDARD S9) */
const media = (type) => ({ [type]: { schema: { type: 'string', contentMediaType: type } } });
const any = {};
const text = { type: 'string' };
/** an object schema with the properties it names and the ones it needs */
const object = (required, properties) => ({ type: 'object', required: required || [], properties: properties || {} });
/** an array schema of an item shape (any item when none is given) */
const array = (items) => ({ type: 'array', items: items || {} });

const WRITE_METHODS = ['POST', 'PUT', 'PATCH'];
const STATUS_WORDS = { 400: 'a question the caller can answer', 401: 'no or bad credentials', 403: 'this login may not', 404: 'not found', 409: 'the request clashes with what is recorded', 422: 'the request is not valid', 500: 'a fault of ours', 503: 'not available yet' };

/** the path arguments of an express path (:id) as required OpenAPI parameters */
const pathParams = (path) => [...path.matchAll(/:(\w+)/g)].map((match) => ({ name: match[1], in: 'path', required: true, schema: { type: 'string', minLength: 1 } }));
/** query arguments as optional text: a handler reads them leniently, and a schema that refused "abc" would turn a fallback into a refusal no caller has ever had */
const queryParams = (names) => (names || []).map((name) => ({ name, in: 'query', required: false, schema: text }));
/** the request body: an object that names the fields the handler reads and requires none of them */
const bodyOf = (properties) => ({ content: json({ type: 'object', properties: Object.fromEntries((properties || []).map((name) => [name, any])) }) });

/** a route takes input when it writes, names a path argument or reads a query argument: the schema can then refuse it (422) */
const takesInput = (row, method, path) => WRITE_METHODS.includes(method) || path.includes(':') || (row.query || []).length > 0;

/** the refusal statuses a row declares, sorted */
function statusesOf(spec, row, method, path) {
  const gateStatuses = (row.gates || []).map((gate) => (spec.gateStatus || {})[gate]).filter(Boolean);
  const found = new Set([401, 500, ...gateStatuses, ...(row.inline || [])]);
  if (path.includes(':')) found.add(404);
  if (takesInput(row, method, path)) found.add(422);
  return [...found].sort((first, second) => first - second);
}

/** the success answer of a row: its media type (a download) or its JSON shape, under the status it answers (200 unless it says 201) */
const successOf = (row) => ({ [row.ok || 200]: { description: row.says || 'the answer', content: row.media ? media(row.media) : json(row.out || object()) } });
/** who may call: a session, and also a key when the row says so */
const securityOf = (row) => (row.keyed ? [{ bearer: [] }, { apiKey: [] }] : [{ bearer: [] }]);

/** one route's OpenAPI operation from its row */
function operationOf(spec, method, path, row) {
  const operation = { summary: row.summary, tags: [spec.mount.split('/').pop()], security: securityOf(row) };
  const parameters = pathParams(path).concat(queryParams(row.query));
  if (parameters.length) operation.parameters = parameters;
  if (WRITE_METHODS.includes(method)) operation.requestBody = bodyOf(row.body);
  const refusals = Object.fromEntries(statusesOf(spec, row, method, path).map((status) => [status, problemResponse(STATUS_WORDS[status] || 'a refusal in words')]));
  operation.responses = Object.assign(successOf(row), refusals);
  const shared = row.refusals || (spec.refusals && (row.gates || []).includes(spec.refusalsWhen) ? spec.refusals : null);
  if (shared) operation[spec.extension] = shared;
  return operation;
}

/** the OpenAPI paths fragment of a set of operations keyed 'METHOD /full/path' (an express :id becomes {id}) */
function pathsFrom(operations) {
  const paths = {};
  Object.keys(operations).forEach((key) => {
    const [method, path] = key.split(' ');
    const template = path.replace(/:(\w+)/g, '{$1}');
    (paths[template] = paths[template] || {})[method.toLowerCase()] = operations[key];
  });
  return paths;
}

/** the refusal statuses a test may see from one operation: what it declares, plus the shared refusals a route behind the gate can raise */
function allowedFrom(spec, operation) {
  const declared = Object.keys(operation.responses).map(Number).filter((status) => status >= 400);
  return declared.concat(((spec.extension && operation[spec.extension]) || []).map((item) => item.status));
}

/** the schema check of one route as a list to spread after its gates (a route that takes no input has none): the ONE place a route file asks for its check */
function checkOf(operation) {
  const { schemaValidate } = require('../middleware/validate');
  return operation.parameters || operation.requestBody ? [schemaValidate(operation)] : [];
}

/** contractOf({ mount, routes, gateStatus, refusals?, refusalsWhen?, extension? }) → { OPERATIONS, operationFor(route), checked(route), pathsOf(), allowedStatuses() } */
function contractOf(spec) {
  const OPERATIONS = Object.fromEntries(
    Object.keys(spec.routes).map((route) => {
      const [method, path] = route.split(' ');
      return [method + ' ' + spec.mount + path, operationOf(spec, method, path, spec.routes[route])];
    })
  );
  return {
    OPERATIONS,
    operationFor: (route) => OPERATIONS[route.replace(' ', ' ' + spec.mount)],
    checked: (route) => checkOf(OPERATIONS[route.replace(' ', ' ' + spec.mount)]),
    pathsOf: () => pathsFrom(OPERATIONS),
    allowedStatuses: () => (key) => allowedFrom(spec, OPERATIONS[key] || { responses: {} })
  };
}

module.exports = { contractOf, json, media, object, array, any, text, statusesOf, operationOf };
