/**
 * tests/tax-lock-nil-1128.test.cjs — F4 LEFT (1), batch 1128: a tax close with NOTHING TO SET OFF posts no entry; its marker (change log: tax_close · gstclose:<key> · closed_nil) is what a year reopen reads.
 * AU shop, Q1 (Jul-Sep 2026) sells 18,200.00 + GST 1,820.00 (182000), buys nothing → no input credit, nothing to set off.
 *   · the close writes NO set-off entry and ONE marker; closing the same period again writes no second marker
 *   · year close (Q2..Q4 closed nil too) then reopen: 12 months come back soft-locked 'Tax period closed — ', a typed entry into September is refused PERIOD_LOCKED
 *   · GST collected before = after (182000), compared as carried totals
 * Needs the books engines (BOOKS_ENGINES_SRC or the sibling ../chitbridge-engines/src). Run: node tests/tax-lock-nil-1128.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const AU = 'aaaaaaaa-8888-4111-8111-111111111111';
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: AU, identity_type: 'entity', display_name: 'Bondi Grocer' }; next(); }, {
  entityOf: (req) => req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

(async () => {
  console.log('\n== F4 LEFT: a nil tax close keeps its lock through a year reopen ==\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  X.T.identities.push({ identity_id: AU, gstn: '51824753556', display_name: 'Bondi Grocer', country: 'AU', policy_flags: { gst_registration: 'regular' } });
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  let DAY = '2026-10-20'; const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));
  const FY = '2026-27';
  const rowOf = (p) => X.T.periods.find((r) => r.entity_id === AU && r.fiscal_year === FY && Number(r.period) === p);
  const gstCollected = () => { const code = (X.T.accounts.find((a) => a.entity_id === AU && a.role === 'gst_collected') || {}).code; return X.T.lines.filter((l) => l.entity_id === AU && l.code === code).reduce((s, l) => s + Number(l.cr_minor) - Number(l.dr_minor), 0); };
  const markers = () => X.T.changes.filter((c) => c.table_name === 'tax_close' && c.field === 'closed_nil');
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  ok('AU: the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  await X.B.postEntry(X.db, AU, { type: 'walkin_day', ref: 'S1', date: '2026-08-10', currency: 'AUD', modes: { cash: 20020 }, by_rate: [{ rate: 10, taxable: 18200, gst: 1820 }] });
  const entries0 = X.T.entries.length;
  const close = await q('POST', '/gst/close', { period: '2026-Q1', client_ref: 'q1' });
  ok('Q1 closes (200) with nothing to set off', close.status === 200 && close.body.ok === true, JSON.stringify(close.body));
  eq('no set-off entry was posted', X.T.entries.length, entries0);
  eq('one nil-close marker, row_id gstclose:<key>', markers().map((m) => /^gstclose:/.test(m.row_id)), [true]);
  await q('POST', '/gst/close', { period: '2026-Q1', client_ref: 'q1b' });
  eq('closing it again writes no second marker', markers().length, 1);
  DAY = '2027-07-10';
  for (const period of ['2026-Q2', '2027-Q3', '2027-Q4']) { const r = await q('POST', '/gst/close', { period, client_ref: period }); ok(period + ' closes', r.status === 200 && r.body.ok === true, JSON.stringify(r.body)); }
  eq('four periods, four markers', markers().length, 4);
  const yc = await q('POST', '/year/' + FY + '/close', {});
  ok('the year closes (200)', yc.status === 200 && yc.body.ok === true, JSON.stringify(yc.body));
  const ro = await q('POST', '/year/' + FY + '/reopen', { reason: 'late correction' });
  ok('the year reopens (200)', ro.status === 200 && ro.body.ok === true, JSON.stringify(ro.body));
    ok('every month of the four closed periods is soft-locked with the tax close words again', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].every((p) => rowOf(p).status === 'soft_locked' && /^Tax period closed — /.test(rowOf(p).reason)), JSON.stringify([1, 2, 3].map(rowOf)));
  const e1 = X.T.entries.length, before = gstCollected();
  const strict = await q('POST', '/loans', { ref: 'strict-sep', lender: 'X', amount_minor: 100, into: 'bank', date: '2026-09-10' });
  ok('an entry typed into September is refused (409 PERIOD_LOCKED), nothing posted', strict.status === 409 && strict.body.code === 'PERIOD_LOCKED' && X.T.entries.length === e1, JSON.stringify(strict.body));
  eq('GST collected carried 1,820.00 (182000) before and after', [before, gstCollected()], [182000, 182000]);
  srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
