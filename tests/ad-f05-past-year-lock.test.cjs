/**
 * ad-f05-past-year-lock.test.cjs — AD-F-05 (walk AD): a past year the books hold no rows for (the shop started later) answered 404 "No such month" on every lock, so its year status could never be met.
 * HAND  AU shop, books start Nov 2026, "today" 2026-11-21: lock Jul 2025 of FY 2025-26 -> 200 (the year's 12 months are created open); a FUTURE year (2027-28) and a nonsense year still 404.
 * In-memory twin (tests/support/books-harness.cjs), no database. Run: node tests/ad-f05-past-year-lock.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = 'bbbbbbbb-2222-4111-8111-05f05f05f05f';
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Bondi Grocer' }; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
(async () => {
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); return; }
  X.T.identities.push({ identity_id: SHOP, gstn: '51824753556', display_name: 'Bondi Grocer', country: 'AU', policy_flags: { gst_registration: 'regular' } });
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  const realDay = K.dayOf; K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? '2026-11-21' : realDay(ts, c));
  await X.store.saveSetting(X.db, SHOP, { enabled: false, country: 'AU' });
  ok('the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  await X.B.postEntry(X.db, SHOP, { type: 'walkin_day', ref: 'D-1', date: '2026-11-10', currency: 'AUD', modes: { cash: 1100 }, by_rate: [{ rate: 10, taxable: 1000, gst: 100 }] }).catch(() => {});
  const before = await q('GET', '/periods?fy=2025-26');
  ok('before: the past year holds no month rows', !(before.body.periods || []).some((p) => Number(p.period) >= 1), JSON.stringify(before.body).slice(0, 200));
  const lock = await q('POST', '/periods/2025-26/1/lock', { reason: 'before the books start' });
  ok('locking Jul 2025 of the past year is accepted (200)', lock.status === 200, lock.status + ' ' + JSON.stringify(lock.body));
  const after = await q('GET', '/periods?fy=2025-26');
  ok('the 12 months now exist and July is locked', (after.body.periods || []).filter((p) => Number(p.period) >= 1).length === 12 && (after.body.periods || []).find((p) => Number(p.period) === 1).status === 'soft_locked', JSON.stringify(after.body).slice(0, 200));
  const future = await q('POST', '/periods/2027-28/1/lock', { reason: 'x' });
  ok('a year that has not started is still "No such month" (404)', future.status === 404, future.status + ' ' + JSON.stringify(future.body));
  const odd = await q('POST', '/periods/1980-81/1/lock', { reason: 'x' });
  ok('a year beyond the carry\'s reach (31 years) is still 404', odd.status === 404, odd.status + ' ' + JSON.stringify(odd.body));
  K.dayOf = realDay; srv.close();
  console.log('\n' + (pass + fail) + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
