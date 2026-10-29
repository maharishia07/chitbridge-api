/*
 * OWNS      the building blocks of an area's contract (API-STANDARD S9): the schema shorthands, and contractOf(), which turns a table of routes into OpenAPI operations
 *           (every refusal a Problem response), the OpenAPI paths fragment, and the statuses a test may see from a route.
 * CALLED BY lib/books-contract.js · lib/tax-contract.js · lib/folders-contract.js · lib/facts-contract.js · lib/pricing-contract.js · lib/governance-contract.js (an area's contract module is its table of routes + this kit).
 * FLOW      one row per route { summary, gates, query, params, body, required, out, inline, ok, media, public, invalid, refusals } → operationOf → { 'METHOD /mount/path': operation } → router.openapi + schemaValidate(operation)
 * CARD      28-platform-and-operations/api-standard
 * The statuses a row declares are the ones tools/api-register.cjs can check against the handler's own text: sign-in, a fault of ours, each gate's refusal,
 * a missing id, the schema's 422 for a route that takes input, and what the handler writes itself (row.inline).
 * A row may say `public: true` (no credentials asked: no security, no 401), `params` (a schema for a path argument, e.g. an id that must be a uuid), `required` (the body fields
 * the schema insists on), `invalid: 400` (a route outward-frozen on its old refusal status: the schema's refusal is declared at that status instead of 422) and `list: true`
 * (a handler that takes its rows either as a field or as the whole body, so the body may be an array too), and `rules` (keywords for the body as a whole, for a rule no one field can say) and `lenient: true` (the query values are declared as anything: a handler that read them its own way keeps doing so).
 */
'use strict';
const { problemResponse } = require('./problem');
const { shapeOf, outputFilter } = require('./output-allowlist');

/** a JSON media type holding a schema */
const json = (schema) => ({ 'application/json': { schema } });
/** OpenAPI 3.1: a body that is not JSON is a string of its media type (API-STANDARD S9) */
const media = (type) => ({ [type]: { schema: { type: 'string', contentMediaType: type } } });
const any = {};
const text = { type: 'string' };
/** an object schema with the properties it names and the ones it needs; `closed` = an allow-list (any other key is refused: additionalProperties false), for an answer the handler builds key by key */
const object = (required, properties, closed) => Object.assign({ type: 'object', required: required || [], properties: properties || {} }, closed ? { additionalProperties: false } : {});
/** an array schema of an item shape (any item when none is given) */
const array = (items) => ({ type: 'array', items: items || {} });

const WRITE_METHODS = ['POST', 'PUT', 'PATCH'];
const STATUS_WORDS = { 400: 'a question the caller can answer', 401: 'no or bad credentials', 403: 'this login may not', 404: 'not found', 409: 'the request clashes with what is recorded', 422: 'the request is not valid', 500: 'a fault of ours', 503: 'not available yet' };

/** the path arguments of an express path (:id) as required OpenAPI parameters */
const pathParams = (path, schemas) => [...path.matchAll(/:(\w+)/g)].map((match) => ({ name: match[1], in: 'path', required: true, schema: (schemas || {})[match[1]] || { type: 'string', minLength: 1 } }));
/** query arguments as optional text: a handler reads them leniently, and a schema that refused "abc" would turn a fallback into a refusal no caller has ever had */
/** `lenient`: a handler that reads a query value however it comes (a repeated key included) declares it as anything, so the schema check never refuses what the handler always took */
const queryParams = (names, lenient) => (names || []).map((name) => ({ name, in: 'query', required: false, schema: lenient ? any : text }));
/** the request body: an object that names the fields the handler reads (a list of names, or { name: schema } where a field's kind is checked) and requires only the ones the row says; `list` = the handler also takes the rows as the whole body (an array); `rules` = more keywords for the body as a whole */
const bodyOf = (properties, required, list, rules) => {
  const named = Array.isArray(properties || []) ? Object.fromEntries((properties || []).map((name) => [name, any])) : properties;
  return { content: json(Object.assign({ type: list ? ['object', 'array'] : 'object' }, (required || []).length ? { required } : {}, { properties: named }, rules)) };
};

/** a route takes input when it writes, names a path argument or reads a query argument: the schema can then refuse it (422) */
const takesInput = (row, method, path) => WRITE_METHODS.includes(method) || path.includes(':') || (row.query || []).length > 0;

