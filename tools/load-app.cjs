'use strict';
/*
 * OWNS      loading the REAL server.js offline (database stubbed, listen() a no-op) and walking its Express router stacks into a flat list of routes.
 * CALLED BY tools/api-register.cjs (the register generator) · tests/limiter-paths.test.cjs (the public-door inventory). One loader, two callers (API-1 slice 1a).
 * FLOW      stubDatabase() ──▶ loadApp() ──▶ leavesOf(app) → [{ method, path, chain, handler, fns, router, scoped }]
 * CARD      28-platform-and-operations/api-standard
 */
const path = require('path');

const API = path.join(__dirname, '..');
const BACKSLASH = String.fromCharCode(92);

/**
 * (root: another checkout of the api, e.g. the base of a PR; default this one) a database nothing answers: no rows, a transaction that runs its function. Installed in the require cache BEFORE server.js loads.
 * (answer: optional, (sql, params, entity) → { rows, rowCount } for every statement; entity is the shop of a withEntity/onEntity scope, else null — the hardening cases of tools/api-contract-tests.cjs play a world through it)
 */
function stubDatabase(root, answer) {
  const answerOf = (entity) => async (sql, params) => (answer ? answer(String(sql && sql.text ? sql.text : sql), params || [], entity) : { rows: [], rowCount: 0 });
  const scoped = (entity) => ({ query: answerOf(entity) });
  const client = scoped(null);
  const unscoped = answerOf(null);
  const dbPath = require.resolve(path.join(root || API, 'db'));
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      query: unscoped,
      pool: { query: unscoped, connect: async () => Object.assign({ release() {} }, client) },
      withEntity: async (id, body) => body(scoped(id)),
      withTransaction: async (body) => body(client),
      onEntity: async (id, db, body) => body(scoped(id)),
      readBatch: async () => ({}),
      trySavepoint: async (db, body, fallback) => {
        try {
          return await body(db);
        } catch (failure) {
          return fallback;
        }
      }
    }
  };
}

/** server.js without listening and without its start-up lines */
function loadApp(root) {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-the-api-walk';
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  const express = require('express');
  express.application.listen = () => ({ close() {} });
  const realLog = console.log;
  console.log = () => {};
  try {
    return require(path.join(root || API, 'server.js'));
  } finally {
    console.log = realLog;
  }
}

/** the mount path of a router layer, read from its regexp (express 4) */
function mountOf(layer) {
  if (layer.regexp && layer.regexp.fast_slash) return '';
  let source = layer.regexp.source;
  if (source[0] === '^') source = source.slice(1);
  const tail = BACKSLASH + '/?(?=' + BACKSLASH + '/|$)';
  const tailAt = source.indexOf(tail);
  if (tailAt >= 0) source = source.slice(0, tailAt);
  return source.split(BACKSLASH + '/').join('/').split(BACKSLASH).join('');
}

/** one entry per method of a route layer: chain = the middleware in front (use-level wrappers and route-level), handler = the last function */
function leavesOfRoute(layer, prefix, running, router, allPaths) {
  const routePaths = [].concat(layer.route.path).map((item) => (item instanceof RegExp ? String(item) : item));
  if (!allPaths && (routePaths.length !== 1 || typeof layer.route.path !== 'string')) return []; /* regex and array paths: the public-door walk asserts none matters to it */
  const handlers = layer.route.stack.map((item) => item.handle);
  const methods = Object.keys(layer.route.methods).filter((method) => layer.route.methods[method]);
  const entries = [];
  routePaths.forEach((routePath) =>
    methods.forEach((method) =>
      entries.push({
        method: method.toUpperCase(),
        path: (prefix + (routePath === '/' ? '' : routePath)) || '/',
        routePath,
        chain: running.concat(handlers.slice(0, -1)),
        handler: handlers[handlers.length - 1],
        fns: handlers,
        router,
        scoped: layer.route.stack.length
      })
    )
  );
  return entries;
}

/** leavesOf(app, allPaths?) — every leaf route (allPaths: also the array and regex paths, one entry each), with the ordered middleware in front of it (a plain app.use middleware is a {fn, mount, layer, prefix} wrapper) */
function leavesOf(app, allPaths) {
  const leaves = [];
  (function walk(stack, prefix, chain, router) {
    let running = chain.slice();
    for (const layer of stack) {
      if (layer.route) leaves.push(...leavesOfRoute(layer, prefix, running, router, allPaths));
      else if (layer.name === 'router' && layer.handle.stack) walk(layer.handle.stack, prefix + mountOf(layer), running.slice(), layer.handle);
      else running = running.concat([{ fn: layer.handle, mount: mountOf(layer), layer, prefix }]);
    }
  })(app._router.stack, '', [], app);
  return leaves;
}

module.exports = { stubDatabase, loadApp, leavesOf, mountOf };
