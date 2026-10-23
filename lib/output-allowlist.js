/*
 * OWNS      the output allow-list (API-STANDARD S34): a success answer leaves a route holding ONLY the keys its success schema lists, at every level the schema closes
 *           (additionalProperties: false). prune() is the pure rule, outputFilter() the express middleware that applies it to res.json, shapeOf() reads the derived answer shapes.
 * CALLED BY lib/contract-kit.js (checkOf puts outputFilter in front of a route whose success schema is closed) · tools/api-allowlist.cjs (the shapes it writes) · tests/lib/problem-world.cjs (droppedKeys:
 *           a sweep test fails when any answer lost a key) · tests/api-allowlist.test.cjs.
 * FLOW      docs/contracts/api-output-shapes.json (derived by tools/api-allowlist.cjs from the answers a route gives today) → contractOf success schema → outputFilter(operation) → res.json(body) → prune
 * CARD      28-platform-and-operations/api-standard
 *
 * ⚠️ A FILTER THAT DROPS KEYS IS A SILENT BUG WAITING FOR A DATA SHAPE NO TEST HAD (Athi: "silence is the bug"). So a dropped key is never silent: it is logged as a warning with the route and the path
 *    (once per route and path), and counted (droppedKeys), and every sweep test fails when its scenarios drop one. The shapes are derived from today's answers, so on every recorded answer the filter is the identity.
 * Key ORDER is the answer's own (the filter walks the body's keys, not the schema's), so a body that loses nothing is byte for byte what the handler wrote.
 * Not touched: anything that is not a plain object or an array (a Date, a Buffer, a value with toJSON), a schema node that is not closed, a status the operation declares no closed schema for.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const log = require('./logger');

const SHAPES_FILE = path.join(__dirname, '..', 'docs', 'contracts', 'api-output-shapes.json');
const SUCCESS_STATUS = /^2\d\d$/;
const lost = []; /* every { route, path } a filter has dropped in this process (the sweep tests read it) */
const warned = new Set();

/** a plain object: not an array, not a Date or Buffer, not a value that has its own toJSON */
const isPlain = (value) => !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.toJSON !== 'function' && !(value instanceof Date) && !Buffer.isBuffer(value);
/** a schema node that lists its keys and refuses the rest */
const isClosed = (schema) => !!schema && typeof schema === 'object' && schema.additionalProperties === false;

/** does this schema close any node at all (the object itself, a declared property, or an array's items) */
function closesAnything(schema, depth) {
  if (!schema || typeof schema !== 'object' || (depth || 0) > 8) return false;
  if (isClosed(schema)) return true;
  const children = Object.values(schema.properties || {}).concat(schema.items && typeof schema.items === 'object' ? [schema.items] : []);
  return children.some((child) => closesAnything(child, (depth || 0) + 1));
}

/** the object's own keys kept by an allow-list, each pruned by its property's schema */
function pruneObject(schema, value, where, dropped) {
  const properties = schema.properties || {};
  const out = {};
  Object.keys(value).forEach((key) => {
    if (!(key in properties) && isClosed(schema)) {
      dropped.push(where.concat(key).join('.'));
      return;
    }
    out[key] = key in properties ? pruneValue(properties[key], value[key], where.concat(key), dropped) : value[key];
  });
  return out;
}

/** a value pruned by its schema node: objects by their properties, arrays by their items; everything else is returned as it is */
function pruneValue(schema, value, where, dropped) {
  if (!schema || typeof schema !== 'object') return value;
  if (Array.isArray(value)) return schema.items && typeof schema.items === 'object' ? value.map((item) => pruneValue(schema.items, item, where.concat('[]'), dropped)) : value;
  if (!isPlain(value) || !(isClosed(schema) || schema.properties)) return value;
  return pruneObject(schema, value, where, dropped);
}

/** prune(schema, body) → { value, dropped: ['path.of.key', ...] }; the value is the body itself when nothing was dropped */
function prune(schema, body) {
  const dropped = [];
  const value = pruneValue(schema, body, [], dropped);
  return { value: dropped.length ? value : body, dropped };
}

/** the closed success schemas of an operation as { '200': schema } (only the ones that close something) */
function closedSuccessOf(operation) {
  const responses = (operation && operation.responses) || {};
  const found = {};
  Object.keys(responses).filter((status) => SUCCESS_STATUS.test(status)).forEach((status) => {
    const content = responses[status] && responses[status].content && responses[status].content['application/json'];
    if (content && closesAnything(content.schema)) found[status] = content.schema;
  });
  return found;
}

/** say it once per route and path, in a warning, and keep count */
function reportDropped(route, dropped) {
  dropped.forEach((where) => {
    lost.push({ route, path: where });
    const seen = route + ' ' + where;
    if (warned.has(seen)) return;
    warned.add(seen);
    log.warn('output allow-list dropped a key the answer schema does not list — add it to docs/contracts/api-output-shapes.json if callers read it', { route, key: where });
  });
}

/**
 * outputFilter(operation, route?) → express middleware, or null when the operation closes no success schema.
 * It wraps res.json: a 2xx body is pruned by the schema of its status; any other status passes untouched.
 */
function outputFilter(operation, route) {
  const closed = closedSuccessOf(operation);
  if (!Object.keys(closed).length) return null;
  /* the middleware itself: wraps res.json so a 2xx body is pruned by the schema of its status, then calls next() */
  const filterOutput = function filterOutput(req, res, next) {
    const write = res.json.bind(res);
    res.json = (body) => {
      const schema = closed[String(res.statusCode)];
      if (!schema) return write(body);
      const pruned = prune(schema, body);
      if (pruned.dropped.length) reportDropped(route || (req.method + ' ' + (req.baseUrl || '') + (req.route ? req.route.path : '')), pruned.dropped);
      return write(pruned.value);
    };
    next();
  };
  filterOutput.outputAllowlist = closed;
  return filterOutput;
}

let shapes = null;
/** the derived answer shapes of docs/contracts/api-output-shapes.json: { routes: { 'GET /api/x': { status, schema } }, listed: {...} } (read once) */
function shapesFile() {
  if (shapes) return shapes;
  try {
    shapes = JSON.parse(fs.readFileSync(SHAPES_FILE, 'utf8'));
  } catch (unreadable) {
    log.warn('output allow-list shapes unreadable — no route is filtered until docs/contracts/api-output-shapes.json reads', { file: SHAPES_FILE, err: unreadable.message });
    shapes = { routes: {}, listed: {} };
  }
  return shapes;
}

/** the derived success shape of a route key, or null */
const shapeOf = (key) => shapesFile().routes[key] || null;
/** the keys dropped so far in this process (and a way for a test to start from none) */
const droppedKeys = () => lost.slice();
/** start a test from no dropped keys and no warning given */
const forgetDropped = () => { lost.length = 0; warned.clear(); };

module.exports = { prune, outputFilter, closedSuccessOf, shapeOf, shapesFile, droppedKeys, forgetDropped, SHAPES_FILE };
