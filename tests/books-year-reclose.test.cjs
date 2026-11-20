/**
 * books-year-reclose.test.cjs — ACC-380 CLOSE THE YEAR AGAIN: judge (pure) and closeYear over the in-memory ledger.
 *   reopen -> close again with NO manual month lock: the 12 months and the tax periods read closed again · a filed (declared lodged) year stays filed · a year never reopened still refuses months_open / return_open · a non-owner gets 403
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');
const past = require(path.join(H.API, 'lib', 'books-year-past'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const STOP = ['year_not_ended', 'return_open', 'previous_year_open'];
const J = (refusals, last, extra) => { const r = refusals.slice(); const out = past.judge(r, Object.assign({ last, open: [], lodged: false, closingOk: false, stopNames: STOP, allRows: [], fiscalYear: '2026-27', pack: {}, shopDay: '2027-07-10', E: {}, addDays: () => '' }, extra)); return { r, out }; };
const reopen = { field: 'year_reopened', old: 'closed', new: 'open - late invoice' };
const closed = { field: 'year_closed', old: 'open', new: 'closed' };
const mo = { name: 'months_open', why: 'x' }, ro = { name: 'return_open', why: 'y' }, sn = { name: 'suspense_not_nil', why: 'z' };

/* judge, pure */
let t = J([mo, ro], reopen, { open: ['Q1'] });
ok('judge: reopened year, only months_open + return_open in the way -> closing_ok, both waived, nothing named lodged', t.out.closing_ok && t.out.reclosing && !t.r.length && t.out.waived.length === 0, JSON.stringify(t));
t = J([mo, ro], null, { open: ['Q1'] });
ok('judge: a year never reopened keeps months_open and return_open (a period never closed stays as it was)', !t.out.closing_ok && !t.out.reclosing && t.r.length === 2, JSON.stringify(t));
t = J([mo, ro], closed, { open: ['Q1'] });
ok('judge: the latest record is a CLOSE (older reopen superseded) -> refused as before', !t.out.reclosing && t.r.length === 2);
t = J([mo, sn], reopen);
ok('judge: a reopened year with Suspense not nil still refuses (only months_open is waived)', !t.out.closing_ok && t.r.some((x) => x.name === 'suspense_not_nil'));
t = J([mo], Object.assign({}, reopen, { old: 'closed' + past.LODGED_WORDS }));
ok('judge: a year declared lodged before the reopen stays filed (relodged)', t.out.relodged === true && t.out.closing_ok);
t = J([mo], reopen);
ok('judge: not declared before -> not relodged', t.out.relodged === false);

/* closeYear through the routes */
const AU = 'aaaaaaaa-7777-4111-8111-111111111111';
let ROLE = 'owner';
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: AU, identity_type: 'entity', display_name: 'Bondi Grocer' }; if (ROLE !== 'owner') req.identity.parent_entity_id = AU; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const call = (port, method, p, body) => new Promise((done) => { const b = JSON.stringify(body || {}); const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } }, (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); }); r.end(b); });

(async () => {
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  X.T.identities.push({ identity_id: AU, gstn: '51824753556', display_name: 'Bondi Grocer', country: 'AU', policy_flags: { gst_registration: 'regular' } });
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); const setDay = (day) => CLOCK.set(day + 'T02:00:00Z'); setDay('2026-07-02');
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  await q('POST', '/enable', {});
  X.T.setting.get(AU).enabled_at = '2026-07-02T02:00:00.000Z';
  await X.B.postEntry(X.db, AU, { type: 'walkin_day', ref: 'S1', date: '2026-07-09', currency: 'AUD', modes: { cash: 1100 }, by_rate: [{ rate: 10, taxable: 1000, gst: 100 }] });
  setDay('2027-07-10');
  const rows = () => X.T.periods.filter((p) => p.entity_id === AU && p.fiscal_year === '2026-27');
  const nev = await q('GET', '/year/2026-27/status');
  ok('never closed, months open: still refused months_open (not reclosing)', nev.body.can_close === false && nev.body.reclosing === false && nev.body.refusals.some((x) => x.name === 'months_open'), JSON.stringify(nev.body.refusals));
  for (let m = 1; m <= 12; m++) await q('POST', '/periods/2026-27/' + m + '/lock', { reason: 'checked' });
  const c1 = await q('POST', '/year/2026-27/close', { returns_lodged: true });
  ok('first close (declared lodged)', c1.body.ok === true, JSON.stringify(c1.body).slice(0, 200));
  ROLE = 'staff'; const r403 = await q('POST', '/year/2026-27/reopen', { reason: 'x' }); ROLE = 'owner';
  ok('a non-owner reopen: 403', r403.status === 403, String(r403.status));
  await q('POST', '/year/2026-27/reopen', { reason: 'late invoice' });
  const st = await q('GET', '/year/2026-27/status');
  ok('after the reopen: status can_close true, reclosing true, no months_open / return_open', st.body.can_close === true && st.body.reclosing === true && !st.body.refusals.some((x) => x.name === 'months_open' || x.name === 'return_open'), JSON.stringify(st.body.refusals));
  const c2 = await q('POST', '/year/2026-27/close', {});
  ok('close again with NO lock of the months: ok', c2.status === 200 && c2.body.ok === true, JSON.stringify(c2.body).slice(0, 300));
  ok('...every month hard locked again', rows().length >= 12 && rows().every((p) => p.status === 'hard_locked'));
  ok('...a declaration made before the reopen stays filed (same words on every month)', rows().every((p) => /returns lodged outside the books/.test(p.reason || '')), JSON.stringify(rows().map((p) => p.reason).slice(0, 2)));
  ok('...the log names the close after the reopen (newer than the reopen)', X.T.changes.filter((c) => c.field === 'year_closed' || c.field === 'year_reopened').map((c) => c.field).join() === 'year_closed,year_reopened,year_closed');
  srv.close();
  console.log('\n' + (fail ? '  x ' + fail + ' failed' : '  ok ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
