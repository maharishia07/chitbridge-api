/**
 * books-yearclose-reopen.test.cjs — YEARCLOSE (Athi 20 Nov 2026, accepted recommendation, leader practice): the ONE lock date, through real Express over the in-memory ledger.
 *   1 · closing a later year while an older one is open is refused — last year included (previous_year_open)
 *   2 · reopen: owner only (a firm/staff identity gets 403), a reason is required, only the NEWEST closed year; logged; posting opens again; close again leaves the carried totals as they were (two carried totals compared)
 *   3 · a correction of a closed year that lands in the open year says "Prior-period correction (FY …)" on the entry (the Day book line reads the same narration)
 *   4 · warnings[]: waiting actions, an unreconciled bank, the auditor's open queries are NAMED, the close still goes ahead
 * An AU GST shop, three years of one 1,000.00 sale each (2024-25, 2025-26, 2026-27); the shop's day is 2027-07-10 so 2026-27 is LAST year. Run: BOOKS_ENGINES_SRC=… node tests/books-yearclose-reopen.test.cjs
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
  console.log('\n══ /api/books — one lock date: order, reopen, prior-period wording, warnings (YEARCLOSE) ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  X.T.identities.push({ identity_id: AU, gstn: '51824753556', display_name: 'Bondi Grocer', country: 'AU', policy_flags: { gst_registration: 'regular' } });
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); const setDay = (day) => CLOCK.set(day + 'T02:00:00Z'); setDay('2024-07-02');
  const sale = async (date, ref) => { const r = await X.B.postEntry(X.db, AU, { type: 'walkin_day', ref, date, currency: 'AUD', modes: { cash: 1100 }, by_rate: [{ rate: 10, taxable: 1000, gst: 100 }] }); return r; };
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  await q('POST', '/enable', {});
  X.T.setting.get(AU).enabled_at = '2024-07-02T02:00:00.000Z';
  const first = [];
  for (const [on, date] of [['2024-07-10', '2024-07-09'], ['2025-07-10', '2025-07-09'], ['2026-07-10', '2026-07-09']]) { setDay(on); first.push(await sale(date, 'S' + date)); }
  setDay('2027-07-10');
  const lockYear = async (fy) => { for (let m = 1; m <= 12; m++) { const r = await q('POST', '/periods/' + fy + '/' + m + '/lock', { reason: 'checked' }); if (r.status !== 200) return Object.assign(r, { m }); } return { status: 200 }; };
  for (const fy of ['2024-25', '2025-26', '2026-27']) await lockYear(fy);

  /* 1 · order: the LAST year (2026-27) is refused while 2024-25 and 2025-26 are open, declared lodged or not */
  const c0 = await q('POST', '/year/2026-27/close', { returns_lodged: true });
  ok('last year: close refused while an older year is open (422, nothing hard-locked)', c0.status === 422 && c0.body.code === 'YEAR_CLOSE_REFUSED' && /2024-25/.test(JSON.stringify(c0.body)) && !X.T.periods.some((p) => p.fiscal_year === '2026-27' && p.status === 'hard_locked'), JSON.stringify(c0.body).slice(0, 300));
  const s0 = await q('GET', '/year/2026-27/status');
  ok('status says previous_year_open, naming the oldest (2024-25)', s0.body.refusals.some((r) => r.name === 'previous_year_open' && /2024-25/.test(r.why)));

  /* 4 · warnings: the readers are stubbed (the in-memory ledger has no bank log / queue / marks); the close still goes ahead */
  const queue = require(path.join(H.API, 'lib', 'books-action-queue')), bank = require(path.join(H.API, 'lib', 'bank-rec-log')), needs = require(path.join(H.API, 'lib', 'books-needs'));
  const keep = { q: queue.queuePage, b: bank.onTrialBalance, n: needs.openMarks };
  queue.queuePage = async () => ({ total: 2, actions: [] });
  bank.onTrialBalance = async () => [{ name: 'Operating account', state: 'unexplained' }, { name: 'Savings', state: 'reconciled' }];
  needs.openMarks = async () => [{ subject_id: 'e1', class: 'open' }, { subject_id: 'e2', class: 'hold' }, { subject_id: 'e3', class: 'done' }];
  const w = await q('GET', '/year/2024-25/status');
  const names = (w.body.warnings || []).map((x) => x.name).sort().join(',');
  ok('status warnings: actions_waiting, auditor_open, bank_unreconciled (the reconciled account is not named)', names === 'actions_waiting,auditor_open,bank_unreconciled' && !/Savings/.test(JSON.stringify(w.body.warnings)), JSON.stringify(w.body.warnings));
  ok('…with counts 2 · 2 · 1', (w.body.warnings || []).map((x) => x.count).sort().join() === '1,2,2');
  const c1 = await q('POST', '/year/2024-25/close', { returns_lodged: true });
  ok('the close still proceeds (no new gate) and answers the same warnings[]', c1.status === 200 && c1.body.ok === true && (c1.body.warnings || []).length === 3, JSON.stringify(c1.body).slice(0, 300));
  queue.queuePage = keep.q; bank.onTrialBalance = keep.b; needs.openMarks = keep.n;
  const c2 = await q('POST', '/year/2025-26/close', { returns_lodged: true });
  ok('2025-26 closes next, warnings [] when nothing waits', c2.status === 200 && Array.isArray(c2.body.warnings) && c2.body.warnings.length === 0, JSON.stringify(c2.body).slice(0, 300));
  const c3 = await q('POST', '/year/2026-27/close', { returns_lodged: true });
  ok('2026-27 (last year) closes once the older years are closed', c3.status === 200 && c3.body.ok === true, JSON.stringify(c3.body).slice(0, 300));
  const carried = c3.body.opening;

  /* 2 · reopen */
  ROLE = 'firm';
  const f = await q('POST', '/year/2026-27/reopen', { reason: 'late invoice' });
  ok('a firm / staff identity: 403 OWNER_ONLY, nothing opened', f.status === 403 && f.body.code === 'OWNER_ONLY' && X.T.periods.filter((p) => p.fiscal_year === '2026-27').every((p) => p.status === 'hard_locked'), JSON.stringify(f.body).slice(0, 200));
  const fm = await q('POST', '/periods/2026-27/12/reopen', { reason: 'late invoice' });
  ok('…and for the month reopen too (403)', fm.status === 403);
  ROLE = 'owner';
  const r0 = await q('POST', '/year/2026-27/reopen', {});
  ok('no reason: refused in words, still closed', r0.status >= 400 && /reason/i.test(JSON.stringify(r0.body)) && X.T.periods.filter((p) => p.fiscal_year === '2026-27').every((p) => p.status === 'hard_locked'), JSON.stringify(r0.body).slice(0, 200));
  const r1 = await q('POST', '/year/2024-25/reopen', { reason: 'too old' });
  ok('an older closed year (not the newest): refused, naming the newer closed year first', r1.status >= 400 && /2025-26/.test(JSON.stringify(r1.body)) && X.T.periods.filter((p) => p.fiscal_year === '2024-25').every((p) => p.status === 'hard_locked'), JSON.stringify(r1.body).slice(0, 200));
  const r1b = await q('POST', '/periods/2026-27/12/reopen', { reason: 'one month' });
  ok('a month a year close locked opens with its year, not alone', r1b.status >= 400 && /year/i.test(JSON.stringify(r1b.body)));
  const r2 = await q('POST', '/year/2026-27/reopen', { reason: 'late supplier invoice' });
  ok('the newest closed year reopens with a reason: 200, 13 rows open', r2.status === 200 && r2.body.ok === true && X.T.periods.filter((p) => p.entity_id === AU && p.fiscal_year === '2026-27').every((p) => p.status === 'open'), JSON.stringify(r2.body));
  ok('…logged: a year_reopened change with the reason', X.T.changes.some((c) => c.field === 'year_reopened' && c.row_id === '2026-27' && /late supplier invoice/.test(c.new)));
  const sy = await q('GET', '/year/2026-27/status');
  ok('status: not closed any more', sy.body.closed === false);
  const w2 = await q('POST', '/events', { type: 'journal', date: '2026-08-01', narration: 'late invoice', lines: [{ account: '1000', dr: 1 }, { account: '3000', cr: 1 }] });
  ok('posting is open again in the reopened year (not refused as locked)', w2.status === 200 || !/closed|locked/i.test(JSON.stringify(w2.body)), JSON.stringify(w2.body).slice(0, 200));
  /* close again: with nothing posted between, the carried totals are the same figures (two carried totals compared, not recomputed) */
  const rp = await q('POST', '/year/2026-27/reopen', { reason: 'second look' });
  ok('a year already open again: refused (nothing to open)', rp.status >= 400 && /not closed/.test(JSON.stringify(rp.body)));
  /* close again: relock + close, reopen, relock + close — nothing posted between the two closes, so the two carried openings are the same figures (compared, not recomputed) */
  await lockYear('2026-27');
  const k2 = await q('POST', '/year/2026-27/close', { returns_lodged: true });
  await q('POST', '/year/2026-27/reopen', { reason: 'second look' });
  await lockYear('2026-27');
  const k3 = await q('POST', '/year/2026-27/close', { returns_lodged: true });
  ok('close again after a reopen: ok, and the carried opening (rows, retained, profit) equals the first close of that state', k2.body.ok && k3.body.ok && JSON.stringify(k2.body.opening) === JSON.stringify(k3.body.opening), JSON.stringify([k2.body.opening, k3.body.opening]));
  ok('…the year is closed again, every month hard locked', X.T.periods.filter((p) => p.entity_id === AU && p.fiscal_year === '2026-27').every((p) => p.status === 'hard_locked'));
  /* 3 · a correction into a closed year lands in the open year with the prior-period words on the entry and the Day book line */
  const rv = await q('POST', '/entries/' + first[0].entry_id + '/reverse', { reason: 'sale keyed twice' });
  ok('reversing a 2024-25 entry: posted in the open year, moved, linked to the original', rv.status === 200 && rv.body.moved === true && !!rv.body.reverses_entry_id, JSON.stringify(rv.body).slice(0, 250));
  const day = await q('GET', '/daybook?from=2027-07-01&to=2027-07-31');
  const lines = JSON.stringify(day.body);
  ok('the entry and the Day book line carry "Prior-period correction (FY 2024-25)"', lines.includes('Prior-period correction (FY 2024-25)') && X.T.entries.some((e) => e.reverses_entry_id && String(e.narration || '').includes('Prior-period correction (FY 2024-25)')), lines.slice(0, 300));
  srv.close();
  console.log('\n' + (fail ? '  x ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
