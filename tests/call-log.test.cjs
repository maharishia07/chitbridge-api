// @type: unit
/**
 * tests/call-log.test.cjs — a fake run with two calls records the two requests per case (QA 12 Nov): the harness's j() logs METHOD + path + status through tests/lib/call-log.cjs,
 * kase() puts the distinct ones on its result (`calls`), gorilla hammer() carries the whole run's on its report. The writers (toolset/lifecycle-run.cjs, toolset/gorilla-junit.cjs) turn them into
 * "METHOD /api/... — <case>" junit rows the coverage map credits (toolset/lifecycle/endpoint-rows.test.cjs reads them back through test-ledger junitRows). Offline: fetch is stubbed.
 * CARD 01-rail-core-the-chit/README
 */
'use strict';
const assert = require('assert'), path = require('path');
let pass = 0; const ok = (c, m) => { assert(c, m); pass++; console.log('  ok  ' + m); };
global.fetch = async (url, opt) => ({ status: /missing/.test(url) ? 404 : 200, json: async () => ({ url }) });
const H = require(path.join(__dirname, 'lib', 'truth-harness.cjs')), G = require(path.join(__dirname, 'lib', 'gorilla.cjs')), LOG = require(path.join(__dirname, 'lib', 'call-log.cjs'));
(async () => {
  await H.j('/api/entities/register?x=1', { method: 'POST', body: {} });                       // outside any case: logged, belongs to no case
  await H.kase('C-1', 'two calls', async () => { await H.j('/api/chits/abc123'); await H.j('/api/chits/abc123'); await H.j('/api/chits/missing', { method: 'DELETE' }); });
  /* the deliberate throw prints kase's "FAIL" line, which scripts/guards.cjs reads as a red file (/\bFAIL\b/ on the output): keep that one line off the log */
  const say = console.log; console.log = () => {};
  try { await H.kase('C-2', 'a throw keeps the calls it made', async () => { await H.j('/api/books/x'); throw new Error('boom'); }); } finally { console.log = say; }
  const c1 = H.results.find((r) => r.id === 'C-1'), c2 = H.results.find((r) => r.id === 'C-2');
  ok(c1.calls.length === 2 && c1.calls[0].m === 'GET' && c1.calls[0].p === '/api/chits/abc123' && c1.calls[1].m === 'DELETE' && c1.calls[1].s === 404, 'a case with three requests (two the same) carries the distinct two: METHOD, path, status');
  ok(c2.pass === false && c2.calls.length === 1 && c2.calls[0].p === '/api/books/x', 'a failed case keeps the request it made before it threw');
  ok(LOG.calls[0].p === '/api/entities/register' && LOG.calls[0].c === null, 'a request outside a case is logged with no case id (the query string dropped)');
  const report = await G.hammer({ label: 'fake', file: 'x', fixedSeed: 1, env: { GORILLA_N: '3' }, make: () => ({}), send: async () => { await H.j('/api/chits/send', { method: 'POST' }); await H.j('/api/chits/zz'); return {}; }, checks: [{ id: 'F-1', title: 'fine', check: () => null }], kase: H.kase });
  ok(report.calls.map((c) => c.m + ' ' + c.p).join() === 'POST /api/chits/send,GET /api/chits/zz', 'the gorilla report carries the distinct requests of its three records: two, not six');
  console.log('\n' + pass + ' checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
