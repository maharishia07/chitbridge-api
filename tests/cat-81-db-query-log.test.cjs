#!/usr/bin/env node
/**
 * cat-81-db-query-log.test.cjs — CAT-81 (proof 2026-11-14): DB_QUERY_LOG=true is the ONLY switch that logs a query (not NODE_ENV).
 * @type regression
 * OWNS      the proof that db/index.js query() prints its "Query:" line when DB_QUERY_LOG is 'true' (spaces trimmed), and never for NODE_ENV=development
 *           (the live API runs with " development"), DB_QUERY_LOG unset, or any other value.
 * CALLED BY scripts/guards.cjs · CI. No database: pg.Pool is a stand-in that answers one row.
 * FLOW      stub pg.Pool → load db/index.js → query() under each env → count the "Query:" lines
 *   node tests/cat-81-db-query-log.test.cjs
 */
'use strict';
const path = require('path');
const pg = require('pg');
const { ok, done } = require('./lib/cat-proof-kit.cjs');
process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:1/x?sslmode=disable';
process.env.RLS_GUARD = 'off';
class FakePool {
  constructor() { this.handlers = {}; }
  on(ev, fn) { this.handlers[ev] = fn; return this; }
  connect(cb) { const c = { query: async () => ({}), on() {} }; if (cb) cb(null, c, () => undefined); else return Promise.resolve(Object.assign(c, { release() {} })); }
  end() {}
  query() { return Promise.resolve({ rows: [{ one: 1 }], rowCount: 1 }); }
}
pg.Pool = FakePool;
const realLog = console.log; const lines = [];
console.log = (...a) => lines.push(a.join(' '));
const db = require(path.join(__dirname, '..', 'db', 'index.js'));
const queryLines = async (env) => {
  for (const k of ['DB_QUERY_LOG', 'NODE_ENV']) delete process.env[k];
  Object.assign(process.env, env);
  lines.length = 0;
  await db.query('SELECT 1');
  return lines.filter((l) => /^Query:/.test(l)).length;
};
(async () => {
  const dev = await queryLines({ NODE_ENV: ' development' });
  const dev2 = await queryLines({ NODE_ENV: 'development' });
  const unset = await queryLines({});
  const no = await queryLines({ DB_QUERY_LOG: 'false' });
  const yes = await queryLines({ DB_QUERY_LOG: ' true ' });
  console.log = realLog;
  ok('NODE_ENV=" development" (as live runs) logs no query', dev === 0, dev);
  ok('NODE_ENV=development logs no query — the environment name is not the switch', dev2 === 0, dev2);
  ok('DB_QUERY_LOG unset logs no query', unset === 0, unset);
  ok('DB_QUERY_LOG=false logs no query', no === 0, no);
  ok('DB_QUERY_LOG=" true " logs exactly one Query: line', yes === 1, yes);
  done();
})();
