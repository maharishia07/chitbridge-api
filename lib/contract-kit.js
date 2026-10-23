/*
 * OWNS      the building blocks of an area's contract (API-STANDARD S9): the schema shorthands, and contractOf(), which turns a table of routes into OpenAPI operations
 *           (every refusal a Problem response), the OpenAPI paths fragment, and the statuses a test may see from a route.
 * CALLED BY lib/books-contract.js · lib/tax-contract.js · lib/folders-contract.js · lib/facts-contract.js · lib/pricing-contract.js · lib/crm-contract.js · lib/offers-contract.js · lib/network-offers-contract.js · lib/combo-templates-contract.js (an area's contract module is its table of routes + this kit).
 * FLOW      one row per route { summary, gates, query, params, body, required, out, inline, ok, media, public, invalid, schemaStatus, keyed, open, bodySchema, published } → operationOf → { 'METHOD /mount/path': operation } → router.openapi + schemaValidate(operation)
 * CARD      28-platform-and-operations/api-standard
 * The statuses a row declares are the ones tools/api-register.cjs can check against the handler's own text: sign-in, a fault of ours, each gate's refusal,
 * a missing id, the schema's 422 for a route that takes input, and what the handler writes itself (row.inline).
 * A row may say `public: true` (no credentials asked: no security, no 401), `params` (a schema for a path argument, e.g. an id that must be a uuid), `required` (the body fields
 * the schema insists on), `invalid: 400` (a route outward-frozen on its old refusal status: the schema's refusal is declared at that status instead of 422) and `list: true`
 * (a handler that takes its rows either as a field or as the whole body, so the body may be an array too), and `rules` (keywords for the body as a whole, for a rule no one field can say).
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
const pathParams = (path, schemas) => [...path.matchAll(/:(\w+)/g)].map((match) => ({ name: match[1], in: 'path', required: true, schema: (schemas || {})[match[1]] || { type: 'string', minLength: 1 } }));
/** query arguments as optional text: a handler reads them leniently, and a schema that refused "abc" would turn a fallback into a refusal no caller has ever had */
const queryParams = (names) => (names || []).map((name) => ({ name, in: 'query', required: false, schema: text }));
/** the request body: an object that names the fields the handler reads (a list of names, or { name: schema } where a field's kind is checked) and requires only the ones the row says; `list` = the handler also takes the rows as the whole body (an array); `rules` = more keywords for the body as a whole */
const bodyOf = (properties, required, list, rules) => {
  const named = Array.isArray(properties || []) ? Object.fromEntries((properties || []).map((name) => [name, any])) : properties;
  return { content: json(Object.assign({ type: list ? ['object', 'array'] : 'object' }, (required || []).length ? { required } : {}, { properties: named }, rules)) };
};

/** a route takes input when it writes, names a path argument or reads a query argument: the schema can then refuse it (422) */
const takesInput = (row, method, path) => WRITE_METHODS.includes(method) || path.includes(':') || (row.query || []).length > 0;

/** the refusal statuses a row declares, sorted (a route that keeps its old 400 for a malformed body says row.schemaStatus: 400 instead of the standard 422) */
function statusesOf(spec, row, method, path) {
  const gateStatuses = (row.gates || []).map((gate) => (spec.gateStatus || {})[gate]).filter(Boolean);
  const found = new Set([500, ...gateStatuses, ...(row.inline || [])]);
  if (!(row.public || row.open)) found.add(401);
  if (path.includes(':')) found.add(404);
  if (takesInput(row, method, path)) found.add(row.invalid || row.schemaStatus || 422);
  return [...found].sort((first, second) => first - second);
}

/** the success answer of a row: its media type (a download) or its JSON shape, under the status it answers (200 unless it says 201) */
const successOf = (row) => ({ [row.ok || 200]: { description: row.says || 'the answer', content: row.media ? media(row.media) : json(row.out || object()) } });
/** who may call: a session, and also a key when the row says so; a row that is public (row.public, also written row.open: no sign-in) asks for nothing and cannot answer 401 */
const securityOf = (row) => (row.public || row.open ? [] : row.keyed ? [{ bearer: [] }, { apiKey: [] }] : [{ bearer: [] }]);

