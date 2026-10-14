'use strict';
/**
 * route-golden.cjs — RUN A REAL ROUTE WITH THE DATABASE STUBBED, AND WRITE DOWN EVERYTHING IT DID.
 *
 * Round T2-SPLIT (2026-10-14): the giant handlers (POST /chits/send, POST /network-design/build, deliver-lines, the
 * trace walk) were split into named steps, REFACTOR-ONLY. The DB-backed CI job is gated off (ci.yml), so "behaviour
 * identical" needed a proof that runs offline: a GOLDEN MASTER. Every scenario drives the real router through
 * express; every SQL statement (normalised), its parameters, every copy handed to mint.deliver, every post-commit
 * hook and the response are recorded, and the recording is compared with the one frozen from the code BEFORE the
 * split (tests/fixtures/*-golden.json). One harness, several callers — the stubbing pattern page-name.test.cjs
 * proved, lifted here instead of copied into each test.
 *
 *   const G = require('./support/route-golden.cjs');
 *   const h = G.harness({ rows: (sql, params, ctx) => [...] });   // BEFORE requiring the route
 *   const app = h.app('/api/chits', require('../routes/chits'));
 *   const rec = await h.run(app, { method, url, body, identity, till });
 *   G.compare(name, recordings, fixturePath)                      // --write freezes, otherwise compares
 */
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..', '..');
process.env.DATABASE_URL = process.env.DATABASE_URL || '';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ISO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;

/** the same value with every unknown uuid numbered by first sight and every timestamp blanked — what may differ run to run */
function normaliser(known) {
  const seen = new Map();
  const str = (s) => s
    .replace(UUID, (u) => known[u.toLowerCase()] || (seen.has(u) ? seen.get(u) : (seen.set(u, 'UUID#' + (seen.size + 1)), seen.get(u))))
    .replace(ISO, 'TS');
  const walk = (v) => {
    if (v instanceof Date) return 'TS';
    if (typeof v === 'string') return str(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) { if (k === 'client') continue; o[k] = walk(v[k]); } return o; }
    return v;
  };
  return walk;
}

function stubModule(rel, exportsObj) {
  const p = require.resolve(path.join(API, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
  return exportsObj;
}

/**
 * harness({ rows, known }) — stubs ../db (every call recorded) and middleware/auth (identity per request).
 *   rows(sql, params, ctx) → the rows that statement returns (throw to make it fail); ctx is the scenario's own object
 *   known                  → { uuid: 'NAME' } — fixture ids printed by name
 */
function harness(opts) {
  const o = opts || {};
  const state = { calls: null, ctx: {}, identity: null, till: undefined };
  const rec = (via, sql, params) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (state.calls) state.calls.push({ via, sql: s, params: params === undefined ? null : params });
    return o.rows ? o.rows(s, params || [], state.ctx) : [];
  };
  const client = (via) => ({ query: async (sql, params) => ({ rows: rec(via, sql, params), rowCount: 0 }) });
  const db = stubModule('db', {
    query: async (sql, params) => ({ rows: rec('query', sql, params), rowCount: 0 }),
    withEntity: async (id, fn) => fn(client('withEntity:' + id)),
    withTransaction: async (fn) => fn(client('tx')),
    trySavepoint: async (c, fn, fb) => { try { return await fn(c); } catch (_) { return fb; } },
    onEntity: async (id, c, fn) => fn(client('onEntity:' + id)),
    readBatch: async () => [], inlineSql: (s) => s, RLS_TENANT_TABLES: [],
    get pool() { return null; },
  });
  const realAuth = require(path.join(API, 'middleware', 'auth'));
  const auth = Object.assign((req, res, next) => {
    req.identity = Object.assign({}, state.identity);
    if (state.till !== undefined) req.till = state.till;
    next();
  }, realAuth);
  stubModule('middleware/auth', auth);
  const known = Object.assign({}, o.known || {});
  return {
    db, state,
    /** record a non-db call (a post-commit hook, a deliver) into the current scenario */
    note(kind, payload) { if (state.calls) state.calls.push({ via: kind, payload }); },
    app(mount, router) {
      const express = require('express');
      const app = express(); app.use(express.json({ limit: '2mb' }));
      app.use(mount, router);
      return app;
    },
    /** one request; resolves with the normalised recording */
    async run(app, req) {
      state.calls = []; state.ctx = req.ctx || {}; state.identity = req.identity; state.till = req.till;
      const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
      let status, body;
      try {
        const r = await fetch('http://127.0.0.1:' + srv.address().port + req.url, {
          method: req.method || 'POST', headers: { 'Content-Type': 'application/json' },
          body: req.body === undefined ? undefined : JSON.stringify(req.body) });
        status = r.status; body = await r.json().catch(() => null);
        await new Promise((r2) => setTimeout(r2, req.settle || 40));   /* the post-response work (setImmediate, unawaited) lands */
      } finally { srv.close(); }
      const out = normaliser(known)({ status, body, calls: state.calls });
      state.calls = null;
      return out;
    },
  };
}

/** --write freezes the recordings; otherwise every scenario must equal its frozen twin. Returns the failures. */
function compare(recordings, fixture) {
  const write = process.argv.includes('--write');
  if (process.env.GOLDEN_DUMP) fs.writeFileSync(process.env.GOLDEN_DUMP, JSON.stringify(recordings, null, 1));   /* to diff a failure by hand */
  if (write) {
    fs.writeFileSync(fixture, JSON.stringify(recordings, null, 1) + '\n');
    console.log('   wrote ' + path.relative(API, fixture) + ' (' + Object.keys(recordings).length + ' scenarios)');
    return [];
  }
  const frozen = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const bad = [];
  for (const name of Object.keys(frozen)) {
    const a = JSON.stringify(recordings[name]), b = JSON.stringify(frozen[name]);
    if (a !== b) bad.push({ name, got: recordings[name], want: frozen[name] });
  }
  for (const name of Object.keys(recordings)) if (!(name in frozen)) bad.push({ name, got: recordings[name], want: undefined });
  return bad;
}

/** where two recordings first part — printed on a failure so the diff is readable */
function firstDiff(got, want) {
  const g = JSON.stringify(got, null, 1).split('\n'), w = JSON.stringify(want, null, 1).split('\n');
  for (let i = 0; i < Math.max(g.length, w.length); i++) {
    if (g[i] !== w[i]) return 'line ' + (i + 1) + '\n            got:  ' + (g[i] || '(end)') + '\n            want: ' + (w[i] || '(end)');
  }
  return '(identical text)';
}

module.exports = { harness, compare, firstDiff, normaliser, stubModule, API };
