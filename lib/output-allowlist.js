/*
 * OWNS      the output allow-list (API-STANDARD S34): a success answer leaves a route holding ONLY the keys its success schema lists, at every level the schema closes
 *           (additionalProperties: false). prune() is the pure rule, outputFilter() the express middleware that applies it to res.json, shapeOf() reads the derived answer shapes.
 * CALLED BY lib/contract-kit.js (checkOf puts outputFilter in front of a route that has a DERIVED shape) · tools/api-allowlist.cjs (the shapes it writes) · tests/lib/problem-world.cjs (sets OUTPUT_ALLOWLIST=enforce and
 *           fails a sweep test when any answer lost a key) · server.js (/health `output_dropped`) · tests/api-allowlist.test.cjs.
 * FLOW      docs/contracts/api-output-shapes.json (derived by tools/api-allowlist.cjs from the answers a route gives today) → contractOf success schema → outputFilter(operation) → res.json(body) → prune
 * CARD      28-platform-and-operations/api-standard
 *
 * ⚠️ A FILTER THAT DROPS KEYS IS A SILENT BUG WAITING FOR A DATA SHAPE NO TEST HAD (Athi: "silence is the bug"). So a dropped key is never silent: it is logged as a warning with the route and the path
 *    (once per route and path), and counted per route (droppedCount, /health `output_dropped`), and every sweep test fails when its scenarios drop one. The shapes are derived from today's answers, so on every recorded answer the filter is the identity.
 * MODE (env OUTPUT_ALLOWLIST): `enforce` drops the key; anything else (the DEFAULT, `report`) passes the key through and only counts it, so production needs no variable. Tests and CI set enforce.
 *    Switch production to enforce after 7 days of output_dropped 0 on /health (Athi's call, the pattern of LEGACY_TOKEN_REFUSE).
 * A filter is built ONLY from a shape derived from recorded answers (observed > 0), never from a hand-written `out:`.
 * Key ORDER is the answer's own (the filter walks the body's keys, not the schema's), so a body that loses nothing is byte for byte what the handler wrote.
 * Not touched: anything that is not a plain object or an array (a Date, a Buffer, a value with toJSON), a schema node that is not closed, a status the operation declares no closed schema for.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const log = require('./logger');

const SHAPES_FILE = path.join(__dirname, '..', 'docs', 'contracts', 'api-output-shapes.json');
const SUCCESS_STATUS = /^2\d\d$/;
const MAX_ROUTES = 1000; /* the counter is bounded: at most this many routes, each with at most MAX_PATHS distinct paths */
const MAX_PATHS = 20;
const lost = new Map(); /* route → { count, paths: Map(path → count) }; the sweep tests and /health read it */
const warned = new Set();
/** enforce drops the key; every other value (the default) reports it and lets it through */
const enforcing = () => process.env.OUTPUT_ALLOWLIST === 'enforce';

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

/** count one dropped path of a route (bounded) and say it once per route and path, in a warning */
function reportDropped(route, dropped) {
  dropped.forEach((where) => {
    countDropped(route, where);
    const seen = route + ' ' + where;
    if (warned.has(seen) || warned.size >= MAX_ROUTES * MAX_PATHS) return;
    warned.add(seen);
    log.warn('output allow-list ' + (enforcing() ? 'dropped' : 'would drop') + ' a key the answer schema does not list — add it to docs/contracts/api-output-shapes.json if callers read it', { route, key: where });
  });
}

/** add one to the route's count and to the path's count, inside the bounds */
function countDropped(route, where) {
  if (!lost.has(route) && lost.size >= MAX_ROUTES) return;
  const entry = lost.get(route) || { count: 0, paths: new Map() };
  entry.count += 1;
  if (entry.paths.has(where) || entry.paths.size < MAX_PATHS) entry.paths.set(where, (entry.paths.get(where) || 0) + 1);
  lost.set(route, entry);
}

/**
 * outputFilter(derived, route?) → express middleware, or null unless `derived` is a shape taken from recorded answers (observed > 0) that closes something.
 * It wraps res.json: a body under the shape's status is pruned (enforce) or only counted (report); any other status passes untouched.
 */
function outputFilter(derived, route) {
  if (!derived || !(derived.observed > 0) || !closesAnything(derived.schema)) return null;
  const status = String(derived.status);
  /* the middleware itself: wraps res.json, then calls next() */
  const filterOutput = function filterOutput(req, res, next) {
    const write = res.json.bind(res);
    res.json = (body) => {
      if (String(res.statusCode) !== status) return write(body);
      const pruned = prune(derived.schema, body);
      if (pruned.dropped.length) reportDropped(route || (req.method + ' ' + (req.baseUrl || '') + (req.route ? req.route.path : '')), pruned.dropped);
      return write(enforcing() ? pruned.value : body);
    };
    next();
  };
  filterOutput.outputAllowlist = derived.schema;
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

/** the derived success shape of a route key, or null (also null when no recorded answer reached it: observed 0) */
const shapeOf = (key) => {
  const shape = shapesFile().routes[key];
  return shape && shape.observed > 0 ? shape : null; /* a shape no recorded answer stands behind is a shape of nothing */
};
/** every dropped path so far as [{ route, path, count }] (bounded) */
const droppedKeys = () => [...lost].flatMap(([route, entry]) => [...entry.paths].map(([where, count]) => ({ route, path: where, count })));
/** the total number of drops since boot, for GET /health */
const droppedCount = () => [...lost.values()].reduce((sum, entry) => sum + entry.count, 0);
/** start a test from no dropped keys and no warning given */
const forgetDropped = () => { lost.clear(); warned.clear(); };

module.exports = { prune, outputFilter, shapeOf, shapesFile, droppedKeys, droppedCount, forgetDropped, enforcing, SHAPES_FILE };
