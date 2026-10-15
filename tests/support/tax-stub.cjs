/**
 * tests/support/tax-stub.cjs — ONE shop in a stubbed database, and the REAL /api/tax + /api/facts routers over it (TAX-SRV1).
 * db/ and the auth middleware are replaced in require.cache (the walk-in-buyer.test.cjs pattern), so require this BEFORE any lib.
 * Used by tests/tax-compute.test.cjs and tests/support/contract-tax.cjs.
 *   SHOP.row   the identities row (gstn · display_name · country · policy_flags) · SHOP.items  catalogue rows · SHOP.boom  an error every query throws
 */
'use strict';
const path = require('path');
const http = require('http');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/x';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const SHOP = { row: null, items: [], boom: null };
const answer = async (sql) => {
  if (SHOP.boom) throw SHOP.boom;
  if (/SELECT identity_id, gstn, display_name, policy_flags, country FROM identities/.test(sql)) return { rows: SHOP.row ? [SHOP.row] : [] };
  if (/SELECT gstn FROM identities/.test(sql)) return { rows: SHOP.row ? [{ gstn: SHOP.row.gstn }] : [] };
  if (/FROM catalogue_items/.test(sql)) return { rows: SHOP.items };
  return { rows: [] };
};
const db = { query: answer, withEntity: async (_id, fn) => fn({ query: answer }), readBatch: async () => [] };
require.cache[require.resolve(path.join(__dirname, '..', '..', 'db'))] = { exports: db };
const authStub = (_req, _res, next) => next();
authStub.entityOf = () => 'E1';
authStub.requireScope = () => (_q, _r, next) => next();
require.cache[require.resolve(path.join(__dirname, '..', '..', 'middleware', 'auth'))] = { exports: authStub };

const shopRow = (s) => ({ identity_id: 'E1', gstn: s.gstin, display_name: s.name, country: s.country, policy_flags: s.policy || {} });

let server, base;
async function start() {
  const express = require('express');
  const app = express(); app.use(express.json());
  app.use('/api/tax', require('../../routes/tax'));
  app.use('/api/facts', require('../../routes/facts'));
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
}
function stop() { if (server) server.close(); }
const call = async (m, url, body) => {
  const r = await fetch(base + url, { method: m, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
module.exports = { SHOP, shopRow, start, stop, call };
