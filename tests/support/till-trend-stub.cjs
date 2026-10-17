/**
 * tests/support/till-trend-stub.cjs — ONE shop's summary chits in a stubbed database, and the REAL /api/till router over it (RPT2).
 * db/ and the auth middleware are replaced in require.cache (the tax-stub.cjs pattern), so require this BEFORE any lib.
 * Used by tests/till-trend.test.cjs and tests/support/contract-till.cjs (the contract's GET /api/till/summary #compare).
 *   S.shop   the shop's year row { country, currency_code, books, gov } · S.rows  summary chits by period (week · month · year)
 *   start() → { get(query) → { status, json, trips }, stop() }
 * Owns: nothing in the product. FLOW: R2R · reports.
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const API = path.join(__dirname, '..', '..');

const mock = (rel, exports) => { require.cache[require.resolve(API + rel)] = { id: rel, filename: rel, loaded: true, exports }; };
mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity' }; next(); }, {
  entityOf: (req) => (req.identity && req.identity.identity_id) || null,
  requireScope: () => (req, res, next) => next(),
}));

const S = { shop: null, rows: { week: [], month: [], year: [] }, trips: 0 };
/** one summary chit as a counter sends it (period · key · gross), with the day keys it covers when a coverage test needs them */
const sumRow = (period, key, gross, source) => ({ chit_id: period + key, created_at: new Date(), business_json: { summary: {
  period, key, till: { id: 'C1' }, source: source || undefined,
  totals: { count: 4, returns: 0, gross, refunds: 0, expenseCount: 0, expenses: 0, total: gross - 10, by: {} } } } });
/** the stand-in's answer to one statement: the shop's year row, or the summaries of one period, newest first */
function answer(text, params) {
  const sql = String(text);
  if (/AS gov\b/.test(sql)) return { rows: S.shop ? [S.shop] : [] };
  if (/FROM chit_header h/.test(sql)) return { rows: (S.rows[params[1]] || []).slice().sort((a, b) => (a.business_json.summary.key < b.business_json.summary.key ? 1 : -1)) };
  return { rows: [] };
}
mock('/db', {
  query: async (s, p) => { S.trips++; return answer(s, p); },
  withEntity: async (_id, fn) => { S.trips++; return fn({ query: async (s, p) => answer(s, p) }); },
  withTransaction: async (fn) => { S.trips++; return fn({ query: async (s, p) => answer(s, p) }); },
  readBatch: async (_e, _a, stmts) => { S.trips++; return stmts.map((s) => answer(s.text, s.params)); },
  trySavepoint: async (h, fn, fb) => { try { return await fn(h); } catch (failure) { return fb; } },   /* the real one's contract: the fallback on a throw */
});

/** a full month's day keys (the coverage rule: a month is whole when every day of it sent a summary) */
const daysOf = (m) => { const [y, mo] = m.split('-').map(Number); const n = new Date(Date.UTC(y, mo, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => m + '-' + String(i + 1).padStart(2, '0')); };
/** the month key k months before this one (UTC) */
const monthsBack = (k) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); };

/** the real router on a free port; get(query) asks GET /api/till/summary?<query> and counts the trips it made */
function start() {
  const app = express();
  app.use('/api/till', require(API + '/routes/till'));
  const srv = app.listen(0), port = srv.address().port;
  const get = (query) => new Promise((done) => {
    S.trips = 0;
    http.get({ host: '127.0.0.1', port, path: '/api/till/summary?' + query }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const body = Buffer.concat(chunks).toString(); let json = null; try { json = JSON.parse(body); } catch (failure) { json = { unreadable: body.slice(0, 200) }; } done({ status: res.statusCode, json, trips: S.trips }); });
    });
  });
  return { get, stop: () => srv.close() };
}

module.exports = { S, sumRow, daysOf, monthsBack, start, API };
