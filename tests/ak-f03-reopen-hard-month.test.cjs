/**
 * ak-f03-reopen-hard-month.test.cjs — AK-F-03 (walk AK 21 Nov): the sentence "The owner can open the newest closed month again with a reason" is true.
 * HAND-COMPUTED  AU shop, day 2026-10-10; Jul and Aug soft-locked, Sep hard-locked (the newest closed month):
 *   periods: Sep reopen.may true (owner words), Aug may false · /unlock on Sep without a reason: refused in words, still hard_locked ·
 *   /unlock on Sep with a reason: 200 status open, one change-log row 'hard_locked' → 'open — <reason>' · Aug then opens too (newest soft lock) ·
 *   a month hard-locked under a later closed month: /unlock refused ("only the last closed month") · a non-owner: 403.
 * Run: BOOKS_ENGINES_SRC=… node tests/ak-f03-reopen-hard-month.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const AU = 'aaaaaaaa-7777-4111-8111-111111111111';
let ROLE = 'owner';
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: AU, identity_type: 'entity', display_name: 'Bondi Grocer' }; if (ROLE !== 'owner') req.identity.parent_entity_id = AU; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

(async () => {
  console.log('\n══ AK-F-03: the owner opens the newest hard-locked month with a reason ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  X.T.identities.push({ identity_id: AU, gstn: '51824753556', display_name: 'Bondi Grocer', country: 'AU', policy_flags: { gst_registration: 'regular' } });
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); CLOCK.set('2026-07-02T02:00:00Z');
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  await q('POST', '/enable', {});
  X.T.setting.get(AU).enabled_at = '2026-07-02T02:00:00.000Z';
  await X.B.postEntry(X.db, AU, { type: 'walkin_day', ref: 'S1', date: '2026-07-09', currency: 'AUD', modes: { cash: 1100 }, by_rate: [{ rate: 10, taxable: 1000, gst: 100 }] });
  CLOCK.set('2026-10-10T02:00:00Z');
  const l1 = await q('POST', '/periods/2026-27/1/lock', { reason: 'checked' }), l2 = await q('POST', '/periods/2026-27/2/lock', { reason: 'checked' }), l3 = await q('POST', '/periods/2026-27/3/lock', { reason: 'closed for good', hard: true });
  ok('set-up: Jul, Aug soft; Sep hard', l1.status === 200 && l2.status === 200 && l3.status === 200 && l3.body.period.status === 'hard_locked', JSON.stringify([l1.body, l2.body, l3.body]).slice(0, 300));
  const list = (await q('GET', '/periods')).body, rows = list.periods || list;
  const sep = rows.find((r) => r.fiscal_year === '2026-27' && Number(r.period) === 3), aug = rows.find((r) => r.fiscal_year === '2026-27' && Number(r.period) === 2);
  ok('GET /periods: the newest hard-locked month says reopen.may true, with the owner in the words; the month under it waits', sep && sep.reopen.may === true && /owner/.test(sep.reopen.why) && aug.reopen.may === false, JSON.stringify([sep && sep.reopen, aug && aug.reopen]));
  ROLE = 'firm';
  const f = await q('POST', '/periods/2026-27/3/unlock', { reason: 'late bill' });
  ok('a non-owner: 403, still hard locked', f.status === 403 && X.T.periods.find((p) => p.fiscal_year === '2026-27' && Number(p.period) === 3).status === 'hard_locked', JSON.stringify(f.body).slice(0, 200));
  ROLE = 'owner';
  const n = await q('POST', '/periods/2026-27/3/unlock', {});
  ok('no reason: refused in words, still hard locked', n.status >= 400 && /reason/i.test(JSON.stringify(n.body)) && X.T.periods.find((p) => p.fiscal_year === '2026-27' && Number(p.period) === 3).status === 'hard_locked', JSON.stringify(n.body).slice(0, 200));
  const u = await q('POST', '/periods/2026-27/3/unlock', { reason: 'late supplier bill' });
  ok('with a reason: 200, the month is open', u.status === 200 && u.body.ok === true && u.body.period.status === 'open' && X.T.periods.find((p) => p.fiscal_year === '2026-27' && Number(p.period) === 3).status === 'open', JSON.stringify(u.body).slice(0, 200));
  ok('…and one change-log row says hard_locked → open with the reason (the audit row)', X.T.changes.filter((c) => c.table_name === 'fiscal_period' && c.row_id === '2026-27/3' && c.old === 'hard_locked' && /late supplier bill/.test(c.new)).length === 1, JSON.stringify(X.T.changes.slice(-3)).slice(0, 300));
  /* an older hard lock under a newer closed month stays shut */
  await q('POST', '/periods/2026-27/3/lock', { reason: 'again', hard: true });
  await q('POST', '/periods/2026-27/2/unlock', { reason: 'x' }); /* refused: Sep is locked */
  const under = await q('POST', '/periods/2026-27/2/unlock', { reason: 'older first' });
  ok('a month under a later locked month does not open (newest first keeps the chain sound)', under.status >= 400 && X.T.periods.find((p) => Number(p.period) === 2 && p.fiscal_year === '2026-27').status === 'soft_locked', JSON.stringify(under.body).slice(0, 200));
  srv.close();
  console.log('\n' + (fail ? '  x ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
