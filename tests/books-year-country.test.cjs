/**
 * books-year-country.test.cjs — ACC-204 (Athi, 2026-10-30; Round 1 §E3, AU-18b): THE YEAR CLOSE WAITS FOR EVERY BAS PERIOD, through real Express
 * over the in-memory ledger (no database). An Australian GST-registered shop:
 *   · GET /year/:fy/status names the open BAS periods (refusal return_open, code PERIOD_RETURN_OPEN, the labels) and POST /year/:fy/close answers
 *     422 PERIOD_RETURN_OPEN with nothing written · GET /periods carries `return: { form, period, label, closed }` on every month (never on the
 *     opening row) · the MONTH lock stays allowed · after each gst/close the open list shrinks and the month's `return.closed` turns true
 *   · a close stored under the OLD label text (engines #77 relabels BAS periods) still reads closed, and a repeat close answers duplicate (critic B9)
 *   · four closes → no return_open; the year closes (200) · a shop that charges no tax (no ABN) has no gate and no `return` key · India: books-year.test.cjs unchanged
 * Needs the books engines (the sibling ../chitbridge-engines/src, or BOOKS_ENGINES_SRC). Run: node tests/books-year-country.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const AU = 'aaaaaaaa-2222-4111-8111-111111111111', NOABN = 'aaaaaaaa-3333-4111-8111-111111111111';
const owner = (id, name) => ({ identity_id: id, identity_type: 'entity', display_name: name });
let WHO = owner(AU, 'Bondi Grocer');
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
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
  console.log('\n══ /api/books — the year close waits for every BAS period (ACC-204, AU-18b) ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  /* the registration facts books-store.taxRegistration reads (identities gstn · policy_flags.gst_registration): a registered shop and one with no ABN */
  X.T.identities.push({ identity_id: AU, gstn: '51824753556', display_name: 'Bondi Grocer', country: 'AU', policy_flags: { gst_registration: 'regular' } },
    { identity_id: NOABN, gstn: null, display_name: 'Manly Stall', country: 'AU', policy_flags: {} });
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  let DAY = '2026-07-20'; const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));   /* only "now" moves */
  const day = (shop, date, taxable, tax, ref) => X.B.postEntry(X.db, shop, { type: 'walkin_day', ref, date, currency: 'AUD', modes: { cash: taxable + tax }, by_rate: [{ rate: 10, taxable, gst: tax }] });
  const FY = '2026-27', Q = ['2026-Q1', '2026-Q2', '2027-Q3', '2027-Q4']; /* the pack's ids: the calendar year of the quarter */
  const rowsOf = (fy) => X.T.periods.filter((p) => p.entity_id === AU && p.fiscal_year === fy);
  const returnOpen = (body) => (body.refusals || []).find((r) => r.name === 'return_open');

  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  ok('AU: the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  /* a sale in each quarter, the shop's day moving with it */
  for (const [on, date] of [['2026-07-20', '2026-07-10'], ['2026-11-10', '2026-11-05'], ['2027-02-10', '2027-02-03'], ['2027-05-10', '2027-05-06']]) { DAY = on; await day(AU, date, 1000, 100, 'D' + date); }
  DAY = '2027-07-10';

  /* 1 · the status and the close name the open BAS periods, in words and with a code */
  const s0 = await q('GET', '/year/' + FY + '/status');
  const ro = returnOpen(s0.body);
  ok('status: refusal return_open with code PERIOD_RETURN_OPEN, the four BAS labels, can_close false', s0.status === 200 && ro && ro.code === 'PERIOD_RETURN_OPEN' && ro.periods.length === 4 && /Close each BAS period first/.test(ro.why) && /Q1/.test(ro.periods[0]) && s0.body.can_close === false, JSON.stringify(s0.body));
  ok('…the open labels are the pack\'s own (GET /returns ids kept: the label, not a bare 2026-Q1)', ro && ro.periods.every((label) => /Q[1-4]/.test(label) && !/^2026-Q/.test(label)), JSON.stringify(ro && ro.periods));
  const c0 = await q('POST', '/year/' + FY + '/close', {});
  ok('close → 422 PERIOD_RETURN_OPEN, the refusals beside it, nothing hard-locked', c0.status === 422 && c0.body.code === 'PERIOD_RETURN_OPEN' && c0.body.ok === false && returnOpen(c0.body) && rowsOf(FY).every((p) => p.status !== 'hard_locked'), JSON.stringify(c0.body));
  /* 2 · the month lock advice names the period each month ends in; the lock itself stays allowed */
  let per = await q('GET', '/periods?fy=' + FY);
  const jul = per.body.periods.find((p) => Number(p.period) === 1), opening = per.body.periods.find((p) => Number(p.period) === 0), nov = per.body.periods.find((p) => Number(p.period) === 5);
  eq('July carries return { form BAS · period 2026-Q1 · closed false } with the label', jul && jul.return && [jul.return.form, jul.return.period, jul.return.closed, /Q1/.test(jul.return.label)], ['BAS', '2026-Q1', false, true]);
  ok('…the opening row carries no return; November is Q2', opening && !('return' in opening) && nov && nov.return.period === '2026-Q2', JSON.stringify([opening, nov]));
  ok('…July may be locked (the month lock stays allowed, DECISIONS 30 Oct Q2)', jul.lock.may === true && jul.lock.why === null, JSON.stringify(jul.lock));
  const lk = await q('POST', '/periods/' + FY + '/1/lock', { reason: 'July done' });
  ok('locking July → 200', lk.status === 200 && lk.body.ok === true, JSON.stringify(lk.body));
  /* 3 · one close: the list shrinks, the months of Q1 read closed */
  const q1 = await q('POST', '/gst/close', { period: Q[0], client_ref: 'q1' });
  ok('Q1 closes (200) with nothing to set off (no purchases): no entry, every month it covers carries its reason — the hand-locked July re-stamped', q1.status === 200 && q1.body.ok === true && q1.body.nothing_to_set_off === true && q1.body.locked.length === 3
    && rowsOf(FY).filter((p) => p.period >= 1 && p.period <= 3).every((p) => p.status === 'soft_locked' && /^Tax period closed — /.test(p.reason)), JSON.stringify([q1.body, rowsOf(FY).slice(1, 4)]));
  ok('…the owner\'s own reason for July stays in the change log', X.T.changes.some((c) => c.table_name === 'fiscal_period' && c.row_id === FY + '/1' && /July done/.test(String(c.old) + String(c.new))), JSON.stringify(X.T.changes.filter((c) => c.row_id === FY + '/1')));
  const s1 = await q('GET', '/year/' + FY + '/status');
  ok('status: three BAS periods still open, Q1 gone from the list', returnOpen(s1.body) && returnOpen(s1.body).periods.length === 3 && !returnOpen(s1.body).periods.some((label) => /Q1/.test(label)), JSON.stringify(s1.body.refusals));
  per = await q('GET', '/periods?fy=' + FY);
  ok('July\'s return.closed is true, November\'s still false', per.body.periods.find((p) => Number(p.period) === 1).return.closed === true && per.body.periods.find((p) => Number(p.period) === 5).return.closed === false);
  /* 4 · critic B9 / engines #77: a close stored under the OLD label text still reads closed, and closing it again answers duplicate */
  const oldLabel = 'Tax period closed — 2026-27 Q2 (Oct–Dec 2026)';
  for (const p of [4, 5, 6]) await X.store.setPeriodStatus(X.db, AU, FY, p, 'soft_locked', 'old-close', oldLabel);
  const s2 = await q('GET', '/year/' + FY + '/status');
  ok('Q2 locked under an old label (no entry): reads closed — two periods open', returnOpen(s2.body) && returnOpen(s2.body).periods.length === 2 && !returnOpen(s2.body).periods.some((label) => /Q2/.test(label)), JSON.stringify(s2.body.refusals));
  const entriesBefore = X.T.entries.filter((e) => e.entity_id === AU).length;
  const q2 = await q('POST', '/gst/close', { period: Q[1], client_ref: 'q2' });
  ok('closing Q2 again → duplicate: true, nothing posted', q2.status === 200 && q2.body.duplicate === true && X.T.entries.filter((e) => e.entity_id === AU).length === entriesBefore, JSON.stringify(q2.body));
  /* 5 · every period closed → no return_open; the year closes */
  for (const period of [Q[2], Q[3]]) { const r = await q('POST', '/gst/close', { period, client_ref: period }); ok(period + ' closes', r.status === 200 && r.body.ok === true, JSON.stringify(r.body)); }
  const s3 = await q('GET', '/year/' + FY + '/status');
  ok('status: no return_open, every month locked by its close, can_close true', !returnOpen(s3.body) && s3.body.can_close === true && s3.body.refusals.length === 0, JSON.stringify(s3.body));
  const c1 = await q('POST', '/year/' + FY + '/close', {});
  ok('CLOSE → 200: the year is closed, the next is 2027-28', c1.status === 200 && c1.body.ok === true && c1.body.next === '2027-28' && c1.body.locked === 13, JSON.stringify(c1.body));
  /* 6 · a shop that charges no tax: no gate, no return key */
  WHO = owner(NOABN, 'Manly Stall');
  DAY = '2026-07-20';
  await X.store.saveSetting(X.db, NOABN, { enabled: false, country: 'AU' });
  ok('no-ABN shop: the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  DAY = '2027-07-10';
  const s4 = await q('GET', '/year/' + FY + '/status');
  ok('no-ABN shop: no return_open (it files no BAS); months_open is what stops it', !returnOpen(s4.body) && s4.body.refusals.some((r) => r.name === 'months_open'), JSON.stringify(s4.body.refusals));
  const per4 = await q('GET', '/periods?fy=' + FY);
  ok('no-ABN shop: no month carries a return key', per4.body.periods.length === 13 && per4.body.periods.every((p) => !('return' in p)));
  srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
