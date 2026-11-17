/**
 * books-past-years.test.cjs — PAST-YEARS (Athi 16 Nov 2026, the 150-client / 7-year measurement): THE YEARS BEFORE LAST CLOSE, OLDEST FIRST, through real Express over the in-memory ledger.
 * An Australian GST-registered shop with three financial years of sales (2024-25, 2025-26, 2026-27); the shop's day is 2027-07-10, so 2024-25 and 2025-26 are older than last year:
 *   · a year with unclosed BAS periods is refused as before (PERIOD_RETURN_OPEN) and says it may be closed by saying the returns were lodged · the declaration closes it with NO set-off posted
 *   · oldest first: closing 2025-26 while 2024-25 is open is refused (previous_year_open) · a closed year refuses a typed write · the next year's opening is the carry (profit 1,000.00 by hand)
 *   · GET /returns lists every year the books hold, ?period=2024-Q1 opens that period (read only) and each period says set_off / declared_lodged / open
 *   · the last year (2026-27) keeps today's rule: it still waits for its BAS (books-year-country.test.cjs)
 * Run: CB_ENGINES_DIR=../chitbridge-engines node tests/books-past-years.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const AU = 'aaaaaaaa-7777-4111-8111-111111111111';
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: AU, identity_type: 'entity', display_name: 'Bondi Grocer' }; next(); }, {
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
  console.log('\n══ /api/books — the years before last close, oldest first (PAST-YEARS) ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  X.T.identities.push({ identity_id: AU, gstn: '51824753556', display_name: 'Bondi Grocer', country: 'AU', policy_flags: { gst_registration: 'regular' } });
    const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); const setDay = (day) => CLOCK.set(day + 'T02:00:00Z'); setDay('2024-07-02');
  const sale = async (date, ref) => { const r = await X.B.postEntry(X.db, AU, { type: 'walkin_day', ref, date, currency: 'AUD', modes: { cash: 1100 }, by_rate: [{ rate: 10, taxable: 1000, gst: 100 }] }); if (!r || r.ok === false) console.log('   sale refused', date, JSON.stringify(r).slice(0, 200)); return r; };
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  ok('the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  X.T.setting.get(AU).enabled_at = '2024-07-02T02:00:00.000Z'; /* the memory store stamps its own counter; the real upsert takes the shop clock (books.enable at:) */
  /* one sale a year: 1,000.00 ex GST each */
  for (const [on, date] of [['2024-07-10', '2024-07-09'], ['2025-07-10', '2025-07-09'], ['2026-07-10', '2026-07-09']]) { setDay(on); await sale(date, 'S' + date); }
  setDay('2027-07-10');
  const lockYear = async (fy) => { for (let m = 1; m <= 12; m++) { const r = await q('POST', '/periods/' + fy + '/' + m + '/lock', { reason: 'checked' }); if (r.status !== 200) return Object.assign(r, { month: m }); } return { status: 200 }; };
  const open = (b) => (b.refusals || []).find((r) => r.name === 'return_open');

  /* 1 · the oldest year: the gate still names the BAS periods; the declaration is offered; nothing about the default moves */
  ok('2024-25 months lock (the month lock is allowed)', (await lockYear('2024-25')).status === 200);
  const s0 = await q('GET', '/year/2024-25/status');
  ok('status: BAS periods open, can_close false, and says the returns may be declared lodged', s0.status === 200 && open(s0.body) && open(s0.body).periods.length === 4 && s0.body.can_close === false && s0.body.can_close_if_lodged === true, JSON.stringify(s0.body));
  const c0 = await q('POST', '/year/2024-25/close', {});
  ok('close with no declaration: 422 PERIOD_RETURN_OPEN as before, nothing hard-locked', c0.status === 422 && c0.body.code === 'PERIOD_RETURN_OPEN' && !X.T.periods.some((p) => p.entity_id === AU && p.fiscal_year === '2024-25' && p.status === 'hard_locked'), JSON.stringify(c0.body));
  /* 2 · oldest first: 2025-26 may not close while 2024-25 is open */
  { const lk = await lockYear('2025-26'); ok('2025-26 months lock', lk.status === 200, JSON.stringify(lk)); }
  const s1 = await q('GET', '/year/2025-26/status');
  ok('status of 2025-26: previous_year_open names 2024-25, can_close_if_lodged false', s1.body.refusals.some((r) => r.name === 'previous_year_open' && /2024-25/.test(r.why)) && s1.body.can_close_if_lodged === false, JSON.stringify(s1.body.refusals));
  const c1 = await q('POST', '/year/2025-26/close', { returns_lodged: true });
  ok('close 2025-26 first, even declared: 422 YEAR_CLOSE_REFUSED, nothing hard-locked', c1.status === 422 && c1.body.code === 'YEAR_CLOSE_REFUSED' && !X.T.periods.some((p) => p.fiscal_year === '2025-26' && p.status === 'hard_locked'), JSON.stringify(c1.body));
  /* 3 · the declaration closes the oldest year; no set-off was posted */
  const before = X.T.entries.filter((e) => e.entity_id === AU).length;
  const c2 = await q('POST', '/year/2024-25/close', { returns_lodged: true });
  ok('close 2024-25, returns lodged: 200, next 2025-26, opening profit 1,000.00 AUD by hand', c2.status === 200 && c2.body.ok === true && c2.body.next === '2025-26' && c2.body.opening && c2.body.opening.profit_minor === 100000 && c2.body.opening.balanced === true, JSON.stringify(c2.body));
  ok('…no entry was posted (nothing is re-prepared)', X.T.entries.filter((e) => e.entity_id === AU).length === before);
  ok('…every month of 2024-25 is hard locked and says the returns were lodged', X.T.periods.filter((p) => p.entity_id === AU && p.fiscal_year === '2024-25').every((p) => p.status === 'hard_locked' && /returns lodged/.test(p.reason)));
  const again = await q('POST', '/year/2024-25/close', { returns_lodged: true });
  ok('closing it again is a duplicate, nothing changes', again.status === 200 && again.body.duplicate === true);
  const w = await q('POST', '/events', { type: 'journal', date: '2024-08-01', narration: 'late', lines: [{ account: '1000', dr: 1 }, { account: '3000', cr: 1 }] });
  ok('a typed write into the closed year is refused, nothing posted', w.status >= 400 && !X.T.entries.some((e) => e.entity_id === AU && e.date === '2024-08-01'), JSON.stringify(w.body).slice(0, 200));
  /* 4 · then the next: its opening is the carry of the first */
  const s2 = await q('GET', '/year/2025-26/status');
  ok('status of 2025-26 after 2024-25: no previous_year_open, can_close_if_lodged true', !s2.body.refusals.some((r) => r.name === 'previous_year_open') && s2.body.can_close_if_lodged === true, JSON.stringify(s2.body));
  const c3 = await q('POST', '/year/2025-26/close', { returns_lodged: true });
  ok('close 2025-26: 200, next 2026-27, balanced carry', c3.status === 200 && c3.body.next === '2026-27' && c3.body.opening.balanced === true, JSON.stringify(c3.body));
  /* 5 · the last year (2026-27, the previous FY of the shop's day) keeps today's rule: it still waits for its BAS */
  await lockYear('2026-27');
  const s3 = await q('GET', '/year/2026-27/status');
  ok('2026-27 (last year): can_close false while its BAS periods are open - the same as before', s3.body.can_close === false && !!open(s3.body) && s3.body.can_close_if_lodged !== undefined, JSON.stringify(s3.body.refusals));
  /* 6 · BAS older periods, read only */
  const list = await q('GET', '/returns');
  const codes = (list.body.periods || []).map((p) => p.period);
  ok('GET /returns lists every year the books hold: FY25 to FY28 present', ['2024-Q1', '2025-Q4', '2025-Q1', '2026-Q4', '2026-Q1', '2027-Q4'].every((c) => codes.includes(c)), JSON.stringify(codes));
  const old = await q('GET', '/returns?period=2024-Q1');
  ok('?period=2024-Q1 opens that period', old.status === 200 && old.body.period && old.body.period.period === '2024-Q1', JSON.stringify(old.body.period));
  ok('…says Prepared, not lodged, with the period state declared_lodged', old.body.prepared === 'Prepared, not lodged' && old.body.period.state === 'declared_lodged', JSON.stringify(old.body.period));
  const g1 = (old.body.boxes || []).find((b) => b.code === 'G1');
  ok('…G1 total sales is 1100.00 AUD (110000 minor) for that quarter, read from the books', g1 && Number(g1.amount_minor) === 110000, JSON.stringify(g1));
  const live = (list.body.periods || []).find((p) => p.period === '2026-Q1');
  ok('2026-Q1 (year not closed) reads state open', live && live.state === 'open', JSON.stringify(live));
  const both = await q('GET', '/returns?period=2025-Q3');
  ok('a period of a closed year opens too (2025-Q3, state declared_lodged)', both.status === 200 && both.body.period.period === '2025-Q3' && both.body.period.state === 'declared_lodged', JSON.stringify(both.body.period));
  srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
