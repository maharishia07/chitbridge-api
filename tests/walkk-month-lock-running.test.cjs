/**
 * walkk-month-lock-running.test.cjs — WALK K K-F-01 (21 Nov 2026): THE RUNNING MONTH IS NOT LOCKED.
 *   Before: POST /periods/2026-27/5/lock on 21 Nov locked November, and today's takings then answered 409 PERIOD_LOCKED until the owner reopened it.
 *   Now: the lock asks the ONE period-end check (books-period.refuseUnfinished, the same one the tax close uses): a month that has not ended is refused in words (PERIOD_NOT_ENDED) and stays open;
 *   a month that has ended (October) locks; today's takings still post. Hand figures (AU shop, shop day 21 Nov 2026, cents): sale 1,000.00 + GST 100.00 = 110000 cash on 10 Oct,
 *   and 55000 cash (500.00 + GST 50.00) on 21 Nov; October holds 1 entry, November 1 entry.
 * Run: node tests/walkk-month-lock-running.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = 'bbbbbbbb-2222-4111-8111-0128aaaa0001';
const WHO = { identity_id: SHOP, identity_type: 'entity', display_name: 'Bondi Grocer' };
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
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
  const FY = '2026-27';
  await X.store.saveSetting(X.db, SHOP, { enabled: false, country: 'AU' });
  ok('the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  const day = (ref, date, taxable, gst) => X.B.postEntry(X.db, SHOP, { type: 'walkin_day', ref, date, currency: 'AUD', modes: { cash: taxable + gst }, by_rate: [{ rate: 10, taxable, gst }] });
  ok('10 Oct sale posts (cash 1,100.00 = 110000 cents)', (await day('D-OCT', '2026-10-10', 1000, 100)).ok === true);
  const month = async (n) => (await q('GET', '/periods?fy=' + FY)).body.periods.find((p) => Number(p.period) === n);

  const run = await q('POST', '/periods/' + FY + '/5/lock', { reason: 'early' });
  ok('locking November on 21 Nov is refused', run.status >= 400 && run.status < 500, JSON.stringify(run.body));
  ok('...in words: it names the last day and says to wait', /ends on 2026-11-30/.test(JSON.stringify(run.body)) && /once it has ended/.test(JSON.stringify(run.body)), JSON.stringify(run.body));
  eq('...and November stays open', (await month(5)).status, 'open');
  const hard = await q('POST', '/periods/' + FY + '/5/lock', { hard: true, reason: 'early' });
  ok('a hard lock of the running month is refused too', hard.status >= 400 && hard.status < 500 && (await month(5)).status === 'open', JSON.stringify(hard.body));
  const today = await day('D-NOV', '2026-11-21', 500, 50);
  ok('today\'s takings still post (cash 550.00 = 55000 cents)', today.ok === true, JSON.stringify(today));
  eq('November holds its 1 entry', (await month(5)).entries, 1);

  ok('October, which has ended, locks', (await q('POST', '/periods/' + FY + '/4/lock', { reason: 'Oct signed off' })).status === 200);
  eq('...and reads soft_locked', (await month(4)).status, 'soft_locked');
  eq('October holds its 1 entry', (await month(4)).entries, 1);
  K.dayOf = realDay; srv.close();
  console.log('\n' + pass + ' ok, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL ' + (e && e.stack || e)); process.exit(1); });