/** the refusals a route can raise beyond its own statuses, for the extension: the area's list when the row names its gate, then the row's own (`refusals`, e.g. a limiter's 429) */
const refusalsOf = (spec, row) => ((spec.refusals && (row.gates || []).includes(spec.refusalsWhen) ? spec.refusals : []).concat(row.refusals || []));

/** one route's OpenAPI operation from its row */
function operationOf(spec, method, path, row) {
  const operation = { summary: row.summary, tags: [spec.mount.split('/').pop()], security: securityOf(row) };
  const parameters = pathParams(path, row.params).concat(queryParams(row.query));
  if (parameters.length) operation.parameters = parameters;
  if (WRITE_METHODS.includes(method)) operation.requestBody = row.bodySchema ? { content: json(row.bodySchema) } : bodyOf(row.body, row.required, row.list, row.rules);
  const refusals = Object.fromEntries(statusesOf(spec, row, method, path).map((status) => [status, problemResponse(STATUS_WORDS[status] || 'a refusal in words')]));
  operation.responses = Object.assign(successOf(row), refusals);
  const listed = refusalsOf(spec, row);
  if (listed.length) operation[spec.extension] = listed;
  return operation;
}

/**
 * what an operation PUBLISHES when its row says row.published = { body?, bodyRequired?, responses? }: the enforced operation with a documented request body
 * (typed, required) and extra responses laid over a copy. The enforced operation, the one schemaValidate holds, is never touched (documentation, not enforcement).
 */
function publishedOf(operation, published) {
  if (!published) return operation;
  const copy = Object.assign({}, operation, { responses: Object.assign({}, operation.responses, published.responses || {}) });
  copy['x-documented-statuses'] = Object.keys(published.responses || {}).map(Number); /* said for the reader; the handler does not write them (the register does not count them as the route's own) */
  if (published.body) copy.requestBody = { required: !!published.bodyRequired, content: json(published.body) };
  return copy;
}

/** the OpenAPI paths fragment of a set of operations keyed 'METHOD /full/path' (an express :id becomes {id}); publishedBy maps a key to its row.published */
function pathsFrom(operations, publishedBy) {
  const paths = {};
  Object.keys(operations).forEach((key) => {
    const [method, path] = key.split(' ');
    const template = path.replace(/:(\w+)/g, '{$1}');
    (paths[template] = paths[template] || {})[method.toLowerCase()] = publishedOf(operations[key], (publishedBy || {})[key]);
  });
  return paths;
}

/** the refusal statuses a test may see from one operation: what it declares, plus the shared refusals a route behind the gate can raise */
function allowedFrom(spec, operation) {
  const declared = Object.keys(operation.responses).map(Number).filter((status) => status >= 400);
  return declared.concat(((spec.extension && operation[spec.extension]) || []).map((item) => item.status));
}

/** 'METHOD /mount/path' of a row keyed 'METHOD /path'; a router's root ('/') is the mount itself, as the register names it */
const fullKey = (spec, route) => {
  const [method, path] = route.split(' ');
  return method + ' ' + spec.mount + (path === '/' ? '' : path);
};

/** contractOf({ mount, routes, gateStatus, refusals?, refusalsWhen?, extension? }) → { OPERATIONS, operationFor(route), pathsOf(), allowedStatuses() } */
function contractOf(spec) {
  const OPERATIONS = Object.fromEntries(
    Object.keys(spec.routes).map((route) => {
      const [method, path] = route.split(' ');
      return [fullKey(spec, route), operationOf(spec, method, path, spec.routes[route])];
    })
  );
  const publishedBy = Object.fromEntries(
    Object.keys(spec.routes)
      .filter((route) => spec.routes[route].published)
      .map((route) => [fullKey(spec, route), spec.routes[route].published])
  );
  return {
    OPERATIONS,
    operationFor: (route) => OPERATIONS[fullKey(spec, route)],
    pathsOf: () => pathsFrom(OPERATIONS, publishedBy),
    allowedStatuses: () => (key) => allowedFrom(spec, OPERATIONS[key] || { responses: {} })
  };
}

module.exports = { contractOf, json, media, object, array, any, text, statusesOf, operationOf };