/** the refusal statuses a row declares, sorted */
function statusesOf(spec, row, method, path) {
  const gateStatuses = (row.gates || []).map((gate) => (spec.gateStatus || {})[gate]).filter(Boolean);
  const found = new Set([500, ...gateStatuses, ...(row.inline || [])]);
  if (!row.public) found.add(401);
  if (path.includes(':')) found.add(404);
  if (takesInput(row, method, path)) found.add(row.invalid || 422);
  return [...found].sort((first, second) => first - second);
}

/** the success answer of a row: its media type (a download) or its JSON shape, under the status it answers (200 unless it says 201) */
const successOf = (row, derived) => ({ [row.ok || 200]: { description: row.says || 'the answer', content: row.media ? media(row.media) : json(derivedSchema(row, derived) || row.out || object()) } });
/** the answer schema derived from what the route answers today (docs/contracts/api-output-shapes.json, tools/api-allowlist.cjs), when it is for the status the row answers under; the row's own `out` stays the fallback */
const derivedSchema = (row, derived) => (derived && !row.media && String(derived.status) === String(row.ok || 200) ? derived.schema : null);
/** who may call: a session, and also a key when the row says so */
const securityOf = (row) => (row.public ? [] : row.keyed ? [{ bearer: [] }, { apiKey: [] }] : [{ bearer: [] }]);

/** the refusals a route can raise beyond its own statuses, for the extension: the area's list when the row names its gate, then the row's own (`refusals`, e.g. a limiter's 429) */
const refusalsOf = (spec, row) => ((spec.refusals && (row.gates || []).includes(spec.refusalsWhen) ? spec.refusals : []).concat(row.refusals || []));

/** one route's OpenAPI operation from its row */
function operationOf(spec, method, path, row) {
  const operation = { summary: row.summary, tags: [spec.mount.split('/').pop()], security: securityOf(row) };
  const parameters = pathParams(path, row.params).concat(queryParams(row.query, row.lenient));
  if (parameters.length) operation.parameters = parameters;
  if (WRITE_METHODS.includes(method) || (method === 'DELETE' && row.body)) operation.requestBody = bodyOf(row.body, row.required, row.list, row.rules); /* a DELETE that reads a body (a version to check) names it in its row */
  const refusals = Object.fromEntries(statusesOf(spec, row, method, path).map((status) => [status, problemResponse(STATUS_WORDS[status] || 'a refusal in words')]));
  operation.responses = Object.assign(successOf(row, shapeOf(fullKey(spec, method + ' ' + path))), refusals);
  const listed = refusalsOf(spec, row);
  if (listed.length) operation[spec.extension] = listed;
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

/** the schema check of one route as a list to spread after its gates (a route that takes no input has none): the ONE place a route file asks for its check; `options` keeps a route on its old refusal (schemaValidate: status · code · legacy) */
function checkOf(operation, key, options) {
  const { schemaValidate } = require('../middleware/validate');
  const filter = outputFilter(shapeOf(key), key); /* S34: only a shape derived from recorded answers (observed > 0) filters; a hand-written `out` never does */
  return (operation.parameters || operation.requestBody ? [schemaValidate(operation, options)] : []).concat(filter ? [filter] : []);
}

/** 'METHOD /mount/path' of a row keyed 'METHOD /path'; a router's root ('/') is the mount itself, as the register names it */
const fullKey = (spec, route) => {
  const [method, path] = route.split(' ');
  return method + ' ' + spec.mount + (path === '/' ? '' : path);
};

/** contractOf({ mount, routes, gateStatus, refusals?, refusalsWhen?, extension? }) → { OPERATIONS, operationFor(route), checked(route, options?), pathsOf(), allowedStatuses() } */
function contractOf(spec) {
  const OPERATIONS = Object.fromEntries(
    Object.keys(spec.routes).map((route) => {
      const [method, path] = route.split(' ');
      return [fullKey(spec, route), operationOf(spec, method, path, spec.routes[route])];
    })
  );
  return {
    OPERATIONS,
    operationFor: (route) => OPERATIONS[fullKey(spec, route)],
    checked: (route, options) => checkOf(OPERATIONS[fullKey(spec, route)], fullKey(spec, route), options),
    pathsOf: () => pathsFrom(OPERATIONS),
    allowedStatuses: () => (key) => allowedFrom(spec, OPERATIONS[key] || { responses: {} })
  };
}

module.exports = { contractOf, json, media, object, array, any, text, statusesOf, operationOf };
